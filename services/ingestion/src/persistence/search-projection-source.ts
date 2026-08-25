/**
 * search-projection-source.ts — Adapter Prisma da leitura de entidades para a
 * projecao de busca (Backend A, secao 9). COBERTO por `tsconfig.runtime.json` (`pnpm
 * typecheck` encadeia os dois).
 *
 * Implementa `SearchProjectionSourcePort`. A paginacao roda sobre a tabela
 * `slugs` (canonico do locale), NAO sobre movies/tv_shows/people: o conjunto
 * indexavel E o conjunto que tem slug canonico. Entidade sem slug canonico fica
 * de fora — resultado de busca precisa apontar para pagina real, nunca para 404.
 *
 * Rota canonica (pt): /pt/filmes/{slug}/, /pt/series/{slug}/, /pt/pessoas/{slug}/.
 * Somente leitura: nao escreve nada, nao chama rede (invariante 3).
 */

import type { PrismaClient } from '@screena/db/server'
import type {
  SearchProjectionSourcePort,
  SearchProjectionSourceRow,
} from '../search-projection/index.js'
import type { SearchEntityType } from '../search/projection.js'

/** Segmento de rota pt por tipo (invariante 11: filme e serie nunca colidem). */
const ROUTE_SEGMENT: Record<SearchEntityType, string> = {
  movie: 'filmes',
  tv: 'series',
  person: 'pessoas',
}

/** Monta o caminho canonico pt da entidade. */
function buildCanonicalUrl(entityType: SearchEntityType, slug: string): string {
  return `/pt/${ROUTE_SEGMENT[entityType]}/${slug}/`
}

/** Ano de uma data @db.Date (UTC: o Prisma devolve meia-noite UTC). */
function yearOf(date: Date | null): number | null {
  return date === null ? null : date.getUTCFullYear()
}

