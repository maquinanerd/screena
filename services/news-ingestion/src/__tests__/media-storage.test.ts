/**
 * media-storage.test.ts — Chave determinista, adapters e configuracao.
 *
 * O adapter S3 e exercitado com `fetch` INJETADO: a suite nao abre socket, nao
 * precisa de bucket e nao depende de servico externo. O que se prova aqui e o
 * que sai do nosso lado — URL, verbo, headers, assinatura, idempotencia e
 * sanitizacao de erro.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { createLocalMediaStorage } from '../media/local-storage.js'
import { createS3MediaStorage } from '../media/s3-storage.js'
import { amzDateParts, encodeS3Path, signS3Request } from '../media/s3-signature.js'
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
/* Assinatura SigV4                                                    */
/* ------------------------------------------------------------------ */

describe('assinatura SigV4', () => {
  const base = {
    method: 'PUT',
    endpoint: 'https://exemplo.r2.cloudflarestorage.com',
    region: 'auto',
    bucket: 'cinerie-media',
    key: `editorial/aa/${HASH}.jpg`,
    forcePathStyle: true,
    accessKeyId: 'AKIA-TESTE',
    secretAccessKey: 'segredo-de-teste-nao-real',
    nowIso: '2026-07-29T01:30:00.000Z',
    payload: new Uint8Array([1, 2, 3]),
  }

  it('mantem a barra separadora ao codificar o caminho', () => {
    // `encodeURIComponent` sozinho escaparia as barras e o objeto iria parar
    // numa chave com `%2F` no nome.
    expect(encodeS3Path('editorial/aa/x y.jpg')).toBe('editorial/aa/x%20y.jpg')
  })

  it('formata a data como o SigV4 exige', () => {
    expect(amzDateParts('2026-07-29T01:30:00.000Z')).toEqual({
      amzDate: '20260729T013000Z',
      dateStamp: '20260729',
    })
  })

  it('e DETERMINISTICA para a mesma entrada', () => {
    const a = signS3Request(base)
    const b = signS3Request(base)
    expect(a.headers.Authorization).toBe(b.headers.Authorization)
  })

  it('a assinatura muda quando o CORPO muda', () => {
    // E o que faz o storage recusar um corpo alterado em transito: nao
    // dependemos so do TLS para integridade.
    const outro = signS3Request({ ...base, payload: new Uint8Array([9, 9, 9]) })
    expect(outro.headers.Authorization).not.toBe(signS3Request(base).headers.Authorization)
    expect(outro.headers['x-amz-content-sha256']).not.toBe('UNSIGNED-PAYLOAD')
  })

  it('path-style poe o bucket no caminho; virtual-host no host', () => {
    expect(signS3Request(base).url).toContain('/cinerie-media/editorial/')
    const virtual = signS3Request({ ...base, forcePathStyle: false })
    expect(virtual.url).toContain('cinerie-media.exemplo.r2.cloudflarestorage.com')
  })
})

/* ------------------------------------------------------------------ */
/* Adapter S3 (fetch injetado)                                         */
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

  function spy(status = 200) {
    const calls: { url: string; init: RequestInit }[] = []
    const storage = createS3MediaStorage(config, {
      now: () => '2026-07-29T01:30:00.000Z',
      fetchImpl: async (url, init) => {
        calls.push({ url, init })
        return new Response(status === 200 ? new Uint8Array([1]) : null, {
          status,
          headers: { 'content-length': '1' },
        })
      },
    })
    return { storage, calls }
  }

  it('PUT vai para bucket, chave, verbo e content-type corretos', async () => {
    const { storage, calls } = spy()
    await storage.put({ key, bytes: new Uint8Array([1, 2]), contentType: 'image/webp' })
    expect(calls).toHaveLength(1)
    const [call] = calls
    expect(call?.init.method).toBe('PUT')
    expect(call?.url).toContain('/cinerie-media/editorial/aa/')
    const headers = call?.init.headers as Record<string, string>
    expect(headers['content-type']).toBe('image/webp')
    // Midia enderecada por hash e imutavel: cache longo e correto e barato.
    expect(headers['cache-control']).toContain('immutable')
    expect(headers['x-amz-meta-content-sha256']).toBe(HASH)
    expect(headers.Authorization).toContain('AWS4-HMAC-SHA256')
  })

  it('repetir o PUT e idempotente: mesma chave, mesma assinatura', async () => {
    const { storage, calls } = spy()
    const bytes = new Uint8Array([1, 2])
    await storage.put({ key, bytes, contentType: 'image/webp' })
    await storage.put({ key, bytes, contentType: 'image/webp' })
    expect(calls[0]?.url).toBe(calls[1]?.url)
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe(
      (calls[1]?.init.headers as Record<string, string>).Authorization,
    )
  })

  it('erro NAO vaza credencial nem URL assinada', async () => {
    // A URL assinada carrega `Credential=` e `Signature=`. Nada disso pode
    // chegar ao log do worker nem ao painel do CMS.
    const { storage } = spy(500)
    await expect(
      storage.put({ key, bytes: new Uint8Array([1]), contentType: 'image/webp' }),
    ).rejects.toThrow(/storage s3: PUT respondeu 500/)
    try {
      await storage.put({ key, bytes: new Uint8Array([1]), contentType: 'image/webp' })
    } catch (error) {
      const message = (error as Error).message
      expect(message).not.toContain('segredo-de-teste-nao-real')
      expect(message).not.toContain('AKIA-TESTE')
      expect(message).not.toContain('Signature=')
    }
  })

  it('DELETE trata 404 como sucesso', async () => {
    const { storage } = spy(404)
    await expect(storage.delete(key)).resolves.toBeUndefined()
  })

  it('recusa chave insegura antes de assinar', async () => {
    const { storage, calls } = spy()
    await expect(
      storage.put({ key: '../fora.jpg', bytes: new Uint8Array([1]), contentType: 'image/jpeg' }),
    ).rejects.toThrow()
    expect(calls).toHaveLength(0)
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
