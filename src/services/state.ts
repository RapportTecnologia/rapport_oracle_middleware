/**
 * Estado persistente do middleware em Workers KV (`ORACLE_STATE`).
 *
 * @file Layout de chaves otimizado para o plano Free (1k writes/deletes/lists
 *       por dia — ver issue #10):
 *         `state:{chain}`           → documento coalescido `{ checkpoint, pending }`
 *         `{chain}:checkpoint`      → legado (somente leitura de migração)
 *         `{chain}:processed:{qid}` → "done" | "failed:{attempts}" (dedupe TTL)
 *       Um tick faz 1 leitura por chain e 1 escrita apenas quando o documento
 *       muda — ou, sem mudança de pending, a cada `CHECKPOINT_PERSIST_INTERVAL_MS`
 *       para registrar o checkpoint avançado. Nenhuma operação `list`/`delete`
 *       é usada no hot path.
 * @author Carlos Delfino <consultoria@carlosdelfino.eti.br>
 */

/** Query normalizada trocada entre adapters e o orquestrador. */
export interface PendingQuery {
  /** Identificador da chain ("evm:80002", "solana:devnet", "stellar:testnet"). */
  chain: string;
  /** rqid hex (EVM bytes32) ou base58/base64 conforme a chain. */
  queryId: string;
  /** Endereço/id do consumidor que recebe `__callback`. */
  consumer: string;
  /** Datasource declarado (ex.: "URL"). */
  datasource: string;
  /** Argumentos da requisição. */
  args: string[];
  /** Timestamp unix mínimo de execução. */
  executeAfter: number;
  /** Tentativas já realizadas. */
  attempts: number;
}

/**
 * Documento coalescido por chain, persistido em `state:{chain}`.
 * Agrupa checkpoint e pendências para eliminar `list()` e reads por chave.
 */
export interface ChainState {
  /** Último bloco/ledger/signature processado (string: seguro para bigint). */
  checkpoint: string;
  /** Queries aguardando `executeAfter` ou retry, indexadas por `queryId`. */
  pending: Record<string, PendingQuery>;
}

/**
 * Documento carregado em um tick — `state` é mutável em memória e
 * `flushChainState` decide ao fim do tick se vale uma escrita KV.
 */
export interface LoadedChainState {
  /** Documento mutável deste tick (checkpoint + pendentes). */
  state: ChainState;
  /** Checkpoint efetivo: máximo entre o persistido e o high-water do isolate. */
  checkpoint: bigint;
  /** Checkpoint lido do KV neste load — base da decisão de persistência. */
  persistedCheckpoint: bigint;
  /** `true` quando `state` mudou e merece escrita imediata no flush. */
  dirty: boolean;
}

const MAX_ATTEMPTS = 3;

/**
 * Intervalo mínimo entre escritas de checkpoint quando nada mais mudou.
 * 15 min → ~96 writes/dia/chain em idle, dentro do limite Free (1.000/dia).
 * Em cold start o tick seguinte reescaneia a partir do último checkpoint
 * persistido — seguro porque `isProcessed` deduplica e o range de polling é
 * limitado por `ORACLE_POLL_MAX_BLOCK_RANGE`.
 */
export const CHECKPOINT_PERSIST_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Idade máxima de uma pendência (7d) — substitui o `expirationTtl` por chave
 * do layout anterior; entradas vencidas são descartadas no load.
 */
const PENDING_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * KV em memória — fallback de testnet quando o binding `ORACLE_STATE` não está
 * provisionado (token sem escopo de KV). Persistência limitada ao tempo de vida
 * do isolate; não usar em produção (ver docs/runbook-deploy.md).
 */
class MemoryKV {
  private store = new Map<string, { v: string; exp: number }>();

  private alive(k: string): boolean {
    const e = this.store.get(k);
    if (e && e.exp > 0 && e.exp < Date.now()) { this.store.delete(k); return false; }
    return !!e;
  }

  async get(key: string, type?: string): Promise<unknown> {
    if (!this.alive(key)) return null;
    const v = this.store.get(key)!.v;
    return type === "json" ? JSON.parse(v) : v;
  }

