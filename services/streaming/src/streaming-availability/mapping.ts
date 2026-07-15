/**
 * mapping.ts — Reconhecedor do payload de `GET /shows/{id}`. Modulo PURO.
 *
 * Traduz `streamingOptions[pais]` em linhas de `watch_availability`, recusando
 * (com motivo) tudo que nao seja uma oferta LEGAL inequivoca.
 *
 * Regras materializadas:
 *  - `addon` NAO vira `subscription` — e descartado (`unmapped-offer-type`).
 *    Nao inventamos modalidade comercial.
 *  - Sem `providerName` nao ha oferta: nunca inventamos plataforma.
 *  - `deepLink` so `http(s)` e sem marcador de pirataria (`.torrent`, infohash
 *    de magnet). Esquemas `magnet:`/`ftp:`/`udp:` sao recusados de saida
 *    (invariante 8). A garantia de fundo e o upstream, que so lista servicos
 *    licenciados; este filtro e a segunda linha.
 *  - `price` so acompanha `currency` ISO 4217 valida (CHECK do schema); preco
 *    inventado nunca e gravado.
 *  - IDENTIDADE: o show devolvido precisa ser a entidade que pedimos
 *    (`showType` compativel + imdbId/tmdbId batendo). Atribuir a oferta de um
 *    titulo a outro e pior do que nao gravar nada.
 */

import type {
  OfferRejection,
  OfferRejectionReason,
  OfferType,
  SelectedEntity,
  ShowMapping,
  StreamingEntityType,
  WatchOfferRow,
} from './types.js'
import { OFFER_TYPE_BY_UPSTREAM } from './types.js'

/** Qualidades reconhecidas pelo upstream. */
const KNOWN_QUALITIES: ReadonlySet<string> = new Set(['sd', 'hd', 'qhd', 'uhd'])

/** `showType` do upstream -> nosso `entityType`. */
const ENTITY_TYPE_BY_SHOW_TYPE: Readonly<Record<string, StreamingEntityType>> = {
  movie: 'movie',
  series: 'tv',
}

/** Timestamps abaixo deste limiar sao segundos; acima, ja sao milissegundos. */
const SECONDS_TO_MS_THRESHOLD = 100_000_000_000

