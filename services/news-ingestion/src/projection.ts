/**
 * projection.ts — Projecao PURA de um artigo publicado para as duas superficies
 * derivadas: a busca (`search_documents`) e a decisao de indexabilidade
 * (`page_indexability_decisions`).
 *
 * As duas usam as tabelas que JA existem, via o discriminador `PublicDocKind`.
 * Nenhum search engine paralelo, nenhuma segunda tabela de indexabilidade.
 *
 * Regra que atravessa o arquivo: um artigo NAO publicavel nao gera documento
 * nem decisao `index` — e, mais importante, quando deixa de ser publicavel o
 * documento precisa ser REMOVIDO. Projecao que so cria e nunca apaga deixa
 * rascunho e materia retratada pesquisaveis depois de saírem do ar.
 */

import {
  evaluateArticlePublication,
  resolveArticlePublishedIso,
  type ArticleUnpublishableReason,
} from '@screena/seo'

import { articlePath } from './slug.js'

/**
 * Dobra de texto para busca. IDENTICA a `foldText` de
 * `services/ingestion/src/search/fold.ts` — o casamento so funciona se os dois
 * lados dobrarem igual. Reimplementada aqui em vez de importada porque os dois
 * services nao se importam entre si; `tests/.../fold-parity` trava a igualdade.
 */
export function foldText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Fatos de um artigo + traducao, ja lidos do PostgreSQL. */
export interface ArticleProjectionInput {
  readonly articleId: string
  readonly locale: string
  readonly slug: string | null
  readonly title: string | null
  readonly deck: string | null
  readonly body: string | null
  readonly category: string | null
  readonly authorName: string | null
  readonly heroImagePath: string | null
  readonly reviewStatus: string
  readonly indexStatus: string
  readonly licenseStatus: string
  readonly displayAllowed: boolean
  readonly requiresAttribution: boolean
  readonly requiresLinkback: boolean
  readonly sourceName: string | null
  readonly sourceUrl: string | null
  readonly translationPublishedAtIso: string | null
  readonly articlePublishedAtIso: string | null
}

/** Linha de `search_documents` para um artigo (doc_kind = 'article'). */
export interface ArticleSearchDocument {
  readonly articleId: string
  readonly locale: string
  readonly primaryText: string
  readonly alternativeText: string
  readonly normalizedText: string
  readonly normalizedAliases: string
  readonly subtitle: string | null
  readonly canonicalUrl: string
  readonly imagePath: string | null
}

/** Corpo minimo para o artigo nao ser considerado fino (espelha o apps/web). */
export const MIN_ARTICLE_BODY_CHARS = 200

function trimToNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function publicationOf(input: ArticleProjectionInput, nowIso: string) {
  return evaluateArticlePublication(
    {
      reviewStatus: input.reviewStatus,
      licenseStatus: input.licenseStatus,
      displayAllowed: input.displayAllowed,
      slug: input.slug,
      title: input.title,
      publishedAtIso: resolveArticlePublishedIso(
        input.translationPublishedAtIso,
        input.articlePublishedAtIso,
      ),
      requiresAttribution: input.requiresAttribution,
      requiresLinkback: input.requiresLinkback,
      sourceName: input.sourceName,
      sourceUrl: input.sourceUrl,
    },
    nowIso,
  )
}

/**
 * Projeta o artigo para a busca. `null` significa REMOVER o documento — e o
 * caminho que tira do indice rascunho, materia retratada e materia agendada.
 *
 * O que e indexado e deliberadamente magro: manchete, deck e categoria/autor.
 * O corpo NAO entra, e o payload cru da fonte MUITO menos — a busca nao e um
 * espelho de conteudo de terceiro.
 */
