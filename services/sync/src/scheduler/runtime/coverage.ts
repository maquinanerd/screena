/**
 * runtime/coverage.ts — A COBERTURA do catalogo, medida no banco. Adapter Prisma.
 * COBERTO pelo typecheck da raiz (`pnpm typecheck`).
 *
 * ============================================================================
 * A PERGUNTA QUE CUSTAVA QUATRO CONSULTAS
 * ============================================================================
 * "Quanto do catalogo tem sinopse? Nota exibivel? Trailer? Quanto indexa?" Cada
 * resposta morava numa tabela diferente, com um portao diferente, e foi escrita
 * a mao quatro vezes no mesmo dia. Aqui ela e UMA medida, com metodo versionado,
 * usada por dois leitores:
 *
 *   - a fila `catalog_coverage` do agendador, que grava um retrato por dia em
 *     `catalog_coverage_snapshots` (a linha que sobe ou nao sobe);
 *   - a tela Cobertura do painel operacional, que mede AO VIVO.
 *
 * ============================================================================
 * CADA COLUNA USA O PORTAO QUE A PAGINA USA — NAO UMA APROXIMACAO
 * ============================================================================
 *   trailer        -> o gate da LINHA de `tmdb_videos` (isDisplayableTrailerRow)
 *   nota exibivel  -> o gate de LEITURA de `external_ratings` (toPublicRating):
 *                     decisao `rating_display` vigente e valida, territorio BR,
 *                     licenca-mae exibivel com `score_allowed`, frescor pela
 *                     `RATING_STALE_POLICY`, `score_type` e credito
 *   biografia      -> texto E `biography_source_status` exibivel
 *   indexavel      -> slug canonico pt-BR E nenhuma decisao vigente mais
 *                     restritiva que `index`; temporada e episodio estao
 *                     SUSPENSOS pela valvula de 2026-08-27 e contam zero
 *
 * Os gates vivem em `apps/web`, que um servico nao importa. A copia em SQL e
 * travada por teste de espelho (mesmas constantes) e pelo validador com PostgreSQL
 * real (mesmo resultado linha a linha que o gate em TypeScript).
 *
 * `null` numa metrica e NAO SE APLICA (episodio nao tem nota externa), nunca
 * "zero por omissao".
 *
 * ============================================================================
 * SO LEITURA, E COM TETO DE TEMPO
 * ============================================================================
 * A medida roda numa transacao `READ ONLY` com `statement_timeout`: episodio sao
 * milhoes de linhas, e uma consulta que passa do teto vira ERRO visivel ("nao
 * determinado"), nunca um numero parcial.
 */

import type { PrismaClient } from '@screena/db/server'
import { RATING_SOURCES, RATING_STALE_POLICY } from '@screena/config'

/** Versao do metodo. Mudar qualquer definicao abaixo muda a versao. */
export const COVERAGE_METHOD_VERSION = 'coverage/v1'

/** Os tipos medidos. */
export const COVERAGE_KINDS = ['movie', 'tv', 'season', 'episode', 'person'] as const

/** Um tipo medido. */
export type CoverageKind = (typeof COVERAGE_KINDS)[number]

/** Rotulo do total de um tipo (todos os idiomas). */
export const COVERAGE_ALL_LANGUAGES = '*'

/** Rotulo de titulo sem idioma original. */
export const COVERAGE_UNKNOWN_LANGUAGE = '?'

/** O idioma cuja pagina decide a indexacao. */
export const COVERAGE_PAGE_LANGUAGE = 'pt-BR'

/** Os idiomas cujo titulo traduzido conta como titulo. Espelha PUBLISHED_LOCALES. */
export const COVERAGE_TITLE_LANGUAGES: readonly string[] = ['pt-BR', 'pt']

/** Id de video do YouTube. Espelha YOUTUBE_VIDEO_ID_PATTERN (@screena/public-contracts). */
export const YOUTUBE_VIDEO_ID_SQL_PATTERN = '^[A-Za-z0-9_-]{11}$'

/** Tipos de video que viram trailer na pagina. Espelha TRAILER_TYPE_RANK (apps/web). */
export const TRAILER_VIDEO_TYPES: readonly string[] = ['Trailer', 'Teaser']

/** Estados de licenca que permitem exibir. */
export const DISPLAYABLE_LICENSE_STATUSES: readonly string[] = ['official', 'licensed', 'third_party']

