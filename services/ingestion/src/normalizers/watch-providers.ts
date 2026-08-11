/**
 * watch-providers.ts — Reconhecedor do sub-recurso `watch/providers` do TMDB.
 * Modulo PURO (sem rede, sem Prisma, sem relogio).
 *
 * O payload ja esta arquivado em `tmdb_raw` desde que `watch/providers` entrou
 * no `append_to_response` de movie/tv/season. Este modulo e a peca que faltava:
 * transformar aquele bloco em linhas consultaveis de `watch_availability`, SEM
 * gastar um unico request de cota (reprocessamento do bruto).
 *
 * Regras materializadas (e por que):
 *  - Toda linha nasce `display_allowed = false` / `license_status = unknown`
 *    (invariante 6). Este modulo NAO decide exibicao; ele so reconhece o dado.
 *    A hidratacao de licenca/atribuicao e uma decisao HUMANA, fora daqui.
 *  - `provider_api` e SEMPRE o fornecedor tecnico (`tmdb`), nunca fonte
 *    editorial (invariante 2). O modulo nao produz nem toca nota nenhuma.
 *  - Sem `provider_name` nao ha oferta: nunca inventamos plataforma.
 *  - `provider_id` do TMDB e a chave TECNICA (`providerKey`); o nome exibido
 *    NUNCA vira identidade. Sem alias mapeado a oferta e ingerida e auditavel,
 *    mas o trigger de governanca nao a deixa exibir.
 *  - `flatrate` -> `subscription`. `ads`/`free`/`rent`/`buy` mapeiam 1:1. Uma
 *    modalidade desconhecida e DESCARTADA com motivo — nunca "aproximada" para
 *    a mais parecida, porque isso afirmaria um contrato comercial falso.
 *  - Um bloco `results` ausente/anomalo torna o payload NAO reconhecido, para
 *    que o replace jamais apague um snapshot bom (mesma regra que
 *    `services/streaming/src/streaming-availability/mapping.ts` ja aplica).
 *  - NENHUM descarte e anonimo: cada recusa vira `WatchProviderRejection` com
 *    motivo e detalhe. Nada aqui devolve lista vazia em silencio (B-H).
 *
 * O TMDB nao publica deep link por oferta: ele publica UM link por pais, que e
 * a pagina do agregador (JustWatch). Esse link vai para `webUrl`; `deepLink`
 * fica `null`. Fabricar um deep link por provedor a partir do link do pais
 * afirmaria um destino que o upstream nunca prometeu.
 */

/** Modalidades legais aceitas no schema (espelha o enum `OfferType`). */
export const WATCH_OFFER_TYPES = [
  'subscription',
  'rent',
  'buy',
  'free',
  'ads',
  'cinema',
] as const

/** Uma modalidade valida de oferta. */
export type WatchOfferType = (typeof WATCH_OFFER_TYPES)[number]

/**
 * Chave do bloco de ofertas no payload do TMDB -> nossa modalidade.
 *
 * `flatrate` e o nome do TMDB para assinatura simples. `ads` e catalogo
 * gratuito com anuncio (FAST) — existe no nosso enum e mapeia 1:1.
 *
 * Chaves que NAO viram oferta, de proposito: `link` (e a pagina do pais, nao
 * uma oferta) e qualquer bucket futuro que o TMDB introduza — desconhecido e
 * descartado com motivo, nunca aproximado.
 */
export const WATCH_OFFER_TYPE_BY_TMDB_BUCKET: Readonly<Record<string, WatchOfferType>> = {
  flatrate: 'subscription',
  rent: 'rent',
  buy: 'buy',
  free: 'free',
  ads: 'ads',
}

/** Entidades cujo detalhe TMDB carrega `watch/providers`. */
export type WatchProvidersEntityType = 'movie' | 'tv'

/**
 * Uma oferta pronta para `watch_availability`, com a entidade AINDA em termos
 * de TMDB id. A resolucao para o id interno acontece na camada de escrita —
 * o normalizador nao consulta banco.
 */
export interface WatchProviderOffer {
  readonly entityType: WatchProvidersEntityType
  readonly tmdbId: number
  /** ISO 3166-1 alpha-2 MAIUSCULO (FK -> countries.code). */
  readonly countryCode: string
  /** Chave TECNICA do provedor no TMDB (`provider_id`), como texto. */
  readonly providerKey: string
  /** Nome de EXIBICAO do provedor. Nunca e identidade. */
  readonly providerName: string
  readonly offerType: WatchOfferType
  /** Pagina do pais no agregador (link de nivel de pais, nao por oferta). */
  readonly webUrl: string | null
  /** Ordem de exibicao sugerida pelo TMDB; util para ordenar, nunca identidade. */
  readonly displayPriority: number | null
  /** Caminho do logo no CDN do TMDB; exibir logo exige `logo_allowed`. */
  readonly logoPath: string | null
}

