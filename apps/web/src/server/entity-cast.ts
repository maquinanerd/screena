/**
 * entity-cast.ts — Helper SERVER-ONLY: dado um titulo (filme|serie), traz o
 * ELENCO PRINCIPAL via `cast_members` + `people`.
 *
 * Invariantes 3 e 4:
 *  - Le somente PostgreSQL local via @screena/db (Prisma).
 *  - Nao chama TMDB, Gemini ou qualquer API externa. Read-only.
 *
 * Elenco = dado factual de catalogo (nome + personagem). Cada membro so vira
 * link quando a pessoa tem slug canonico pt-BR; caso contrario, so o nome. A
 * ordenacao/limite finais vivem no presenter puro `cast-presenter`.
 */

import { getPrismaClient } from "@screena/db/server";

import {
  buildCastStrip,
  DEFAULT_CAST_LIMIT,
  type CastMemberInput,
  type CastMemberView,
} from "../lib/cast-presenter";

const LANGUAGE_CODE = "pt-BR";

/** Titulos que tem elenco (subset de EntityType). */
export type CastEntityType = "movie" | "tv";

type PrismaClient = ReturnType<typeof getPrismaClient>;

/** Quantas linhas buscar antes do teto de exibicao do presenter. */
const CAST_FETCH_LIMIT = 24;

/**
 * Retorna o elenco principal (ja ordenado/limitado) de um titulo. Sem elenco ->
 * [] e a pagina omite a secao.
 */
export async function getCastForEntity(
  prisma: PrismaClient,
  entityType: CastEntityType,
  entityId: bigint,
): Promise<CastMemberView[]> {
  const castRows = await prisma.castMember.findMany({
    where: { entityType, entityId },
    orderBy: [{ billingOrder: { sort: "asc", nulls: "last" } }, { id: "asc" }],
    take: CAST_FETCH_LIMIT,
    select: {
      character: true,
      billingOrder: true,
      personId: true,
      person: { select: { name: true, profilePath: true } },
    },
  });
  if (castRows.length === 0) return [];

  const personIds = [...new Set(castRows.map((row) => row.personId.toString()))].map(
    (id) => BigInt(id),
  );
  const slugRows = await prisma.slug.findMany({
    where: {
      entityType: "person",
      entityId: { in: personIds },
      languageCode: LANGUAGE_CODE,
      isCanonical: true,
    },
    select: { entityId: true, slug: true },
  });
  const slugByPerson = new Map<string, string>();
  for (const row of slugRows) slugByPerson.set(row.entityId.toString(), row.slug);

  const inputs: CastMemberInput[] = castRows.map((row) => ({
    name: row.person.name,
    character: row.character,
    billingOrder: row.billingOrder,
    profilePath: row.person.profilePath,
    slug: slugByPerson.get(row.personId.toString()) ?? null,
  }));

  return buildCastStrip(inputs, DEFAULT_CAST_LIMIT);
}
