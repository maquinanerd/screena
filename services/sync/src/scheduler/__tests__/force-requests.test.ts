/**
 * force-requests.test.ts — O pedido do painel so vira execucao se for valido.
 */

import { describe, expect, it } from 'vitest'

import {
  buildForcedRatingsArgs,
  buildForcedScoreArgs,
  FORCE_REQUEST_KINDS,
  summarizeChildOutput,
  validateForceRequest,
} from '../force-requests.js'

describe('validateForceRequest', () => {
  it('aceita fila da tabela de ritmos', () => {
    expect(validateForceRequest({ id: '1', kind: 'queue', queue: 'title_media', entityType: null, entityId: null })).toEqual({
      ok: true,
      request: { id: '1', kind: 'queue', queue: 'title_media' },
    })
  })

  it('recusa fila desconhecida COM o nome — nunca roda a "mais parecida"', () => {
    const resultado = validateForceRequest({ id: '2', kind: 'queue', queue: 'titles_media', entityType: null, entityId: null })
    expect(resultado).toEqual({ ok: false, reason: 'fila desconhecida no pedido: titles_media' })
  })

  it('aceita pedido de titulo de filme e de serie', () => {
    for (const kind of ['title_ratings', 'title_score'] as const) {
      for (const entityType of ['movie', 'tv'] as const) {
        const resultado = validateForceRequest({ id: '3', kind, queue: null, entityType, entityId: '42' })
        expect(resultado).toEqual({ ok: true, request: { id: '3', kind, entityType, entityId: '42' } })
      }
    }
  })

  it('recusa temporada, id invalido e tipo de pedido desconhecido', () => {
    expect(validateForceRequest({ id: '4', kind: 'title_score', queue: null, entityType: 'season', entityId: '1' }).ok).toBe(false)
    expect(validateForceRequest({ id: '5', kind: 'title_score', queue: null, entityType: 'movie', entityId: '0' }).ok).toBe(false)
    expect(validateForceRequest({ id: '6', kind: 'title_score', queue: null, entityType: 'movie', entityId: null }).ok).toBe(false)
    expect(validateForceRequest({ id: '7', kind: 'apagar_tudo', queue: null, entityType: null, entityId: null })).toEqual({
      ok: false,
      reason: 'tipo de pedido desconhecido: apagar_tudo',
    })
  })

  it('os tipos espelham o CHECK da migration', () => {
    expect(FORCE_REQUEST_KINDS).toEqual(['queue', 'title_ratings', 'title_score'])
  })
})

describe('argumentos das CLIs', () => {
  it('nota externa exige imdb_id valido; sem ele NAO ha chamada', () => {
    expect(buildForcedRatingsArgs('movie', null)).toBeNull()
    expect(buildForcedRatingsArgs('movie', '1234567')).toBeNull()
    expect(buildForcedRatingsArgs('movie', 'tt12')).toBeNull()
    expect(buildForcedRatingsArgs('tv', 'tt0944947')).toEqual(['--id', 'tt0944947', '--type', 'tv', '--apply'])
  })

  it('score de UM titulo', () => {
    expect(buildForcedScoreArgs('movie', '77')).toEqual(['--type', 'movie', '--entity-id', '77', '--apply'])
  })
})

describe('summarizeChildOutput', () => {
  it('guarda so a ultima linha de RESUMO, nao a saida inteira', () => {
    const saida = [
      'Sample sanitizado: /app/services/ratings/.data/omdb-sample-tt1.json',
      'status=success · ids=1 · falhas=0 · cota=1/1000 por dia',
    ].join('\n')
    expect(summarizeChildOutput(saida)).toBe('status=success · ids=1 · falhas=0 · cota=1/1000 por dia')
  })

  it('score: a linha de contagem', () => {
    expect(summarizeChildOutput('cinerie score · --apply\ncalculados=1 exibiveis(piso>=2 fontes)=1 bloqueados=0 gravados=1 ja-registrados=0')).toMatch(
      /^calculados=1/,
    )
  })

  it('sem linha de resumo: null (o registro diz "sem resumo", nao inventa)', () => {
    expect(summarizeChildOutput('qualquer coisa\noutra coisa')).toBeNull()
  })

  it('corta linha longa', () => {
    const longa = `status=${'x'.repeat(500)}`
    expect(summarizeChildOutput(longa)?.length).toBe(300)
  })
})
