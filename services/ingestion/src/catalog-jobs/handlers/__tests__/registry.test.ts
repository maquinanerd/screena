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
