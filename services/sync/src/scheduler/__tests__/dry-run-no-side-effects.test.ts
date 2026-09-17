/**
 * dry-run-no-side-effects.test.ts — SEM `CINERIE_SCHEDULER_APPLY=true`, NENHUMA
 * FILA SAI DO PROCESSO.
 *
 * ============================================================================
 * A PROMESSA, E O QUE O CODIGO FAZIA (medido em 17/09/2026)
 * ============================================================================
 * O cabecalho de `bin/cinerie-scheduler.ts` promete que sem `APPLY` o ciclo roda
 * inteiro — avalia, seleciona, conta e loga — e NAO enfileira nem chama
 * fornecedor: "subir a imagem por engano num projeto errado nao pode virar
 * ingestao".
 *
 * Cinco caminhos de `runtime/runners.ts` nunca olharam `deps.apply`:
 * `runDiscovery`, `runChanges`, `runTrending`, `runPeople` e
 * `enqueueTitleDetails` (`airing_series`, `title_detail_active`,
 * `title_detail_ended`). Em dry-run eles gravavam em `catalog_jobs` de verdade, e
 * um `screen-catalog-worker` apontado para o mesmo banco transformaria o dry-run
 * em requisicao ao TMDB. Era assim desde a primeira versao do agendador
 * (`e676fa5`, 21/08/2026). Dois comentarios posteriores afirmavam que "os runners
 * `enqueue`" ja contavam `dry_run` — a frase foi repetida e nunca medida.
 *
 * ============================================================================
 * COMO ESTE TESTE NAO PASSA DE GRACA
 * ============================================================================
 * Cada fila roda DUAS vezes sobre o MESMO cenario, com `apply: true` e com
 * `apply: false`. O `apply: true` e o controle negativo: se o cenario nao tivesse
 * candidato, ou se um espiao estivesse desligado, ele tambem daria zero — e o
 * teste reprova ali, antes de afirmar qualquer coisa sobre o dry-run.
 *
 * Os efeitos observados sao os jeitos de um ciclo sair do processo:
 *
 *   store.enqueue                          -> `catalog_jobs`
 *   catalogEndpoints.*                     -> TMDB
 *   fetch global                           -> GitHub (e qualquer HTTP cru)
 *   spawn com `--apply` ou `--force`       -> CLI filha autorizada a escrever
 *   INSERT/UPDATE/DELETE cru no Prisma     -> escrita direta
 *   spend[].requests                       -> cota contada
 *
 * O filho SEM `--apply` nao e efeito: e o dry-run da propria CLI (premiacao,
 * Score e busca calculam e relatam sem escrever), e e assim que o agendador
 * avalia essas filas.
 *
 * ============================================================================
 * `runners.ts` E IMPORTAVEL POR TESTE
 * ============================================================================
 * Tres comentarios afirmavam que nao era, porque `@screena/ingestion/runtime`
 * nao tem alias no `vitest.config.ts`. O Vite resolve o subcaminho pelo `exports`
 * do pacote — `trending.test.ts`, nesta mesma pasta, importa esse modulo desde
 * 21/08/2026. O custo real e o client do Prisma GERADO, que `pnpm test` ja exige
 * (`scripts/typecheck/ensure-prisma-client.mjs`) e a CI gera antes dos testes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ForceRequest } from '../force-requests.js'
import { SCHEDULER_QUEUES, type SchedulerQueue } from '../rhythms.js'
import { classifyRun, type RunTally } from '../run-outcome.js'
import { QUEUE_RUNNERS, runForcedTitleRequest, type RunnerDeps } from '../runtime/runners.js'

/** O argv de cada processo filho que um runner tentou subir. */
const { spawnedArgv } = vi.hoisted(() => ({ spawnedArgv: [] as string[][] }))

// O `spawn` real subiria o `tsx` do repositorio contra o banco do ambiente. O
// falso registra o argv e sai com codigo 0 na volta seguinte do laco de eventos,
// depois de `runScript` pendurar os ouvintes — o mesmo contrato que ele le.
vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>()
  const { EventEmitter } = await import('node:events')
  return {
    ...original,
    spawn: (_command: string, args: readonly string[]) => {
      spawnedArgv.push([...args])
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        kill: () => true,
      })
      setImmediate(() => child.emit('exit', 0))
      return child
    },
  }
})

