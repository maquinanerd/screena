/**
 * projection.ts — Projecao PURA de uma entidade para a busca (search_documents).
 *
 * Denormaliza uma entidade RENDERAVEL (movie/tv/person) + titulos alternativos
 * numa linha de search_documents. `normalizedText` e a dobra de
 * `primaryText + alternativeText` (o texto sobre o qual o casamento acontece).
 * Puro: sem DB, sem rede. O adapter converte entityId (string) em BigInt e faz
 * o upsert.
 */

import { foldText } from './fold.js'

/** Tipo de entidade indexavel na busca (subconjunto renderavel de EntityType). */
export type SearchEntityType = 'movie' | 'tv' | 'person'

/** Entrada da projecao (dados ja lidos do PostgreSQL pelo worker). */
export interface SearchProjectionInput {
  readonly entityType: SearchEntityType
  readonly entityId: string
  readonly locale: string
  /** Titulo/nome canonico exibido. */
  readonly primaryText: string
  /** Titulos alternativos / aliases (opcional). */
  readonly alternativeTitles?: readonly string[]
  /** Linha de apoio (ex.: "Filme · 1999"). */
  readonly subtitle?: string | null
  readonly year?: number | null
  readonly popularity?: number | null
  /** file_path cru (a URL e montada no render por buildTmdbImageUrl). */
  readonly imagePath?: string | null
  readonly canonicalUrl?: string | null
}

/** Linha pronta para persistir em search_documents. */
export interface SearchDocumentRow {
  readonly entityType: SearchEntityType
  readonly entityId: string
  readonly locale: string
  readonly primaryText: string
  readonly alternativeText: string
  readonly normalizedText: string
  /** Aliases dobrados, '|'-delimitados (casamento exato de alias). */
  readonly normalizedAliases: string
  readonly subtitle: string | null
  readonly year: number | null
  readonly popularity: number | null
  readonly imagePath: string | null
  readonly canonicalUrl: string | null
}

/** Junta aliases num unico texto de exibicao, sem vazios e sem duplicatas. */
function joinAlternatives(titles: readonly string[]): string {
  const seen = new Set<string>()
  const kept: string[] = []
  for (const title of titles) {
    const trimmed = title.trim()
    if (trimmed.length === 0) continue
    const key = foldText(trimmed)
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(trimmed)
  }
  return kept.join(' | ')
}

/**
 * Constroi a linha de search_documents a partir da entrada.
 *
 * `normalizedText` dobra `primaryText` + todos os aliases (o alvo do casamento
 * exato/prefixo/fuzzy). Vazio em primaryText nunca deveria acontecer, mas a
 * funcao permanece total (normalizedText vira '').
 */
export function buildSearchDocument(input: SearchProjectionInput): SearchDocumentRow {
  const primaryText = input.primaryText.trim()
  const alternatives = input.alternativeTitles ?? []
  const alternativeText = joinAlternatives(alternatives)
  const normalizedText = foldText([primaryText, ...alternatives].join(' '))
  // Aliases dobrados individualmente, deduplicados, '|'-delimitados. Permite o
  // casamento EXATO de alias ($term = ANY(...)) que o normalized_text concatenado
  // nao consegue (um alias nunca iguala o texto inteiro).
  const normalizedAliases = Array.from(
    new Set(alternatives.map((a) => foldText(a)).filter((a) => a.length > 0)),
  ).join('|')

  return {
    entityType: input.entityType,
    entityId: input.entityId,
    locale: input.locale,
    primaryText,
    alternativeText,
    normalizedText,
    normalizedAliases,
    subtitle: input.subtitle ?? null,
    year: input.year ?? null,
    popularity: input.popularity ?? null,
    imagePath: input.imagePath ?? null,
    canonicalUrl: input.canonicalUrl ?? null,
  }
}
