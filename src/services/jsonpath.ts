/**
 * Parser da DSL de datasource e resolvedor de JSON path do Rapport Oracle.
 *
 * @file Formato aceito (modelo Oraclize):
 *         "json(<url>).<path>"   → GET <url> + extrai <path> (ex.: ".USD", ".a.b[0]")
 *         "<url>"                → GET <url> e retorna o corpo cru (texto)
 *       Path: segmentos separados por "." com suporte a índices "[n]".
 * @author Carlos Delfino <consultoria@carlosdelfino.eti.br>
 */

/** Requisição normalizada produzida por {@link parseDatasourceArg}. */
export interface ParsedQuery {
  /** URL a buscar. */
  url: string;
  /** Caminho JSON a extrair ou `null` para corpo cru. */
  jsonPath: Array<string | number> | null;
}

const JSON_PREFIX = "json(";

/**
 * Interpreta o argumento da query no formato `json(url).path` ou URL crua.
 *
 * @param arg Argumento único da query (ex.: "json(https://x/y).USD").
 * @returns URL + path segmentado, ou erro descritivo.
 */
export function parseDatasourceArg(arg: string): ParsedQuery {
  const trimmed = arg.trim();
  if (trimmed.startsWith(JSON_PREFIX)) {
    const close = trimmed.indexOf(")", JSON_PREFIX.length);
    if (close === -1) throw new Error("query malformada: 'json(' sem ')'");
    const url = trimmed.slice(JSON_PREFIX.length, close);
    const rawPath = trimmed.slice(close + 1);
    if (!rawPath.startsWith(".")) throw new Error("query malformada: esperado '.path' após ')'");
    const path = parsePath(rawPath.slice(1));
    return { url, jsonPath: path };
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return { url: trimmed, jsonPath: null };
  }
  throw new Error(`datasource não suportado: "${trimmed.slice(0, 48)}"`);
}

/**
 * Segmenta "a.b[0].c" em ["a","b",0,"c"].
 * @param path Caminho sem o ponto inicial.
 */
export function parsePath(path: string): Array<string | number> {
  if (!path) return [];
  const out: Array<string | number> = [];
  for (const seg of path.split(".")) {
    const m = seg.match(/^([^\[\]]+)((\[\d+\])*)$/);
    if (!m) throw new Error(`segmento de path inválido: "${seg}"`);
    out.push(m[1]);
    const idx = seg.match(/\[(\d+)\]/g) ?? [];
    for (const i of idx) out.push(Number(i.slice(1, -1)));
  }
  return out;
}

/**
 * Extrai `path` de um objeto JSON já parseado.
 * @param data Documento JSON (objeto/array/escalar).
 * @param path Segmentos produzidos por {@link parsePath} ou `null` (retorna o doc).
 * @returns O valor encontrado (escalar ou subárvore).
 * @throws Quando o segmento não existe no documento.
 */
export function resolveJsonPath(data: unknown, path: Array<string | number> | null): unknown {
  if (path === null || path.length === 0) return data;
  let cur: unknown = data;
  for (const seg of path) {
    if (cur === null || cur === undefined) throw new Error(`path quebrado em "${seg}"`);
    if (typeof seg === "number") {
      if (!Array.isArray(cur)) throw new Error(`esperado array antes de [${seg}]`);
      if (seg >= cur.length) throw new Error(`índice [${seg}] fora do array (len=${cur.length})`);
      cur = cur[seg];
    } else {
      if (typeof cur !== "object" || Array.isArray(cur)) throw new Error(`esperado objeto antes de "${seg}"`);
      const obj = cur as Record<string, unknown>;
      if (!(seg in obj)) throw new Error(`propriedade "${seg}" ausente no JSON`);
      cur = obj[seg];
    }
  }
  return cur;
}

/**
 * Serializa o valor resolvido em string para o callback.
 * @dev Escalares viram sua forma textual; objetos/arrays viram JSON compacto.
 */
export function resultToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
