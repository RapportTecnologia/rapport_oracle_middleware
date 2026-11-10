![header](https://capsule-render.vercel.app/api?type=waving&color=gradient&height=200&section=header&text=Arquitetura%20Middleware&fontSize=36&fontAlignY=35&animation=twinkling)

![visitors](https://visitor-badge.laobi.icu/badge?page_id=RapportTecnologia.rapport_oracle_middleware.docs_arquitetura)
[![License: CC BY-SA 4.0](https://img.shields.io/badge/License-CC_BY--SA_4.0-blue.svg)](https://creativecommons.org/licenses/by-sa/4.0/)
![Status](https://img.shields.io/badge/Status-Ongoing-yellow)

# Arquitetura — Rapport Oracle Middleware

Worker Cloudflare que intermedeia requisições de oracle entre contratos
consumidores (EVM/Solana/Stellar) e fontes de dados externas, no modelo
Oraclize/Provable.

## Ciclo de vida de uma query

```
[Consumidor] --query--> [Conector on-chain] --LogNewQuery/evento--> [Worker cron]
     ^                                                              |
     |                                                              v
     |                                                    fetch URL + extrai path
     |                                                              |
     +------------------- __callback(rqid, result, proof) <----------+
                          (tx assinada pelo relayer/cbAddress)
```

## Componentes

| Módulo | Papel |
|---|---|
| `src/index.ts` | `scheduled` (cron `* * * * *`) + `fetch` (`/health`, `/status`) |
| `src/chains/` | Adapters por chain (interface `OracleChain` + Factory) |
| `src/services/orchestrator.ts` | Ciclo: coleta→agenda→resolve→callback→checkpoint |
| `src/services/resolver.ts` | DSL `json(url).path` + fetch com size cap/timeout |
| `src/services/proof.ts` | Prova ECDSA (EVM) / ed25519 (Solana, Stellar) |
| `src/services/state.ts` | KV `ORACLE_STATE`: doc `state:{chain}` (checkpoint+pending) + marcadores `processed` |

## Decisões

- **Cron 1 min** — Workers não mantêm WebSocket de escuta; polling de logs
  (`eth_getLogs`, `getEvents`, `getProgramAccounts`). `delay` é honrado com
  granularidade de ~1 min (upgrade futuro: Durable Object + alarm).
- **KV** para deduplicação e agendamento — suficiente na v1. Estado
  coalescido por chain em `state:{chain}` (1 leitura/tick, 1 escrita só em
  mudança, sem `list`/`delete` no hot path) e checkpoint persistido com
  throttle de 15 min — orçamento compatível com o plano Free
  (issue #10). Dedupe durável em `{chain}:processed:{qid}` (TTL 1–30d).
- **Callback direto ao consumidor** (modelo Provable): o relayer chama
  `__callback` e o consumidor valida `cbAddress` on-chain.
- **Proof v1** = assinatura do relayer sobre `keccak256(qid,result,consumer)`
  — verificável via `RapportOracle.verifyProof`.

## Limites v1

- Datasource `"URL"` apenas; até 3 tentativas por query.
- Sem TLSNotary/zk proof (roadmap).

## Changelog

| Data | Versão | Descrição |
|---|---|---|
| 2026-11-08 | 0.1.0 | Documentação inicial |
| 2026-11-10 | 0.1.1 | Estado KV coalescido + throttling de checkpoint (plano Free) |

![footer](https://capsule-render.vercel.app/api?type=waving&color=gradient&height=100&section=footer&animation=twinkling)
