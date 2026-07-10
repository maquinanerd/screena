/**
 * public-catalog-slug.ts — Helpers PUROS de slug/rota para o backfill de
 * catalogo publico (TMDB). Sem rede, sem IO, sem Prisma: so decisao de string.
 *
 * A resolucao de COLISAO real (o slug ja pertence a OUTRA entidade?) e o
 * upsert idempotente + Redirect 301 exigem o banco e vivem no bin; aqui ficam
 * apenas as regras deterministicas: slugificar, sufixo `-tmdb-{id}` e o path de
 * rota canonico por tipo. Isso mantem a decisao testavel sem banco.
 */

/** Tipos de entidade com pagina publica canonica no catalogo. */
export type CatalogEntityType = 'movie' | 'tv' | 'person'

/** Segmento de rota pt-BR por tipo (espelha as rotas publicas de apps/web). */
const ROUTE_SEGMENT: Record<CatalogEntityType, string> = {
  movie: 'filmes',
  tv: 'series',
  person: 'pessoas',
}

/** slug SEO-friendly a partir de um texto (sem acento, minusculo, hifenizado). */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove diacriticos combinantes
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Sufixo de desambiguacao por TMDB id, usado quando o slug base ja pertence a
 * OUTRA entidade (colisao). Deterministico e estavel: o mesmo id sempre gera o
 * mesmo sufixo, entao re-sync nao cria variantes novas.
 */
export function withTmdbSuffix(baseSlug: string, tmdbId: number): string {
  return `${baseSlug}-tmdb-${tmdbId}`
}

/**
 * Path de rota canonico pt-BR de uma entidade (com barra final, sem dominio).
 * E a chave usada em `redirects.from_path`/`to_path` ao trocar o slug canonico.
 */
export function entityRoutePath(entityType: CatalogEntityType, slug: string): string {
  return `/pt/${ROUTE_SEGMENT[entityType]}/${slug}/`
}

/**
 * Slug canonico DESEJADO de um titulo de catalogo (antes da resolucao de
 * colisao no banco): `slugify(title)`; fallback `tmdb-{id}` quando o titulo nao
 * produz slug. Deterministico e estavel (o mesmo titulo/id sempre gera o mesmo
 * slug), entao re-sync/re-promocao nao cria variantes novas.
 *
 * O ANO DE LANCAMENTO NUNCA entra no slug: `/pt/filmes/a-origem/`, nunca
 * `/pt/filmes/a-origem-2010/`. Numeros que sobrevivem (`blade-runner-2049`,
 * `space-1999`) sao parte do TITULO, nao uma data pendurada na URL. O ano
 * continua no titulo visual, metadata, schema, filtros e listagens.
 *
 * A funcao NAO recebe `year` de proposito: sem o parametro, nenhum caller
 * consegue reintroduzir o sufixo de ano numa re-sync/re-promocao.
 *
 * PURO: nao decide colisao (isso exige o banco — ver `upsertCanonicalSlug` no
 * adapter de persistencia, que desambigua com `-tmdb-{id}` e grava o 301).
 * Reusado pelo backfill (ingest-public-catalog) e pela promocao de tmdb_raw,
 * para nao duplicar a regra de slug.
 */
export function desiredCatalogSlug(title: string, tmdbId: number): string {
  return slugify(title) || `tmdb-${tmdbId}`
}
