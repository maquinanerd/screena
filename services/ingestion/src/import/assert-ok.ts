/**
 * import/assert-ok.ts — Converte o `ImportResult` pipeline-safe em excecao.
 *
 * A orquestracao de import NUNCA relanca (um titulo nao derruba o pipeline):
 * ela devolve `status: 'failed' | 'aborted'` com a causa em campos. Quem roda
 * dentro da FILA precisa do contrario — o worker so sabe decidir
 * retry/dead-letter olhando uma excecao. Este modulo e essa fronteira.
 *
 * Ela e o ponto onde a causa mais facilmente se perde, e ja se perdeu: o
 * embrulho guardava o STATUS do import (`'failed'`) na propriedade `code`, que e
 * exatamente por onde `classifySafeError` e `toSafeError` classificam. Resultado
 * medido em 25/08/2026: 7.076 jobs com `last_error_code: 'failed'` e
 * `error_class: "unknown"` — o codigo verdadeiro (`P2003`, `ECONNRESET`, 429)
 * existia e era descartado uma funcao antes de ser gravado.
 *
 * PURO: sem IO, sem relogio, sem rede.
 */

import { PermanentJobError } from '../catalog-jobs/handler.js'
import type { DetailSyncOutcome } from '../catalog-jobs/handlers/ports.js'
import { refusalErrorCode } from '../persistence/admission.js'
import type { ImportResult } from './types.js'

/** Erro transitorio de um servico pipeline-safe que reportou falha. */
export class CatalogServiceError extends Error {
  /**
   * CAUSA REAL (`P2003`, `ECONNRESET`, `TmdbHttpError`), nao o status do import.
   *
   * `classifySafeError` e `toSafeError` classificam por `code`. Enquanto esta
   * propriedade guardava `'failed'`, toda falha de import chegava a metrica como
   * `error_class: "unknown"` e ao banco como `last_error_code: 'failed'`.
   */
  readonly code: string
  /** Status do import (`failed`/`aborted`), preservado sem disputar `code`. */
  readonly importStatus: string
  /**
   * Status HTTP, quando o erro de origem carregava um.
   *
   * O nome `status` fica reservado ao HTTP porque e assim que
   * `classifySafeError` o le (`readNumber(error, 'status')`). Por isso o status
   * do import mora em `importStatus`: os dois no mesmo nome fariam um 429 do
   * TMDB ser classificado como `unknown`.
   */
  readonly status?: number

  constructor(
    operation: string,
    importStatus: string,
    detail?: string,
    code?: string,
    status?: number,
  ) {
    super(`${operation} falhou (${importStatus})${detail ? `: ${detail}` : ''}`)
    this.name = 'CatalogServiceError'
    this.importStatus = importStatus
    this.code = code !== undefined && code !== '' ? code : importStatus
    if (status !== undefined) this.status = status
  }
}

/**
 * O upstream respondeu "esta entidade nao existe"? So entao a falha e PERMANENTE.
 *
 * O status estruturado decide quando existe. A varredura de texto sobrou como
 * ultimo recurso para erro sem status, e ela NAO roda quando o codigo e de banco
 * (`P####`): a mensagem do Prisma cita os argumentos da query, e um titulo
 * contendo "404" mandaria para dead-letter PERMANENTE um job cuja falha e de
 * escrita e seria resolvida por retry.
 */
export function isUpstreamNotFound(result: ImportResult): boolean {
  if (result.errorStatus !== undefined) return result.errorStatus === 404
  if (result.errorCode !== undefined && /^P\d{4}$/.test(result.errorCode)) return false
  return /\b404\b|not[_ ]?found/i.test(String(result.error ?? ''))
}

/**
 * Converte o `ImportResult` pipeline-safe em excecao quando falhou.
 *
 * `aborted` e `failed` viram throw: o worker decide retry/dead-letter. Um 404
 * (entidade nao existe upstream) e PERMANENTE — repetir devolve o mesmo 404.
 */
export function assertImportOk(result: ImportResult, operation: string): ImportResult {
  if (result.status === 'success') return result
  const detail = result.error ?? 'unknown'
  if (isUpstreamNotFound(result)) {
    throw new PermanentJobError('upstream_not_found', `${operation}: ${detail}`)
  }
  throw new CatalogServiceError(
    operation,
    result.status,
    result.error,
    result.errorCode,
    result.errorStatus,
  )
}

/**
 * O desfecho de fila de um titulo RECUSADO pela porta do catalogo — ou `null`
 * quando o import nao foi recusado.
 *
 * ============================================================================
 * RECUSA NAO E FALHA
 * ============================================================================
 * Ate 24/09/2026 a recusa de idioma chegava aqui como `status: 'empty'` e
 * `assertImportOk` a convertia em `CatalogServiceError`. O worker via uma
 * excecao TRANSITORIA, tentava de novo 5 vezes e o job morria em dead_letter
 * com `last_error_code: 'empty'` — 12.993 jobs em 7 dias. As tentativas 2 a 5
 * liam o `api_cache` (sem gastar TMDB), mas cada uma gravava mais uma linha
 * `empty` em `api_sync_logs` e o dead_letter virava um monte de decisao
 * editorial soterrando as falhas de verdade.
 *
 * Recusa e a regra funcionando: repetir devolve a MESMA recusa. O job conclui
 * na primeira tentativa como PULADO (`skipped`, com o codigo da recusa no
 * motivo), sem enfileirar dependentes — nao ha entidade dona para eles. A linha
 * `empty` + `language_not_allowed:xx` em `api_sync_logs` continua, escrita UMA
 * vez pelo proprio import.
 *
 * DISCRIMINA PELO CAMPO `refused`, NUNCA pela string `'empty'`: `empty` e um
 * status de sync generico. Um `empty` sem `refused` nao e recusa e segue
 * exatamente o caminho de antes (`assertImportOk` -> excecao -> retry).
 */
export function refusedDetailOutcome(result: ImportResult): DetailSyncOutcome | null {
  if (result.refused === undefined) return null
  return {
    created: false,
    updated: false,
    unchanged: false,
    entityId: null,
    skipped: true,
    skipReason: `titulo recusado pelo recorte de idioma (${refusalErrorCode(result.refused)})`,
    watchOutcome: result.watch.outcome,
    watchOffers: 0,
  }
}
