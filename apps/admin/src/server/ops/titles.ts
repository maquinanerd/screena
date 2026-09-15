/**
 * titles.ts — A busca e a ficha de diagnostico de UM titulo. SERVER-ONLY.
 *
 * ============================================================================
 * A PERGUNTA QUE ESTA FICHA RESPONDE
 * ============================================================================
 * "Por que este titulo esta assim na pagina, e o que o sistema vai fazer com
 * ele?" — sem terminal. Cada secao e uma medida INDEPENDENTE: se a consulta das
 * notas falhar, a secao de notas diz "nao determinado" e o resto da ficha segue.
 *
 * Os portoes de exibicao sao os da pagina (`lib/ops/visibility.ts`, travado por
 * teste de espelho contra `apps/web`): a ficha nunca diz "aparece" para algo que a
 * pagina esconde.
 */

import { readSpentToday } from "@screena/sync/facts";

import type { TitleShape } from "../../lib/ops/estimate";
import { formatDayBrt } from "../../lib/ops/format";
import { escapeLike } from "../../lib/ops/log-filters";
import { measure, type Measured } from "../../lib/ops/measure";
import { publicTitleUrl, type TitleKind } from "../../lib/ops/title-routes";
import {
  explainCinerieScore,
  explainImageSource,
  explainRatingRow,
  explainTrailerRow,
  parseExplanationSources,
  type RatingRefusal,
  type ScoreAbsence,
  type TrailerRefusal,
} from "../../lib/ops/visibility";
import { HOUR_MS, num, numOrNull, opsDb, withStatementTimeout, type OpsPrisma } from "./db";

/** Um resultado de busca. */
export interface TitleHit {
  readonly kind: TitleKind;
  readonly id: string;
  readonly tmdbId: number;
  readonly imdbId: string | null;
  readonly title: string;
  readonly originalTitle: string;
  readonly year: number | null;
  readonly popularity: number | null;
}

interface RawHit {
  readonly kind: string;
  readonly id: string;
  readonly tmdb_id: number;
  readonly imdb_id: string | null;
  readonly original_title: string;
  readonly pt_title: string | null;
  readonly year: number | null;
  readonly popularity: unknown;
}

function toHit(row: RawHit): TitleHit {
  const pt = row.pt_title?.trim() ?? "";
  return {
    kind: row.kind === "tv" ? "tv" : "movie",
    id: row.id,
    tmdbId: row.tmdb_id,
    imdbId: row.imdb_id,
    title: pt === "" ? row.original_title : pt,
    originalTitle: row.original_title,
    year: row.year,
    popularity: numOrNull(row.popularity),
  };
}

/** Busca por imdb_id, id (TMDB ou interno) ou trecho do titulo. */
export async function searchTitles(rawQuery: string, now: Date): Promise<Measured<readonly TitleHit[]>> {
  const query = rawQuery.trim().slice(0, 120);
  return measure(
    "movies + tv_shows + entity_translations (pt-BR)",
    async () => {
      const db = opsDb();
      if (/^tt\d{7,10}$/.test(query)) {
        const rows = await db.$queryRaw<RawHit[]>`
          SELECT 'movie' AS kind, m.id::text AS id, m.tmdb_id, m.imdb_id, m.title_original AS original_title,
                 t.title AS pt_title, EXTRACT(YEAR FROM m.release_date)::int AS year, m.popularity
            FROM movies m
            LEFT JOIN entity_translations t
              ON t.entity_type = 'movie' AND t.entity_id = m.id AND t.language_code = 'pt-BR'
           WHERE m.imdb_id = ${query}
          UNION ALL
          SELECT 'tv' AS kind, s.id::text AS id, s.tmdb_id, s.imdb_id, s.name_original AS original_title,
                 t.title AS pt_title, EXTRACT(YEAR FROM s.first_air_date)::int AS year, s.popularity
            FROM tv_shows s
            LEFT JOIN entity_translations t
              ON t.entity_type = 'tv' AND t.entity_id = s.id AND t.language_code = 'pt-BR'
           WHERE s.imdb_id = ${query}`;
        return rows.map(toHit);
      }
      if (/^\d{1,12}$/.test(query)) {
        const rows = await db.$queryRaw<RawHit[]>`
          SELECT 'movie' AS kind, m.id::text AS id, m.tmdb_id, m.imdb_id, m.title_original AS original_title,
                 t.title AS pt_title, EXTRACT(YEAR FROM m.release_date)::int AS year, m.popularity
            FROM movies m
            LEFT JOIN entity_translations t
              ON t.entity_type = 'movie' AND t.entity_id = m.id AND t.language_code = 'pt-BR'
           WHERE m.tmdb_id::text = ${query} OR m.id = ${query}::bigint
          UNION ALL
          SELECT 'tv' AS kind, s.id::text AS id, s.tmdb_id, s.imdb_id, s.name_original AS original_title,
                 t.title AS pt_title, EXTRACT(YEAR FROM s.first_air_date)::int AS year, s.popularity
            FROM tv_shows s
            LEFT JOIN entity_translations t
              ON t.entity_type = 'tv' AND t.entity_id = s.id AND t.language_code = 'pt-BR'
           WHERE s.tmdb_id::text = ${query} OR s.id = ${query}::bigint`;
        return rows.map(toHit);
      }
      if (query.length < 2) return [];
      const pattern = `%${escapeLike(query)}%`;
      const rows = await db.$queryRaw<RawHit[]>`
        (SELECT 'movie' AS kind, m.id::text AS id, m.tmdb_id, m.imdb_id, m.title_original AS original_title,
                t.title AS pt_title, EXTRACT(YEAR FROM m.release_date)::int AS year, m.popularity
           FROM movies m
           LEFT JOIN entity_translations t
             ON t.entity_type = 'movie' AND t.entity_id = m.id AND t.language_code = 'pt-BR'
          WHERE m.title_original ILIKE ${pattern} ESCAPE '\\' OR t.title ILIKE ${pattern} ESCAPE '\\'
          ORDER BY m.popularity DESC NULLS LAST, m.id
          LIMIT 25)
        UNION ALL
        (SELECT 'tv' AS kind, s.id::text AS id, s.tmdb_id, s.imdb_id, s.name_original AS original_title,
                t.title AS pt_title, EXTRACT(YEAR FROM s.first_air_date)::int AS year, s.popularity
           FROM tv_shows s
           LEFT JOIN entity_translations t
             ON t.entity_type = 'tv' AND t.entity_id = s.id AND t.language_code = 'pt-BR'
          WHERE s.name_original ILIKE ${pattern} ESCAPE '\\' OR t.title ILIKE ${pattern} ESCAPE '\\'
          ORDER BY s.popularity DESC NULLS LAST, s.id
          LIMIT 25)`;
      return rows.map(toHit);
    },
    () => now,
  );
}

