/**
 * run.ts — Orquestracao PURA do reprocessamento de `watch/providers`.
 *
 * Le o bruto ja arquivado (porta `RawWatchSource`), reconhece o bloco
 * (`normalizeWatchProviders`), resolve tmdbId -> id interno e faz o replace por
 * (entidade, pais). Sem rede, sem Prisma, sem relogio proprio — testavel com
 * fakes.
 *
 * ANTI-SILENCIO (B-H). Seis desfechos NOMEADOS, nenhum colapsa no outro:
 *  - `applied`      ofertas reconhecidas e gravadas;
 *  - `empty`        payload reconhecido, zero oferta — o titulo nao tem oferta;
 *  - `out-of-scope` o titulo TEM oferta, mas so fora dos territorios ingeridos;
 *  - `unrecognized` payload nao utilizavel — o replace NAO roda (snapshot bom
 *                   preservado). Isto NAO e sucesso e NAO e "vazio";
 *  - `unresolved`   entidade ainda nao promovida — sem id interno, sem FK;
 *  - `missing-raw`  o id esta no catalogo e o bruto NAO existe no deposito
 *                   consultado. Desfecho que a fonte antiga (que enumerava o
 *                   proprio deposito) era incapaz de produzir: o que faltava
 *                   nao voltava na consulta, logo nao podia ser contado;
 *  - `failed`       erro na escrita, com classe e mensagem preservadas.
 * `deriveWatchReprocessStatus` recusa reportar `empty` quando houve falha:
 * "tudo falhou" nunca vira "nada a fazer".
 *
 * ESCOPO TERRITORIAL (`territories`): so os paises declarados sao gravados. O
 * resto e contado por codigo em `countriesOutOfScope` — ver `territories.ts`
 * para o porque (FK de `countries`, render BR-only, uma transacao por pais).
 */

import { normalizeWatchProviders } from '../normalizers/watch-providers.js'
// O agrupamento por pais e o MESMO do caminho do detalhe: uma unica definicao,
// para que os dois caminhos nao possam divergir no que e uma transacao.
import { groupOffersByCountry as groupByCountry } from './from-detail.js'
import { DEFAULT_WATCH_TERRITORIES } from './territories.js'
import type {
  RawWatchSource,
  RawWatchSourceRow,
  WatchEntityResolver,
  WatchOfferStore,
  WatchProviderOffer,
  WatchProviderRejection,
  WatchProvidersEntityType,
  WatchRejectionTally,
  WatchReprocessCounts,
  WatchReprocessFailure,
  WatchReprocessOutcome,
  WatchReprocessReport,
  WatchReprocessStatus,
} from './types.js'

/** Teto de falhas gravadas no relatorio (o total fica em `counts.failed`). */
const MAX_FAILURE_SAMPLE = 50

/** Opcoes de um ciclo de reprocessamento. */
export interface RunWatchReprocessOptions {
  readonly entityType: WatchProvidersEntityType
  readonly source: RawWatchSource
  readonly resolver: WatchEntityResolver
  readonly store: WatchOfferStore
  /** Teto de entidades desta execucao. */
  readonly limit: number
  /**
   * Territorios ingeridos (ISO 3166-1 alpha-2 MAIUSCULO). Oferta de pais fora
   * daqui e DESCARTADA e CONTADA, nunca gravada — `countries` e o dicionario
   * que valida a grafia, nao o lugar onde se decide escopo de produto.
   * Omitido => `DEFAULT_WATCH_TERRITORIES`.
   */
  readonly territories?: readonly string[]
  /** Janela de frescor da oferta: `staleAfter = fetchedAt + staleAfterMs`. */
  readonly staleAfterMs: number
  /** Relogio injetavel (determinista em teste). */
  readonly now: () => Date
  /** true = plano (le e reconhece, NAO escreve). */
  readonly dryRun: boolean
  /** Observabilidade por item. */
  readonly onItem?: (tmdbId: number, outcome: WatchReprocessOutcome) => void
}

/** Classe segura do erro: nome do construtor, nunca payload nem segredo. */
export function classifyWatchError(error: unknown): string {
  if (error instanceof Error && error.name.trim() !== '') return error.name
  if (error !== null && typeof error === 'object') return error.constructor?.name ?? 'Object'
  return typeof error
}

/** Mensagem sanitizada e truncada — o erro nunca evapora, mas nao vaza payload. */
export function safeWatchErrorMessage(error: unknown, maxLength = 300): string {
  const raw = error instanceof Error ? error.message : String(error)
  const collapsed = raw.replace(/\s+/g, ' ').trim()
  if (collapsed === '') return '(sem mensagem)'
  return collapsed.length <= maxLength ? collapsed : `${collapsed.slice(0, maxLength)}...`
}

/** Agrega recusas por motivo. Nenhum descarte fica anonimo. */
export function tallyRejections(
  rejections: readonly WatchProviderRejection[],
  into: Record<string, number> = {},
): Record<string, number> {
  for (const rejection of rejections) {
    into[rejection.reason] = (into[rejection.reason] ?? 0) + 1
  }
  return into
}

