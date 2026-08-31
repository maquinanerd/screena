/**
 * language-cutdown.ts — MEDIR e APAGAR o catalogo fora do recorte de idioma.
 *
 * ============================================================================
 * A DECISAO QUE ESTE MODULO EXECUTA
 * ============================================================================
 * "pt, en, es, ja, ko — o resto exclua!" — Pablo Eduardo, 2026-08-31.
 *
 * Ele faz TRES coisas, nesta ordem, e a ordem e obrigatoria:
 *
 *   1. MEDE   (`measureCatalogByLanguage`) — a tabela por idioma da Parte B;
 *   2. PLANEJA (`planLanguageCutdown`)     — quantas linhas cada tabela perde;
 *   3. APAGA   (`runLanguageCutdown`)      — em lotes, com transacao por lote.
 *
 * ============================================================================
 * O INTERTRAVAMENTO QUE IMPEDE O ACIDENTE
 * ============================================================================
 * Em 2026-08-31 `original_language` estava NULO em 20.825 filmes (43%) e
 * 20.680 series (60%) — porque o normalizador descartava todo idioma fora de
 * `en`/`es`. Entre os NULOS estao TODOS os titulos brasileiros, japoneses e
 * coreanos: `pt`, `ja` e `ko` nunca couberam na coluna. Ou seja, TRES dos CINCO
 * idiomas que ficam estavam gravados exatamente como os que saem.
 *
 * Apagar "quem nao esta na lista" naquele estado apagaria o cinema brasileiro,
 * o japones e o coreano inteiros. Por isso `runLanguageCutdown` RECUSA rodar
 * enquanto houver titulo com idioma nulo (`nullLanguageTitles > 0`). Nao e
 * aviso, e recusa: o operador tem de rodar `catalog backfill-language --apply`
 * antes. O intertravamento e a Parte A virando pre-requisito EXECUTAVEL da
 * Parte D, em vez de uma frase num documento que alguem le depois.
 *
 * ============================================================================
 * A CASCATA REAL — LIDA, NAO SUPOSTA
 * ============================================================================
 * `describeDeleteCascade` NAO devolve uma lista escrita a mao: consulta
 * `pg_constraint` no banco vivo e reporta cada FK que aponta para
 * `movies`/`tv_shows`/`seasons`/`episodes`/`people` com a acao real de
 * `ON DELETE`. Uma cascata suposta e como se apaga o que nao devia.
 *
 * O que a leitura das migrations ja antecipa, e que a consulta confirma:
 *
 *   CASCATA de verdade (o PostgreSQL leva sozinho):
 *     tv_shows -> seasons -> episodes
 *     movies/tv_shows -> {movie,tv_show}_genres, *_production_companies,
 *                        *_production_countries, tv_networks,
 *                        movie_collection_memberships, entity_detail_facts
 *
 *   NAO CASCATEIA — vira ORFA (24 tabelas polimorficas, chaveadas por
 *   (entity_type, entity_id), sem FK para movies/tv_shows):
 *     slugs, entity_translations, cast_members, crew_members,
 *     entity_external_ids, external_ratings, watch_availability,
 *     cinerie_score_calculations, search_documents,
 *     page_indexability_decisions, content_blocks, ... e as demais.
 *
 *   ATENCAO — ELAS NAO SAO SEM FK. Boa parte aponta para `entities`, uma
 *     tabela-REGISTRO mantida por TRIGGER (`*_entity_registry_ins/del`,
 *     migration 20260715120000), com **ON DELETE RESTRICT**. Isto muda o
 *     desenho do apagamento inteiro:
 *
 *       apagar o filme -> dispara o trigger AFTER DELETE
 *                      -> o trigger apaga a linha de `entities`
 *                      -> o RESTRICT ABORTA se qualquer filha ainda existir
 *
 *     Ou seja: um DELETE em massa sem limpar as polimorficas ANTES nao deixa
 *     orfas — ele FALHA. E `entities` nao deve ser apagada a mao: o trigger e o
 *     dono dela, e apaga-la antes das filhas produz o mesmo RESTRICT ao
 *     contrario (foi o que este modulo fez ate o validador reprovar).
 *
 *   NAO CASCATEIA — chaveadas por TMDB ID, nao pelo id interno:
 *     tmdb_images, tmdb_videos, title_recommendations, api_cache, tmdb_raw
 *
 *   BLOQUEIA O DELETE (ON DELETE RESTRICT):
 *     user_episode_progress -> episodes
 *
 * As orfas nao sao efeito colateral aceitavel: `slugs` orfao e uma URL que o
 * sitemap publica e o render nao resolve, e `page_indexability_decisions` orfa
 * e uma decisao `index` para uma pagina que nao existe mais. Por isso o
 * apagamento e EXPLICITO tabela por tabela, na mesma transacao do lote.
 */

import type { PrismaClient } from '@screena/db/server'

import { baseLanguageSubtag } from '@screena/config'

/** Tipos de titulo sujeitos ao recorte. */
export const CUTDOWN_TITLE_TYPES = ['movie', 'tv'] as const