/** Caso de uso que autoriza exibir nota de terceiro. */
export const RATING_DISPLAY_USE_CASE = 'rating_display'

/** Territorio de exibicao das notas. */
export const RATING_DISPLAY_TERRITORY = 'BR'

/**
 * Tipos suspensos do indice. Espelha SUSPENDED_PAGE_TYPES (apps/web): vazia desde
 * 22/09/2026, quando temporada e episodio sairam da valvula por dado.
 */
export const SUSPENDED_INDEX_KINDS: readonly CoverageKind[] = []

/**
 * O portao de CONTEUDO de temporada e episodio, na aproximacao do painel.
 * Espelha `MIN_SYNOPSIS_CHARS`, `SYNOPSIS_TRIM_CHARS` e
 * `MIN_SEASON_EPISODES_WITH_SYNOPSIS` (`@screena/seo`); o teste de espelho
 * trava os valores. Como o `indexable` de filme, serie e pessoa, e o que o
 * DADO permite — slug da serie e nenhuma decisao restritiva —, sem o portao de
 * localizacao da serie, que e da pagina.
 */
export const COVERAGE_MIN_SYNOPSIS_CHARS = 60
export const COVERAGE_MIN_SEASON_EPISODES_WITH_SYNOPSIS = 3

/** Sinopse que chega ao piso: mesma medida da pagina (`char_length` depois do trim). */
export function realSynopsisSql(column: string): string {
  return `(char_length(BTRIM(COALESCE(${column}, ''), E' \\t\\r\\n')) >= ${COVERAGE_MIN_SYNOPSIS_CHARS})`
}

/** A serie dona tem slug canonico no idioma da pagina. */
function seriesSlugSql(seriesIdColumn: string): string {
  return `EXISTS (
      SELECT 1 FROM slugs s
       WHERE s.entity_type = 'tv'::"EntityType" AND s.entity_id = ${seriesIdColumn}
         AND s.language_code = '${COVERAGE_PAGE_LANGUAGE}' AND s.is_canonical = true)`
}

/** Nenhuma decisao vigente mais restritiva que `index` para a entidade. */
function noRestrictiveDecisionSql(kind: 'season' | 'episode', idColumn: string): string {
  return `NOT EXISTS (
      SELECT 1 FROM page_indexability_decisions pd
       WHERE pd.entity_type = '${kind}'::"EntityType" AND pd.entity_id = ${idColumn}
         AND pd.language_code = '${COVERAGE_PAGE_LANGUAGE}' AND pd.is_current = true
         AND pd.decision::text <> 'index')`
}

/** Uma linha de cobertura. `null` = nao se aplica ao tipo. */
export interface CoverageRow {
  readonly entityKind: CoverageKind
  readonly originalLanguage: string
  readonly total: number
  readonly withTitle: number | null
  readonly withSynopsis: number | null
  readonly withPoster: number | null
  readonly withTrailer: number | null
  readonly withDisplayableRating: number | null
  readonly indexable: number | null
}

/** Uma medida inteira. */
export interface CoverageMeasurement {
  readonly measuredAt: Date
  readonly methodVersion: string
  readonly rows: readonly CoverageRow[]
}

/** Lista SQL de constantes DO CODIGO (nunca entrada de usuario). */
function sqlList(values: readonly string[]): string {
  return values.map((value) => `'${value.replace(/'/g, "''")}'`).join(', ')
}

const NOW = `($1::timestamptz AT TIME ZONE 'UTC')`

/** A validade maxima (horas) de uma nota, por fonte. Fonte sem politica = NULL. */
function expireHoursCase(column: string): string {
  const whens = Object.entries(RATING_STALE_POLICY)
    .map(([source, policy]) => `WHEN '${source}' THEN ${String(policy.expireAfterHours)}`)
    .join(' ')
  return `(CASE ${column} ${whens} ELSE NULL END)`
}

