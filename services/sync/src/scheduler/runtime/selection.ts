/**
 * runtime/selection.ts — QUEM entra em cada fila, e em que ORDEM.
 * COBERTO pelo typecheck da raiz (`pnpm typecheck`).
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

/**
 * Titulos cuja MIDIA precisa de refresh.
 *
 * ============================================================================
 * O CRITERIO E A IDADE DA MIDIA, NAO A DO DETALHE
 * ============================================================================
 * Mesma licao de `selectStaleWatchOffers`: `movies.stale_after` e do DETALHE. Um
 * filme lancado ha dez anos tem detalhe fresco por 30 dias (`title_detail_ended`)
 * e pode ganhar um trailer novo amanha. Misturar as duas janelas e o que fazia a
 * midia envelhecer sem ninguem notar.
 *
 * A idade vem de `tmdb_videos.fetched_at`/`tmdb_images.fetched_at` — as duas,
 * porque um titulo com imagem fresca e video de um mes ainda precisa de video, e
 * o job `sync_media` traz os dois na mesma execucao.
 *
 * Titulo que NUNCA teve midia coletada entra tambem (e o `NOT EXISTS` que o
 * garante): sem isso a fila so cuidaria de quem ja tem midia, e um titulo novo
 * nunca ganharia a primeira.
 */
export async function selectStaleTitleMedia(
  prisma: PrismaClient,
  olderThan: Date,
  limit: number,
): Promise<readonly TitleCandidate[]> {
  const query = (table: string, entityType: 'movie' | 'tv'): string => `
    SELECT e."tmdb_id" AS tmdb_id
      FROM "${table}" e
     WHERE NOT EXISTS (
             SELECT 1 FROM "tmdb_videos" v
              WHERE v."entity_type" = '${entityType}'::"TmdbEntityKind"
                AND v."tmdb_id" = e."tmdb_id"
                AND v."fetched_at" >= $1::timestamptz AT TIME ZONE 'UTC'
           )
       AND NOT EXISTS (
             SELECT 1 FROM "tmdb_images" i
              WHERE i."entity_type" = '${entityType}'::"TmdbEntityKind"
                AND i."tmdb_id" = e."tmdb_id"
                AND i."fetched_at" >= $1::timestamptz AT TIME ZONE 'UTC'
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

  // INTERCALA filme e serie, pelo mesmo motivo de `selectStaleWatchOffers`:
  // concatenar faria a fatia diaria consumir a lista de filmes inteira antes de
  // tocar uma serie, e as series ficariam sem trailer por dias enquanto o
  // relatorio dizia "ok".
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
  // INTERCALA e FATIA, como `selectStaleWatchOffers` e `selectStaleTitleMedia`.
  //
  // Ate 2026-08-28 esta funcao CONCATENAVA sem fatiar: com `limit = 200` ela
  // devolvia ate 400 candidatos (200 filmes + 200 series). O mesmo
  // `batchLimit` significava 200 em duas filas e 400 em outras duas — e um teto
  // que significa dois numeros nao e teto, e um palpite.
  //
  // Intercalar (em vez de concatenar e cortar) tambem conserta a segunda
  // metade do defeito: cortar a lista concatenada em 200 devolveria SO filmes,
  // e nenhuma serie entraria no ciclo.
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

/**
 * As posicoes do TRENDING vigente, por `tmdb_id`.
 *
 * ============================================================================
 * O SNAPSHOT VIGENTE, NAO O ULTIMO
 * ============================================================================
 * O filtro e `expires_at > now`, e nao "o mais recente". A diferenca importa: se
 * a fila `trending` parar (upstream fora do ar, cota, container morto), o ultimo
 * snapshot continua sendo o mais recente para SEMPRE, e a fila passaria a
 * priorizar pelo que estava em alta na semana passada — um sinal vencido
 * disfarcado de sinal fresco.
 *
 * Snapshot vencido => mapa VAZIO => a fila volta a ordenar por popularidade
 * acumulada, que e o comportamento anterior e continua correto. A degradacao e
 * para o estado seguro, e ela e VISIVEL: a fila `trending` cruza 2x o intervalo
 * e o alerta de fila parada dispara.
 *
 * ============================================================================
 * `position` E 0-BASED NO BANCO
 * ============================================================================
 * O store reindexa densamente a partir de ZERO
 * (`discovery-snapshot-store.ts`). A conversao para rank 1-based e de
 * `rankFromPosition` — passar a posicao crua mandaria o titulo mais trending do
 * dia para a faixa de cauda, porque `rank <= 0` significa "sem posicao medida".
 */
export async function selectTrendingRanks(
  prisma: PrismaClient,
  now: Date,
  window: 'day' | 'week',
  locale: string,
): Promise<ReadonlyMap<number, number>> {
  const rows = await prisma.$queryRawUnsafe<Array<{ tmdb_id: number; position: number }>>(
    `WITH vigente AS (
       SELECT s."id", s."entity_type"
         FROM "discovery_snapshots" s
        WHERE s."list_type" = 'trending'
          AND s."window" = $1
          AND s."locale" = $2
          AND s."expires_at" > $3::timestamptz AT TIME ZONE 'UTC'
        ORDER BY s."captured_at" DESC
     )
     SELECT m."tmdb_id" AS tmdb_id, i."position" AS position
       FROM vigente v
       JOIN "discovery_snapshot_items" i ON i."snapshot_id" = v."id"
       JOIN "movies" m ON m."id" = i."entity_id"
      WHERE v."entity_type" = 'movie'
      UNION ALL
     SELECT t."tmdb_id" AS tmdb_id, i."position" AS position
       FROM vigente v
       JOIN "discovery_snapshot_items" i ON i."snapshot_id" = v."id"
       JOIN "tv_shows" t ON t."id" = i."entity_id"
      WHERE v."entity_type" = 'tv'`,
    window,
    locale,
    now.toISOString(),
  )

  // Melhor posicao vence quando o mesmo id aparece em mais de um snapshot
  // vigente (movie e tv sao disjuntos, mas dois snapshots do mesmo tipo podem
  // coexistir dentro do TTL). Colapsar pelo ULTIMO visto seria decidir por ordem
  // de linha, que nao e informacao.
  const out = new Map<number, number>()
  for (const row of rows) {
    const rank = Math.max(1, Number(row.position) + 1)
    const seen = out.get(Number(row.tmdb_id))
    if (seen === undefined || rank < seen) out.set(Number(row.tmdb_id), rank)
  }
  return out
}