/** Um tipo de titulo. */
export type CutdownTitleType = (typeof CUTDOWN_TITLE_TYPES)[number]

/** Uma linha da tabela de idiomas da Parte B. */
export interface LanguageCensusRow {
  /** Codigo em `original_language`, ou `null` para a linha dos nao preenchidos. */
  readonly language: string | null
  readonly movies: number
  readonly tvShows: number
  readonly seasons: number
  readonly episodes: number
  /** Titulos com pelo menos uma oferta de streaming no Brasil. */
  readonly withBrOffer: number
  /** Titulos com sinopse pt-BR nao vazia. */
  readonly withPtSynopsis: number
  /** Popularidade mediana (TMDB) dos titulos daquele idioma. */
  readonly medianPopularity: number | null
  /** `true` se o idioma esta no recorte (fica); `false` se sai. */
  readonly kept: boolean
}

/** Um titulo que SAI e mesmo assim tem oferta no BR ou sinopse pt-BR (B.3). */
export interface CollateralTitle {
  readonly entityType: CutdownTitleType
  readonly tmdbId: number
  readonly title: string
  readonly language: string | null
  readonly popularity: number | null
  readonly hasBrOffer: boolean
  readonly hasPtSynopsis: boolean
  /** Provedores BR onde o titulo esta disponivel (vazio quando nao ha oferta). */
  readonly brProviders: readonly string[]
}

/** O censo completo da Parte B. */
export interface LanguageCensus {
  readonly allowlist: readonly string[]
  readonly rows: readonly LanguageCensusRow[]
  /** Titulos com `original_language IS NULL` — o intertravamento da Parte D. */
  readonly nullLanguageTitles: number
  /** Totais do que SAI, ja com a cascata contabilizada. */
  readonly leaving: {
    readonly movies: number
    readonly tvShows: number
    readonly seasons: number
    readonly episodes: number
  }
  /** Totais do que FICA. */
  readonly staying: {
    readonly movies: number
    readonly tvShows: number
    readonly seasons: number
    readonly episodes: number
  }
  /** B.3: quantos dos que saem tem oferta BR ou sinopse pt-BR. */
  readonly collateral: {
    readonly total: number
    readonly withBrOffer: number
    readonly withPtSynopsis: number
    /** Os 30 mais populares, para o dono julgar antes de autorizar. */
    readonly topByPopularity: readonly CollateralTitle[]
  }
}

/** Uma FK que aponta para uma das tabelas de titulo/pessoa. */
export interface CascadeEdge {
  /** Tabela que TEM a FK (a filha). */
  readonly childTable: string
  /** Tabela apontada. */
  readonly parentTable: string
  readonly constraintName: string
  /** Acao real de `ON DELETE`, lida de `pg_constraint.confdeltype`. */
  readonly onDelete: 'cascade' | 'restrict' | 'no action' | 'set null' | 'set default'
}

/** Predicado SQL: o titulo esta FORA do recorte (e portanto sai). */
function outsideAllowlistPredicate(alias: string, allowlist: readonly string[]): string {
  const bases = allowlist
    .map((code) => baseLanguageSubtag(code))
    .filter((code): code is string => code !== null)
    .map((code) => `'${code.replace(/'/g, "''")}'`)
    .join(', ')
  // SPLIT_PART + LOWER espelha `baseLanguageSubtag`: `pt-BR` casa com `pt`. Sem
  // isso, um titulo gravado como `pt-BR` seria apagado por "nao estar na lista".
  //
  // `original_language IS NOT NULL` e deliberado: NULO NUNCA e apagado por este
  // predicado. Quem decide o que fazer com nulo e o operador, depois de rodar o
  // backfill — e o intertravamento de `runLanguageCutdown` obriga a isso.
  return `${alias}.original_language IS NOT NULL
      AND LOWER(SPLIT_PART(${alias}.original_language, '-', 1)) NOT IN (${bases})`
}

interface CensusRawRow {
  readonly language: string | null
  readonly movies: bigint
  readonly tv_shows: bigint
  readonly seasons: bigint
  readonly episodes: bigint
  readonly with_br_offer: bigint
  readonly with_pt_synopsis: bigint
  readonly median_popularity: number | null
}

/**
 * PARTE B — a tabela por idioma, com cascata, oferta BR e sinopse pt-BR.
 *
 * UMA consulta por metrica em vez de uma consulta por idioma: com ~180 idiomas
 * possiveis, o laco por idioma seriam centenas de round-trips num banco de 10 GB.
 *
 * A oferta BR e contada por EXISTENCIA (`EXISTS`), nao por join: um titulo com
 * 12 ofertas no Brasil e UM titulo, e somar linhas de `watch_availability`
 * responderia "quantas ofertas saem", que e outra pergunta.
 */
