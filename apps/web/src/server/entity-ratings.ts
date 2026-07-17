/**
 * entity-ratings.ts — Helper SERVER-ONLY: dado um titulo (filme|serie), traz as
 * notas externas EXIBIVEIS como `RatingsPayload`.
 *
 * Invariantes 3, 4 e 6:
 *  - Le somente PostgreSQL local via @screena/db (Prisma). Read-only. NUNCA
 *    consulta RapidAPI/IMDb/Rotten Tomatoes ao vivo — este e o caminho de
 *    LEITURA; a ingestao roda offline em worker.
 *  - LICENCA antes de exibir (invariante 6): a query filtra `display_allowed`,
 *    e ainda assim REVALIDA a decisao de uso e o frescor em memoria.
 *
 * Por que revalidar aqui, se ha trigger fail-closed no banco: o trigger dispara
 * em ESCRITA. Uma nota aprovada em janeiro continua `display_allowed = true`
 * para sempre, porque o tempo passar nao e um UPDATE. Duas coisas so o tempo
 * quebra, e so a leitura enxerga:
 *   1. a DataUsageDecision EXPIRA (`valid_until` passa);
 *   2. a nota fica velha demais (RATING_STALE_POLICY).
 * O trigger e a trava de escrita; este modulo e o relogio. Nenhum substitui o
 * outro — e por isso o filtro aqui NAO e redundancia decorativa.
 *
 * Este modulo NAO altera nenhuma pagina: e o caminho de leitura governado, e a
 * decisao de exibir a nota na tela e uma mudanca visual separada.
 */

import { RATING_SOURCES, type RatingSource } from "@screena/config";
import { getPrismaClient } from "@screena/db/server";
import type {
  EntityRef,
  PublicExternalRating,
  PublicRatingScoreType,
  RatingsPayload,
} from "@screena/public-contracts";
import { evaluateRatingFreshness } from "@screena/schemas";

/** Titulos que tem ratings nesta fase (subset de EntityType). */
export type RatingsEntityType = "movie" | "tv";

type PrismaClient = ReturnType<typeof getPrismaClient>;

/** Teto defensivo de linhas buscadas. */
const RATINGS_FETCH_LIMIT = 20;

/** Caso de uso que autoriza exibir nota de terceiro. */
const RATING_DISPLAY_USE_CASE = "rating_display";

/**
 * Territorio de exibicao (pt-BR/Brasil, mesmo padrao do WATCH_COUNTRY do
 * painel de streaming). Decisao escopada a outro territorio nao autoriza
 * exibir aqui.
 */
const RATING_DISPLAY_TERRITORY = "BR";

/** Linha crua projetada pela query (exportado para o teste puro do projetor). */
export interface RatingRow {
  readonly ratingSource: string;
  readonly ratingLabel: string;
  readonly scoreType: string | null;
  readonly ratingValue: unknown;
  readonly ratingScale: number;
  readonly ratingCount: number | null;
  readonly fetchedAt: Date | null;
  readonly attributionText: string | null;
  readonly attributionUrl: string | null;
  readonly requiresAttribution: boolean;
  readonly requiresLinkback: boolean;
  readonly dataUsageDecision: {
    readonly useCase: string;
    readonly isCurrent: boolean;
    readonly stage: string;
    readonly displayAllowed: boolean;
    readonly territory: string | null;
    readonly validFrom: Date;
    readonly validUntil: Date | null;
    // A LICENCA-MAE, via decisao. A decisao foi validada contra a licenca na
    // ESCRITA; a licenca pode ter sido supersedida/bloqueada depois, e isso nao
    // gera nenhum write na nota — so a leitura enxerga (achado A1 da revisao
    // adversarial). rating_source_key confere que a licenca e DESTA fonte.
    readonly sourceLicense: {
      readonly isCurrent: boolean;
      readonly licenseStatus: string;
      readonly displayAllowed: boolean;
      readonly scoreAllowed: boolean;
      readonly contentType: string;
      readonly ratingSourceKey: string | null;
    };
  } | null;
}

