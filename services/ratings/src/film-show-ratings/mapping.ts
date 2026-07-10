/**
 * mapping.ts — Reconhecedor ESTRITO do payload de `/popular/`. Modulo PURO.
 *
 * CONTEXTO: a API Film/Show Ratings nao publica schema de resposta. Este modulo
 * NAO adivinha. Ele reconhece um contrato explicito e recusa todo o resto,
 * registrando o motivo. Enquanto o payload real nao for inspecionado por um
 * humano (via `--sample`), o resultado esperado e "0 mapeados, N recusados" —
 * e isso e SUCESSO, nao falha.
 *
 * Invariante 14 do escopo: `external_ratings` so recebe dado com mapping
 * inequivoco. Invariantes 1 e 2: a fonte editorial (`rating_source`) e a escala
 * sao da FONTE, nunca do fornecedor tecnico (`provider_api`); ambas passam por
 * `validateRating` (@screena/schemas) antes de virarem linha.
 *
 * CONTRATO ACEITO (tudo o mais e recusado). Duas FORMAS de `item.ratings`:
 *
 *   (a) formato ANTIGO — array de descritores homogeneos:
 *       item.ratings: [
 *         { source: "imdb", metric: "user_rating", value: 8.4, scale: 10,
 *           count?: 123, url?: "https://..." }
 *       ]
 *
 *   (b) formato REAL da RapidAPI — objeto POR FONTE, com `audience`/`critics`:
 *       item.ratings: {
 *         "IMDb": { "audience": { "rating": 7.6, "count": 33133, "bestValue": 10 } },
 *         "Rotten Tomatoes": {
 *           "audience": { "rating": 90, "bestValue": 100 },
 *           "critics":  { "rating": 80, "bestValue": 100 }
 *         }, ...
 *       }
 *       Cada `(fonte, metrica)` vira UM descritor: `metric` = "audience"/"critics",
 *       `value` = `rating`, `scale` = `bestValue`, `count` = `count`, e a url vem
 *       de `item.links[<nome-da-fonte>]`. Fontes nao governadas (ex.: "TMDB")
 *       sao recusadas por `unknown-rating-source`. NUNCA reescalamos: uma nota
 *       cuja `bestValue` diverge da escala canonica da fonte (ex.: user score do
 *       Metacritic em base 10 vs. Metascore canonico em base 100) e barrada por
 *       `validateRating` (rating-validation-failed), nao "convertida".
 *
 * Em ambas as formas, o item precisa de ao menos um id inequivoco, top-level
 * (`imdbId`/`imdb_id`, tt\d+; `tmdbId`/`tmdb_id`, inteiro > 0) ou aninhado em
 * `item.ids` (`ids.IMDb`/`ids.TMDB`).
 *
 * O `rating_label` NUNCA vem do payload: e derivado da fonte canonica
 * (RATING_SOURCE_SEED). Assim um "Tomatometer" atribuido ao IMDb e impossivel
 * por construcao, alem de barrado por `validateRating`.
 */

import { RATING_SCALES, RATING_SOURCES, type RatingSource } from '@screena/config'
import { RATING_SOURCE_SEED } from '@screena/db'
import { validateRating } from '@screena/schemas'

import type {
  ItemMapping,
  MappedPopularItem,
  PopularEntityRef,
  PopularMapping,
  RatingDraft,
  RatingRejection,
  RatingRejectionReason,
} from './types.js'

/**
 * Chaves sob as quais um array de itens pode aparecer no envelope da resposta.
 * `result` (singular) e a chave do payload real da RapidAPI (`{ status, date,
 * result: [...] }`); as demais cobrem envelopes antigos/alternativos.
 */
export const POPULAR_ARRAY_KEYS = ['results', 'result', 'data', 'items', 'popular', 'list'] as const

/** Metricas suportadas no formato POR FONTE (objeto): audience e/ou critics. */
export const OBJECT_METRIC_KEYS = ['audience', 'critics'] as const

/** Rotulo canonico por fonte editorial (nunca vem do payload). */
const SOURCE_LABEL: Readonly<Record<string, string>> = Object.fromEntries(
  RATING_SOURCE_SEED.map((entry) => [entry.key, entry.label]),
)

const RATING_SOURCE_SET: ReadonlySet<string> = new Set(RATING_SOURCES)

