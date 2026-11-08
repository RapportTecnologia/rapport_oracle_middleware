/**
 * Produção de provas (assinaturas) do relayer sobre os resultados.
 *
 * @file EVM: ECDSA `signMessage` sobre keccak256(queryId, result, consumer) —
 *       compatível com `RapportOracle.verifyProof`. Solana/Stellar: ed25519
 *       do relayer sobre a mesma mensagem.
 * @author Carlos Delfino <consultoria@carlosdelfino.eti.br>
 */
import { keccak256, encodePacked, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import nacl from "tweetnacl";

/**
 * Gera a prova EVM para `(queryId, result, consumer)`.
 *
 * @param relayerKey Chave privada do relayer (cbAddress), formato 0x…
 * @param queryId rqid bytes32.
 * @param result Resultado entregue ao consumidor.
 * @param consumer Endereço do contrato consumidor.
 * @returns Assinatura hex de 65 bytes (r||s||v).
 */
export async function signEvmProof(
  relayerKey: Hex,
  queryId: Hex,
  result: string,
  consumer: Hex
): Promise<Hex> {
  const account = privateKeyToAccount(relayerKey);
  const digest = keccak256(encodePacked(["bytes32", "string", "address"], [queryId, result, consumer]));
  return account.signMessage({ message: { raw: digest } });
}

/**
 * Gera a prova ed25519 (Solana/Stellar) sobre `(queryId || result || consumer)`.
 *
 * @param secretKey Chave privada ed25519 (64 bytes).
 * @param queryId rqid 32 bytes.
 * @param result Resultado entregue.
 * @param consumer Identificador do consumidor (program id / contract id bytes).
 * @returns Assinatura de 64 bytes.
 */
export function signEd25519Proof(
  secretKey: Uint8Array,
  queryId: Uint8Array,
  result: string,
  consumer: Uint8Array
): Uint8Array {
  const msg = new Uint8Array(queryId.length + result.length + consumer.length);
  msg.set(queryId, 0);
  msg.set(new TextEncoder().encode(result), queryId.length);
  msg.set(consumer, queryId.length + result.length);
  return nacl.sign.detached(msg, secretKey);
}