/** `license_status` que permitem exibicao (espelha o trigger). */
const DISPLAYABLE_LICENSE_STATUS: readonly string[] = ["official", "licensed", "third_party"];

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A decisao de uso ainda autoriza exibir, AGORA? */
function decisionAuthorizesNow(row: RatingRow, now: Date): boolean {
  const decision = row.dataUsageDecision;
  if (decision === null) return false;
  if (decision.useCase !== RATING_DISPLAY_USE_CASE) return false;
  if (!decision.isCurrent) return false;
  if (decision.stage !== "approved_for_display" || !decision.displayAllowed) return false;
  if (decision.validFrom.getTime() > now.getTime()) return false;
  // Este e o caso que SO a leitura pega: a decisao venceu sozinha, sem ninguem
  // escrever nada na nota.
  if (decision.validUntil !== null && decision.validUntil.getTime() <= now.getTime()) return false;
  // Decisao territorial so vale no territorio de exibicao deste site.
  if (decision.territory !== null && decision.territory !== RATING_DISPLAY_TERRITORY) return false;

  // A LICENCA-MAE continua sendo a autoridade: supersedida/bloqueada/sem
  // permissao de score => a nota sai do ar AGORA, mesmo sem nenhum write na
  // linha (o trigger e trava de escrita; isto e o relogio da leitura).
  const license = decision.sourceLicense;
  if (!license.isCurrent) return false;
  if (!DISPLAYABLE_LICENSE_STATUS.includes(license.licenseStatus)) return false;
  if (!license.displayAllowed || !license.scoreAllowed) return false;
  if (license.contentType !== "rating" || license.ratingSourceKey !== row.ratingSource) return false;
  return true;
}

/** Projeta uma linha exibivel para o contrato publico, ou `null` se nao passa. */
export function toPublicRating(row: RatingRow, now: Date): PublicExternalRating | null {
  // O contrato publico promete `sourceKey: RatingSource` (uniao fechada). Uma
  // 6a fonte adicionada a tabela rating_sources satisfaria FK e triggers, mas o
  // cast viraria mentira de tipo — checar o pertencimento aqui em vez de `as`.
  if (!(RATING_SOURCES as readonly string[]).includes(row.ratingSource)) return null;
  if (!decisionAuthorizesNow(row, now)) return null;

  const freshness = evaluateRatingFreshness({
    ratingSource: row.ratingSource,
    fetchedAt: row.fetchedAt,
    now,
  });
  if (!freshness.displayable) return null;

  // Sem classificacao nao ha como exibir sem arriscar trocar critica por
  // publico. O trigger ja garante isso na escrita; aqui e a rede de seguranca.
  if (row.scoreType === null) return null;

  const value = toNumber(row.ratingValue);
  if (value === null) return null;

  // Atribuicao exigida e ausente = nao exibe. Nunca "exibe sem credito".
  if (row.requiresAttribution && (row.attributionText === null || row.attributionText.trim() === "")) {
    return null;
  }
  if (row.requiresLinkback && (row.attributionUrl === null || row.attributionUrl.trim() === "")) {
    return null;
  }

  // `fetchedAt` e garantido nao-nulo aqui: `evaluateRatingFreshness` devolve
  // `unknown-fetch` (nao exibivel) quando falta.
  const updatedAt = (row.fetchedAt as Date).toISOString();

  return {
    sourceKey: row.ratingSource as RatingSource,
    sourceLabel: row.ratingLabel,
    scoreType: row.scoreType as PublicRatingScoreType,
    value,
    best: row.ratingScale,
    count: row.ratingCount,
    label: row.ratingLabel,
    updatedAt,
    attribution:
      row.attributionText === null
        ? null
        : { text: row.attributionText, url: row.attributionUrl },
  };
}

/**
 * Retorna as notas externas exibiveis de um titulo.
 *
 * Sempre devolve um payload (nunca `null`): ausencia de nota e um estado
 * legitimo, e `ratings: []` diz isso sem ambiguidade.
 */
export async function getRatingsForEntity(
  prisma: PrismaClient,
  entityType: RatingsEntityType,
  entityId: bigint,
  entity: EntityRef,
): Promise<RatingsPayload> {
  const now = new Date();

  const rows = (await prisma.externalRating.findMany({
    where: {
      entityType,
      entityId,
      // Gate de origem (invariante 6). O resto e revalidacao de tempo.
      displayAllowed: true,
    },
    take: RATINGS_FETCH_LIMIT,
    // Ordem TOTAL e estavel: duas metricas da mesma fonte (Tomatometer +
    // Popcornmeter) nao podem flutuar entre renders/replicas.
    orderBy: [{ ratingSource: "asc" }, { metric: "asc" }],
    select: {
      ratingSource: true,
      ratingLabel: true,
      scoreType: true,
      ratingValue: true,
      ratingScale: true,
      ratingCount: true,
      fetchedAt: true,
      attributionText: true,
      attributionUrl: true,
      requiresAttribution: true,
      requiresLinkback: true,
      dataUsageDecision: {
        select: {
          useCase: true,
          isCurrent: true,
          stage: true,
          displayAllowed: true,
          territory: true,
          validFrom: true,
          validUntil: true,
          sourceLicense: {
            select: {
              isCurrent: true,
              licenseStatus: true,
              displayAllowed: true,
              scoreAllowed: true,
              contentType: true,
              ratingSourceKey: true,
            },
          },
        },
      },
    },
  })) as unknown as RatingRow[];

  const ratings: PublicExternalRating[] = [];
  for (const row of rows) {
    const projected = toPublicRating(row, now);
    if (projected !== null) ratings.push(projected);
  }

  return { entity, ratings };
}