export function projectArticleSearchDocument(
  input: ArticleProjectionInput,
  nowIso: string,
): ArticleSearchDocument | null {
  if (!publicationOf(input, nowIso).publishable) return null

  const title = trimToNull(input.title)
  const slug = trimToNull(input.slug)
  if (title === null || slug === null) return null

  const deck = trimToNull(input.deck)
  const aliases = [deck].filter((value): value is string => value !== null)
  const alternativeText = aliases.join(' | ')

  const category = trimToNull(input.category)
  const author = trimToNull(input.authorName)
  const subtitleParts = ['Noticia', category].filter(
    (value): value is string => value !== null,
  )

  return {
    articleId: input.articleId,
    locale: input.locale,
    primaryText: title,
    alternativeText,
    normalizedText: foldText([title, alternativeText, author ?? ''].join(' ')),
    normalizedAliases: aliases.map(foldText).filter((a) => a !== '').join('|'),
    subtitle: subtitleParts.join(' · '),
    canonicalUrl: articlePath(slug),
    imagePath: trimToNull(input.heroImagePath),
  }
}

/** Decisao espelhando o enum `IndexDecision`. */
export type ArticleIndexDecision = 'index' | 'noindex' | 'draft' | 'stale' | 'blocked'

export interface ArticleIndexabilityDecision {
  readonly decision: ArticleIndexDecision
  readonly reason: string
  readonly url: string | null
  /** Sinais de riqueza, informativos (indexacao total: nao sao gate). */
  readonly hasNews: boolean
  readonly hasUniqueIntro: boolean
}

/** Idiomas publicados hoje (invariante 7). */
const PUBLISHED_LOCALES: ReadonlySet<string> = new Set(['pt-BR', 'pt'])

/**
 * Decide a indexabilidade de um artigo, na MESMA precedencia da politica de
 * SEO (`.claude/rules/seo.md`, secao 3), do mais restritivo ao menos:
 *
 *   1. licenca bloqueada          -> `blocked`   (invariante 6)
 *   2. idioma fora do publicado   -> `draft`     (invariante 7)
 *   3. caso tecnico               -> `noindex`
 *   4. caso contrario             -> `index`     (invariante 5: indexacao total)
 *
 * "Caso tecnico" para artigo inclui nao estar publicavel (rascunho, retratado,
 * agendado, sem slug/titulo/atribuicao), corpo insuficiente, e a decisao
 * editorial `index_status` — que so REBAIXA, nunca forca `index`.
 */
export function decideArticleIndexability(
  input: ArticleProjectionInput,
  nowIso: string,
): ArticleIndexabilityDecision {
  const slug = trimToNull(input.slug)
  const url = slug === null ? null : articlePath(slug)
  const body = (input.body ?? '').trim()
  const hasUniqueIntro = body.length >= MIN_ARTICLE_BODY_CHARS

  const publication = publicationOf(input, nowIso)
  const reasons: readonly ArticleUnpublishableReason[] = publication.reasons

  // 1. Licenca (invariante 6) vence tudo.
  if (
    reasons.includes('blocked_license') ||
    reasons.includes('display_not_allowed') ||
    reasons.includes('missing_required_attribution') ||
    reasons.includes('missing_required_linkback')
  ) {
    return {
      decision: 'blocked',
      reason: `licenca/atribuicao: ${reasons.join(',')}`,
      url,
      hasNews: true,
      hasUniqueIntro,
    }
  }

  // 2. Idioma (invariante 7).
  if (!PUBLISHED_LOCALES.has(input.locale)) {
    return {
      decision: 'draft',
      reason: `idioma fora de PUBLISHED_LOCALES: ${input.locale}`,
      url,
      hasNews: true,
      hasUniqueIntro,
    }
  }

  // 3. Casos tecnicos.
  if (reasons.length > 0) {
    return { decision: 'noindex', reason: reasons.join(','), url, hasNews: true, hasUniqueIntro }
  }
  if (!hasUniqueIntro) {
    return {
      decision: 'noindex',
      reason: `corpo insuficiente (< ${MIN_ARTICLE_BODY_CHARS} chars)`,
      url,
      hasNews: true,
      hasUniqueIntro,
    }
  }
  if (input.indexStatus !== 'index') {
    return {
      decision: input.indexStatus === 'blocked' ? 'blocked' : 'noindex',
      reason: `decisao editorial index_status=${input.indexStatus}`,
      url,
      hasNews: true,
      hasUniqueIntro,
    }
  }

  // 4. Indexacao total.
  return { decision: 'index', reason: 'artigo publicado e licenciado', url, hasNews: true, hasUniqueIntro }
}
