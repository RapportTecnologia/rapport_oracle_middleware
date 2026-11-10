![header](https://capsule-render.vercel.app/api?type=waving&color=gradient&height=200&section=header&text=Requirements&fontSize=36&fontAlignY=35&animation=twinkling)

![visitors](https://visitor-badge.laobi.icu/badge?page_id=RapportTecnologia.rapport_oracle_middleware.docs_requirements)
[![License: CC BY-SA 4.0](https://img.shields.io/badge/License-CC_BY--SA_4.0-blue.svg)](https://creativecommons.org/licenses/by-sa/4.0/)
![Status](https://img.shields.io/badge/Status-Ongoing-yellow)

# REQUIREMENTS — Rapport Oracle Middleware

Fonte viva de requisitos do subprojeto `middleware`.

## Requisitos funcionais

| ID | Requisito | Status | Teste |
|---|---|---|---|
| REQ-MW-01 | Parse da DSL `json(url).path` e URL crua | ✅ | `jsonpath.test.ts` |
| REQ-MW-02 | Resolução de JSON path com índices/erros claros | ✅ | idem |
| REQ-MW-03 | Serialização de resultados para `__callback` | ✅ | idem |
| REQ-MW-04 | Adapter EVM: `getLogs` + `__callback` assinado pelo relayer | ✅ | implementado |
| REQ-MW-05 | Adapters Solana/Stellar funcionais (MVP) | ✅ | implementado (teste devnet/testnet) |
| REQ-MW-06 | Agendamento por `executeAfter` + dedupe + 3 retries | ✅ | `state.test.ts`, `state.ts`, `orchestrator.ts` |
| REQ-MW-10 | Estado KV cabe no plano Free (≤1k writes/deletes/lists/dia por chain) | ✅ | `state.test.ts` |
| REQ-MW-07 | Proof assinado (ECDSA EVM / ed25519) | ✅ | `proof.ts` |
| REQ-MW-08 | `/health` e `/status` com `next_step` | ✅ | `index.ts` |
| REQ-MW-09 | Deploy via CLI `cf` + cron + KV | ⏳ | `cloudflare.config.ts` pronto (deploy manual) |

## Não funcionais

- Cron `* * * * *` (granularidade 1 min); delay de query aproximado.
- Fetch de URL com timeout e size cap — nunca buffer ilimitado.
- Logs JSON estruturados; nunca logar segredos/payloads completos.
- Segredos só em `.dev.vars`/`secrets` — nunca em config versionada.
- Orçamento KV Free: 1 leitura `state:{chain}` por tick/chain; escrita apenas
  em mudança ou checkpoint >15 min; sem `list`/`delete` no hot path
  (issue #10).

## Changelog

| Data | Versão | Descrição |
|---|---|---|
| 2026-11-08 | 0.1.0 | Requisitos iniciais |
| 2026-11-10 | 0.1.1 | REQ-MW-10: orçamento de operações KV do plano Free |

![footer](https://capsule-render.vercel.app/api?type=waving&color=gradient&height=100&section=footer&animation=twinkling)
