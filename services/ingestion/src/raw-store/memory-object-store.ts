/**
 * memory-object-store.ts — Substituto local do object store, em memoria.
 *
 * NAO e so um dublê de teste: e o substituto que permite construir e provar
 * toda a Frente B sem bucket provisionado. Ele implementa os MESMOS invariantes
 * do adapter remoto (chave validada, `head` sem corpo, `put` idempotente,
 * ausencia != erro) e roda a MESMA suite de contrato.
 *
 * `failNext` existe para provar o desfecho que mais importa: store indisponivel
 * no MEIO de um lote nao pode deixar estado parcial corrompido.
 */

import type { RawObjectHead, RawObjectStore } from './object-store.js'
import { isSafeRawObjectKey, RawStoreKeyError, RawStoreUnavailableError } from './object-store.js'

/** Controles de teste do store em memoria. */
export interface MemoryRawObjectStore extends RawObjectStore {
  /** Chaves atualmente gravadas, ordenadas. */
  keys(): string[]
  /** Soma de bytes gravados (insumo do teto de custo). */
  totalBytes(): number
  /**
   * Faz a PROXIMA operacao (ou as proximas `times`) falharem como
   * indisponibilidade do store.
   */
  failNext(operation: 'head' | 'put' | 'get' | 'any', times?: number): void
}

/** Cria um store de objetos em memoria. */
export function createMemoryRawObjectStore(): MemoryRawObjectStore {
  const objects = new Map<string, { body: string; head: RawObjectHead }>()
  let pending: { operation: 'head' | 'put' | 'get' | 'any'; times: number } | null = null

  function assertKey(key: string): void {
    if (!isSafeRawObjectKey(key)) {
      throw new RawStoreKeyError(`chave de objeto insegura: ${JSON.stringify(key)}`)
    }
  }

  function maybeFail(operation: 'head' | 'put' | 'get'): void {
    if (pending === null) return
    if (pending.operation !== 'any' && pending.operation !== operation) return
    pending.times -= 1
    if (pending.times <= 0) pending = null
    throw new RawStoreUnavailableError(operation, `store em memoria indisponivel (${operation})`)
  }

  return {
    driver: 'memory',

    async head(key: string): Promise<RawObjectHead | null> {
      assertKey(key)
      maybeFail('head')
      return objects.get(key)?.head ?? null
    },

    async put(input): Promise<RawObjectHead> {
      assertKey(input.key)
      maybeFail('put')
      const head: RawObjectHead = {
        payloadHash: input.payloadHash,
        byteSize: Buffer.byteLength(input.body, 'utf8'),
      }
      // Sobrescreve: chave e identidade, nunca acumula versao.
      objects.set(input.key, { body: input.body, head })
      return head
    },

    async get(key: string): Promise<string | null> {
      assertKey(key)
      maybeFail('get')
      return objects.get(key)?.body ?? null
    },

    async delete(key: string): Promise<void> {
      assertKey(key)
      objects.delete(key)
    },

    keys(): string[] {
      return [...objects.keys()].sort()
    },

    totalBytes(): number {
      let total = 0
      for (const entry of objects.values()) total += entry.head.byteSize
      return total
    },

    failNext(operation, times = 1): void {
      pending = { operation, times }
    },
  }
}