function reject(reason: RatingRejectionReason, detail: string): RatingRejection {
  return { reason, detail }
}

/** `value` e um objeto simples (nao array, nao null)? */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Le a primeira chave presente de uma lista de aliases. */
function pick(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) return record[key]
  }
  return undefined
}

/** Normaliza a fonte declarada: minuscula, trim, espacos/hifens -> underscore. */
export function normalizeSourceKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

/** Extrai um IMDb id valido (`tt` + digitos), ou null. */
export function readImdbId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return /^tt\d+$/.test(trimmed) ? trimmed : null
}

/** Extrai um TMDB id valido (inteiro > 0), ou null. Aceita `"278"` e `278`. */
export function readTmdbId(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10)
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
  }
  return null
}

/**
 * Le os identificadores externos de um item; null quando nenhum e inequivoco.
 *
 * Aceita os ids top-level (formato antigo) e o mapa aninhado `item.ids`
 * (`ids.IMDb`/`ids.TMDB`, formato real da RapidAPI). O top-level tem precedencia;
 * o aninhado e fallback. O id continua passando por `readImdbId`/`readTmdbId`,
 * entao um id malformado no `ids` nao "escapa" da validacao.
 */
export function readEntityRef(item: Record<string, unknown>): PopularEntityRef | null {
  const nested = pick(item, ['ids'])
  const ids = isRecord(nested) ? nested : null

  const imdbId =
    readImdbId(pick(item, ['imdbId', 'imdb_id', 'imdbID', 'imdb'])) ??
    (ids !== null ? readImdbId(pick(ids, ['IMDb', 'imdb', 'imdbId', 'imdb_id'])) : null)
  const tmdbId =
    readTmdbId(pick(item, ['tmdbId', 'tmdb_id', 'tmdbID'])) ??
    (ids !== null ? readTmdbId(pick(ids, ['TMDB', 'tmdb', 'tmdbId', 'tmdb_id'])) : null)

  if (imdbId === null && tmdbId === null) return null
  return { imdbId, tmdbId }
}

/** Le um inteiro nao-negativo, ou null. */
function readCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return Math.trunc(value)
}

/**
 * Le um numero FINITO. Aceita numero finito e string numerica finita
 * (ex.: `"7"`, `"7.6"`); qualquer outra coisa -> null. NUNCA reescala nem
 * arredonda — apenas interpreta a forma do valor.
 */
export function readFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** Le uma URL http(s), ou null. Nunca aceita esquema arbitrario. */
function readUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return /^https?:\/\//i.test(trimmed) ? trimmed : null
}

/**
 * Reconhece UM descritor de rating. Recusa (com motivo) qualquer ambiguidade.
 *
 * `providerApi` entra so para `validateRating` confirmar a invariante 2.
 */
