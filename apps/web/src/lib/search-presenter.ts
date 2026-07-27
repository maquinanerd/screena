/**
 * search-presenter.ts - Monta a view da busca publica tecnica (/pt/busca).
 * PURO: sem rede, sem DB, sem IO. Recebe linhas ja lidas do PostgreSQL pelo
 * getter server-only e devolve a view pronta para render.
 *
 * Regras duras (espelham os demais presenters):
 *  - nao inventa destino: linha sem `canonicalUrl` utilizavel NAO entra (nunca
 *    linkamos pagina inexistente) e `entity_type` fora de movie|tv|person e
 *    descartado;
 *  - href sempre INTERNO (mesma origem): so path root-relative; URL absoluta e
 *    reduzida ao seu pathname. Nunca emite link externo/`javascript:`;
 *  - imagem: URL remota do TMDB montada do `file_path` cru pelo helper governado
 *    (`buildTmdbImageUrl`); path invalido -> null -> sem imagem;
 *  - a busca NUNCA e indexavel (decidido na rota); aqui nao ha gate de SEO.
 */

import { buildTmdbImageUrl, type TmdbImageSize } from './tmdb-image-url'

/** Tipos de entidade projetados na busca (subset renderavel de EntityType). */
const RESULT_KINDS = ['movie', 'tv', 'person'] as const

export type SearchResultKind = (typeof RESULT_KINDS)[number]

/**
 * Tamanho TMDB do thumb de resultado. O contrato pedia `w185`, mas o helper
 * governado so aceita w300|w500|w780|w1280|original — `w300` e o menor
 * suportado e o mais proximo. O host e os tamanhos vivem SO em
 * `tmdb-image-url.ts`; nao inventamos segmento novo aqui.
 */
const RESULT_IMAGE_SIZE: TmdbImageSize = 'w300'

export interface SearchResultView {
  entityId: string
  kind: SearchResultKind
  title: string
  subtitle: string | null
  year: number | null
  href: string
  imageUrl: string | null
  matchReason: string
  score: number
}

/**
 * Resultado editorial (noticia). Deliberadamente um TIPO SEPARADO de
 * `SearchResultView`: artigo nao tem `entityId`, `kind` de catalogo nem ano de
 * obra, e a UI precisa rotula-lo como "Noticia" em vez de fingir que e uma
 * entidade. Espremer o artigo no molde da entidade produziria exatamente a
 * confusao que a invariante 11 proibe (tipo nunca depende so de cor/formato).
 */
export interface SearchNewsResultView {
  articleId: string
  title: string
  subtitle: string | null
  href: string
  matchReason: string
  score: number
}

export interface SearchPageView {
  query: string
  results: SearchResultView[]
  news: SearchNewsResultView[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
  isEmptyQuery: boolean
}

/** Linha crua de resultado (ja convertida de Prisma pelo getter). */
export interface SearchRowInput {
  entityType: string
  entityId: string
  title: string
  subtitle: string | null
  year: number | null
  imagePath: string | null
  canonicalUrl: string | null
  matchReason: string
  score: number
}

/** Linha crua de resultado editorial (doc_kind='article'). */
export interface SearchNewsRowInput {
  articleId: string
  title: string
  subtitle: string | null
  canonicalUrl: string | null
  matchReason: string
  score: number
}

export interface SearchPageViewInput {
  query: string
  rows: readonly SearchRowInput[]
  /** Linhas editoriais; ausente = nenhuma noticia casou o termo. */
  newsRows?: readonly SearchNewsRowInput[]
  limit: number
  offset: number
}

function trimToNull(value: string | null | undefined): string | null {
  if (value == null) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** Narrowing do `entity_type` cru; valor desconhecido -> null (linha descartada). */
function toKind(value: string): SearchResultKind | null {
  const found = RESULT_KINDS.find((kind) => kind === value)
  return found ?? null
}

/**
 * Reduz o `canonical_url` persistido a um href INTERNO seguro:
 *  - path root-relative (`/pt/filmes/x/`) -> usado como esta;
 *  - URL absoluta http(s) (canonical da propria origem) -> so o `pathname`;
 *  - qualquer outra coisa (vazio, `//host`, `javascript:`, path relativo) -> null.
 *
 * Retornar `null` faz a linha ser descartada: sem destino confiavel, nao ha link.
 */
export function toInternalHref(canonicalUrl: string | null | undefined): string | null {
  const value = trimToNull(canonicalUrl)
  if (value === null) return null
  if (value.startsWith('//')) return null
  if (value.startsWith('/')) return value

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  return url.pathname
}

function validYearOrNull(value: number | null | undefined): number | null {
  if (value == null || !Number.isInteger(value) || value <= 0) return null
  return value
}

function finiteScore(value: number): number {
  return Number.isFinite(value) ? value : 0
}

/** Constroi um resultado, ou `null` quando a linha nao e utilizavel. */
export function buildSearchResult(row: SearchRowInput): SearchResultView | null {
  const kind = toKind(row.entityType)
  const title = trimToNull(row.title)
  const href = toInternalHref(row.canonicalUrl)
  if (kind === null || title === null || href === null) return null

  return {
    entityId: row.entityId,
    kind,
    title,
    subtitle: trimToNull(row.subtitle),
    year: validYearOrNull(row.year),
    href,
    imageUrl: buildTmdbImageUrl(row.imagePath, RESULT_IMAGE_SIZE),
    matchReason: row.matchReason,
    score: finiteScore(row.score),
  }
}

/** Constroi um resultado editorial, ou `null` quando a linha nao e utilizavel. */
export function buildSearchNewsResult(row: SearchNewsRowInput): SearchNewsResultView | null {
  const title = trimToNull(row.title)
  const href = toInternalHref(row.canonicalUrl)
  // Mesmo criterio das entidades: sem destino interno confiavel nao ha link.
  if (title === null || href === null) return null
  return {
    articleId: row.articleId,
    title,
    subtitle: trimToNull(row.subtitle),
    href,
    matchReason: row.matchReason,
    score: finiteScore(row.score),
  }
}

/**
 * Monta a view da pagina de busca.
 *
 * `hasMore` olha o total de linhas RECEBIDAS do banco (nao o de resultados
 * exibidos): o banco devolveu uma pagina cheia, logo pode haver mais. Usar a
 * contagem pos-descarte encerraria a paginacao cedo demais quando uma linha e
 * descartada por falta de canonical.
 *
 * `total` e a contagem desta PAGINA (nao ha COUNT global — a consulta e paginada).
 */
export function buildSearchPageView(input: SearchPageViewInput): SearchPageView {
  const query = input.query.trim()
  const results: SearchResultView[] = []
  for (const row of input.rows) {
    const result = buildSearchResult(row)
    if (result !== null) results.push(result)
  }

  const news: SearchNewsResultView[] = []
  for (const row of input.newsRows ?? []) {
    const result = buildSearchNewsResult(row)
    if (result !== null) news.push(result)
  }

  return {
    query,
    results,
    news,
    total: results.length,
    limit: input.limit,
    offset: input.offset,
    hasMore: input.rows.length === input.limit,
    isEmptyQuery: query === '',
  }
}
