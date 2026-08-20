/**
 * entity-hero.ts — Dados SERVER-ONLY que o TOPO canônico das páginas de
 * detalhe precisa além do que os loaders já traziam: os GÊNEROS do título e o
 * estado do CINERIE SCORE.
 *
 * INVARIANTES 3 e 4: lê SOMENTE o PostgreSQL local (Prisma), read-only, zero
 * IA. O cálculo do Score NÃO acontece aqui — ele roda offline
 * (`services/ratings score:compute`) e persiste em `cinerie_score_calculations`;
 * este módulo apenas PROJETA o resultado mais recente + a existência da decisão
 * vigente para `decideCinerieScore` (o presenter puro).
 */

import { getPrismaClient } from "@screena/db/server";

import type { CinerieScoreInputView } from "../lib/cinerie-score-presenter";

type PrismaClient = ReturnType<typeof getPrismaClient>;

/** Vertical suportada pelo topo de detalhe. */
export type HeroEntityType = "movie" | "tv";

/**
 * Gêneros do título, em ordem determinística (tmdb_id do gênero).
 *
 * A ligação título↔gênero existe desde 20/08/2026 (`movie_genres` /
 * `tv_show_genres`); a ordem POSICIONAL do payload do TMDB não foi persistida,
 * então a ordem aqui é um proxy estável — nunca a ordem de retorno do banco,
 * que não é garantida.
 */
export async function getGenresForEntity(
  prisma: PrismaClient,
  entityType: HeroEntityType,
  entityId: bigint,
): Promise<string[]> {
  if (entityType === "movie") {
    const rows = await prisma.movieGenre.findMany({
      where: { movieId: entityId },
      select: { genre: { select: { name: true, tmdbId: true } } },
      orderBy: { genreTmdbId: "asc" },
    });
    return rows.map((row) => row.genre.name);
  }
  const rows = await prisma.tvShowGenre.findMany({
    where: { tvShowId: entityId },
    select: { genre: { select: { name: true, tmdbId: true } } },
    orderBy: { genreTmdbId: "asc" },
  });
  return rows.map((row) => row.genre.name);
}

/** Uma linha da explicação persistida do cálculo (`explanation` JSONB). */
interface ExplanationEntry {
  readonly source: string;
  readonly normalized: number;
  readonly weight: number;
}

function parseExplanation(raw: unknown): ExplanationEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ExplanationEntry[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const source = (item as Record<string, unknown>).source;
    const normalized = (item as Record<string, unknown>).normalized;
    const weight = (item as Record<string, unknown>).weight;
    if (typeof source !== "string") continue;
    if (typeof normalized !== "number" || !Number.isFinite(normalized)) continue;
    if (typeof weight !== "number" || !Number.isFinite(weight)) continue;
    out.push({ source, normalized, weight });
  }
  return out;
}

/**
 * O estado do Cinerie Score para o card do topo.
 *
 * `authorized` = existe decisão VIGENTE de `cinerie_score_display` sob licença
 * vigente (a decisão da autorização do proprietário, 2026-08-20 — aplicada em
 * produção pelo `legal sources apply`). Sem ela, o presenter registra
 * `no_approved_formula` e o card não existe.
 *
 * O número e as fontes contadas vêm do ÚLTIMO cálculo `calculated` persistido
 * pelo worker offline — o render nunca calcula (invariantes 3/4 + auditoria:
 * todo número exibido tem linha de histórico com `inputs_hash`).
 */
export async function getCinerieScoreForEntity(
  prisma: PrismaClient,
  entityType: HeroEntityType,
  entityId: bigint,
): Promise<CinerieScoreInputView> {
  const decisionRows = await prisma.$queryRaw<Array<{ id: bigint }>>`
    SELECT d.id
      FROM data_usage_decisions d
      JOIN source_licenses l ON l.id = d.source_license_id
     WHERE d.use_case = 'cinerie_score_display'
       AND d.is_current = true
       AND l.is_current = true
       AND d.stage = 'approved_for_display'
       AND d.display_allowed = true
       AND d.derivative_allowed = true
       AND d.valid_from <= now()
       AND (d.valid_until IS NULL OR d.valid_until > now())
     LIMIT 1`;
  const authorized = decisionRows.length > 0;
  if (!authorized) {
    return { authorized: false, value: null, counted: [] };
  }

  const calculation = await prisma.cinerieScoreCalculation.findFirst({
    where: { entityType, entityId, status: "calculated" },
    orderBy: { calculatedAt: "desc" },
    select: { value: true, scale: true, explanation: true },
  });
  if (calculation === null || calculation.value === null) {
    return { authorized: true, value: null, counted: [] };
  }

  const counted = parseExplanation(calculation.explanation).map((entry) => ({
    source: entry.source,
    normalized: entry.normalized,
    // O grupo nao e persistido na explicacao e o presenter nao o usa para
    // decidir exibicao (só o COUNT de fontes nomeadas conta). `audience` e um
    // valor valido do tipo para satisfazer a forma.
    group: "audience" as const,
    weight: entry.weight,
  }));

  return {
    authorized: true,
    value: Number(calculation.value),
    counted,
  };
}
