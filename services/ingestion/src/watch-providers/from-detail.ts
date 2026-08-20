/**
 * from-detail.ts — Materializa `watch_availability` a partir do payload de
 * DETALHE que o import ja tem em maos. Modulo PURO (sem Prisma, sem rede).
 *
 * ============ POR QUE ISTO EXISTE ============
 *
 * `catalog sync` (job `sync_details`) JA BAIXA o bloco `watch/providers`. O
 * `append_to_response` real da requisicao e o RICO de
 * `api-clients/tmdb/src/append-to-response.ts` (`MOVIE_APPEND`/`TV_APPEND`,
 * ambos com `watch/providers`), montado dentro de `getMovie`/`getTvShow`. A
 * string `'external_ids,credits'` de `src/import/import-movie.ts` NUNCA vai a
 * rede: ela e so o rotulo de `params` da CHAVE de `api_cache` — `buildCacheKey`
 * (`src/utils/cache-key.ts`) usa `params` apenas para `requestKey`/`paramsHash`,
 * e o `fetcher` e chamado sem argumentos.
 *
 * Ou seja: o byte da disponibilidade chegava, era gravado em `api_cache` e o
 * normalizador de detalhe o descartava — `normalizeMovie` le apenas `credits` e
 * `external_ids`. Sincronizar 39 titulos devolvia `39 ok` e zero oferta.
 *
 * Este modulo e a ponte que faltava, e ela e de CUSTO ZERO em cota: nao ha uma
 * unica chamada nova ao TMDB aqui. Reaproveita as duas pecas que ja existiam e
 * ja rodam em producao pelo caminho do bruto (`bin/reprocess-watch-providers`):
 * o reconhecedor `normalizeWatchProviders` e o escritor `WatchOfferStore`.
 *
 * ============ O QUE ESTE MODULO NAO FAZ ============
 *
 * Nao decide exibicao. Toda linha nasce `display_allowed = false`
 * (invariante 6) porque quem escreve e o MESMO `WatchOfferStore` do
 * reprocessamento — licenca, credito e acendimento continuam sendo decisao
 * humana, por outro comando, com outro guard.
 *
 * ANTI-SILENCIO: o desfecho e sempre NOMEADO, nunca um booleano. `empty`
 * (o titulo nao tem oferta) jamais colapsa em `unrecognized` (nao da para saber)
 * nem em `out-of-scope` (tem oferta, mas fora dos territorios ingeridos), e
 * `not-configured` existe para que um runtime sem sink de ofertas ACUSE isso em
 * vez de parecer um titulo sem oferta.
 */

import { normalizeWatchProviders } from '../normalizers/watch-providers.js'
import type { WatchProviderOffer, WatchProvidersEntityType } from '../normalizers/watch-providers.js'
import type { WatchEntityResolver, WatchOfferStore, WatchRejectionTally } from './types.js'

/**
 * Desfecho da ingestao de disponibilidade de UMA entidade pelo caminho do
 * detalhe. Cada valor e um caminho distinto — nenhum e sinonimo de outro.
 */
export type DetailWatchOutcome =
  /** Ofertas reconhecidas dentro do escopo e gravadas. */
  | 'applied'
  /** Payload reconhecido, nenhum pais com oferta: o titulo nao tem oferta. */
  | 'empty'
  /** O titulo TEM oferta, mas nenhuma nos territorios ingeridos. */
  | 'out-of-scope'
  /**
   * Bloco `watch/providers` ausente/anomalo. NAO e "sem oferta": e um corpo do
   * qual nao se aprende nada. O replace NAO roda — snapshot bom preservado.
   */
  | 'unrecognized'
  /** Entidade sem id interno (nao promovida): sem FK, nada a escrever. */
  | 'unresolved'
  /** Erro na escrita. A causa vem em `errorClass`/`message`. */
  | 'failed'
  /** Este runtime nao tem sink de ofertas ligado. Ausencia declarada, nao muda. */
  | 'not-configured'
  /** Tipo de entidade sem conceito de disponibilidade (pessoa). */
  | 'not-applicable'

