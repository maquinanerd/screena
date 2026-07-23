import { NextResponse } from "next/server";

import { getAppVersion } from "../../../src/lib/app-version";
import { checkDatabase } from "../../../src/server/health";

/**
 * GET /api/health — health check da imagem/servidor (baseline R-27/observabilidade).
 *
 * Usado pelo `HEALTHCHECK` do container e por monitoramento externo. Reporta:
 *  - liveness: o processo respondeu;
 *  - readiness: o PostgreSQL respondeu a um `SELECT 1` (o app não serve página
 *    sem banco, então a saúde real inclui a conexão de dados);
 *  - versão rastreável (commit/version/builtAt) da imagem em execução.
 *
 * PUREZA (invariantes 3 e 4): lê APENAS PostgreSQL local — nenhuma API externa,
 * nenhum Gemini. Não é indexável (é `/api/*`, fora do matcher do middleware) e
 * nunca entra em sitemap.
 *
 * Status: 200 quando o banco responde; 503 quando não — para o orquestrador
 * despromover o container em vez de mandar tráfego a um app sem banco.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const version = getAppVersion();
  const startedAt = Date.now();

  const dbOk = await checkDatabase();
  const database: "ok" | "error" = dbOk ? "ok" : "error";
  const healthy = dbOk;
  const body = {
    status: healthy ? "ok" : "degraded",
    database,
    checkDurationMs: Date.now() - startedAt,
    version,
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(body, {
    status: healthy ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
