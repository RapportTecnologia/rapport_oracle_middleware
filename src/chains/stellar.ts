/**
 * Adapter Stellar do Rapport Oracle (Soroban testnet).
 *
 * @file MVP funcional: lê eventos `query` do contrato conector via
 *       `getEvents` do Soroban RPC e invoca `__callback` no contrato
 *       consumidor assinado pelo relayer (cb_address).
 * @author Carlos Delfino <consultoria@carlosdelfino.eti.br>
 */
import {
  Contract,
  Keypair,
  Networks,
  rpc as SorobanRpc,
  TransactionBuilder,
  BASE_FEE,
  xdr,
  scValToNative,
  nativeToScVal,
  Address,
} from "@stellar/stellar-sdk";
import type { ChainAdapter, Env } from "./OracleChain";
import type { PendingQuery } from "../services/state";
import { logger } from "../utils/logger";

const FILE = "chains/stellar.ts";

export function createStellarAdapter(env: Env): ChainAdapter | null {
  const contractId = env.STELLAR_RAPPORT_ORACLE_CONTRACT_ID;
  const secret = env.STELLAR_RELAYER_SECRET;
  const rpcUrl = env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
  const passphrase = env.STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET;
  if (!contractId || !secret) {
    logger.warn(FILE, "adapter Stellar desabilitado — config ausente", { contractId: !!contractId, secret: !!secret });
    return null;
  }
  const id = "stellar:testnet";
  const server = new SorobanRpc.Server(rpcUrl);
  const relayer = Keypair.fromSecret(secret);

  return {
    id,

    async fetchPending(_env: Env, fromCheckpoint: bigint) {
      const latest = await server.getLatestLedger();
      const startLedger = fromCheckpoint > 0n ? Number(fromCheckpoint) + 1 : Math.max(latest.sequence - 2000, 1);
      const events = await server.getEvents({
        startLedger,
        filters: [{ type: "contract", contractIds: [contractId], topics: [["query", "*", "*"]] }],
        limit: 100,
      });
      const queries: PendingQuery[] = [];
      let maxLedger = BigInt(startLedger);
      for (const e of events.events) {
        // tópicos: ["query", requester, query_id]; valor: (delay, execute_after, datasource, args)
        const topics = e.topic.map((t: xdr.ScVal) => scValToNative(t));
        const value = scValToNative(e.value) as [number, number, string, string[]];
        const queryId = topics[2] as string;
        queries.push({
          chain: id,
          queryId: typeof queryId === "string" ? queryId : Buffer.from(queryId as Uint8Array).toString("hex"),
          consumer: topics[1] as string,
          datasource: value[2],
          args: Array.isArray(value[3]) ? value[3] : [String(value[3])],
          executeAfter: Number(value[1]),
          attempts: 0,
        });
        if (BigInt(e.ledger) > maxLedger) maxLedger = BigInt(e.ledger);
      }
      return { queries, newCheckpoint: BigInt(Math.min(Number(maxLedger), latest.sequence)) };
    },

    async sendCallback(_env: Env, query: PendingQuery, result: string) {
      const source = await server.getAccount(relayer.publicKey());
      const queryIdBytes = Buffer.from(query.queryId, "hex");
      const proof = relayer.sign(Buffer.concat([queryIdBytes, Buffer.from(result, "utf8")]));
      const consumer = new Contract(query.consumer);
      const op = consumer.call(
        "__callback",
        new Address(relayer.publicKey()).toScVal(),
        xdr.ScVal.scvBytes(queryIdBytes),
        nativeToScVal(result, { type: "string" }),
        xdr.ScVal.scvBytes(proof)
      );
      const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: passphrase })
        .addOperation(op)
        .setTimeout(60)
        .build();
      const prepared = await server.prepareTransaction(tx);
      prepared.sign(relayer);
      const resp = await server.sendTransaction(prepared);
      if (resp.status === "ERROR") throw new Error(`stellar callback falhou: ${JSON.stringify(resp.errorResult)}`);
      logger.info(FILE, "callback enviado", { chain: id, queryId: query.queryId.slice(0, 16), hash: resp.hash });
      return resp.hash;
    },
  };
}