/** Motivos de recusa. Cada um e um caminho de falha nomeado. */
export type WatchProviderRejectionReason =
  /** O payload nem e um objeto — nada a aprender. */
  | 'payload-not-object'
  /**
   * O bloco `watch/providers` esta ausente/nulo/anomalo. NAO e o mesmo que
   * "este titulo nao tem oferta": e um corpo do qual nao se aprende nada
   * (payload arquivado ANTES do append, truncado, contrato mudado). Torna o
   * payload NAO reconhecido para que o replace nunca apague snapshot bom.
   */
  | 'missing-watch-providers'
  /** `results` presente porem nao e objeto — mesmo tratamento de anomalia. */
  | 'results-not-object'
  /** O valor de um pais nao e objeto. */
  | 'country-not-object'
  /** Codigo de pais fora de ISO 3166-1 alpha-2. */
  | 'invalid-country-code'
  /** Um bucket cujo valor deveria ser lista de ofertas e nao e. */
  | 'bucket-not-array'
  /** Bucket que nao tem modalidade correspondente no nosso enum. */
  | 'unmapped-offer-bucket'
  /** Item de oferta que nao e objeto. */
  | 'offer-not-object'
  /** Sem `provider_id` utilizavel: nunca inventamos identidade tecnica. */
  | 'missing-provider-id'
  /** Sem `provider_name` utilizavel: nunca inventamos plataforma. */
  | 'missing-provider-name'
  /** Link do pais recusado (esquema nao-http(s) ou marcador de pirataria). */
  | 'unsafe-country-link'
  /** Mesma (pais, provedor, modalidade) repetida no mesmo payload. */
  | 'duplicate-offer'

/** Uma recusa, com detalhe legivel. Sem payload cru, sem segredo. */
export interface WatchProviderRejection {
  readonly reason: WatchProviderRejectionReason
  readonly detail: string
}

/** Resultado do reconhecimento de um payload de detalhe. */
export interface WatchProvidersNormalization {
  /**
   * `false` quando o payload nao e utilizavel para concluir NADA sobre
   * disponibilidade. Quem escreve DEVE recusar o replace nesse caso.
   */
  readonly recognized: boolean
  readonly offers: readonly WatchProviderOffer[]
  readonly rejections: readonly WatchProviderRejection[]
  /** Paises presentes no bloco, MAIUSCULO, em ordem de aparicao, deduplicados. */
  readonly countries: readonly string[]
}

/**
 * Marcadores de pirataria que podem viajar mesmo sob `https://` (invariante 8).
 * Segunda linha de defesa: a primeira e o proprio TMDB, que so lista servicos
 * licenciados.
 */
