/**
 * object-raw-entity-store.ts — Adapta um {@link RawObjectStore} a porta
 * `RawEntityStore` que a ingestao ja usa. Modulo PURO (sem SDK, sem Prisma).
 *
 * A ingestao NAO sabe onde o blob mora: `runRawSyncPilot` continua chamando
 * `readHash` / `create` / `update` exatamente como antes. Trocar
 * `TMDB_RAW_STORE_DRIVER` de `postgres` para `r2` nao muda uma linha do core.
 *
 * ATOMICIDADE do par (payload, hash) — a decisao central deste arquivo:
 * o hash NAO vive numa tabela separada; ele viaja nos METADADOS do proprio
 * objeto. Logo `head()` devolve o hash sem baixar o corpo (que era o requisito),
 * e e IMPOSSIVEL existir hash sem payload ou payload sem hash. Um catalogo
 * externo teria duas escritas e, portanto, um instante em que elas divergem —
 * exatamente a dessincronizacao que a chave deterministica evita.
 *
 * LINGUAGEM BASE: o unique de `tmdb_raw` e (`entity_type`, `tmdb_id`,
 * `base_language`), mas a chave especificada e `tmdb/{entity_type}/{id}.json`,
 * sem idioma. Em vez de descartar o idioma em silencio — o que faria um sync
 * `en` sobrescrever o `pt-BR` sem aviso — o store e construido com UMA lingua
 * base e RECUSA, com erro, qualquer chave de outra lingua. Hoje isso nunca
 * dispara: `bin/sync-tmdb-raw.ts` fixa `pt-BR` e confere contra
 * `client.config.defaultLanguage`. No dia em que um segundo idioma for
 * arquivado, o processo para e pede uma decisao de formato de chave, em vez de
 * corromper o arquivo.
 */

import type { RawEntityKey, RawEntityRecord, RawEntityStore } from '../raw-sync/types.js'
import { stableStringify } from '../utils/hash.js'
import type { RawObjectKind, RawObjectStore } from './object-store.js'
import { RawStoreKeyError, rawObjectKey } from './object-store.js'

/** Observacao de volume de um ciclo — insumo do teto de CUSTO (B-G). */
export interface RawObjectWriteObservation {
  readonly key: string
  readonly byteSize: number
  /** `create` quando o objeto nao existia; `update` quando foi sobrescrito. */
  readonly outcome: 'create' | 'update'
}

/** Opcoes do adapter. */
export interface ObjectRawEntityStoreOptions {
  readonly objectStore: RawObjectStore
  /** Unica lingua base que este store aceita arquivar. */
  readonly baseLanguage: string
  /** Chamado a cada escrita — o worker soma bytes para o relatorio de custo. */
  readonly onWrite?: (observation: RawObjectWriteObservation) => void
}

/** Deriva a chave conferindo que a lingua base bate. */
export function rawEntityObjectKey(key: RawEntityKey, baseLanguage: string): string {
  if (key.baseLanguage !== baseLanguage) {
    throw new RawStoreKeyError(
      `chave de objeto pede lingua base "${baseLanguage}", recebeu "${key.baseLanguage}": ` +
        'o formato tmdb/{tipo}/{id}.json nao distingue idioma. ' +
        'Arquivar um segundo idioma exige decidir o formato da chave antes.',
    )
  }
  return rawObjectKey(key.entityType as RawObjectKind, key.tmdbId)
}

/**
 * Cria um `RawEntityStore` sobre um store de objetos.
 *
 * `create` e `update` fazem a MESMA coisa (um `put` idempotente). A distincao
 * existe so no contrato herdado, porque no Postgres ela e INSERT vs UPDATE.
 * Aqui a chave e a identidade: regravar a mesma entidade sobrescreve, nunca
 * duplica — que e precisamente o requisito de idempotencia.
 */
export function createObjectRawEntityStore(
  options: ObjectRawEntityStoreOptions,
): RawEntityStore {
  const { objectStore, baseLanguage, onWrite } = options

  async function write(key: RawEntityKey, record: RawEntityRecord): Promise<void> {
    const objectKey = rawEntityObjectKey(key, baseLanguage)
    // MESMA serializacao canonica que alimenta o hash (`hashPayload`), para que
    // o byte gravado e o byte hasheado nunca divirjam.
    const body = stableStringify(record.payload)
    const existed = await objectStore.head(objectKey)
    const head = await objectStore.put({ key: objectKey, body, payloadHash: record.payloadHash })
    onWrite?.({
      key: objectKey,
      byteSize: head.byteSize,
      outcome: existed === null ? 'create' : 'update',
    })
  }

  return {
    async readHash(key: RawEntityKey): Promise<string | null> {
      const head = await objectStore.head(rawEntityObjectKey(key, baseLanguage))
      return head === null ? null : head.payloadHash
    },
    // `create` recebe SO o record (que ja e uma `RawEntityKey`); `update`
    // recebe chave e record separados. Assinaturas diferentes, mesma escrita.
    create: (record: RawEntityRecord) => write(record, record),
    update: (key: RawEntityKey, record: RawEntityRecord) => write(key, record),
  }
}