/** As URLs pedidas pelo `fetch` global. */
const fetchedUrls: string[] = []

beforeEach(() => {
  // 404, e nao excecao: o cliente do GitHub nao retenta 4xx, entao o controle
  // com `apply: true` termina na hora em vez de esperar o backoff de rede.
  vi.stubGlobal('fetch', async (input: unknown) => {
    fetchedUrls.push(String(input))
    return new Response('{}', { status: 404 })
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const NOW = new Date('2026-09-17T12:00:00.000Z')

/** Toda selecao devolve dois ids: o laco de enfileirar roda mais de uma vez. */
const CANDIDATE_ROWS = [{ tmdb_id: 101 }, { tmdb_id: 102 }]

/**
 * Um PrismaClient que responde as leituras dos runners e ANOTA as escritas cruas.
 *
 * Qualquer acesso fora de `$queryRawUnsafe`/`$executeRawUnsafe`/`$transaction`
 * (um delegate como `prisma.catalogJob`) REPROVA com o nome do acesso: um runner
 * que passe a escrever por outro caminho nao pode ficar invisivel para este
 * teste.
 */
function fakePrisma(dbWrites: string[]): RunnerDeps['prisma'] {
  const methods: Record<string, unknown> = {
    $queryRawUnsafe: async (sql: string) => {
      if (sql.includes('api_sync_logs')) return [{ spent: 0 }]
      if (sql.includes('discovery_snapshots')) return []
      if (sql.includes('SELECT imdb_id')) return [{ imdb_id: 'tt0111161' }]
      return CANDIDATE_ROWS
    },
    $executeRawUnsafe: async (sql: string) => {
      if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)) dbWrites.push(sql.trim().slice(0, 60))
      return 1
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(proxy),
  }
  const proxy: unknown = new Proxy(methods, {
    get(target, key) {
      if (typeof key === 'symbol' || key === 'then') return undefined
      if (key in target) return target[key]
      throw new Error(
        `prisma falso: acesso nao previsto a "${key}" — ensine este teste a observar esse caminho`,
      )
    },
  })
  return proxy as RunnerDeps['prisma']
}

/** O que um ciclo fez para fora do processo. */
interface Effects {
  readonly enqueued: number
  readonly tmdbCalls: number
  readonly httpCalls: number
  readonly childrenAllowedToWrite: number
  readonly dbWrites: number
  readonly quotaRequests: number
}

const NO_EFFECT: Effects = {
  enqueued: 0,
  tmdbCalls: 0,
  httpCalls: 0,
  childrenAllowedToWrite: 0,
  dbWrites: 0,
  quotaRequests: 0,
}

function sumEffects(effects: Effects): number {
  return Object.values(effects).reduce((sum, value) => sum + value, 0)
}

interface World {
  readonly deps: RunnerDeps
  effects(tally?: RunTally): Effects
}

function world(apply: boolean): World {
  spawnedArgv.length = 0
  fetchedUrls.length = 0
  const enqueued: unknown[] = []
  const tmdbCalls: string[] = []
  const dbWrites: string[] = []

  const deps: RunnerDeps = {
    prisma: fakePrisma(dbWrites),
    services: {
      store: {
        enqueue: async (job) => {
          enqueued.push(job)
          return { created: true }
        },
      },
      // Sem sink de oferta, de proposito: com `apply` o ingest falha DEPOIS da
      // chamada ao endpoint, e a chamada e o efeito medido.
      watch: {},
    },
    catalogEndpoints: {
      getMovieWatchProviders: async (tmdbId) => {
        tmdbCalls.push(`movie:${tmdbId}`)
        return { results: {} }
      },
      getTvWatchProviders: async (tmdbId) => {
        tmdbCalls.push(`tv:${tmdbId}`)
        return { results: {} }
      },
    },
    now: () => NOW,
    log: { log: () => undefined },
    locale: 'pt-BR',
    batchLimit: 5,
    discoveryLimit: 10,
    repoRoot: '/repositorio-de-teste',
    apply,
    github: { token: null, repository: 'maquinanerd/screena' },
  }

  return {
    deps,
    effects: (tally) => ({
      enqueued: enqueued.length,
      tmdbCalls: tmdbCalls.length,
      httpCalls: fetchedUrls.length,
      childrenAllowedToWrite: spawnedArgv.filter(
        (argv) => argv.includes('--apply') || argv.includes('--force'),
      ).length,
      dbWrites: dbWrites.length,
      quotaRequests: (tally?.spend ?? []).reduce((sum, item) => sum + item.requests, 0),
    }),
  }
}

async function runQueue(
  queue: SchedulerQueue,
  apply: boolean,
): Promise<{ readonly tally: RunTally; readonly effects: Effects }> {
  const w = world(apply)
  const tally = await QUEUE_RUNNERS[queue](w.deps)
  return { tally, effects: w.effects(tally) }
}

/**
 * As filas cujo trabalho e ENFILEIRAR. Lista escrita por extenso, e nao derivada:
 * o teste de controle abaixo exige que o cenario as faca enfileirar de verdade,
 * e uma fila nova que enfileire tem de entrar aqui por decisao, nao por acaso.
 */
const ENQUEUEING_QUEUES = [
  'discovery',
  'changes',
  'trending',
  'airing_series',
  'title_media',
  'title_detail_active',
  'title_detail_ended',
  'people',
] as const satisfies readonly SchedulerQueue[]

describe('agendador sem --apply: nenhuma fila sai do processo', () => {
  it('o laco percorre TODA fila da tabela de ritmos — fila nova nao escapa', () => {
    expect(Object.keys(QUEUE_RUNNERS).sort()).toEqual([...SCHEDULER_QUEUES].sort())
  })

  it.each([...SCHEDULER_QUEUES])(
    '%s: com --apply produz efeito; sem --apply, nenhum',
    async (queue) => {
      // CONTROLE NEGATIVO: o MESMO cenario, autorizado a escrever. Se aqui desse
      // zero, o zero do dry-run abaixo nao provaria nada.
      const real = await runQueue(queue, true)
      expect(
        sumEffects(real.effects),
        `${queue} com --apply nao produziu efeito observavel: o cenario ou um espiao esta quebrado`,
      ).toBeGreaterThan(0)

      const dry = await runQueue(queue, false)
      expect(dry.effects).toEqual(NO_EFFECT)
    },
  )

  it('CONTROLE NEGATIVO: com --apply, EXATAMENTE as filas de catalogo enfileiram neste cenario', async () => {
    const enqueueing: SchedulerQueue[] = []
    for (const queue of SCHEDULER_QUEUES) {
      if ((await runQueue(queue, true)).effects.enqueued > 0) enqueueing.push(queue)
    }
    expect(enqueueing.sort()).toEqual([...ENQUEUEING_QUEUES].sort())
  })

  it.each([...ENQUEUEING_QUEUES])(
    '%s: sem --apply CONTA o que deixou de enfileirar',
    async (queue) => {
      const { tally } = await runQueue(queue, false)
      // "Avalia, seleciona, conta": o lote foi montado inteiro...
      expect(tally.planned).toBeGreaterThan(0)
      // ...e nenhum item virou trabalho nem falha.
      expect(tally.processed).toBe(0)
      expect(tally.failed).toBe(0)
      expect(tally.skipped).toBe(tally.planned)
      expect(tally.reasons?.find((reason) => reason.code === 'dry_run')?.count).toBe(tally.planned)
      // Dry-run nao e defeito: o desfecho nao acusa falha a cada tique.
      expect(classifyRun(tally).status).toBe('success')
    },
  )

  it.each(['title_ratings', 'title_score'] as const)(
    'pedido de titulo do painel (%s): com --apply sobe o filho; sem --apply, nada',
    async (kind) => {
      const request: Extract<ForceRequest, { kind: 'title_ratings' | 'title_score' }> = {
        id: 'pedido-de-teste',
        kind,
        entityType: 'movie',
        entityId: '42',
      }

      const real = world(true)
      await runForcedTitleRequest(real.deps, request)
      expect(real.effects().childrenAllowedToWrite).toBe(1)

      const dry = world(false)
      const result = await runForcedTitleRequest(dry.deps, request)
      expect(dry.effects()).toEqual(NO_EFFECT)
      expect(spawnedArgv).toEqual([])
      expect(result.status).toBe('failed')
      expect(result.detail).toContain('dry-run')
    },
  )
})
