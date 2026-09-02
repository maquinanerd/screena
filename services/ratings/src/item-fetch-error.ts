/**
 * item-fetch-error.ts — diagnostico SANITIZADO de falha ao buscar um item.
 *
 * ============================================================================
 * POR QUE ESTE ARQUIVO EXISTE
 * ============================================================================
 * Ele nasceu dentro de `film-show-ratings/run.ts`, o worker do fornecedor
 * RapidAPI que foi REMOVIDO em 2026-09-02. Mas o codigo aqui nunca foi sobre
 * aquele fornecedor: ele traduz um erro de rede/HTTP em texto seguro para
 * relatorio e log, e o worker da OMDb — que continua vivo e e o unico provedor
 * ATIVO de notas — sempre dependeu dele.
 *
 * Extrair em vez de duplicar: `describeItemFetchError` e a UNICA razao pela qual
 * uma falha de rede consegue chegar a `api_sync_logs` com causa em vez de NULL.
 * Duas copias divergiriam no primeiro conserto, e a que ficasse para tras
 * silenciaria justamente o worker que produz.
 *
 * ============================================================================
 * O QUE ELE GARANTE
 * ============================================================================
 * NUNCA vaza a chave, a URL nem o host. O detalhe carrega id, status HTTP e o
 * NOME da classe do erro — nunca a mensagem crua do provider, que pode conter a
 * querystring inteira (e a OMDb manda a chave em query).
 */

import { isCircuitOpenError, statusOf } from '@screena/rapidapi-core'

/**
 * Falhas de rede/HTTP CONSECUTIVAS que interrompem o lote de candidatos.
 *
 * Sem isso, um upstream degradado (429 em rajada, 5xx sistemico) faz o worker
 * varrer TODOS os candidatos, cada um com os retries do core — "queimar quota em
 * loop". Ao 3o id seguido que falha, paramos e reportamos os ids nao consultados.
 * Um unico sucesso zera o contador: uma falha isolada no meio do lote nao aborta.
 */
export const MAX_CONSECUTIVE_ITEM_FAILURES = 3

/** Diagnostico SANITIZADO de uma falha de busca de item (nunca vaza a chave). */
export interface ItemFetchErrorInfo {
  /** Detalhe legivel para o relatorio: id + status/nome do erro, sem URL/chave. */
  readonly detail: string
  /** Status HTTP do provider quando disponivel (403/429/500...), senao `null`. */
  readonly httpStatus: number | null
  /** O erro sinaliza circuito aberto (fonte degradada pelo core)? */
  readonly circuitOpen: boolean
  /** Nome da classe do erro (`RapidApiHttpError`, `Error`...), nunca a mensagem crua. */
  readonly errorCode: string
}

/**
 * Trecho do corpo de um erro HTTP, seguro para o relatorio: sem URL, sem host,
 * colapsado e limitado. O corpo do `RapidApiHttpError` ja vem truncado e NUNCA
 * contem a chave (ela viaja so em header); mas o corpo e da RESPOSTA do upstream
 * (controlado por terceiros) e pode citar o proprio host — por isso redigimos
 * URLs completas, referencias protocol-relative (`//host`) e hostnames crus
 * (`sub.dominio.tld`) antes de limitar o tamanho. Assim o relatorio nunca carrega
 * URL/host, so a mensagem util.
 */
export function sanitizeErrorBody(error: unknown): string | null {
  const raw = (error as { body?: unknown }).body
  if (typeof raw !== 'string') return null
  const cleaned = raw
    // URL completa (http/https). Vem primeiro: consome o `//host` embutido.
    .replace(/https?:\/\/\S+/gi, '[url]')
    // Referencia protocol-relative: `//host/...` sem esquema.
    .replace(/\/\/[^\s"'<>]+/g, '[url]')
    // Hostname/dominio cru (`film-show-ratings.p.rapidapi.com[/path]`). O TLD
    // exige letras, entao numeros de versao/nota (`9.5`, `1.2.3`) sobrevivem.
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b(?:\/\S*)?/gi, '[host]')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned === '') return null
  return cleaned.length > 140 ? `${cleaned.slice(0, 140)}…` : cleaned
}

/**
 * Nome de classe do erro sem o prefixo tecnico do provider (`RapidApi`): o
 * relatorio ganha um rotulo util (`HttpError`, `CircuitOpenError`) sem repetir o
 * marcador do fornecedor no artefato. `Error` e demais nomes ficam intactos.
 */
export function normalizeErrorCode(name: string): string {
  return name.startsWith('RapidApi') ? name.slice('RapidApi'.length) : name
}

/**
 * Descreve uma falha de `fetchItem` para o relatorio, expondo o STATUS HTTP
 * (403/429/500...) em vez de esconde-lo atras de um `RapidApiHttpError` opaco.
 *
 * PURO e sem segredo: usa so `error.name`, o status numerico, a flag `permanent`
 * e um trecho do corpo ja sanitizado. Nunca cita a URL, o host ou a chave.
 */
export function describeItemFetchError(error: unknown, id: string): ItemFetchErrorInfo {
  const errorCode = normalizeErrorCode(error instanceof Error ? error.name : 'UnknownError')

  if (isCircuitOpenError(error)) {
    return {
      detail: `id ${id}: circuito do provider aberto (fonte degradada); consulta suspensa.`,
      httpStatus: null,
      circuitOpen: true,
      errorCode,
    }
  }

  const httpStatus = statusOf(error)
  if (httpStatus !== null) {
    const permanent = (error as { permanent?: unknown }).permanent === true
    const kind = permanent ? 'permanente (nao retentavel)' : 'transitorio'
    const body = sanitizeErrorBody(error)
    return {
      detail: `id ${id}: HTTP ${httpStatus} ${kind} (${errorCode})${body !== null ? ` — ${body}` : ''}.`,
      httpStatus,
      circuitOpen: false,
      errorCode,
    }
  }

  // Rede/timeout/abort: sem status. Mantem a mensagem historica (id + nome).
  return {
    detail: `id ${id}: falha de rede/HTTP (${errorCode}).`,
    httpStatus: null,
    circuitOpen: false,
    errorCode,
  }
}
