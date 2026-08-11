/**
 * worker-service-readiness.test.ts — Readiness PURA do servico de catalogo.
 *
 * Duas propriedades importam mais que as outras:
 *  - producao sem autorizacao explicita NAO fica ready (o container nao pode
 *    escrever no banco do site por engano);
 *  - dead-letter NAO bloqueia (declarar not-ready por um id problematico
 *    pararia a ingestao inteira).
 */

import { describe, expect, it } from 'vitest'

import {
  evaluateCatalogReadiness,
  type CatalogReadinessFacts,
} from '../worker-service/readiness.js'

/** Fatos de um servico saudavel fora de producao. */
const HEALTHY: CatalogReadinessFacts = {
  isProduction: false,
  productionWriteAuthorized: false,
  hasDatabaseUrl: true,
  hasTmdbCredential: true,
  databaseReachable: true,
  queueSchemaPresent: true,
  deadLetterCount: 0,
}

function statusOf(facts: CatalogReadinessFacts, name: string): string {
  const report = evaluateCatalogReadiness(facts)
  return report.checks.find((check) => check.name === name)?.status ?? 'ausente'
}

describe('evaluateCatalogReadiness', () => {
  it('fica ready com tudo em ordem', () => {
    expect(evaluateCatalogReadiness(HEALTHY).ready).toBe(true)
  })

  it('BLOQUEIA producao sem autorizacao explicita de escrita', () => {
    const facts = { ...HEALTHY, isProduction: true, productionWriteAuthorized: false }
    expect(evaluateCatalogReadiness(facts).ready).toBe(false)
    expect(statusOf(facts, 'authorization')).toBe('blocked')
  })

  it('libera producao COM autorizacao explicita', () => {
    const facts = { ...HEALTHY, isProduction: true, productionWriteAuthorized: true }
    expect(evaluateCatalogReadiness(facts).ready).toBe(true)
    expect(statusOf(facts, 'authorization')).toBe('ok')
  })

  it('bloqueia sem DATABASE_URL', () => {
    expect(evaluateCatalogReadiness({ ...HEALTHY, hasDatabaseUrl: false }).ready).toBe(false)
  })

  it('bloqueia sem credencial TMDB', () => {
    // Todo job de sync morreria em `TmdbConfigError`: ficar ready seria mentir.
    expect(evaluateCatalogReadiness({ ...HEALTHY, hasTmdbCredential: false }).ready).toBe(false)
  })

  it('marca `down` quando o banco esta inalcancavel', () => {
    const facts = { ...HEALTHY, databaseReachable: false }
    expect(evaluateCatalogReadiness(facts).ready).toBe(false)
    expect(statusOf(facts, 'database')).toBe('down')
  })

  it('bloqueia com o schema da fila ausente (migration atrasada)', () => {
    const facts = { ...HEALTHY, queueSchemaPresent: false }
    expect(evaluateCatalogReadiness(facts).ready).toBe(false)
    expect(statusOf(facts, 'queue_schema')).toBe('blocked')
  })

  it('dead-letter NAO bloqueia readiness — so informa', () => {
    const facts = { ...HEALTHY, deadLetterCount: 137 }
    expect(evaluateCatalogReadiness(facts).ready).toBe(true)
    const report = evaluateCatalogReadiness(facts)
    const check = report.checks.find((c) => c.name === 'dead_letter')
    expect(check?.detail).toContain('137')
  })

  it('nao verificado nunca conta como ok', () => {
    // Fail-closed: ausencia de evidencia nao e evidencia de saude.
    expect(
      evaluateCatalogReadiness({ ...HEALTHY, databaseReachable: null }).ready,
    ).toBe(false)
    expect(
      evaluateCatalogReadiness({ ...HEALTHY, queueSchemaPresent: null }).ready,
    ).toBe(false)
  })

  it('nenhum detalhe de check carrega valor de segredo', () => {
    const report = evaluateCatalogReadiness({
      ...HEALTHY,
      hasDatabaseUrl: false,
      hasTmdbCredential: false,
    })
    const joined = report.checks.map((c) => c.detail).join(' ')
    expect(joined).not.toContain('postgresql://')
    // Cita o NOME da variavel, nunca o conteudo.
    expect(joined).toContain('DATABASE_URL')
  })
})
