![header](https://capsule-render.vercel.app/api?type=waving&color=gradient&height=200&section=header&text=API%20do%20Worker&fontSize=36&fontAlignY=35&animation=twinkling)

![visitors](https://visitor-badge.laobi.icu/badge?page_id=RapportTecnologia.rapport_oracle_middleware.docs_api)
[![License: CC BY-SA 4.0](https://img.shields.io/badge/License-CC_BY--SA_4.0-blue.svg)](https://creativecommons.org/licenses/by-sa/4.0/)
![Status](https://img.shields.io/badge/Status-Ongoing-yellow)

# API — Rapport Oracle Middleware

Endpoints HTTP do Worker. Respostas seguem o padrão
`{code, message, details, next_step}` — autenticação: nenhuma (observabilidade
pública; rotas de escrita não existem). Uso por humano e por agentes.

## GET /health

Liveness do Worker.

**Response 200**
```json
{
  "code": "OK",
  "message": "rapport-oracle-middleware operacional",
  "details": { "chains": ["evm"] },
  "next_step": "Consulte /status para checkpoints e pendências."
}
```

## GET /status

Estado operacional por chain: checkpoint processado e queries pendentes.

**Response 200**
```json
{
  "code": "OK",
  "message": "estado do middleware",
  "details": {
    "chains": [{ "chain": "evm:80002", "checkpoint": "52326000", "pending": 1 }],
    "updatedAt": "2026-11-08T15:00:00.000Z"
  },
  "next_step": "Aguarde o próximo tick do cron (1min) ou verifique logs."
}
```

## Erros

| Code | HTTP | Significado |
|---|---|---|
| `NOT_FOUND` | 404 | rota inexistente — `next_step` indica as válidas |
| `INTERNAL` | 500 | falha interna — `details.error` (sanitizado) |

## Changelog

| Data | Versão | Descrição |
|---|---|---|
| 2026-11-08 | 0.1.0 | Documentação inicial |

![footer](https://capsule-render.vercel.app/api?type=waving&color=gradient&height=100&section=footer&animation=twinkling)
