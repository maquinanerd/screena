/**
 * audit-reader.ts — Reader Prisma da auditoria. EXCLUIDO do typecheck.
 *
 * SOMENTE LEITURA, por construcao: este modulo so chama `count`, `findMany`,
 * `groupBy` e `aggregate`. Nao ha `update`, `create`, `delete`, `$executeRaw`
 * nem migration aqui — e a garantia e estrutural (o teste de governanca varre o
 * arquivo atras dessas palavras), nao uma promessa no comentario.
 *
 * Tambem nunca imprime `DATABASE_URL`: o reader devolve dados, quem formata e o
 * nucleo puro.
 */

/** Tipos de entidade contados no relatorio. */
const ENTITY_MODELS = [
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

/** Tipos que tem cobertura de midia. */
const COVERAGE_KINDS = [
  { kind: 'movie', model: 'movie' },
  { kind: 'tv', model: 'tvShow' },
  { kind: 'person', model: 'person' },
]

/** Divide protegendo contra total zero (0/0 seria NaN no relatorio). */
function ratio(part, total) {
  return total === 0 ? 0 : Math.round((part / total) * 10_000) / 10_000
}

/** Cria o reader Prisma da auditoria (somente leitura). */
export function createPrismaAuditReader(prisma) {
  return {
    async readEntityCounts() {
      const rows = []
      for (const { entity, model, hasLastSynced } of ENTITY_MODELS) {
        const delegate = prisma[model]
        // Modelo ausente no client (schema divergente) nao derruba a auditoria:
        // reportar 0 seria mentira, entao a linha simplesmente nao aparece.
        if (delegate === undefined || typeof delegate.count !== 'function') continue
        const total = await delegate.count()
        let lastSyncedAt = null
        if (hasLastSynced && total > 0) {
          const latest = await delegate.aggregate({ _max: { lastSyncedAt: true } })
          lastSyncedAt = latest?._max?.lastSyncedAt ?? null
        }
        rows.push({ entity, total, lastSyncedAt })
      }
      return rows
    },

    async readCoverage() {
      const rows = []
      for (const { kind, model } of COVERAGE_KINDS) {
        const delegate = prisma[model]
        if (delegate === undefined || typeof delegate.count !== 'function') continue
        const total = await delegate.count()

        // Cobertura e medida sobre as entidades DISTINTAS que tem midia, nao
        // sobre a contagem de linhas de midia: 40 posteres de 1 filme nao sao
        // "40 filmes cobertos".
        const withImagesRows = await prisma.tmdbImage.groupBy({
          by: ['entityId'],
          where: { entityType: kind },
        })
        const withTrailerRows = await prisma.tmdbVideo.groupBy({
          by: ['entityId'],
          where: { entityType: kind, type: 'Trailer' },
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
  }
}
