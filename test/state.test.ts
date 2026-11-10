/**
 * Testes do documento de estado coalescido e do throttling de escrita KV.
 *
 * @file Issue #10: `state:{chain}` agrupa checkpoint + pendências (1 leitura
 *       por tick, sem `list`/`delete`); `flushChainState` só escreve quando o
 *       documento muda ou o checkpoint vence o intervalo de persistência.
 * @author Carlos Delfino <consultoria@carlosdelfino.eti.br>
 */
import { describe, it, expect } from "vitest";
import {
  loadChainState,
  noteCheckpoint,
  flushChainState,
  isProcessed,
  markProcessed,
  stateKey,
  legacyCheckpointKey,
  processedKey,
  CHECKPOINT_PERSIST_INTERVAL_MS,
  type PendingQuery,
} from "../src/services/state";

/**
 * KV fake em memória que contabiliza operações — prova o orçamento do plano
 * Free e rejeita `list()` para garantir que o hot path não o utiliza.
 */
class FakeKV {
  store = new Map<string, { v: string; exp: number }>();
  gets = 0;
  puts = 0;
  deletes = 0;

  private alive(k: string): boolean {
    const e = this.store.get(k);
    if (e && e.exp > 0 && e.exp < Date.now()) { this.store.delete(k); return false; }
    return !!e;
  }

  async get(k: string, t?: string): Promise<unknown> {
    this.gets++;
    if (!this.alive(k)) return null;
    const v = this.store.get(k)!.v;
    return t === "json" ? JSON.parse(v) : v;
  }

  async put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void> {
    this.puts++;
    this.store.set(k, { v, exp: o?.expirationTtl ? Date.now() + o.expirationTtl * 1000 : 0 });
  }

  async delete(k: string): Promise<void> {
    this.deletes++;
    this.store.delete(k);
  }

  async list(): Promise<never> {
    throw new Error("list() não deve ser usada no hot path (issue #10)");
  }
}

function query(qid: string, executeAfter = 0): PendingQuery {
  return { chain: "t", queryId: qid, consumer: "0xc", datasource: "URL", args: ["https://x"], executeAfter, attempts: 0 };
}

const asKV = (f: FakeKV) => f as unknown as KVNamespace;

describe("loadChainState", () => {
  it("documento ausente retorna checkpoint 0 e pending vazio", async () => {
    const kv = new FakeKV();
    const loaded = await loadChainState(asKV(kv), "t:empty");
    expect(loaded.checkpoint).toBe(0n);
    expect(loaded.state.pending).toEqual({});
    expect(loaded.dirty).toBe(false);
  });

  it("faz fallback para o checkpoint legado quando o documento não existe", async () => {
    const kv = new FakeKV();
    await kv.put(legacyCheckpointKey("t:legacy"), "4242");
    const loaded = await loadChainState(asKV(kv), "t:legacy");
    expect(loaded.checkpoint).toBe(4242n);
    // 2 leituras no cold start: doc ausente + checkpoint legado.
    expect(kv.gets).toBe(2);
  });

  it("descarta pendências vencidas (>7d) e mantém as frescas", async () => {
    const kv = new FakeKV();
    const now = Math.floor(Date.now() / 1000);
    await kv.put(stateKey("t:stale"), JSON.stringify({
      checkpoint: "10",
      pending: {
        old: query("old", now - 8 * 24 * 3600),
        fresh: query("fresh", now - 3600),
      },
    }));
    const loaded = await loadChainState(asKV(kv), "t:stale");
    expect(Object.keys(loaded.state.pending)).toEqual(["fresh"]);
  });
});

describe("noteCheckpoint + flushChainState", () => {
  it("não escreve quando nada mudou e o intervalo não venceu", async () => {
    const kv = new FakeKV();
    const loaded = await loadChainState(asKV(kv), "t:clean");
    // sem noteCheckpoint e sem dirty → nenhuma escrita.
    expect(await flushChainState(asKV(kv), "t:clean", loaded)).toBe(false);
    expect(kv.puts).toBe(0);
  });

  it("persiste o checkpoint avançado na primeira oportunidade e depois throttla", async () => {
    const kv = new FakeKV();
    const chain = "t:throttle";
    const l1 = await loadChainState(asKV(kv), chain);
    noteCheckpoint(l1, 100n);
    expect(await flushChainState(asKV(kv), chain, l1)).toBe(true);
    expect(kv.puts).toBe(1);

    // avanço seguinte dentro do intervalo → atualiza high-water, não escreve.
    const l2 = await loadChainState(asKV(kv), chain);
    noteCheckpoint(l2, 200n);
    expect(await flushChainState(asKV(kv), chain, l2)).toBe(false);
    expect(kv.puts).toBe(1);

    // load seguinte enxerga o high-water mark (200) mesmo com doc em 100.
    const l3 = await loadChainState(asKV(kv), chain);
    expect(l3.persistedCheckpoint).toBe(100n);
    expect(l3.checkpoint).toBe(200n);
    expect(kv.gets).toBeGreaterThan(0);
  });

  it("escreve imediatamente quando o documento está dirty", async () => {
    const kv = new FakeKV();
    const loaded = await loadChainState(asKV(kv), "t:dirty");
    loaded.state.pending["q1"] = query("q1");
    loaded.dirty = true;
    expect(await flushChainState(asKV(kv), "t:dirty", loaded)).toBe(true);
    const doc = await kv.get(stateKey("t:dirty"), "json") as { pending: Record<string, unknown> };
    expect(Object.keys(doc.pending)).toEqual(["q1"]);
  });

  it("CHECKPOINT_PERSIST_INTERVAL_MS mantém idle abaixo do limite Free", () => {
    const writesPorDia = (24 * 60 * 60 * 1000) / CHECKPOINT_PERSIST_INTERVAL_MS;
    expect(writesPorDia).toBeLessThan(1000);
  });
});

describe("isProcessed + markProcessed", () => {
  it("grava marcador done com dedupe e sem delete", async () => {
    const kv = new FakeKV();
    expect(await isProcessed(asKV(kv), "t:m", "q1")).toBe(false);
    await markProcessed(asKV(kv), "t:m", "q1", true, 1);
    expect(await isProcessed(asKV(kv), "t:m", "q1")).toBe(true);
    expect(kv.store.get(processedKey("t:m", "q1"))!.v).toBe("done");
    expect(kv.deletes).toBe(0);
  });

  it("marca failed:N nas tentativas intermediárias e finais", async () => {
    const kv = new FakeKV();
    await markProcessed(asKV(kv), "t:m2", "q2", false, 1);
    expect(kv.store.get(processedKey("t:m2", "q2"))!.v).toBe("failed:1");
    await markProcessed(asKV(kv), "t:m2", "q2", false, 3);
    expect(kv.store.get(processedKey("t:m2", "q2"))!.v).toBe("failed:3");
  });
});
