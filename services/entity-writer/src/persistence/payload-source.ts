/**
 * payload-source.ts — Adapter Prisma que monta `EntityPayload`. COBERTO pelo typecheck
 * da raiz (`pnpm typecheck`).
 *
 * Monta o payload controlado a partir SO de dados estruturados ja existentes
 * (movies/tv_shows + cast_members/crew_members + people). Fase 3A: suporta
 * `movie` e `tv`; outros tipos lancam erro controlado (o runner bloqueia o job).
 *
 * NAO inclui ratings, streaming, en/es nem nada fora da Fase 3A. `director` e
 * best-effort (primeiro crew com job 'Director'; vazio se nao houver). `title`
 * usa o titulo ORIGINAL (titulos localizados sao i18n, fora desta fase).
 */

import type { PrismaClient } from "@screena/db/server";
import type { BuildPayloadRequest, PayloadSourcePort } from "../ports.js";
import type { CastMember, EntityPayload } from "../types.js";

const DIRECTOR_JOB = "Director";

/** Cria um `PayloadSourcePort` apoiado no Prisma. */
export function createPrismaPayloadSource(prisma: PrismaClient): PayloadSourcePort {
  return {
    async buildPayload(request: BuildPayloadRequest): Promise<EntityPayload> {
      const { entityType, languageCode } = request;
      if (entityType !== "movie" && entityType !== "tv") {
        throw new Error(`payload nao suportado na Fase 3A para entityType=${entityType} (so movie/tv).`);
      }
      const entityId = BigInt(request.entityId);

      const [castRows, directorRow] = await Promise.all([
        prisma.castMember.findMany({
          where: { entityType, entityId },
          orderBy: [{ billingOrder: "asc" }, { id: "asc" }],
          select: { character: true, billingOrder: true, person: { select: { name: true } } },
        }),
        prisma.crewMember.findFirst({
          where: { entityType, entityId, job: DIRECTOR_JOB },
          orderBy: { id: "asc" },
          select: { person: { select: { name: true } } },
        }),
      ]);

      const cast = castRows.map((row) => row.person.name);
      const castMembers: CastMember[] = castRows.map((row) => ({
        name: row.person.name,
        ...(row.character !== null ? { character: row.character } : {}),
        ...(row.billingOrder !== null ? { billingOrder: row.billingOrder } : {}),
      }));
      const director = directorRow?.person.name ?? "";

      if (entityType === "movie") {
        const movie = await prisma.movie.findUnique({
          where: { id: entityId },
          select: { titleOriginal: true, releaseDate: true, runtimeMinutes: true },
        });
        if (movie === null) throw new Error(`movie id=${request.entityId} nao encontrado.`);
        return {
          entityType,
          languageCode,
          director,
          cast,
          castMembers,
          title: movie.titleOriginal,
          ...(movie.releaseDate !== null ? { year: movie.releaseDate.getUTCFullYear() } : {}),
          ...(movie.runtimeMinutes !== null ? { runtimeMinutes: movie.runtimeMinutes } : {}),
        };
      }

      const tvShow = await prisma.tvShow.findUnique({
        where: { id: entityId },
        select: { nameOriginal: true, firstAirDate: true },
      });
      if (tvShow === null) throw new Error(`tv_show id=${request.entityId} nao encontrado.`);
      return {
        entityType,
        languageCode,
        director,
        cast,
        castMembers,
        title: tvShow.nameOriginal,
        ...(tvShow.firstAirDate !== null ? { year: tvShow.firstAirDate.getUTCFullYear() } : {}),
      };
    },
  };
}
