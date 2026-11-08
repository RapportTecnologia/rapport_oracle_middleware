/**
 * Entrypoint do Worker Rapport Oracle.
 *
 * @file `scheduled` roda o ciclo de polling do orquestrador a cada minuto;
 *       `fetch` expõe `/status` (observabilidade) e `/health` com respostas
 *       no padrão {code, message, details, next_step}.
 * @author Carlos Delfino <consultoria@carlosdelfino.eti.br>
 */
import type { Env } from "./chains/OracleChain";
import { runCycle } from "./services/orchestrator";
import { listPending, getCheckpoint } from "./services/state";
import { buildAdapters } from "./services/orchestrator";
import { logger } from "./utils/logger";

const FILE = "index.ts";

interface ApiBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  next_step: string;
}

function respond(body: ApiBody, status = 200): Response {
  return Response.json(body, { status });
}

export default {
  /**
   * Tick do cron — processa novas queries e pendentes vencidas.
   * Todo trabalho assíncrono é amarrado ao ctx.waitUntil.
   */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        const summary = await runCycle(env);
        logger.info(FILE, "ciclo concluído", { summary });
      })().catch((err) => logger.error(FILE, "ciclo falhou", { error: (err as Error).message }))
    );
  },

  /** Endpoints HTTP de observabilidade. */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health") {
        return respond({
          code: "OK",
          message: "rapport-oracle-middleware operacional",
          details: { chains: (env.CHAINS_ENABLED ?? "evm").split(",") },
          next_step: "Consulte /status para checkpoints e pendências.",
        });
      }
      if (url.pathname === "/status") {
        const adapters = buildAdapters(env);
        const chains = [];
        for (const a of adapters) {
          chains.push({
            chain: a.id,
            checkpoint: (await getCheckpoint(env.ORACLE_STATE, a.id)).toString(),
            pending: (await listPending(env.ORACLE_STATE, a.id)).length,
          });
        }
        return respond({
          code: "OK",
          message: "estado do middleware",
          details: { chains, updatedAt: new Date().toISOString() },
          next_step: "Aguarde o próximo tick do cron (1min) ou verifique logs com `npx wrangler tail`.",
        });
      }
      return respond(
        {
          code: "NOT_FOUND",
          message: `rota ${url.pathname} não existe`,
          details: { rotas: ["/health", "/status"] },
          next_step: "Use GET /health ou GET /status.",
        },
        404
      );
    } catch (err) {
      return respond(
        {
          code: "INTERNAL",
          message: "falha interna do middleware",
          details: { error: (err as Error).message },
          next_step: "Verifique os logs estruturados do Worker.",
        },
        500
      );
    }
  },
} satisfies ExportedHandler<Env>;
