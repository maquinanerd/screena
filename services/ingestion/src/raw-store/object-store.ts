/**
 * object-store.ts — Contrato do armazenamento de OBJETOS do payload bruto do
 * TMDB, mais a derivacao de chave. Modulo PURO (sem rede, sem SDK).
 *
 * POR QUE ISTO EXISTE: o disco do Postgres do EasyPanel e EMPRESTADO. Nada do
 * TMDB pode crescer nele. `tmdb_raw.payload` e `jsonb` — cada payload arquivado
 * ocupa aquele disco para sempre. Este contrato permite mover o BLOB para um
 * object store (R2/S3-compatible) sem que a ingestao saiba onde ele mora.
 *
 * PRECEDENTE: espelha deliberadamente `MediaStoragePort`
 * (`services/news-ingestion/src/media/storage-port.ts`), que ja resolveu este
 * mesmo problema para a midia editorial: contrato minimo, chave deterministica,
 * dois adapters, mesma suite de contrato nos dois. Cada operacao a mais e uma
 * superficie a mais para o adapter remoto divergir do local.
 *
 * DIFERENCA relevante: aqui a chave vem da IDENTIDADE da entidade
 * (`tmdb/{entity_type}/{id}.json`), nao do hash do conteudo. Chave por conteudo
 * daria deduplicacao, mas o reprocessamento passaria a depender de um indice
 * `tmdbId -> hash` que dessincroniza. Com chave por identidade, quem sabe o id
 * sabe a chave — e reprocessar nunca depende de nada alem do id.
 */

/** Tipos de entidade cujo bruto o piloto arquiva. */
export const RAW_OBJECT_KINDS = ['movie', 'tv', 'person'] as const

/** Um tipo de entidade arquivavel. */
export type RawObjectKind = (typeof RAW_OBJECT_KINDS)[number]

/** Prefixo raiz de tudo que vem do TMDB. Separa de qualquer outro uso do bucket. */
export const RAW_OBJECT_PREFIX = 'tmdb'

/** Erro de chave: identidade que este store nao pode representar sem ambiguidade. */
export class RawStoreKeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RawStoreKeyError'
  }
}

/**
 * Erro de INDISPONIBILIDADE do store (rede, credencial, bucket fora do ar).
 *
 * Distinto de um erro de UM objeto: indisponibilidade significa que continuar o
 * lote so produz mais falhas e mais cota queimada. Quem orquestra deve ABORTAR
 * ao ve-lo — nunca contar como "item falhou" e seguir em frente.
 */
export class RawStoreUnavailableError extends Error {
  /** Operacao que falhou (`head`/`put`/`get`), para diagnostico. */
  readonly operation: string

  constructor(operation: string, message: string) {
    super(message)
    this.name = 'RawStoreUnavailableError'
    this.operation = operation
  }
}

/** True quando o erro sinaliza store indisponivel (detecta ESTRUTURALMENTE). */
export function isRawStoreUnavailableError(error: unknown): boolean {
  if (error instanceof RawStoreUnavailableError) return true
  if (error === null || typeof error !== 'object') return false
  return (error as { name?: unknown }).name === 'RawStoreUnavailableError'
}

/** Metadados de um objeto arquivado, sem baixar o corpo. */
export interface RawObjectHead {
  /** SHA-256 hex da serializacao canonica do payload. */
  readonly payloadHash: string
  /** Tamanho em bytes do corpo gravado. */
  readonly byteSize: number
}

/**
 * Contrato do store de objetos.
 *
 * `head` devolve `null` quando o objeto nao existe — ausencia NAO e erro. Um
 * erro de transporte precisa chegar como `RawStoreUnavailableError`, jamais
 * como `null`: colapsar "nao existe" com "nao consegui perguntar" faria a
 * ingestao regravar o universo inteiro achando que o bucket esta vazio.
 */
export interface RawObjectStore {
  /** Metadados sem baixar o corpo. `null` = objeto ausente. */
  head(key: string): Promise<RawObjectHead | null>
  /** Grava (ou sobrescreve) o objeto. Idempotente para a mesma chave. */
  put(input: {
    readonly key: string
    readonly body: string
    readonly payloadHash: string
  }): Promise<RawObjectHead>
  /** Le o corpo. `null` = objeto ausente. */
  get(key: string): Promise<string | null>
  /** SO para limpeza governada. Nunca no caminho de sync. */
  delete(key: string): Promise<void>
  /** Nome do driver, para relatorio/diagnostico. Nunca expoe bucket nem URL. */
  readonly driver: string
}

/**
 * Chave deterministica de um payload bruto: `tmdb/{entity_type}/{id}.json`.
 *
 * Derivavel a partir do id e so dele. Nada de UUID: o dia em que a chave
 * depender de um indice, o reprocessamento passa a depender daquele indice
 * estar sincronizado — e ele nao estara.
 */
export function rawObjectKey(kind: RawObjectKind, tmdbId: number): string {
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    throw new RawStoreKeyError(`tmdbId invalido para chave de objeto: ${String(tmdbId)}`)
  }
  return `${RAW_OBJECT_PREFIX}/${kind}/${tmdbId}.json`
}

/**
 * Validacao defensiva da chave, espelhando `isSafeStorageKey` da midia
 * editorial: nada de raiz absoluta, barra invertida, byte nulo, `.`/`..` ou
 * caractere fora do conjunto seguro. Uma chave gerada por
 * {@link rawObjectKey} sempre passa; a validacao existe para o dia em que
 * alguem passar uma chave vinda de fora.
 */
export function isSafeRawObjectKey(key: string): boolean {
  if (key === '' || key.length > 200) return false
  if (key.startsWith('/') || key.includes('\\') || key.includes('\0')) return false
  if (!/^[a-z0-9/._-]+$/.test(key)) return false
  return !key.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
}

/** Parseia uma chave de volta para (kind, tmdbId); `null` se nao for nossa. */
export function parseRawObjectKey(
  key: string,
): { readonly kind: RawObjectKind; readonly tmdbId: number } | null {
  const match = /^tmdb\/([a-z]+)\/(\d+)\.json$/.exec(key)
  if (match === null) return null
  const kind = match[1] as RawObjectKind
  if (!(RAW_OBJECT_KINDS as readonly string[]).includes(kind)) return null
  const tmdbId = Number(match[2])
  return Number.isSafeInteger(tmdbId) && tmdbId > 0 ? { kind, tmdbId } : null
}
