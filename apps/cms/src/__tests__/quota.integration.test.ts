/**
 * Quota de autopublicacao contra PostgreSQL 16 REAL.
 *
 * O que este arquivo prova nao da para provar com mock: um contador so recusa
 * de verdade se o incremento e a checagem forem a MESMA operacao no banco. Um
 * duplo `payload.create` em teste unitario nunca dispara a corrida — ele roda
 * sequencial.
 *
 * As transacoes aqui sao abertas a mao (`initTransaction`/`commitTransaction`/
 * `killTransaction`) porque so assim da para segurar duas abertas ao mesmo tempo
 * e faze-las colidir de proposito.
 *
 * ISOLAMENTO ENTRE CENARIOS: cada cenario usa uma `localDate` propria. A data e
 * parte da chave do contador, entao datas diferentes sao baldes diferentes — sem
 * TRUNCATE entre testes e sem ordem obrigatoria.
 */

import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { commitTransaction, initTransaction, killTransaction, type Payload, type PayloadRequest } from 'payload'

import { consumeQuotas, findPreviousConsumption, recordConsumption, type QuotaWindow } from '../quota-store.js'
import type { QuotaPlanInput } from '../quota.js'
import { startCmsHarness, type CmsHarness } from './harness.js'

let harness: CmsHarness
let payload: Payload

beforeAll(async () => {
  harness = await startCmsHarness()
  payload = harness.payload
}, 900_000)

afterAll(async () => {
  await harness?.stop()
}, 180_000)

/* ------------------------------------------------------------------ */
/* Utilitarios                                                        */
/* ------------------------------------------------------------------ */

function windowFor(localDate: string): QuotaWindow {
  return {
    timeZone: 'America/Sao_Paulo',
    localDate,
    windowStartUtcIso: `${localDate}T03:00:00.000Z`,
    windowEndUtcIso: `${localDate}T03:00:00.000Z`,
  }
}

type Limits = QuotaPlanInput['limits']

// Anotado de proposito: sem o tipo, o TypeScript infere `null` literal em cada
// campo e `Partial<typeof NO_LIMITS>` passa a recusar qualquer numero.
const NO_LIMITS: Limits = {
  dailyLimit: null,
  perAuthorLimit: null,
  perSectionLimit: null,
  perContentTypeLimit: null,
  perArticleUpdateLimit: null,
}

interface Attempt {
  readonly publicationIntent?: 'publish' | 'update'
  readonly contentType?: string
  readonly section?: string | null
  readonly publicAuthorId?: string
  readonly targetArticleId?: string | null
  readonly limits?: Partial<Limits>
  /** Trabalho extra DENTRO da transacao, depois da reserva. Lancar => rollback. */
  readonly afterReserve?: (req: PayloadRequest) => Promise<void>
}

/**
 * Uma tentativa completa: abre transacao, reserva, roda o trabalho extra e
 * commita — ou derruba tudo se algo lancar.
 *
 * Devolve `'ok'`, o codigo da recusa, ou `'error:<motivo>'`. Nunca lanca: uma
 * excecao vazando aqui mataria o `Promise.all` das corridas e esconderia o
 * resultado das concorrentes.
 */
async function attempt(input: Attempt, window: QuotaWindow): Promise<string> {
  const req = { payload } as unknown as PayloadRequest
  await initTransaction(req)
  try {
    const reservation = await consumeQuotas(req, window, {
      publicationIntent: input.publicationIntent ?? 'publish',
      contentType: input.contentType ?? 'news',
      section: input.section === undefined ? 'cinema' : input.section,
      publicAuthorId: input.publicAuthorId ?? 'author-1',
      targetArticleId: input.targetArticleId ?? null,
      limits: { ...NO_LIMITS, ...input.limits },
    })

    if (!reservation.ok) {
      // Recusa NAO e erro: a transacao e desfeita para nao deixar consumida
      // nenhuma das dimensoes anteriores.
      await killTransaction(req)
      return reservation.code
    }

    if (input.afterReserve !== undefined) await input.afterReserve(req)

    await commitTransaction(req)
    return 'ok'
  } catch (error) {
    await killTransaction(req)
    return `error:${error instanceof Error ? error.message : 'desconhecido'}`
  }
}