function reject(reason: OfferRejectionReason, detail: string): OfferRejection {
  return { reason, detail }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Le um id/texto opcional sem fabricar identidade a partir do nome exibido. */
function readOptionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** Converte um unix timestamp (s ou ms) em `Date`; null quando invalido. */
export function readTimestamp(value: unknown): Date | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  const ms = value < SECONDS_TO_MS_THRESHOLD ? value * 1000 : value
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Marcadores de pirataria que podem viajar mesmo sob `https://`.
 *
 * O esquema sozinho nao basta: `https://host/x.torrent` passaria num filtro que
 * so olha `http(s)`. Aqui barramos tambem o conteudo obvio (arquivo `.torrent`,
 * infohash de magnet).
 */
const PIRACY_URL_PATTERN = /\.torrent(?:$|[?#])|xt=urn:btih:/i

/**
 * Um deep link seguro e `http(s)` E nao carrega marcador de pirataria.
 *
 * Isto e uma barreira, nao uma prova: a garantia real de legalidade vem do
 * upstream (que so lista servicos licenciados) somada a invariante 8. Um link
 * recusado aqui nunca vira `deep_link` — a oferta e mantida com `deepLink: null`
 * quando o resto dela e valido.
 */
export function isSafeDeepLink(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!/^https?:\/\//i.test(trimmed)) return false
  return !PIRACY_URL_PATTERN.test(trimmed)
}

/** Preco confiavel: `amount` numerico >= 0 e `currency` ISO 4217 (3 letras). */
export function readPrice(
  value: unknown,
): { readonly price: number; readonly currency: string } | null {
  if (!isRecord(value)) return null
  const rawAmount = value.amount
  const rawCurrency = value.currency

  const amount = typeof rawAmount === 'number' ? rawAmount : Number(rawAmount)
  if (typeof rawAmount !== 'number' && typeof rawAmount !== 'string') return null
  if (!Number.isFinite(amount) || amount < 0) return null

  if (typeof rawCurrency !== 'string') return null
  const currency = rawCurrency.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) return null

  return { price: amount, currency }
}

/** Busca a chave do pais no mapa `streamingOptions`, sem depender de caixa. */
export function findCountryOffers(
  streamingOptions: Record<string, unknown>,
  countryCode: string,
): readonly unknown[] | null {
  const target = countryCode.toLowerCase()
  for (const key of Object.keys(streamingOptions)) {
    if (key.toLowerCase() === target) {
      const value = streamingOptions[key]
      return Array.isArray(value) ? value : null
    }
  }
  return null
}

/**
 * Confere que o show devolvido E a entidade pedida.
 *
 * O upstream aceita `movie/278`, `tv/1396` e `tt...`. Um id trocado (ou uma
 * troca de tipo do lado deles) nao pode virar oferta atribuida a outro titulo.
 * `tmdbId` chega como `"278"` ou `"movie/278"`: comparamos so os digitos finais.
 */
export function matchesEntity(show: Record<string, unknown>, entity: SelectedEntity): boolean {
  const showType = typeof show.showType === 'string' ? show.showType : ''
  const mappedType = ENTITY_TYPE_BY_SHOW_TYPE[showType]
  if (mappedType !== entity.entityType) return false

  const rawImdb = typeof show.imdbId === 'string' ? show.imdbId.trim() : null
  if (entity.imdbId !== null && rawImdb !== null && rawImdb !== '') {
    return rawImdb === entity.imdbId
  }

  const rawTmdb = typeof show.tmdbId === 'string' ? show.tmdbId : String(show.tmdbId ?? '')
  const digits = /(\d+)\s*$/.exec(rawTmdb)
  if (digits?.[1] !== undefined) {
    return Number.parseInt(digits[1], 10) === entity.tmdbId
  }
  return false
}

/**
 * Reconhece o payload de um show e devolve as ofertas mapeaveis do pais.
 *
 * NUNCA lanca. Payload irreconhecivel => `recognized: false` com o motivo.
 */
export function mapShowPayload(
  payload: unknown,
  entity: SelectedEntity,
  countryCode: string,
): ShowMapping {
  if (!isRecord(payload)) {
    return {
      recognized: false,
      offers: [],
      rejections: [reject('payload-not-object', 'payload de /shows/{id} nao e objeto')],
    }
  }

  const showType = typeof payload.showType === 'string' ? payload.showType : '(ausente)'
  if (ENTITY_TYPE_BY_SHOW_TYPE[showType] === undefined) {
    return {
      recognized: false,
      offers: [],
      rejections: [reject('show-type-mismatch', `showType desconhecido: "${showType}"`)],
    }
  }

  if (!matchesEntity(payload, entity)) {
    return {
      recognized: false,
      offers: [],
      rejections: [
        reject(
          'identity-mismatch',
          `resposta nao corresponde a entidade ${entity.entityType}#${entity.entityId} ` +
            `(tmdbId=${entity.tmdbId})`,
        ),
      ],
    }
  }

  // `streamingOptions` ausente/null/array/primitivo = corpo ANOMALO (truncado,
  // contrato do upstream mudou). Nao aprendemos nada sobre a entidade, entao o
  // payload NAO e reconhecido e o replace nunca roda — do contrario um 200
  // incompleto apagaria ofertas boas ja gravadas.
  //
  // Isto e diferente de `streamingOptions` PRESENTE sem a chave do pais: ali
  // sabemos que o titulo nao tem oferta naquele pais, e limpar e o correto.
  const streamingOptions = payload.streamingOptions
  if (!isRecord(streamingOptions)) {
    return {
      recognized: false,
      offers: [],
      rejections: [
        reject(
          'missing-streaming-options',
          'payload sem streamingOptions valido (corpo anomalo): snapshot preservado',
        ),
      ],
    }
  }

  const countryOffers = findCountryOffers(streamingOptions, countryCode)
  if (countryOffers === null) {
    return {
      recognized: true,
      offers: [],
      rejections: [
        reject('country-absent', `sem ofertas para ${countryCode.toUpperCase()} neste titulo`),
      ],
    }
  }

  const offers: WatchOfferRow[] = []
  const rejections: OfferRejection[] = []

  for (const [index, rawOffer] of countryOffers.entries()) {
    if (!isRecord(rawOffer)) {
      rejections.push(reject('offer-not-object', `oferta ${index} nao e objeto`))
      continue
    }

    const rawType = typeof rawOffer.type === 'string' ? rawOffer.type.trim().toLowerCase() : ''
    const offerType: OfferType | undefined = OFFER_TYPE_BY_UPSTREAM[rawType]
    if (offerType === undefined) {
      // `addon` cai aqui DE PROPOSITO: nao existe no enum e nao e assinatura.
      rejections.push(
        reject('unmapped-offer-type', `oferta ${index}: type="${rawType || '(ausente)'}"`),
      )
      continue
    }

    const service = isRecord(rawOffer.service) ? rawOffer.service : null
    const providerName = typeof service?.name === 'string' ? service.name.trim() : ''
    if (providerName === '') {
      rejections.push(reject('missing-provider-name', `oferta ${index} sem service.name`))
      continue
    }
    const providerKey = readOptionalText(service?.id)
    const externalOfferId = readOptionalText(rawOffer.id) ?? readOptionalText(rawOffer.externalId)
    const packageName = readOptionalText(rawOffer.package)

    let deepLink: string | null = null
    if (rawOffer.link !== undefined && rawOffer.link !== null) {
      if (isSafeDeepLink(rawOffer.link)) {
        deepLink = rawOffer.link.trim()
      } else {
        rejections.push(
          reject('unsafe-deep-link', `oferta ${index} (${providerName}): link nao-http descartado`),
        )
      }
    }

    let webUrl: string | null = null
    const rawWebUrl = rawOffer.webUrl ?? rawOffer.web_url
    if (rawWebUrl !== undefined && rawWebUrl !== null) {
      if (isSafeDeepLink(rawWebUrl)) {
        webUrl = rawWebUrl.trim()
      } else {
        rejections.push(
          reject('unsafe-deep-link', `oferta ${index} (${providerName}): web URL nao-http descartada`),
        )
      }
    }

    const priceInfo = readPrice(rawOffer.price)
    const quality =
      typeof rawOffer.quality === 'string' && KNOWN_QUALITIES.has(rawOffer.quality.toLowerCase())
        ? rawOffer.quality.toLowerCase()
        : null

    offers.push({
      entityType: entity.entityType,
      entityId: entity.entityId,
      countryCode: countryCode.toUpperCase(),
      externalOfferId,
      providerKey,
      providerName,
      package: packageName,
      offerType,
      deepLink,
      webUrl,
      price: priceInfo?.price ?? null,
      currency: priceInfo?.currency ?? null,
      quality,
      availableFrom: readTimestamp(rawOffer.availableSince),
      availableUntil: readTimestamp(rawOffer.expiresOn),
    })
  }

  return { recognized: true, offers, rejections }
}