/** Existe nota externa EXIBIVEL para o titulo `e`? O gate de leitura inteiro. */
export function displayableRatingExistsSql(kind: 'movie' | 'tv'): string {
  return `EXISTS (
    SELECT 1
      FROM external_ratings r
      JOIN data_usage_decisions d ON d.id = r.data_usage_decision_id
      JOIN source_licenses l ON l.id = d.source_license_id
     WHERE r.entity_type = '${kind}'::"EntityType"
       AND r.entity_id = e.id
       AND r.display_allowed = true
       AND r.rating_source IN (${sqlList(RATING_SOURCES)})
       AND r.score_type IS NOT NULL
       AND (r.requires_attribution = false OR BTRIM(COALESCE(r.attribution_text, '')) <> '')
       AND (r.requires_linkback = false OR BTRIM(COALESCE(r.attribution_url, '')) <> '')
       AND r.fetched_at IS NOT NULL
       AND r.fetched_at <= ${NOW}
       AND ${NOW} < r.fetched_at + make_interval(hours => ${expireHoursCase('r.rating_source')})
       AND d.use_case = '${RATING_DISPLAY_USE_CASE}'
       AND d.is_current = true
       AND d.stage = 'approved_for_display'
       AND d.display_allowed = true
       AND d.valid_from <= ${NOW}
       AND (d.valid_until IS NULL OR d.valid_until > ${NOW})
       AND (d.territory IS NULL OR d.territory = '${RATING_DISPLAY_TERRITORY}')
       AND l.is_current = true
       AND l.license_status::text IN (${sqlList(DISPLAYABLE_LICENSE_STATUSES)})
       AND l.display_allowed = true
       AND l.score_allowed = true
       AND l.content_type = 'rating'
       AND l.rating_source_key = r.rating_source)`
}

/** Existe trailer EXIBIVEL? O gate da linha de `tmdb_videos`. */
export function displayableTrailerExistsSql(kind: 'movie' | 'tv' | 'season', tmdbIdExpr: string): string {
  return `EXISTS (
    SELECT 1
      FROM tmdb_videos v
     WHERE v.entity_type = '${kind}'::"TmdbEntityKind"
       AND v.tmdb_id = ${tmdbIdExpr}
       AND v.display_allowed = true
       AND v.license_status::text NOT IN ('unknown', 'blocked')
       AND v.site = 'YouTube'
       AND v.video_type IN (${sqlList(TRAILER_VIDEO_TYPES)})
       AND v.video_key ~ '${YOUTUBE_VIDEO_ID_SQL_PATTERN}')`
}

/** A pagina emite `index`? Slug canonico pt-BR e nenhuma decisao mais restritiva. */
export function indexableSql(kind: 'movie' | 'tv' | 'person'): string {
  return `(EXISTS (
      SELECT 1 FROM slugs s
       WHERE s.entity_type = '${kind}'::"EntityType" AND s.entity_id = e.id
         AND s.language_code = '${COVERAGE_PAGE_LANGUAGE}' AND s.is_canonical = true)
    AND NOT EXISTS (
      SELECT 1 FROM page_indexability_decisions pd
       WHERE pd.entity_type = '${kind}'::"EntityType" AND pd.entity_id = e.id
         AND pd.language_code = '${COVERAGE_PAGE_LANGUAGE}' AND pd.is_current = true
         AND pd.decision::text <> 'index'))`
}

function nonEmpty(column: string): string {
  return `(BTRIM(COALESCE(${column}, '')) <> '')`
}

interface KindSql {
  readonly from: string
  readonly language: string | null
  readonly title: string
  readonly synopsis: string
  readonly poster: string
  readonly trailer: string | null
  readonly rating: string | null
  readonly indexable: string
}

function titleOf(kind: 'movie' | 'tv', originalColumn: string): string {
  return `(${nonEmpty(`e.${originalColumn}`)} OR EXISTS (
      SELECT 1 FROM entity_translations t
       WHERE t.entity_type = '${kind}'::"EntityType" AND t.entity_id = e.id
         AND t.language_code IN (${sqlList(COVERAGE_TITLE_LANGUAGES)})
         AND ${nonEmpty('t.title')}))`
}

function synopsisOf(kind: 'movie' | 'tv'): string {
  return `EXISTS (
      SELECT 1 FROM entity_translations t
       WHERE t.entity_type = '${kind}'::"EntityType" AND t.entity_id = e.id
         AND ${nonEmpty('t.summary')})`
}

