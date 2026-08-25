/**
 * indexability-writer.ts — PRODUTOR de `page_indexability_decisions`.
 * Coberto por `tsconfig.runtime.json`.
 *
 * Le os fatos de cada entidade de catalogo, aplica a politica pura
 * (`@screena/seo` -> `decideCatalogIndexability`) e persiste a decisao VIGENTE.
 *
 * A POLITICA NAO E REIMPLEMENTADA AQUI. Este arquivo so LE FATOS. Toda pergunta
 * do tipo "isso indexa?" e respondida pelo modulo puro — inclusive a pergunta
 * "a serie dona e publicavel?", que e respondida rodando a MESMA funcao sobre a
 * serie (ver `readPublishableSeriesIds`) em vez de reescrever o gate em SQL.
 * Regra duplicada em SQL e regra que diverge em silencio.
 *
 * SEM CHURN: quando a decisao nova e igual a persistida (mesmo veredito, mesma
 * razao, mesma versao de politica), NADA e gravado. Uma execucao diaria sobre um
 * catalogo estavel deve produzir zero escritas — se produzir uma linha por
 * entidade por execucao, a tabela vira log de execucao em vez de registro de
 * decisao.
 *
 * SUPERSEDE em transacao: a decisao anterior e despromovida (`is_current=false`)
 * e a nova aponta para ela via `supersedes_id`, na MESMA transacao — o historico
 * fica encadeado e nunca ha janela com duas vigentes.
 *
 * LIMITACAO CONHECIDA: nao existe unique parcial em `(entity_type, entity_id,
 * language_code) WHERE is_current` no banco — o comentario do schema afirma que
 * existe, mas a migration nao cria. Portanto DOIS produtores concorrentes
 * poderiam criar duas linhas vigentes. O produtor e um job offline unico; nao
 * rode duas instancias. Criar o indice exigiria migration, fora do escopo desta
 * entrega.
 *
 * NAO LIGA INDEXACAO: escrever `decision='index'` registra o que a politica diz.
 * A chave global (`CINERIE_PUBLIC_INDEXING_ENABLED`) continua desligada.
 */

import type { PrismaClient } from '@screena/db/server'
import {
  decideCatalogIndexability,
  decisionChanged,
  type CatalogDecisionEntityType,
  type CatalogEntityFacts,
  type CatalogIndexabilityDecision,
} from '@screena/seo'

/**
 * Tipos processados por padrao.
 *
 * Temporada e episodio NAO tem slug proprio (a URL deriva do slug da serie mais
 * os numeros), e por isso ficaram de fora ate aqui — mas eles SAO 30.400 das
 * 53.000 URLs do sitemap. Deixa-los sem decisao significa que o gate nunca os
 * alcanca: a clausula `NOT EXISTS` do sitemap os inclui por falta de linha.
 */
export const DECIDABLE_ENTITY_TYPES: readonly CatalogDecisionEntityType[] = [
  'movie',
  'tv',
  'season',
  'episode',
  'person',
]

/** Resumo por decisao e por razao. */
export interface IndexabilityRunSummary {
  readonly language: string
  readonly dryRun: boolean
  readonly evaluated: number
  readonly written: number
  readonly unchanged: number
  readonly byDecision: Readonly<Record<string, number>>
  readonly byReason: Readonly<Record<string, number>>
  /** Amostra das mudancas, para revisao antes de aplicar. */
  readonly changes: readonly {
    readonly entityType: string
    readonly entityId: string
    readonly from: string | null
    readonly to: string
    readonly reason: string
  }[]
}

/**
 * Fato cru lido do banco para UMA entidade.
 *
 * Uma unica forma para os cinco tipos: cada consulta preenche o que faz sentido
 * e neutraliza o resto (`false`/`0`). Cinco interfaces diferentes dariam cinco
 * caminhos de codigo para o mesmo `decideCatalogIndexability`.
 */
