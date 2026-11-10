/**
 * Orquestrador do middleware — o coração do ciclo de polling.
 *
 * @file A cada tick do cron: coleta queries novas por chain, respeita
 *       `executeAfter`, resolve o datasource, envia `__callback` e marca
 *       done/failed em KV com até 3 tentativas.
 * @author Carlos Delfino <consultoria@carlosdelfino.eti.br>
 */
import type { ChainAdapter, Env } from "../chains/OracleChain";
import { createEvmAdapter } from "../chains/evm";
import { createSolanaAdapter } from "../chains/solana";
import { createStellarAdapter } from "../chains/stellar";
import { resolveQuery } from "./resolver";
import {
  loadChainState,
  noteCheckpoint,
  flushChainState,
  isProcessed,
  markProcessed,
  stateStore,
  MAX_ATTEMPTS,
  type LoadedChainState,
  type PendingQuery,
} from "./state";
import { logger } from "../utils/logger";

const FILE = "services/orchestrator.ts";

/** Factory de adapters conforme CHAINS_ENABLED (Strategy + Factory). */
export function buildAdapters(env: Env): ChainAdapter[] {
  const enabled = (env.CHAINS_ENABLED ?? "evm").split(",").map((s) => s.trim());
  const factories: Record<string, (e: Env) => ChainAdapter | null> = {
    evm: createEvmAdapter,
    solana: createSolanaAdapter,
    stellar: createStellarAdapter,
  };
  const adapters: ChainAdapter[] = [];
  for (const name of enabled) {
    const adapter = factories[name]?.(env);
    if (adapter) adapters.push(adapter);
  }
  return adapters;
}

/**
 * Executa um ciclo completo de processamento.
 * @returns Resumo para `/status` e logs.
 */
export async function runCycle(env: Env): Promise<{ chain: string; newQueries: number; dispatched: number; failed: number; checkpoint: string; lastError: string }[]> {
  const adapters = buildAdapters(env);
  const summary = [];
  for (const adapter of adapters) {
    const counters = { chain: adapter.id, newQueries: 0, dispatched: 0, failed: 0, checkpoint: "0", lastError: "" };
    try {
      const kv = stateStore(env);
      // 1 leitura por tick — documento coalescido (checkpoint + pendentes).
      const loaded = await loadChainState(kv, adapter.id);
      try {
        const { queries, newCheckpoint } = await adapter.fetchPending(env, loaded.checkpoint);
        counters.checkpoint = newCheckpoint.toString();
        for (const q of queries) {
          // dedupe: já agendada neste documento ou já processada (marcador KV).
          if (loaded.state.pending[q.queryId]) continue;
          if (await isProcessed(kv, adapter.id, q.queryId)) continue;
          counters.newQueries++;
          loaded.state.pending[q.queryId] = q;
          loaded.dirty = true;
        }
        noteCheckpoint(loaded, newCheckpoint);

        // processa pendentes (novas + agendadas anteriores vencidas)
        const now = Math.floor(Date.now() / 1000);
        for (const q of Object.values(loaded.state.pending)) {
          if (q.executeAfter > now) continue;
          const done = await dispatchOne(env, adapter, kv, loaded, q);
          if (done) counters.dispatched++;
          else counters.failed++;
        }
      } finally {
        // grava o documento só quando houve mudança (ou checkpoint venceu o
        // intervalo de persistência) — mantém o flush mesmo se uma query falhar.
        await flushChainState(kv, adapter.id, loaded);
      }
    } catch (err) {
      counters.failed++;
      counters.lastError = (err as Error).message.slice(0, 200);
      logger.error(FILE, "falha no ciclo da chain", { chain: adapter.id, error: (err as Error).message });
    }
    summary.push(counters);
  }
  return summary;
}

/**
 * Resolve + entrega uma única query. `true` se despachada, `false` se falhou.
 */
async function dispatchOne(env: Env, adapter: ChainAdapter, kv: KVNamespace, loaded: LoadedChainState, q: PendingQuery): Promise<boolean> {
  const attempts = q.attempts + 1;
  try {
    const result = await resolveQuery(q.datasource, q.args[0], env);
    const tx = await adapter.sendCallback(env, q, result);
    await markProcessed(kv, q.chain, q.queryId, true, attempts);
    delete loaded.state.pending[q.queryId];
    loaded.dirty = true;
    await adapter.markComplete?.(env, q);
    logger.info(FILE, "query despachada", { chain: q.chain, queryId: q.queryId.slice(0, 18), tx, attempts });
    return true;
  } catch (err) {
    await markProcessed(kv, q.chain, q.queryId, false, attempts);
    if (attempts < MAX_ATTEMPTS) {
      // permanece no documento com attempts atualizado — reescrita única no flush.
      q.attempts = attempts;
    } else {
      delete loaded.state.pending[q.queryId];
      await adapter.markFailed?.(env, q);
    }
    loaded.dirty = true;
    logger.warn(FILE, "falha ao despachar query", {
      chain: q.chain,
      queryId: q.queryId.slice(0, 18),
      error: (err as Error).message,
      attempts,
    });
    return false;
  }
}