function kindSql(kind: CoverageKind): KindSql {
  switch (kind) {
    case 'movie':
    case 'tv':
      return {
        from: kind === 'movie' ? 'movies e' : 'tv_shows e',
        language: `COALESCE(e.original_language, '${COVERAGE_UNKNOWN_LANGUAGE}')`,
        title: titleOf(kind, kind === 'movie' ? 'title_original' : 'name_original'),
        synopsis: synopsisOf(kind),
        poster: nonEmpty('e.poster_path'),
        trailer: displayableTrailerExistsSql(kind, 'e.tmdb_id'),
        rating: displayableRatingExistsSql(kind),
        indexable: indexableSql(kind),
      }
    case 'season':
      return {
        from: 'seasons e',
        language: null,
        title: nonEmpty('e.name'),
        synopsis: nonEmpty('e.overview'),
        poster: nonEmpty('e.poster_path'),
        trailer: `(e.tmdb_id IS NOT NULL AND ${displayableTrailerExistsSql('season', 'e.tmdb_id')})`,
        rating: null,
        indexable: `(e.season_number >= 1
          AND ${seriesSlugSql('e.tv_show_id')}
          AND (${realSynopsisSql('e.overview')}
            OR (SELECT COUNT(*) FROM (
                 SELECT 1 FROM episodes ep
                  WHERE ep.season_id = e.id AND ${realSynopsisSql('ep.overview')}
                  LIMIT ${COVERAGE_MIN_SEASON_EPISODES_WITH_SYNOPSIS}) guia)
               >= ${COVERAGE_MIN_SEASON_EPISODES_WITH_SYNOPSIS})
          AND ${noRestrictiveDecisionSql('season', 'e.id')})`,
      }
    case 'episode':
      return {
        from: 'episodes e',
        language: null,
        title: nonEmpty('e.name'),
        synopsis: nonEmpty('e.overview'),
        poster: nonEmpty('e.still_path'),
        trailer: null,
        rating: null,
        indexable: `(e.episode_number >= 1
          AND ${seriesSlugSql('e.tv_show_id')}
          AND ${realSynopsisSql('e.overview')}
          AND ${nonEmpty('e.still_path')}
          AND ${noRestrictiveDecisionSql('episode', 'e.id')})`,
      }
    case 'person':
      return {
        from: 'people e',
        language: null,
        title: nonEmpty('e.name'),
        synopsis: `(${nonEmpty('e.biography')} AND e.biography_source_status::text IN (${sqlList(DISPLAYABLE_LICENSE_STATUSES)}))`,
        poster: nonEmpty('e.profile_path'),
        trailer: null,
        rating: null,
        indexable: indexableSql('person'),
      }
  }
}

/**
 * O SQL de UM tipo. `$1` e o instante da medida.
 *
 * Filme e serie saem POR IDIOMA ORIGINAL e com o total (`GROUPING SETS`); os
 * demais so com o total.
 */
export function coverageSql(kind: CoverageKind): string {
  const spec = kindSql(kind)
  // Tipo suspenso pela valvula conta zero indexavel: a pagina dele emite
  // `noindex` independentemente do dado. Vazia desde 22/09/2026.
  const indexable = SUSPENDED_INDEX_KINDS.includes(kind) ? 'false' : spec.indexable
  const flag = (name: string, expression: string | null): string =>
    expression === null ? `NULL::boolean AS ${name}` : `(${expression}) AS ${name}`
  const count = (name: string, applies: boolean): string =>
    applies ? `COUNT(*) FILTER (WHERE ${name})::int AS ${name}` : `NULL::int AS ${name}`

  const base = `
    WITH base AS (
      SELECT ${spec.language === null ? `'${COVERAGE_ALL_LANGUAGES}'` : spec.language} AS lang,
             ${flag('with_title', spec.title)},
             ${flag('with_synopsis', spec.synopsis)},
             ${flag('with_poster', spec.poster)},
             ${flag('with_trailer', spec.trailer)},
             ${flag('with_displayable_rating', spec.rating)},
             ${flag('indexable', indexable)}
        FROM ${spec.from}
    )`
  const columns = `
             COUNT(*)::int AS total,
             ${count('with_title', true)},
             ${count('with_synopsis', true)},
             ${count('with_poster', true)},
             ${count('with_trailer', spec.trailer !== null)},
             ${count('with_displayable_rating', spec.rating !== null)},
             ${count('indexable', true)}`

  if (spec.language === null) {
    return `${base}
    SELECT '${COVERAGE_ALL_LANGUAGES}' AS lang,${columns}
      FROM base`
  }
  return `${base}
    SELECT CASE WHEN GROUPING(lang) = 1 THEN '${COVERAGE_ALL_LANGUAGES}' ELSE lang END AS lang,${columns}
      FROM base
     GROUP BY GROUPING SETS ((lang), ())`
}

