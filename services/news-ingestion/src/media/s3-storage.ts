/**
 * s3-storage.ts — Adapter S3-compatible (Cloudflare R2, MinIO, S3).
 *
 * Worker-only. Nenhuma chamada acontece na importacao: o adapter so fala com a
 * rede quando um metodo e invocado, e a suite padrao usa um `fetch` INJETADO —
 * nao ha dependencia de servico externo para os testes passarem.
 *
 * Nao ha bucket nem credencial reais neste repositorio, e nao deve haver.
 */

import type { S3StorageConfig } from './storage-config.js'
import { signS3Request } from './s3-signature.js'
import {
  editorialPublicPath,
  isSafeStorageKey,
  type MediaStoragePort,
  type StoredObject,
} from './storage-port.js'

/** `fetch` injetavel: a suite padrao nunca abre socket. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface S3StorageOptions {
  readonly fetchImpl?: FetchLike
  /** Relogio INJETADO — a assinatura depende do instante. */
  readonly now?: () => string
  readonly requestTimeoutMs?: number
  /** `Cache-Control` do objeto. Midia enderecada por hash e imutavel. */
  readonly cacheControl?: string
}

const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'

/**
 * Mensagem de erro SEM credencial.
 *
 * Um erro do S3 costuma ecoar a URL assinada inteira, e a URL assinada carrega
 * `Credential=` e `Signature=`. Nada disso pode chegar ao log do worker nem ao
 * `lastError` da outbox, que e lido por humanos no painel.
 */
function safeS3Error(operation: string, status: number): Error {
  return new Error(`storage s3: ${operation} respondeu ${String(status)}`)
}

export function createS3MediaStorage(
  config: S3StorageConfig,
  options: S3StorageOptions = {},
): MediaStoragePort {
  const doFetch = options.fetchImpl ?? ((url, init) => fetch(url, init))
  const now = options.now ?? ((): string => new Date().toISOString())
  const timeoutMs = options.requestTimeoutMs ?? 30_000

  async function send(
    method: string,
    key: string,
    payload: Uint8Array,
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    if (!isSafeStorageKey(key)) throw new Error('chave de storage insegura')
    const signed = signS3Request({
      method,
      endpoint: config.endpoint,
      region: config.region,
      bucket: config.bucket,
      key,
      forcePathStyle: config.forcePathStyle,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      nowIso: now(),
      payload,
      extraHeaders,
    })
    return doFetch(signed.url, {
      method: signed.method,
      headers: signed.headers,
      ...(method === 'PUT' ? { body: payload as unknown as BodyInit } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    })
  }

  return {
    async put({ key, bytes, contentType }): Promise<StoredObject> {
      const response = await send('PUT', key, bytes, {
        'content-type': contentType,
        'content-length': String(bytes.length),
        'cache-control': options.cacheControl ?? IMMUTABLE_CACHE,
        // O hash vai como metadado para que uma auditoria futura consiga
        // conferir o objeto sem baixar e reprocessar tudo.
        'x-amz-meta-content-sha256': key.split('/').pop()?.split('.')[0] ?? '',
      })
      // Repetir o mesmo PUT com os mesmos bytes e inofensivo: a chave e
      // derivada do conteudo, entao "sobrescrever" grava byte-a-byte o mesmo
      // arquivo. E o que torna o retry seguro.
      if (!response.ok) throw safeS3Error('PUT', response.status)
      return { key, byteSize: bytes.length, contentType }
    },

    async exists(key): Promise<boolean> {
      const response = await send('HEAD', key, new Uint8Array())
      return response.ok
    },

    async stat(key): Promise<{ byteSize: number } | null> {
      const response = await send('HEAD', key, new Uint8Array())
      if (!response.ok) return null
      const length = Number.parseInt(response.headers.get('content-length') ?? '', 10)
      return { byteSize: Number.isFinite(length) ? length : 0 }
    },

    async read(key): Promise<Uint8Array | null> {
      const response = await send('GET', key, new Uint8Array())
      if (!response.ok) return null
      return new Uint8Array(await response.arrayBuffer())
    },

    async delete(key): Promise<void> {
      const response = await send('DELETE', key, new Uint8Array())
      // 404 ao apagar e sucesso: o objetivo era nao existir.
      if (!response.ok && response.status !== 404) throw safeS3Error('DELETE', response.status)
    },

    publicReference(key): string {
      return editorialPublicPath(key, config.publicBasePath)
    },
  }
}
