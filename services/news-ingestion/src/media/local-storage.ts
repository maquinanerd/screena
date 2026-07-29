/**
 * local-storage.ts — Adapter de filesystem da midia editorial.
 *
 * DESENVOLVIMENTO E TESTE. `resolveMediaStorageConfig` recusa este driver em
 * `production` porque o disco do container e efemero: a materia sairia com foto
 * hoje e sem foto depois do proximo deploy, com o banco ainda apontando para o
 * arquivo.
 *
 * Worker-only: nada aqui e importavel pelo render (invariantes 3 e 4).
 */

import { mkdir, readFile, rm, stat, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'

import type { LocalStorageConfig } from './storage-config.js'
import {
  editorialPublicPath,
  isSafeStorageKey,
  type MediaStoragePort,
  type StoredObject,
} from './storage-port.js'

function absolutePathFor(root: string, key: string): string {
  if (!isSafeStorageKey(key)) throw new Error('chave de storage insegura')
  const resolvedRoot = path.resolve(root)
  const target = path.resolve(resolvedRoot, key)
  // Cinto e suspensorio. `isSafeStorageKey` ja recusa `..`, mas quem escreve
  // fora da raiz do storage escreve em qualquer lugar do disco — o custo de
  // conferir de novo e zero.
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) {
    throw new Error('chave de storage escaparia da raiz')
  }
  return target
}

export function createLocalMediaStorage(config: LocalStorageConfig): MediaStoragePort {
  return {
    async put({ key, bytes, contentType }): Promise<StoredObject> {
      const target = absolutePathFor(config.root, key)
      await mkdir(path.dirname(target), { recursive: true })

      // Escrita em arquivo temporario + rename ATOMICO. Sem isso, um worker
      // morto no meio da escrita deixaria um arquivo truncado na chave
      // definitiva — e como a chave e derivada do hash, `exists()` passaria a
      // responder `true` para bytes corrompidos, para sempre.
      const temporary = `${target}.${String(process.pid)}.tmp`
      try {
        await writeFile(temporary, bytes)
        await rename(temporary, target)
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined)
        throw error
      }

      return { key, byteSize: bytes.length, contentType }
    },

    async exists(key): Promise<boolean> {
      try {
        await stat(absolutePathFor(config.root, key))
        return true
      } catch {
        return false
      }
    },

    async stat(key): Promise<{ byteSize: number } | null> {
      try {
        const info = await stat(absolutePathFor(config.root, key))
        return { byteSize: info.size }
      } catch {
        return null
      }
    },

    async read(key): Promise<Uint8Array | null> {
      try {
        return new Uint8Array(await readFile(absolutePathFor(config.root, key)))
      } catch {
        return null
      }
    },

    async delete(key): Promise<void> {
      await rm(absolutePathFor(config.root, key), { force: true })
    },

    publicReference(key): string {
      return editorialPublicPath(key, config.publicBasePath)
    },
  }
}
