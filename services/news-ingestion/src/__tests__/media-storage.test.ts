/**
 * media-storage.test.ts — Chave determinista, adapters e configuracao.
 *
 * O adapter S3 e exercitado com um DUBLE do `S3Client`: a suite nao abre socket,
 * nao precisa de bucket e nao depende de servico externo. O que se prova aqui e
 * o que sai do NOSSO lado — comandos emitidos, bucket, chave, content-type,
 * cache, metadados, idempotencia e sanitizacao de erro.
 *
 * A assinatura em si NAO e testada aqui de proposito: ela e responsabilidade do
 * `@aws-sdk/client-s3` desde a FASE 2E. Testar assinatura contra a propria
 * implementacao e o que tornava o signer manual arriscado.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { createLocalMediaStorage } from '../media/local-storage.js'
import { createS3MediaStorage } from '../media/s3-storage.js'
import { resolveMediaStorageConfig } from '../media/storage-config.js'
import {
  editorialMediaKey,
  editorialPublicPath,
  isSafeStorageKey,
} from '../media/storage-port.js'

const HASH = 'a'.repeat(64)
const roots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'cinerie-media-'))
  roots.push(root)
  return root
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

/* ------------------------------------------------------------------ */
/* Chave                                                               */
/* ------------------------------------------------------------------ */

describe('chave determinista de storage', () => {
  it('deriva do CONTEUDO, com balde de dois caracteres', () => {
    // O balde evita um diretorio com centenas de milhares de arquivos, onde
    // filesystem e listagem de bucket degradam.
    expect(editorialMediaKey(HASH, 'jpg')).toBe(`editorial/aa/${HASH}.jpg`)
    expect(editorialMediaKey(`sha256:${HASH}`, '.JPG')).toBe(`editorial/aa/${HASH}.jpg`)
  })

  it('e ESTAVEL: mesmos bytes, mesma chave — e o que torna o retry seguro', () => {
    expect(editorialMediaKey(HASH, 'png')).toBe(editorialMediaKey(HASH, 'png'))
  })

  it('recusa hash e extensao fora do formato', () => {
    expect(() => editorialMediaKey('capa-final', 'jpg')).toThrow()
    expect(() => editorialMediaKey(HASH, '../../etc/passwd')).toThrow()
    // O nome do upload nunca pode virar extensao.
    expect(() => editorialMediaKey(HASH, 'php')).not.toThrow() // formato ok...
    expect(() => editorialMediaKey(HASH, 'exe.jpg')).toThrow() // ...mas com ponto, nao
  })

  it('reconhece chave insegura antes de virar caminho de arquivo', () => {
    expect(isSafeStorageKey(`editorial/aa/${HASH}.jpg`)).toBe(true)
    for (const unsafe of [
      '',
      '/etc/passwd',
      'editorial/../../etc/passwd',
      'editorial\\aa\\x.jpg',
      'editorial/aa/x.jpg\0',
      'editorial//x.jpg',
      'Editorial/AA/X.JPG',
    ]) {
      expect(isSafeStorageKey(unsafe), unsafe).toBe(false)
    }
  })

  it('caminho publico e de SITE, nunca URL', () => {
    // `normalizeNewsLocalImagePath` no apps/web recusa http(s) por design.
    const publicPath = editorialPublicPath(`editorial/aa/${HASH}.jpg`)
    expect(publicPath).toBe(`/media/editorial/aa/${HASH}.jpg`)
    expect(publicPath).not.toMatch(/^https?:/)
    expect(() => editorialPublicPath('../fora')).toThrow()
  })
})

/* ------------------------------------------------------------------ */
/* Adapter local                                                       */
/* ------------------------------------------------------------------ */

describe('adapter local', () => {
  const storage = createLocalMediaStorage({
    driver: 'local',
    root: tempRoot(),
    publicBasePath: '/media',
  })
  const key = `editorial/aa/${HASH}.jpg`
  const bytes = new Uint8Array([1, 2, 3, 4, 5])

  it('grava, confirma e devolve os bytes', async () => {
    expect(await storage.exists(key)).toBe(false)
    await storage.put({ key, bytes, contentType: 'image/jpeg' })
    expect(await storage.exists(key)).toBe(true)
    expect(await storage.stat(key)).toEqual({ byteSize: 5 })
    expect(Array.from((await storage.read(key)) ?? [])).toEqual([1, 2, 3, 4, 5])
  })

  it('regravar a MESMA chave e inofensivo (retry seguro)', async () => {
    await storage.put({ key, bytes, contentType: 'image/jpeg' })
    await storage.put({ key, bytes, contentType: 'image/jpeg' })
    expect(await storage.stat(key)).toEqual({ byteSize: 5 })
  })

  it('RECUSA chave que escaparia da raiz do storage', async () => {
    // Sem esta barreira, uma chave com `..` escreveria em qualquer lugar do
    // disco do servidor.
    await expect(
      storage.put({ key: '../fora.jpg', bytes, contentType: 'image/jpeg' }),
    ).rejects.toThrow()
    await expect(storage.exists('/etc/passwd')).resolves.toBe(false)
  })

  it('publicReference respeita o prefixo configurado', () => {
    expect(storage.publicReference(key)).toBe(`/media/${key}`)
  })
})

