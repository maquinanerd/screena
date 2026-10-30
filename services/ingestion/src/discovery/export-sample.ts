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
 *
 * O MESMO CONTRATO DE `filterAdult` + `buildSyncQueue`, porque desde 29/10/2026
 * este sampler e tambem o caminho da FILA (`discover_ids`, via
 * `export-discovery.ts`), nao so o da amostra da CLI:
 *  - a ordem de descarte e a de `filterAdult`: id invalido, depois adulto,
 *    depois malformado;
 *  - id repetido no export mantem a MAIOR popularidade, como `buildSyncQueue`
 *    (ate aqui o sampler mantinha a primeira ocorrencia e a amostra podia
 *    discordar da fila).
 */
export function createTopRecordSampler(input: {
  readonly limit: number | null
  readonly adultFieldRequired: boolean
}): TopRecordSampler {
  const cap =
    input.limit !== null && Number.isInteger(input.limit) && input.limit > 0 ? input.limit : null
  const kept: IdExportRecord[] = []
  // Sem teto, o mapa E a colecao: o dedup precisa achar o registro anterior
  // para troca-lo pelo de maior popularidade. Com teto, `seen` so responde "ja
  // vi este id"; o anterior, se ainda conta, esta em `kept` (<= N).
  const byId = new Map<number, IdExportRecord>()
  const seen = new Set<number>()
  let adultDropped = 0
  let unsafeDropped = 0
  let invalidDropped = 0
  let duplicate = 0

  function insert(record: IdExportRecord, limit: number): void {
    if (kept.length === limit && !isBetter(record, kept[kept.length - 1]!)) return
    let low = 0
    let high = kept.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (isBetter(record, kept[mid]!)) high = mid
      else low = mid + 1
    }
    kept.splice(low, 0, record)
    if (kept.length > limit) kept.pop()
  }

  return {
    offer(record: IdExportRecord): void {
      if (!Number.isInteger(record.id) || record.id <= 0) {
        invalidDropped += 1
        return
      }
      const verdict = classifyAdult(record.adult, input.adultFieldRequired)
      if (verdict === 'adult') {
        adultDropped += 1
        return
      }
      if (verdict === 'malformed') {
        unsafeDropped += 1
        return
      }

      // Sem teto, insercao ordenada seria O(n^2) num export de milhoes de
      // linhas: acumula e ordena UMA vez no `finish`.
      if (cap === null) {
        const previous = byId.get(record.id)
        if (previous === undefined) {
          byId.set(record.id, record)
          return
        }
        duplicate += 1
        if (isBetter(record, previous)) byId.set(record.id, record)
        return
      }

      if (!seen.has(record.id)) {
        seen.add(record.id)
        insert(record, cap)
        return
      }
      duplicate += 1
      const at = kept.findIndex((item) => item.id === record.id)
      if (at === -1) {
        // O anterior ja nao conta: foi recusado ou expulso por um registro
        // melhor. O piso de `kept` so sobe, entao o repetido concorre como
        // qualquer outro — se for pior que o anterior, e pior que o piso.
        insert(record, cap)
        return
      }
      if (!isBetter(record, kept[at]!)) return
      kept.splice(at, 1)
      insert(record, cap)
    },
    finish(): ExportSample {
      const ordered =
        cap === null ? [...byId.values()].sort((a, b) => (isBetter(a, b) ? -1 : 1)) : kept
      return {
        kept: ordered,
        counts: { adultDropped, unsafeDropped, invalidDropped, duplicate },
      }
    },
  }
}
