/**
 * seo-preview.ts — O que o painel de SEO mostra e o que ele deriva. PURO.
 *
 * Duas responsabilidades, as duas com regra fechada:
 *
 *  1. DERIVAR sugestao quando o campo esta vazio — e NUNCA sobrescrever o que
 *     uma pessoa escreveu. Um painel que "melhora" o titulo escrito a mao apaga
 *     decisao editorial, e a pessoa so descobre depois de publicado.
 *  2. MEDIR o que o buscador corta, para o contador dizer a verdade.
 *
 * Os limites NAO sao promessa de exibicao: o Google monta o snippet do conteudo
 * e ignora a meta description quando quer. Sao referencia de truncamento, e o
 * texto do painel diz isso — prometer ranqueamento seria folclore.
 *
 * PURO e num `.ts` porque o vitest deste app nao coleta `.tsx`.
 */

/** Referencias de truncamento, em caracteres. Nao sao garantia de exibicao. */
export const SEO_LIMITS = {
  /** Titulo costuma cortar por volta daqui em resultado de desktop. */
  metaTitle: 60,
  /** Descricao costuma cortar por volta daqui. */
  metaDescription: 155,
} as const

export type SeoFieldStatus = 'empty' | 'ok' | 'long'

export interface SeoFieldMeasure {
  readonly length: number
  readonly limit: number
  readonly status: SeoFieldStatus
  /** Como o resultado de busca provavelmente corta. */
  readonly preview: string
}

/**
 * Mede um campo contra o limite de truncamento.
 *
 * `long` e AVISO, nunca bloqueio: titulo comprido nao impede publicar, e tratar
 * como erro faria a redacao contornar o painel em vez de usa-lo.
 */
export function measureSeoField(value: string | null | undefined, limit: number): SeoFieldMeasure {
  const text = (value ?? '').trim()
  if (text === '') return { length: 0, limit, status: 'empty', preview: '' }
  const status: SeoFieldStatus = text.length > limit ? 'long' : 'ok'
  // Corta com reticencia no limite, como o resultado de busca faz. `slice` em
  // unidades UTF-16 e a mesma unidade que o navegador conta.
  const preview = text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`
  return { length: text.length, limit, status, preview }
}

export type SeoValueOrigin = 'manual' | 'derived' | 'empty'

export interface SeoDerivedValue {
  readonly value: string
  readonly origin: SeoValueOrigin
}

/**
 * O valor efetivo de um campo de SEO: o escrito, ou o derivado.
 *
 * A REGRA QUE IMPORTA: `manual` vence sempre. Se ha texto escrito, ele volta
 * intacto e a origem diz `manual` — a interface pode mostrar "escrito pela
 * redacao" e nao ha caminho por onde a derivacao o substitua.
 *
 * Derivacao NAO e preenchimento: nada e gravado no documento. E sugestao de
 * exibicao, e por isso o painel pode mostrar de onde o valor veio.
 */
export function resolveSeoValue(
  written: string | null | undefined,
  fallback: string | null | undefined,
): SeoDerivedValue {
  const manual = (written ?? '').trim()
  if (manual !== '') return { value: manual, origin: 'manual' }
  const derived = (fallback ?? '').trim()
  if (derived !== '') return { value: derived, origin: 'derived' }
  return { value: '', origin: 'empty' }
}

export interface SerpPreview {
  /** A URL REAL da materia, como aparece no resultado. */
  readonly url: string
  readonly title: SeoFieldMeasure
  readonly description: SeoFieldMeasure
  readonly titleOrigin: SeoValueOrigin
  readonly descriptionOrigin: SeoValueOrigin
}

export interface SerpPreviewInput {
  readonly siteUrl: string
  readonly locale: string
  readonly slug: string
  readonly title: string | null
  readonly metaTitle: string | null
  readonly summary: string | null
  readonly metaDescription: string | null
}

/**
 * Monta a previsao de resultado de busca.
 *
 * A URL e a REAL (`/pt/noticias/<slug>/`), montada do idioma e da slug — nao um
 * exemplo. Um preview com URL falsa esconde justamente o erro que ele deveria
 * revelar: slug vazia, slug com acento, slug que ninguem revisou.
 */
export function buildSerpPreview(input: SerpPreviewInput): SerpPreview {
  const slug = input.slug.trim()
  const locale = input.locale.trim().toLowerCase().startsWith('pt') ? 'pt' : input.locale.trim()
  const base = input.siteUrl.replace(/\/+$/, '')
  const url = slug === '' ? `${base}/${locale}/noticias/…` : `${base}/${locale}/noticias/${slug}/`

  const title = resolveSeoValue(input.metaTitle, input.title)
  const description = resolveSeoValue(input.metaDescription, input.summary)

  return {
    url,
    title: measureSeoField(title.value, SEO_LIMITS.metaTitle),
    description: measureSeoField(description.value, SEO_LIMITS.metaDescription),
    titleOrigin: title.origin,
    descriptionOrigin: description.origin,
  }
}
