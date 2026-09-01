/**
 * failure-error-code.test.ts — TODA falha do ciclo carrega causa em `api_sync_logs`.
 *
 * ============================================================================
 * O DEFEITO QUE ESTE ARQUIVO TRAVA
 * ============================================================================
 * A linha de `api_sync_logs` do ciclo gravava `errorCode: providerRefusalCode`, e
 * `providerRefusalCode` so e preenchido no caminho da recusa DECLARADA pela OMDb
 * (`quota`/`auth`, que chegam com HTTP 200). Toda falha de REDE/HTTP saia com
 * `status='failed'` e `error_code` NULL.
 *
 * Medido em producao em 2026-09-01: **75 de 77 falhas sem `error_code`**. As duas
 * que tinham eram as recusas do fornecedor. As 75 restantes eram exatamente as
 * que alguem precisava ler para saber por que a fila de notas nao produzia — e a
 * auditoria teve de registrar a causa como NAO DETERMINADA, porque o unico lugar
 * onde ela existia era o stdout de um processo que ja havia terminado.
 *
 * O dado nunca faltou: `describeItemFetchError` ja calculava o codigo por item e
 * o guardava em `OmdbItemResult.errorCode`. Ele era descartado na hora de
 * escrever o log do ciclo.
 *
 * Isto viola "todo sync externo gera log" no ponto que importa: um log que
 * registra a EXISTENCIA da falha e omite a CAUSA nao e auditoria, e carimbo.
 *
 * ============================================================================
 * POR QUE UM ARQUIVO SEPARADO
 * ============================================================================
 * `run.test.ts` prova o COMPORTAMENTO do lote (aborta, pula fresco, grava nota).
 * Este prova a OBSERVABILIDADE do lote — a propriedade que, quando quebra, nao
 * quebra nada visivel: o worker continua rodando, o painel continua verde, e so
 * o diagnostico fica impossivel. Separar deixa a regressao legivel pelo nome do
 * arquivo que reprova.
 */

import { OMDB_PROVIDER_API } from '@screena/omdb-client'
import { describe, expect, it } from 'vitest'

import type {
  CacheWriteInput,
  ExternalRatingsPort,
  StaleEntityCandidateSelectPort,
  SyncLogInput,
} from '../../ports.js'
import { resolveCycleErrorCode, runOmdbRatingsSync } from '../run.js'
import { OMDB_GUARDIANS_PAYLOAD } from './fixture.js'

const NOW = new Date('2026-09-01T12:00:00.000Z')

const BASE_OPTIONS = {
  entityType: 'movie' as const,
  id: null,
  limit: null,
  providerApi: OMDB_PROVIDER_API,
  cacheTtlMs: 1000,
  ignoreFreshness: false,
}

interface Recorder {
  readonly syncLogs: SyncLogInput[]
  readonly cacheWrites: CacheWriteInput[]
  readonly deps: {
    readonly cache: { write(input: CacheWriteInput): Promise<void> }
    readonly syncLog: { write(input: SyncLogInput): Promise<void> }
    readonly entities: {
      findByImdbId(
        entityType: 'movie' | 'tv',
        imdbId: string,
      ): Promise<{ entityType: 'movie' | 'tv'; entityId: string }>
      findByTmdbId(): Promise<null>
    }
    readonly ratings: ExternalRatingsPort
  }
}

function recorder(): Recorder {
  const syncLogs: SyncLogInput[] = []
  const cacheWrites: CacheWriteInput[] = []
  return {
    syncLogs,
    cacheWrites,
    deps: {
      cache: {
        async write(input) {
          cacheWrites.push(input)
        },
      },
      syncLog: {
        async write(input) {
          syncLogs.push(input)
        },
      },
      entities: {
        async findByImdbId(entityType, imdbId) {
          return { entityType, entityId: `local-${imdbId}` }
        },
        async findByTmdbId() {
          return null
        },
      },
      ratings: {
        async upsert() {
          return { created: true, changed: true }
        },
      },
    },
  }
}

function candidatesPort(ids: readonly string[]): StaleEntityCandidateSelectPort {
  return {
    async selectStaleByType(input) {
      return {
        candidates: ids.map((id, index) => ({
          entityType: input.entityType,
          entityId: String(index + 1),
          imdbId: id,
          tmdbId: null,
        })),
        skippedFresh: 0,
      }
    },
  }
}

/** Um erro com `name` proprio — e dele que sai o codigo por item. */
function namedError(name: string, message: string): Error {
  const error = new Error(message)
  error.name = name
  return error
}

