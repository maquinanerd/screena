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
 * CONTRATO ACEITO (tudo o mais e recusado):
 *   item.ratings: [
 *     { source: "imdb", metric: "user_rating", value: 8.4, scale: 10,
 *       count?: 123, url?: "https://..." }
 *   ]
 *   e, no item, ao menos um id inequivoco: `imdbId`/`imdb_id` (tt\d+) ou
 *   `tmdbId`/`tmdb_id` (inteiro > 0).
 *
 * O `rating_label` NUNCA vem do payload: e derivado da fonte canonica
 * (RATING_SOURCE_SEED). Assim um "Tomatometer" atribuido ao IMDb e impossivel
 * por construcao, alem de barrado por `validateRating`.
 */

import { RATING_SCALES, RATING_SOURCES, type RatingSource } from '@screena/config'
import { RATING_SOURCE_SEED } from '@screena/db'
import { validateRating } from '@screena/schemas'

import type {
  MappedPopularItem,
  PopularEntityRef,
  PopularMapping,
  RatingDraft,
  RatingRejection,
  RatingRejectionReason,
} from './types.js'

/** Chaves sob as quais um array de itens pode aparecer no envelope da resposta. */
export const POPULAR_ARRAY_KEYS = ['results', 'data', 'items', 'popular', 'list'] as const

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

/** Le os identificadores externos de um item; null quando nenhum e inequivoco. */
export function readEntityRef(item: Record<string, unknown>): PopularEntityRef | null {
  const imdbId = readImdbId(pick(item, ['imdbId', 'imdb_id', 'imdbID', 'imdb']))
  const tmdbId = readTmdbId(pick(item, ['tmdbId', 'tmdb_id', 'tmdbID']))
  if (imdbId === null && tmdbId === null) return null
  return { imdbId, tmdbId }
}

/** Le um inteiro nao-negativo, ou null. */
function readCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return Math.trunc(value)
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

  const rawValue = pick(descriptor, ['value', 'rating_value', 'ratingValue'])
  const ratingValue = typeof rawValue === 'number' ? rawValue : Number.NaN
  if (!Number.isFinite(ratingValue) || ratingValue < 0) {
    return {
      ok: false,
      rejection: reject('invalid-value', `fonte "${ratingSource}" com "value" nao numerico/negativo`),
    }
  }

  // A escala e propriedade da FONTE (regra de ratings, secao 3). Exigimos que o
  // payload a declare, e que ela case com a canonica — nunca reescalamos.
  const rawScale = pick(descriptor, ['scale', 'rating_scale', 'ratingScale'])
  if (typeof rawScale !== 'number' || !Number.isFinite(rawScale)) {
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
    ratingScale: rawScale,
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

  const items: MappedPopularItem[] = []
  for (const [index, rawItem] of rawItems.entries()) {
    if (!isRecord(rawItem)) {
      items.push({
        index,
        ref: null,
        ratings: [],
        rejections: [reject('item-not-object', `item ${index} nao e objeto`)],
      })
      continue
    }

    const rejections: RatingRejection[] = []
    const ref = readEntityRef(rawItem)
    if (ref === null) {
      rejections.push(reject('no-entity-id', `item ${index} sem imdbId/tmdbId inequivoco`))
    }

    const descriptors = pick(rawItem, ['ratings', 'externalRatings', 'external_ratings'])
    const drafts: RatingDraft[] = []
    if (!Array.isArray(descriptors) || descriptors.length === 0) {
      rejections.push(
        reject('no-rating-descriptors', `item ${index} sem array "ratings" com fonte declarada`),
      )
    } else {
      for (const descriptor of descriptors) {
        const result = readRatingDraft(descriptor, providerApi)
        if (result.ok) drafts.push(result.draft)
        else rejections.push(result.rejection)
      }
    }

    items.push({ index, ref, ratings: drafts, rejections })
  }

  return { recognized: true, items, rejections: [] }
}
