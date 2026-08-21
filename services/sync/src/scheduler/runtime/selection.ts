/**
 * runtime/selection.ts — QUEM entra em cada fila, e em que ORDEM.
 * EXCLUIDO do typecheck principal (toca Prisma).
 *
 * ============================================================================
 * A ORDEM E `popularity DESC`, E ISSO NAO E DETALHE
 * ============================================================================
 * Ver o cabecalho de `../priority.ts` para o argumento completo. Em uma linha:
 * `id ASC` e ordem de INSERCAO, e com uma volta de dez dias ela deixa o titulo
 * mais aberto do site esperando atras de novecentos que ninguem abriu.
 *
 * `popularity DESC NULLS LAST, id ASC` continua sendo ordem TOTAL — o desempate
 * por `id` preserva o determinismo que a ordem antiga protegia.
 *
 * ============================================================================
 * O QUE SEPARA `title_detail_active` DE `title_detail_ended`
 * ============================================================================
 * O `status` do TMDB, e ele e diferente entre filme e serie:
 *
 *   FILME encerrado  -> `Released`; ativo -> qualquer outro (Planned,
 *                       In Production, Post Production, Rumored) OU sem data de
 *                       lancamento passada.
 *   SERIE encerrada  -> `Ended` / `Canceled`; ativa -> `Returning Series`,
 *                       `In Production`, `Planned`, `Pilot`.
 *
 * `status` NULO cai em ATIVO, nunca em encerrado. Fail-safe na direcao que so
 * custa requisicao: tratar desconhecido como encerrado congelaria por 30 dias um
 * titulo que pode estar estreando.
 */

import type { PrismaClient } from '@screena/db/server'

/** Um candidato de titulo, ja com a posicao no ranking de popularidade. */
export interface TitleCandidate {
  readonly entityType: 'movie' | 'tv'
  readonly tmdbId: number
  /** Posicao 1-based no ranking desta selecao (1 = mais popular). */
  readonly rank: number
}

/** Um candidato de pessoa. */
export interface PersonCandidate {
  readonly tmdbId: number
  readonly rank: number
}

const STALE_CLAUSE = `(e."stale_after" IS NULL OR e."stale_after" <= $1::timestamptz AT TIME ZONE 'UTC')`

/** Serie encerrada, no vocabulario do TMDB. */
const ENDED_TV_STATUSES = "('Ended', 'Canceled')"
/** Serie no ar / em producao. */
const AIRING_TV_STATUSES = "('Returning Series', 'In Production', 'Planned', 'Pilot')"

function rank<T extends { tmdbId: number }>(rows: readonly T[]): readonly (T & { rank: number })[] {
  return rows.map((row, index) => ({ ...row, rank: index + 1 }))
}

/**
 * Titulos cuja OFERTA precisa de refresh.
 *
 * O criterio NAO e `movies.stale_after` (que e do DETALHE): e a idade da oferta,
 * em `watch_availability.fetched_at`. Um titulo com detalhe fresco e oferta de
 * uma semana atras precisa de oferta, nao de detalhe — misturar as duas janelas
 * era exatamente o que fazia "onde assistir" envelhecer sem ninguem notar.
 *
 * Titulo que NUNCA teve oferta coletada entra tambem (o `NOT EXISTS`): sem isso,
 * a fila so cuidaria de quem ja tem oferta e um titulo novo nunca ganharia a
 * primeira.
 */
export async function selectStaleWatchOffers(
  prisma: PrismaClient,
  olderThan: Date,
  limit: number,
): Promise<readonly TitleCandidate[]> {
  const query = (table: string, entityType: 'movie' | 'tv'): string => `
    SELECT e."tmdb_id" AS tmdb_id
      FROM "${table}" e
     WHERE NOT EXISTS (
             SELECT 1 FROM "watch_availability" w
              WHERE w."entity_type" = '${entityType}'::"EntityType"
                AND w."entity_id" = e."id"
                AND w."fetched_at" >= $1::timestamptz AT TIME ZONE 'UTC'
           )
     ORDER BY e."popularity" DESC NULLS LAST, e."id" ASC
     LIMIT $2`

  const movies = await prisma.$queryRawUnsafe<Array<{ tmdb_id: number }>>(
    query('movies', 'movie'),
    olderThan.toISOString(),
    limit,
  )
  const shows = await prisma.$queryRawUnsafe<Array<{ tmdb_id: number }>>(
    query('tv_shows', 'tv'),
    olderThan.toISOString(),
    limit,
  )

  // Intercala filme e serie em vez de concatenar: concatenar faria a fatia
  // diaria consumir a lista de filmes inteira antes de tocar uma serie, e as
  // series ficariam com oferta velha por dias enquanto o relatorio dizia "ok".
  const out: TitleCandidate[] = []
  const max = Math.max(movies.length, shows.length)
  for (let i = 0; i < max; i += 1) {
    const movie = movies[i]
    const show = shows[i]
    if (movie !== undefined) out.push({ entityType: 'movie', tmdbId: movie.tmdb_id, rank: out.length + 1 })
    if (show !== undefined) out.push({ entityType: 'tv', tmdbId: show.tmdb_id, rank: out.length + 1 })
  }
  return out.slice(0, limit)
}

