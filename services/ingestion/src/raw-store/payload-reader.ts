/**
 * payload-reader.ts — LEITURA do payload bruto por identidade, independente de
 * onde o blob mora. Modulo PURO (sem SDK, sem Prisma).
 *
 * ============ POR QUE ESTE ARQUIVO EXISTE ============
 *
 * A #149/`ed16c0f` deu ao raw sync um store trocavel (`TMDB_RAW_STORE_DRIVER`):
 * `postgres` grava em `tmdb_raw`, `r2` grava objetos num bucket. A ESCRITA
 * passou a ser enderecavel; a LEITURA nao. Todo consumidor do bruto
 * (`reprocess-watch-providers`, `promote-tmdb-raw`, o job `reprocess_raw`)
 * continuou falando `prisma.tmdbRaw` LITERALMENTE — ver
 * `persistence/watch-providers-store.ts` e `persistence/tmdb-raw-promote-store.ts`.
 *
 * Com o driver em `r2`, isso deixa os leitores CEGOS: o objeto existe no bucket
 * e a consulta pergunta a uma tabela onde ele nunca sera escrito. Nao ha erro,
 * nao ha linha faltando num log — a consulta responde com o que sobrou de um
 * periodo anterior e o comando reporta sucesso sobre um universo que nao ve.
 *
 * Este modulo e o simetrico de `object-raw-entity-store.ts`: aquele adapta o
 * `RawObjectStore` a porta de ESCRITA (`RawEntityStore`), este adapta o mesmo
 * store a porta de LEITURA.
 *
 * ============ POR QUE NAO HA `list()` ============
 *
 * `RawObjectStore` deliberadamente NAO enumera (`head`/`put`/`get`/`delete`), e
 * a chave e derivada da IDENTIDADE (`tmdb/{tipo}/{id}.json`), nunca do conteudo
 * — ver o cabecalho de `object-store.ts`: "quem sabe o id sabe a chave".
 *
 * Isso nao e uma limitacao a contornar; e a resposta. Quem quer reprocessar o
 * corpus enumera o CATALOGO (`movies`/`tv_shows`, que tem `tmdb_id`) e pede o
 * bruto de cada id. O universo passa a ser o catalogo real — e um id do catalogo
 * sem bruto vira um desfecho NOMEADO, em vez de uma entidade que simplesmente
 * nao aparece na consulta.
 *
 * `ausente` NUNCA colapsa com `erro`: `read` devolve `{ present: false }` para o
 * objeto que nao existe e PROPAGA a excecao de transporte. Colapsar os dois
 * faria um bucket fora do ar ser lido como "o catalogo inteiro esta sem bruto".
 */

import type { RawEntityKey } from '../raw-sync/types.js'
import type { RawObjectKind, RawObjectStore } from './object-store.js'
import { RawStoreKeyError, rawObjectKey } from './object-store.js'

/**
 * Resultado de uma leitura. Uniao discriminada de proposito: `payload` pode
 * legitimamente ser `null` no JSON, entao "ausente" nunca pode ser representado
 * por um valor do dominio do payload.
 */
export type RawPayloadRead =
  | { readonly present: true; readonly payload: unknown }
  | { readonly present: false }

/** Porta de leitura do bruto arquivado, por identidade. */
export interface RawPayloadReader {
  read(key: RawEntityKey): Promise<RawPayloadRead>
  /** Uma linha para o log. NUNCA carrega credencial, bucket nem URL. */
  readonly description: string
}

/** Erro de payload arquivado ilegivel — corpo presente que nao e JSON valido. */
export class RawPayloadDecodeError extends Error {
  readonly key: string

  constructor(key: string, cause: string) {
    super(`payload bruto ilegivel em "${key}": ${cause}`)
    this.name = 'RawPayloadDecodeError'
    this.key = key
  }
}

/** Opcoes do leitor sobre store de objetos. */
export interface ObjectRawPayloadReaderOptions {
  readonly objectStore: RawObjectStore
  /** Unica lingua base que este leitor aceita. Espelha o lado da escrita. */
  readonly baseLanguage: string
}

/**
 * Cria um leitor sobre um `RawObjectStore`.
 *
 * A recusa por lingua base espelha `rawEntityObjectKey`: a chave
 * `tmdb/{tipo}/{id}.json` nao distingue idioma, entao ler `en` de uma chave
 * escrita em `pt-BR` devolveria o payload errado com cara de certo.
 */
export function createObjectRawPayloadReader(
  options: ObjectRawPayloadReaderOptions,
): RawPayloadReader {
  const { objectStore, baseLanguage } = options
  return {
    description: `leitura=objeto driver=${objectStore.driver}`,
    async read(key: RawEntityKey): Promise<RawPayloadRead> {
      if (key.baseLanguage !== baseLanguage) {
        throw new RawStoreKeyError(
          `leitura de objeto pede lingua base "${baseLanguage}", recebeu "${key.baseLanguage}": ` +
            'o formato tmdb/{tipo}/{id}.json nao distingue idioma.',
        )
      }
      const objectKey = rawObjectKey(key.entityType as RawObjectKind, key.tmdbId)
      const body = await objectStore.get(objectKey)
      // `null` do contrato = objeto AUSENTE. Falha de transporte chega como
      // `RawStoreUnavailableError` e sobe — nunca vira "ausente".
      if (body === null) return { present: false }
      try {
        return { present: true, payload: JSON.parse(body) as unknown }
      } catch (error) {
        // Corpo presente e ilegivel NAO e ausencia: e corrupcao, e precisa
        // parar o item com nome proprio em vez de virar "sem bruto".
        throw new RawPayloadDecodeError(
          objectKey,
          error instanceof Error ? error.message : String(error),
        )
      }
    },
  }
}
