/**
 * raw-store-config.test.ts — Resolucao do driver de armazenamento do bruto.
 *
 * Duas garantias que valem mais que o resto: (1) em producao o driver
 * `postgres` e RECUSADO, porque o disco do banco do EasyPanel e emprestado e o
 * payload do TMDB cresceria nele para sempre; (2) nenhuma mensagem de erro
 * ecoa VALOR de variavel — so nome.
 */

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_RAW_BASE_LANGUAGE,
  RAW_STORE_DRIVERS,
  RAW_STORE_ENV_NAMES,
  resolveRawStoreConfig,
} from '../raw-store/config.js'

const R2_ENV = {
  TMDB_RAW_STORE_DRIVER: 'r2',
  TMDB_RAW_R2_ENDPOINT: 'https://conta.r2.cloudflarestorage.com',
  TMDB_RAW_R2_BUCKET: 'cinerie-tmdb-raw',
  TMDB_RAW_R2_ACCESS_KEY_ID: 'valor-de-chave-que-nao-pode-vazar',
  TMDB_RAW_R2_SECRET_ACCESS_KEY: 'segredo-que-nao-pode-vazar',
}

describe('resolveRawStoreConfig', () => {
  it('sem driver fora de producao cai em postgres (dev/teste)', () => {
    const result = resolveRawStoreConfig({})
    expect(result.ok).toBe(true)
    expect(result.ok && result.config.driver).toBe('postgres')
    expect(result.ok && result.config.baseLanguage).toBe(DEFAULT_RAW_BASE_LANGUAGE)
  })

  it('sem driver EM PRODUCAO falha: armazenamento nao se escolhe por omissao', () => {
    const result = resolveRawStoreConfig({ NODE_ENV: 'production' })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.errors[0]).toContain(RAW_STORE_ENV_NAMES.driver)
  })

  it('driver postgres EM PRODUCAO e recusado (o disco e emprestado)', () => {
    const result = resolveRawStoreConfig({
      NODE_ENV: 'production',
      TMDB_RAW_STORE_DRIVER: 'postgres',
    })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.errors.join(' ')).toContain('recusado em producao')
  })

  it('driver desconhecido lista os validos', () => {
    const result = resolveRawStoreConfig({ TMDB_RAW_STORE_DRIVER: 's3' })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.errors[0]).toContain(RAW_STORE_DRIVERS.join(', '))
  })

  it('r2 completo resolve com defaults seguros', () => {
    const result = resolveRawStoreConfig(R2_ENV)
    expect(result.ok).toBe(true)
    if (!result.ok || result.config.driver !== 'r2') throw new Error('esperava config r2')
    expect(result.config.bucket).toBe('cinerie-tmdb-raw')
    // R2 ignora regiao mas o SDK a exige; `auto` e o valor canonico.
    expect(result.config.region).toBe('auto')
    // Virtual-host exigiria DNS por bucket; path-style e o default.
    expect(result.config.forcePathStyle).toBe(true)
  })

  it('r2 incompleto nomeia TODAS as variaveis que faltam de uma vez', () => {
    const result = resolveRawStoreConfig({ TMDB_RAW_STORE_DRIVER: 'r2' })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('esperava falha')
    expect(result.errors).toHaveLength(4)
    for (const name of [
      RAW_STORE_ENV_NAMES.endpoint,
      RAW_STORE_ENV_NAMES.bucket,
      RAW_STORE_ENV_NAMES.accessKeyId,
      RAW_STORE_ENV_NAMES.secretAccessKey,
    ]) {
      expect(result.errors.join(' ')).toContain(name)
    }
  })

  it('NENHUMA mensagem de erro ecoa o VALOR de uma variavel', () => {
    const result = resolveRawStoreConfig({
      ...R2_ENV,
      TMDB_RAW_R2_BUCKET: '',
      TMDB_RAW_R2_ENDPOINT: '',
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('esperava falha')
    const joined = result.errors.join(' ')
    expect(joined).not.toContain('valor-de-chave-que-nao-pode-vazar')
    expect(joined).not.toContain('segredo-que-nao-pode-vazar')
  })

  it('valor so de espaco conta como ausente', () => {
    const result = resolveRawStoreConfig({ ...R2_ENV, TMDB_RAW_R2_BUCKET: '   ' })
    expect(result.ok).toBe(false)
  })

  it('forcePathStyle aceita 0/false para desligar', () => {
    for (const raw of ['0', 'false', 'FALSE']) {
      const result = resolveRawStoreConfig({ ...R2_ENV, TMDB_RAW_R2_FORCE_PATH_STYLE: raw })
      expect(result.ok && result.config.driver === 'r2' && result.config.forcePathStyle).toBe(false)
    }
  })

  it('a lingua base e configuravel e default pt-BR', () => {
    expect(resolveRawStoreConfig({}).ok && resolveRawStoreConfig({}).ok).toBe(true)
    const custom = resolveRawStoreConfig({ TMDB_RAW_BASE_LANGUAGE: 'en' })
    expect(custom.ok && custom.config.baseLanguage).toBe('en')
  })
})
