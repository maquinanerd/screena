/**
 * seed-plan.ts — Selecao e dimensionamento da SEMENTE do espelho. Modulo PURO.
 *
 * ESPELHAR != COBRIR. Copiar as ~6,32 M entidades do TMDB (1,23 M filmes +
 * 0,23 M series + 4,86 M pessoas) custa disco e dinheiro para sempre. A semente
 * copia so os titulos de maior popularidade; o resto e coberto sob demanda. Para
 * o usuario as duas coisas sao indistinguiveis — a diferenca e quanto foi
 * copiado ANTES de alguem pedir, e e isso que custa.
 *
 * PESSOAS FICAM DE FORA da semente: sao 77% do universo e a esmagadora maioria
 * nunca sera pedida. As alcancaveis pelos titulos da semente entram pelos
 * creditos, que ja vem no mesmo `append_to_response` do titulo — custo zero
 * adicional de request.
 *
 * O DEFEITO QUE ESTE MODULO EXISTE PARA IMPEDIR: o corte por POPULARIDADE nao
 * pode ser um corte de PREFIXO. O Daily ID Export e publicado em ordem de id
 * (ou seja, de data de cadastro no TMDB), entao parar de ler nas N primeiras
 * linhas devolve os N titulos mais ANTIGOS, nao os mais populares. Hoje esse
 * corte de prefixo existe em DOIS lugares independentes
 * (`bin/discover-ids.ts` via `--max-per-type` e `catalog-services.ts` via
 * `--limit` do bootstrap), e a ordenacao por popularidade de `buildSyncQueue`
 * roda DEPOIS do corte — ordenando um universo ja truncado.
 * {@link selectTopByPopularity} torna o defeito impossivel por construcao: ele
 * consome o export INTEIRO e mantem so os N melhores, com memoria limitada a N.
 *
 * `popularity` vem em cada linha do export publico — ordenar custa ZERO cota.
 */

import type { IdExportRecord } from './id-exports.js'

/** Tipos que entram na semente. Pessoa NAO entra (ver cabecalho). */
export const SEED_KINDS = ['movie', 'tv'] as const

/** Um tipo semeavel. */
export type SeedKind = (typeof SEED_KINDS)[number]

/** Um candidato selecionado para a semente. */
export interface SeedCandidate {
  readonly kind: SeedKind
  readonly tmdbId: number
  /** `null` quando o export nao trouxe popularidade utilizavel. */
  readonly popularity: number | null
}

/** Contagem de tudo que foi visto e descartado — nenhum descarte e anonimo. */
export interface SeedSelectionStats {
  /** Linhas validas consideradas (apos o filtro adult upstream). */
  readonly considered: number
  /** Linhas com id invalido. */
  readonly invalidId: number
  /** Linhas sem `popularity` numerica utilizavel. */
  readonly missingPopularity: number
  /** Ids repetidos no mesmo export. */
  readonly duplicate: number
  /** Selecionados (<= limite). */
  readonly selected: number
  /** Considerados que NAO entraram por estarem abaixo do corte. */
  readonly belowCut: number
  /** Menor popularidade que entrou; `null` quando nada entrou. */
  readonly cutoffPopularity: number | null
  /** Maior popularidade vista. */
  readonly topPopularity: number | null
}

/** Resultado da selecao de um tipo. */
export interface SeedSelection {
  readonly kind: SeedKind
  readonly candidates: readonly SeedCandidate[]
  readonly stats: SeedSelectionStats
}

/** Popularidade utilizavel, ou `null`. Sem coercao e sem valor default. */
function popularityOf(record: IdExportRecord): number | null {
  const value = record.popularity
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Comparacao total e DETERMINISTICA: popularidade desc, depois id asc.
 *
 * O desempate por id importa: sem ele, dois planos do mesmo export poderiam
 * divergir, e um plano que nao reproduz nao serve para orcar nada.
 */
function isBetter(a: SeedCandidate, b: SeedCandidate): boolean {
  const pa = a.popularity ?? Number.NEGATIVE_INFINITY
  const pb = b.popularity ?? Number.NEGATIVE_INFINITY
  if (pa !== pb) return pa > pb
  return a.tmdbId < b.tmdbId
}

/**
 * Seleciona os `limit` registros de MAIOR popularidade, consumindo o iteravel
 * INTEIRO com memoria limitada a `limit`.
 *
 * Implementacao: lista ordenada de tamanho maximo `limit` com insercao binaria.
 * Para os tamanhos reais (limite de dezenas de milhares, universo de milhoes) o
 * custo domina na leitura do arquivo, nao aqui — e o que importa e a garantia
 * estrutural: a funcao NUNCA pode devolver um prefixo do arquivo, porque ela so
 * decide depois de ver a ultima linha.
 */
export function selectTopByPopularity(
  kind: SeedKind,
  records: Iterable<IdExportRecord>,
  limit: number,
): SeedSelection {
  const cap = Number.isInteger(limit) && limit > 0 ? limit : 0
  const kept: SeedCandidate[] = []
  const seen = new Set<number>()

  let considered = 0
  let invalidId = 0
  let missingPopularity = 0
  let duplicate = 0
  let topPopularity: number | null = null

  for (const record of records) {
    const tmdbId = record.id
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
      invalidId += 1
      continue
    }
    if (seen.has(tmdbId)) {
      duplicate += 1
      continue
    }
    seen.add(tmdbId)

    const popularity = popularityOf(record)
    if (popularity === null) missingPopularity += 1
    if (popularity !== null && (topPopularity === null || popularity > topPopularity)) {
      topPopularity = popularity
    }
    considered += 1
    if (cap === 0) continue

    const candidate: SeedCandidate = { kind, tmdbId, popularity }

    // Cheio e pior que o ultimo: descarta sem tocar a lista.
    if (kept.length === cap && !isBetter(candidate, kept[kept.length - 1]!)) continue

    let low = 0
    let high = kept.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (isBetter(candidate, kept[mid]!)) high = mid
      else low = mid + 1
    }
    kept.splice(low, 0, candidate)
    if (kept.length > cap) kept.pop()
  }

  return {
    kind,
    candidates: kept,
    stats: {
      considered,
      invalidId,
      missingPopularity,
      duplicate,
      selected: kept.length,
      belowCut: Math.max(0, considered - kept.length),
      cutoffPopularity: kept.length === 0 ? null : (kept[kept.length - 1]!.popularity ?? null),
      topPopularity,
    },
  }
}