interface EntityFactRow {
  readonly entity_id: bigint
  readonly has_slug: boolean
  readonly has_title: boolean
  readonly has_translation: boolean
  readonly credits: number
  /** Sinopse/overview que a pagina exibe (ver `hasSynopsis` na politica). */
  readonly has_synopsis: boolean
  /** Imagem principal persistida (poster/still/profile) — fato, nao licenca. */
  readonly has_image: boolean
  /** Biografia EXIBIVEL: texto + `biography_source_status` liberado. */
  readonly has_biography: boolean
  /** Episodios listados pela temporada. */
  readonly listed_episodes: number
  /** Serie dona (temporada/episodio); `null` nos demais tipos. */
  readonly parent_id: bigint | null
  /** Numero da temporada (temporada/episodio); `null` nos demais. */
  readonly season_number: number | null
  /** Numero do episodio (episodio); `null` nos demais. */
  readonly episode_number: number | null
  /** Slug canonico da entidade — ou da SERIE, no caso de temporada/episodio. */
  readonly url: string | null
  readonly cur_decision: string | null
  readonly cur_reason: string | null
  readonly cur_policy: string | null
}

/**
 * Rota publica de cada tipo (usada para preencher `url`, que e NOT NULL).
 *
 * Espelha `apps/web/src/lib/routes.ts`. A copia e deliberada: `services/*` nao
 * importa de `apps/web`. Divergir aqui so afeta a coluna de auditoria — o
 * sitemap monta a URL pelo seu proprio caminho —, mas uma URL errada no registro
 * de decisao e uma pista falsa numa investigacao.
 */
function routeFor(entityType: CatalogDecisionEntityType, row: EntityFactRow): string {
  const slug = row.url ?? String(row.entity_id)
  switch (entityType) {
    case 'movie':
      return `/pt/filmes/${slug}/`
    case 'tv':
      return `/pt/series/${slug}/`
    case 'person':
      return `/pt/pessoas/${slug}/`
    case 'season':
      return `/pt/series/${slug}/temporadas/${row.season_number ?? 0}/`
    case 'episode':
      return `/pt/series/${slug}/temporadas/${row.season_number ?? 0}/episodios/${row.episode_number ?? 0}/`
    default:
      return `/pt/${slug}/`
  }
}

/**
 * Estados de `people.biography_source_status` que autorizam EXIBIR a biografia
 * (invariante 6). MESMA lista de `selectSourceBiography` em apps/web — fechada
 * de proposito: estado novo no enum nao passa a exibir por omissao.
 */
const BIOGRAPHY_DISPLAYABLE_STATUSES = "('official','licensed','third_party')"