/* ------------------------------------------------------------------ */
/* Adapter S3 sobre o SDK oficial (cliente injetado)                   */
/* ------------------------------------------------------------------ */

describe('adapter S3-compatible', () => {
  const config = {
    driver: 's3' as const,
    endpoint: 'https://exemplo.r2.cloudflarestorage.com',
    region: 'auto',
    bucket: 'cinerie-media',
    accessKeyId: 'AKIA-TESTE',
    secretAccessKey: 'segredo-de-teste-nao-real',
    forcePathStyle: true,
    publicBasePath: '/media',
  }
  const key = `editorial/aa/${HASH}.webp`

  /** Duble do `S3Client`: registra os COMANDOS que o adapter emitiu. */
  function spy(behavior: 'ok' | 'not_found' | 'boom' = 'ok') {
    const commands: { name: string; input: Record<string, unknown> }[] = []
    const client = {
      async send(command: unknown) {
        const wrapped = command as { constructor: { name: string }; input: Record<string, unknown> }
        commands.push({ name: wrapped.constructor.name, input: wrapped.input })
        if (behavior === 'not_found') {
          throw Object.assign(new Error('nao existe'), {
            name: 'NoSuchKey',
            $metadata: { httpStatusCode: 404 },
          })
        }
        if (behavior === 'boom') {
          throw Object.assign(new Error(`falhou em ${config.bucket} com AKIA-TESTE`), {
            name: 'InternalError',
            $metadata: { httpStatusCode: 500 },
          })
        }
        return { ContentLength: 2, Body: { transformToByteArray: async () => new Uint8Array([1, 2]) } }
      },
    }
    return { storage: createS3MediaStorage(config, { client }), commands }
  }

  it('PUT usa bucket, chave, content-type e cache imutavel', async () => {
    const { storage, commands } = spy()
    await storage.put({ key, bytes: new Uint8Array([1, 2]), contentType: 'image/webp' })
    expect(commands).toHaveLength(1)
    const [command] = commands
    expect(command?.name).toBe('PutObjectCommand')
    expect(command?.input.Bucket).toBe('cinerie-media')
    expect(command?.input.Key).toBe(key)
    expect(command?.input.ContentType).toBe('image/webp')
    // Midia enderecada por hash e imutavel: cache longo e correto e barato.
    expect(String(command?.input.CacheControl)).toContain('immutable')
    expect((command?.input.Metadata as Record<string, string>)['content-sha256']).toBe(HASH)
  })

  it('repetir o PUT e idempotente: mesma chave, mesmo corpo', async () => {
    const { storage, commands } = spy()
    const bytes = new Uint8Array([1, 2])
    await storage.put({ key, bytes, contentType: 'image/webp' })
    await storage.put({ key, bytes, contentType: 'image/webp' })
    expect(commands[0]?.input.Key).toBe(commands[1]?.input.Key)
    expect(commands[0]?.input.Bucket).toBe(commands[1]?.input.Bucket)
  })

  it('objeto ausente vira `false`/`null`, nao excecao', async () => {
    const { storage } = spy('not_found')
    expect(await storage.exists(key)).toBe(false)
    expect(await storage.stat(key)).toBeNull()
    expect(await storage.read(key)).toBeNull()
    // DELETE de objeto ausente e sucesso: o objetivo era nao existir.
    await expect(storage.delete(key)).resolves.toBeUndefined()
  })

  it('erro NAO vaza credencial nem nome de bucket', async () => {
    // Erro do SDK carrega `$metadata`, bucket e as vezes a requisicao inteira.
    // Nada disso pode chegar ao painel do CMS.
    const { storage } = spy('boom')
    try {
      await storage.put({ key, bytes: new Uint8Array([1]), contentType: 'image/webp' })
      expect.unreachable('deveria ter lancado')
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain('storage s3: PUT falhou')
      expect(message).not.toContain('AKIA-TESTE')
      expect(message).not.toContain('segredo-de-teste-nao-real')
      expect(message).not.toContain('cinerie-media')
    }
  })

  it('recusa chave insegura ANTES de emitir comando', async () => {
    const { storage, commands } = spy()
    await expect(
      storage.put({ key: '../fora.jpg', bytes: new Uint8Array([1]), contentType: 'image/jpeg' }),
    ).rejects.toThrow()
    expect(commands).toHaveLength(0)
  })

  it('publicReference continua sendo caminho de site, nunca URL', () => {
    const { storage } = spy()
    expect(storage.publicReference(key)).toBe(`/media/${key}`)
    expect(storage.publicReference(key)).not.toMatch(/^https?:/)
  })
})

