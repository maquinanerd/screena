/**
 * adult-filter.ts — Exclusao de conteudo adulto na descoberta de IDs. Modulo
 * PURO. DUAS camadas de defesa (sem pornografia/conteudo adulto na fila):
 *   1. os arquivos `adult_*` do TMDB NUNCA sao baixados
 *      (ver `DAILY_ID_EXPORTS` / `ADULT_EXPORT_FILES` em `id-exports.ts`);
 *   2. dentro dos arquivos padrao, o campo `adult` e classificado FAIL-CLOSED,
 *      linha a linha, aqui.
 * Esta e a camada 2. E o ponto mais sensivel do P0-00c.
 *
 * FAIL-CLOSED: so `adult === false` ou o campo AUSENTE contam como seguro. Um
 * `adult` presente porem malformado (string `"true"`, numero `1`, `null`,
 * objeto, array, etc.) NUNCA e presumido seguro — vai para `unsafeDropped` e
 * fica de fora da fila. So confiamos num booleano de verdade.
 */

import type { IdExportRecord } from './id-exports.js'

/** Classificacao do campo `adult` de um registro. */
export type AdultClassification = 'safe' | 'adult' | 'malformed'

/**
 * Classifica o campo `adult` de forma FAIL-CLOSED:
 *  - `true`              -> `'adult'`     (conteudo adulto explicito);
 *  - `false` | ausente   -> `'safe'`      (permitido — `undefined` = campo nao
 *    fornecido pelo export, ex.: collection/network/company/keyword);
 *  - qualquer OUTRO valor presente (`"true"`, `"false"`, `1`, `0`, `null`,
 *    objeto, array...) -> `'malformed'` (nao confiavel; nunca tratado como
 *    seguro).
 */
export function classifyAdult(adult: unknown): AdultClassification {
  if (adult === true) return 'adult'
  if (adult === false || adult === undefined) return 'safe'
  return 'malformed'
}

/**
 * True apenas quando o registro esta EXPLICITAMENTE marcado como adulto
 * (`adult === true`). Nao decide sozinho a inclusao na fila — o descarte de
 * `adult` malformado e responsabilidade de `filterAdult` (via `classifyAdult`).
 */
export function isAdultRecord(record: IdExportRecord): boolean {
  return classifyAdult(record.adult) === 'adult'
}

/** True se o registro tem `id` valido (inteiro positivo). */
export function hasValidId(record: IdExportRecord): boolean {
  return Number.isInteger(record.id) && record.id > 0
}

/** Resultado do filtro: mantidos (ordem preservada) + contagem de descartes por motivo. */
export interface AdultFilterResult {
  readonly kept: IdExportRecord[]
  /** `adult === true` — conteudo adulto explicito. */
  readonly adultDropped: number
  /** `adult` presente porem malformado (fail-closed: nunca presumido seguro). */
  readonly unsafeDropped: number
  /** `id` ausente/invalido. */
  readonly invalidDropped: number
}

/**
 * Filtra registros de export FAIL-CLOSED. Descarta, em ordem:
 *  1. `id` invalido (`invalidDropped`);
 *  2. `adult === true` (`adultDropped`);
 *  3. `adult` presente e malformado (`unsafeDropped`) — nunca mantido.
 * So sobra na fila quem tem id valido E `adult` seguro (`false`/ausente).
 * Preserva a ordem de entrada dos mantidos.
 */
export function filterAdult(records: readonly IdExportRecord[]): AdultFilterResult {
  const kept: IdExportRecord[] = []
  let adultDropped = 0
  let unsafeDropped = 0
  let invalidDropped = 0

  for (const record of records) {
    if (!hasValidId(record)) {
      invalidDropped += 1
      continue
    }
    const classification = classifyAdult(record.adult)
    if (classification === 'adult') {
      adultDropped += 1
      continue
    }
    if (classification === 'malformed') {
      unsafeDropped += 1
      continue
    }
    kept.push(record)
  }

  return { kept, adultDropped, unsafeDropped, invalidDropped }
}