export function readRatingDraft(
  descriptor: unknown,
  providerApi: string,
): { readonly ok: true; readonly draft: RatingDraft } | { readonly ok: false; readonly rejection: RatingRejection } {
  if (!isRecord(descriptor)) {
    return { ok: false, rejection: reject('descriptor-not-object', 'descritor de rating nao e objeto') }
  }

  const rawSource = pick(descriptor, ['source', 'rating_source', 'ratingSource'])
  if (typeof rawSource !== 'string') {
    return { ok: false, rejection: reject('unknown-rating-source', 'campo "source" ausente ou nao textual') }
  }
  const sourceKey = normalizeSourceKey(rawSource)
  if (!RATING_SOURCE_SET.has(sourceKey)) {
    return {
      ok: false,
      rejection: reject('unknown-rating-source', `fonte "${sourceKey}" fora de RATING_SOURCES`),
    }
  }
  const ratingSource = sourceKey as RatingSource

  const rawMetric = pick(descriptor, ['metric'])
  if (typeof rawMetric !== 'string' || rawMetric.trim() === '') {
    return {
      ok: false,
      rejection: reject('missing-metric', `fonte "${ratingSource}" sem "metric" explicito`),
    }
  }

  // Aceita numero e string numerica finita (ex.: `"7"`); nao numerico -> recusa.
  const ratingValue = readFiniteNumber(pick(descriptor, ['value', 'rating_value', 'ratingValue']))
  if (ratingValue === null || ratingValue < 0) {
    return {
      ok: false,
      rejection: reject('invalid-value', `fonte "${ratingSource}" com "value" nao numerico/negativo`),
    }
  }

  // A escala e propriedade da FONTE (regra de ratings, secao 3). Exigimos que o
  // payload a declare, e que ela case com a canonica — nunca reescalamos.
  const ratingScale = readFiniteNumber(pick(descriptor, ['scale', 'rating_scale', 'ratingScale']))
  if (ratingScale === null) {
    return {
      ok: false,
      rejection: reject('missing-scale', `fonte "${ratingSource}" sem "scale" explicito`),
    }
  }

  const expectedScale: number = RATING_SCALES[ratingSource]
  if (ratingValue > expectedScale) {
    return {
      ok: false,
      rejection: reject(
        'invalid-value',
        `valor ${ratingValue} excede a escala canonica ${expectedScale} de "${ratingSource}"`,
      ),
    }
  }

  const ratingLabel = SOURCE_LABEL[ratingSource] ?? ratingSource

  const draft: RatingDraft = {
    ratingSource,
    ratingLabel,
    metric: rawMetric.trim(),
    ratingValue,
    ratingScale,
    ratingCount: readCount(pick(descriptor, ['count', 'rating_count', 'ratingCount'])),
    ratingUrl: readUrl(pick(descriptor, ['url', 'rating_url', 'ratingUrl'])),
  }

  // Gate governado: escala por fonte, provider != source, anti cross-label.
  const validation = validateRating({
    ratingSource: draft.ratingSource,
    ratingLabel: draft.ratingLabel,
    metric: draft.metric,
    ratingValue: draft.ratingValue,
    ratingScale: draft.ratingScale,
    providerApi,
  })
  if (!validation.ok) {
    return {
      ok: false,
      rejection: reject('rating-validation-failed', validation.errors.join(' | ')),
    }
  }

  return { ok: true, draft }
}

/** Le o mapa `links` do item (`<nome-da-fonte>` -> url), ou null. */
function readLinksMap(item: Record<string, unknown>): Record<string, unknown> | null {
  const links = pick(item, ['links'])
  return isRecord(links) ? links : null
}

/**
 * Achata o formato POR FONTE (`ratings: { "IMDb": { audience, critics }, ... }`)
 * numa lista de descritores homogeneos, um por `(fonte, metrica)`. A url de cada
 * descritor vem de `links[<nome-da-fonte>]`.
 *
 * Este helper NAO decide nada: so reorganiza a forma. Fonte governada, escala da
 * fonte e `validateRating` continuam por conta de `readRatingDraft`, para onde
 * cada descritor gerado aqui e enviado (inclusive fontes nao governadas como
 * "TMDB", recusadas la por `unknown-rating-source`).
 */
export function flattenSourceKeyedRatings(
  ratings: Record<string, unknown>,
  links: Record<string, unknown> | null,
): unknown[] {
  const descriptors: unknown[] = []
  for (const [sourceName, sourceValue] of Object.entries(ratings)) {
    if (!isRecord(sourceValue)) continue
    const url = links !== null ? pick(links, [sourceName]) : undefined
    for (const metric of OBJECT_METRIC_KEYS) {
      const cell = sourceValue[metric]
      if (!isRecord(cell)) continue
      descriptors.push({
        source: sourceName,
        metric,
        value: cell['rating'],
        scale: cell['bestValue'],
        count: cell['count'],
        url,
      })
    }
  }
  return descriptors
}

/** Localiza o array de itens dentro do payload (array cru ou envelope conhecido). */
export function extractPopularItems(payload: unknown): readonly unknown[] | null {
  if (Array.isArray(payload)) return payload
  if (!isRecord(payload)) return null
  for (const key of POPULAR_ARRAY_KEYS) {
    const candidate = payload[key]
    if (Array.isArray(candidate)) return candidate
  }
  return null
}

/**
 * Reconhece UM item ja isolado (objeto do array de `/popular/` OU o `result`
 * objeto de `/item/`). Reusado por `mapPopularPayload` (por item do array) e por
 * `mapItemPayload` (item unico). O `index` e so rastreabilidade no relatorio.
 *
 * Aceita as DUAS formas de `item.ratings` (array antigo e objeto por fonte) e o
 * id top-level ou aninhado em `item.ids`. Nada aqui adivinha: fonte governada,
 * escala da fonte e `validateRating` continuam por conta de `readRatingDraft`.
 */
