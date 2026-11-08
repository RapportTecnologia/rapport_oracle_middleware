/**
 * Configuração tipada do Worker Rapport Oracle (CLI `cf`).
 *
 * @file Cron a cada minuto observa os conectores on-chain, resolve datasources
 *       e despacha `__callback`. Estado de checkpoints/pendentes em KV
 *       `ORACLE_STATE`. Segredos via `.dev.vars` (local) ou `cf deploy
 *       --secrets-file` / `npx wrangler secret put` (produção).
 * @author Carlos Delfino <consultoria@carlosdelfino.eti.br>
 */
const config = {
  // Nome deve casar com o escopo do API token restrito ("midleware" sem o 2º 'd').
  name: "rapport-oracle-midleware",
  main: "src/index.ts",
  compatibility_date: "2026-11-08",
  // Cron: granularidade mínima de 1 minuto no Workers — o `delay` da query é
  // honrado com essa precisão (ver docs/arquitetura.md).
  triggers: {
    crons: ["* * * * *"],
  },
  kv_namespaces: [
    {
      binding: "ORACLE_STATE",
      // `id` provisionado no primeiro `cf deploy` — ver docs/runbook-deploy.md
    },
  ],
  observability: {
    enabled: true,
    traces: { enabled: true, head_sampling_rate: 1 },
  },
  // Não colocar segredos aqui — usar `secrets`/.dev.vars.
  vars: {
    EVM_CHAIN_ID: "80002",
    CHAINS_ENABLED: "evm",
    ORACLE_POLL_MAX_BLOCK_RANGE: "5000",
    HTTP_FETCH_MAX_BYTES: "1048576",
    HTTP_FETCH_TIMEOUT_MS: "15000",
  },
};

export default config;
