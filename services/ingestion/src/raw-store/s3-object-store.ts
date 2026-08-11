/**
 * s3-object-store.ts — Adapter S3-compatible (Cloudflare R2) do
 * {@link RawObjectStore}.
 *
 * O cliente e INJETADO (`S3ClientLike`), como em
 * `services/news-ingestion/src/media/s3-storage.ts`. Duas consequencias:
 * o modulo continua typechecked e testavel sem rede, e o SDK so entra no grafo
 * de quem realmente o monta (o `bin/`), nunca no do render.
 *
 * BUCKET PRIVADO: nada aqui define ACL publica. E payload de terceiro, sujeito
 * aos termos do TMDB — nao e asset publico e nunca ganha URL de leitura direta.
 *
 * O HASH VIAJA NO METADADO (`x-amz-meta-payload-sha256`). `head` devolve o hash
 * sem baixar o corpo — que e como se detecta divergencia de graca (uma Class B
 * por entidade por ciclo, contra baixar megabytes).
 *
 * SANITIZACAO DE ERRO: o erro do SDK carrega `$metadata`, bucket e as vezes a
 * requisicao inteira. Nada disso pode chegar ao log. So `operation` + o nome do
 * erro atravessam, dentro de `RawStoreUnavailableError`.
 */

import type { RawObjectHead, RawObjectStore } from './object-store.js'
import { isSafeRawObjectKey, RawStoreKeyError, RawStoreUnavailableError } from './object-store.js'

/** Nome do metadado que carrega o hash canonico do payload. */
export const PAYLOAD_HASH_METADATA_KEY = 'payload-sha256'

/** Content type dos objetos arquivados. */
export const RAW_OBJECT_CONTENT_TYPE = 'application/json'

/**
 * Subconjunto do `S3Client` que este adapter usa. Injetavel para teste; evita
 * acoplar o modulo puro ao tipo do SDK.
 */
export interface S3ClientLike {
  send(command: unknown): Promise<{
    Body?: { transformToString?: (encoding?: string) => Promise<string> } | null
    ContentLength?: number
    Metadata?: Record<string, string | undefined>
    $metadata?: { httpStatusCode?: number }
  }>
}

/** Construtores de comando do SDK, injetados para manter o modulo puro. */
export interface S3CommandFactories {
  headObject(input: { Bucket: string; Key: string }): unknown
  putObject(input: {
    Bucket: string
    Key: string
    Body: string
    ContentType: string
    ContentLength: number
    Metadata: Record<string, string>
  }): unknown
  getObject(input: { Bucket: string; Key: string }): unknown
  deleteObject(input: { Bucket: string; Key: string }): unknown
}

/** Configuracao do adapter. */
export interface S3RawObjectStoreConfig {
  readonly bucket: string
  readonly client: S3ClientLike
  readonly commands: S3CommandFactories
}

/** True quando o erro do SDK significa "objeto nao existe". */
export function isS3NotFound(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } }
  if (candidate.name === 'NoSuchKey' || candidate.name === 'NotFound') return true
  return candidate.$metadata?.httpStatusCode === 404
}

/** Erro sanitizado: so operacao e nome. Nunca bucket, chave, payload ou header. */
export function safeS3StoreError(operation: string, error: unknown): RawStoreUnavailableError {
  const name =
    error !== null && typeof error === 'object' && typeof (error as { name?: unknown }).name === 'string'
      ? (error as { name: string }).name
      : 'UnknownError'
  return new RawStoreUnavailableError(operation, `falha em ${operation} no object store (${name})`)
}

function assertKey(key: string): void {
  if (!isSafeRawObjectKey(key)) {
    throw new RawStoreKeyError(`chave de objeto insegura: ${JSON.stringify(key)}`)
  }
}

/** Cria o adapter S3-compatible (R2). */
export function createS3RawObjectStore(config: S3RawObjectStoreConfig): RawObjectStore {
  const { bucket, client, commands } = config

  return {
    driver: 'r2',

    async head(key: string): Promise<RawObjectHead | null> {
      assertKey(key)
      try {
        const response = await client.send(commands.headObject({ Bucket: bucket, Key: key }))
        const payloadHash = response.Metadata?.[PAYLOAD_HASH_METADATA_KEY]
        if (typeof payloadHash !== 'string' || payloadHash === '') {
          // Objeto sem hash no metadado: gravado por uma versao anterior ou por
          // outra ferramenta. Tratar como AUSENTE forca a regravacao com o
          // metadado correto — melhor que devolver um hash inventado.
          return null
        }
        return {
          payloadHash,
          byteSize: typeof response.ContentLength === 'number' ? response.ContentLength : 0,
        }
      } catch (error) {
        // Ausencia NAO e indisponibilidade: colapsar as duas faria a ingestao
        // regravar o universo inteiro achando que o bucket esta vazio.
        if (isS3NotFound(error)) return null
        throw safeS3StoreError('head', error)
      }
    },

    async put(input): Promise<RawObjectHead> {
      assertKey(input.key)
      const byteSize = Buffer.byteLength(input.body, 'utf8')
      try {
        await client.send(
          commands.putObject({
            Bucket: bucket,
            Key: input.key,
            Body: input.body,
            ContentType: RAW_OBJECT_CONTENT_TYPE,
            ContentLength: byteSize,
            // Hash e corpo na MESMA escrita: nao existe instante em que um
            // exista sem o outro.
            Metadata: { [PAYLOAD_HASH_METADATA_KEY]: input.payloadHash },
          }),
        )
      } catch (error) {
        throw safeS3StoreError('put', error)
      }
      return { payloadHash: input.payloadHash, byteSize }
    },

    async get(key: string): Promise<string | null> {
      assertKey(key)
      try {
        const response = await client.send(commands.getObject({ Bucket: bucket, Key: key }))
        const body = response.Body
        if (body?.transformToString === undefined) return null
        return await body.transformToString('utf-8')
      } catch (error) {
        if (isS3NotFound(error)) return null
        throw safeS3StoreError('get', error)
      }
    },

    async delete(key: string): Promise<void> {
      assertKey(key)
      try {
        await client.send(commands.deleteObject({ Bucket: bucket, Key: key }))
      } catch (error) {
        // Objeto ausente e sucesso (o estado desejado ja vale).
        if (isS3NotFound(error)) return
        throw safeS3StoreError('delete', error)
      }
    },
  }
}
