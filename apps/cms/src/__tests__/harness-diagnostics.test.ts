/**
 * Diagnostico do harness: uma causa, uma mensagem.
 *
 * O defeito que estes testes travam: as tres falhas possiveis saiam com o MESMO
 * texto ("a Local API do Payload NAO esta no banco que o harness migrou"), que
 * descreve so uma delas. Quem investigava ia para o lugar errado.
 */

import { describe, expect, it } from 'vitest'

import {
  decideMigrationOutcome,
  describeDatabaseFailure,
  describeSchemaDiagnosis,
  diagnoseSchema,
  isDatabaseGoneError,
  type SchemaExpectation,
  type SchemaProbe,
} from './harness-diagnostics.js'

const EXPECTED: SchemaExpectation = { database: 'cinerie_cms_integration', port: 43749 }

function observed(overrides: Partial<{
  database: string
  port: number
  editorialUsersPresent: boolean
}> = {}): SchemaProbe {
  return {
    kind: 'observed',
    observation: {
      database: EXPECTED.database,
      port: EXPECTED.port,
      editorialUsersPresent: true,
      ...overrides,
    },
  }
}

describe('diagnoseSchema', () => {
  it('banco certo, porta certa e tabela presente => ok', () => {
    expect(diagnoseSchema(EXPECTED, observed())).toBe('ok')
  })

  it('sem resposta => database_gone, e NAO wrong_database', () => {
    // O caso que mais confundia: um banco morto nao devolve linha nenhuma, e a
    // guarda antiga lia isso como "banco divergente".
    const probe: SchemaProbe = {
      kind: 'unreachable',
      detail: 'terminating connection due to administrator command (code=57P01)',
    }
    expect(diagnoseSchema(EXPECTED, probe)).toBe('database_gone')
  })

  it('database divergente => wrong_database', () => {
    expect(diagnoseSchema(EXPECTED, observed({ database: 'outro_banco' }))).toBe('wrong_database')
  })

  it('porta divergente => wrong_database', () => {
    expect(diagnoseSchema(EXPECTED, observed({ port: 1234 }))).toBe('wrong_database')
  })

  it('banco certo mas sem editorial_users => missing_migrations', () => {
    // A flake real: db e porta batiam, so a migration nao tinha chegado.
    expect(diagnoseSchema(EXPECTED, observed({ editorialUsersPresent: false }))).toBe(
      'missing_migrations',
    )
  })

  it('sem resposta tem precedencia sobre divergencia de banco', () => {
    // Controle negativo do caso acima: um banco morto produz db='' e porta=0,
    // que se parece com divergencia. A precedencia impede o diagnostico errado.
    const probe: SchemaProbe = { kind: 'unreachable', detail: 'Connection terminated unexpectedly' }
    expect(diagnoseSchema({ database: '', port: 0 }, probe)).toBe('database_gone')
  })
})

describe('describeSchemaDiagnosis', () => {
  const migrationOutput = 'INFO: Migrating: 20260728_224559_initial'

  it('banco caido diz que a conexao morreu e NAO fala de schema', () => {
    const probe: SchemaProbe = { kind: 'unreachable', detail: 'admin shutdown (code=57P01)' }
    const message = describeSchemaDiagnosis('database_gone', {
      expected: EXPECTED,
      probe,
      migrationOutput,
    })

    expect(message).toContain('o PostgreSQL efemero NAO respondeu')
    expect(message).toContain('admin shutdown (code=57P01)')
    // O texto antigo nunca pode reaparecer aqui: era ele que mandava o
    // investigador procurar divergencia de banco onde nao havia.
    expect(message).not.toContain('esta em OUTRO banco')
    expect(message).not.toContain('migrations NAO chegaram')
  })

  it('banco divergente mostra esperado e obtido lado a lado', () => {
    const message = describeSchemaDiagnosis('wrong_database', {
      expected: EXPECTED,
      probe: observed({ database: 'outro_banco', port: 5432 }),
      migrationOutput,
    })

    expect(message).toContain('esta em OUTRO banco')
    expect(message).toContain('esperado: db=cinerie_cms_integration porta=43749')
    expect(message).toContain('obtido:   db=outro_banco porta=5432')
  })

  it('migration ausente afirma que o banco esta CERTO e nomeia a causa conhecida', () => {
    const message = describeSchemaDiagnosis('missing_migrations', {
      expected: EXPECTED,
      probe: observed({ editorialUsersPresent: false }),
      migrationOutput,
    })

    expect(message).toContain('as migrations NAO chegaram a este banco')
    expect(message).toContain('CERTOS')
    expect(message).toContain('void start()')
    expect(message).not.toContain('esta em OUTRO banco')
  })

  it('saida vazia do migrate e apontada como sintoma, nao como "(vazia)" seco', () => {
    const message = describeSchemaDiagnosis('missing_migrations', {
      expected: EXPECTED,
      probe: observed({ editorialUsersPresent: false }),
      migrationOutput: '   \n  ',
    })

    expect(message).toContain('o CLI nao chegou a registrar nada')
  })
})

