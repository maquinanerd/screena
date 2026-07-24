/**
 * audit-reader.ts — Reader Prisma da auditoria. Coberto por `tsconfig.runtime.json`.
 *
 * SOMENTE LEITURA, por construcao: este modulo so chama `count`, `findMany`,
 * `groupBy` e `aggregate`. Nao ha `update`, `create`, `delete`, `$executeRaw`
 * nem migration aqui — e a garantia e estrutural (o teste de governanca varre o
 * arquivo atras dessas palavras), nao uma promessa no comentario.
 *
 * Tambem nunca imprime `DATABASE_URL`: o reader devolve dados, quem formata e o
 * nucleo puro.
 */

import type { $Enums } from '@prisma/client'
import type { PrismaClient } from '@screena/db/server'
import type { AuditReaderPort, CoverageRow, EntityCountRow } from '../audit/index.js'

/**
 * Delegate minimo de um model Prisma.
 *
 * A auditoria varre models por NOME (tabela por tabela) — o client tipado nao
 * expoe indexacao dinamica, entao a fronteira e explicitamente estrutural. Fora
 * daqui tudo volta a ser tipado.
 */
interface CountableDelegate {
  count(): Promise<number>
  aggregate(args: unknown): Promise<{ _max?: { lastSyncedAt?: Date | null } }>
}

/** Tipos de entidade contados no relatorio. */
const ENTITY_MODELS: readonly { entity: string; model: string; hasLastSynced: boolean }[] = [
  { entity: 'movies', model: 'movie', hasLastSynced: true },
  { entity: 'tv_shows', model: 'tvShow', hasLastSynced: true },
  { entity: 'seasons', model: 'season', hasLastSynced: true },
  { entity: 'episodes', model: 'episode', hasLastSynced: false },
  { entity: 'people', model: 'person', hasLastSynced: true },
  { entity: 'collections', model: 'collection', hasLastSynced: false },
  { entity: 'production_companies', model: 'productionCompany', hasLastSynced: false },
  { entity: 'networks', model: 'network', hasLastSynced: false },
  { entity: 'keywords', model: 'keyword', hasLastSynced: false },
  { entity: 'entity_alternative_titles', model: 'entityAlternativeTitle', hasLastSynced: false },
  { entity: 'cast_members', model: 'castMember', hasLastSynced: false },
  { entity: 'crew_members', model: 'crewMember', hasLastSynced: false },
  { entity: 'tmdb_images', model: 'tmdbImage', hasLastSynced: false },
  { entity: 'tmdb_videos', model: 'tmdbVideo', hasLastSynced: false },
  { entity: 'search_documents', model: 'searchDocument', hasLastSynced: false },
  { entity: 'discovery_snapshots', model: 'discoverySnapshot', hasLastSynced: false },
  { entity: 'catalog_jobs', model: 'catalogJob', hasLastSynced: false },
  { entity: 'api_sync_logs', model: 'apiSyncLog', hasLastSynced: false },
  { entity: 'tmdb_raw', model: 'tmdbRaw', hasLastSynced: false },
]

/**
 * Tipos que tem cobertura de midia.
 *
 * `kind` e o enum `TmdbEntityKind` do banco (nao string solta): e o que filtra
 * tmdb_images/tmdb_videos, e um valor fora do enum viraria erro de query.
 */
const COVERAGE_KINDS: readonly { kind: $Enums.TmdbEntityKind; model: string }[] = [
  { kind: 'movie', model: 'movie' },
  { kind: 'tv', model: 'tvShow' },
  { kind: 'person', model: 'person' },
]

/** Divide protegendo contra total zero (0/0 seria NaN no relatorio). */
function ratio(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 10_000) / 10_000
}

/** Resolve um delegate pelo nome do model (fronteira estrutural; ver acima). */
function delegateOf(prisma: PrismaClient, model: string): CountableDelegate | undefined {
  const found = (prisma as unknown as Record<string, unknown>)[model]
  if (found === undefined || found === null || typeof found !== 'object') return undefined
  const candidate = found as Partial<CountableDelegate>
  return typeof candidate.count === 'function' ? (found as CountableDelegate) : undefined
}

