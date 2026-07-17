/**
 * external-intelligence.ts — Contratos publicos de ratings, streaming e
 * Cinerie Score (Backend B, §5/§10).
 *
 * A fronteira tipada entre os getters server-only (que leem o PostgreSQL ja
 * filtrado por licenca/decisao/frescor) e o render. Puro: sem zod, sem Prisma.
 *
 * Regra que atravessa este arquivo inteiro: um payload publico so pode conter
 * o que ja passou por licenca + decisao de uso + revisao humana. O contrato NAO
 * carrega `displayAllowed`, `licenseStatus` nem nada cru — se um dado chegou
 * aqui, ele ja e exibivel. Deixar a decisao para o componente seria transformar
 * cada consumidor futuro numa nova chance de vazar.
 */

import { RATING_SCALES, RATING_SOURCES, type RatingSource } from '@screena/config'

import {
  fail,
  isRecord,
  ok,
  optionalString,
  requireBoolean,
  requireNumberOrNull,
  requireString,
  type ValidationResult,
} from './validation.js'
import { entityRefErrors, type EntityRef } from './primitives.js'

/** Natureza editorial da nota. Critics e audience NUNCA se misturam (inv. 1). */
export type PublicRatingScoreType = 'critics' | 'audience' | 'editorial'

const SCORE_TYPES: readonly PublicRatingScoreType[] = ['critics', 'audience', 'editorial']

/** Atribuicao exibida junto da nota. Credita a FONTE, jamais o provider tecnico. */
export interface PublicRatingAttribution {
  readonly text: string
  readonly url: string | null
}

/**
 * Uma nota externa pronta para exibicao.
 *
 * `value` esta SEMPRE na escala da propria fonte (`best`) — nunca normalizada
 * para comparar fontes. Um 8.4/10 do IMDb e um 92/100 do Rotten Tomatoes
 * convivem sem virar percentuais equivalentes: sao medidas de coisas
 * diferentes, feitas por publicos diferentes (invariante 1).
 *
 * `count` e `null` quando o upstream nao informa. Nunca 0 fabricado: "nao sei
 * quantos votos" e diferente de "zero votos".
 */
export interface PublicExternalRating {
  readonly sourceKey: RatingSource
  readonly sourceLabel: string
  readonly scoreType: PublicRatingScoreType
  readonly value: number
  readonly best: number
  readonly count: number | null
  readonly label: string
  /** ISO-8601 da coleta (`fetched_at`) — base do "atualizado em". */
  readonly updatedAt: string
  readonly attribution: PublicRatingAttribution | null
}

/** Payload de ratings de uma entidade. */
export interface RatingsPayload {
  readonly entity: EntityRef
  readonly ratings: readonly PublicExternalRating[]
}

/** Modalidade legal de oferta. Nunca inclui nada pirata (invariante 8). */
export type PublicOfferType = 'subscription' | 'rent' | 'buy' | 'free' | 'ads' | 'cinema'

const OFFER_TYPES: readonly PublicOfferType[] = [
  'subscription',
  'rent',
  'buy',
  'free',
  'ads',
  'cinema',
]

/** Provedor CANONICO (resolvido por alias), nunca a string crua do upstream. */
export interface PublicWatchProvider {
  readonly slug: string
  readonly name: string
  /** So preenchido quando a licenca permite logo (`logo_allowed`). */
  readonly logoAssetId: string | null
  readonly homepageUrl: string | null
}

/** Uma oferta legal exibivel. */
export interface PublicWatchOffer {
  readonly provider: PublicWatchProvider
  readonly offerType: PublicOfferType
  /** Preco so existe em rent/buy (CHECK no banco). `null` nas demais. */
  readonly price: number | null
  /** ISO-4217. Obrigatoriamente presente quando ha `price`. */
  readonly currency: string | null
  readonly quality: string | null
  readonly package: string | null
  /** Link legal (HTTPS). Nunca torrent/IPTV/player pirata. */
  readonly url: string | null
  readonly availableUntil: string | null
  readonly attribution: PublicRatingAttribution | null
}