export async function measureCatalogByLanguage(
  prisma: PrismaClient,
  allowlist: readonly string[],
): Promise<LanguageCensus> {
  const rows = await prisma.$queryRawUnsafe<CensusRawRow[]>(
    `WITH titulos AS (
       SELECT 'movie'::text AS kind, m.id, m.tmdb_id, m.original_language, m.popularity
         FROM movies m
       UNION ALL
       SELECT 'tv'::text, t.id, t.tmdb_id, t.original_language, t.popularity
         FROM tv_shows t
     ),
     enriquecidos AS (
       SELECT x.kind,
              x.id,
              x.original_language AS language,
              x.popularity,
              EXISTS (SELECT 1 FROM watch_availability w
                       WHERE w.entity_type = x.kind::"EntityType"
                         AND w.entity_id = x.id
                         AND w.country_code = 'BR') AS has_br_offer,
              EXISTS (SELECT 1 FROM entity_translations tr
                       WHERE tr.entity_type = x.kind::"EntityType"
                         AND tr.entity_id = x.id
                         AND tr.language_code IN ('pt-BR', 'pt')
                         AND BTRIM(COALESCE(tr.summary, '')) <> '') AS has_pt_synopsis
         FROM titulos x
     ),
     temporadas AS (
       SELECT t.original_language AS language, COUNT(s.id) AS seasons
         FROM tv_shows t JOIN seasons s ON s.tv_show_id = t.id
        GROUP BY 1
     ),
     episodios AS (
       SELECT t.original_language AS language, COUNT(e.id) AS episodes
         FROM tv_shows t JOIN episodes e ON e.tv_show_id = t.id
        GROUP BY 1
     )
     SELECT e.language,
            COUNT(*) FILTER (WHERE e.kind = 'movie')                  AS movies,
            COUNT(*) FILTER (WHERE e.kind = 'tv')                     AS tv_shows,
            COALESCE(MAX(tp.seasons), 0)                              AS seasons,
            COALESCE(MAX(ep.episodes), 0)                             AS episodes,
            COUNT(*) FILTER (WHERE e.has_br_offer)                    AS with_br_offer,
            COUNT(*) FILTER (WHERE e.has_pt_synopsis)                 AS with_pt_synopsis,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY e.popularity) AS median_popularity
       FROM enriquecidos e
       LEFT JOIN temporadas tp ON tp.language IS NOT DISTINCT FROM e.language
       LEFT JOIN episodios  ep ON ep.language IS NOT DISTINCT FROM e.language
      GROUP BY e.language
      ORDER BY COUNT(*) DESC`,
  )

  const bases = new Set(
    allowlist.map((code) => baseLanguageSubtag(code)).filter((c): c is string => c !== null),
  )
  const kept = (language: string | null): boolean =>
    language !== null && bases.has(baseLanguageSubtag(language) ?? '')

  const census: LanguageCensusRow[] = rows.map((row) => ({
    language: row.language,
    movies: Number(row.movies),
    tvShows: Number(row.tv_shows),
    seasons: Number(row.seasons),
    episodes: Number(row.episodes),
    withBrOffer: Number(row.with_br_offer),
    withPtSynopsis: Number(row.with_pt_synopsis),
    medianPopularity: row.median_popularity === null ? null : Number(row.median_popularity),
    kept: kept(row.language),
  }))

  const soma = (
    filtro: (r: LanguageCensusRow) => boolean,
  ): { movies: number; tvShows: number; seasons: number; episodes: number } =>
    census.filter(filtro).reduce(
      (acc, r) => ({
        movies: acc.movies + r.movies,
        tvShows: acc.tvShows + r.tvShows,
        seasons: acc.seasons + r.seasons,
        episodes: acc.episodes + r.episodes,
      }),
      { movies: 0, tvShows: 0, seasons: 0, episodes: 0 },
    )

  // A linha de idioma NULO fica FORA dos dois totais, de proposito. Ela nao
  // "fica" (o idioma e desconhecido) e nao "sai" (o predicado de apagamento a
  // exclui explicitamente). Somar nulo em qualquer um dos lados produziria um
  // total que parece completo e responde a pergunta errada.
  const leaving = soma((r) => r.language !== null && !r.kept)
  const staying = soma((r) => r.kept)
  const nullLanguageTitles = census
    .filter((r) => r.language === null)
    .reduce((acc, r) => acc + r.movies + r.tvShows, 0)

  const collateral = await measureCollateral(prisma, allowlist)

  return { allowlist, rows: census, nullLanguageTitles, leaving, staying, collateral }
}

interface CollateralRawRow {
  readonly kind: string
  readonly tmdb_id: number
  readonly title: string
  readonly language: string | null
  readonly popularity: number | null
  readonly has_br_offer: boolean
  readonly has_pt_synopsis: boolean
  readonly br_providers: string[] | null
}

/**
 * B.3 — quantos titulos que SAEM tem oferta no Brasil ou sinopse pt-BR.
 *
 * E o item que o dono precisa ver ANTES de autorizar. Um filme indiano em
 * `te` com oferta na Netflix Brasil e sinopse em portugues nao e "catalogo
 * estrangeiro irrelevante": e uma pagina que alguem no Brasil pode procurar.
 * Se o numero for grande, a decisao de excecao e do dono — nao deste modulo.
 */
