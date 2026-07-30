/**
 * s3-storage.ts — Adapter S3-compatible do storage PUBLICO, sobre o SDK oficial.
 *
 * Worker-only. Guarda a copia publicada que o `screen-app` serve — nao o upload
 * original da redacao, que vive no storage do Payload (`PAYLOAD_UPLOAD_*`).
 *
 * POR QUE O SDK, E NAO O SIGNER MANUAL DA FASE 2D. A FASE 2D assinou SigV4 a
 * mao para evitar uma dependencia pesada. O calculo mudou quando o storage de
 * ORIGEM do Payload passou a exigir `@payloadcms/storage-s3`, que ja traz o
 * `@aws-sdk/client-s3`: a dependencia agora existe de qualquer forma, e manter
 * um segundo caminho de autenticacao — validado apenas contra os proprios
 * testes — seria risco sem economia. Autenticacao de storage precisa de
 * referencia independente, e a referencia e o SDK.
 *
 * A interface `MediaStoragePort` nao mudou: os testes de idempotencia, chave
 * determinista e sanitizacao continuam valendo sobre o mesmo contrato.
 *
 * Nao ha bucket, conta ou credencial reais neste repositorio, e nao deve haver.
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'

import type { S3StorageConfig } from './storage-config.js'
import {
  editorialPublicPath,
  isSafeStorageKey,
  type MediaStoragePort,
  type StoredObject,
} from './storage-port.js'

/** Cliente minimo que o adapter usa — permite injetar um duble nos testes. */
export interface S3ClientLike {
  send(command: unknown): Promise<{
    Body?: { transformToByteArray?: () => Promise<Uint8Array> } | null
    ContentLength?: number
    $metadata?: { httpStatusCode?: number }
  }>
}

export interface S3StorageOptions {
  readonly client?: S3ClientLike
  /** `Cache-Control` do objeto. Midia enderecada por hash e imutavel. */
  readonly cacheControl?: string
  readonly requestTimeoutMs?: number
}

const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'

/**
 * Mensagem de erro SEM credencial.
 *
 * Erro do SDK carrega `$metadata`, nome de bucket e as vezes a requisicao
 * inteira. Nada disso pode chegar ao log do worker nem ao `lastError` da
 * outbox, que e lido por humanos no painel do CMS.
 */
function safeS3Error(operation: string, error: unknown): Error {
  const name = error instanceof Error ? error.name : 'desconhecido'
  return new Error(`storage s3: ${operation} falhou (${name})`)
}

/** 404/NoSuchKey nas varias formas em que o SDK e os compativeis reportam. */
function isNotFound(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } }
  if (candidate.name === 'NoSuchKey' || candidate.name === 'NotFound') return true
  return candidate.$metadata?.httpStatusCode === 404
}

export function createS3MediaStorage(
  config: S3StorageConfig,
  options: S3StorageOptions = {},
): MediaStoragePort {
  const client: S3ClientLike =
    options.client ??
    new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      // Path-style: virtual-host exige DNS por bucket, que so a AWS entrega.
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      ...(options.requestTimeoutMs === undefined
        ? {}
        : { requestHandler: { requestTimeout: options.requestTimeoutMs } }),
    })

  const requireSafeKey = (key: string): void => {
    if (!isSafeStorageKey(key)) throw new Error('chave de storage insegura')
  }

  return {
    async put({ key, bytes, contentType }): Promise<StoredObject> {
      requireSafeKey(key)
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: key,
            Body: bytes,
            ContentType: contentType,
            ContentLength: bytes.length,
            CacheControl: options.cacheControl ?? IMMUTABLE_CACHE,
            // O hash vai como metadado para que uma auditoria futura confira o
            // objeto sem baixar e reprocessar tudo.
            Metadata: { 'content-sha256': key.split('/').pop()?.split('.')[0] ?? '' },
          }),
        )
      } catch (error) {
        throw safeS3Error('PUT', error)
      }
      // Repetir o mesmo PUT com os mesmos bytes e inofensivo: a chave e derivada
      // do conteudo, entao "sobrescrever" grava byte-a-byte o mesmo arquivo. E o
      // que torna o retry seguro.
      return { key, byteSize: bytes.length, contentType }
    },

    async exists(key): Promise<boolean> {
      requireSafeKey(key)
      try {
        await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }))
        return true
      } catch (error) {
        if (isNotFound(error)) return false
        throw safeS3Error('HEAD', error)
      }
    },

    async stat(key): Promise<{ byteSize: number } | null> {
      requireSafeKey(key)
      try {
        const result = await client.send(
          new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
        )
        return { byteSize: typeof result.ContentLength === 'number' ? result.ContentLength : 0 }
      } catch (error) {
        if (isNotFound(error)) return null
        throw safeS3Error('HEAD', error)
      }
    },

    async read(key): Promise<Uint8Array | null> {
      requireSafeKey(key)
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }))
        const toBytes = result.Body?.transformToByteArray
        if (toBytes === undefined) return null
        return await toBytes.call(result.Body)
      } catch (error) {
        if (isNotFound(error)) return null
        throw safeS3Error('GET', error)
      }
    },

    async delete(key): Promise<void> {
      requireSafeKey(key)
      try {
        await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }))
      } catch (error) {
        // Objeto ausente ao apagar e sucesso: o objetivo era nao existir.
        if (isNotFound(error)) return
        throw safeS3Error('DELETE', error)
      }
    },

    publicReference(key): string {
      return editorialPublicPath(key, config.publicBasePath)
    },
  }
}
