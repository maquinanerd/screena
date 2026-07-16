/**
 * Testes do registry de producao (PURO: fakes em memoria, sem DB, sem rede).
 *
 * Provam o que a composicao promete:
 *  - os 11 tipos do enum tem handler (cobertura completa);
 *  - nenhum tipo duplicado;
 *  - todo handler valida input e recusa payload invalido;
 *  - nenhum handler e placeholder (todos delegam ao servico correspondente).
 */

import { describe, expect, it } from 'vitest'
import { CATALOG_JOB_TYPES } from '../../types.js'
import { CatalogJobInputError } from '../../handler.js'
import { assertCompleteRegistry, createCatalogHandlerRegistry, missingHandlerTypes } from '../registry.js'
import { JOB_PAYLOAD_VALIDATORS, validateJobPayload } from '../schemas.js'
import { createHandlerFakes } from './fakes.js'

describe('createCatalogHandlerRegistry', () => {
  it('registra exatamente os 11 tipos do enum', () => {
    const { deps } = createHandlerFakes()
    const registry = createCatalogHandlerRegistry(deps)

    expect(registry.types()).toHaveLength(11)
    expect([...registry.types()].sort()).toEqual([...CATALOG_JOB_TYPES].sort())
    expect(missingHandlerTypes(registry)).toEqual([])
  })

  it('resolve um handler para cada tipo do enum', () => {
    const { deps } = createHandlerFakes()
    const registry = createCatalogHandlerRegistry(deps)

    for (const type of CATALOG_JOB_TYPES) {
      const handler = registry.get(type)
      expect(handler, `sem handler para ${type}`).toBeDefined()
      expect(handler?.type).toBe(type)
    }
  })

  it('todo handler expoe validateInput e execute (nao e placeholder)', () => {
    const { deps } = createHandlerFakes()
    const registry = createCatalogHandlerRegistry(deps)

    for (const type of CATALOG_JOB_TYPES) {
      const handler = registry.get(type)
      expect(typeof handler?.validateInput, `${type}.validateInput`).toBe('function')
      expect(typeof handler?.execute, `${type}.execute`).toBe('function')
    }
  })

  it('todo handler recusa payload nao-objeto com CatalogJobInputError', () => {
    const { deps } = createHandlerFakes()
    const registry = createCatalogHandlerRegistry(deps)

    for (const type of CATALOG_JOB_TYPES) {
      const handler = registry.get(type)
      // Payload invalido => falha PERMANENTE (dead-letter direto, sem retry).
      expect(() => handler?.validateInput(null), `${type} aceitou null`).toThrow(CatalogJobInputError)
      expect(() => handler?.validateInput([]), `${type} aceitou array`).toThrow(CatalogJobInputError)
      expect(() => handler?.validateInput('x'), `${type} aceitou string`).toThrow(CatalogJobInputError)
    }
  })

  it('assertCompleteRegistry lanca quando falta handler', () => {
    const { deps } = createHandlerFakes()
    const registry = createCatalogHandlerRegistry(deps)
    // Registry parcial: espelha o real, menos um tipo.
    const partial = {
      register: registry.register,
      get: registry.get,
      types: () => CATALOG_JOB_TYPES.filter((t) => t !== 'sync_media'),
      has: (t: string) => t !== 'sync_media' && registry.has(t as never),
    }

    expect(() => assertCompleteRegistry(partial as never)).toThrow(/sem handler para \[sync_media\]/)
  })

  it('registrar dois handlers do mesmo tipo e erro de programacao', () => {
    const { deps } = createHandlerFakes()
    const registry = createCatalogHandlerRegistry(deps)
    const duplicate = registry.get('sync_media')

    expect(() => registry.register(duplicate as never)).toThrow(/handler duplicado/)
  })
})

describe('validateJobPayload', () => {
  it('cobre os 11 tipos sem precisar do registry (nem de Prisma/TMDB)', () => {
    for (const type of CATALOG_JOB_TYPES) {
      expect(typeof JOB_PAYLOAD_VALIDATORS[type], `sem validador para ${type}`).toBe('function')
    }
  })

  it('usa o MESMO validador do handler (o erro aparece antes de gravar)', () => {
    const { deps } = createHandlerFakes()
    const registry = createCatalogHandlerRegistry(deps)

    for (const type of CATALOG_JOB_TYPES) {
      // Payload vazio: uns tipos aceitam (tudo opcional), outros recusam. O que
      // importa e que o veredito seja IDENTICO ao do handler — se divergisse, o
      // `catalog enqueue` aceitaria um payload que o worker rejeita depois.
      const viaHandler = safeVerdict(() => registry.get(type)?.validateInput({}))
      const viaMap = safeVerdict(() => validateJobPayload(type, {}))
      expect(viaMap, `divergencia em ${type}`).toBe(viaHandler)
    }
  })

  it('recusa payload invalido com CatalogJobInputError', () => {
    // Este e o caso que criava dead-letter garantido no `catalog enqueue`.
    expect(() => validateJobPayload('sync_details', {})).toThrow(CatalogJobInputError)
    expect(() => validateJobPayload('sync_details', { entityType: 'movie' })).toThrow(
      CatalogJobInputError,
    )
    expect(() => validateJobPayload('sync_media', { entityType: 'season', tmdbId: 1 })).toThrow(
      CatalogJobInputError,
    )
  })
})

/** 'ok' quando validou; a mensagem do erro caso contrario. */
function safeVerdict(run: () => unknown): string {
  try {
    run()
    return 'ok'
  } catch (error) {
    return (error as Error).message
  }
}