async function measureCollateral(
  prisma: PrismaClient,
  allowlist: readonly string[],
): Promise<LanguageCensus['collateral']> {
  const rows = await prisma.$queryRawUnsafe<CollateralRawRow[]>(
    `WITH titulos AS (
       SELECT 'movie'::text AS kind, m.id, m.tmdb_id, m.title_original AS title,
              m.original_language, m.popularity
         FROM movies m WHERE ${outsideAllowlistPredicate('m', allowlist)}
       UNION ALL
       SELECT 'tv'::text, t.id, t.tmdb_id, t.name_original, t.original_language, t.popularity
         FROM tv_shows t WHERE ${outsideAllowlistPredicate('t', allowlist)}
     )
     SELECT x.kind,
            x.tmdb_id,
            x.title,
            x.original_language AS language,
            x.popularity,
            EXISTS (SELECT 1 FROM watch_availability w
                     WHERE w.entity_type = x.kind::"EntityType"
                       AND w.entity_id = x.id AND w.country_code = 'BR') AS has_br_offer,
            EXISTS (SELECT 1 FROM entity_translations tr
                     WHERE tr.entity_type = x.kind::"EntityType"
                       AND tr.entity_id = x.id
                       AND tr.language_code IN ('pt-BR', 'pt')
                       AND BTRIM(COALESCE(tr.summary, '')) <> '') AS has_pt_synopsis,
            ARRAY(SELECT DISTINCT w.provider_name FROM watch_availability w
                   WHERE w.entity_type = x.kind::"EntityType"
                     AND w.entity_id = x.id AND w.country_code = 'BR'
                   ORDER BY w.provider_name) AS br_providers
       FROM titulos x
      WHERE EXISTS (SELECT 1 FROM watch_availability w
                     WHERE w.entity_type = x.kind::"EntityType"
                       AND w.entity_id = x.id AND w.country_code = 'BR')
         OR EXISTS (SELECT 1 FROM entity_translations tr
                     WHERE tr.entity_type = x.kind::"EntityType"
                       AND tr.entity_id = x.id
                       AND tr.language_code IN ('pt-BR', 'pt')
                       AND BTRIM(COALESCE(tr.summary, '')) <> '')
      ORDER BY x.popularity DESC NULLS LAST`,
  )

  const mapped: CollateralTitle[] = rows.map((row) => ({
    entityType: row.kind === 'tv' ? 'tv' : 'movie',
    tmdbId: row.tmdb_id,
    title: row.title,
    language: row.language,
    popularity: row.popularity === null ? null : Number(row.popularity),
    hasBrOffer: row.has_br_offer,
    hasPtSynopsis: row.has_pt_synopsis,
    brProviders: row.br_providers ?? [],
  }))

  return {
    total: mapped.length,
    withBrOffer: mapped.filter((t) => t.hasBrOffer).length,
    withPtSynopsis: mapped.filter((t) => t.hasPtSynopsis).length,
    topByPopularity: mapped.slice(0, 30),
  }
}

/**
 * D.2 — a cascata REAL, lida de `pg_constraint`.
 *
 * `confdeltype` e um char: `a` = no action, `r` = restrict, `c` = cascade,
 * `n` = set null, `d` = set default. Ler daqui, e nao do schema.prisma, e o que
 * distingue "a cascata que declaramos" de "a cascata que o banco tem" — e este
 * projeto ja teve FK viva que o modelo Prisma nao mostrava.
 */
export async function describeDeleteCascade(prisma: PrismaClient): Promise<CascadeEdge[]> {
  const rows = await prisma.$queryRawUnsafe<
    { child_table: string; parent_table: string; constraint_name: string; on_delete: string }[]
  >(
    `SELECT c.conrelid::regclass::text  AS child_table,
            c.confrelid::regclass::text AS parent_table,
            c.conname                   AS constraint_name,
            CASE c.confdeltype
              WHEN 'c' THEN 'cascade'
              WHEN 'r' THEN 'restrict'
              WHEN 'n' THEN 'set null'
              WHEN 'd' THEN 'set default'
              ELSE 'no action'
            END AS on_delete
       FROM pg_constraint c
      WHERE c.contype = 'f'
        AND c.confrelid::regclass::text IN
            ('movies', 'tv_shows', 'seasons', 'episodes', 'people')
      ORDER BY parent_table, child_table`,
  )
  return rows.map((row) => ({
    childTable: row.child_table,
    parentTable: row.parent_table,
    constraintName: row.constraint_name,
    onDelete: row.on_delete as CascadeEdge['onDelete'],
  }))
}

