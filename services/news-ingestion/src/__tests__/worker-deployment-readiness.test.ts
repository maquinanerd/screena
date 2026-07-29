/**
 * worker-deployment-readiness.test.ts — Prontidao de implantacao do worker.
 *
 * O caso que estes testes existem para impedir: subir o worker ANTES da
 * migration publica. Sem a guarda, ele consumiria eventos, falharia na escrita,
 * gastaria tentativas e mandaria para dead-letter materia que estava perfeita —
 * a culpa seria do deploy fora de ordem, e o sintoma apareceria como "erro de
 * projecao".
 */

import { describe, expect, it } from 'vitest'

import {
  evaluateWorkerReadiness,
  type WorkerReadinessInput,
} from '../media/worker-readiness-types.js'
import {
  findMissingSchemaObjects,
  inspectScreenSchema,
  REQUIRED_COLUMNS,
  REQUIRED_TABLES,
} from '../media/screen-schema-preflight.js'
import {
  applyShutdownSignal,
  drainExceeded,
  hasLeaseBudget,
  mayClaimMore,
  mustFinishCurrentBatch,
  INITIAL_SHUTDOWN,
} from '../worker-lifecycle.js'

function facts(overrides: Partial<WorkerReadinessInput> = {}): WorkerReadinessInput {
  return {
    configValid: true,
    configErrors: [],
    screenDatabaseReachable: true,
    missingSchemaObjects: [],
    payloadReachable: true,
    payloadAuthAccepted: true,
    storageReady: true,
    storageDriver: 's3',
    ...overrides,
  }
}

/** Schema publico COMPLETO, montado a partir da propria lista de exigencias. */
function completeSnapshot() {
  const columns: Record<string, string[]> = {}
  for (const table of REQUIRED_TABLES) columns[table] = [...(REQUIRED_COLUMNS[table] ?? [])]
  return { tables: [...REQUIRED_TABLES], columns }
}

describe('readiness do worker', () => {
  it('CONTROLE POSITIVO: ambiente completo fica pronto', () => {
    expect(evaluateWorkerReadiness(facts()).ready).toBe(true)
  })

  it('SCHEMA PUBLICO ATRASADO bloqueia, e diz o que falta', () => {
    const report = evaluateWorkerReadiness(
      facts({ missingSchemaObjects: ['editorial_media_assets'] }),
    )
    expect(report.ready).toBe(false)
    // "schema atrasado" sozinho nao ajuda ninguem: o detalhe nomeia a migration.
    expect(report.checks.find((check) => check.name === 'screen_schema')?.detail).toContain(
      'editorial_media_assets',
    )
  })

  it('banco publico inacessivel bloqueia', () => {
    expect(evaluateWorkerReadiness(facts({ screenDatabaseReachable: false })).ready).toBe(false)
  })

  it('CMS inalcancavel e CREDENCIAL recusada sao bloqueios DISTINTOS', () => {
    // Distinguir os dois e o que faz o diagnostico apontar para a chave em vez
    // de para a rede.
    const semRede = evaluateWorkerReadiness(facts({ payloadReachable: false }))
    expect(semRede.checks.find((check) => check.name === 'payload_reachable')?.status).toBe(
      'blocked',
    )
    const semAuth = evaluateWorkerReadiness(facts({ payloadAuthAccepted: false }))
    expect(semAuth.checks.find((check) => check.name === 'payload_auth')?.status).toBe('blocked')
    expect(semAuth.checks.find((check) => check.name === 'payload_reachable')?.status).toBe('ok')
  })

  it('a readiness NUNCA imprime a API key', () => {
    const report = evaluateWorkerReadiness(facts({ payloadAuthAccepted: false }))
    expect(JSON.stringify(report)).not.toMatch(/API-Key|secret|chave-/i)
  })

  it('storage publico indisponivel bloqueia', () => {
    expect(evaluateWorkerReadiness(facts({ storageReady: false })).ready).toBe(false)
  })

  it('configuracao invalida bloqueia com o NOME da variavel', () => {
    const report = evaluateWorkerReadiness(
      facts({ configValid: false, configErrors: ['SCREEN_DATABASE_URL ausente'] }),
    )
    expect(report.ready).toBe(false)
    expect(report.checks.find((check) => check.name === 'config')?.detail).toContain(
      'SCREEN_DATABASE_URL',
    )
  })
})

