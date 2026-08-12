/**
 * fixture.test.ts — CONTROLE POSITIVO da fixture da OMDb.
 *
 * Este arquivo nao testa o adapter. Ele testa o TESTE: prova que
 * `assertFixtureIntact` realmente estoura quando a fixture e adulterada, e so
 * entao aceita a fixture vigente como intacta.
 *
 * A ordem dos dois blocos e deliberada. Se so existisse "a fixture esta
 * intacta", um `assertFixtureIntact` vazio (ou quebrado) passaria — e teriamos
 * de novo um teste verde que nao prova nada. Os casos de adulteracao sao a
 * prova de que o detector detecta.
 */

import { describe, expect, it } from 'vitest'

import { assertFixtureIntact, OMDB_GUARDIANS_PAYLOAD } from './fixture.js'

/** Clona a fixture para adulterar sem contaminar os outros testes. */
function mutate(change: (payload: Record<string, unknown>) => void): Record<string, unknown> {
  const clone = structuredClone(OMDB_GUARDIANS_PAYLOAD) as unknown as Record<string, unknown>
  change(clone)
  return clone
}

describe('controle positivo: o detector de fixture corrompida detecta', () => {
  it('estoura quando o formato de um Value muda (85% viraria outra escala)', () => {
    const corrupted = mutate((p) => {
      ;(p['Ratings'] as Record<string, unknown>[])[1]!['Value'] = '8.5'
    })
    expect(() => assertFixtureIntact(corrupted)).toThrow(/FIXTURE CORROMPIDA/)
    expect(() => assertFixtureIntact(corrupted)).toThrow(/Ratings\[1\]\.Value/)
  })

  it('estoura quando uma das tres fontes some', () => {
    const corrupted = mutate((p) => {
      p['Ratings'] = (p['Ratings'] as unknown[]).slice(0, 2)
    })
    expect(() => assertFixtureIntact(corrupted)).toThrow(/3 entradas/)
  })

  it('estoura quando o nome de uma fonte muda', () => {
    const corrupted = mutate((p) => {
      ;(p['Ratings'] as Record<string, unknown>[])[0]!['Source'] = 'IMDb'
    })
    expect(() => assertFixtureIntact(corrupted)).toThrow(/Ratings\[0\]\.Source/)
  })

  it('estoura quando o imdbID muda (o linkback do IMDb sai dele)', () => {
    const corrupted = mutate((p) => {
      p['imdbID'] = 'tt0000001'
    })
    expect(() => assertFixtureIntact(corrupted)).toThrow(/imdbID/)
  })

  it('estoura quando um campo redundante de topo deixa de bater com o array', () => {
    const corrupted = mutate((p) => {
      p['Metascore'] = '99'
    })
    expect(() => assertFixtureIntact(corrupted)).toThrow(/Metascore/)
  })

  it('estoura quando Response deixa de ser "True"', () => {
    const corrupted = mutate((p) => {
      p['Response'] = 'False'
    })
    expect(() => assertFixtureIntact(corrupted)).toThrow(/Response/)
  })

  it('estoura quando o payload nem e objeto', () => {
    expect(() => assertFixtureIntact('nao sou um payload')).toThrow(/nao e objeto/)
  })
})

describe('a fixture vigente', () => {
  it('esta intacta', () => {
    expect(() => assertFixtureIntact(OMDB_GUARDIANS_PAYLOAD)).not.toThrow()
  })
})