/** Payload de onde-assistir de uma entidade, por pais. */
export interface StreamingPayload {
  readonly entity: EntityRef
  /** ISO 3166-1 alpha-2. */
  readonly country: string
  /** ISO-8601 do ultimo sync confiavel — alimenta o carimbo "Atualizado em". */
  readonly updatedAt: string | null
  readonly offers: readonly PublicWatchOffer[]
}

/**
 * Payload do Cinerie Score.
 *
 * `available: false` e o estado NORMAL e esperado hoje: nao ha decisao de
 * produto aprovada, logo nao ha nota. O contrato modela a ausencia
 * explicitamente para que o consumidor nao tenha como "cair" num valor default
 * — um `0` ou `null` interpretado como nota seria pior que nada.
 */
export interface CinerieScorePayload {
  readonly entity: EntityRef
  readonly available: boolean
  readonly value: number | null
  readonly scale: number | null
  /** Versao da formula que produziu o valor; `null` quando indisponivel. */
  readonly version: string | null
  /** ISO-8601 do calculo; `null` quando indisponivel. */
  readonly calculatedAt: string | null
}

// ---------------------------------------------------------------------------
// Validadores
// ---------------------------------------------------------------------------

function validateAttribution(value: unknown, label: string): string[] {
  if (value === null) return []
  if (!isRecord(value)) return [`${label}: esperado objeto ou null`]
  const errors = [...requireString(value.text, `${label}.text`)]
  if (value.url !== null) errors.push(...requireString(value.url, `${label}.url`))
  return errors
}

/** Valida uma nota publica. */
export function validatePublicExternalRating(
  input: unknown,
): ValidationResult<PublicExternalRating> {
  if (!isRecord(input)) return fail(['rating: esperado objeto'])
  const errors: string[] = []

  errors.push(...requireString(input.sourceKey, 'rating.sourceKey'))
  if (typeof input.sourceKey === 'string' && !RATING_SOURCES.includes(input.sourceKey as RatingSource)) {
    errors.push(`rating.sourceKey: "${input.sourceKey}" nao e fonte editorial reconhecida`)
  }
  errors.push(...requireString(input.sourceLabel, 'rating.sourceLabel'))
  errors.push(...requireString(input.label, 'rating.label'))
  errors.push(...requireString(input.updatedAt, 'rating.updatedAt'))

  if (typeof input.scoreType !== 'string' || !SCORE_TYPES.includes(input.scoreType as PublicRatingScoreType)) {
    errors.push('rating.scoreType: esperado critics | audience | editorial')
  }

  if (typeof input.value !== 'number' || !Number.isFinite(input.value)) {
    errors.push('rating.value: esperado number finito')
  }
  if (typeof input.best !== 'number' || !Number.isFinite(input.best)) {
    errors.push('rating.best: esperado number finito')
  }
  errors.push(...requireNumberOrNull(input.count ?? null, 'rating.count'))
  if (typeof input.count === 'number' && input.count < 0) {
    errors.push('rating.count: votos nao podem ser negativos')
  }

  // A escala PERTENCE a fonte (invariante 1). Um IMDb declarado /100 nao e uma
  // convencao alternativa: e um dado errado, e barra-lo aqui impede que uma nota
  // reescalada chegue ao render parecendo legitima.
  if (
    typeof input.sourceKey === 'string' &&
    RATING_SOURCES.includes(input.sourceKey as RatingSource) &&
    typeof input.best === 'number'
  ) {
    const expected = RATING_SCALES[input.sourceKey as RatingSource]
    if (input.best !== expected) {
      errors.push(
        `rating.best: fonte ${input.sourceKey} tem escala ${expected}, recebido ${input.best} (invariante 1: nunca reescalar entre fontes)`,
      )
    }
  }
  if (
    typeof input.value === 'number' &&
    typeof input.best === 'number' &&
    Number.isFinite(input.value) &&
    Number.isFinite(input.best) &&
    (input.value < 0 || input.value > input.best)
  ) {
    errors.push(`rating.value: ${input.value} fora da escala 0..${input.best}`)
  }

  errors.push(...validateAttribution(input.attribution, 'rating.attribution'))

  return errors.length > 0 ? fail(errors) : ok(input as unknown as PublicExternalRating)
}

