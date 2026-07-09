/**
 * adult-filter.ts — Exclusao de conteudo adulto na descoberta de IDs. Modulo
 * PURO. DUAS camadas de defesa (sem pornografia/conteudo adulto na fila):
 *   1. os arquivos `adult_*` do TMDB NUNCA sao baixados
 *      (ver `DAILY_ID_EXPORTS` / `ADULT_EXPORT_FILES` em `id-exports.ts`);
 *   2. dentro dos arquivos padrao, todo registro com `adult === true` e
 *      descartado aqui, linha a linha.
 * Esta e a camada 2. E o ponto mais sensivel do P0-00c — falha aqui deixa
 * conteudo adulto entrar na fila.
 */

import type { IdExportRecord } from './id-exports.js'

/**
 * True se o registro esta marcado como conteudo adulto. Estritamente
 * `adult === true` (booleano): ausencia do campo NAO e tratada como adulto, e
 * valores nao-booleanos (string, 1, etc.) tambem nao viram `true` por acidente.
 */
export function isAdultRecord(record: IdExportRecord): boolean {
  return record.adult === true
}

/** True se o registro tem `id` valido (inteiro positivo). */
export function hasValidId(record: IdExportRecord): boolean {
  return Number.isInteger(record.id) && record.id > 0
}

/** Resultado do filtro: mantidos (ordem preservada) + contagem de descartes. */
export interface AdultFilterResult {
  readonly kept: IdExportRecord[]
  readonly adultDropped: number
  readonly invalidDropped: number
}

/**
 * Filtra registros de export: descarta `id` invalido e `adult === true`.
 * Preserva a ordem de entrada dos mantidos. O `id` invalido e checado ANTES do
 * adult (registro sem id nunca vira item de fila), mas ambos contam separado.
 */
export function filterAdult(records: readonly IdExportRecord[]): AdultFilterResult {
  const kept: IdExportRecord[] = []
  let adultDropped = 0
  let invalidDropped = 0

  for (const record of records) {
    if (!hasValidId(record)) {
      invalidDropped += 1
      continue
    }
    if (isAdultRecord(record)) {
      adultDropped += 1
      continue
    }
    kept.push(record)
  }

  return { kept, adultDropped, invalidDropped }
}
