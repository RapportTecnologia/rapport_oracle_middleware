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
