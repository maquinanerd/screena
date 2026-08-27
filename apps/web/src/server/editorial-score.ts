/**
 * editorial-score.ts — PROCEDENCIA do Cinerie Score (nota editorial propria,
 * escala 5) para as superficies publicas.
 *
 * Por que este modulo existe: os presenters (`home-hero-presenter`,
 * `entity-index-presenter`) exigem `screenScoreSource === 'editorial'` para
 * liberar a nota, mas NENHUM loader populava esse campo — a propria migration
 * `20260717120000_external_intelligence_product` registra isso ("o gate de
 * render nunca deixou a nota aparecer: `screenScoreSource` nunca e populado por
 * nenhum loader"). A cadeia estava quebrada no loader, nao apenas sem dado.
 *
 * A procedencia NAO e inventada nem inferida da coluna: ela vem de
 * `cinerie_score_calculations`, o historico versionado do calculo. So conta
 * quando existe uma linha `status = 'calculated'` para a entidade cujo
 * `value`/`scale` BATEM com o `screen_score`/`screen_score_scale` persistido.
 * Calculo divergente (nota alterada depois, calculo antigo) nao autoriza —
 * fail-closed.
 *
 * O que este modulo NAO faz:
 *  - nao calcula nota (formula e decisao humana pendente, Prompt 11);
 *  - nao liberta exibicao: `screen_score_display` continua sendo o gate-mestra,
 *    travado no banco pelo trigger `cinerie_score_display_guard`, que exige
 *    `DataUsageDecision` vigente para `cinerie_score_display`;
 *  - nao usa nota de terceiro (IMDb/RT/Metacritic/Letterboxd/FilmAffinity) nem
 *    `vote_average_tmdb`: nota externa NUNCA vira Cinerie Score (invariantes
 *    1/2).
 *
 * Invariantes 3/4: le somente PostgreSQL local, em LOTE (sem N+1), read-only.
 */

import { getPrismaClient } from "@screena/db/server";

import {
  SCREEN_SCORE_EDITORIAL_SOURCE,
  type ScreenScoreSource,
} from "../lib/home-hero-presenter";
import { findManyInChunks } from "../lib/prisma-in-chunks";

type PrismaClient = ReturnType<typeof getPrismaClient>;

/** Entidades que carregam Cinerie Score (subset de EntityType). */
export type ScoredEntityType = "movie" | "tv";

/** Nota persistida de uma entidade, ja convertida de `Decimal`. */
export interface PersistedScore {
  entityId: bigint;
  screenScore: number | null;
  screenScoreScale: number | null;
}

/** Tolerancia de comparacao entre o calculo (Decimal 6,3) e a coluna. */
const SCORE_EPSILON = 1e-6;

function toNumber(value: { toString(): string } | number | null): number | null {
  if (value == null) return null;
  const num = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(num) ? num : null;
}

/**
 * Devolve, por `entityId` (string), a procedencia da nota: `'editorial'` quando
 * ha calculo `calculated` coerente com a nota persistida, senao ausente do mapa
 * (o presenter trata como `undefined` -> nota oculta).
 *
 * Uma unica query para todas as entidades recebidas.
 */
export async function resolveEditorialScoreSources(
  prisma: PrismaClient,
  entityType: ScoredEntityType,
  scores: readonly PersistedScore[],
): Promise<Map<string, ScreenScoreSource>> {
  const out = new Map<string, ScreenScoreSource>();

  // So faz sentido perguntar pela procedencia de quem tem nota persistida.
  const candidates = scores.filter(
    (row) => row.screenScore !== null && row.screenScoreScale !== null,
  );
  if (candidates.length === 0) return out;

  // Em LOTES de ids: as listagens chamam este modulo com o catalogo inteiro, e
  // acima de ~32.7 mil ids a consulta nao cabe no protocolo do PostgreSQL (ver
  // `../lib/prisma-in-chunks`). O `orderBy` sobrevive ao fatiamento porque cada
  // entidade cai em UM unico lote: as linhas de uma mesma entidade continuam
  // juntas e em ordem decrescente, que e o que o "ultimo calculo" abaixo pede.
  const rows = await findManyInChunks(
    candidates.map((row) => row.entityId),
    (chunk) =>
      prisma.cinerieScoreCalculation.findMany({
        where: {
          entityType,
          entityId: { in: chunk },
          status: "calculated",
        },
        orderBy: { calculatedAt: "desc" },
        select: { entityId: true, value: true, scale: true },
      }),
  );

  // Ultimo calculo por entidade (a lista ja vem em ordem decrescente).
  const latestByEntity = new Map<string, { value: number | null; scale: number | null }>();
  for (const row of rows) {
    const key = row.entityId.toString();
    if (latestByEntity.has(key)) continue;
    latestByEntity.set(key, { value: toNumber(row.value), scale: row.scale });
  }

  for (const candidate of candidates) {
    const key = candidate.entityId.toString();
    const latest = latestByEntity.get(key);
    if (latest === undefined) continue;
    if (latest.value === null || latest.scale === null) continue;
    if (latest.scale !== candidate.screenScoreScale) continue;
    if (Math.abs(latest.value - (candidate.screenScore as number)) > SCORE_EPSILON) continue;
    out.set(key, SCREEN_SCORE_EDITORIAL_SOURCE);
  }

  return out;
}