/** SQL dos fatos de um tipo de entidade. `$1` e sempre o `language_code`. */
function factsSql(entityType: CatalogDecisionEntityType, limit: number): string {
  // `LIMIT ALL` para teto ausente/infinito: `LIMIT 9007199254740991` funciona,
  // mas polui o plano e mente sobre a intencao.
  const cap =
    Number.isFinite(limit) && limit < Number.MAX_SAFE_INTEGER
      ? `LIMIT ${Math.max(1, Math.floor(limit))}`
      : 'LIMIT ALL'
  const currentDecision = (type: string, idExpr: string) => `
      LEFT JOIN page_indexability_decisions d
        ON d.entity_type = '${type}' AND d.entity_id = ${idExpr}
       AND d.language_code = $1 AND d.is_current`

  if (entityType === 'movie' || entityType === 'tv') {
    const table = entityType === 'movie' ? 'movies' : 'tv_shows'
    const titleCol = entityType === 'movie' ? 'title_original' : 'name_original'
    return `
      SELECT e.id AS entity_id,
             (s.slug IS NOT NULL) AS has_slug,
             (BTRIM(COALESCE(e.${titleCol}, '')) <> '') AS has_title,
             (t.entity_id IS NOT NULL) AS has_translation,
             0 AS credits,
             -- Sinopse em QUALQUER idioma: selectSynopsis (apps/web) aceita o
             -- idioma de origem com aviso na tela para titulo entrado sob
             -- demanda. Filtrar por $1 aqui marcaria como sem sinopse a pagina
             -- que exibe sinopse.
             EXISTS (SELECT 1 FROM entity_translations tx
                      WHERE tx.entity_type = '${entityType}' AND tx.entity_id = e.id
                        AND BTRIM(COALESCE(tx.summary, '')) <> '') AS has_synopsis,
             (BTRIM(COALESCE(e.poster_path, '')) <> '') AS has_image,
             false AS has_biography,
             0 AS listed_episodes,
             NULL::bigint AS parent_id,
             NULL::int AS season_number,
             NULL::int AS episode_number,
             s.slug AS url,
             d.decision::text AS cur_decision,
             d.reason AS cur_reason,
             d.policy_version AS cur_policy
        FROM ${table} e
        LEFT JOIN slugs s
          ON s.entity_type = '${entityType}' AND s.entity_id = e.id
         AND s.language_code = $1 AND s.is_canonical
        LEFT JOIN entity_translations t
          ON t.entity_type = '${entityType}' AND t.entity_id = e.id AND t.language_code = $1
        ${currentDecision(entityType, 'e.id')}
       ORDER BY e.id
       ${cap}`
  }

  if (entityType === 'person') {
    return `
      SELECT e.id AS entity_id,
             (s.slug IS NOT NULL) AS has_slug,
             (BTRIM(COALESCE(e.name, '')) <> '') AS has_title,
             (t.entity_id IS NOT NULL) AS has_translation,
             (SELECT COUNT(*)::int FROM cast_members cm
                JOIN slugs ws ON ws.entity_type = cm.entity_type AND ws.entity_id = cm.entity_id
                  AND ws.language_code = $1 AND ws.is_canonical
               WHERE cm.person_id = e.id AND cm.entity_type IN ('movie','tv'))
           + (SELECT COUNT(*)::int FROM crew_members rm
                JOIN slugs ws ON ws.entity_type = rm.entity_type AND ws.entity_id = rm.entity_id
                  AND ws.language_code = $1 AND ws.is_canonical
               WHERE rm.person_id = e.id AND rm.entity_type IN ('movie','tv')) AS credits,
             false AS has_synopsis,
             (BTRIM(COALESCE(e.profile_path, '')) <> '') AS has_image,
             -- Texto E licenca: a coluna de governanca nasce unknown, e bio
             -- ingerida sem liberacao nao aparece na tela.
             (BTRIM(COALESCE(e.biography, '')) <> ''
              AND e.biography_source_status::text IN ${BIOGRAPHY_DISPLAYABLE_STATUSES}) AS has_biography,
             0 AS listed_episodes,
             NULL::bigint AS parent_id,
             NULL::int AS season_number,
             NULL::int AS episode_number,
             s.slug AS url,
             d.decision::text AS cur_decision,
             d.reason AS cur_reason,
             d.policy_version AS cur_policy
        FROM people e
        LEFT JOIN slugs s
          ON s.entity_type = 'person' AND s.entity_id = e.id
         AND s.language_code = $1 AND s.is_canonical
        LEFT JOIN entity_translations t
          ON t.entity_type = 'person' AND t.entity_id = e.id AND t.language_code = $1
        ${currentDecision('person', 'e.id')}
       ORDER BY e.id
       ${cap}`
  }

  if (entityType === 'season') {
    return `
      SELECT e.id AS entity_id,
             (s.slug IS NOT NULL) AS has_slug,
             (BTRIM(COALESCE(sh.name_original, '')) <> '' AND e.season_number >= 1) AS has_title,
             -- Temporada NAO tem linha em entity_translations (a ingestao so
             -- cria para movie/tv/person). A politica sabe disso e nao consulta
             -- este campo para este tipo.
             true AS has_translation,
             0 AS credits,
             (BTRIM(COALESCE(e.overview, '')) <> '') AS has_synopsis,
             (BTRIM(COALESCE(e.poster_path, '')) <> '') AS has_image,
             false AS has_biography,
             (SELECT COUNT(*)::int FROM episodes ep WHERE ep.season_id = e.id) AS listed_episodes,
             e.tv_show_id AS parent_id,
             e.season_number AS season_number,
             NULL::int AS episode_number,
             s.slug AS url,
             d.decision::text AS cur_decision,
             d.reason AS cur_reason,
             d.policy_version AS cur_policy
        FROM seasons e
        JOIN tv_shows sh ON sh.id = e.tv_show_id
        LEFT JOIN slugs s
          ON s.entity_type = 'tv' AND s.entity_id = e.tv_show_id
         AND s.language_code = $1 AND s.is_canonical
        ${currentDecision('season', 'e.id')}
       ORDER BY e.id
       ${cap}`
  }

  return `
    SELECT e.id AS entity_id,
           (s.slug IS NOT NULL) AS has_slug,
           (BTRIM(COALESCE(sh.name_original, '')) <> ''
            AND se.season_number >= 1 AND e.episode_number >= 1) AS has_title,
           true AS has_translation,
           0 AS credits,
           (BTRIM(COALESCE(e.overview, '')) <> '') AS has_synopsis,
           (BTRIM(COALESCE(e.still_path, '')) <> '') AS has_image,
           false AS has_biography,
           0 AS listed_episodes,
           e.tv_show_id AS parent_id,
           se.season_number AS season_number,
           e.episode_number AS episode_number,
           s.slug AS url,
           d.decision::text AS cur_decision,
           d.reason AS cur_reason,
           d.policy_version AS cur_policy
      FROM episodes e
      JOIN seasons se ON se.id = e.season_id
      JOIN tv_shows sh ON sh.id = e.tv_show_id
      LEFT JOIN slugs s
        ON s.entity_type = 'tv' AND s.entity_id = e.tv_show_id
       AND s.language_code = $1 AND s.is_canonical
      ${currentDecision('episode', 'e.id')}
     ORDER BY e.id
     ${cap}`
}