/**
 * As tabelas polimorficas que o apagamento tem de limpar A MAO.
 *
 * Nenhuma delas tem FK para `movies`/`tv_shows` — sao chaveadas por
 * (`entity_type`, `entity_id`) e o PostgreSQL nao sabe que elas se referem a um
 * titulo. Sem esta lista, apagar um filme deixaria o slug dele vivo, o sitemap
 * continuaria publicando a URL e a decisao `index` seguiria apontando para uma
 * pagina que nao existe.
 *
 * DUAS tabelas polimorficas ficam FORA, cada uma por um motivo diferente:
 *
 *   `entities` — mantida por TRIGGER. Apaga-la a mao antes das filhas viola o
 *     `ON DELETE RESTRICT` que elas tem sobre ela; deixa-la para o trigger, que
 *     dispara no `DELETE` do titulo, e a unica ordem que funciona. Ver o
 *     cabecalho deste arquivo.
 *
 *   `entity_reference_orphans` — tabela de AUDITORIA (quarentena de referencias
 *     quebradas, migration 20260715120000). Ela registra que algo deu errado;
 *     apagar o registro junto com o dado apagaria a prova.
 *
 * A lista e FECHADA de proposito: uma tabela polimorfica nova que ninguem
 * acrescentar aqui vira orfa silenciosa — ou, pior, faz o DELETE do titulo
 * ABORTAR pelo RESTRICT. `validate-language-cutdown-real-postgres.ts` compara
 * esta lista com o banco vivo e falha quando divergem.
 */
export const POLYMORPHIC_TITLE_TABLES: readonly string[] = [
  'cast_members',
  'cinerie_score_calculations',
  'content_blocks',
  'crew_members',
  'entity_alternative_titles',
  'entity_awards',
  'entity_external_ids',
  'entity_keywords',
  'entity_news_links',
  'entity_translations',
  'entity_writer_jobs',
  'entity_writer_logs',
  'external_ratings',
  'hero_curation_decisions',
  'page_indexability_decisions',
  'search_documents',
  'slugs',
  'user_list_items',
  'user_ratings',
  'user_recommendation_feedback',
  'user_reviews',
  'user_viewing_events',
  'user_watch_states',
  'watch_availability',
]

/**
 * Polimorficas DELIBERADAMENTE fora de `POLYMORPHIC_TITLE_TABLES`.
 *
 * Exportada para que o validador contra PostgreSQL real possa exigir que toda
 * tabela do banco esteja OU na lista de apagamento OU aqui, com motivo. Uma
 * tabela que nao esteja em nenhuma das duas e uma omissao, nao uma escolha.
 */
export const POLYMORPHIC_TABLES_DELIBERATELY_EXCLUDED: readonly string[] = [
  // mantida por trigger; ver o cabecalho
  'entities',
  // auditoria: apagar o registro apagaria a prova
  'entity_reference_orphans',
]

/**
 * Tabelas chaveadas pelo TMDB ID (nao pelo id interno).
 *
 * Errar isto e apagar a linha errada: `tmdb_images.tmdb_id = 550` e o Clube da
 * Luta; `movies.id = 550` e outro filme qualquer.
 */
export const TMDB_ID_KEYED_TABLES: readonly string[] = ['tmdb_images', 'tmdb_videos']

/** Quantas linhas cada tabela perde (D.3). */
export interface CutdownPlan {
  readonly allowlist: readonly string[]
  /** Titulos alvo, por tipo. */
  readonly targets: Readonly<Record<CutdownTitleType, number>>
  /** Linhas por tabela, incluindo as que a cascata leva e as orfas explicitas. */
  readonly rowsByTable: Readonly<Record<string, number>>
  /** Total de linhas que somem. */
  readonly totalRows: number
  /** Pessoas que ficariam sem NENHUM credito depois do apagamento (D.5). */
  readonly orphanPeople: number
  /** Linhas de `api_cache` dos titulos removidos (D.6). */
  readonly apiCacheRows: number
  /** Linhas de `tmdb_raw` dos titulos removidos. */
  readonly tmdbRawRows: number
  /**
   * Linhas que BLOQUEIAM o delete por `ON DELETE RESTRICT`.
   *
   * Hoje so `user_episode_progress -> episodes`. Se houver qualquer linha aqui,
   * o `DELETE` estoura no meio do lote — melhor descobrir no plano.
   */
  readonly blockingRows: Readonly<Record<string, number>>
}

/** Conta linhas de uma consulta escalar. */
async function contar(prisma: PrismaClient, sql: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(sql)
  return Number(rows[0]?.n ?? 0)
}

/** CTE reutilizavel com os ids (interno e tmdb) dos titulos que saem. */
function alvosCte(allowlist: readonly string[]): string {
  return `alvos AS (
       SELECT 'movie'::text AS kind, m.id, m.tmdb_id FROM movies m
        WHERE ${outsideAllowlistPredicate('m', allowlist)}
       UNION ALL
       SELECT 'tv'::text, t.id, t.tmdb_id FROM tv_shows t
        WHERE ${outsideAllowlistPredicate('t', allowlist)}
     )`
}