/** Valida o payload de ratings de uma entidade. */
export function validateRatingsPayload(input: unknown): ValidationResult<RatingsPayload> {
  if (!isRecord(input)) return fail(['RatingsPayload: esperado objeto'])
  const errors: string[] = []

  errors.push(...entityRefErrors(input.entity, 'RatingsPayload.entity'))

  if (!Array.isArray(input.ratings)) {
    errors.push('RatingsPayload.ratings: esperado array')
  } else {
    const seen = new Set<string>()
    input.ratings.forEach((rating, index) => {
      const result = validatePublicExternalRating(rating)
      errors.push(...result.errors.map((e) => `RatingsPayload.ratings[${index}] ${e}`))
      // Duas notas da mesma fonte+tipo no mesmo payload significam que o read
      // path duplicou ou misturou metricas — a UI exibiria "IMDb" duas vezes com
      // numeros diferentes e nao ha resposta certa sobre qual e a nota.
      if (isRecord(rating) && typeof rating.sourceKey === 'string' && typeof rating.scoreType === 'string') {
        const key = `${rating.sourceKey}:${rating.scoreType}`
        if (seen.has(key)) {
          errors.push(`RatingsPayload.ratings[${index}]: fonte+tipo duplicados (${key})`)
        }
        seen.add(key)
      }
    })
  }

  return errors.length > 0 ? fail(errors) : ok(input as unknown as RatingsPayload)
}

/** Valida uma oferta publica. */
export function validatePublicWatchOffer(input: unknown): ValidationResult<PublicWatchOffer> {
  if (!isRecord(input)) return fail(['offer: esperado objeto'])
  const errors: string[] = []

  if (!isRecord(input.provider)) {
    errors.push('offer.provider: esperado objeto (provedor canonico obrigatorio)')
  } else {
    errors.push(...requireString(input.provider.slug, 'offer.provider.slug'))
    errors.push(...requireString(input.provider.name, 'offer.provider.name'))
    errors.push(...optionalString(input.provider.logoAssetId, 'offer.provider.logoAssetId'))
    errors.push(...optionalString(input.provider.homepageUrl, 'offer.provider.homepageUrl'))
  }

  if (typeof input.offerType !== 'string' || !OFFER_TYPES.includes(input.offerType as PublicOfferType)) {
    errors.push('offer.offerType: modalidade legal desconhecida')
  }

  errors.push(...requireNumberOrNull(input.price ?? null, 'offer.price'))
  // Preco sem moeda e um numero sem significado ("29.90" de que?). Espelha o
  // CHECK watch_availability_price_requires_currency.
  if (typeof input.price === 'number' && typeof input.currency !== 'string') {
    errors.push('offer.price: preco exige currency (ISO-4217)')
  }
  if (typeof input.currency === 'string' && input.currency.length !== 3) {
    errors.push('offer.currency: esperado ISO-4217 de 3 letras')
  }
  // Preco so existe em transacional. Espelha watch_availability_price_only_transactional.
  if (
    typeof input.price === 'number' &&
    typeof input.offerType === 'string' &&
    input.offerType !== 'rent' &&
    input.offerType !== 'buy'
  ) {
    errors.push(`offer.price: modalidade ${input.offerType} nao tem preco`)
  }

  // Invariante 8 na fronteira do contrato: link publico e HTTPS. Nao e sobre
  // criptografia — e que torrent:/magnet:/ftp: nao entram nem por acidente.
  if (input.url !== null && input.url !== undefined) {
    errors.push(...requireString(input.url, 'offer.url'))
    if (typeof input.url === 'string' && !input.url.startsWith('https://')) {
      errors.push(`offer.url: link publico deve ser HTTPS (recebido "${input.url.slice(0, 24)}...")`)
    }
  }

  errors.push(...validateAttribution(input.attribution, 'offer.attribution'))

  return errors.length > 0 ? fail(errors) : ok(input as unknown as PublicWatchOffer)
}

