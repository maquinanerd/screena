/**
 * on-demand-match.test.ts — O criterio de confianca da cobertura sob demanda.
 *
 * O teste central e o de AMBIGUIDADE: ele prova que o modulo recusa em vez de
 * desempatar. Quebrar o criterio no codigo (escolher "o mais popular") faz
 * exatamente esse teste reprovar — e ele existe por causa do "Chris Evans
 * errado".
 */

import { describe, expect, it } from 'vitest'

import {
  isConfident,
  matchOnDemand,
  ON_DEMAND_CONFIDENCE,
  ON_DEMAND_MIN_CONFIDENCE,
  parseTerm,
  type OnDemandCandidate,
} from '../on-demand/match.js'

const superman2025: OnDemandCandidate = {
  kind: 'movie',
  tmdbId: 1061474,
  title: 'Superman',
  year: 2025,
}
const superman1978: OnDemandCandidate = {
  kind: 'movie',
  tmdbId: 1924,
  title: 'Superman',
  year: 1978,
}

describe('parseTerm', () => {
  it('separa o ano do fim do termo', () => {
    expect(parseTerm('Superman 2025')).toEqual({ title: 'Superman', year: 2025 })
  })

  it('NAO come o ano quando ele e o proprio titulo', () => {
    // "2001: Uma Odisseia no Espaco" nao pode perder o 2001.
    expect(parseTerm('2001: Uma Odisseia no Espaco')).toEqual({
      title: '2001: Uma Odisseia no Espaco',
      year: null,
    })
  })

  it('ignora 4 digitos fora da faixa plausivel', () => {
    expect(parseTerm('Blade Runner 9999')).toEqual({ title: 'Blade Runner 9999', year: null })
  })
})

describe('matchOnDemand', () => {
  it('casa por titulo + ano quando o termo traz o ano', () => {
    const match = matchOnDemand('Superman 2025', [superman1978, superman2025])
    expect(match.matched).toBe(true)
    if (!match.matched) return
    expect(match.tmdbId).toBe(1061474)
    expect(match.matchedBy).toBe('exact_title_year')
    expect(match.confidence).toBe(ON_DEMAND_CONFIDENCE.exact_title_year)
    expect(isConfident(match)).toBe(true)
  })

  it('casa por titulo exato quando ele e UNICO', () => {
    const match = matchOnDemand('Ruptura', [
      { kind: 'tv', tmdbId: 95396, title: 'Ruptura', year: 2022 },
    ])
    expect(match.matched).toBe(true)
    if (!match.matched) return
    expect(match.matchedBy).toBe('exact_title_unique')
    expect(isConfident(match)).toBe(true)
  })

  it('RECUSA o ambiguo em vez de desempatar por popularidade', () => {
    // Dois "Superman" exatos, termo sem ano. Um criterio que escolhesse "o mais
    // popular" publicaria a obra errada com cara de certo.
    const match = matchOnDemand('Superman', [superman1978, superman2025])
    expect(match.matched).toBe(false)
    if (match.matched) return
    expect(match.refusal).toBe('ambiguous_title')
    expect(match.tiedCount).toBe(2)
  })

  it('recusa quando nada bate EXATAMENTE (sem fuzzy, sem prefixo)', () => {
    const match = matchOnDemand('Superm', [superman2025])
    expect(match.matched).toBe(false)
    if (match.matched) return
    expect(match.refusal).toBe('no_exact_match')
  })

  it('recusa quando o titulo existe mas em outro ano', () => {
    const match = matchOnDemand('Superman 1999', [superman1978, superman2025])
    expect(match.matched).toBe(false)
    if (match.matched) return
    expect(match.refusal).toBe('no_exact_match')
  })

  it('e insensivel a acento e caixa (a mesma dobra da busca)', () => {
    const match = matchOnDemand('ruptura', [
      { kind: 'tv', tmdbId: 95396, title: 'Ruptúra', year: 2022 },
    ])
    expect(match.matched).toBe(true)
  })

  it('casa por titulo alternativo conhecido', () => {
    const match = matchOnDemand('Severance', [
      { kind: 'tv', tmdbId: 95396, title: 'Ruptura', year: 2022, alternativeTitles: ['Severance'] },
    ])
    expect(match.matched).toBe(true)
    if (!match.matched) return
    expect(match.tmdbId).toBe(95396)
  })

  it('filme e serie de mesmo nome sao ambiguos quando nenhum kind e pedido', () => {
    const match = matchOnDemand('Fargo', [
      { kind: 'movie', tmdbId: 275, title: 'Fargo', year: 1996 },
      { kind: 'tv', tmdbId: 60622, title: 'Fargo', year: 2014 },
    ])
    expect(match.matched).toBe(false)
    if (match.matched) return
    expect(match.refusal).toBe('ambiguous_title')
  })

  it('o mesmo par deixa de ser ambiguo quando o kind restringe', () => {
    const match = matchOnDemand(
      'Fargo',
      [
        { kind: 'movie', tmdbId: 275, title: 'Fargo', year: 1996 },
        { kind: 'tv', tmdbId: 60622, title: 'Fargo', year: 2014 },
      ],
      'tv',
    )
    expect(match.matched).toBe(true)
    if (!match.matched) return
    expect(match.tmdbId).toBe(60622)
  })

  it('titulo anunciado sem data casa por titulo unico (year null nao atrapalha)', () => {
    const match = matchOnDemand('Avengers Doomsday', [
      { kind: 'movie', tmdbId: 1234821, title: 'Avengers Doomsday', year: null },
    ])
    expect(match.matched).toBe(true)
  })

  it('recusa termo vazio e lista vazia com motivos distintos', () => {
    const vazio = matchOnDemand('  ', [superman2025])
    expect(vazio.matched).toBe(false)
    if (!vazio.matched) expect(vazio.refusal).toBe('no_input')

    const semCandidato = matchOnDemand('Superman', [])
    expect(semCandidato.matched).toBe(false)
    if (!semCandidato.matched) expect(semCandidato.refusal).toBe('not_found')
  })

  it('toda recusa carrega detalhe legivel — nenhum desfecho e mudo', () => {
    const recusas = [
      matchOnDemand('  ', []),
      matchOnDemand('Superman', []),
      matchOnDemand('Superm', [superman2025]),
      matchOnDemand('Superman', [superman1978, superman2025]),
    ]
    for (const recusa of recusas) {
      expect(recusa.matched).toBe(false)
      if (recusa.matched) continue
      expect(recusa.detail.length).toBeGreaterThan(0)
    }
  })

  it('as duas formas de casamento passam do piso declarado', () => {
    expect(ON_DEMAND_CONFIDENCE.exact_title_year).toBeGreaterThanOrEqual(ON_DEMAND_MIN_CONFIDENCE)
    expect(ON_DEMAND_CONFIDENCE.exact_title_unique).toBeGreaterThanOrEqual(ON_DEMAND_MIN_CONFIDENCE)
  })
})