/** Relatorio da ingestao de disponibilidade de UMA entidade. */
export interface DetailWatchReport {
  readonly outcome: DetailWatchOutcome
  /** Ofertas inseridas/atualizadas (0 em qualquer desfecho que nao `applied`). */
  readonly offersUpserted: number
  /** Ofertas que sumiram do snapshot: revogadas e marcadas stale, nunca apagadas. */
  readonly offersRevoked: number
  /** Ofertas descartadas por estarem fora dos territorios ingeridos. */
  readonly offersOutOfScope: number
  /** Paises vistos e nao ingeridos, com quantas ofertas cada um trazia. */
  readonly countriesOutOfScope: Readonly<Record<string, number>>
  /** Recusas do reconhecedor por motivo — nenhum descarte fica anonimo. */
  readonly rejections: WatchRejectionTally
  /** Classe do erro quando `outcome === 'failed'`. */
  readonly errorClass?: string
  /** Mensagem sanitizada quando `outcome === 'failed'`. */
  readonly message?: string
  /** Paises gravados ANTES do erro (o replace e uma transacao POR PAIS). */
  readonly countriesWritten?: readonly string[]
}

/** Relatorio de "nao havia o que fazer", com o desfecho declarado. */
export function emptyDetailWatchReport(outcome: DetailWatchOutcome): DetailWatchReport {
  return {
    outcome,
    offersUpserted: 0,
    offersRevoked: 0,
    offersOutOfScope: 0,
    countriesOutOfScope: {},
    rejections: {},
  }
}

/**
 * Sink de disponibilidade injetado no import.
 *
 * Reusa as portas que o reprocessamento do bruto ja definiu: o escritor e o
 * resolvedor tmdbId -> id interno. Nao ha porta nova de leitura porque o payload
 * ja esta em maos — e exatamente esse o ponto.
 */
export interface DetailWatchSink {
  readonly store: WatchOfferStore
  /**
   * Resolve tmdbId -> id interno quando o import NAO fez upsert (short-circuit
   * de cache). Sem isto, re-sincronizar uma entidade cujo payload nao mudou
   * jamais ganharia oferta — que e precisamente a forma como uma passada de
   * recuperacao devolveria `ok` sem materializar nada.
   */
  readonly resolver: WatchEntityResolver
  /** Territorios ingeridos (ISO 3166-1 alpha-2 MAIUSCULO). */
  readonly territories: readonly string[]
  /** Janela de frescor: `staleAfter = fetchedAt + staleAfterMs`. */
  readonly staleAfterMs: number
}

/** Ofertas de UMA entidade, agrupadas por pais (o replace e por pais). */
export function groupOffersByCountry(
  offers: readonly WatchProviderOffer[],
): Map<string, WatchProviderOffer[]> {
  const byCountry = new Map<string, WatchProviderOffer[]>()
  for (const offer of offers) {
    const bucket = byCountry.get(offer.countryCode)
    if (bucket === undefined) byCountry.set(offer.countryCode, [offer])
    else bucket.push(offer)
  }
  return byCountry
}

/** Classe segura do erro: nome do construtor, nunca payload nem segredo. */
function classifyError(error: unknown): string {
  if (error instanceof Error && error.name.trim() !== '') return error.name
  if (error !== null && typeof error === 'object') return error.constructor?.name ?? 'Object'
  return typeof error
}

/** Mensagem sanitizada e truncada — o erro nunca evapora, mas nao vaza payload. */
function safeMessage(error: unknown, maxLength = 300): string {
  const raw = error instanceof Error ? error.message : String(error)
  const collapsed = raw.replace(/\s+/g, ' ').trim()
  if (collapsed === '') return '(sem mensagem)'
  return collapsed.length <= maxLength ? collapsed : `${collapsed.slice(0, maxLength)}...`
}

/** Entrada da ingestao de disponibilidade pelo caminho do detalhe. */
export interface IngestDetailWatchInput {
  readonly entityType: WatchProvidersEntityType
  readonly tmdbId: number
  /**
   * Id interno quando o import acabou de fazer upsert. `null` no short-circuit
   * de cache — ai o sink resolve pelo `tmdbId`.
   */
  readonly entityId: string | null
  /** Payload de detalhe JA em maos (da rede ou de `api_cache`). */
  readonly payload: unknown
  readonly sink: DetailWatchSink | undefined
  readonly now: () => Date
}

/**
 * Reconhece o bloco `watch/providers` do payload de detalhe e grava o snapshot
 * das ofertas nos territorios ingeridos. ZERO chamada ao TMDB.
 */
