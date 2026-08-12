/**
 * mapping.ts — Reconhecedor ESTRITO do payload da OMDb. Modulo PURO.
 *
 * Transforma UM payload em ATE TRES linhas de `external_ratings`, uma por fonte
 * editorial. O fornecedor tecnico e `omdb`; a FONTE de cada nota e IMDb, Rotten
 * Tomatoes ou Metacritic (invariante 2 — os dois nunca colapsam).
 *
 * CONTRATO ACEITO (tudo o mais e recusado com motivo):
 *
 *   {
 *     "Response": "True",
 *     "imdbID": "tt3896198",
 *     "Ratings": [
 *       { "Source": "Internet Movie Database", "Value": "7.6/10" },
 *       { "Source": "Rotten Tomatoes",         "Value": "85%"    },
 *       { "Source": "Metacritic",              "Value": "67/100" }
 *     ],
 *     "imdbRating": "7.6",   // redundante — so verificacao cruzada
 *     "Metascore":  "67"     // redundante — so verificacao cruzada
 *   }
 *
 * TRES TRAVAS que o payload sozinho nao daria:
 *
 *  1. `Response: "False"` chega com HTTP **200** e um campo `Error`. Para o
 *     executor HTTP isso e sucesso. Aqui e recusa explicita — e o padrao de
 *     descarte silencioso que ja mordeu este projeto varias vezes.
 *  2. `Ratings[].Source` fora da tabela canonica NAO vira nota: vira
 *     `unrecognized-source` com o valor BRUTO, para estender o reconhecedor
 *     depois com evidencia.
 *  3. A escala sai do proprio literal (`85%` -> 100, `7.6/10` -> 10) e e
 *     CONFERIDA contra a escala canonica da fonte. Divergencia e recusa, nunca
 *     conversao. Nada e reescalado: 85% do Rotten Tomatoes nao e 8,5 de nada.
 *
 * `rating_label` NUNCA vem do payload: e derivado da fonte canonica
 * (`RATING_SOURCE_SEED`). Um "Tomatometer" atribuido ao IMDb e impossivel por
 * construcao, alem de barrado por `validateRating`.
 *
 * LINKBACK: so o IMDb tem URL derivavel, a partir do `imdbID` do proprio
 * payload. Rotten Tomatoes e Metacritic NAO trazem identificador nenhum — para
 * elas `ratingUrl` fica `null` e nenhuma URL e inventada a partir do titulo.
 */

import { RATING_SCALES } from '@screena/config'
import { RATING_SOURCE_SEED } from '@screena/db'
import { buildImdbTitleUrl, isImdbId } from '@screena/omdb-client'
import { validateRating } from '@screena/schemas'

import { classifyRatingScoreType } from '../score-type.js'
import { recognizeOmdbSource, type RecognizedOmdbSource } from './sources.js'
import type { OmdbRejection, OmdbRejectionReason, RatingDraft } from './types.js'
import { parseOmdbRatingValue } from './value.js'

/** Rotulo canonico por fonte editorial (nunca vem do payload). */
const SOURCE_LABEL: Readonly<Record<string, string>> = Object.fromEntries(
  RATING_SOURCE_SEED.map((entry) => [entry.key, entry.label]),
)

/** Resultado do reconhecimento de UM payload da OMDb. */
export interface OmdbMapping {
  /** `false` quando a forma nem foi reconhecida (nada a mapear). */
  readonly recognized: boolean
  /** IMDb id lido do payload; `null` quando ausente/malformado. */
  readonly imdbId: string | null
  readonly ratings: readonly RatingDraft[]
  readonly rejections: readonly OmdbRejection[]
}

function reject(reason: OmdbRejectionReason, detail: string): OmdbRejection {
  return { reason, detail }
}

/** `value` e um objeto simples (nao array, nao null)? */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * A OMDb devolve TUDO como string, inclusive numeros. Le um numero finito de
 * string ou number; `null` para `"N/A"`, vazio e qualquer coisa nao numerica.
 * Usado SO na verificacao cruzada dos campos redundantes.
 */
function readLooseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * `Response` da OMDb. Ela responde a string `"True"`/`"False"`; aceitamos
 * tambem o boolean por robustez. FAIL-CLOSED: qualquer coisa que nao seja
 * afirmativamente "sucesso" e tratada como erro.
 */
