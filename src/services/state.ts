/**
 * Estado persistente do middleware em Workers KV (`ORACLE_STATE`).
 *
 * @file Chaves:
 *         `{chain}:checkpoint`        → último bloco/ledger/signature processado
 *         `{chain}:processed:{qid}`   → "done" | "failed:{attempts}"
 *         `pending:{chain}:{qid}`     → JSON de query aguardando execute_after
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

const MAX_ATTEMPTS = 3;

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

  async get(key: string): Promise<string | null> {
    return this.alive(key) ? this.store.get(key)!.v : null;
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

export function checkpointKey(chain: string): string {
  return `${chain}:checkpoint`;
}

export function processedKey(chain: string, queryId: string): string {
  return `${chain}:processed:${queryId}`;
}

export function pendingKey(chain: string, queryId: string): string {
  return `pending:${chain}:${queryId}`;
}

/** Lê o checkpoint numérico da chain (0 quando ausente). */
export async function getCheckpoint(kv: KVNamespace, chain: string): Promise<bigint> {
  const v = await kv.get(checkpointKey(chain));
  return v ? BigInt(v) : 0n;
}

export async function setCheckpoint(kv: KVNamespace, chain: string, value: bigint): Promise<void> {
  await kv.put(checkpointKey(chain), value.toString());
}

export async function isProcessed(kv: KVNamespace, chain: string, queryId: string): Promise<boolean> {
  return (await kv.get(processedKey(chain, queryId))) !== null;
}

export async function markProcessed(kv: KVNamespace, chain: string, queryId: string, ok: boolean, attempts: number): Promise<void> {
  const key = processedKey(chain, queryId);
  if (ok) {
    await kv.put(key, "done", { expirationTtl: 60 * 60 * 24 * 30 });
    await kv.delete(pendingKey(chain, queryId));
    return;
  }
  if (attempts >= MAX_ATTEMPTS) {
    await kv.put(key, `failed:${attempts}`, { expirationTtl: 60 * 60 * 24 * 30 });
    await kv.delete(pendingKey(chain, queryId));
    return;
  }
  await kv.put(key, `failed:${attempts}`, { expirationTtl: 60 * 60 * 24 });
}

export async function putPending(kv: KVNamespace, q: PendingQuery): Promise<void> {
  await kv.put(pendingKey(q.chain, q.queryId), JSON.stringify(q), { expirationTtl: 60 * 60 * 24 * 7 });
}

/** Lista queries pendentes de uma chain (paginação KV completa). */
export async function listPending(kv: KVNamespace, chain: string): Promise<PendingQuery[]> {
  const out: PendingQuery[] = [];
  let cursor: string | undefined;
  do {
    const page: KVNamespaceListResult<unknown> = await kv.list({ prefix: `pending:${chain}:`, cursor });
    for (const k of page.keys) {
      const raw = await kv.get(k.name);
      if (raw) out.push(JSON.parse(raw) as PendingQuery);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

export { MAX_ATTEMPTS };