/**
 * Deriva o status do ciclo.
 *
 * Regra que fecha o buraco ja observado em `promotion/run.ts` (30 elegiveis, 30
 * rejeitadas, log `empty`): `empty` exige ZERO falha. Com qualquer falha o
 * status e `failed` (nada aplicado) ou `partial` (parte aplicada).
 */
export function deriveWatchReprocessStatus(counts: WatchReprocessCounts): WatchReprocessStatus {
  if (counts.scanned === 0) return 'empty'
  if (counts.failed > 0) return counts.applied > 0 ? 'partial' : 'failed'
  // `unrecognized` nao e erro do nosso lado, mas tambem nao e trabalho feito:
  // se NADA foi aplicado e havia payloads nao reconhecidos, o ciclo e parcial.
  if (counts.applied === 0 && counts.unrecognized > 0) return 'partial'
  if (counts.applied === 0 && counts.unresolved > 0) return 'partial'
  // Bruto ausente NAO e "nada a fazer": ha trabalho, e ele esta noutro deposito
  // (ou ainda nao foi arquivado). `empty` afirmaria que os titulos nao tem oferta.
  if (counts.applied === 0 && counts.missingRaw > 0) return 'partial'
  // Corpus inteiro fora do escopo territorial NAO e `empty`: `empty` afirma
  // "os titulos nao tem oferta". Aqui tem — nos e que nao ingerimos o pais.
  if (counts.applied === 0 && counts.outOfScope > 0) return 'partial'
  if (counts.applied === 0) return 'empty'
  return counts.unrecognized > 0 ||
    counts.unresolved > 0 ||
    counts.outOfScope > 0 ||
    counts.missingRaw > 0
    ? 'partial'
    : 'success'
}