interface RawCoverageRow {
  readonly lang: string
  readonly total: number
  readonly with_title: number | null
  readonly with_synopsis: number | null
  readonly with_poster: number | null
  readonly with_trailer: number | null
  readonly with_displayable_rating: number | null
  readonly indexable: number | null
}

function toInt(value: number | bigint | null): number | null {
  if (value === null) return null
  return typeof value === 'bigint' ? Number(value) : value
}

/** A capacidade de banco da medida. */
export type CoverageDb = Pick<PrismaClient, '$transaction'>

/** Opcoes da medida. */
export interface MeasureCoverageOptions {
  readonly kinds?: readonly CoverageKind[]
  /** Teto de CADA consulta. Estourou = erro, nunca numero parcial. */
  readonly statementTimeoutMs?: number
}

/**
 * Mede a cobertura. Transacao `READ ONLY` com `statement_timeout`.
 *
 * Lanca se qualquer consulta falhar ou estourar o teto: quem chama decide mostrar
 * "nao determinado". Uma medida pela metade nao sai daqui.
 */
export async function measureCatalogCoverage(
  prisma: CoverageDb,
  now: Date,
  options: MeasureCoverageOptions = {},
): Promise<CoverageMeasurement> {
  const kinds = options.kinds ?? COVERAGE_KINDS
  const timeoutMs = Math.max(1_000, Math.trunc(options.statementTimeoutMs ?? 120_000))
  const rows: CoverageRow[] = []

  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${String(timeoutMs)}`)
      for (const kind of kinds) {
        const sql = coverageSql(kind)
        // So filme e serie usam `$1` (o relogio do gate de nota). Mandar um
        // parametro para uma consulta que nao o declara faz o PostgreSQL recusar
        // o bind — a medida de temporada morreria por um argumento a mais.
        const params = sql.includes('$1') ? [now.toISOString()] : []
        const raw = await tx.$queryRawUnsafe<RawCoverageRow[]>(sql, ...params)
        for (const row of raw) {
          rows.push({
            entityKind: kind,
            originalLanguage: row.lang,
            total: toInt(row.total) ?? 0,
            withTitle: toInt(row.with_title),
            withSynopsis: toInt(row.with_synopsis),
            withPoster: toInt(row.with_poster),
            withTrailer: toInt(row.with_trailer),
            withDisplayableRating: toInt(row.with_displayable_rating),
            indexable: toInt(row.indexable),
          })
        }
      }
    },
    { timeout: timeoutMs * Math.max(1, kinds.length) + 10_000, maxWait: 10_000 },
  )

  return { measuredAt: now, methodVersion: COVERAGE_METHOD_VERSION, rows }
}

/** A capacidade de banco do retrato. */
export type CoverageSnapshotDb = Pick<PrismaClient, '$executeRawUnsafe'>

/**
 * Grava o retrato do DIA (UTC). Um retrato por (dia, tipo, idioma): o segundo
 * ciclo do mesmo dia nao sobrescreve o primeiro — ele e `skipped`, e isso e o
 * certo, porque o retrato e da manha e nao da ultima hora.
 */
export async function writeCoverageSnapshot(
  db: CoverageSnapshotDb,
  measurement: CoverageMeasurement,
): Promise<{ readonly written: number; readonly skipped: number }> {
  const day = measurement.measuredAt.toISOString().slice(0, 10)
  let written = 0
  let skipped = 0
  for (const row of measurement.rows) {
    const inserted = await db.$executeRawUnsafe(
      `INSERT INTO catalog_coverage_snapshots
         (captured_on, captured_at, method_version, entity_kind, original_language, total,
          with_title, with_synopsis, with_poster, with_trailer, with_displayable_rating, indexable)
       VALUES ($1::date, $2::timestamptz AT TIME ZONE 'UTC', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (captured_on, entity_kind, original_language) DO NOTHING`,
      day,
      measurement.measuredAt.toISOString(),
      measurement.methodVersion,
      row.entityKind,
      row.originalLanguage,
      row.total,
      row.withTitle,
      row.withSynopsis,
      row.withPoster,
      row.withTrailer,
      row.withDisplayableRating,
      row.indexable,
    )
    if (inserted > 0) written += 1
    else skipped += 1
  }
  return { written, skipped }
}