/**
 * Le os fatos de indexabilidade de um tipo de entidade.
 *
 * Uma consulta por tipo, com LEFT JOIN na decisao vigente — evita N+1 e permite
 * decidir "mudou?" sem uma segunda ida ao banco por entidade.
 */
async function readFacts(
  prisma: PrismaClient,
  entityType: CatalogDecisionEntityType,
  language: string,
  limit: number,
): Promise<EntityFactRow[]> {
  return await prisma.$queryRawUnsafe<EntityFactRow[]>(factsSql(entityType, limit), language)
}

/** Monta os fatos puros a partir da linha crua, por tipo. */
function toFacts(
  entityType: CatalogDecisionEntityType,
  language: string,
  row: EntityFactRow,
  publishableSeries: ReadonlySet<string>,
): CatalogEntityFacts {
  const base = {
    entityType,
    language,
    hasCanonicalSlug: row.has_slug,
    hasTitle: row.has_title,
    hasTranslation: row.has_translation,
  }
  if (entityType === 'person') {
    return {
      ...base,
      publishableCreditCount: Number(row.credits),
      hasDisplayableBiography: row.has_biography,
      hasImage: row.has_image,
    }
  }
  if (entityType === 'season' || entityType === 'episode') {
    return {
      ...base,
      parentPublishable:
        row.parent_id !== null && publishableSeries.has(String(row.parent_id)),
      hasSynopsis: row.has_synopsis,
      hasImage: row.has_image,
      listedEpisodeCount: Number(row.listed_episodes),
    }
  }
  return { ...base, hasSynopsis: row.has_synopsis, hasImage: row.has_image }
}

/**
 * Ids das SERIES publicaveis, para o gate herdado de temporada/episodio.
 *
 * Roda a POLITICA sobre cada serie em vez de traduzir o gate para SQL: se
 * amanha a serie ganhar uma condicao nova, temporada e episodio a herdam sem
 * que ninguem se lembre de editar uma segunda consulta.
 *
 * SEM `limit`: o teto do comando corta quantas temporadas/episodios sao
 * avaliados, nunca quantas series sustentam o gate. Cortar aqui faria
 * temporadas legitimas cairem em `parent_not_publishable` so porque a serie
 * dona ficou fora da pagina de leitura.
 */
