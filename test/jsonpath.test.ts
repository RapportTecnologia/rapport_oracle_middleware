/**
 * Testes da DSL de datasource e do resolvedor de JSON path.
 *
 * @file REQ-MW-01: parseDatasourceArg aceita "json(url).path" e URL crua.
 *       REQ-MW-02: resolveJsonPath extrai propriedades e índices.
 *       REQ-MW-03: resultToString serializa escalares e objetos.
 * @author Carlos Delfino <consultoria@carlosdelfino.eti.br>
 */
import { describe, it, expect } from "vitest";
import { parseDatasourceArg, parsePath, resolveJsonPath, resultToString } from "../src/services/jsonpath";

describe("parseDatasourceArg", () => {
  it("REQ-MW-01: json(url).path extrai url e path", () => {
    const p = parseDatasourceArg("json(https://api.com/data?a=1).USD");
    expect(p.url).toBe("https://api.com/data?a=1");
    expect(p.jsonPath).toEqual(["USD"]);
  });

  it("REQ-MW-01: json(url).a.b[0] suporta índices", () => {
    const p = parseDatasourceArg("json(https://x.y).a.b[0]");
    expect(p.jsonPath).toEqual(["a", "b", 0]);
  });

  it("REQ-MW-01: URL crua retorna path nulo", () => {
    const p = parseDatasourceArg("https://example.com/raw");
    expect(p.url).toBe("https://example.com/raw");
    expect(p.jsonPath).toBeNull();
  });

  it("REQ-MW-01: datasource inválido lança erro", () => {
    expect(() => parseDatasourceArg("json(https://x")).toThrow();
    expect(() => parseDatasourceArg("json(https://x)USD")).toThrow();
    expect(() => parseDatasourceArg("wolfram(pi)")).toThrow();
  });
});

describe("resolveJsonPath", () => {
  const doc = { ETH: { USD: 3123.45 }, list: [10, 20, 30], nested: { a: { b: { c: "ok" } } } };

  it("REQ-MW-02: extrai propriedade simples", () => {
    expect(resolveJsonPath(doc, ["ETH"])).toEqual({ USD: 3123.45 });
    expect(resolveJsonPath(doc, ["ETH", "USD"])).toBe(3123.45);
  });

  it("REQ-MW-02: extrai índice de array", () => {
    expect(resolveJsonPath(doc, ["list", 1])).toBe(20);
  });

  it("REQ-MW-02: path nulo/vazio retorna o documento", () => {
    expect(resolveJsonPath(doc, null)).toBe(doc);
    expect(resolveJsonPath(doc, [])).toBe(doc);
  });

  it("REQ-MW-02: propriedade ausente lança erro", () => {
    expect(() => resolveJsonPath(doc, ["ETH", "EUR"])).toThrow(/ausente/);
    expect(() => resolveJsonPath(doc, ["list", 9])).toThrow(/fora do array/);
    expect(() => resolveJsonPath(doc, ["ETH", "USD", "deep"])).toThrow(/esperado objeto/);
  });
});

describe("resultToString", () => {
  it("REQ-MW-03: serializa tipos", () => {
    expect(resultToString(3123.45)).toBe("3123.45");
    expect(resultToString("abc")).toBe("abc");
    expect(resultToString(true)).toBe("true");
    expect(resultToString({ a: 1 })).toBe('{"a":1}');
    expect(resultToString(null)).toBe("");
  });
});

describe("parsePath", () => {
  it("segmenta propriedades e índices", () => {
    expect(parsePath("a.b.c")).toEqual(["a", "b", "c"]);
    expect(parsePath("a[0].b[12]")).toEqual(["a", 0, "b", 12]);
  });
});
