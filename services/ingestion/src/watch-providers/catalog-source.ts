/**
 * catalog-source.ts — Um `RawWatchSource` cujo UNIVERSO e o catalogo, e nao o
 * deposito. Modulo PURO (sem Prisma, sem rede).
 *
 * ============ A INVERSAO, E POR QUE ELA E A CORRECAO ============
 *
 * A fonte antiga enumerava o DEPOSITO (`SELECT ... FROM tmdb_raw LIMIT n`) e
 * media a si mesma. Duas consequencias, ambas observadas em producao:
 *
 *  1. com `TMDB_RAW_STORE_DRIVER=r2`, o deposito consultado nao e o deposito
 *     escrito — o comando lia 100 linhas antigas e nunca via as demais;
 *  2. entidade do catalogo sem bruto simplesmente NAO APARECIA na consulta.
 *     Ausencia por definicao: nao havia como contar o que a query nao retorna.
 *
 * Invertendo, o universo passa a ser `movies`/`tv_shows` — o conjunto que o
 * produto promete cobrir — e o bruto e buscado POR ID. Isso e possivel porque a
 * chave do objeto e derivada da identidade (`tmdb/{tipo}/{id}.json`); ver
 * `raw-store/object-store.ts`: "quem sabe o id sabe a chave". Nenhum indice
 * precisa estar sincronizado.
 *
 * O ganho que importa: "id do catalogo sem bruto" vira um desfecho NOMEADO
 * (`present: false` -> `missing-raw`), contado no relatorio. Deixa de ser
 * ausencia silenciosa e passa a ser numero.
 *
 * ============ CONCORRENCIA ============
 *
 * No driver `r2` cada id e um GET de rede. Serializar 10 mil GETs num loop
 * tornaria o ciclo inviavel; dispara-los todos de uma vez estouraria o pool.
 * A leitura roda em janela fixa (`concurrency`), com a ORDEM DE SAIDA
 * preservada — o `--limit` continua sendo um prefixo estavel e retomavel,
 * exatamente como quando a fonte era um `ORDER BY tmdb_id ASC ... LIMIT n`.
 */

import type { RawEntityKey } from '../raw-sync/types.js'
import type { RawPayloadReader } from '../raw-store/payload-reader.js'
import type {
  CatalogEntityIndex,
  RawWatchSource,
  RawWatchSourceRow,
  WatchProvidersEntityType,
} from './types.js'

/** Leituras simultaneas por padrao. Conservador: o alvo e um bucket remoto. */
export const DEFAULT_RAW_READ_CONCURRENCY = 8

/** Opcoes da fonte dirigida pelo catalogo. */
export interface CatalogRawWatchSourceOptions {
  /** Enumera o universo: ids do catalogo (`movies`/`tv_shows`). */
  readonly catalog: CatalogEntityIndex
  /** Le o bruto por identidade (Postgres ou objeto, conforme o driver). */
  readonly reader: RawPayloadReader
  /** Lingua base das chaves — a MESMA que o raw sync gravou. */
  readonly baseLanguage: string
  /** Leituras simultaneas. Default {@link DEFAULT_RAW_READ_CONCURRENCY}. */
  readonly concurrency?: number
}

/**
 * Executa `task` sobre `items` em janela fixa, preservando a ordem de saida.
 *
 * Um `Promise.all` sobre o array inteiro dispararia N conexoes; um `for await`
 * faria N idas e voltas em serie. A janela e o meio-termo — e a ordem preservada
 * e o que mantem o `--limit` sendo um prefixo estavel.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = next
      next += 1
      if (index >= items.length) return
      results[index] = await task(items[index] as T, index)
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * Cria a fonte dirigida pelo catalogo.
 *
 * `count` responde pelo CATALOGO de proposito: e este numero que vira o
 * denominador do veredito de cobertura, e um denominador tirado do deposito e
 * exatamente o defeito que esta cadeia veio corrigir.
 */
export function createCatalogRawWatchSource(
  options: CatalogRawWatchSourceOptions,
): RawWatchSource {
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_RAW_READ_CONCURRENCY)
  return {
    count(entityType: WatchProvidersEntityType): Promise<number> {
      return options.catalog.count(entityType)
    },
    async list(
      entityType: WatchProvidersEntityType,
      limit: number,
    ): Promise<readonly RawWatchSourceRow[]> {
      const tmdbIds = await options.catalog.listTmdbIds(entityType, limit)
      return mapWithConcurrency(tmdbIds, concurrency, async (tmdbId) => {
        const key: RawEntityKey = {
          entityType,
          tmdbId,
          baseLanguage: options.baseLanguage,
        }
        const read = await options.reader.read(key)
        // `present: false` NAO e um payload vazio: e a afirmacao de que o id
        // existe no catalogo e o bruto nao existe no deposito. O core conta
        // isso como `missing-raw`, um desfecho proprio.
        return read.present
          ? { tmdbId, baseLanguage: options.baseLanguage, payload: read.payload, present: true }
          : { tmdbId, baseLanguage: options.baseLanguage, payload: undefined, present: false }
      })
    },
  }
}
