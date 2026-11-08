/**
 * Interface comum dos adapters de chain (Strategy/Factory por regras de
 * arquitetura — cada chain especializa a mesma abstração).
 *
 * @file Um adapter conecta um conector on-chain ao orquestrador:
 *       `fetchPending` lê novas queries não processadas e `sendCallback`
 *       entrega `__callback(queryId, result, proof)` ao consumidor.
 * @author Carlos Delfino <consultoria@carlosdelfino.eti.br>
 */
import type { PendingQuery } from "../services/state";

/** Configuração mínima por chain (lida de env/dev.vars). */
export interface ChainAdapter {
  /** Identificador único usado nas chaves KV (ex.: "evm:80002"). */
  readonly id: string;
  /**
   * Lê queries novas/ainda não processadas desde o checkpoint e devolve
   * `{ queries, newCheckpoint }` — o checkpoint só avança quando gravado
   * pelo orquestrador.
   */
  fetchPending(env: Env, fromCheckpoint: bigint): Promise<{ queries: PendingQuery[]; newCheckpoint: bigint }>;
  /**
   * Envia `__callback` ao consumidor. Deve lançar em falha de rede/tx.
   * @returns identificador da tx (hash/signature) para logs.
   */
  sendCallback(env: Env, query: PendingQuery, result: string): Promise<string>;
  /** Marca a query como concluída no conector (best-effort). */
  markComplete?(env: Env, query: PendingQuery): Promise<void>;
  /** Marca a query como falha no conector (best-effort). */
  markFailed?(env: Env, query: PendingQuery): Promise<void>;
}

/** Variáveis de ambiente esperadas pelo Worker (bindings + vars + secrets). */
export interface Env {
  ORACLE_STATE?: KVNamespace;
  CHAINS_ENABLED?: string;
  EVM_CHAIN_ID?: string;
  EVM_RAPPORT_ORACLE_ADDRESS?: string;
  EVM_RELAYER_PRIVATE_KEY?: string;
  POLYGON_AMOY_RPC_URL?: string;
  POLYGON_AMOY_RPC_URL_FALLBACK?: string;
  SOLANA_RAPPORT_ORACLE_PROGRAM_ID?: string;
  SOLANA_RELAYER_SECRET_KEY?: string;
  SOLANA_RPC_URL?: string;
  STELLAR_RAPPORT_ORACLE_CONTRACT_ID?: string;
  STELLAR_RELAYER_SECRET?: string;
  STELLAR_RPC_URL?: string;
  STELLAR_NETWORK_PASSPHRASE?: string;
  ORACLE_POLL_MAX_BLOCK_RANGE?: string;
  HTTP_FETCH_MAX_BYTES?: string;
  HTTP_FETCH_TIMEOUT_MS?: string;
  /** Token do endpoint de diagnóstico `/run` (secret, nunca em vars). */
  DEBUG_TOKEN?: string;
}
