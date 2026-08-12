/**
 * worker-service-config.test.ts — Config PURA do servico de catalogo.
 *
 * FAIL-LOUD: valor presente porem invalido tem que ERRAR, nunca cair no default.
 * Um `CATALOG_WORKER_CONCURRENCY=quatro` que virasse `4` esconderia um erro de
 * deploy para sempre.
 */

import { describe, expect, it } from 'vitest'

import {
  CatalogWorkerConfigError,
  resolveCatalogWorkerServiceConfig,
} from '../worker-service/config.js'

/** Ambiente minimo valido. */
const BASE = {
  DATABASE_URL: 'postgresql://u:p@h:5432/d',
  TMDB_READ_ACCESS_TOKEN: 'token-ficticio',
} as const

describe('resolveCatalogWorkerServiceConfig', () => {
  it('aplica defaults sensatos com o ambiente minimo', () => {
    const config = resolveCatalogWorkerServiceConfig(BASE)

    expect(config.healthPort).toBe(3004)
    expect(config.concurrency).toBe(4)
    expect(config.discoveryKinds).toEqual(['movie', 'tv', 'person'])
    expect(config.locale).toBe('pt-BR')
    expect(config.isProduction).toBe(false)
    expect(config.productionWriteAuthorized).toBe(false)
    expect(config.hasDatabaseUrl).toBe(true)
    expect(config.hasTmdbCredential).toBe(true)
  })

  it('aceita a api key v3 como credencial TMDB', () => {
    const config = resolveCatalogWorkerServiceConfig({
      DATABASE_URL: BASE.DATABASE_URL,
      TMDB_API_KEY: 'key-ficticia',
    })
    expect(config.hasTmdbCredential).toBe(true)
  })

  it('trata DISCOVERY_LIMIT=0 como SEM TETO, nao como "nenhum id"', () => {
    // Um teto de 0 que enfileirasse nada seria um servico que sobe saudavel e
    // nunca trabalha — a falha silenciosa mais cara que existe num worker.
    const config = resolveCatalogWorkerServiceConfig({
      ...BASE,
      CATALOG_WORKER_DISCOVERY_LIMIT: '0',
    })
    expect(config.discoveryLimit).toBeNull()
  })

  it('FAIL-LOUD: inteiro invalido erra em vez de cair no default', () => {
    expect(() =>
      resolveCatalogWorkerServiceConfig({ ...BASE, CATALOG_WORKER_CONCURRENCY: 'quatro' }),
    ).toThrow(CatalogWorkerConfigError)
  })

  it('FAIL-LOUD: inteiro fora da faixa erra', () => {
    expect(() =>
      resolveCatalogWorkerServiceConfig({ ...BASE, CATALOG_WORKER_CONCURRENCY: '999' }),
    ).toThrow(/faixa permitida/)
  })

  it('FAIL-LOUD: booleano so aceita "true"/"false" explicitos', () => {
    // "1", "yes", "sim" nao podem virar `true` por acidente: esta variavel
    // autoriza escrita em PRODUCAO.
    expect(() =>
      resolveCatalogWorkerServiceConfig({
        ...BASE,
        CINERIE_CATALOG_WORKER_PRODUCTION_CONFIRMED: '1',
      }),
    ).toThrow(CatalogWorkerConfigError)
  })

  it('FAIL-LOUD: tipo de descoberta desconhecido erra', () => {
    expect(() =>
      resolveCatalogWorkerServiceConfig({
        ...BASE,
        CATALOG_WORKER_DISCOVERY_KINDS: 'movie,filme',
      }),
    ).toThrow(/filme/)
  })

  it('deduplica os tipos de descoberta', () => {
    const config = resolveCatalogWorkerServiceConfig({
      ...BASE,
      CATALOG_WORKER_DISCOVERY_KINDS: 'movie, tv ,movie',
    })
    expect(config.discoveryKinds).toEqual(['movie', 'tv'])
  })

  it('reconhece producao e a autorizacao explicita', () => {
    const config = resolveCatalogWorkerServiceConfig({
      ...BASE,
      NODE_ENV: 'production',
      CINERIE_CATALOG_WORKER_PRODUCTION_CONFIRMED: 'true',
    })
    expect(config.isProduction).toBe(true)
    expect(config.productionWriteAuthorized).toBe(true)
  })
})