describe('isDatabaseGoneError', () => {
  it('reconhece o 57P01 do fast shutdown', () => {
    expect(isDatabaseGoneError({ code: '57P01', severity: 'FATAL' })).toBe(true)
  })

  it('reconhece socket fechado', () => {
    expect(isDatabaseGoneError({ code: 'ECONNREFUSED' })).toBe(true)
  })

  it('reconhece a mensagem do pool sem code', () => {
    expect(isDatabaseGoneError(new Error('Connection terminated unexpectedly'))).toBe(true)
  })

  it('NAO confunde erro de SQL com banco caido', () => {
    // Controle negativo: violacao de unique e um erro de aplicacao, e alguns
    // testes a provocam DE PROPOSITO (a idempotencia da quota). Classificar
    // isso como "o banco caiu" reintroduziria a confusao original.
    expect(
      isDatabaseGoneError({
        code: '23505',
        message: 'duplicate key value violates unique constraint "autopublish_quota_usage_request_id_idx"',
      }),
    ).toBe(false)
  })

  it('NAO trata valores nao-erro como banco caido', () => {
    expect(isDatabaseGoneError(null)).toBe(false)
    expect(isDatabaseGoneError('57P01')).toBe(false)
    expect(isDatabaseGoneError(undefined)).toBe(false)
  })
})

describe('decideMigrationOutcome', () => {
  const base = { attempt: 1, maxAttempts: 3, exitStatus: 0, schemaPresent: true }

  it('exit 0 COM schema => aceita', () => {
    expect(decideMigrationOutcome(base)).toBe('accept')
  })

  it('exit 0 SEM schema, com tentativa sobrando => retenta', () => {
    // O nucleo da correcao: sair 0 nao prova nada. Sem esta linha, o harness
    // seguia para ~2 minutos de `next build` contra um banco vazio.
    expect(decideMigrationOutcome({ ...base, schemaPresent: false })).toBe('retry')
  })

  it('exit 0 SEM schema na ULTIMA tentativa => falha por silencio', () => {
    expect(decideMigrationOutcome({ ...base, attempt: 3, schemaPresent: false })).toBe(
      'fail_silent',
    )
  })

  it('exit NAO-ZERO falha na hora, sem retentar', () => {
    // Controle negativo do retry: quando o CLI de fato reporta erro, insistir
    // so atrasaria a mensagem util dele.
    expect(decideMigrationOutcome({ ...base, exitStatus: 1, schemaPresent: false })).toBe(
      'fail_reported',
    )
  })

  it('processo morto por sinal (status null) conta como falha reportada', () => {
    expect(decideMigrationOutcome({ ...base, exitStatus: null, schemaPresent: false })).toBe(
      'fail_reported',
    )
  })

  it('exit NAO-ZERO nao vira "accept" nem se o schema existir por outro motivo', () => {
    // Um banco ja migrado por outra via nao pode absolver um CLI que falhou.
    expect(decideMigrationOutcome({ ...base, exitStatus: 1, schemaPresent: true })).toBe(
      'fail_reported',
    )
  })
})

describe('describeDatabaseFailure', () => {
  it('inclui o code quando existe', () => {
    expect(describeDatabaseFailure({ message: 'terminating connection', code: '57P01' })).toBe(
      'terminating connection (code=57P01)',
    )
  })

  it('sobrevive a erro sem mensagem', () => {
    expect(describeDatabaseFailure({})).toBe('erro sem mensagem')
  })

  it('sobrevive a valor nao-objeto', () => {
    expect(describeDatabaseFailure(undefined)).toBe('erro desconhecido')
    expect(describeDatabaseFailure('socket fechado')).toBe('socket fechado')
  })
})
