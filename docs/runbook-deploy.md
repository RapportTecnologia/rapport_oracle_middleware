![header](https://capsule-render.vercel.app/api?type=waving&color=gradient&height=200&section=header&text=Runbook%20Deploy&fontSize=36&fontAlignY=35&animation=twinkling)

![visitors](https://visitor-badge.laobi.icu/badge?page_id=RapportTecnologia.rapport_oracle_middleware.docs_runbook)
[![License: CC BY-SA 4.0](https://img.shields.io/badge/License-CC_BY--SA_4.0-blue.svg)](https://creativecommons.org/licenses/by-sa/4.0/)
![Status](https://img.shields.io/badge/Status-Ongoing-yellow)

# Runbook — Deploy do Middleware

## Pré-requisitos

- Node 22+ (`nvm use` respeitando `.nvmrc`).
- `npm install` concluído.
- Credenciais Cloudflare: `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`
  no `.env`/`.dev.vars` (ou `cf auth login` interativo).
- Chaves de relayer nas `.dev.vars` (nunca no código).

## Desenvolvimento local

```bash
npm run dev          # cf dev — simula o Worker com KV local
npm test             # vitest
npm run typecheck    # tsc --noEmit
```

## Deploy

```bash
# 1. Autenticar (uma vez)
npx cf auth login          # ou export CLOUDFLARE_API_TOKEN=...

# 2. Provisionar KV (primeira vez)
npx cf kv namespace create ORACLE_STATE   # anotar o id retornado
#    e preencher em cloudflare.config.ts -> kv_namespaces[].id

# 3. Enviar segredos de produção
npx cf deploy --secrets-file .dev.vars    # ou npx wrangler secret put <NOME> --name rapport-oracle-middleware

# 4. Deploy
npm run deploy             # cf deploy

# 5. Verificar
curl https://rapport-oracle-middleware.<conta>.workers.dev/health
npx wrangler tail rapport-oracle-middleware   # logs em tempo real
```

## Variáveis necessárias (secrets)

`EVM_RELAYER_PRIVATE_KEY`, `EVM_RAPPORT_ORACLE_ADDRESS`,
`POLYGON_AMOY_RPC_URL`, `SOLANA_RELAYER_SECRET_KEY`,
`SOLANA_RAPPORT_ORACLE_PROGRAM_ID`, `SOLANA_RPC_URL`,
`STELLAR_RELAYER_SECRET`, `STELLAR_RAPPORT_ORACLE_CONTRACT_ID`,
`STELLAR_RPC_URL`, `STELLAR_NETWORK_PASSPHRASE`, `CHAINS_ENABLED`.

## Rollback

`npx cf versions list` → `npx wrangler rollback` (o KV e dados não voltam).

## Changelog

| Data | Versão | Descrição |
|---|---|---|
| 2026-11-08 | 0.1.0 | Documentação inicial |

![footer](https://capsule-render.vercel.app/api?type=waving&color=gradient&height=100&section=footer&animation=twinkling)