/** Decimal (Prisma) -> number puro; null continua null. */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Texto util (nao vazio) ou null. */
function nonEmpty(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

/** Cria um `SearchProjectionSourcePort` apoiado no Prisma. */
export function createPrismaSearchProjectionSource(
  prisma: PrismaClient,
): SearchProjectionSourcePort {
  /** Slugs canonicos do locale, ordenados por entityId (paginacao estavel). */
  async function readCanonicalSlugs(
    entityType: SearchEntityType,
    locale: string,
    take: number,
    skip: number,
  ): Promise<{ entityId: bigint; slug: string }[]> {
    return prisma.slug.findMany({
      where: { entityType, languageCode: locale, isCanonical: true },
      orderBy: { entityId: 'asc' },
      select: { entityId: true, slug: true },
      take,
      skip,
    })
  }

  /** Titulo traduzido por entidade (movie/tv); ausente cai no titulo original. */
  async function readTranslatedTitles(
    entityType: SearchEntityType,
    entityIds: bigint[],
    locale: string,
  ): Promise<Map<string, string>> {
    const rows = await prisma.entityTranslation.findMany({
      where: { entityType, entityId: { in: entityIds }, languageCode: locale },
      select: { entityId: true, title: true },
    })
    const byId = new Map<string, string>()
    for (const row of rows) {
      const title = nonEmpty(row.title)
      if (title !== null) byId.set(row.entityId.toString(), title)
    }
    return byId
  }

  /** Titulos alternativos por entidade (movie/tv). */
  async function readAliases(
    entityType: SearchEntityType,
    entityIds: bigint[],
  ): Promise<Map<string, string[]>> {
    const rows = await prisma.entityAlternativeTitle.findMany({
      where: { entityType, entityId: { in: entityIds } },
      select: { entityId: true, title: true },
    })
    const byId = new Map<string, string[]>()
    for (const row of rows) {
      const title = nonEmpty(row.title)
      if (title === null) continue
      const key = row.entityId.toString()
      const existing = byId.get(key)
      if (existing === undefined) byId.set(key, [title])
      else existing.push(title)
    }
    return byId
  }

  /**
   * Monta as linhas de um lote de slugs.
   *
   * Slug pendurado (sem entidade correspondente) e simplesmente ignorado: a
   * pagina fica curta, e a porta ja documenta que so pagina vazia encerra.
   */
  async function assembleBatch(
    entityType: SearchEntityType,
    slugs: { entityId: bigint; slug: string }[],
    locale: string,
  ): Promise<SearchProjectionSourceRow[]> {
    if (slugs.length === 0) return []
    const entityIds = slugs.map((s) => s.entityId)

    if (entityType === 'person') {
      const people = await prisma.person.findMany({
        where: { id: { in: entityIds } },
        select: { id: true, name: true, profilePath: true },
      })
      const byId = new Map(people.map((p) => [p.id.toString(), p]))
      const rows: SearchProjectionSourceRow[] = []
      for (const entry of slugs) {
        const person = byId.get(entry.entityId.toString())
        if (person === undefined) continue
        rows.push({
          entityType: 'person',
          entityId: person.id.toString(),
          primaryText: person.name,
          aliases: [],
          year: null,
          popularity: null,
          imagePath: person.profilePath,
          canonicalUrl: buildCanonicalUrl('person', entry.slug),
          subtitle: null,
        })
      }
      return rows
    }

    const [titles, aliases] = await Promise.all([
      readTranslatedTitles(entityType, entityIds, locale),
      readAliases(entityType, entityIds),
    ])

    if (entityType === 'movie') {
      const movies = await prisma.movie.findMany({
        where: { id: { in: entityIds } },
        select: {
          id: true,
          titleOriginal: true,
          releaseDate: true,
          popularity: true,
          posterPath: true,
        },
      })
      const byId = new Map(movies.map((m) => [m.id.toString(), m]))
      const rows: SearchProjectionSourceRow[] = []
      for (const entry of slugs) {
        const key = entry.entityId.toString()
        const movie = byId.get(key)
        if (movie === undefined) continue
        rows.push({
          entityType: 'movie',
          entityId: key,
          primaryText: titles.get(key) ?? movie.titleOriginal,
          aliases: aliases.get(key) ?? [],
          year: yearOf(movie.releaseDate),
          popularity: toNumber(movie.popularity),
          imagePath: movie.posterPath,
          canonicalUrl: buildCanonicalUrl('movie', entry.slug),
          subtitle: null,
        })
      }
      return rows
    }

    const shows = await prisma.tvShow.findMany({
      where: { id: { in: entityIds } },
      select: {
        id: true,
        nameOriginal: true,
        firstAirDate: true,
        popularity: true,
        posterPath: true,
      },
    })
    const byId = new Map(shows.map((s) => [s.id.toString(), s]))
    const rows: SearchProjectionSourceRow[] = []
    for (const entry of slugs) {
      const key = entry.entityId.toString()
      const show = byId.get(key)
      if (show === undefined) continue
      rows.push({
        entityType: 'tv',
        entityId: key,
        primaryText: titles.get(key) ?? show.nameOriginal,
        aliases: aliases.get(key) ?? [],
        year: yearOf(show.firstAirDate),
        popularity: toNumber(show.popularity),
        imagePath: show.posterPath,
        canonicalUrl: buildCanonicalUrl('tv', entry.slug),
        subtitle: null,
      })
    }
    return rows
  }

  return {
    /** Total de entidades do tipo. Teto superior (inclui quem nao tem slug): so log. */
    async countEntities(entityType: SearchEntityType): Promise<number> {
      if (entityType === 'movie') return prisma.movie.count()
      if (entityType === 'tv') return prisma.tvShow.count()
      return prisma.person.count()
    },

    async readEntities(
      entityType: SearchEntityType,
      opts: { limit: number; offset: number; locale: string },
    ): Promise<SearchProjectionSourceRow[]> {
      const slugs = await readCanonicalSlugs(entityType, opts.locale, opts.limit, opts.offset)
      return assembleBatch(entityType, slugs, opts.locale)
    },

    async readEntity(
      entityType: SearchEntityType,
      entityId: string,
      locale: string,
    ): Promise<SearchProjectionSourceRow | null> {
      const id = BigInt(entityId)
      const slug = await prisma.slug.findFirst({
        where: { entityType, entityId: id, languageCode: locale, isCanonical: true },
        select: { entityId: true, slug: true },
      })
      // Sem slug canonico => nao indexavel => o chamador remove o documento antigo.
      if (slug === null) return null
      const rows = await assembleBatch(entityType, [slug], locale)
      return rows[0] ?? null
    },
  }
}
