/**
 * Configuração tipada do Worker Rapport Oracle (CLI `cf`).
 *
 * @file Cron a cada minuto observa os conectores on-chain, resolve datasources
 *       e despacha `__callback`. Estado de checkpoints/pendentes em KV
 *       `ORACLE_STATE`. Segredos via `.dev.vars` (local) ou `cf deploy
 *       --secrets-file` / `npx wrangler secret put` (produção).
 * @author Carlos Delfino <consultoria@carlosdelfino.eti.br>
 */
import { bindings, defineConfig, triggers } from "cf/config";

export default defineConfig({
  worker: {
    // Nome deve casar com o escopo do API token restrito ("midleware" sem o 2º 'd').
    name: "rapport-oracle-midleware",
    entrypoint: "./src/index.ts",
    compatibilityDate: "2026-11-08",
    env: {
      // Namespace "rapport_oracle" provisionado no dashboard (token sem escopo KV).
      ORACLE_STATE: bindings.kv({ id: "9972eb49b5c1450d921c29565c768d0f" }),
      // Não colocar segredos aqui — usar `--secrets-file`/.dev.vars.
      EVM_CHAIN_ID: bindings.text("80002"),
      CHAINS_ENABLED: bindings.text("evm"),
      ORACLE_POLL_MAX_BLOCK_RANGE: bindings.text("5000"),
      HTTP_FETCH_MAX_BYTES: bindings.text("1048576"),
      HTTP_FETCH_TIMEOUT_MS: bindings.text("15000"),
    },
    // Cron: granularidade mínima de 1 minuto no Workers — o `delay` da query é
    // honrado com essa precisão (ver docs/arquitetura.md).
    triggers: [triggers.scheduled({ schedule: "* * * * *" })],
    observability: {
      enabled: true,
      traces: { persist: true },
    },
  },
});