function isFailureResponse(payload: Record<string, unknown>): boolean {
  const raw = payload['Response']
  if (raw === undefined) return false // campo ausente: nao afirma falha.
  if (typeof raw === 'boolean') return !raw
  if (typeof raw === 'string') return raw.trim().toLowerCase() !== 'true'
  // Presente mas de tipo inesperado: nao da para afirmar sucesso.
  return true
}

/**
 * Verificacao cruzada dos campos redundantes de topo.
 *
 * `imdbRating` e `Metascore` repetem o que ja esta no array. O ARRAY e a fonte
 * unica — estes campos nunca geram nota. Mas divergir deles e anomalia real
 * (payload inconsistente do upstream), e o prompt e a regra "nada falha em
 * silencio" mandam REGISTRAR em vez de escolher calado.
 */
export function crossCheckRedundantFields(
  payload: Record<string, unknown>,
  drafts: readonly RatingDraft[],
): readonly OmdbRejection[] {
  const rejections: OmdbRejection[] = []

  const checks: readonly (readonly [string, string, number | null])[] = [
    ['imdbRating', 'imdb', readLooseNumber(payload['imdbRating'])],
    ['Metascore', 'metacritic', readLooseNumber(payload['Metascore'])],
  ]

  for (const [field, source, topLevel] of checks) {
    if (topLevel === null) continue // ausente ou "N/A": nada a comparar.
    const draft = drafts.find((d) => d.ratingSource === source)
    if (draft === undefined) continue // a fonte nao entrou no array; nada a cruzar.
    if (draft.ratingValue !== topLevel) {
      rejections.push(
        reject(
          'redundant-field-divergence',
          `campo de topo "${field}"=${topLevel} diverge de Ratings[] ("${source}"=${draft.ratingValue}); ` +
            'o array e a fonte unica e prevaleceu — divergencia registrada, nao escolhida em silencio.',
        ),
      )
    }
  }

  return rejections
}

/**
 * Reconhece UM descritor de `Ratings[]`.
 *
 * `providerApi` entra so para `validateRating` confirmar a invariante 2.
 * `imdbId` entra so para derivar o linkback do IMDb.
 */
