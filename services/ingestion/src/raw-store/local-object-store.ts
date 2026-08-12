/**
 * local-object-store.ts — Substituto local em DISCO do object store.
 *
 * Serve para desenvolver e provar a Frente B sem bucket provisionado, com um
 * comportamento mais proximo do remoto que o store em memoria (persiste entre
 * processos, exercita caminho de arquivo real).
 *
 * RECUSADO EM PRODUCAO pelo resolvedor de config, pelo mesmo motivo do driver
 * `local` da midia editorial: disco de container e efemero.
 *
 * ESCRITA ATOMICA: grava em `<alvo>.<pid>.tmp` e faz `rename`. Sem isso, um
 * worker morto no meio deixaria um arquivo truncado na chave definitiva — e
 * como `head()` responde pela existencia do arquivo, o sync passaria a
 * considerar aquele objeto pronto para sempre. Mesma armadilha que
 * `local-storage.ts` da midia editorial ja documenta.
 *
 * O hash vive num arquivo irmao `<alvo>.sha256`, escrito ANTES do rename do
 * corpo: se o processo morrer entre os dois, sobra um `.sha256` orfao (inocente,
 * porque `head` so responde quando o CORPO existe) e nunca um corpo sem hash.
 */

import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { RawObjectHead, RawObjectStore } from './object-store.js'
import { isSafeRawObjectKey, RawStoreKeyError, RawStoreUnavailableError } from './object-store.js'

/** Sufixo do arquivo irmao que guarda o hash canonico. */
const HASH_SUFFIX = '.sha256'

/** Configuracao do store local. */
export interface LocalRawObjectStoreConfig {
  /** Raiz no disco. Tudo fica sob ela; escapar dela e erro. */
  readonly root: string
}

function absolutePathFor(root: string, key: string): string {
  if (!isSafeRawObjectKey(key)) {
    throw new RawStoreKeyError(`chave de objeto insegura: ${JSON.stringify(key)}`)
  }
  const target = path.resolve(root, key)
  const normalizedRoot = path.resolve(root)
  // Cinto e suspensorio: `isSafeRawObjectKey` ja barra `..`, mas o alvo
  // resolvido tem de continuar dentro da raiz de qualquer forma.
  if (target !== normalizedRoot && !target.startsWith(normalizedRoot + path.sep)) {
    throw new RawStoreKeyError(`chave escaparia da raiz do store: ${JSON.stringify(key)}`)
  }
  return target
}

/** True quando o erro do fs significa "nao existe". */
function isMissing(error: unknown): boolean {
  return (
    error !== null && typeof error === 'object' && (error as { code?: unknown }).code === 'ENOENT'
  )
}

/** Cria o store local em disco. */
export function createLocalRawObjectStore(config: LocalRawObjectStoreConfig): RawObjectStore {
  const { root } = config

  return {
    driver: 'local',

    async head(key: string): Promise<RawObjectHead | null> {
      const target = absolutePathFor(root, key)
      try {
        const stats = await stat(target)
        const payloadHash = (await readFile(`${target}${HASH_SUFFIX}`, 'utf8')).trim()
        // Corpo presente e hash ausente/vazio: objeto incompleto. Tratar como
        // AUSENTE forca a regravacao — melhor que devolver hash inventado.
        if (payloadHash === '') return null
        return { payloadHash, byteSize: stats.size }
      } catch (error) {
        if (isMissing(error)) return null
        throw new RawStoreUnavailableError('head', 'falha ao ler metadados no store local')
      }
    },

    async put(input): Promise<RawObjectHead> {
      const target = absolutePathFor(root, input.key)
      const byteSize = Buffer.byteLength(input.body, 'utf8')
      const temporary = `${target}.${process.pid}.tmp`
      try {
        await mkdir(path.dirname(target), { recursive: true })
        // Hash primeiro: um `.sha256` orfao e inocente; um corpo sem hash nao.
        await writeFile(`${target}${HASH_SUFFIX}`, input.payloadHash, 'utf8')
        await writeFile(temporary, input.body, 'utf8')
        await rename(temporary, target)
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined)
        throw new RawStoreUnavailableError(
          'put',
          `falha ao gravar no store local (${error instanceof Error ? error.name : 'erro'})`,
        )
      }
      return { payloadHash: input.payloadHash, byteSize }
    },

    async get(key: string): Promise<string | null> {
      const target = absolutePathFor(root, key)
      try {
        return await readFile(target, 'utf8')
      } catch (error) {
        if (isMissing(error)) return null
        throw new RawStoreUnavailableError('get', 'falha ao ler objeto no store local')
      }
    },

    async delete(key: string): Promise<void> {
      const target = absolutePathFor(root, key)
      await rm(target, { force: true })
      await rm(`${target}${HASH_SUFFIX}`, { force: true })
    },
  }
}