export async function ingestWatchProvidersFromDetail(
  input: IngestDetailWatchInput,
): Promise<DetailWatchReport> {
  const { sink } = input
  if (sink === undefined) return emptyDetailWatchReport('not-configured')

  const normalization = normalizeWatchProviders(input.entityType, input.tmdbId, input.payload)
  const rejections: Record<string, number> = {}
  for (const rejection of normalization.rejections) {
    rejections[rejection.reason] = (rejections[rejection.reason] ?? 0) + 1
  }
  const tally = rejections as WatchRejectionTally

  if (!normalization.recognized) {
    return { ...emptyDetailWatchReport('unrecognized'), rejections: tally }
  }

  if (normalization.offers.length === 0) {
    return { ...emptyDetailWatchReport('empty'), rejections: tally }
  }

  const inScope = new Set(sink.territories.map((code) => code.toUpperCase()))
  const scoped: WatchProviderOffer[] = []
  const countriesOutOfScope: Record<string, number> = {}
  let offersOutOfScope = 0

  for (const offer of normalization.offers) {
    if (inScope.has(offer.countryCode)) {
      scoped.push(offer)
      continue
    }
    offersOutOfScope += 1
    countriesOutOfScope[offer.countryCode] = (countriesOutOfScope[offer.countryCode] ?? 0) + 1
  }

  if (scoped.length === 0) {
    return {
      ...emptyDetailWatchReport('out-of-scope'),
      offersOutOfScope,
      countriesOutOfScope,
      rejections: tally,
    }
  }

  const countriesWritten: string[] = []
  let offersUpserted = 0
  let offersRevoked = 0

  // A RESOLUCAO ENTRA NO TRY junto com a escrita, e nao antes dele.
  //
  // Esta funcao e TOTAL: ela nunca lanca. A disponibilidade e um efeito
  // secundario de um import que ja pode ter feito upsert com sucesso; deixar
  // uma falha de banco na resolucao escapar daqui derrubaria o `importMovie`
  // inteiro no catch, sem escrever `api_sync_logs`, e um detalhe ja persistido
  // seria reportado como `failed`. O erro nao evapora — vira o desfecho
  // NOMEADO `failed`, com classe e mensagem.
  try {
    // Short-circuit de cache: o import nao fez upsert, entao nao ha id em maos.
    // Resolver aqui e o que faz uma passada de recuperacao funcionar mesmo com
    // o cache quente — sem isto, re-sincronizar uma entidade cujo payload nao
    // mudou responderia `ok` e nao materializaria uma unica oferta.
    let entityId = input.entityId
    if (entityId === null) {
      const resolved = await sink.resolver.resolve(input.entityType, [input.tmdbId])
      entityId = resolved.find((entity) => entity.tmdbId === input.tmdbId)?.entityId ?? null
    }
    if (entityId === null) {
      return {
        ...emptyDetailWatchReport('unresolved'),
        offersOutOfScope,
        countriesOutOfScope,
        rejections: tally,
      }
    }

    const fetchedAt = input.now()
    const staleAfter = new Date(fetchedAt.getTime() + sink.staleAfterMs)

    for (const [countryCode, countryOffers] of groupOffersByCountry(scoped)) {
      const outcome = await sink.store.replaceSnapshot({
        entityType: input.entityType,
        entityId,
        countryCode,
        offers: countryOffers,
        fetchedAt,
        staleAfter,
      })
      offersUpserted += outcome.upserted
      offersRevoked += outcome.revoked
      countriesWritten.push(countryCode)
    }
  } catch (error) {
    // O que ja foi commitado NAO evapora do relatorio, e tambem NAO conta como
    // sucesso: `applied` exige a entidade inteira. Mesmo contrato do
    // reprocessamento do bruto (`watch-providers/run.ts`).
    return {
      outcome: 'failed',
      offersUpserted: 0,
      offersRevoked,
      offersOutOfScope,
      countriesOutOfScope,
      rejections: tally,
      errorClass: classifyError(error),
      message: safeMessage(error),
      countriesWritten,
    }
  }

  return {
    outcome: 'applied',
    offersUpserted,
    offersRevoked,
    offersOutOfScope,
    countriesOutOfScope,
    rejections: tally,
    countriesWritten,
  }
}

