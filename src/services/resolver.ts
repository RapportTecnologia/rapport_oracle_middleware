/**
 * Resolvedor de datasource do Rapport Oracle.
 *
 * @file Executa o fetch da URL (com timeout e size cap — nunca bufferiza
 *       corpos ilimitados) e extrai o resultado via jsonpath. Datasource v1:
 *       "URL" (`json(url).path` ou URL crua).
 * @author Carlos Delfino <consultoria@carlosdelfino.eti.br>
 */
import { parseDatasourceArg, resolveJsonPath, resultToString } from "./jsonpath";
import { logger } from "../utils/logger";

const FILE = "resolver.ts";

/**
 * Lê um `Response` com limite de bytes — streaming sem buffer ilimitado.
 * @param res Resposta do fetch.
 * @param maxBytes Teto de bytes aceitos (HTTP_FETCH_MAX_BYTES).
 */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel("size cap exceeded");
      throw new Error(`resposta excede ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/**
 * Resolve um argumento de query e devolve o resultado como string.
 *
 * @param datasource Fonte declarada na query ("URL").
 * @param arg Argumento (ex.: "json(https://...).USD").
 * @param env Variáveis do Worker (timeout/size cap configuráveis).
 * @returns Resultado serializado para `__callback`.
 */
export async function resolveQuery(datasource: string, arg: string, env: {
  HTTP_FETCH_TIMEOUT_MS?: string;
  HTTP_FETCH_MAX_BYTES?: string;
}): Promise<string> {
  if (datasource !== "URL") {
    throw new Error(`datasource não implementado na v1: ${datasource}`);
  }
  const { url, jsonPath } = parseDatasourceArg(arg);
  const timeout = Number(env.HTTP_FETCH_TIMEOUT_MS ?? "15000");
  const maxBytes = Number(env.HTTP_FETCH_MAX_BYTES ?? "1048576");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort("timeout"), timeout);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": "rapport-oracle/0.1", accept: "application/json,text/plain,*/*" },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
    const body = await readCapped(res, maxBytes);
    if (jsonPath === null) {
      logger.debug(FILE, "datasource resolvido (corpo cru)", { url: redact(url), bytes: body.length });
      return body.trim();
    }
    const doc = JSON.parse(body);
    const value = resolveJsonPath(doc, jsonPath);
    const out = resultToString(value);
    logger.info(FILE, "datasource resolvido", { url: redact(url), path: jsonPath.join("."), out: out.slice(0, 64) });
    return out;
  } finally {
    clearTimeout(timer);
  }
}

/** Reduz a URL para host+path curtos em logs (query strings podem ter tokens). */
function redact(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname.slice(0, 48)}`;
  } catch {
    return url.slice(0, 48);
  }
}