/** D.3 — o dry-run: quantas linhas cada tabela perderia. */
export async function planLanguageCutdown(
  prisma: PrismaClient,
  allowlist: readonly string[],
): Promise<CutdownPlan> {
  const targets = {
    movie: await contar(
      prisma,
      `SELECT COUNT(*) AS n FROM movies m WHERE ${outsideAllowlistPredicate('m', allowlist)}`,
    ),
    tv: await contar(
      prisma,
      `SELECT COUNT(*) AS n FROM tv_shows t WHERE ${outsideAllowlistPredicate('t', allowlist)}`,
    ),
  }

  const rowsByTable: Record<string, number> = {}

  rowsByTable.movies = targets.movie
  rowsByTable.tv_shows = targets.tv

  // Cascata declarada pelo banco: seasons e episodes vem de tv_shows.
  rowsByTable.seasons = await contar(
    prisma,
    `SELECT COUNT(*) AS n FROM seasons s JOIN tv_shows t ON t.id = s.tv_show_id
      WHERE ${outsideAllowlistPredicate('t', allowlist)}`,
  )
  rowsByTable.episodes = await contar(
    prisma,
    `SELECT COUNT(*) AS n FROM episodes e JOIN tv_shows t ON t.id = e.tv_show_id
      WHERE ${outsideAllowlistPredicate('t', allowlist)}`,
  )

  for (const table of POLYMORPHIC_TITLE_TABLES) {
    rowsByTable[table] = await contar(
      prisma,
      `WITH ${alvosCte(allowlist)}
       SELECT COUNT(*) AS n FROM ${table} x
        JOIN alvos a ON a.kind::"EntityType" = x.entity_type AND a.id = x.entity_id`,
    )
  }

  for (const table of TMDB_ID_KEYED_TABLES) {
    rowsByTable[table] = await contar(
      prisma,
      `WITH ${alvosCte(allowlist)}
       SELECT COUNT(*) AS n FROM ${table} x
        JOIN alvos a ON a.kind::"TmdbEntityKind" = x.entity_type AND a.tmdb_id = x.tmdb_id`,
    )
  }

  rowsByTable.title_recommendations = await contar(
    prisma,
    `WITH ${alvosCte(allowlist)}
     SELECT COUNT(*) AS n FROM title_recommendations r
      WHERE EXISTS (SELECT 1 FROM alvos a
                     WHERE a.kind = r.source_media_type AND a.tmdb_id = r.source_tmdb_id)
         OR EXISTS (SELECT 1 FROM alvos a
                     WHERE a.kind = r.target_media_type AND a.tmdb_id = r.target_tmdb_id)`,
  )

  const apiCacheRows = await contar(
    prisma,
    `WITH ${alvosCte(allowlist)}
     SELECT COUNT(*) AS n FROM api_cache c
      WHERE c.provider_api = 'tmdb'
        AND EXISTS (SELECT 1 FROM alvos a
                     WHERE c.endpoint LIKE '/' || a.kind || '/' || a.tmdb_id::text || '%')`,
  )
  const tmdbRawRows = await contar(
    prisma,
    `WITH ${alvosCte(allowlist)}
     SELECT COUNT(*) AS n FROM tmdb_raw r
      JOIN alvos a ON a.kind::"TmdbEntityKind" = r.entity_type AND a.tmdb_id = r.tmdb_id`,
  )

  // D.5 — pessoa que fica SEM NENHUM credito depois do apagamento. A conta
  // olha os creditos que SOBRAM, nao os que somem: uma pessoa que perde 3 de 4
  // creditos continua tendo filmografia e nao e orfa.
  const orphanPeople = await contar(
    prisma,
    `WITH ${alvosCte(allowlist)},
     sobrevive AS (
       SELECT DISTINCT cm.person_id FROM cast_members cm
        WHERE NOT EXISTS (SELECT 1 FROM alvos a
                           WHERE a.kind::"EntityType" = cm.entity_type AND a.id = cm.entity_id)
       UNION
       SELECT DISTINCT cr.person_id FROM crew_members cr
        WHERE NOT EXISTS (SELECT 1 FROM alvos a
                           WHERE a.kind::"EntityType" = cr.entity_type AND a.id = cr.entity_id)
     )
     SELECT COUNT(*) AS n FROM people p
      WHERE NOT EXISTS (SELECT 1 FROM sobrevive s WHERE s.person_id = p.id)`,
  )

  const blockingRows = {
    user_episode_progress: await contar(
      prisma,
      `SELECT COUNT(*) AS n FROM user_episode_progress up
        JOIN episodes e ON e.id = up.episode_id
        JOIN tv_shows t ON t.id = e.tv_show_id
       WHERE ${outsideAllowlistPredicate('t', allowlist)}`,
    ),
  }

  const totalRows = Object.values(rowsByTable).reduce((a, b) => a + b, 0)

  return {
    allowlist,
    targets,
    rowsByTable,
    totalRows,
    orphanPeople,
    apiCacheRows,
    tmdbRawRows,
    blockingRows,
  }
}

/** Opcoes de uma execucao de apagamento. */
export interface CutdownOptions {
  readonly allowlist: readonly string[]
  /** Titulos por lote. Cada lote e UMA transacao. */
  readonly batchSize?: number
  readonly dryRun: boolean
  /**
   * Ignora o intertravamento de idioma nulo. NUNCA use sem ter rodado
   * `catalog backfill-language --apply` e conferido o numero.
   */
  readonly allowNullLanguages?: boolean
  readonly onBatch?: (progress: {
    readonly entityType: CutdownTitleType
    readonly deleted: number
    readonly rowsRemoved: number
    readonly remaining: number
  }) => void
}

