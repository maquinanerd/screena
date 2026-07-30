/**
 * media-source.test.ts — Storage de ORIGEM dos uploads do Payload.
 *
 * A tese sob teste: **trocar o driver nao muda nada para quem consome**. O
 * endpoint interno entrega os MESMOS bytes, e portanto o mesmo hash, a mesma
 * referencia publica e o mesmo `publication-event-v1`, venha o arquivo de disco
 * ou de um bucket.
 *
 * O adapter S3 e exercitado com um duble do cliente: a suite nao abre socket,
 * nao precisa de bucket e nao depende de servico externo.
 */

import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import {
  createLocalMediaSource,
  createS3MediaSource,
  safeUploadName,
  type S3CommandFactory,
  type S3GetObjectClient,
} from '../media-source.js'
import type { PayloadS3UploadConfig } from '../upload-storage-config.js'

const FILE_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0x01, 0x02, 0x03])
const FILE_NAME = 'capa-editorial.jpg'
const MAX = 15 * 1024 * 1024

const roots: string[] = []
function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'cinerie-upload-'))
  roots.push(root)
  return root
}
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

const s3Config: PayloadS3UploadConfig = {
  driver: 's3',
  endpoint: 'https://exemplo.r2.cloudflarestorage.com',
  region: 'auto',
  bucket: 'cinerie-cms',
  accessKeyId: 'AKIA-TESTE',
  secretAccessKey: 'segredo-de-teste-nao-real',
  forcePathStyle: true,
  prefix: 'cms-uploads',
}

/** Duble do S3: registra os comandos e devolve o arquivo pedido. */
function s3Double(behavior: 'ok' | 'missing' | 'oversized' | 'credentials' = 'ok') {
  const calls: { name: string; input: { Bucket: string; Key: string } }[] = []
  const commands: S3CommandFactory = {
    getObject: (input) => ({ name: 'GetObject', input }),
    headObject: (input) => ({ name: 'HeadObject', input }),
  }
  const client: S3GetObjectClient = {
    async send(command) {
      const wrapped = command as { name: string; input: { Bucket: string; Key: string } }
      calls.push(wrapped)
      if (behavior === 'missing') throw Object.assign(new Error('sem chave'), { name: 'NoSuchKey' })
      if (behavior === 'credentials') {
        throw Object.assign(new Error('assinatura invalida'), { name: 'InvalidAccessKeyId' })
      }
      if (behavior === 'oversized') {
        return { ContentLength: MAX + 1, ContentType: 'image/jpeg' }
      }
      return {
        ContentLength: FILE_BYTES.length,
        ContentType: 'image/jpeg',
        Body: { transformToByteArray: async () => FILE_BYTES },
      }
    },
  }
  return { source: createS3MediaSource(s3Config, client, commands), calls }
}

describe('nome de upload', () => {
  it('descarta componente de caminho — o nome vem de quem envia', () => {
    expect(safeUploadName('../../etc/passwd')).toBe('passwd')
    expect(safeUploadName('C:/Windows/system32/x.jpg')).toBe('x.jpg')
    expect(safeUploadName('foto.jpg')).toBe('foto.jpg')
  })
})