/**
 * Rotulo humano de cada desfecho. Curto porque vai numa linha de resumo, e
 * literal porque o operador precisa poder distinguir os casos sem consultar
 * codigo: "sem oferta" e uma afirmacao sobre o TITULO; "nao reconhecida" e uma
 * afirmacao sobre o NOSSO dado.
 */
const DETAIL_WATCH_LABELS: Readonly<Record<DetailWatchOutcome, string>> = {
  applied: 'com oferta',
  empty: 'sem oferta',
  'out-of-scope': 'fora do escopo territorial',
  unrecognized: 'nao reconhecida',
  unresolved: 'entidade nao promovida',
  failed: 'falha ao gravar',
  'not-configured': 'sink de ofertas nao configurado',
  'not-applicable': 'nao se aplica',
}

/** Ordem de exibicao: o que mais importa ao operador primeiro. */
const DETAIL_WATCH_ORDER: readonly DetailWatchOutcome[] = [
  'applied',
  'empty',
  'out-of-scope',
  'unrecognized',
  'unresolved',
  'failed',
  'not-configured',
  'not-applicable',
]

/** Resumo de disponibilidade de um LOTE de detalhes sincronizados. */
export interface DetailWatchSummary {
  /** Quantas entidades por desfecho (so os desfechos com contagem > 0). */
  readonly byOutcome: Readonly<Partial<Record<DetailWatchOutcome, number>>>
  /** Ofertas inseridas/atualizadas no lote. */
  readonly offers: number
  /**
   * Entidades em que a disponibilidade poderia ter sido materializada e NAO
   * foi. Exclui `not-applicable` (pessoa/referencia): somar essas afirmaria uma
   * lacuna que nao existe.
   */
  readonly missed: number
  /** Linhas prontas para o resumo textual do comando. */
  readonly lines: readonly string[]
}

/**
 * Resume os desfechos de disponibilidade de um lote.
 *
 * ============ POR QUE ESTA FUNCAO EXISTE ============
 *
 * `catalog sync` respondia `39 ok · 0 falhou` para 39 titulos que NENHUM ganhou
 * uma oferta. O comando estava certo sobre si mesmo — ele sincroniza detalhe — e
 * inutil para quem o chamou, que estava tentando consertar "onde assistir".
 *
 * A forma minima de fechar isso nao e uma frente nova de observabilidade: e o
 * comando dizer, na MESMA saida, o que ele NAO trouxe. Um lote inteiro sem
 * oferta vira uma linha explicita, nao um silencio que se parece com sucesso.
 */
export function summarizeDetailWatch(
  reports: readonly Pick<DetailWatchReport, 'outcome' | 'offersUpserted'>[],
): DetailWatchSummary {
  const byOutcome: Partial<Record<DetailWatchOutcome, number>> = {}
  let offers = 0
  let missed = 0

  for (const report of reports) {
    byOutcome[report.outcome] = (byOutcome[report.outcome] ?? 0) + 1
    offers += report.offersUpserted
    if (report.outcome !== 'applied' && report.outcome !== 'not-applicable') missed += 1
  }

  const parts = DETAIL_WATCH_ORDER.filter((outcome) => (byOutcome[outcome] ?? 0) > 0).map(
    (outcome) => `${byOutcome[outcome] ?? 0} ${DETAIL_WATCH_LABELS[outcome]}`,
  )

  const lines: string[] = []
  if (parts.length > 0) {
    lines.push(`onde assistir: ${parts.join(' · ')} (+${offers} ofertas)`)
  }
  // O aviso so aparece quando havia mesmo o que materializar. Um lote so de
  // pessoas nao "deixou de trazer" nada, e avisar ali treinaria o operador a
  // ignorar a linha — que e como um aviso vira ruido e depois vira silencio.
  if (missed > 0 && (byOutcome.applied ?? 0) === 0) {
    lines.push(
      `ATENCAO: nenhuma oferta de disponibilidade foi gravada neste lote ` +
        `(${missed} de ${reports.length} entidades sem oferta materializada).`,
    )
  }

  return { byOutcome, offers, missed, lines }
}

/** Rotulo curto de UM desfecho, para a linha por entidade. */
export function describeDetailWatchOutcome(outcome: DetailWatchOutcome): string {
  return DETAIL_WATCH_LABELS[outcome]
}