/** Resultado de uma execucao de apagamento. */
export interface CutdownReport {
  readonly dryRun: boolean
  readonly allowlist: readonly string[]
  /** Titulos apagados, por tipo. */
  readonly deletedTitles: Readonly<Record<string, number>>
  /** Linhas apagadas por tabela (soma dos lotes). */
  readonly rowsByTable: Readonly<Record<string, number>>
  readonly totalRows: number
  readonly orphanPeopleDeleted: number
  readonly apiCacheDeleted: number
  readonly tmdbRawDeleted: number
  readonly batches: number
  /** Motivo quando a execucao foi RECUSADA (nada foi apagado). */
  readonly refused: string | null
}

/** Lote default. 500 titulos por transacao; uma serie leva a cascata junto. */
export const DEFAULT_CUTDOWN_BATCH_SIZE = 500

function acumular(alvo: Record<string, number>, tabela: string, n: number): void {
  alvo[tabela] = (alvo[tabela] ?? 0) + n
}

/**
 * D.4 — apaga em LOTES, com transacao por lote.
 *
 * Nunca milhoes de linhas numa transacao so: um `DELETE` unico sobre ~3,9 M
 * episodios seguraria locks por minutos, encheria o WAL e, se falhasse no fim,
 * jogaria fora todo o trabalho. Cada lote e uma transacao que fecha; morrer no
 * meio custa o lote corrente, nao a execucao.
 *
 * A ORDEM DENTRO DO LOTE importa: as tabelas polimorficas primeiro (ninguem as
 * apaga por nos), depois as chaveadas por tmdb_id, e o titulo POR ULTIMO — e a
 * exclusao dele que dispara a cascata do PostgreSQL para seasons/episodes/
 * generos. Apagar o titulo primeiro tornaria impossivel achar as orfas: o
 * `entity_id` delas ja nao teria dono.
 */
