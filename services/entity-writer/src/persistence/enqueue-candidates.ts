/**
 * enqueue-candidates.ts — Adapter Prisma de DESCOBERTA de candidatos. COBERTO pelo
 * typecheck da raiz (`pnpm typecheck`).
 *
 * Implementa `EnqueueCandidateSourcePort` (Fase 3B.5): lista ids de entidades-raiz
 * (`movies`/`tv_shows`) por tipo, ordenados por `id ASC`, paginando por cursor
 * (`afterId` -> `id > afterId`). NAO decide nada sobre faltante/up-to-date — isso
 * fica no planner via `enqueueOne`. Le SO do banco; nunca cria job, nunca chama
 * Gemini. So usa campos reais do schema; nenhuma migration.
 *
 * `person`/`season`/`episode` nao sao suportados nesta fase: o metodo lanca erro
 * controlado (o orquestrador ja barra esses tipos antes de chegar aqui).
 */

import type { PrismaClient } from "@screena/db/server";
import type { EnqueueCandidateQuery, EnqueueCandidateSourcePort } from "../ports.js";

/** Teto rigido de pagina (defesa contra varredura acidental gigante). */
const MAX_PAGE = 200;

/** Cria um `EnqueueCandidateSourcePort` apoiado no Prisma (cursor id ASC). */
export function createPrismaEnqueueCandidateSource(prisma: PrismaClient): EnqueueCandidateSourcePort {
  return {
    async findCandidates(query: EnqueueCandidateQuery): Promise<readonly string[]> {
      const take = Math.min(Math.max(Math.floor(query.limit), 1), MAX_PAGE);
      const where = query.afterId !== undefined ? { id: { gt: BigInt(query.afterId) } } : {};

      if (query.entityType === "movie") {
        const rows = await prisma.movie.findMany({ where, orderBy: { id: "asc" }, take, select: { id: true } });
        return rows.map((row) => row.id.toString());
      }
      if (query.entityType === "tv") {
        const rows = await prisma.tvShow.findMany({ where, orderBy: { id: "asc" }, take, select: { id: true } });
        return rows.map((row) => row.id.toString());
      }
      throw new Error(
        `descoberta de candidatos nao suportada para entityType=${query.entityType} (so movie/tv nesta fase).`,
      );
    },
  };
}