describe('adapter local', () => {
  const root = tempRoot()
  writeFileSync(path.join(root, FILE_NAME), FILE_BYTES)
  const source = createLocalMediaSource(root)

  it('le o arquivo e reporta tamanho', async () => {
    expect(await source.exists(FILE_NAME)).toBe(true)
    expect(await source.stat(FILE_NAME)).toEqual({ byteSize: FILE_BYTES.length, contentType: null })
    expect(Array.from((await source.read(FILE_NAME, MAX)) ?? [])).toEqual(Array.from(FILE_BYTES))
  })

  it('arquivo inexistente vira `null`, nao excecao', async () => {
    expect(await source.exists('nao-existe.jpg')).toBe(false)
    expect(await source.stat('nao-existe.jpg')).toBeNull()
    expect(await source.read('nao-existe.jpg', MAX)).toBeNull()
  })

  it('recusa ler FORA da raiz do storage', async () => {
    // `basename` ja impede subir de diretorio; a checagem de raiz e a segunda
    // barreira, porque ler fora da raiz e grave demais para depender de uma so.
    expect(await source.read('../../etc/passwd', MAX)).toBeNull()
    expect(await source.exists('/etc/passwd')).toBe(false)
  })

  it('recusa arquivo ACIMA do limite antes de carregar na memoria', async () => {
    expect(await source.read(FILE_NAME, 2)).toBeNull()
  })

  it('a referencia de diagnostico NAO revela o caminho', async () => {
    // Um log com `/var/lib/cinerie/uploads/...` entrega topologia da infra.
    const reference = source.sourceReference(FILE_NAME)
    expect(reference).toBe(`local:${FILE_NAME}`)
    expect(reference).not.toContain(root)
  })
})

describe('adapter S3-compatible', () => {
  it('le pelo bucket e prefixo configurados', async () => {
    const { source, calls } = s3Double()
    const bytes = await source.read(FILE_NAME, MAX)
    expect(Array.from(bytes ?? [])).toEqual(Array.from(FILE_BYTES))
    expect(calls[0]?.input.Bucket).toBe('cinerie-cms')
    // Prefixo PROPRIO do CMS: compartilhar bucket com o storage publico e
    // aceitavel, compartilhar prefixo nao.
    expect(calls[0]?.input.Key).toBe(`cms-uploads/${FILE_NAME}`)
  })

  it('objeto inexistente vira `null`', async () => {
    const { source } = s3Double('missing')
    expect(await source.exists(FILE_NAME)).toBe(false)
    expect(await source.read(FILE_NAME, MAX)).toBeNull()
  })

  it('credencial invalida vira `null`, sem vazar o erro do SDK', async () => {
    const { source } = s3Double('credentials')
    // O endpoint responde "sem bytes"; o erro do SDK (que carrega bucket e
    // metadados da requisicao) nao atravessa para o chamador.
    expect(await source.read(FILE_NAME, MAX)).toBeNull()
  })

  it('recusa objeto declarado ACIMA do limite sem transferir', async () => {
    const { source } = s3Double('oversized')
    expect(await source.read(FILE_NAME, MAX)).toBeNull()
  })

  it('a referencia de diagnostico NAO revela bucket nem endpoint', () => {
    const { source } = s3Double()
    const reference = source.sourceReference(FILE_NAME)
    expect(reference).toBe(`s3:${FILE_NAME}`)
    expect(reference).not.toContain('cinerie-cms')
    expect(reference).not.toContain('cloudflarestorage')
  })
})

describe('trocar o driver NAO muda o resultado', () => {
  it('local e s3 entregam os MESMOS bytes e o mesmo hash', async () => {
    // Esta e a tese da abstracao: o `publication-event-v1`, o hash conferido
    // pelo worker e a referencia publica final independem de onde o arquivo
    // original mora.
    const root = tempRoot()
    writeFileSync(path.join(root, FILE_NAME), FILE_BYTES)
    const local = createLocalMediaSource(root)
    const { source: remote } = s3Double()

    const fromLocal = await local.read(FILE_NAME, MAX)
    const fromS3 = await remote.read(FILE_NAME, MAX)

    expect(fromLocal).not.toBeNull()
    expect(fromS3).not.toBeNull()
    expect(Array.from(fromLocal ?? [])).toEqual(Array.from(fromS3 ?? []))
    expect(sha256(fromLocal ?? new Uint8Array())).toBe(sha256(fromS3 ?? new Uint8Array()))
  })

  it('so o DRIVER aparece na referencia — nunca a topologia', async () => {
    const root = tempRoot()
    const local = createLocalMediaSource(root)
    const { source: remote } = s3Double()
    expect(local.driver).toBe('local')
    expect(remote.driver).toBe('s3')
  })
})