describe('resolveCycleErrorCode — a precedencia, isolada', () => {
  it('a recusa do fornecedor DOMINA o codigo dos itens', () => {
    // Cota e fato sobre o DIA; o que os itens relataram e consequencia dela.
    const code = resolveCycleErrorCode('quota', [
      { ok: false, errorCode: 'TimeoutError' },
      { ok: false, errorCode: 'TimeoutError' },
    ])
    expect(code).toBe('quota')
  })

  it('sem recusa, devolve o codigo DOMINANTE entre os itens que falharam', () => {
    const code = resolveCycleErrorCode(null, [
      { ok: false, errorCode: 'TimeoutError' },
      { ok: false, errorCode: 'FetchError' },
      { ok: false, errorCode: 'FetchError' },
    ])
    expect(code).toBe('FetchError')
  })

  it('empate resolve pela PRIMEIRA ocorrencia (ordem estavel entre ciclos)', () => {
    // Sem desempate estavel, dois ciclos com exatamente as mesmas falhas
    // gravariam codigos diferentes, e o operador leria variacao onde nao ha.
    const code = resolveCycleErrorCode(null, [
      { ok: false, errorCode: 'TimeoutError' },
      { ok: false, errorCode: 'FetchError' },
    ])
    expect(code).toBe('TimeoutError')
  })

  it('itens que deram CERTO nao contribuem com codigo', () => {
    const code = resolveCycleErrorCode(null, [
      { ok: true, errorCode: null },
      { ok: false, errorCode: 'TimeoutError' },
    ])
    expect(code).toBe('TimeoutError')
  })

  it('CONTROLE NEGATIVO: ciclo sem falha nenhuma continua com codigo NULO', () => {
    // Sem este controle, um resolvedor que devolvesse uma string fixa passaria
    // em todos os testes acima — e todo ciclo de sucesso gravaria uma causa
    // inventada, que e pior do que a ausencia que este arquivo conserta.
    expect(resolveCycleErrorCode(null, [{ ok: true, errorCode: null }])).toBeNull()
    expect(resolveCycleErrorCode(null, [])).toBeNull()
  })
})

describe('o log do ciclo NUNCA registra falha sem causa', () => {
  it('falha de rede em TODOS os ids grava status=failed COM error_code', async () => {
    const r = recorder()
    let attempts = 0

    const result = await runOmdbRatingsSync(
      { ...BASE_OPTIONS, apply: true, sample: false },
      {
        fetchTitle: async () => {
          attempts += 1
          throw namedError('TimeoutError', 'a rede nao respondeu')
        },
        cache: r.deps.cache,
        syncLog: r.deps.syncLog,
        entities: r.deps.entities,
        candidates: candidatesPort(['tt1', 'tt2', 'tt3']),
        ratings: r.deps.ratings,
        now: () => NOW,
        requestCount: () => attempts,
      },
    )

    expect(result.status).toBe('failed')

    // A REGRESSAO QUE ISTO PEGA: antes, esta linha vinha com `error_code: null`.
    const log = r.syncLogs.at(-1)
    expect(log?.status).toBe('failed')
    expect(log?.errorCode).not.toBeNull()
    expect(log?.errorCode).toBe('TimeoutError')

    // O relatorio em disco conta a MESMA historia que a linha do banco.
    expect(result.errorCode).toBe(log?.errorCode)
  })

  it('ciclo PARCIAL (uma falha no meio) tambem carrega a causa', async () => {
    // `partial` e o desfecho que mais esconde degradacao: ele parece saudavel
    // ate virar `failed`. Sem codigo aqui, ninguem ve a deterioracao chegando.
    const r = recorder()
    let call = 0

    const result = await runOmdbRatingsSync(
      { ...BASE_OPTIONS, apply: true, sample: false },
      {
        fetchTitle: async () => {
          call += 1
          if (call === 2) throw namedError('FetchError', 'conexao recusada')
          return OMDB_GUARDIANS_PAYLOAD
        },
        cache: r.deps.cache,
        syncLog: r.deps.syncLog,
        entities: r.deps.entities,
        candidates: candidatesPort(['tt1', 'tt2', 'tt3']),
        ratings: r.deps.ratings,
        now: () => NOW,
        requestCount: () => call,
      },
    )

    expect(result.status).toBe('partial')
    expect(r.syncLogs.at(-1)?.errorCode).toBe('FetchError')
  })

  it('CONTROLE NEGATIVO: ciclo de SUCESSO nao ganha error_code', async () => {
    // Sem isto, "sempre grave um codigo" seria satisfeito por um codigo
    // constante, e `error_code` deixaria de significar "houve falha".
    const r = recorder()
    let call = 0

    const result = await runOmdbRatingsSync(
      { ...BASE_OPTIONS, apply: true, sample: false },
      {
        fetchTitle: async () => {
          call += 1
          return OMDB_GUARDIANS_PAYLOAD
        },
        cache: r.deps.cache,
        syncLog: r.deps.syncLog,
        entities: r.deps.entities,
        candidates: candidatesPort(['tt1']),
        ratings: r.deps.ratings,
        now: () => NOW,
        requestCount: () => call,
      },
    )

    expect(result.status).toBe('success')
    expect(r.syncLogs.at(-1)?.errorCode).toBeNull()
  })
})