/* ------------------------------------------------------------------ */
/* Configuracao                                                        */
/* ------------------------------------------------------------------ */

describe('configuracao de storage', () => {
  it('local funciona em desenvolvimento', () => {
    const result = resolveMediaStorageConfig({
      EDITORIAL_MEDIA_STORAGE_DRIVER: 'local',
      EDITORIAL_MEDIA_LOCAL_ROOT: '/tmp/midia',
    })
    expect(result.ok).toBe(true)
  })

  it('PRODUCTION recusa driver local — disco efemero perde midia', () => {
    // Publicar hoje, ver a foto no ar, e perde-la no proximo deploy com o banco
    // ainda apontando para ela.
    const result = resolveMediaStorageConfig({
      NODE_ENV: 'production',
      EDITORIAL_MEDIA_STORAGE_DRIVER: 'local',
      EDITORIAL_MEDIA_LOCAL_ROOT: '/data/midia',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join(' ')).toContain('efemero')
  })

  it('PRODUCTION recusa driver AUSENTE — nada de adivinhar', () => {
    expect(resolveMediaStorageConfig({ NODE_ENV: 'production' }).ok).toBe(false)
  })

  it('s3 exige configuracao COMPLETA', () => {
    const incomplete = resolveMediaStorageConfig({
      EDITORIAL_MEDIA_STORAGE_DRIVER: 's3',
      EDITORIAL_MEDIA_S3_ENDPOINT: 'https://exemplo.r2.cloudflarestorage.com',
    })
    expect(incomplete.ok).toBe(false)
    if (incomplete.ok) return
    expect(incomplete.errors.join(' ')).toContain('EDITORIAL_MEDIA_S3_BUCKET')
    // Controle positivo: completa, passa.
    const complete = resolveMediaStorageConfig({
      NODE_ENV: 'production',
      EDITORIAL_MEDIA_STORAGE_DRIVER: 's3',
      EDITORIAL_MEDIA_S3_ENDPOINT: 'https://exemplo.r2.cloudflarestorage.com',
      EDITORIAL_MEDIA_S3_BUCKET: 'cinerie-media',
      EDITORIAL_MEDIA_S3_ACCESS_KEY_ID: 'k',
      EDITORIAL_MEDIA_S3_SECRET_ACCESS_KEY: 's',
    })
    expect(complete.ok).toBe(true)
  })

  it('nenhum erro de configuracao carrega VALOR de variavel', () => {
    const result = resolveMediaStorageConfig({
      EDITORIAL_MEDIA_STORAGE_DRIVER: 's3',
      EDITORIAL_MEDIA_S3_ENDPOINT: 'nao-e-url',
      EDITORIAL_MEDIA_S3_SECRET_ACCESS_KEY: '',
      EDITORIAL_MEDIA_S3_ACCESS_KEY_ID: 'chave-secreta-visivel',
      EDITORIAL_MEDIA_S3_BUCKET: 'b',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    const text = result.errors.join(' | ')
    expect(text).not.toContain('chave-secreta-visivel')
    expect(text).not.toContain('nao-e-url')
    expect(text).toContain('EDITORIAL_MEDIA_S3_SECRET_ACCESS_KEY')
  })

  it('path-style e o default (virtual-host exige DNS por bucket)', () => {
    const result = resolveMediaStorageConfig({
      EDITORIAL_MEDIA_STORAGE_DRIVER: 's3',
      EDITORIAL_MEDIA_S3_ENDPOINT: 'https://exemplo.r2.cloudflarestorage.com',
      EDITORIAL_MEDIA_S3_BUCKET: 'b',
      EDITORIAL_MEDIA_S3_ACCESS_KEY_ID: 'k',
      EDITORIAL_MEDIA_S3_SECRET_ACCESS_KEY: 's',
    })
    expect(result.ok).toBe(true)
    if (!result.ok || result.config.driver !== 's3') return
    expect(result.config.forcePathStyle).toBe(true)
  })
})
