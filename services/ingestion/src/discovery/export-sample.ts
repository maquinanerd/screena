/**
 * export-sample.ts — Amostra top-N POR POPULARIDADE de um Daily ID Export,
 * em streaming e com memoria limitada a N.
 *
 * O DEFEITO QUE ESTE MODULO FECHA (o ultimo corte de prefixo vivo): o
 * `--max-per-type` de `bin/discover-ids.ts` parava de LER o arquivo na linha
 * N. O export vem em ordem de id (aproximadamente data de cadastro no TMDB),
 * entao a amostra de dev ficava enviesada para os ids mais ANTIGOS — o curta
 * obscuro de 1913 — e o `buildSyncQueue` da linha seguinte ordenava um universo
 * ja truncado. O caminho do pipeline (`discovery/export-discovery.ts`) ja tinha
 * sido corrigido; o bin ficou para tras.
 *
 * A regra e a mesma de `selectTopByPopularity` (seed-plan.ts): consumir o
 * export INTEIRO e so entao decidir — a ordem total espelha `buildSyncQueue`
 * (popularidade desc, sem-popularidade por ultimo, desempate por id asc), para
 * a amostra do bin e a fila final nunca discordarem.
 *
 * As DUAS camadas anti-adulto continuam valendo aqui: quem chama nunca baixa
 * `adult_*`, e cada linha passa por `classifyAdult` FAIL-CLOSED (`true` cai
 * como adulto; valor malformado — ou ausente quando o export deveria traze-lo —
 * cai como unsafe, nunca presumido seguro).
 */

import { classifyAdult } from './adult-filter.js'
import type { IdExportRecord } from './id-exports.js'

export interface ExportSampleCounts {
  /** Descartados por `adult === true`. */
  readonly adultDropped: number
  /** Descartados por `adult` malformado/ausente-quando-obrigatorio (fail-closed). */
  readonly unsafeDropped: number
  /** Descartados por id invalido. */
  readonly invalidDropped: number
  /** Ids repetidos dentro do proprio export. */
  readonly duplicate: number
}

export interface ExportSample {
  /** Registros mantidos, JA ordenados por popularidade desc (id asc no empate). */
  readonly kept: readonly IdExportRecord[]
  readonly counts: ExportSampleCounts
}

export interface TopRecordSampler {
  /** Oferece UMA linha parseada do export. */
  offer(record: IdExportRecord): void
  /** Fecha a amostra: devolve os mantidos ordenados + contagens. */
  finish(): ExportSample
}

/** `a` vem antes de `b`? Ordem TOTAL identica a de `buildSyncQueue`. */
function isBetter(a: IdExportRecord, b: IdExportRecord): boolean {
  const ap = typeof a.popularity === 'number' && Number.isFinite(a.popularity) ? a.popularity : null
  const bp = typeof b.popularity === 'number' && Number.isFinite(b.popularity) ? b.popularity : null
  if (ap !== null && bp !== null && ap !== bp) return ap > bp
  if (ap !== null && bp === null) return true
  if (ap === null && bp !== null) return false
  return a.id < b.id
}

/**
 * Cria um sampler de top-N. `limit: null` = sem teto (mantem tudo, ainda
 * ordenado no `finish`).
 *
 * A decisao NUNCA acontece antes da ultima linha: com teto, a estrutura e uma
 * lista ordenada de tamanho <= N com insercao binaria (o mesmo desenho de
 * `selectTopByPopularity`), entao a memoria e O(N) e o resultado e o mesmo que
 * ordenar o universo inteiro e cortar depois.
 */
export function createTopRecordSampler(input: {
  readonly limit: number | null
  readonly adultFieldRequired: boolean
}): TopRecordSampler {
  const cap =
    input.limit !== null && Number.isInteger(input.limit) && input.limit > 0 ? input.limit : null
  const kept: IdExportRecord[] = []
  const seen = new Set<number>()
  let adultDropped = 0
  let unsafeDropped = 0
  let invalidDropped = 0
  let duplicate = 0

  return {
    offer(record: IdExportRecord): void {
      const verdict = classifyAdult(record.adult, input.adultFieldRequired)
      if (verdict === 'adult') {
        adultDropped += 1
        return
      }
      if (verdict === 'malformed') {
        unsafeDropped += 1
        return
      }
      if (!Number.isInteger(record.id) || record.id <= 0) {
        invalidDropped += 1
        return
      }
      if (seen.has(record.id)) {
        duplicate += 1
        return
      }
      seen.add(record.id)

      // Sem teto, insercao ordenada seria O(n^2) num export de milhoes de
      // linhas: acumula e ordena UMA vez no `finish`.
      if (cap === null) {
        kept.push(record)
        return
      }
      if (kept.length === cap && !isBetter(record, kept[kept.length - 1]!)) {
        return
      }
      let low = 0
      let high = kept.length
      while (low < high) {
        const mid = (low + high) >>> 1
        if (isBetter(record, kept[mid]!)) high = mid
        else low = mid + 1
      }
      kept.splice(low, 0, record)
      if (kept.length > cap) kept.pop()
    },
    finish(): ExportSample {
      if (cap === null) kept.sort((a, b) => (isBetter(a, b) ? -1 : 1))
      return {
        kept,
        counts: { adultDropped, unsafeDropped, invalidDropped, duplicate },
      }
    },
  }
}
