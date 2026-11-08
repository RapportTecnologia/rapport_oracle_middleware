/**
 * Adapter EVM do Rapport Oracle (Polygon Amoy/mainnet e compatíveis).
 *
 * @file Lê `LogNewQuery` do conector via eth_getLogs paginado e envia
 *       `__callback(queryId, result, proof)` ao consumidor assinado pelo
 *       relayer — o cbAddress configurado no conector.
 * @author Carlos Delfino <consultoria@carlosdelfino.eti.br>
 */
import {
  createPublicClient,
  createWalletClient,
  fallback,
  http,
  parseAbiItem,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygonAmoy, polygon } from "viem/chains";
import type { ChainAdapter, Env } from "./OracleChain";
import type { PendingQuery } from "../services/state";
import { signEvmProof } from "../services/proof";
import { logger } from "../utils/logger";

const FILE = "chains/evm.ts";

const LOG_NEW_QUERY = parseAbiItem(
  "event LogNewQuery(bytes32 indexed queryId, address indexed sender, uint256 delay, uint256 executeAfter, string datasource, string[] args)"
);

const CALLBACK_ABI: Abi = [
  {
    type: "function",
    name: "__callback",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_queryId", type: "bytes32" },
      { name: "_result", type: "string" },
      { name: "_proof", type: "bytes" },
    ],
    outputs: [],
  },
];

function viemChain(chainId: number) {
  if (chainId === 80002) return polygonAmoy;
  if (chainId === 137) return polygon;
  return { id: chainId, name: `chain-${chainId}`, nativeCurrency: { name: "N", symbol: "N", decimals: 18 }, rpcUrls: { default: { http: [] } } } as never;
}

/**
 * Factory do adapter EVM — um por chainId habilitado.
 * @param env Variáveis do Worker.
 */
export function createEvmAdapter(env: Env): ChainAdapter | null {
  const chainId = Number(env.EVM_CHAIN_ID ?? "80002");
  const connector = env.EVM_RAPPORT_ORACLE_ADDRESS as Address | undefined;
  const relayerKey = env.EVM_RELAYER_PRIVATE_KEY as Hex | undefined;
  const rpc = env.POLYGON_AMOY_RPC_URL;
  const rpcFallback = env.POLYGON_AMOY_RPC_URL_FALLBACK;
  if (!connector || !relayerKey || !rpc) {
    logger.warn(FILE, "adapter EVM desabilitado — config ausente", {
      connector: !!connector,
      relayerKey: !!relayerKey,
      rpc: !!rpc,
    });
    return null;
  }
  const id = `evm:${chainId}`;
  const chain = viemChain(chainId);
  // Fallback automático: drpc free rejeita eth_getLogs — o publicnode assume.
  const transports = rpcFallback ? fallback([http(rpc), http(rpcFallback)]) : http(rpc);
  const publicClient = createPublicClient({ chain, transport: transports });
  const account = privateKeyToAccount(relayerKey);
  const walletClient = createWalletClient({ account, chain, transport: transports });
  const maxRange = BigInt(env.ORACLE_POLL_MAX_BLOCK_RANGE ?? "5000");

  return {
    id,

    async fetchPending(_env: Env, fromCheckpoint: bigint) {
      const latest = await publicClient.getBlockNumber();
      const from = fromCheckpoint > 0n ? fromCheckpoint + 1n : latest > maxRange ? latest - maxRange : 0n;
      const to = from + maxRange < latest ? from + maxRange : latest;
      if (from > latest) return { queries: [], newCheckpoint: fromCheckpoint };

      const logs = await publicClient.getLogs({
        address: connector,
        event: LOG_NEW_QUERY,
        fromBlock: from,
        toBlock: to,
      });
      const queries: PendingQuery[] = logs.map((l) => ({
        chain: id,
        queryId: l.args.queryId as string,
        consumer: l.args.sender as string,
        datasource: l.args.datasource as string,
        args: [...(l.args.args as string[])],
        executeAfter: Number(l.args.executeAfter),
        attempts: 0,
      }));
      return { queries, newCheckpoint: to };
    },

    async sendCallback(_env: Env, query: PendingQuery, result: string) {
      const proof = await signEvmProof(relayerKey, query.queryId as Hex, result, query.consumer as Hex);
      const hash = await walletClient.writeContract({
        address: query.consumer as Address,
        abi: CALLBACK_ABI,
        functionName: "__callback",
        args: [query.queryId as Hex, result, proof],
        account,
        chain,
      });
      logger.info(FILE, "callback enviado", { chain: id, queryId: query.queryId.slice(0, 18), tx: hash });
      return hash;
    },
  };
}