describe('preflight do schema publico', () => {
  it('schema completo nao acusa nada', () => {
    expect(findMissingSchemaObjects(completeSnapshot())).toEqual([])
  })

  it('acusa TABELA faltando', () => {
    const snapshot = completeSnapshot()
    const missing = findMissingSchemaObjects({
      ...snapshot,
      tables: snapshot.tables.filter((table) => table !== 'editorial_media_assets'),
    })
    expect(missing).toContain('editorial_media_assets')
  })

  it('acusa COLUNA faltando com nome qualificado', () => {
    // Tabela presente e coluna ausente e o caso da FASE 2C/2D aplicada pela
    // metade — mais dificil de perceber que uma tabela inteira faltando.
    const snapshot = completeSnapshot()
    snapshot.columns.articles = (snapshot.columns.articles ?? []).filter(
      (column) => column !== 'projected_sequence',
    )
    expect(findMissingSchemaObjects(snapshot)).toEqual(['articles.projected_sequence'])
  })

  it('le o banco SOMENTE por information_schema', async () => {
    const queries: string[] = []
    const missing = await inspectScreenSchema({
      queryTables: async () => {
        queries.push('tables')
        return completeSnapshot().tables.map((table) => ({ table_name: table }))
      },
      queryColumns: async () => {
        queries.push('columns')
        const snapshot = completeSnapshot()
        return Object.entries(snapshot.columns).flatMap(([table, columns]) =>
          columns.map((column) => ({ table_name: table, column_name: column })),
        )
      },
    })
    expect(missing).toEqual([])
    expect(queries.sort()).toEqual(['columns', 'tables'])
  })
})

describe('encerramento gracioso', () => {
  const T0 = '2026-07-29T12:00:00.000Z'

  it('depois do sinal, NAO reclama mais nada', () => {
    // Eventos reclamados na janela de encerramento morreriam com lease aberta e
    // ficariam presos ate ela expirar: atraso puro, sem ganho nenhum.
    const draining = applyShutdownSignal(INITIAL_SHUTDOWN, T0)
    expect(mayClaimMore(INITIAL_SHUTDOWN)).toBe(true)
    expect(mayClaimMore(draining)).toBe(false)
  })

  it('mas TERMINA o lote ja reclamado', () => {
    const draining = applyShutdownSignal(INITIAL_SHUTDOWN, T0)
    expect(mustFinishCurrentBatch(draining)).toBe(true)
    expect(mustFinishCurrentBatch({ phase: 'stopped', signalledAtIso: T0 })).toBe(false)
  })

  it('o SEGUNDO sinal nao encurta a drenagem', () => {
    // Quem insiste no Ctrl+C tem pressa; encurtar aqui deixaria eventos com
    // lease aberta justamente nesse caso. O SIGKILL do orquestrador ja cobre.
    const first = applyShutdownSignal(INITIAL_SHUTDOWN, T0)
    const second = applyShutdownSignal(first, '2026-07-29T12:00:05.000Z')
    expect(second.signalledAtIso).toBe(T0)
  })

  it('a drenagem tem teto', () => {
    const draining = applyShutdownSignal(INITIAL_SHUTDOWN, T0)
    expect(drainExceeded(draining, '2026-07-29T12:00:10.000Z')).toBe(false)
    expect(drainExceeded(draining, '2026-07-29T12:00:30.000Z')).toBe(true)
    expect(drainExceeded(INITIAL_SHUTDOWN, T0)).toBe(false)
  })
})

describe('orcamento de lease', () => {
  const claimedAtIso = '2026-07-29T12:00:00.000Z'

  it('ha folga logo apos o claim', () => {
    expect(hasLeaseBudget({ claimedAtIso, nowIso: '2026-07-29T12:00:05.000Z' })).toBe(true)
  })

  it('NAO comeca item novo perto do fim da lease', () => {
    // Comecar faltando 2s significa terminar depois de outro worker ja ter
    // reclamado o mesmo evento — projecao dupla.
    expect(hasLeaseBudget({ claimedAtIso, nowIso: '2026-07-29T12:00:55.000Z' })).toBe(false)
  })

  it('leva em conta a duracao ESTIMADA do item', () => {
    expect(
      hasLeaseBudget({
        claimedAtIso,
        nowIso: '2026-07-29T12:00:20.000Z',
        estimatedItemMs: 40_000,
      }),
    ).toBe(false)
    expect(
      hasLeaseBudget({
        claimedAtIso,
        nowIso: '2026-07-29T12:00:20.000Z',
        estimatedItemMs: 5_000,
      }),
    ).toBe(true)
  })

  it('relogio ILEGIVEL e fail-closed', () => {
    // Continuar as cegas e o unico desfecho que pode causar projecao dupla.
    expect(hasLeaseBudget({ claimedAtIso: 'quando-der', nowIso: claimedAtIso })).toBe(false)
    expect(hasLeaseBudget({ claimedAtIso, nowIso: 'agora' })).toBe(false)
  })
})