export function readOmdbRatingDraft(
  descriptor: unknown,
  providerApi: string,
  imdbId: string | null,
):
  | { readonly ok: true; readonly draft: RatingDraft; readonly source: RecognizedOmdbSource }
  | { readonly ok: false; readonly rejection: OmdbRejection } {
  if (!isRecord(descriptor)) {
    return {
      ok: false,
      rejection: reject('descriptor-not-object', 'elemento de Ratings[] nao e objeto'),
    }
  }

  const rawSource = descriptor['Source']
  const source = recognizeOmdbSource(rawSource)
  if (source === null) {
    // O valor BRUTO no detalhe e o ponto: e com ele que o reconhecedor sera
    // estendido depois. Nunca chutar a fonte.
    const shown = typeof rawSource === 'string' ? rawSource : String(rawSource)
    return {
      ok: false,
      rejection: reject(
        'unrecognized-source',
        `Source "${shown}" fora da tabela canonica; nota NAO ingerida (estenda services/ratings/src/omdb/sources.ts)`,
      ),
    }
  }

  const value = parseOmdbRatingValue(descriptor['Value'])
  if (!value.ok) {
    return {
      ok: false,
      rejection: reject(
        'invalid-value',
        `fonte "${source.ratingSource}": ${value.detail} [${value.refusal}]`,
      ),
    }
  }

  // A escala e propriedade da FONTE. Lemos a escala do literal e CONFERIMOS
  // contra a canonica; divergencia e recusa, nunca conversao.
  const canonicalScale: number = RATING_SCALES[source.ratingSource]
  if (value.parsed.scale !== canonicalScale) {
    return {
      ok: false,
      rejection: reject(
        'scale-mismatch',
        `fonte "${source.ratingSource}": escala ${value.parsed.scale} lida do payload diverge da canonica ${canonicalScale}; ` +
          'nota recusada (nunca reescalamos entre fontes)',
      ),
    }
  }

  const ratingLabel = SOURCE_LABEL[source.ratingSource] ?? source.ratingSource
  const scoreType = classifyRatingScoreType({
    ratingSource: source.ratingSource,
    metric: source.metric,
    ratingLabel,
  })

  // A classificacao independente TEM de concordar com a natureza declarada na
  // tabela. Se discordarem, o vocabulario de `sources.ts` esta errado — e o
  // erro exato que a invariante 1 proibe (trocar critica por publico). Recusar
  // e a unica saida honesta.
  if (scoreType !== source.expectedScoreType) {
    return {
      ok: false,
      rejection: reject(
        'score-type-mismatch',
        `fonte "${source.ratingSource}": classificacao "${scoreType ?? 'null'}" diverge da esperada ` +
          `"${source.expectedScoreType}"; nota recusada (critica e publico nunca se misturam)`,
      ),
    }
  }

  const draft: RatingDraft = {
    ratingSource: source.ratingSource,
    ratingLabel,
    metric: source.metric,
    ratingValue: value.parsed.value,
    ratingScale: value.parsed.scale,
    // A OMDb nao publica contagem de votos POR FONTE no array. `imdbVotes`
    // existe no topo, mas e do IMDb e nao do array — associa-lo aqui seria
    // afirmar uma contagem que o descritor nao declarou.
    ratingCount: null,
    // SO o IMDb tem linkback derivavel. RT e Metacritic nao trazem
    // identificador: `null`, e nenhuma URL e inventada a partir do titulo.
    ratingUrl: source.ratingSource === 'imdb' && imdbId !== null ? buildImdbTitleUrl(imdbId) : null,
    scoreType,
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

  return { ok: true, draft, source }
}

/**
 * Reconhece o payload inteiro da OMDb (UM titulo, ate tres fontes).
 *
 * NUNCA lanca: um payload irreconhecivel devolve `recognized: false` com o
 * motivo. O worker reporta e segue — sem gravar nada.
 */
export function mapOmdbPayload(payload: unknown, providerApi: string): OmdbMapping {
  if (!isRecord(payload)) {
    return {
      recognized: false,
      imdbId: null,
      ratings: [],
      rejections: [reject('payload-shape-unrecognized', 'payload da OMDb nao e objeto')],
    }
  }

  // TRAVA 1: erro da OMDb chega com HTTP 200. Isto NUNCA e sucesso.
  if (isFailureResponse(payload)) {
    const rawError = payload['Error']
    const detail = typeof rawError === 'string' && rawError.trim() !== '' ? rawError.trim() : null
    return {
      recognized: false,
      imdbId: null,
      ratings: [],
      rejections: [
        reject(
          'omdb-error-response',
          `OMDb respondeu Response=False com HTTP 200${detail !== null ? ` — Error: "${detail}"` : ' (sem campo Error)'}; ` +
            'nenhuma nota ingerida',
        ),
      ],
    }
  }

  const rejections: OmdbRejection[] = []

  const rawImdbId = payload['imdbID']
  const imdbId =
    typeof rawImdbId === 'string' && isImdbId(rawImdbId) ? rawImdbId.trim() : null
  if (imdbId === null) {
    rejections.push(
      reject('no-entity-id', 'payload sem "imdbID" valido (tt<digitos>): entidade indeterminavel'),
    )
  }

  const rawRatings = payload['Ratings']
  if (!Array.isArray(rawRatings)) {
    rejections.push(
      reject('no-rating-descriptors', 'payload sem "Ratings" em forma de array: nada a mapear'),
    )
    return { recognized: true, imdbId, ratings: [], rejections }
  }

  const drafts: RatingDraft[] = []
  const seenSources = new Set<string>()

  for (const descriptor of rawRatings) {
    const result = readOmdbRatingDraft(descriptor, providerApi, imdbId)
    if (!result.ok) {
      rejections.push(result.rejection)
      continue
    }
    // Duas notas da MESMA fonte colidiriam no unique
    // `(entity_type, entity_id, rating_source, metric)`: a segunda sobrescreveria
    // a primeira em silencio. Recusamos a duplicata e registramos.
    if (seenSources.has(result.draft.ratingSource)) {
      rejections.push(
        reject(
          'duplicate-source',
          `fonte "${result.draft.ratingSource}" aparece mais de uma vez em Ratings[]; ` +
            'a repeticao foi recusada (a primeira ocorrencia prevalece)',
        ),
      )
      continue
    }
    seenSources.add(result.draft.ratingSource)
    drafts.push(result.draft)
  }

  rejections.push(...crossCheckRedundantFields(payload, drafts))

  return { recognized: true, imdbId, ratings: drafts, rejections }
}