/** Os fatos de identidade de um titulo. */
export interface TitleIdentity {
  readonly kind: TitleKind;
  readonly id: string;
  readonly tmdbId: number;
  readonly imdbId: string | null;
  readonly originalTitle: string;
  readonly ptTitle: string | null;
  readonly originalLanguage: string | null;
  readonly releaseDate: Date | null;
  readonly status: string | null;
  readonly popularity: number | null;
  readonly voteCountTmdb: number | null;
  readonly numberOfSeasons: number | null;
  readonly numberOfEpisodes: number | null;
  readonly posterPath: string | null;
  readonly lastSyncedAt: Date | null;
  readonly staleAfter: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly seasonsInDb: number | null;
  readonly episodesInDb: number | null;
}

interface RawIdentity {
  readonly id: string;
  readonly tmdb_id: number;
  readonly imdb_id: string | null;
  readonly original_title: string;
  readonly pt_title: string | null;
  readonly original_language: string | null;
  readonly release_date: Date | null;
  readonly status: string | null;
  readonly popularity: unknown;
  readonly vote_count_tmdb: number | null;
  readonly number_of_seasons: number | null;
  readonly number_of_episodes: number | null;
  readonly poster_path: string | null;
  readonly last_synced_at: Date | null;
  readonly stale_after: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/** Le a identidade de um titulo. `null` = nao existe. */
export async function readTitleIdentity(db: OpsPrisma, kind: TitleKind, id: string): Promise<TitleIdentity | null> {
  const rows =
    kind === "movie"
      ? await db.$queryRaw<RawIdentity[]>`
          SELECT m.id::text AS id, m.tmdb_id, m.imdb_id, m.title_original AS original_title, t.title AS pt_title,
                 m.original_language, m.release_date, m.status, m.popularity, m.vote_count_tmdb,
                 NULL::int AS number_of_seasons, NULL::int AS number_of_episodes, m.poster_path,
                 m.last_synced_at, m.stale_after, m.created_at, m.updated_at
            FROM movies m
            LEFT JOIN entity_translations t
              ON t.entity_type = 'movie' AND t.entity_id = m.id AND t.language_code = 'pt-BR'
           WHERE m.id = ${id}::bigint`
      : await db.$queryRaw<RawIdentity[]>`
          SELECT s.id::text AS id, s.tmdb_id, s.imdb_id, s.name_original AS original_title, t.title AS pt_title,
                 s.original_language, s.first_air_date AS release_date, s.status, s.popularity, s.vote_count_tmdb,
                 s.number_of_seasons, s.number_of_episodes, s.poster_path,
                 s.last_synced_at, s.stale_after, s.created_at, s.updated_at
            FROM tv_shows s
            LEFT JOIN entity_translations t
              ON t.entity_type = 'tv' AND t.entity_id = s.id AND t.language_code = 'pt-BR'
           WHERE s.id = ${id}::bigint`;
  const row = rows[0];
  if (row === undefined) return null;

  let seasonsInDb: number | null = null;
  let episodesInDb: number | null = null;
  if (kind === "tv") {
    const counts = await db.$queryRaw<Array<{ seasons: unknown; episodes: unknown }>>`
      SELECT (SELECT COUNT(*) FROM seasons WHERE tv_show_id = ${id}::bigint) AS seasons,
             (SELECT COUNT(*) FROM episodes WHERE tv_show_id = ${id}::bigint) AS episodes`;
    seasonsInDb = num(counts[0]?.seasons);
    episodesInDb = num(counts[0]?.episodes);
  }

  return {
    kind,
    id: row.id,
    tmdbId: row.tmdb_id,
    imdbId: row.imdb_id,
    originalTitle: row.original_title,
    ptTitle: row.pt_title,
    originalLanguage: row.original_language,
    releaseDate: row.release_date,
    status: row.status,
    popularity: numOrNull(row.popularity),
    voteCountTmdb: row.vote_count_tmdb,
    numberOfSeasons: row.number_of_seasons,
    numberOfEpisodes: row.number_of_episodes,
    posterPath: row.poster_path,
    lastSyncedAt: row.last_synced_at,
    staleAfter: row.stale_after,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    seasonsInDb,
    episodesInDb,
  };
}

/** A forma do titulo para a estimativa de custo. Serie com zero temporadas no banco = ainda nao sincronizada. */
export function titleShapeOf(identity: TitleIdentity): TitleShape {
  return {
    kind: identity.kind,
    seasons: identity.kind === "tv" && identity.seasonsInDb !== null && identity.seasonsInDb > 0 ? identity.seasonsInDb : null,
    episodes: identity.kind === "tv" && identity.seasonsInDb !== null && identity.seasonsInDb > 0 ? identity.episodesInDb : null,
    imdbId: identity.imdbId,
  };
}

/** Gasto de hoje da OMDb (UTC), para a estimativa de "nota". */
export async function readOmdbSpentToday(now: Date): Promise<Measured<number>> {
  return measure("api_sync_logs.quota_cost (omdb, hoje UTC)", () => readSpentToday(opsDb(), "omdb", now), () => now);
}

/** Uma traducao. */
export interface TranslationRow {
  readonly languageCode: string;
  readonly title: string | null;
  readonly hasSummary: boolean;
  readonly summaryLength: number;
  readonly status: string;
  readonly updatedAt: Date;
}

/** O que o payload guardado do TMDB diz sobre a sinopse. */
export interface PayloadFacts {
  readonly source: "api_cache" | "tmdb_raw";
  readonly fetchedAt: Date;
  /** `overview` da resposta pt-BR veio com texto? */
  readonly hasOverview: boolean;
  /** O bloco `translations` tem pt-BR com `overview`? `null` = o payload nao trouxe o bloco. */
  readonly hasPtBrTranslationOverview: boolean | null;
}

/** Uma nota e o veredito da pagina sobre ela. */
export interface RatingDiag {
  readonly id: string;
  readonly source: string;
  readonly label: string;
  readonly metric: string;
  readonly value: number | null;
  readonly scale: number;
  readonly count: number | null;
  readonly providerApi: string;
  readonly fetchedAt: Date | null;
  readonly visible: boolean;
  readonly refusals: readonly RatingRefusal[];
}

/** As notas, com o resumo de por que o cartao aparece ou nao. */
export interface RatingsDiag {
  readonly rows: readonly RatingDiag[];
  readonly omdbCacheFetchedAt: Date | null;
  readonly summary: string;
}

/** O Cinerie Score. */
export interface ScoreDiag {
  readonly authorized: boolean;
  readonly history: ReadonlyArray<{
    readonly status: string;
    readonly value: number | null;
    readonly version: string;
    readonly calculatedAt: Date;
    readonly blockedReason: string | null;
    readonly sources: readonly string[];
  }>;
  readonly verdict: { readonly rendered: true; readonly sources: readonly string[] } | { readonly rendered: false; readonly reason: ScoreAbsence };
}

/** Um video. */
export interface VideoDiag {
  readonly id: string;
  readonly site: string;
  readonly key: string;
  readonly name: string | null;
  readonly type: string | null;
  readonly official: boolean | null;
  readonly language: string | null;
  readonly publishedAt: Date | null;
  readonly licenseStatus: string;
  readonly displayAllowed: boolean;
  readonly visible: boolean;
  readonly refusals: readonly TrailerRefusal[];
}

/** As imagens: por tipo, e o portao da FONTE. */
export interface ImagesDiag {
  readonly byType: ReadonlyArray<{ readonly type: string; readonly total: number; readonly displayAllowed: number; readonly lastFetchedAt: Date | null }>;
  readonly source: { readonly authorized: boolean; readonly reason: string };
}

/** Um job do titulo, com a posicao na fila. */
export interface JobDiag {
  readonly id: string;
  readonly jobType: string;
  readonly status: string;
  readonly entityType: string | null;
  readonly priority: number;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly runId: string | null;
  readonly lastErrorCode: string | null;
  readonly availableAt: Date;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
  /** Jobs reivindicaveis na frente deste. `null` = nao se aplica (fechado, em backoff) ou nao medido. */
  readonly ahead: number | null;
  readonly aheadReason: string | null;
}

/** Os jobs do titulo e o ritmo da fila. */
export interface JobsDiag {
  readonly jobs: readonly JobDiag[];
  readonly succeededLast6h: Measured<number>;
}

/** A indexacao. */
export interface IndexDiag {
  readonly slug: string | null;
  readonly decision: {
    readonly decision: string;
    readonly reason: string | null;
    readonly origin: string | null;
    readonly decidedAt: Date | null;
    readonly createdAt: Date;
  } | null;
  readonly verdict: "index" | "noindex";
  readonly verdictText: string;
  readonly publicUrl: string | null;
}

/** Uma acao do painel sobre o titulo. */
export interface AuditMini {
  readonly id: string;
  readonly actionKind: string;
  readonly outcome: string;
  readonly detail: string | null;
  readonly actorLabel: string;
  readonly requestedAt: Date;
}

/** A ficha inteira. */
export interface TitleDiagnosis {
  readonly identity: TitleIdentity;
  readonly shape: TitleShape;
  readonly translations: Measured<readonly TranslationRow[]>;
  readonly payloads: Measured<readonly PayloadFacts[]>;
  readonly ratings: Measured<RatingsDiag>;
  readonly score: Measured<ScoreDiag>;
  readonly videos: Measured<readonly VideoDiag[]>;
  readonly images: Measured<ImagesDiag>;
  readonly jobs: Measured<JobsDiag>;
  readonly indexability: Measured<IndexDiag>;
  readonly audits: Measured<readonly AuditMini[]>;
  readonly omdbSpentToday: Measured<number>;
}

const QUERY_TIMEOUT_MS = 8_000;

async function readTranslations(db: OpsPrisma, kind: TitleKind, id: string): Promise<readonly TranslationRow[]> {
  const rows = await db.$queryRaw<Array<{ language_code: string; title: string | null; has_summary: boolean; summary_length: number; status: string; updated_at: Date }>>`
    SELECT language_code, title, (BTRIM(COALESCE(summary, '')) <> '') AS has_summary,
           length(COALESCE(summary, ''))::int AS summary_length, status::text AS status, updated_at
      FROM entity_translations
     WHERE entity_type = ${kind}::"EntityType" AND entity_id = ${id}::bigint
     ORDER BY language_code`;
  return rows.map((row) => ({
    languageCode: row.language_code,
    title: row.title,
    hasSummary: row.has_summary,
    summaryLength: row.summary_length,
    status: row.status,
    updatedAt: row.updated_at,
  }));
}

async function readPayloads(db: OpsPrisma, kind: TitleKind, tmdbId: number): Promise<readonly PayloadFacts[]> {
  const endpoint = `/${kind === "movie" ? "movie" : "tv"}/${String(tmdbId)}`;
  const cache = await db.$queryRaw<Array<{ fetched_at: Date; has_overview: boolean; has_pt_br: boolean | null }>>`
    SELECT fetched_at,
           (BTRIM(COALESCE(payload->>'overview', '')) <> '') AS has_overview,
           CASE WHEN jsonb_typeof(payload->'translations'->'translations') = 'array' THEN EXISTS (
             SELECT 1 FROM jsonb_array_elements(payload->'translations'->'translations') tr
              WHERE tr->>'iso_639_1' = 'pt' AND tr->>'iso_3166_1' = 'BR'
                AND BTRIM(COALESCE(tr->'data'->>'overview', '')) <> '')
           ELSE NULL END AS has_pt_br
      FROM api_cache
     WHERE provider_api = 'tmdb' AND endpoint = ${endpoint}
     ORDER BY fetched_at DESC
     LIMIT 1`;
  const raw = await db.$queryRaw<Array<{ fetched_at: Date; has_overview: boolean; has_pt_br: boolean | null }>>`
    SELECT fetched_at,
           (BTRIM(COALESCE(payload->>'overview', '')) <> '') AS has_overview,
           CASE WHEN jsonb_typeof(payload->'translations'->'translations') = 'array' THEN EXISTS (
             SELECT 1 FROM jsonb_array_elements(payload->'translations'->'translations') tr
              WHERE tr->>'iso_639_1' = 'pt' AND tr->>'iso_3166_1' = 'BR'
                AND BTRIM(COALESCE(tr->'data'->>'overview', '')) <> '')
           ELSE NULL END AS has_pt_br
      FROM tmdb_raw
     WHERE entity_type = ${kind}::"TmdbEntityKind" AND tmdb_id = ${tmdbId}::int
     ORDER BY fetched_at DESC
     LIMIT 1`;
  const out: PayloadFacts[] = [];
  for (const row of cache) {
    out.push({ source: "api_cache", fetchedAt: row.fetched_at, hasOverview: row.has_overview, hasPtBrTranslationOverview: row.has_pt_br });
  }
  for (const row of raw) {
    out.push({ source: "tmdb_raw", fetchedAt: row.fetched_at, hasOverview: row.has_overview, hasPtBrTranslationOverview: row.has_pt_br });
  }
  return out;
}

interface RawRating {
  readonly id: string;
  readonly rating_source: string;
  readonly rating_label: string;
  readonly metric: string;
  readonly rating_value: unknown;
  readonly rating_scale: number;
  readonly rating_count: number | null;
  readonly provider_api: string;
  readonly fetched_at: Date | null;
  readonly score_type: string | null;
  readonly requires_attribution: boolean;
  readonly attribution_text: string | null;
  readonly requires_linkback: boolean;
  readonly attribution_url: string | null;
  readonly row_display_allowed: boolean;
  readonly decision_id: string | null;
  readonly use_case: string | null;
  readonly decision_current: boolean | null;
  readonly decision_stage: string | null;
  readonly decision_display_allowed: boolean | null;
  readonly territory: string | null;
  readonly valid_from: Date | null;
  readonly valid_until: Date | null;
  readonly license_current: boolean | null;
  readonly license_status: string | null;
  readonly license_display_allowed: boolean | null;
  readonly score_allowed: boolean | null;
  readonly content_type: string | null;
  readonly rating_source_key: string | null;
}

async function readRatings(db: OpsPrisma, identity: TitleIdentity, now: Date): Promise<RatingsDiag> {
  const rows = await db.$queryRaw<RawRating[]>`
    SELECT r.id::text AS id, r.rating_source, r.rating_label, r.metric, r.rating_value, r.rating_scale,
           r.rating_count, r.provider_api, r.fetched_at, r.score_type::text AS score_type,
           r.requires_attribution, r.attribution_text, r.requires_linkback, r.attribution_url,
           r.display_allowed AS row_display_allowed,
           d.id::text AS decision_id, d.use_case, d.is_current AS decision_current, d.stage::text AS decision_stage,
           d.display_allowed AS decision_display_allowed, d.territory, d.valid_from, d.valid_until,
           l.is_current AS license_current, l.license_status::text AS license_status,
           l.display_allowed AS license_display_allowed, l.score_allowed, l.content_type::text AS content_type,
           l.rating_source_key
      FROM external_ratings r
      LEFT JOIN data_usage_decisions d ON d.id = r.data_usage_decision_id
      LEFT JOIN source_licenses l ON l.id = d.source_license_id
     WHERE r.entity_type = ${identity.kind}::"EntityType" AND r.entity_id = ${identity.id}::bigint
     ORDER BY r.rating_source, r.metric`;

  const ratings: RatingDiag[] = rows.map((row) => {
    const decision =
      row.decision_id === null
        ? null
        : {
            useCase: row.use_case ?? "",
            isCurrent: row.decision_current === true,
            stage: row.decision_stage ?? "",
            displayAllowed: row.decision_display_allowed === true,
            territory: row.territory,
            validFrom: row.valid_from ?? new Date(8.64e15),
            validUntil: row.valid_until,
          };
    const license =
      row.decision_id === null || row.license_status === null
        ? null
        : {
            isCurrent: row.license_current === true,
            licenseStatus: row.license_status,
            displayAllowed: row.license_display_allowed === true,
            scoreAllowed: row.score_allowed === true,
            contentType: row.content_type ?? "",
            ratingSourceKey: row.rating_source_key,
          };
    const value = numOrNull(row.rating_value);
    const verdict = explainRatingRow(
      {
        ratingSource: row.rating_source,
        rowDisplayAllowed: row.row_display_allowed,
        scoreType: row.score_type,
        ratingValue: value,
        fetchedAt: row.fetched_at,
        requiresAttribution: row.requires_attribution,
        attributionText: row.attribution_text,
        requiresLinkback: row.requires_linkback,
        attributionUrl: row.attribution_url,
        decision,
        license,
      },
      now,
    );
    return {
      id: row.id,
      source: row.rating_source,
      label: row.rating_label,
      metric: row.metric,
      value,
      scale: row.rating_scale,
      count: row.rating_count,
      providerApi: row.provider_api,
      fetchedAt: row.fetched_at,
      visible: verdict.visible,
      refusals: verdict.refusals,
    };
  });

  let omdbCacheFetchedAt: Date | null = null;
  if (identity.imdbId !== null) {
    const cache = await db.$queryRaw<Array<{ fetched_at: Date }>>`
      SELECT fetched_at FROM api_cache
       WHERE provider_api = 'omdb' AND request_key LIKE ${`%${escapeLike(identity.imdbId)}%`} ESCAPE '\\'
       ORDER BY fetched_at DESC
       LIMIT 1`;
    omdbCacheFetchedAt = cache[0]?.fetched_at ?? null;
  }

  const visible = ratings.filter((row) => row.visible).length;
  let summary: string;
  if (visible > 0) {
    summary = `${String(visible)} nota(s) aparece(m) na página.`;
  } else if (ratings.length > 0) {
    summary = `${String(ratings.length)} nota(s) gravada(s) e nenhuma exibível: veja o motivo de cada linha.`;
  } else if (identity.imdbId === null) {
    summary = "Nenhuma nota gravada, e o título não tem imdb_id: a OMDb consulta por IMDb id e não alcança este título.";
  } else if (omdbCacheFetchedAt !== null) {
    summary = `Nenhuma nota gravada, mas há resposta da OMDb em cache de ${formatDayBrt(omdbCacheFetchedAt)}: a OMDb não tinha nota para este título, ou a gravação recusou.`;
  } else {
    summary = "Nenhuma nota gravada: a OMDb ainda não foi consultada para este título.";
  }
  return { rows: ratings, omdbCacheFetchedAt, summary };
}

async function readScore(db: OpsPrisma, identity: TitleIdentity, now: Date): Promise<ScoreDiag> {
  const nowIso = now.toISOString();
  const decisions = await db.$queryRaw<Array<{ id: string }>>`
    SELECT d.id::text AS id
      FROM data_usage_decisions d
      JOIN source_licenses l ON l.id = d.source_license_id
     WHERE d.use_case = 'cinerie_score_display'
       AND d.is_current = true
       AND l.is_current = true
       AND d.stage = 'approved_for_display'
       AND d.display_allowed = true
       AND d.derivative_allowed = true
       AND d.valid_from <= ${nowIso}::timestamptz AT TIME ZONE 'UTC'
       AND (d.valid_until IS NULL OR d.valid_until > ${nowIso}::timestamptz AT TIME ZONE 'UTC')
     LIMIT 1`;
  const authorized = decisions.length > 0;
  const calculations = await db.$queryRaw<Array<{ status: string; value: unknown; version: string; calculated_at: Date; blocked_reason: string | null; explanation: unknown }>>`
    SELECT status::text AS status, value, version, calculated_at, blocked_reason, explanation
      FROM cinerie_score_calculations
     WHERE entity_type = ${identity.kind}::"EntityType" AND entity_id = ${identity.id}::bigint
     ORDER BY calculated_at DESC, id DESC
     LIMIT 5`;
  const history = calculations.map((row) => ({
    status: row.status,
    value: numOrNull(row.value),
    version: row.version,
    calculatedAt: row.calculated_at,
    blockedReason: row.blocked_reason,
    sources: parseExplanationSources(row.explanation),
  }));
  // A pagina le o ULTIMO calculo `calculated` (entity-hero.ts).
  const latestCalculated = history.find((row) => row.status === "calculated") ?? null;
  const verdict = explainCinerieScore({
    authorized,
    value: latestCalculated?.value ?? null,
    explanationSources: latestCalculated?.sources ?? [],
  });
  return { authorized, history, verdict };
}

async function readVideos(db: OpsPrisma, identity: TitleIdentity): Promise<readonly VideoDiag[]> {
  const rows = await db.$queryRaw<
    Array<{ id: string; site: string; video_key: string; name: string | null; video_type: string | null; official: boolean | null; language_code: string | null; published_at: Date | null; license_status: string; display_allowed: boolean }>
  >`
    SELECT id::text AS id, site, video_key, name, video_type, official, language_code, published_at,
           license_status::text AS license_status, display_allowed
      FROM tmdb_videos
     WHERE entity_type = ${identity.kind}::"TmdbEntityKind" AND tmdb_id = ${identity.tmdbId}::int
     ORDER BY published_at DESC NULLS LAST, id DESC
     LIMIT 50`;
  return rows.map((row) => {
    const verdict = explainTrailerRow({
      displayAllowed: row.display_allowed,
      licenseStatus: row.license_status,
      site: row.site,
      videoType: row.video_type,
      videoKey: row.video_key,
    });
    return {
      id: row.id,
      site: row.site,
      key: row.video_key,
      name: row.name,
      type: row.video_type,
      official: row.official,
      language: row.language_code,
      publishedAt: row.published_at,
      licenseStatus: row.license_status,
      displayAllowed: row.display_allowed,
      visible: verdict.visible,
      refusals: verdict.refusals,
    };
  });
}

async function readImages(db: OpsPrisma, identity: TitleIdentity): Promise<ImagesDiag> {
  const byType = await db.$queryRaw<Array<{ image_type: string; total: unknown; display_allowed: unknown; last_fetched: Date | null }>>`
    SELECT image_type, COUNT(*) AS total, COUNT(*) FILTER (WHERE display_allowed) AS display_allowed,
           MAX(fetched_at) AS last_fetched
      FROM tmdb_images
     WHERE entity_type = ${identity.kind}::"TmdbEntityKind" AND tmdb_id = ${identity.tmdbId}::int
     GROUP BY image_type
     ORDER BY image_type`;
  const license = await db.$queryRaw<Array<{ license_status: string; display_allowed: boolean }>>`
    SELECT license_status::text AS license_status, display_allowed
      FROM source_licenses
     WHERE source_key = 'tmdb' AND content_type::text = 'image' AND is_current = true
     LIMIT 1`;
  const current = license[0];
  return {
    byType: byType.map((row) => ({
      type: row.image_type,
      total: num(row.total),
      displayAllowed: num(row.display_allowed),
      lastFetchedAt: row.last_fetched,
    })),
    source: explainImageSource(current === undefined ? null : { licenseStatus: current.license_status, displayAllowed: current.display_allowed }),
  };
}

async function readJobs(db: OpsPrisma, identity: TitleIdentity, now: Date): Promise<JobsDiag> {
  const kinds = identity.kind === "movie" ? ["movie"] : ["tv", "season", "episode"];
  const rows = await db.$queryRaw<
    Array<{ id: string; job_type: string; status: string; entity_type: string | null; priority: number; attempts: number; max_attempts: number; run_id: string | null; last_error_code: string | null; available_at: Date; created_at: Date; completed_at: Date | null }>
  >`
    SELECT id::text AS id, job_type::text AS job_type, status::text AS status, entity_type::text AS entity_type,
           priority, attempts, max_attempts, run_id, last_error_code, available_at, created_at, completed_at
      FROM catalog_jobs
     WHERE entity_type::text = ANY(${kinds}::text[]) AND external_id = ${String(identity.tmdbId)}
     ORDER BY id DESC
     LIMIT 30`;

  const jobs: JobDiag[] = [];
  for (const row of rows) {
    let ahead: number | null = null;
    let aheadReason: string | null = null;
    if (row.status === "pending" || row.status === "retry_wait") {
      if (row.available_at.getTime() > now.getTime()) {
        aheadReason = "aguardando a janela de nova tentativa";
      } else {
        const measured = await measure(
          "catalog_jobs (posição)",
          () =>
            withStatementTimeout(QUERY_TIMEOUT_MS, async (tx) => {
              const count = await tx.$queryRaw<Array<{ n: unknown }>>`
                SELECT COUNT(*) AS n FROM catalog_jobs c
                 WHERE c.status IN ('pending', 'retry_wait')
                   AND c.available_at <= ${now.toISOString()}::timestamptz AT TIME ZONE 'UTC'
                   AND (c.priority < ${row.priority}::int
                        OR (c.priority = ${row.priority}::int
                            AND c.available_at < ${row.available_at.toISOString()}::timestamptz AT TIME ZONE 'UTC'))`;
              return num(count[0]?.n);
            }),
          () => now,
        );
        if (measured.ok) ahead = measured.value;
        else aheadReason = `posição não determinada: ${measured.reason}`;
      }
    } else if (row.status === "claimed" || row.status === "running") {
      aheadReason = "em execução agora";
    }
    jobs.push({
      id: row.id,
      jobType: row.job_type,
      status: row.status,
      entityType: row.entity_type,
      priority: row.priority,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      runId: row.run_id,
      lastErrorCode: row.last_error_code,
      availableAt: row.available_at,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      ahead,
      aheadReason,
    });
  }

  const succeededLast6h = await measure(
    "catalog_jobs (concluídos nas últimas 6 h)",
    () =>
      withStatementTimeout(QUERY_TIMEOUT_MS, async (tx) => {
        const since = new Date(now.getTime() - 6 * HOUR_MS).toISOString();
        const count = await tx.$queryRaw<Array<{ n: unknown }>>`
          SELECT COUNT(*) AS n FROM catalog_jobs
           WHERE status = 'succeeded' AND completed_at >= ${since}::timestamptz AT TIME ZONE 'UTC'`;
        return num(count[0]?.n);
      }),
    () => now,
  );
  return { jobs, succeededLast6h };
}

async function readIndexability(db: OpsPrisma, identity: TitleIdentity): Promise<IndexDiag> {
  const slugs = await db.$queryRaw<Array<{ slug: string }>>`
    SELECT slug FROM slugs
     WHERE entity_type = ${identity.kind}::"EntityType" AND entity_id = ${identity.id}::bigint
       AND language_code = 'pt-BR' AND is_canonical = true
     LIMIT 1`;
  const decisions = await db.$queryRaw<Array<{ decision: string; reason: string | null; decision_origin: string | null; decided_at: Date | null; created_at: Date }>>`
    SELECT decision::text AS decision, reason, decision_origin, decided_at, created_at
      FROM page_indexability_decisions
     WHERE entity_type = ${identity.kind}::"EntityType" AND entity_id = ${identity.id}::bigint
       AND language_code = 'pt-BR' AND is_current = true
     ORDER BY created_at DESC
     LIMIT 1`;
  const slug = slugs[0]?.slug ?? null;
  const row = decisions[0];
  const decision =
    row === undefined
      ? null
      : { decision: row.decision, reason: row.reason, origin: row.decision_origin, decidedAt: row.decided_at, createdAt: row.created_at };
  if (slug === null) {
    return { slug, decision, verdict: "noindex", verdictText: "noindex técnico: o título não tem slug canônico pt-BR (a página não existe)", publicUrl: null };
  }
  if (decision !== null && decision.decision !== "index") {
    return {
      slug,
      decision,
      verdict: "noindex",
      verdictText: `a decisão vigente é "${decision.decision}"${decision.reason === null ? "" : ` (${decision.reason})`}: a página emite essa decisão`,
      publicUrl: publicTitleUrl(identity.kind, slug),
    };
  }
  return {
    slug,
    decision,
    verdict: "index",
    verdictText: decision === null ? "index: slug canônico pt-BR e nenhuma decisão mais restritiva" : "index: decisão vigente index",
    publicUrl: publicTitleUrl(identity.kind, slug),
  };
}

async function readAudits(db: OpsPrisma, identity: TitleIdentity): Promise<readonly AuditMini[]> {
  const rows = await db.$queryRaw<Array<{ id: string; action_kind: string; outcome: string; outcome_detail: string | null; actor_label: string; requested_at: Date }>>`
    SELECT id::text AS id, action_kind, outcome, outcome_detail, actor_label, requested_at
      FROM admin_action_audits
     WHERE entity_type = ${identity.kind}::"EntityType" AND entity_id = ${identity.id}::bigint
     ORDER BY id DESC
     LIMIT 10`;
  return rows.map((row) => ({
    id: row.id,
    actionKind: row.action_kind,
    outcome: row.outcome,
    detail: row.outcome_detail,
    actorLabel: row.actor_label,
    requestedAt: row.requested_at,
  }));
}

/** A ficha de diagnostico. `value: null` = o titulo nao existe. */
export async function getTitleDiagnosis(kind: TitleKind, id: string, now: Date): Promise<Measured<TitleDiagnosis | null>> {
  const db = opsDb();
  const identity = await measure(kind === "movie" ? "movies" : "tv_shows", () => readTitleIdentity(db, kind, id), () => now);
  if (!identity.ok) return identity;
  if (identity.value === null) return { ok: true, value: null, source: identity.source, measuredAt: now };
  const title = identity.value;

  const [translations, payloads, ratings, score, videos, images, jobs, indexability, audits, omdbSpentToday] = await Promise.all([
    measure("entity_translations", () => readTranslations(db, kind, id), () => now),
    measure("api_cache + tmdb_raw (payload do TMDB)", () => readPayloads(db, kind, title.tmdbId), () => now),
    measure("external_ratings + data_usage_decisions + source_licenses + api_cache (omdb)", () => readRatings(db, title, now), () => now),
    measure("cinerie_score_calculations + data_usage_decisions", () => readScore(db, title, now), () => now),
    measure("tmdb_videos", () => readVideos(db, title), () => now),
    measure("tmdb_images + source_licenses (tmdb/image)", () => readImages(db, title), () => now),
    measure("catalog_jobs", () => readJobs(db, title, now), () => now),
    measure("slugs + page_indexability_decisions", () => readIndexability(db, title), () => now),
    measure("admin_action_audits", () => readAudits(db, title), () => now),
    readOmdbSpentToday(now),
  ]);

  return {
    ok: true,
    value: {
      identity: title,
      shape: titleShapeOf(title),
      translations,
      payloads,
      ratings,
      score,
      videos,
      images,
      jobs,
      indexability,
      audits,
      omdbSpentToday,
    },
    source: identity.source,
    measuredAt: now,
  };
}
