/**
 * adult-filter.ts — Exclusao de conteudo adulto na descoberta de IDs. Modulo
 * PURO. DUAS camadas de defesa (sem pornografia/conteudo adulto na fila):
 *   1. os arquivos `adult_*` do TMDB NUNCA sao baixados
 *      (ver `DAILY_ID_EXPORTS` / `ADULT_EXPORT_FILES` em `id-exports.ts`);
 *   2. dentro dos arquivos padrao, o campo `adult` e classificado FAIL-CLOSED,
 *      linha a linha, aqui.
 * Esta e a camada 2. E o ponto mais sensivel do P0-00c.
 *
 * FAIL-CLOSED: so `adult === false` (ou o campo ausente EM EXPORT QUE NAO O
 * FORNECE) conta como seguro. Um `adult` presente porem malformado (string
 * `"true"`, numero `1`, `null`, objeto, array...) NUNCA e presumido seguro — vai
 * para `unsafeDropped`. E, em exports que DEVERIAM trazer `adult` (movie/person),
 * a AUSENCIA do campo tambem e tratada como unsafe (anomalia, ex.: linha
 * truncada). So confiamos num booleano de verdade quando o export o fornece.
 */

import type { IdExportRecord } from './id-exports.js'

/** Classificacao do campo `adult` de um registro. */
export type AdultClassification = 'safe' | 'adult' | 'malformed'

/**
 * Classifica o campo `adult` de forma FAIL-CLOSED:
 *  - `true`   -> `'adult'`     (conteudo adulto explicito);
 *  - `false`  -> `'safe'`      (permitido);
 *  - ausente (`undefined`) -> `'safe'` SE o export nao fornece o campo
 *    (`adultFieldRequired = false`, ex.: collection/network/company/keyword);
 *    `'malformed'` SE o export deveria fornecer (`adultFieldRequired = true`,
 *    ex.: movie/person) — ausencia vira anomalia, nao "seguro";
 *  - qualquer OUTRO valor presente (`"true"`, `"false"`, `1`, `0`, `null`,
 *    objeto, array...) -> `'malformed'` (nunca tratado como seguro).
 */
export function classifyAdult(adult: unknown, adultFieldRequired = false): AdultClassification {
  if (adult === true) return 'adult'
  if (adult === false) return 'safe'
  if (adult === undefined) return adultFieldRequired ? 'malformed' : 'safe'
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
  /** `adult` malformado, ou ausente num export que deveria traze-lo (fail-closed). */
  readonly unsafeDropped: number
  /** `id` ausente/invalido. */
  readonly invalidDropped: number
}

/** Opcoes do filtro de adult. */
export interface FilterAdultOptions {
  /**
   * Se o export deste tipo traz `adult` por linha (movie/person). Quando `true`,
   * um registro SEM `adult` vai para `unsafeDropped` (fail-closed: a ausencia e
   * anomalia, nunca presumida segura). Default `false` (collection/network/
   * company/keyword: ausencia e legitima e segura).
   */
  readonly adultFieldRequired?: boolean
}

/**
 * Filtra registros de export FAIL-CLOSED. Descarta, em ordem:
 *  1. `id` invalido (`invalidDropped`);
 *  2. `adult === true` (`adultDropped`);
 *  3. `adult` malformado — ou ausente quando `adultFieldRequired` — (`unsafeDropped`).
 * So sobra na fila quem tem id valido E `adult` classificado `'safe'`.
 * Preserva a ordem de entrada dos mantidos.
 */
export function filterAdult(
  records: readonly IdExportRecord[],
  options: FilterAdultOptions = {},
): AdultFilterResult {
  const adultFieldRequired = options.adultFieldRequired ?? false
  const kept: IdExportRecord[] = []
  let adultDropped = 0
  let unsafeDropped = 0
  let invalidDropped = 0

  for (const record of records) {
    if (!hasValidId(record)) {
      invalidDropped += 1
      continue
    }
    const classification = classifyAdult(record.adult, adultFieldRequired)
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