/** Reprocessa `watch/providers` a partir do bruto arquivado. */
export async function runWatchProvidersReprocess(
  options: RunWatchReprocessOptions,
): Promise<WatchReprocessReport> {
  const startedAt = options.now().getTime()
  const { entityType } = options
  const territories = [...(options.territories ?? DEFAULT_WATCH_TERRITORIES)]
  const inScope = new Set(territories)

  const scannedRows: readonly RawWatchSourceRow[] = await options.source.list(
    entityType,
    options.limit,
  )

  let applied = 0
  let empty = 0
  let outOfScope = 0
  let unrecognized = 0
  let unresolved = 0
  let missingRaw = 0
  let failed = 0
  let offersUpserted = 0
  let offersRevoked = 0
  let offersUpsertedOnFailedEntities = 0
  let offersOutOfScope = 0
  const failures: WatchReprocessFailure[] = []
  const rejectionTally: Record<string, number> = {}
  const countriesSeen = new Set<string>()
  const countriesOutOfScope: Record<string, number> = {}
  const providerTally = new Map<
    string,
    {
      providerName: string
      offers: number
      offersInScope: number
      offerTypes: Record<string, number>
      countries: Set<string>
    }
  >()

  // Reconhecimento primeiro (puro), resolucao depois (uma consulta por lote):
  // resolver id por item seria N consultas para a mesma informacao.
  const recognized: { row: RawWatchSourceRow; offers: readonly WatchProviderOffer[] }[] = []

  for (const row of scannedRows) {
    // AUSENCIA DE BRUTO vem ANTES do reconhecimento. Passar um id sem payload
    // por `normalizeWatchProviders` produziria `unrecognized` — e "o payload
    // nao serve" e uma afirmacao diferente de "nao ha payload". Colapsar as
    // duas devolveria a ambiguidade que esta cadeia veio eliminar.
    if (!row.present) {
      missingRaw += 1
      options.onItem?.(row.tmdbId, 'missing-raw')
      continue
    }

    const result = normalizeWatchProviders(entityType, row.tmdbId, row.payload)
    tallyRejections(result.rejections, rejectionTally)
    for (const country of result.countries) countriesSeen.add(country)

    if (!result.recognized) {
      unrecognized += 1
      options.onItem?.(row.tmdbId, 'unrecognized')
      continue
    }

    // A COLHEITA mede o dado INTEIRO, nao so o territorio ingerido: e dela que
    // saem os aliases, e um provedor que so aparece fora do escopo continua
    // sendo um provedor que existe. Restringi-la ao escopo transformaria a
    // ferramenta de descoberta numa foto do que ja decidimos ver.
    for (const offer of result.offers) {
      // `offersInScope` conta SO o territorio ingerido: e o numero que decide
      // registro de alias. O global mede o dado; o do escopo mede o produto.
      const scoped = inScope.has(offer.countryCode) ? 1 : 0
      const seen = providerTally.get(offer.providerKey)
      if (seen === undefined) {
        providerTally.set(offer.providerKey, {
          providerName: offer.providerName,
          offers: 1,
          offersInScope: scoped,
          offerTypes: { [offer.offerType]: 1 },
          countries: new Set([offer.countryCode]),
        })
      } else {
        seen.offers += 1
        seen.offersInScope += scoped
        seen.offerTypes[offer.offerType] = (seen.offerTypes[offer.offerType] ?? 0) + 1
        seen.countries.add(offer.countryCode)
      }
    }

    if (result.offers.length === 0) {
      empty += 1
      options.onItem?.(row.tmdbId, 'empty')
      continue
    }

    // Filtro territorial ANTES da escrita. Cada oferta descartada e contada no
    // seu pais: o operador precisa poder ler "AD trazia 3 ofertas e nao entrou".
    const scoped: WatchProviderOffer[] = []
    for (const offer of result.offers) {
      if (inScope.has(offer.countryCode)) {
        scoped.push(offer)
        continue
      }
      offersOutOfScope += 1
      countriesOutOfScope[offer.countryCode] = (countriesOutOfScope[offer.countryCode] ?? 0) + 1
    }

    if (scoped.length === 0) {
      outOfScope += 1
      options.onItem?.(row.tmdbId, 'out-of-scope')
      continue
    }

    recognized.push({ row, offers: scoped })
  }

  const resolvedList =
    recognized.length === 0
      ? []
      : await options.resolver.resolve(
          entityType,
          recognized.map((item) => item.row.tmdbId),
        )
  const entityIdByTmdbId = new Map(resolvedList.map((e) => [e.tmdbId, e.entityId]))

  const fetchedAt = options.now()
  const staleAfter = new Date(fetchedAt.getTime() + options.staleAfterMs)

  for (const { row, offers } of recognized) {
    const entityId = entityIdByTmdbId.get(row.tmdbId)
    if (entityId === undefined) {
      // Entidade ainda nao promovida. Contada e nomeada — nunca some no filtro.
      unresolved += 1
      options.onItem?.(row.tmdbId, 'unresolved')
      continue
    }

    if (options.dryRun) {
      applied += 1
      offersUpserted += offers.length
      options.onItem?.(row.tmdbId, 'applied')
      continue
    }

    // Acumuladores POR ENTIDADE. O contador global so recebe o total quando a
    // entidade completa: sem isto, `replaceSnapshot` (uma transacao por pais)
    // deixava o que ja commitara somado em `offersUpserted` enquanto `applied`
    // ficava em 0 — o relatorio de producao saiu `aplicados 0 (ofertas: +41)`.
    let entityUpserted = 0
    let entityRevoked = 0
    const countriesWritten: string[] = []
    let countryInFlight = '(nenhum)'

    try {
      for (const [countryCode, countryOffers] of groupByCountry(offers)) {
        countryInFlight = countryCode
        const outcome = await options.store.replaceSnapshot({
          entityType,
          entityId,
          countryCode,
          offers: countryOffers,
          fetchedAt,
          staleAfter,
        })
        entityUpserted += outcome.upserted
        entityRevoked += outcome.revoked
        countriesWritten.push(countryCode)
      }
      offersUpserted += entityUpserted
      offersRevoked += entityRevoked
      applied += 1
      options.onItem?.(row.tmdbId, 'applied')
    } catch (error) {
      failed += 1
      // O que ja foi commitado NAO evapora do relatorio: vai para o contador de
      // snapshot parcial, separado do sucesso. A revogacao dos paises restantes
      // nao rodou — a entidade fica com snapshot incompleto ate a proxima
      // passada, e isso precisa estar visivel.
      offersUpsertedOnFailedEntities += entityUpserted
      offersRevoked += entityRevoked
      if (failures.length < MAX_FAILURE_SAMPLE) {
        failures.push({
          tmdbId: row.tmdbId,
          errorClass: classifyWatchError(error),
          message: safeWatchErrorMessage(error),
          countriesWritten,
          countryFailed: countryInFlight,
        })
      }
      options.onItem?.(row.tmdbId, 'failed')
    }
  }

  const providersSeen = [...providerTally.entries()]
    .map(([providerKey, value]) => ({
      providerKey,
      providerName: value.providerName,
      offers: value.offers,
      offersInScope: value.offersInScope,
      offerTypes: value.offerTypes,
      countries: [...value.countries].sort(),
    }))
    // Ordena pelo volume NO ESCOPO primeiro: e ele que decide registro de alias.
    // Ordenar por volume global punha no topo provedores sem uma oferta em BR.
    .sort(
      (a, b) =>
        b.offersInScope - a.offersInScope ||
        b.offers - a.offers ||
        a.providerKey.localeCompare(b.providerKey),
    )

  return {
    entityType,
    counts: {
      scanned: scannedRows.length,
      applied,
      empty,
      outOfScope,
      unrecognized,
      unresolved,
      missingRaw,
      failed,
      offersUpserted,
      offersRevoked,
      offersUpsertedOnFailedEntities,
      offersOutOfScope,
    },
    failures,
    rejections: rejectionTally as WatchRejectionTally,
    providersSeen,
    countriesSeen: [...countriesSeen].sort(),
    territories,
    countriesOutOfScope,
    durationMs: options.now().getTime() - startedAt,
    dryRun: options.dryRun,
  }
}