  async put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> {
    this.store.set(key, { v: value, exp: opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : 0 });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(opts?: { prefix?: string; cursor?: string }): Promise<KVNamespaceListResult<unknown>> {
    const keys = [...this.store.keys()].filter((k) => this.alive(k) && (!opts?.prefix || k.startsWith(opts.prefix)));
    return { keys: keys.map((name) => ({ name })), list_complete: true, cacheStatus: null } as unknown as KVNamespaceListResult<unknown>;
  }
}

const memoryState = new MemoryKV();
let memWarned = false;

/** High-water mark de checkpoint por chain — sobrevive dentro do isolate. */
const memCheckpoint = new Map<string, bigint>();

/** Timestamp da última escrita do documento por chain (por isolate). */
const lastPersistAt = new Map<string, number>();

/**
 * Retorna o store efetivo: KV `ORACLE_STATE` quando o binding existe,
 * `MemoryKV` (por isolate) como fallback. Loga warning uma única vez.
 */
export function stateStore(env: { ORACLE_STATE?: KVNamespace }): KVNamespace {
  if (env.ORACLE_STATE) return env.ORACLE_STATE;
  if (!memWarned) {
    memWarned = true;
    console.warn(JSON.stringify({ level: "warn", msg: "ORACLE_STATE binding ausente — usando MemoryKV por isolate (somente testnet)", component: "stateStore" }));
  }
  return memoryState as unknown as KVNamespace;
}

export function stateKey(chain: string): string {
  return `state:${chain}`;
}

/** Chave do layout anterior — lida apenas quando `state:{chain}` não existe. */
export function legacyCheckpointKey(chain: string): string {
  return `${chain}:checkpoint`;
}

export function processedKey(chain: string, queryId: string): string {
  return `${chain}:processed:${queryId}`;
}

/**
 * Carrega o documento `state:{chain}` (1 leitura KV por tick/chain).
 * Quando ausente, faz fallback para o checkpoint legado `{chain}:checkpoint`
 * (+1 leitura, somente até a primeira persistência) e descarta pendências
 * vencidas (>7d). O checkpoint retornado é o máximo entre o persistido e o
 * high-water mark em memória — evita regressão entre ticks sem escrita.
 */
export async function loadChainState(kv: KVNamespace, chain: string): Promise<LoadedChainState> {
  const doc = (await kv.get(stateKey(chain), "json")) as ChainState | null;
  let checkpoint = doc?.checkpoint;
  if (!doc) {
    checkpoint = (await kv.get(legacyCheckpointKey(chain))) ?? "0";
  }
  const now = Date.now();
  const pending: Record<string, PendingQuery> = {};
  for (const [qid, q] of Object.entries(doc?.pending ?? {})) {
    if (q.executeAfter * 1000 >= now - PENDING_STALE_AFTER_MS) pending[qid] = q;
  }
  const persisted = BigInt(checkpoint ?? "0");
  const mem = memCheckpoint.get(chain) ?? 0n;
  return {
    state: { checkpoint: persisted.toString(), pending },
    checkpoint: mem > persisted ? mem : persisted,
    persistedCheckpoint: persisted,
    dirty: false,
  };
}

/** Registra o checkpoint recém-observado (memória + documento do tick). */
export function noteCheckpoint(loaded: LoadedChainState, value: bigint): void {
  if (value > loaded.checkpoint) {
    loaded.checkpoint = value;
    loaded.state.checkpoint = value.toString();
  }
}

/**
 * Persiste `state:{chain}` somente quando necessário: `dirty` (pendências ou
 * conteúdo mudou) ou checkpoint avançou além do persistido e o intervalo
 * mínimo de escrita venceu. O high-water mark do isolate é atualizado sempre.
 * @returns `true` quando uma escrita KV foi emitida.
 */
export async function flushChainState(kv: KVNamespace, chain: string, loaded: LoadedChainState): Promise<boolean> {
  memCheckpoint.set(chain, loaded.checkpoint);
  const intervalElapsed = Date.now() - (lastPersistAt.get(chain) ?? 0) >= CHECKPOINT_PERSIST_INTERVAL_MS;
  const checkpointAhead = loaded.checkpoint > loaded.persistedCheckpoint;
  if (!loaded.dirty && !(intervalElapsed && checkpointAhead)) return false;
  await kv.put(stateKey(chain), JSON.stringify(loaded.state));
  lastPersistAt.set(chain, Date.now());
  return true;
}

export async function isProcessed(kv: KVNamespace, chain: string, queryId: string): Promise<boolean> {
  return (await kv.get(processedKey(chain, queryId))) !== null;
}

/**
 * Grava o marcador de dedupe `{chain}:processed:{qid}` — "done" (30d),
 * "failed:{attempts}" (30d na última tentativa, 1d nas anteriores). A saída
 * da pendência não usa `delete`: é resolvida na regravação do documento.
 */
export async function markProcessed(kv: KVNamespace, chain: string, queryId: string, ok: boolean, attempts: number): Promise<void> {
  const key = processedKey(chain, queryId);
  if (ok || attempts >= MAX_ATTEMPTS) {
    await kv.put(key, ok ? "done" : `failed:${attempts}`, { expirationTtl: 60 * 60 * 24 * 30 });
    return;
  }
  await kv.put(key, `failed:${attempts}`, { expirationTtl: 60 * 60 * 24 });
}

export { MAX_ATTEMPTS };
