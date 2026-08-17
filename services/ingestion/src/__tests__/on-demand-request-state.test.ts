/**
 * on-demand-request-state.test.ts — A pagina "buscando" (T4.1).
 *
 * Os quatro testes que o dono pediu explicitamente:
 *  1. a URL definitiva responde DURANTE a ingestao;
 *  2. ela NAO se apresenta como completa;
 *  3. ela PARA de dizer "buscando" quando falha ou estoura o tempo;
 *  4. uma segunda sessao, na mesma URL, chega no MESMO estado.
 */

import { describe, expect, it } from 'vitest'

import {
  HYDRATION_DEADLINE_MS,
  HYDRATION_STATES,
  indexDirectiveFor,
  nextPollDelayMs,
  POLL_MAX_MS,
  resolveState,
  TERMINAL_STATES,
  viewFor,
  type HydrationRequestRecord,
} from '../on-demand/request-state.js'

const T0 = new Date('2026-08-14T12:00:00Z')
const at = (ms: number): Date => new Date(T0.getTime() + ms)

const pendente: HydrationRequestRecord = {
  kind: 'movie',
  tmdbId: 1061474,
  slug: 'superman-2025',
  state: 'pending',
  requestedAt: T0,
}

describe('a URL definitiva responde durante a ingestao', () => {
  it('responde 200 enquanto busca — nao 404, nao erro', () => {
    const v = viewFor(pendente, at(1_000))
    expect(v.httpStatus).toBe(200)
    expect(v.state).toBe('pending')
  })

  it('NAO se apresenta como completa, e diz o que esta acontecendo', () => {
    const v = viewFor(pendente, at(1_000))
    expect(v.presentsAsComplete).toBe(false)
    // Um esqueleto mudo faz o leitor concluir que o site nao tem o filme.
    expect(v.message.trim().length).toBeGreaterThan(0)
  })

  it('se completa sozinha: pede nova checagem enquanto pendente', () => {
    expect(viewFor(pendente, at(1_000)).shouldPoll).toBe(true)
  })

  it('LINK COMPARTILHADO: segunda leitura, outra sessao, MESMO estado', () => {
    // O estado vive no registro, nao na sessao. Duas leituras independentes do
    // mesmo registro no mesmo instante sao indistinguiveis.
    const sessaoA = viewFor(pendente, at(5_000))
    const sessaoB = viewFor({ ...pendente }, at(5_000))
    expect(sessaoB).toEqual(sessaoA)
    expect(sessaoB.httpStatus).toBe(200)
    expect(sessaoB.state).toBe('pending')
  })
})

describe('a busca TERMINA', () => {
  it('pendente que estoura o prazo vira timed_out SOZINHO', () => {
    // Sem escritor nenhum: um worker morto nao pode deixar "buscando" eterno.
    expect(resolveState(pendente, at(HYDRATION_DEADLINE_MS - 1))).toBe('pending')
    expect(resolveState(pendente, at(HYDRATION_DEADLINE_MS))).toBe('timed_out')
    expect(resolveState(pendente, at(HYDRATION_DEADLINE_MS * 10))).toBe('timed_out')
  })

  it('estourado PARA de dizer que esta buscando', () => {
    const v = viewFor(pendente, at(HYDRATION_DEADLINE_MS + 1))
    expect(v.state).toBe('timed_out')
    expect(v.shouldPoll).toBe(false)
    expect(v.presentsAsComplete).toBe(false)
    expect(v.message).not.toMatch(/buscando/i)
  })

  it('falha PARA de dizer que esta buscando', () => {
    const v = viewFor({ ...pendente, state: 'failed' }, at(1_000))
    expect(v.shouldPoll).toBe(false)
    expect(v.message).not.toMatch(/buscando/i)
  })

  it('not_found responde 404 — o upstream confirmou que nao existe', () => {
    const v = viewFor({ ...pendente, state: 'not_found' }, at(1_000))
    expect(v.httpStatus).toBe(404)
    expect(v.shouldPoll).toBe(false)
  })

  it('estado terminal NAO regride com o tempo', () => {
    for (const estado of ['ready', 'failed', 'not_found', 'timed_out'] as const) {
      expect(resolveState({ ...pendente, state: estado }, at(HYDRATION_DEADLINE_MS * 100))).toBe(
        estado,
      )
    }
  })

  it('so `pending` nao e terminal', () => {
    for (const estado of HYDRATION_STATES) {
      expect(TERMINAL_STATES.has(estado)).toBe(estado !== 'pending')
    }
  })
})

describe('o que o Google recebe', () => {
  it('SO `ready` pode ser indexado', () => {
    for (const estado of HYDRATION_STATES) {
      expect(indexDirectiveFor(estado), `estado ${estado}`).toBe(
        estado === 'ready' ? 'index' : 'noindex',
      )
    }
  })

  it('a pagina que se apresenta incompleta NUNCA e indexavel', () => {
    // A invariante que importa: nao existe combinacao (incompleta + index).
    for (const estado of HYDRATION_STATES) {
      const v = viewFor({ ...pendente, state: estado }, at(1_000))
      if (!v.presentsAsComplete) expect(v.index).toBe('noindex')
    }
  })
})

describe('ritmo da auto-atualizacao', () => {
  it('cresce e para num teto', () => {
    const d1 = nextPollDelayMs(1)
    const d3 = nextPollDelayMs(3)
    expect(d3).toBeGreaterThan(d1)
    expect(nextPollDelayMs(100)).toBe(POLL_MAX_MS)
  })

  it('nunca devolve intervalo nao-positivo, nem para entrada absurda', () => {
    for (const n of [0, -5, 1.5, Number.NaN]) {
      expect(nextPollDelayMs(n)).toBeGreaterThan(0)
    }
  })
})