/** Series em exibicao/producao com detalhe vencido. */
export async function selectAiringSeries(
  prisma: PrismaClient,
  now: Date,
  limit: number,
): Promise<readonly TitleCandidate[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ tmdb_id: number }>>(
    `SELECT e."tmdb_id" AS tmdb_id
       FROM "tv_shows" e
      WHERE (e."status" IS NULL OR e."status" IN ${AIRING_TV_STATUSES})
        AND ${STALE_CLAUSE}
      ORDER BY e."popularity" DESC NULLS LAST, e."id" ASC
      LIMIT $2`,
    now.toISOString(),
    limit,
  )
  return rank(rows.map((row) => ({ entityType: 'tv' as const, tmdbId: row.tmdb_id })))
}

/**
 * Titulos por CLASSE de atividade, com detalhe vencido.
 *
 * `activity: 'ended'` seleciona filme `Released` e serie `Ended`/`Canceled`;
 * `'active'` seleciona o complemento, incluindo `status` nulo.
 */
export async function selectTitlesByActivity(
  prisma: PrismaClient,
  now: Date,
  activity: 'active' | 'ended',
  limit: number,
): Promise<readonly TitleCandidate[]> {
  const movieFilter =
    activity === 'ended'
      ? `e."status" = 'Released'`
      : `(e."status" IS NULL OR e."status" <> 'Released')`
  const tvFilter =
    activity === 'ended'
      ? `e."status" IN ${ENDED_TV_STATUSES}`
      : `(e."status" IS NULL OR e."status" NOT IN ${ENDED_TV_STATUSES})`

  const query = (table: string, filter: string): string => `
    SELECT e."tmdb_id" AS tmdb_id
      FROM "${table}" e
     WHERE ${filter}
       AND ${STALE_CLAUSE}
     ORDER BY e."popularity" DESC NULLS LAST, e."id" ASC
     LIMIT $2`

  const movies = await prisma.$queryRawUnsafe<Array<{ tmdb_id: number }>>(
    query('movies', movieFilter),
    now.toISOString(),
    limit,
  )
  const shows = await prisma.$queryRawUnsafe<Array<{ tmdb_id: number }>>(
    query('tv_shows', tvFilter),
    now.toISOString(),
    limit,
  )
  return rank([
    ...movies.map((row) => ({ entityType: 'movie' as const, tmdbId: row.tmdb_id })),
    ...shows.map((row) => ({ entityType: 'tv' as const, tmdbId: row.tmdb_id })),
  ])
}

/**
 * Pessoas com detalhe vencido.
 *
 * DUAS limitacoes DECLARADAS, nao descuidos:
 *
 *  1. `people` nao tem `popularity` no schema — a ordem cai para `id ASC`. A
 *     pessoa que importa (a que entrou num titulo novo) nao passa por esta fila:
 *     ela chega pelos creditos, no mesmo request do titulo.
 *  2. `people` tambem nao tem `stale_after`; a janela e calculada sobre
 *     `last_synced_at` pelo chamador e chega aqui como `olderThan`.
 */
export async function selectStalePeople(
  prisma: PrismaClient,
  olderThan: Date,
  limit: number,
): Promise<readonly PersonCandidate[]> {
  // `people` NAO tem `stale_after` (so `last_synced_at`), entao a janela e
  // aplicada aqui em vez de reusar STALE_CLAUSE. Nunca sincronizada
  // (`last_synced_at IS NULL`) conta como vencida.
  const rows = await prisma.$queryRawUnsafe<Array<{ tmdb_id: number }>>(
    `SELECT e."tmdb_id" AS tmdb_id
       FROM "people" e
      WHERE (e."last_synced_at" IS NULL
             OR e."last_synced_at" <= $1::timestamptz AT TIME ZONE 'UTC')
      ORDER BY e."id" ASC
      LIMIT $2`,
    olderThan.toISOString(),
    limit,
  )
  return rank(rows.map((row) => ({ tmdbId: row.tmdb_id })))
}
