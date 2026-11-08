/**
 * Logger estruturado do middleware — JSON por linha no padrão das regras.
 *
 * @file Formato: {"ts","file","level","msg",...params} — nunca loga segredos,
 *       payloads privados ou corpos de resposta completos.
 * @author Carlos Delfino <consultoria@carlosdelfino.eti.br>
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

function emit(level: LogLevel, file: string, msg: string, params: Record<string, unknown> = {}) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  const line = JSON.stringify({ ts, file, level, msg, ...params });
  if (level === "error" || level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (file: string, msg: string, params?: Record<string, unknown>) => emit("debug", file, msg, params),
  info: (file: string, msg: string, params?: Record<string, unknown>) => emit("info", file, msg, params),
  warn: (file: string, msg: string, params?: Record<string, unknown>) => emit("warn", file, msg, params),
  error: (file: string, msg: string, params?: Record<string, unknown>) => emit("error", file, msg, params),
};