/**
 * Bytes medios por entidade arquivada.
 *
 * DE ONDE VEM ESTE NUMERO: NAO e um chute embutido. `runRawSyncPilot` ja mede
 * `PayloadSizeStats { count, avgBytes, maxBytes, minBytes }` por tipo, em bytes
 * UTF-8 da MESMA serializacao canonica que alimenta o hash
 * (`computeRawPayloadHashAndSize`). O caminho correto e alimentar o estimador
 * com aquela medicao. Os valores abaixo sao apenas o FALLBACK usado quando
 * nenhuma medicao esta disponivel, e todo relatorio que os use e obrigado a
 * dize-lo — uma estimativa cuja base nao aparece nao vale nada.
 *
 * Base do fallback: um detalhe de filme com o `append_to_response` completo
 * (credits, images, videos, keywords, recommendations, similar, reviews,
 * release_dates, translations, alternative_titles, watch/providers, changes)
 * fica na ordem de centenas de KB; serie com o append equivalente e maior.
 */
export const FALLBACK_AVG_BYTES_BY_KIND: Readonly<Record<SeedKind, number>> = {
  movie: 250_000,
  tv: 400_000,
}

/** De onde saiu o numero de bytes por entidade. Vai impresso no relatorio. */
export type BytesBasis = 'measured' | 'fallback'

/** Bytes medios por entidade, com a origem declarada. */
export interface BytesPerEntity {
  readonly kind: SeedKind
  readonly avgBytes: number
  readonly basis: BytesBasis
  /** Quantas entidades foram medidas (0 quando `basis` e `fallback`). */
  readonly sampleSize: number
}

/** Medicao real de tamanho de payload, vinda de um ciclo de raw sync. */
export interface MeasuredPayloadSize {
  readonly kind: SeedKind
  readonly avgBytes: number
  readonly sampleSize: number
}

/** Resolve bytes/entidade por tipo, preferindo medicao real. */
export function resolveBytesPerEntity(
  kind: SeedKind,
  measured: readonly MeasuredPayloadSize[] = [],
): BytesPerEntity {
  const hit = measured.find((m) => m.kind === kind && m.sampleSize > 0 && m.avgBytes > 0)
  if (hit !== undefined) {
    return { kind, avgBytes: hit.avgBytes, basis: 'measured', sampleSize: hit.sampleSize }
  }
  return { kind, avgBytes: FALLBACK_AVG_BYTES_BY_KIND[kind], basis: 'fallback', sampleSize: 0 }
}

/** Dimensionamento de um tipo dentro do plano. */
export interface SeedKindPlan {
  readonly kind: SeedKind
  readonly entities: number
  /** Requests de detalhe: entidades x blocos de `append_to_response`. */
  readonly requests: number
  readonly appendChunks: number
  readonly bytesPerEntity: BytesPerEntity
  /** Bytes brutos estimados no object store (serializacao canonica, sem gzip). */
  readonly rawBytes: number
  readonly stats: SeedSelectionStats
}

/** O plano completo, pronto para impressao. */
export interface SeedPlan {
  readonly kinds: readonly SeedKindPlan[]
  readonly totalEntities: number
  readonly totalRequests: number
  readonly totalRawBytes: number
  /** true quando ALGUM tipo usou o fallback — o relatorio precisa dizer. */
  readonly usesFallbackBytes: boolean
}

/** Entrada do dimensionamento. */
export interface BuildSeedPlanInput {
  readonly selections: readonly SeedSelection[]
  /** Blocos de `append_to_response` por tipo (derivado do client, nao chutado). */
  readonly appendChunksByKind: Readonly<Record<SeedKind, number>>
  readonly measured?: readonly MeasuredPayloadSize[]
}

/** Dimensiona o plano a partir das selecoes. Puro e deterministico. */
export function buildSeedPlan(input: BuildSeedPlanInput): SeedPlan {
  const kinds = input.selections.map((selection): SeedKindPlan => {
    const appendChunks = input.appendChunksByKind[selection.kind]
    const bytesPerEntity = resolveBytesPerEntity(selection.kind, input.measured)
    const entities = selection.candidates.length
    return {
      kind: selection.kind,
      entities,
      requests: entities * appendChunks,
      appendChunks,
      bytesPerEntity,
      rawBytes: entities * bytesPerEntity.avgBytes,
      stats: selection.stats,
    }
  })

  return {
    kinds,
    totalEntities: kinds.reduce((sum, k) => sum + k.entities, 0),
    totalRequests: kinds.reduce((sum, k) => sum + k.requests, 0),
    totalRawBytes: kinds.reduce((sum, k) => sum + k.rawBytes, 0),
    usesFallbackBytes: kinds.some((k) => k.bytesPerEntity.basis === 'fallback'),
  }
}

/** Formata bytes em unidade legivel (base 1000, como os provedores cobram). */
export function formatBytes(bytes: number): string {
  const units = ['B', 'kB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`
}