const PIRACY_URL_PATTERN = /\.torrent(?:$|[?#])|xt=urn:btih:/i

/** ISO 3166-1 alpha-2. O TMDB usa maiusculo; aceitamos e normalizamos. */
const COUNTRY_CODE_PATTERN = /^[A-Za-z]{2}$/

/**
 * A chave do sub-recurso no JSON e literalmente `watch/providers` (com barra).
 * O TMDB tambem devolve `watch_providers` em alguns wrappers; aceitamos as duas
 * formas de leitura, mas nunca inventamos o bloco quando nenhuma existe.
 */
const WATCH_PROVIDERS_KEYS = ['watch/providers', 'watch_providers'] as const

function reject(
  reason: WatchProviderRejectionReason,
  detail: string,
): WatchProviderRejection {
  return { reason, detail }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Texto nao-vazio (trimado) ou null. Nunca coage numero/objeto em texto. */
function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** Inteiro finito positivo ou null. `provider_id` do TMDB e sempre inteiro. */
function readPositiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

/** Numero finito (aceita 0) ou null — usado por `display_priority`. */
function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Um link de pais so e aceito quando e `http(s)` E nao carrega marcador de
 * pirataria. Recusado vira `null` na oferta MAIS uma recusa registrada — o link
 * ruim nunca e gravado, e nunca some sem deixar rastro.
 */
export function isSafeWatchLink(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  return !PIRACY_URL_PATTERN.test(value)
}

/** Extrai o bloco `watch/providers` de um detalhe TMDB; `undefined` se ausente. */
function readWatchProvidersBlock(detail: Record<string, unknown>): unknown {
  for (const key of WATCH_PROVIDERS_KEYS) {
    if (key in detail) return detail[key]
  }
  return undefined
}

/**
 * Reconhece o bloco `watch/providers` de um payload de detalhe JA ARQUIVADO.
 *
 * Entrada `unknown` de proposito: a fonte e `tmdb_raw`, gravado por versoes
 * diferentes do append set ao longo do tempo. O reconhecedor precisa distinguir
 * "nao tem oferta" de "nao da para saber" — sao desfechos com consequencias
 * opostas no replace.
 */
export function normalizeWatchProviders(
  entityType: WatchProvidersEntityType,
  tmdbId: number,
  payload: unknown,
): WatchProvidersNormalization {
  const rejections: WatchProviderRejection[] = []

  if (!isRecord(payload)) {
    return {
      recognized: false,
      offers: [],
      countries: [],
      rejections: [reject('payload-not-object', `payload de ${entityType}#${tmdbId} nao e objeto`)],
    }
  }

  const block = readWatchProvidersBlock(payload)
  if (!isRecord(block)) {
    return {
      recognized: false,
      offers: [],
      countries: [],
      rejections: [
        reject(
          'missing-watch-providers',
          `${entityType}#${tmdbId} sem bloco watch/providers utilizavel ` +
            '(payload arquivado antes do append, truncado ou contrato mudado): snapshot preservado',
        ),
      ],
    }
  }

  const results = block.results
  if (!isRecord(results)) {
    return {
      recognized: false,
      offers: [],
      countries: [],
      rejections: [
        reject(
          'results-not-object',
          `${entityType}#${tmdbId} com watch/providers.results anomalo: snapshot preservado`,
        ),
      ],
    }
  }

  const offers: WatchProviderOffer[] = []
  const countries: string[] = []
  const seenCountries = new Set<string>()
  // Dedup por (pais, provedor, modalidade): o TMDB repete o mesmo provedor em
  // buckets distintos (legitimo — rent E buy), mas nunca duas vezes no MESMO
  // bucket. Repeticao exata seria colisao de identidade na escrita.
  const seenOffers = new Set<string>()

  for (const [rawCountry, countryValue] of Object.entries(results)) {
    if (!COUNTRY_CODE_PATTERN.test(rawCountry)) {
      rejections.push(
        reject('invalid-country-code', `${entityType}#${tmdbId}: pais "${rawCountry}" fora de ISO 3166-1 alpha-2`),
      )
      continue
    }
    const countryCode = rawCountry.toUpperCase()

    if (!isRecord(countryValue)) {
      rejections.push(
        reject('country-not-object', `${entityType}#${tmdbId} pais ${countryCode}: valor nao e objeto`),
      )
      continue
    }

    if (!seenCountries.has(countryCode)) {
      seenCountries.add(countryCode)
      countries.push(countryCode)
    }

    // Link de nivel de pais. Recusa NAO derruba as ofertas do pais: elas
    // continuam validas sem URL, e a recusa fica registrada.
    let webUrl: string | null = null
    const rawLink = readText(countryValue.link)
    if (rawLink !== null) {
      if (isSafeWatchLink(rawLink)) {
        webUrl = rawLink
      } else {
        rejections.push(
          reject(
            'unsafe-country-link',
            `${entityType}#${tmdbId} pais ${countryCode}: link recusado (esquema invalido ou marcador de pirataria)`,
          ),
        )
      }
    }

    for (const [bucket, bucketValue] of Object.entries(countryValue)) {
      if (bucket === 'link') continue

      const offerType = WATCH_OFFER_TYPE_BY_TMDB_BUCKET[bucket]
      if (offerType === undefined) {
        rejections.push(
          reject(
            'unmapped-offer-bucket',
            `${entityType}#${tmdbId} pais ${countryCode}: bucket "${bucket}" sem modalidade correspondente`,
          ),
        )
        continue
      }

      if (!Array.isArray(bucketValue)) {
        rejections.push(
          reject(
            'bucket-not-array',
            `${entityType}#${tmdbId} pais ${countryCode} bucket ${bucket}: valor nao e lista`,
          ),
        )
        continue
      }

      for (const entry of bucketValue) {
        if (!isRecord(entry)) {
          rejections.push(
            reject(
              'offer-not-object',
              `${entityType}#${tmdbId} pais ${countryCode} bucket ${bucket}: item nao e objeto`,
            ),
          )
          continue
        }

        const providerId = readPositiveInt(entry.provider_id)
        if (providerId === null) {
          rejections.push(
            reject(
              'missing-provider-id',
              `${entityType}#${tmdbId} pais ${countryCode} bucket ${bucket}: sem provider_id inteiro positivo`,
            ),
          )
          continue
        }

        const providerName = readText(entry.provider_name)
        if (providerName === null) {
          rejections.push(
            reject(
              'missing-provider-name',
              `${entityType}#${tmdbId} pais ${countryCode} bucket ${bucket}: provider ${providerId} sem provider_name`,
            ),
          )
          continue
        }

        const providerKey = String(providerId)
        const identity = `${countryCode}|${providerKey}|${offerType}`
        if (seenOffers.has(identity)) {
          rejections.push(
            reject(
              'duplicate-offer',
              `${entityType}#${tmdbId} pais ${countryCode}: oferta repetida (${providerKey}/${offerType})`,
            ),
          )
          continue
        }
        seenOffers.add(identity)

        offers.push({
          entityType,
          tmdbId,
          countryCode,
          providerKey,
          providerName,
          offerType,
          webUrl,
          displayPriority: readFiniteNumber(entry.display_priority),
          logoPath: readText(entry.logo_path),
        })
      }
    }
  }

  return { recognized: true, offers, rejections, countries }
}
