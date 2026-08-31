/**
 * localized-text.ts — Leitura PURA do texto localizado (sinopse, biografia) de
 * um payload de detalhe do TMDB, com PRECEDENCIA EXPLICITA e PROVENIENCIA.
 *
 * ============================================================================
 * O QUE ESTE MODULO CONSERTA
 * ============================================================================
 * O detalhe do TMDB e pedido com `language=pt-BR`. Quando o titulo NAO tem
 * traducao pt-BR, o campo `overview` de topo volta **string vazia** — nao volta
 * ausente, nem volta em ingles. Ate 2026-08-28 os leitores de exibicao liam so
 * esse campo de topo, e a cadeia era:
 *
 *     ""  ->  null  ->  upsertTranslation(..., null)  ->  summary = NULL
 *         ->  a politica decide `no_synopsis`
 *
 * Enquanto isso, `MOVIE_APPEND`/`TV_APPEND`/`PERSON_APPEND` ja pediam
 * `translations` em TODA requisicao de detalhe — o bloco com o texto de TODOS os
 * idiomas, incluindo o pt-BR quando ele existe. A cota ja tinha sido paga, o
 * bloco ja estava em `api_cache.payload` e em `tmdb_raw.payload`, e ninguem o
 * lia. Medido em producao em 2026-08-28: `no_synopsis` era 81.529 dos 306.800
 * `noindex` (26,6%), e `no_biography` outros 32.087 (10,5%).
 *
 * Ler o `pt-BR` que esta DENTRO de `translations` nao e fallback de idioma: e
 * ler o dado certo, no idioma certo, no lugar onde o TMDB o guardou. Por isso a
 * precedencia para AQUI (invariante 7):
 *
 *   1. campo de topo (`overview`/`biography`), quando nao vazio
 *   2. entrada `pt-BR` dentro de `translations`, quando nao vazia
 *   3. nada — `null`, sem inventar
 *
 * `pt-PT` NAO entra. Aceitar portugues europeu em pagina pt-BR e escolha
 * EDITORIAL do dono, nao conserto de bug; este modulo mede o que existe e para.
 *
 * ============================================================================
 * POR QUE A PROVENIENCIA E PARTE DO RETORNO
 * ============================================================================
 * Sem registrar DE ONDE o texto veio, ninguem consegue, depois, separar "a
 * sinopse sempre esteve no campo principal" de "a sinopse foi recuperada do
 * bloco de traducoes" — e a proxima pessoa refaz esta investigacao do zero. A
 * proveniencia viaja no valor de retorno e e agregada nos relatorios de
 * ingestao e de backfill.
 *
 * MODULO PURO: sem Prisma, sem rede, sem IO.
 */

/** Idioma e regiao aceitos DENTRO do bloco `translations` (invariante 7). */
export const ACCEPTED_TRANSLATION_LANGUAGE = 'pt'
/** Regiao aceita. `pt-PT` fica de fora de proposito — ver cabecalho. */
export const ACCEPTED_TRANSLATION_REGION = 'BR'

/** De onde o texto veio. `null` quando nao havia texto em lugar nenhum. */
export type LocalizedTextSource = 'detail' | 'translations'

/** Um texto localizado com a sua proveniencia. */
export interface LocalizedText {
  /** O texto, ou `null` quando ausente/vazio nas duas origens. */
  readonly text: string | null
  /** `detail` = campo de topo · `translations` = bloco de traducoes. */
  readonly source: LocalizedTextSource | null
}

/** Nada encontrado — constante para nao alocar um objeto por linha varrida. */
const AUSENTE: LocalizedText = Object.freeze({ text: null, source: null })

/** String nao vazia (apos trim) ou `null`. */
function textoOuNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return value.trim() === '' ? null : value
}

/**
 * A entrada `pt-BR` do bloco `translations`, se houver.
 *
 * Defensivo em cada nivel: o payload vem de `api_cache`/`tmdb_raw`, onde
 * convivem respostas de varias epocas do provider. Um `translations` ausente,
 * nulo, com forma diferente ou com `data` nao-objeto tem de devolver `null` —
 * nunca estourar no meio de um backfill de centenas de milhares de linhas.
 */
function entradaPtBr(payload: unknown): Record<string, unknown> | null {
  if (payload === null || typeof payload !== 'object') return null
  const bloco = (payload as { translations?: unknown }).translations
  if (bloco === null || typeof bloco !== 'object') return null
  const lista = (bloco as { translations?: unknown }).translations
  if (!Array.isArray(lista)) return null

  for (const item of lista) {
    if (item === null || typeof item !== 'object') continue
    const entrada = item as { iso_639_1?: unknown; iso_3166_1?: unknown; data?: unknown }
    if (entrada.iso_639_1 !== ACCEPTED_TRANSLATION_LANGUAGE) continue
    if (entrada.iso_3166_1 !== ACCEPTED_TRANSLATION_REGION) continue
    if (entrada.data === null || typeof entrada.data !== 'object') continue
    return entrada.data as Record<string, unknown>
  }
  return null
}

/**
 * Le UM campo de texto do payload de detalhe, com a precedencia canonica.
 *
 * `field` e o nome do campo nos DOIS lugares (o TMDB usa a mesma chave no topo e
 * dentro de `data`): `overview` para filme/serie, `biography` para pessoa.
 */
export function pickLocalizedText(payload: unknown, field: string): LocalizedText {
  const doTopo =
    payload !== null && typeof payload === 'object'
      ? textoOuNull((payload as Record<string, unknown>)[field])
      : null
  if (doTopo !== null) return { text: doTopo, source: 'detail' }

  const data = entradaPtBr(payload)
  if (data === null) return AUSENTE
  const doBloco = textoOuNull(data[field])
  if (doBloco === null) return AUSENTE
  return { text: doBloco, source: 'translations' }
}

/** Sinopse de filme/serie: `overview` de topo -> `translations` pt-BR. */
export function pickOverview(payload: unknown): LocalizedText {
  return pickLocalizedText(payload, 'overview')
}

/** Biografia de pessoa: `biography` de topo -> `translations` pt-BR. */
export function pickBiography(payload: unknown): LocalizedText {
  return pickLocalizedText(payload, 'biography')
}