/** Valor atual do contador. `null` = a linha nem existe. */
async function counterValue(
  window: QuotaWindow,
  dimension: string,
  key: string,
): Promise<number | null> {
  const found = await payload.find({
    collection: 'autopublish-quota-counters',
    where: {
      and: [
        { timeZone: { equals: window.timeZone } },
        { localDate: { equals: window.localDate } },
        { dimensionType: { equals: dimension } },
        { dimensionKey: { equals: key } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const doc = found.docs[0] as { currentCount?: unknown } | undefined
  if (doc === undefined) return null
  return Number(doc.currentCount)
}

/* ------------------------------------------------------------------ */
/* 1. CONCORRENCIA REAL                                               */
/* ------------------------------------------------------------------ */

describe('concorrencia: o teto vale sob corrida', () => {
  it('teto 1 com DUAS transacoes simultaneas — exatamente uma passa', async () => {
    // O caso que motivou a tabela. Com `SELECT COUNT` + publicar, as duas leem
    // zero, as duas concluem que cabe, e o dia fecha com 2 num teto de 1.
    const window = windowFor('2026-01-01')
    const results = await Promise.all([
      attempt({ limits: { dailyLimit: 1 } }, window),
      attempt({ limits: { dailyLimit: 1 } }, window),
    ])

    expect(results.filter((r) => r === 'ok')).toHaveLength(1)
    expect(results.filter((r) => r === 'AUTO_PUBLISH_GLOBAL_DAILY_LIMIT_REACHED')).toHaveLength(1)
    expect(await counterValue(window, 'global', 'all')).toBe(1)
  }, 120_000)

  it('teto 10 com 10 simultaneas — todas passam e o contador fecha em 10', async () => {
    const window = windowFor('2026-01-02')
    const results = await Promise.all(
      Array.from({ length: 10 }, () => attempt({ limits: { dailyLimit: 10 } }, window)),
    )

    expect(results.every((r) => r === 'ok')).toBe(true)
    expect(await counterValue(window, 'global', 'all')).toBe(10)
  }, 180_000)

  it('teto 10 com 11 simultaneas — passam 10, a 11a e recusada', async () => {
    // A prova de que nao ha overshoot: 11 concorrentes nao viram 11 aceitas nem
    // 9 por excesso de zelo.
    const window = windowFor('2026-01-03')
    const results = await Promise.all(
      Array.from({ length: 11 }, () => attempt({ limits: { dailyLimit: 10 } }, window)),
    )

    expect(results.filter((r) => r === 'ok')).toHaveLength(10)
    expect(results.filter((r) => r === 'AUTO_PUBLISH_GLOBAL_DAILY_LIMIT_REACHED')).toHaveLength(1)
    expect(await counterValue(window, 'global', 'all')).toBe(10)
  }, 180_000)

  it('autores diferentes NAO disputam o mesmo balde', async () => {
    const window = windowFor('2026-01-04')
    const results = await Promise.all([
      attempt({ publicAuthorId: 'ana', limits: { perAuthorLimit: 1 } }, window),
      attempt({ publicAuthorId: 'bruno', limits: { perAuthorLimit: 1 } }, window),
    ])

    expect(results).toEqual(['ok', 'ok'])
    expect(await counterValue(window, 'author', 'ana')).toBe(1)
    expect(await counterValue(window, 'author', 'bruno')).toBe(1)
  }, 120_000)

  it('MESMO autor em corrida — o teto do autor segura', async () => {
    const window = windowFor('2026-01-05')
    const results = await Promise.all([
      attempt({ publicAuthorId: 'ana', limits: { perAuthorLimit: 1 } }, window),
      attempt({ publicAuthorId: 'ana', limits: { perAuthorLimit: 1 } }, window),
      attempt({ publicAuthorId: 'ana', limits: { perAuthorLimit: 1 } }, window),
    ])

    expect(results.filter((r) => r === 'ok')).toHaveLength(1)
    expect(results.filter((r) => r === 'AUTO_PUBLISH_AUTHOR_DAILY_LIMIT_REACHED')).toHaveLength(2)
    expect(await counterValue(window, 'author', 'ana')).toBe(1)
  }, 120_000)

  it('teto de SECAO recusa sem tocar o teto global', async () => {
    const window = windowFor('2026-01-06')
    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        attempt({ section: 'cinema', limits: { dailyLimit: 100, perSectionLimit: 1 } }, window),
      ),
    )

    expect(results.filter((r) => r === 'ok')).toHaveLength(1)
    expect(results.filter((r) => r === 'AUTO_PUBLISH_SECTION_DAILY_LIMIT_REACHED')).toHaveLength(2)
    expect(await counterValue(window, 'section', 'cinema')).toBe(1)
    // AS RECUSADAS NAO DEIXAM RASTRO NO GLOBAL. Este e o ponto: `global` vem
    // ANTES de `section` na ordem de aquisicao, entao as tres incrementaram o
    // global antes de esbarrar na secao. Se o rollback nao levasse o contador
    // junto, o global fecharia em 3 e duas publicacoes que NUNCA aconteceram
    // teriam consumido o dia.
    expect(await counterValue(window, 'global', 'all')).toBe(1)
  }, 120_000)

  it('teto de contentType separa news de review', async () => {
    const window = windowFor('2026-01-07')
    const results = await Promise.all([
      attempt({ contentType: 'news', limits: { perContentTypeLimit: 1 } }, window),
      attempt({ contentType: 'news', limits: { perContentTypeLimit: 1 } }, window),
      attempt({ contentType: 'review', limits: { perContentTypeLimit: 1 } }, window),
    ])

    expect(results.filter((r) => r === 'ok')).toHaveLength(2)
    expect(
      results.filter((r) => r === 'AUTO_PUBLISH_CONTENT_TYPE_DAILY_LIMIT_REACHED'),
    ).toHaveLength(1)
    expect(await counterValue(window, 'content_type', 'news')).toBe(1)
    expect(await counterValue(window, 'content_type', 'review')).toBe(1)
  }, 120_000)

  it('teto de reescrita limita UM artigo sem limitar os outros', async () => {
    const window = windowFor('2026-01-08')
    const update = (targetArticleId: string) =>
      attempt(
        {
          publicationIntent: 'update',
          targetArticleId,
          limits: { perArticleUpdateLimit: 2 },
        },
        window,
      )

    const sameArticle = await Promise.all([update('art-1'), update('art-1'), update('art-1')])
    expect(sameArticle.filter((r) => r === 'ok')).toHaveLength(2)
    expect(
      sameArticle.filter((r) => r === 'AUTO_PUBLISH_ARTICLE_UPDATE_LIMIT_REACHED'),
    ).toHaveLength(1)

    // Outro artigo tem balde proprio: o teto e por materia, nao por dia.
    expect(await update('art-2')).toBe('ok')
    expect(await counterValue(window, 'article_update', 'art-1')).toBe(2)
    expect(await counterValue(window, 'article_update', 'art-2')).toBe(1)
  }, 180_000)

  it('teto ZERO recusa sem sequer criar a linha', async () => {
    const window = windowFor('2026-01-09')
    expect(await attempt({ limits: { dailyLimit: 0 } }, window)).toBe(
      'AUTO_PUBLISH_GLOBAL_DAILY_LIMIT_REACHED',
    )
    expect(await counterValue(window, 'global', 'all')).toBeNull()
  }, 120_000)

  it('dimensao sem teto nao cria linha nenhuma', async () => {
    const window = windowFor('2026-01-10')
    expect(await attempt({ limits: {} }, window)).toBe('ok')
    expect(await counterValue(window, 'global', 'all')).toBeNull()
    expect(await counterValue(window, 'author', 'author-1')).toBeNull()
  }, 120_000)
})

/* ------------------------------------------------------------------ */
/* 2. ROLLBACK                                                        */
/* ------------------------------------------------------------------ */

describe('rollback: contador e publicacao vivem e morrem juntos', () => {
  it('falha DEPOIS da reserva nao deixa contador incrementado', async () => {
    const window = windowFor('2026-02-01')
    const result = await attempt(
      {
        limits: { dailyLimit: 5 },
        afterReserve: async () => {
          throw new Error('persistencia falhou')
        },
      },
      window,
    )

    expect(result).toBe('error:persistencia falhou')
    expect(await counterValue(window, 'global', 'all')).toBeNull()
  }, 120_000)

  it('erro do PostgreSQL no meio da transacao desfaz a reserva', async () => {
    // Erro REAL do banco, nao um `throw` do JavaScript: e o unico jeito de
    // provar que a transacao morre de verdade e nao so que o codigo abortou.
    const window = windowFor('2026-02-02')
    const result = await attempt(
      {
        limits: { dailyLimit: 5 },
        afterReserve: async (req) => {
          await payload.create({
            collection: 'autopublish-quota-usage',
            // `sourceRevision` e NOT NULL: o insert quebra no banco.
            data: { requestId: randomUUID() } as never,
            overrideAccess: true,
            req,
          })
        },
      },
      window,
    )

    expect(result).toMatch(/^error:/)
    expect(await counterValue(window, 'global', 'all')).toBeNull()
  }, 120_000)

  it('rollback de uma tentativa nao apaga o contador de outra ja commitada', async () => {
    // Isolamento no sentido inverso: desfazer a minha reserva nao pode desfazer
    // a de quem ja publicou.
    const window = windowFor('2026-02-03')
    expect(await attempt({ limits: { dailyLimit: 5 } }, window)).toBe('ok')
    expect(await counterValue(window, 'global', 'all')).toBe(1)

    await attempt(
      {
        limits: { dailyLimit: 5 },
        afterReserve: async () => {
          throw new Error('falha simulada')
        },
      },
      window,
    )

    expect(await counterValue(window, 'global', 'all')).toBe(1)
  }, 120_000)

  it('reserva parcial: a dimensao ANTERIOR a recusa tambem e desfeita', async () => {
    const window = windowFor('2026-02-04')
    const result = await attempt(
      { section: 'series', limits: { dailyLimit: 10, perSectionLimit: 0 } },
      window,
    )

    expect(result).toBe('AUTO_PUBLISH_SECTION_DAILY_LIMIT_REACHED')
    // `global` foi incrementado antes de `section` recusar. Sem o rollback, uma
    // publicacao recusada teria consumido o teto do dia.
    expect(await counterValue(window, 'global', 'all')).toBeNull()
  }, 120_000)

  it('o registro de consumo tambem some no rollback', async () => {
    const window = windowFor('2026-02-05')
    const requestId = `req-rollback-${randomUUID()}`

    await attempt(
      {
        limits: { dailyLimit: 5 },
        afterReserve: async (req) => {
          await recordConsumption(req, {
            requestId,
            idempotencyKey: 'k',
            sourceClusterId: 'c',
            sourceRevision: 1,
            articleId: null,
            publicAuthorId: 'author-1',
            publicationIntent: 'publish',
            window,
            dimensionsConsumed: [{ dimension: 'global', key: 'all', limit: 5 }],
            serviceAccountId: 'svc',
            pipelineVersion: 'test@1',
            consumedAtIso: new Date().toISOString(),
          })
          throw new Error('falha depois do registro')
        },
      },
      window,
    )

    const req = { payload } as unknown as PayloadRequest
    expect(await findPreviousConsumption(req, requestId)).toBeNull()
    expect(await counterValue(window, 'global', 'all')).toBeNull()
  }, 120_000)

  it('commit bem-sucedido persiste contador E registro juntos', async () => {
    const window = windowFor('2026-02-06')
    const requestId = `req-ok-${randomUUID()}`

    const result = await attempt(
      {
        limits: { dailyLimit: 5 },
        afterReserve: async (req) => {
          await recordConsumption(req, {
            requestId,
            idempotencyKey: 'k',
            sourceClusterId: 'c',
            sourceRevision: 1,
            articleId: null,
            publicAuthorId: 'author-1',
            publicationIntent: 'publish',
            window,
            dimensionsConsumed: [{ dimension: 'global', key: 'all', limit: 5 }],
            serviceAccountId: 'svc',
            pipelineVersion: 'test@1',
            consumedAtIso: new Date().toISOString(),
          })
        },
      },
      window,
    )

    expect(result).toBe('ok')
    expect(await counterValue(window, 'global', 'all')).toBe(1)
    const req = { payload } as unknown as PayloadRequest
    expect(await findPreviousConsumption(req, requestId)).not.toBeNull()
  }, 120_000)
})

/* ------------------------------------------------------------------ */
/* 3. IDEMPOTENCIA                                                    */
/* ------------------------------------------------------------------ */

describe('idempotencia do consumo', () => {
  it('o mesmo requestId nao consegue registrar duas vezes', async () => {
    // A unique em `requestId` e a ultima linha de defesa: se dois envios do
    // mesmo pedido passarem juntos pela consulta previa, o segundo derruba a
    // propria transacao — e nenhum contador dele sobrevive.
    const window = windowFor('2026-03-01')
    const requestId = `req-dup-${randomUUID()}`

    const record = (req: PayloadRequest) =>
      recordConsumption(req, {
        requestId,
        idempotencyKey: 'k',
        sourceClusterId: 'c',
        sourceRevision: 1,
        articleId: null,
        publicAuthorId: 'author-1',
        publicationIntent: 'publish',
        window,
        dimensionsConsumed: [{ dimension: 'global', key: 'all', limit: 5 }],
        serviceAccountId: 'svc',
        pipelineVersion: 'test@1',
        consumedAtIso: new Date().toISOString(),
      })

    expect(await attempt({ limits: { dailyLimit: 5 }, afterReserve: record }, window)).toBe('ok')
    const second = await attempt({ limits: { dailyLimit: 5 }, afterReserve: record }, window)

    expect(second).toMatch(/^error:/)
    // O contador ficou em 1: a segunda tentativa nao consumiu nada.
    expect(await counterValue(window, 'global', 'all')).toBe(1)
  }, 120_000)
})

/* ------------------------------------------------------------------ */
/* 4. JANELA DIARIA                                                   */
/* ------------------------------------------------------------------ */

describe('janela: o teto e do DIA CIVIL da redacao', () => {
  it('dias diferentes tem baldes diferentes', async () => {
    const dia1 = windowFor('2026-04-01')
    const dia2 = windowFor('2026-04-02')

    expect(await attempt({ limits: { dailyLimit: 1 } }, dia1)).toBe('ok')
    expect(await attempt({ limits: { dailyLimit: 1 } }, dia1)).toBe(
      'AUTO_PUBLISH_GLOBAL_DAILY_LIMIT_REACHED',
    )
    // O dia seguinte comeca zerado.
    expect(await attempt({ limits: { dailyLimit: 1 } }, dia2)).toBe('ok')
  }, 120_000)

  it('fusos diferentes NAO compartilham o balde do mesmo rotulo de data', async () => {
    // `2026-04-03` em Sao Paulo e `2026-04-03` em Toquio cobrem intervalos
    // diferentes de tempo real. Reaproveitar a linha faria o teto valer para
    // uma janela que ninguem escolheu.
    const saoPaulo = windowFor('2026-04-03')
    const toquio: QuotaWindow = { ...saoPaulo, timeZone: 'Asia/Tokyo' }

    expect(await attempt({ limits: { dailyLimit: 1 } }, saoPaulo)).toBe('ok')
    expect(await attempt({ limits: { dailyLimit: 1 } }, toquio)).toBe('ok')
    expect(await counterValue(saoPaulo, 'global', 'all')).toBe(1)
    expect(await counterValue(toquio, 'global', 'all')).toBe(1)
  }, 120_000)

  it('o teto vigente fica gravado no contador para auditoria', async () => {
    const window = windowFor('2026-04-04')
    await attempt({ limits: { dailyLimit: 7 } }, window)

    const found = await payload.find({
      collection: 'autopublish-quota-counters',
      where: {
        and: [
          { localDate: { equals: window.localDate } },
          { dimensionType: { equals: 'global' } },
        ],
      },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    const doc = found.docs[0] as { limitSnapshot?: unknown; windowEndUtc?: unknown } | undefined
    expect(Number(doc?.limitSnapshot)).toBe(7)
    expect(doc?.windowEndUtc).toBeDefined()
  }, 120_000)
})
