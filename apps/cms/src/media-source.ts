/**
 * media-source.ts — Leitura dos uploads ORIGINAIS do Payload.
 *
 * O endpoint interno de midia precisa entregar bytes ao worker sem saber ONDE o
 * arquivo mora. Na FASE 2D ele lia direto do disco; isso funciona em
 * desenvolvimento e morre no primeiro deploy com volume ou bucket.
 *
 * Esta porta e a resposta: `local` e `s3` implementam o mesmo contrato, o
 * endpoint conhece so o contrato, e trocar o driver NAO muda o
 * `publication-event-v1`, o hash entregue, nem a referencia publica final.
 *
 * O que NUNCA atravessa para o chamador: caminho absoluto, nome de bucket,
 * endpoint, credencial ou URL assinada.
 */

import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import type { PayloadS3UploadConfig, PayloadUploadConfig } from './upload-storage-config.js'

export interface MediaObjectInfo {
  readonly byteSize: number
  readonly contentType: string | null
}

export interface PayloadMediaSource {
  exists(filename: string): Promise<boolean>
  stat(filename: string): Promise<MediaObjectInfo | null>
  read(filename: string, maxBytes: number): Promise<Uint8Array | null>
  /**
   * Referencia SEGURA para log e diagnostico.
   *
   * Deliberadamente NAO e o caminho nem a URL: e o driver mais o nome do
   * arquivo. Um log de erro que imprime `/var/lib/cinerie/uploads/...` ou
   * `https://<conta>.r2.cloudflarestorage.com/...` entrega topologia de
   * infraestrutura a quem estiver lendo o painel.
   */
  sourceReference(filename: string): string
  /** Driver ativo — para readiness, sem revelar configuracao. */
  readonly driver: PayloadUploadConfig['driver']
}

/* ------------------------------------------------------------------ */
/* Nome de arquivo                                                     */
/* ------------------------------------------------------------------ */

/**
 * Normaliza o nome vindo do upload.
 *
 * `path.basename` descarta qualquer componente de caminho: `../../etc/passwd`
 * vira `passwd`. E a unica defesa que importa aqui, porque o nome e escolhido
 * por quem envia o arquivo.
 */
export function safeUploadName(filename: string): string | null {
  const base = path.basename(filename.trim())
  if (base === '' || base === '.' || base === '..') return null
  if (base.includes('\0')) return null
  return base
}

/* ------------------------------------------------------------------ */
/* Adapter local                                                       */
/* ------------------------------------------------------------------ */

export function createLocalMediaSource(root: string): PayloadMediaSource {
  const resolvedRoot = path.resolve(root)

  const fullPath = (filename: string): string | null => {
    const safe = safeUploadName(filename)
    if (safe === null) return null
    const target = path.resolve(resolvedRoot, safe)
    // Cinto e suspensorio: `basename` ja impede subir de diretorio, mas ler
    // fora da raiz do storage e grave demais para depender de uma checagem so.
    if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) return null
    return target
  }

  return {
    driver: 'local',
    async exists(filename) {
      const target = fullPath(filename)
      if (target === null) return false
      try {
        await stat(target)
        return true
      } catch {
        return false
      }
    },
    async stat(filename) {
      const target = fullPath(filename)
      if (target === null) return null
      try {
        const info = await stat(target)
        return { byteSize: info.size, contentType: null }
      } catch {
        return null
      }
    },
    async read(filename, maxBytes) {
      const target = fullPath(filename)
      if (target === null) return null
      try {
        const info = await stat(target)
        // Checa o tamanho ANTES de ler: carregar 2 GB na memoria para depois
        // descobrir que passou do limite nao ajuda ninguem.
        if (info.size > maxBytes) return null
        const bytes = new Uint8Array(await readFile(target))
        return bytes.length === 0 ? null : bytes
      } catch {
        return null
      }
    },
    sourceReference(filename) {
      return `local:${safeUploadName(filename) ?? 'invalido'}`
    },
  }
}

/* ------------------------------------------------------------------ */
/* Adapter S3-compatible (SDK oficial)                                 */
/* ------------------------------------------------------------------ */

/** Cliente minimo que o adapter usa — permite injetar um duble nos testes. */
export interface S3GetObjectClient {
  send(command: unknown): Promise<{
    Body?: { transformToByteArray?: () => Promise<Uint8Array> } | null
    ContentLength?: number
    ContentType?: string
  }>
}

export interface S3CommandFactory {
  getObject(input: { Bucket: string; Key: string }): unknown
  headObject(input: { Bucket: string; Key: string }): unknown
}

/**
 * Adapter S3 sobre o SDK OFICIAL.
 *
 * A assinatura de requisicao e responsabilidade do `@aws-sdk/client-s3` — nao
 * ha SigV4 escrito a mao neste caminho. Autenticacao de storage e exatamente o
 * tipo de codigo que nao se valida contra os proprios testes.
 */
export function createS3MediaSource(
  config: PayloadS3UploadConfig,
  client: S3GetObjectClient,
  commands: S3CommandFactory,
): PayloadMediaSource {
  const keyFor = (filename: string): string | null => {
    const safe = safeUploadName(filename)
    if (safe === null) return null
    const prefix = config.prefix.replace(/^\/+|\/+$/g, '')
    return prefix === '' ? safe : `${prefix}/${safe}`
  }

  return {
    driver: 's3',
    async exists(filename) {
      const key = keyFor(filename)
      if (key === null) return false
      try {
        await client.send(commands.headObject({ Bucket: config.bucket, Key: key }))
        return true
      } catch {
        return false
      }
    },
    async stat(filename) {
      const key = keyFor(filename)
      if (key === null) return null
      try {
        const result = await client.send(commands.headObject({ Bucket: config.bucket, Key: key }))
        return {
          byteSize: typeof result.ContentLength === 'number' ? result.ContentLength : 0,
          contentType: typeof result.ContentType === 'string' ? result.ContentType : null,
        }
      } catch {
        return null
      }
    },
    async read(filename, maxBytes) {
      const key = keyFor(filename)
      if (key === null) return null
      try {
        const result = await client.send(commands.getObject({ Bucket: config.bucket, Key: key }))
        // `ContentLength` declarado acima do teto: nem comeca a transferir.
        if (typeof result.ContentLength === 'number' && result.ContentLength > maxBytes) {
          return null
        }
        const toBytes = result.Body?.transformToByteArray
        if (toBytes === undefined) return null
        const bytes = await toBytes.call(result.Body)
        // E o teto REAL, sobre os bytes que chegaram: `ContentLength` e uma
        // declaracao, nao uma garantia.
        if (bytes.length === 0 || bytes.length > maxBytes) return null
        return bytes
      } catch {
        return null
      }
    },
    sourceReference(filename) {
      // Sem bucket, sem endpoint, sem prefixo: so o driver e o nome.
      return `s3:${safeUploadName(filename) ?? 'invalido'}`
    },
  }
}