/** Cria o reader Prisma da auditoria (somente leitura). */
export function createPrismaAuditReader(prisma: PrismaClient): AuditReaderPort {
  return {
    async readEntityCounts(): Promise<EntityCountRow[]> {
      const rows: EntityCountRow[] = []
      for (const { entity, model, hasLastSynced } of ENTITY_MODELS) {
        const delegate = delegateOf(prisma, model)
        // Modelo ausente no client (schema divergente) nao derruba a auditoria:
        // reportar 0 seria mentira, entao a linha simplesmente nao aparece.
        if (delegate === undefined) continue
        const total = await delegate.count()
        let lastSyncedAt: Date | null = null
        if (hasLastSynced && total > 0) {
          const latest = await delegate.aggregate({ _max: { lastSyncedAt: true } })
          lastSyncedAt = latest?._max?.lastSyncedAt ?? null
        }
        rows.push({ entity, total, lastSyncedAt })
      }
      return rows
    },

    async readCoverage(): Promise<CoverageRow[]> {
      const rows: CoverageRow[] = []
      for (const { kind, model } of COVERAGE_KINDS) {
        const delegate = delegateOf(prisma, model)
        if (delegate === undefined) continue
        const total = await delegate.count()

        // Cobertura e medida sobre as entidades DISTINTAS que tem midia, nao
        // sobre a contagem de linhas de midia: 40 posteres de 1 filme nao sao
        // "40 filmes cobertos". A chave da midia e `tmdbId` (nao um id interno).
        const withImagesRows = await prisma.tmdbImage.groupBy({
          by: ['tmdbId'],
          where: { entityType: kind },
        })
        const withTrailerRows = await prisma.tmdbVideo.groupBy({
          by: ['tmdbId'],
          where: { entityType: kind, videoType: 'Trailer' },
        })

        const withImages = withImagesRows.length
        const withTrailer = withTrailerRows.length
        rows.push({
          kind,
          total,
          withImages,
          withTrailer,
          imageRatio: ratio(withImages, total),
          trailerRatio: ratio(withTrailer, total),
        })
      }
      return rows
    },

    async readJobs() {
      const grouped = await prisma.catalogJob.groupBy({ by: ['status'], _count: { _all: true } })
      return grouped.map((row) => ({ status: String(row.status), count: row._count._all }))
    },

    async readDeadLetterCount() {
      return prisma.catalogJob.count({ where: { status: 'dead_letter' } })
    },

    async readCheckpoints() {
      const rows = await prisma.tmdbSyncCheckpoint.findMany({ orderBy: { updatedAt: 'desc' }, take: 50 })
      return rows.map((row) => ({
        job: row.job,
        lastPage: row.lastPage,
        totalPages: row.totalPages,
        done: row.done,
        cursor: row.cursor ?? null,
        updatedAt: row.updatedAt,
      }))
    },

    async readSnapshots(now) {
      const rows = await prisma.discoverySnapshot.findMany({
        orderBy: { capturedAt: 'desc' },
        take: 50,
        include: { _count: { select: { items: true } } },
      })
      return rows.map((row) => ({
        listType: String(row.listType),
        entityType: String(row.entityType),
        locale: row.locale,
        capturedAt: row.capturedAt,
        expiresAt: row.expiresAt,
        ageSeconds: Math.round((now.getTime() - row.capturedAt.getTime()) / 1000),
        expired: row.expiresAt.getTime() < now.getTime(),
        items: row._count?.items ?? 0,
      }))
    },

    async readSearchDocuments() {
      const [total, grouped] = await Promise.all([
        prisma.searchDocument.count(),
        prisma.searchDocument.groupBy({ by: ['locale'], _count: { _all: true } }),
      ])
      return {
        total,
        byLocale: grouped.map((row) => ({ locale: row.locale, count: row._count._all })),
      }
    },

    /**
     * Dimensoes de PUBLICABILIDADE por tipo.
     *
     * Uma consulta agregada por tipo (nao N+1). Cada coluna responde uma
     * pergunta DIFERENTE — existir, ter rota, renderizar, poder publicar, entrar
     * no sitemap e ter decisao registrada nao sao a mesma coisa, e um censo que
     * so conta linhas nao distingue nenhuma delas.
     *
     * `staleDecision` compara a decisao PERSISTIDA com o que os gates diriam
     * agora: e o numero que revela policy desatualizada no banco.
     *
     * SOMENTE LEITURA: apenas SELECT.
     */
    async readPublishability(language: string) {
      const specs = [
        { entity: 'movie', table: 'movies', title: 'title_original' },
        { entity: 'tv', table: 'tv_shows', title: 'name_original' },
        { entity: 'person', table: 'people', title: 'name' },
      ] as const

      const out = []
      for (const spec of specs) {
        // Pessoa tem gate extra: credito em obra publicavel.
        const publishableExpr =
          spec.entity === 'person'
            ? `EXISTS (
                 SELECT 1 FROM cast_members cm
                  JOIN slugs ws ON ws.entity_type = cm.entity_type AND ws.entity_id = cm.entity_id
                   AND ws.language_code = $1 AND ws.is_canonical
                  WHERE cm.person_id = e.id AND cm.entity_type IN ('movie','tv')
                 UNION ALL
                 SELECT 1 FROM crew_members rm
                  JOIN slugs ws ON ws.entity_type = rm.entity_type AND ws.entity_id = rm.entity_id
                   AND ws.language_code = $1 AND ws.is_canonical
                  WHERE rm.person_id = e.id AND rm.entity_type IN ('movie','tv'))`
            : 'true'

        const rows = await prisma.$queryRawUnsafe<Record<string, bigint | number>[]>(
          `WITH base AS (
             SELECT e.id,
                    (s.slug IS NOT NULL) AS has_slug,
                    (BTRIM(COALESCE(e.${spec.title}, '')) <> '') AS has_title,
                    (t.entity_id IS NOT NULL) AS has_translation,
                    EXISTS (SELECT 1 FROM tmdb_images i
                             WHERE i.entity_type::text = '${spec.entity}' AND i.tmdb_id = e.tmdb_id) AS has_media,
                    ${publishableExpr} AS gate_ok,
                    d.decision::text AS cur_decision
               FROM ${spec.table} e
               LEFT JOIN slugs s ON s.entity_type = '${spec.entity}' AND s.entity_id = e.id
                     AND s.language_code = $1 AND s.is_canonical
               LEFT JOIN entity_translations t ON t.entity_type = '${spec.entity}'
                     AND t.entity_id = e.id AND t.language_code = $1
               LEFT JOIN page_indexability_decisions d ON d.entity_type = '${spec.entity}'
                     AND d.entity_id = e.id AND d.language_code = $1 AND d.is_current
           )
           SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE has_slug)::int AS with_slug,
                  COUNT(*) FILTER (WHERE NOT has_slug)::int AS without_slug,
                  COUNT(*) FILTER (WHERE has_translation)::int AS with_translation,
                  COUNT(*) FILTER (WHERE NOT has_translation)::int AS without_translation,
                  COUNT(*) FILTER (WHERE has_media)::int AS with_media,
                  COUNT(*) FILTER (WHERE NOT has_media)::int AS without_media,
                  COUNT(*) FILTER (WHERE has_slug AND has_title)::int AS renderable,
                  COUNT(*) FILTER (WHERE has_slug AND has_title AND has_translation AND gate_ok)::int AS publishable,
                  COUNT(*) FILTER (WHERE has_slug AND has_title AND has_translation AND gate_ok)::int AS sitemap_eligible,
                  COUNT(*) FILTER (WHERE cur_decision IS NOT NULL)::int AS with_decision,
                  COUNT(*) FILTER (WHERE cur_decision IS NULL)::int AS missing_decision,
                  COUNT(*) FILTER (
                    WHERE cur_decision IS NOT NULL
                      AND cur_decision <> (CASE WHEN has_slug AND has_title AND has_translation AND gate_ok
                                                THEN 'index' ELSE 'noindex' END)
                  )::int AS stale_decision
             FROM base`,
          language,
        )
        const r = rows[0] ?? {}
        const n = (k: string): number => Number(r[k] ?? 0)
        out.push({
          entity: spec.entity,
          total: n('total'),
          withSlug: n('with_slug'),
          withoutSlug: n('without_slug'),
          withTranslation: n('with_translation'),
          withoutTranslation: n('without_translation'),
          withMedia: n('with_media'),
          withoutMedia: n('without_media'),
          renderable: n('renderable'),
          publishable: n('publishable'),
          sitemapEligible: n('sitemap_eligible'),
          withDecision: n('with_decision'),
          missingDecision: n('missing_decision'),
          staleDecision: n('stale_decision'),
        })
      }
      return out
    },

    /** Razoes das decisoes VIGENTES, agrupadas. SOMENTE LEITURA. */
    async readDecisionReasons(language: string) {
      const rows = await prisma.$queryRawUnsafe<{ reason: string | null; n: number }[]>(
        `SELECT COALESCE(reason, '(sem razao)') AS reason, COUNT(*)::int AS n
           FROM page_indexability_decisions
          WHERE is_current AND language_code = $1
          GROUP BY 1 ORDER BY n DESC`,
        language,
      )
      return rows.map((r) => ({ reason: String(r.reason), count: Number(r.n) }))
    },
  }
}