async function readPublishableSeriesIds(
  prisma: PrismaClient,
  language: string,
): Promise<ReadonlySet<string>> {
  const rows = await readFacts(prisma, 'tv', language, Number.MAX_SAFE_INTEGER)
  const ids = new Set<string>()
  for (const row of rows) {
    const decision = decideCatalogIndexability(toFacts('tv', language, row, new Set()))
    if (decision.decision === 'index') ids.add(String(row.entity_id))
  }
  return ids
}

/**
 * Roda o produtor para um tipo de entidade.
 *
 * `dryRun` calcula tudo e nao grava — e o modo que permite revisar quantas
 * entidades mudariam de estado ANTES de mexer numa tabela que o sitemap le.
 */
export async function produceIndexabilityDecisions(
  prisma: PrismaClient,
  options: {
    readonly language: string
    readonly entityTypes?: readonly CatalogDecisionEntityType[]
    readonly limit?: number
    readonly dryRun: boolean
    readonly now: () => Date
  },
): Promise<IndexabilityRunSummary> {
  const types = options.entityTypes ?? DECIDABLE_ENTITY_TYPES
  const limit = options.limit ?? 100_000
  const byDecision: Record<string, number> = {}
  const byReason: Record<string, number> = {}
  const changes: {
    entityType: string
    entityId: string
    from: string | null
    to: string
    reason: string
  }[] = []
  let evaluated = 0
  let written = 0
  let unchanged = 0

  // O gate herdado precisa das series MESMO quando `--entity season` nao pede
  // `tv`: sem isso toda temporada cairia em `parent_not_publishable` e o censo
  // mentiria sobre a causa.
  const needsParents = types.includes('season') || types.includes('episode')
  const publishableSeries = needsParents
    ? await readPublishableSeriesIds(prisma, options.language)
    : new Set<string>()

  for (const entityType of types) {
    const rows = await readFacts(prisma, entityType, options.language, limit)

    for (const row of rows) {
      evaluated += 1
      const decision: CatalogIndexabilityDecision = decideCatalogIndexability(
        toFacts(entityType, options.language, row, publishableSeries),
      )

      byDecision[decision.decision] = (byDecision[decision.decision] ?? 0) + 1
      byReason[decision.reason] = (byReason[decision.reason] ?? 0) + 1

      const previous =
        row.cur_decision === null
          ? null
          : {
              decision: row.cur_decision,
              reason: row.cur_reason,
              policyVersion: row.cur_policy,
            }

      if (!decisionChanged(decision, previous)) {
        unchanged += 1
        continue
      }

      changes.push({
        entityType,
        entityId: String(row.entity_id),
        from: row.cur_decision,
        to: decision.decision,
        reason: decision.reason,
      })

      if (options.dryRun) continue

      const url = routeFor(entityType, row)
      const decidedAt = options.now()

      // Despromove a anterior e insere a nova apontando para ela, na MESMA
      // transacao: nunca ha janela com duas vigentes nem historico orfao.
      await prisma.$transaction(async (tx) => {
        const current = await tx.pageIndexabilityDecision.findFirst({
          where: {
            entityType: entityType as never,
            entityId: row.entity_id,
            languageCode: options.language,
            isCurrent: true,
          },
          select: { id: true },
        })
        if (current !== null) {
          await tx.pageIndexabilityDecision.update({
            where: { id: current.id },
            data: { isCurrent: false },
          })
        }
        await tx.pageIndexabilityDecision.create({
          data: {
            entityType: entityType as never,
            entityId: row.entity_id,
            languageCode: options.language,
            url,
            decision: decision.decision as never,
            reason: decision.reason,
            isCurrent: true,
            supersedesId: current?.id ?? null,
            policyVersion: decision.policyVersion,
            decisionOrigin: decision.origin,
            decidedAt,
          },
        })
      })
      written += 1
    }
  }

  return {
    language: options.language,
    dryRun: options.dryRun,
    evaluated,
    written,
    unchanged,
    byDecision: Object.freeze(byDecision),
    byReason: Object.freeze(byReason),
    changes: changes.slice(0, 50),
  }
}