/** Valida o payload de onde-assistir. */
export function validateStreamingPayload(input: unknown): ValidationResult<StreamingPayload> {
  if (!isRecord(input)) return fail(['StreamingPayload: esperado objeto'])
  const errors: string[] = []

  errors.push(...entityRefErrors(input.entity, 'StreamingPayload.entity'))

  errors.push(...requireString(input.country, 'StreamingPayload.country'))
  if (typeof input.country === 'string' && input.country.length !== 2) {
    errors.push('StreamingPayload.country: esperado ISO 3166-1 alpha-2')
  }
  errors.push(...optionalString(input.updatedAt, 'StreamingPayload.updatedAt'))

  if (!Array.isArray(input.offers)) {
    errors.push('StreamingPayload.offers: esperado array')
  } else {
    input.offers.forEach((offer, index) => {
      const result = validatePublicWatchOffer(offer)
      errors.push(...result.errors.map((e) => `StreamingPayload.offers[${index}] ${e}`))
    })
  }

  return errors.length > 0 ? fail(errors) : ok(input as unknown as StreamingPayload)
}

/** Valida o payload do Cinerie Score. */
export function validateCinerieScorePayload(
  input: unknown,
): ValidationResult<CinerieScorePayload> {
  if (!isRecord(input)) return fail(['CinerieScorePayload: esperado objeto'])
  const errors: string[] = []

  errors.push(...entityRefErrors(input.entity, 'CinerieScorePayload.entity'))
  errors.push(...requireBoolean(input.available, 'CinerieScorePayload.available'))

  // A forma e binaria e sem meio-termo: ou ha nota completa (valor + escala +
  // versao + data), ou nao ha nota nenhuma. Um payload "indisponivel" carregando
  // um numero e a porta por onde uma nota nao aprovada chega a tela.
  if (input.available === true) {
    if (typeof input.value !== 'number' || !Number.isFinite(input.value)) {
      errors.push('CinerieScorePayload.value: obrigatorio quando available=true')
    }
    if (typeof input.scale !== 'number' || !Number.isFinite(input.scale)) {
      errors.push('CinerieScorePayload.scale: obrigatorio quando available=true')
    }
    errors.push(...requireString(input.version, 'CinerieScorePayload.version'))
    errors.push(...requireString(input.calculatedAt, 'CinerieScorePayload.calculatedAt'))
    if (
      typeof input.value === 'number' &&
      typeof input.scale === 'number' &&
      (input.value < 0 || input.value > input.scale)
    ) {
      errors.push(`CinerieScorePayload.value: ${input.value} fora da escala 0..${input.scale}`)
    }
  } else if (input.available === false) {
    if (input.value !== null) errors.push('CinerieScorePayload.value: deve ser null quando available=false')
    if (input.scale !== null) errors.push('CinerieScorePayload.scale: deve ser null quando available=false')
    if (input.version !== null) errors.push('CinerieScorePayload.version: deve ser null quando available=false')
    if (input.calculatedAt !== null) {
      errors.push('CinerieScorePayload.calculatedAt: deve ser null quando available=false')
    }
  }

  return errors.length > 0 ? fail(errors) : ok(input as unknown as CinerieScorePayload)
}

/** Payload do Cinerie Score indisponivel — a forma correta da ausencia. */
export function unavailableCinerieScore(entity: EntityRef): CinerieScorePayload {
  return { entity, available: false, value: null, scale: null, version: null, calculatedAt: null }
}
