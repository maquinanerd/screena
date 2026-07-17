/**
 * cli-delegate.test.ts — Mapeamento sample/sync -> bin dedicado (achado A5).
 */

import { describe, expect, it } from 'vitest'

import { parseRatingsArgs } from '../cli/args.js'
import { planDelegation } from '../cli/delegate.js'
import type { SampleArgs, SyncArgs } from '../cli/args.js'

function parseAs<T extends SampleArgs | SyncArgs>(line: string): T {
  const result = parseRatingsArgs(line.split(' ').filter((t) => t !== ''))
  if (!result.ok) throw new Error(result.error)
  return result.args as T
}

describe('delegacao sample/sync', () => {
  it('o comando CANONICO da missao vira uma amostra real do bin dedicado', () => {
    const plan = planDelegation(parseAs('sample --source imdb --entity movie --limit 20 --dry-run'))
    expect(plan.argv).toEqual(['--type=film', '--limit=20', '--sample'])
    // --source nao e silenciado: vira aviso explicito (o fornecedor e multi-fonte).
    expect(plan.warnings.join(' ')).toMatch(/--source=imdb/)
  })

  it('entity tv vira --type=show; --id e repassado', () => {
    const plan = planDelegation(parseAs('sample --entity tv --id tt0111161 --limit 5'))
    expect(plan.argv).toEqual(['--type=show', '--id=tt0111161', '--limit=5', '--sample'])
  })

  it('sync SEM --apply delega como dry-run do bin (plano; zero rede/DB)', () => {
    const plan = planDelegation(parseAs('sync --entity movie --limit 10'))
    expect(plan.argv).toEqual(['--type=film', '--limit=10'])
    expect(plan.argv).not.toContain('--apply')
    expect(plan.argv).not.toContain('--sample')
  })

  it('sync --apply delega com --apply', () => {
    const plan = planDelegation(parseAs('sync --entity movie --limit 10 --apply'))
    expect(plan.argv).toContain('--apply')
  })

  it('sample sem --source nao gera aviso de fonte', () => {
    const plan = planDelegation(parseAs('sample --entity movie --limit 3'))
    expect(plan.warnings.filter((w) => w.includes('--source'))).toHaveLength(0)
  })
})