export async function runLanguageCutdown(
  prisma: PrismaClient,
  options: CutdownOptions,
): Promise<CutdownReport> {
  const { allowlist } = options
  const batchSize = options.batchSize ?? DEFAULT_CUTDOWN_BATCH_SIZE
  const rowsByTable: Record<string, number> = {}
  const deletedTitles: Record<string, number> = { movie: 0, tv: 0 }
  let orphanPeopleDeleted = 0
  let apiCacheDeleted = 0
  let tmdbRawDeleted = 0
  let batches = 0

  const vazio = (refused: string | null): CutdownReport => ({
    dryRun: options.dryRun,
    allowlist,
    deletedTitles,
    rowsByTable,
    totalRows: 0,
    orphanPeopleDeleted,
    apiCacheDeleted,
    tmdbRawDeleted,
    batches,
    refused,
  })

  // ========================================================================
  // O INTERTRAVAMENTO. Ver o cabecalho: `pt`, `ja` e `ko` estavam gravados como
  // NULL, exatamente como os idiomas que saem. Apagar antes de recuperar o
  // idioma nao e um risco teorico — e o desfecho default.
  // ========================================================================
  if (options.allowNullLanguages !== true) {
    const nulos = await contar(
      prisma,
      `SELECT (SELECT COUNT(*) FROM movies WHERE original_language IS NULL)
            + (SELECT COUNT(*) FROM tv_shows WHERE original_language IS NULL) AS n`,
    )
    if (nulos > 0) {
      return vazio(
        `RECUSADO: ${nulos} titulo(s) com original_language NULL. ` +
          'Rode `catalog backfill-language --apply` antes — `pt`, `ja` e `ko` ' +
          'estao entre os NULOS, e apagar agora removeria titulo que FICA.',
      )
    }
  }

  if (options.dryRun) {
    const plano = await planLanguageCutdown(prisma, allowlist)
    return {
      dryRun: true,
      allowlist,
      deletedTitles: { movie: 0, tv: 0 },
      rowsByTable: plano.rowsByTable,
      totalRows: plano.totalRows,
      orphanPeopleDeleted: 0,
      apiCacheDeleted: 0,
      tmdbRawDeleted: 0,
      batches: 0,
      refused: null,
    }
  }

  for (const kind of CUTDOWN_TITLE_TYPES) {
    const table = kind === 'movie' ? 'movies' : 'tv_shows'
    for (;;) {
      const alvos = await prisma.$queryRawUnsafe<{ id: bigint; tmdb_id: number }[]>(
        `SELECT x.id, x.tmdb_id FROM ${table} x
          WHERE ${outsideAllowlistPredicate('x', allowlist)}
          ORDER BY x.id
          LIMIT ${Math.max(1, Math.floor(batchSize))}`,
      )
      if (alvos.length === 0) break

      const ids = alvos.map((a) => a.id.toString()).join(',')
      const tmdbIds = alvos.map((a) => String(a.tmdb_id)).join(',')

      await prisma.$transaction(async (tx) => {
        // 1. polimorficas — ninguem as apaga por nos
        for (const poly of POLYMORPHIC_TITLE_TABLES) {
          const n = await tx.$executeRawUnsafe(
            `DELETE FROM ${poly}
              WHERE entity_type = '${kind}'::"EntityType" AND entity_id IN (${ids})`,
          )
          if (n > 0) acumular(rowsByTable, poly, n)
        }
        // 2. chaveadas por tmdb_id
        for (const byTmdb of TMDB_ID_KEYED_TABLES) {
          const n = await tx.$executeRawUnsafe(
            `DELETE FROM ${byTmdb}
              WHERE entity_type = '${kind}'::"TmdbEntityKind" AND tmdb_id IN (${tmdbIds})`,
          )
          if (n > 0) acumular(rowsByTable, byTmdb, n)
        }
        const nRec = await tx.$executeRawUnsafe(
          `DELETE FROM title_recommendations
            WHERE (source_media_type = '${kind}' AND source_tmdb_id IN (${tmdbIds}))
               OR (target_media_type = '${kind}' AND target_tmdb_id IN (${tmdbIds}))`,
        )
        if (nRec > 0) acumular(rowsByTable, 'title_recommendations', nRec)

        // 3. deposito bruto (D.6) — e onde moram os 5 GB
        const nCache = await tx.$executeRawUnsafe(
          `DELETE FROM api_cache c
            WHERE c.provider_api = 'tmdb'
              AND (${alvos.map((a) => `c.endpoint LIKE '/${kind}/${a.tmdb_id}%'`).join(' OR ')})`,
        )
        apiCacheDeleted += nCache
        const nRaw = await tx.$executeRawUnsafe(
          `DELETE FROM tmdb_raw
            WHERE entity_type = '${kind}'::"TmdbEntityKind" AND tmdb_id IN (${tmdbIds})`,
        )
        tmdbRawDeleted += nRaw

        // 4. contagem da cascata ANTES do delete do titulo (depois nao ha como
        //    contar: as linhas ja sumiram e nao ha de onde inferir quantas eram)
        if (kind === 'tv') {
          const [{ n: nSeasons } = { n: 0n }] = await tx.$queryRawUnsafe<{ n: bigint }[]>(
            `SELECT COUNT(*) AS n FROM seasons WHERE tv_show_id IN (${ids})`,
          )
          const [{ n: nEpisodes } = { n: 0n }] = await tx.$queryRawUnsafe<{ n: bigint }[]>(
            `SELECT COUNT(*) AS n FROM episodes WHERE tv_show_id IN (${ids})`,
          )
          acumular(rowsByTable, 'seasons', Number(nSeasons))
          acumular(rowsByTable, 'episodes', Number(nEpisodes))
        }

        // 5. o titulo POR ULTIMO — e ele que dispara a cascata do PostgreSQL
        const n = await tx.$executeRawUnsafe(`DELETE FROM ${table} WHERE id IN (${ids})`)
        acumular(rowsByTable, table, n)
        deletedTitles[kind] = (deletedTitles[kind] ?? 0) + n
      })

      batches += 1
      const remaining = await contar(
        prisma,
        `SELECT COUNT(*) AS n FROM ${table} x WHERE ${outsideAllowlistPredicate('x', allowlist)}`,
      )
      options.onBatch?.({
        entityType: kind,
        deleted: deletedTitles[kind] ?? 0,
        rowsRemoved: Object.values(rowsByTable).reduce((a, b) => a + b, 0),
        remaining,
      })
      if (alvos.length < batchSize) break
    }
  }

  // D.5 — pessoa orfa, em passo SEPARADO e depois dos titulos.
  //
  // Separado porque a orfandade so e conhecida no fim: uma pessoa cujo unico
  // credito restante estava no ultimo lote so vira orfa depois dele. Fazer
  // dentro do lote apagaria gente que ainda tinha filmografia viva.
  orphanPeopleDeleted = await deleteOrphanPeople(prisma, batchSize)

  const totalRows = Object.values(rowsByTable).reduce((a, b) => a + b, 0)
  return {
    dryRun: false,
    allowlist,
    deletedTitles,
    rowsByTable,
    totalRows,
    orphanPeopleDeleted,
    apiCacheDeleted,
    tmdbRawDeleted,
    batches,
    refused: null,
  }
}

/**
 * D.5 — apaga pessoas sem NENHUM credito, em lotes.
 *
 * `cast_members`/`crew_members` tem FK para `people` com ON DELETE CASCADE,
 * entao a direcao contraria (apagar a pessoa) nao esbarra em nada. O criterio e
 * "nao existe credito", nunca "perdeu credito": uma pessoa com 3 de 4 creditos
 * apagados continua tendo filmografia e nao e orfa.
 */
export async function deleteOrphanPeople(prisma: PrismaClient, batchSize: number): Promise<number> {
  let total = 0
  for (;;) {
    const n = await prisma.$executeRawUnsafe(
      `DELETE FROM people
        WHERE id IN (
          SELECT p.id FROM people p
           WHERE NOT EXISTS (SELECT 1 FROM cast_members cm WHERE cm.person_id = p.id)
             AND NOT EXISTS (SELECT 1 FROM crew_members cr WHERE cr.person_id = p.id)
           LIMIT ${Math.max(1, Math.floor(batchSize))})`,
    )
    total += n
    if (n === 0) break
  }
  return total
}