export function mapSingleItem(
  rawItem: unknown,
  index: number,
  providerApi: string,
): MappedPopularItem {
  if (!isRecord(rawItem)) {
    return {
      index,
      ref: null,
      ratings: [],
      rejections: [reject('item-not-object', `item ${index} nao e objeto`)],
    }
  }

  const rejections: RatingRejection[] = []
  const ref = readEntityRef(rawItem)
  if (ref === null) {
    rejections.push(reject('no-entity-id', `item ${index} sem imdbId/tmdbId inequivoco`))
  }

  const rawRatings = pick(rawItem, ['ratings', 'externalRatings', 'external_ratings'])
  let descriptors: readonly unknown[] | null = null
  if (Array.isArray(rawRatings)) {
    // Formato ANTIGO: array de descritores homogeneos.
    descriptors = rawRatings
  } else if (isRecord(rawRatings)) {
    // Formato REAL da RapidAPI: objeto por fonte com audience/critics.
    descriptors = flattenSourceKeyedRatings(rawRatings, readLinksMap(rawItem))
  }

  const drafts: RatingDraft[] = []
  if (descriptors === null || descriptors.length === 0) {
    rejections.push(
      reject(
        'no-rating-descriptors',
        `item ${index} sem "ratings" reconhecivel (array de fontes ou objeto por fonte)`,
      ),
    )
  } else {
    for (const descriptor of descriptors) {
      const result = readRatingDraft(descriptor, providerApi)
      if (result.ok) drafts.push(result.draft)
      else rejections.push(result.rejection)
    }
  }

  return { index, ref, ratings: drafts, rejections }
}

/**
 * Reconhece o payload inteiro de `/popular/`.
 *
 * NUNCA lanca: um payload irreconhecivel devolve `recognized: false` com o
 * motivo. O worker reporta e segue — sem gravar nada.
 */
export function mapPopularPayload(payload: unknown, providerApi: string): PopularMapping {
  const rawItems = extractPopularItems(payload)
  if (rawItems === null) {
    return {
      recognized: false,
      items: [],
      rejections: [
        reject(
          'payload-shape-unrecognized',
          `payload nao e array nem envelope com ${POPULAR_ARRAY_KEYS.join('/')}`,
        ),
      ],
    }
  }

  const items = rawItems.map((rawItem, index) => mapSingleItem(rawItem, index, providerApi))
  return { recognized: true, items, rejections: [] }
}

/**
 * Isola o item unico do payload de `/item/`. Modulo PURO.
 *
 * Aceita:
 *  - o envelope real `{ status, result: { ...item } }` — aqui `result` e um
 *    OBJETO (um titulo), diferente de `/popular/` onde `result` e um ARRAY.
 *    Por isso NAO reusamos `extractPopularItems` (que so aceita array): um
 *    array em `result` (payload de populares) e recusado por esta funcao.
 *  - o item cru `{ ratings, ids, links }` passado direto (facilita teste).
 *
 * Devolve `null` quando nada disso e reconhecido.
 */
export function extractItemObject(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload)) return null
  const result = payload['result']
  if (isRecord(result)) return result
  // Item cru passado direto (sem envelope): reconhece pela presenca das chaves
  // do contrato do item. Um envelope de `/popular/` (`result` array) nao tem
  // `ratings`/`ids`/`links` no topo, entao cai fora — o fluxo de item nunca
  // aceita, por engano, a lista de populares.
  if ('ratings' in payload || 'ids' in payload || 'links' in payload) return payload
  return null
}

/**
 * Reconhece o payload de `/item/?id=<id>` (UM titulo).
 *
 * NUNCA lanca: um payload irreconhecivel devolve `recognized: false` com o
 * motivo. Reusa integralmente `mapSingleItem` — ids/ratings/links/validateRating,
 * TMDB recusado como fonte, Metacritic audience recusado por escala.
 */
export function mapItemPayload(payload: unknown, providerApi: string): ItemMapping {
  const rawItem = extractItemObject(payload)
  if (rawItem === null) {
    return {
      recognized: false,
      item: null,
      rejections: [
        reject(
          'payload-shape-unrecognized',
          'payload de /item/ nao e { result: {...} } nem item cru { ratings/ids/links }',
        ),
      ],
    }
  }
  return { recognized: true, item: mapSingleItem(rawItem, 0, providerApi), rejections: [] }
}
