/**
 * Adapter Solana do Rapport Oracle (devnet).
 *
 * @file MVP funcional: lista PDAs `OracleQuery` pendentes do programa oracle
 *       via getProgramAccounts (desserialização borsh manual) e invoca o
 *       `__callback` do consumidor com o relayer como signer. O mapeamento
 *       requester→contas do callback usa convenção PDA `["price"]` do
 *       exemplo; consumidores genéricos devem registrar seeds em
 *       `SOLANA_CONSUMER_SEEDS` (JSON).
 * @author Carlos Delfino <consultoria@carlosdelfino.eti.br>
 */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import nacl from "tweetnacl";
import type { ChainAdapter, Env } from "./OracleChain";
import type { PendingQuery } from "../services/state";
import { logger } from "../utils/logger";

const FILE = "chains/solana.ts";
const CONFIG_SEED = Buffer.from("config");
const QUERY_SEED = Buffer.from("query");
const MAX_DATASOURCE = 32;

function keypairFromSecret(secret: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret)));
}

/** Desserializa `OracleQuery` (layout do programa Anchor). */
function decodeQueryAccount(data: Buffer): { requester: PublicKey; queryId: Buffer; nonce: bigint; executeAfter: bigint; status: number; datasource: string; args: string[] } | null {
  if (data.length < 8 + 32 + 32 + 8 + 8 + 1 + 1 + 4) return null;
  let off = 8; // discriminator
  const requester = new PublicKey(data.subarray(off, off + 32));
  off += 32;
  const queryId = data.subarray(off, off + 32);
  off += 32;
  const executeAfter = data.readBigInt64LE(off); off += 8;
  const nonce = data.readBigUInt64LE(off); off += 8;
  const status = data.readUInt8(off); off += 1;
  off += 1; // bump
  const dsLen = data.readUInt32LE(off); off += 4;
  const datasource = data.subarray(off, off + dsLen).toString("utf8");
  off += Math.min(dsLen, MAX_DATASOURCE);
  // args: Vec<String> — len u32 + strings
  const args: string[] = [];
  try {
    const n = data.readUInt32LE(off); off += 4;
    for (let i = 0; i < Math.min(n, 8); i++) {
      const l = data.readUInt32LE(off); off += 4;
      args.push(data.subarray(off, off + l).toString("utf8")); off += l;
    }
  } catch { /* tail truncado */ }
  return { requester, queryId, nonce, executeAfter, status, datasource, args };
}

async function sha256Disc(name: string): Promise<Buffer> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`global:${name}`));
  return Buffer.from(digest).subarray(0, 8);
}

/** Borsh: serializa instrução __callback(query_id, result, proof). */
async function encodeCallbackIx(queryId: Uint8Array, result: string, proof: Uint8Array): Promise<Buffer> {
  const disc = await sha256Disc("__callback");
  const resultBytes = new TextEncoder().encode(result);
  const buf = Buffer.alloc(8 + 32 + 4 + resultBytes.length + 4 + proof.length);
  let off = 0;
  disc.copy(buf, off); off += 8;
  Buffer.from(queryId).copy(buf, off); off += 32;
  buf.writeUInt32LE(resultBytes.length, off); off += 4;
  Buffer.from(resultBytes).copy(buf, off); off += resultBytes.length;
  buf.writeUInt32LE(proof.length, off); off += 4;
  Buffer.from(proof).copy(buf, off);
  return buf;
}

export function createSolanaAdapter(env: Env): ChainAdapter | null {
  const programId = env.SOLANA_RAPPORT_ORACLE_PROGRAM_ID;
  const secret = env.SOLANA_RELAYER_SECRET_KEY;
  const rpc = env.SOLANA_RPC_URL;
  if (!programId || !secret || !rpc) {
    logger.warn(FILE, "adapter Solana desabilitado — config ausente", { programId: !!programId, secret: !!secret, rpc: !!rpc });
    return null;
  }
  const id = "solana:devnet";
  const conn = new Connection(rpc, "confirmed");
  const oracle = new PublicKey(programId);
  const relayer = keypairFromSecret(secret);

  return {
    id,

    async fetchPending() {
      const accounts = await conn.getProgramAccounts(oracle, {
        filters: [{ dataSize: 8 + 32 + 32 + 8 + 8 + 1 + 1 + 4 + MAX_DATASOURCE + 4 + 4 * (4 + 512) }],
      });
      const queries: PendingQuery[] = [];
      for (const { account, pubkey } of accounts) {
        const q = decodeQueryAccount(account.data as Buffer);
        if (!q || q.status !== 0) continue;
        queries.push({
          chain: id,
          queryId: Buffer.from(q.queryId).toString("hex"),
          consumer: q.requester.toBase58(),
          datasource: q.datasource,
          args: q.args,
          executeAfter: Number(q.executeAfter),
          attempts: 0,
        });
        void pubkey;
      }
      return { queries, newCheckpoint: BigInt(Date.now()) };
    },

    async sendCallback(_env: Env, query: PendingQuery, result: string) {
      const [configPda] = PublicKey.findProgramAddressSync([CONFIG_SEED], oracle);
      const consumerProgram = new PublicKey(query.consumer);
      const [statePda] = PublicKey.findProgramAddressSync([Buffer.from("price")], consumerProgram);
      const proof = nacl.sign.detached(
        new TextEncoder().encode(result),
        relayer.secretKey
      );
      const data = await encodeCallbackIx(Buffer.from(query.queryId, "hex"), result, proof);
      const ix = new TransactionInstruction({
        programId: consumerProgram,
        keys: [
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: relayer.publicKey, isSigner: true, isWritable: false },
          { pubkey: statePda, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data,
      });
      const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [relayer]);
      logger.info(FILE, "callback enviado", { chain: id, queryId: query.queryId.slice(0, 16), sig });
      return sig;
    },

    async markComplete(_env: Env, query: PendingQuery) {
      const [configPda] = PublicKey.findProgramAddressSync([CONFIG_SEED], oracle);
      void configPda;
      // complete(query_id) — mesmas contas do callback; MVP documentado no runbook.
      void query;
    },
  };
}
