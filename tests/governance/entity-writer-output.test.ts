/**
 * Testes de governanca — saida do Entity Writer (@screena/schemas).
 *
 * Garantem a invariante 12: o Entity Writer so escreve fatos presentes no
 * payload controlado. Nomes citados fora do payload viram warning de
 * alucinacao.
 */

import { describe, expect, it } from 'vitest'
import {
  validateAgainstPayload,
  type EntityPayload,
  type EntityWriterOutput,
} from '@screena/schemas'

const payload: EntityPayload = {
  director: 'Denis Villeneuve',
  cast: ['Timothee Chalamet', 'Rebecca Ferguson'],
}

describe('validateAgainstPayload', () => {
  it('(1) gera warning quando cast_intro cita um ator fora do payload.cast', () => {
    const output: EntityWriterOutput = {
      cast_intro:
        'O elenco reune Timothee Chalamet, Rebecca Ferguson e Zendaya em papeis centrais.',
      warnings: [],
    }

    const result = validateAgainstPayload(payload, output)

    expect(result.warnings).toContain('fato fora do payload: Zendaya')
  })

  it('(2) nao gera warning de alucinacao quando so cita nomes do payload', () => {
    const output: EntityWriterOutput = {
      editorial_intro:
        'Dirigido por Denis Villeneuve, o filme acompanha a jornada do protagonista.',
      cast_intro: 'No elenco, Timothee Chalamet contracena com Rebecca Ferguson.',
      warnings: [],
    }

    const result = validateAgainstPayload(payload, output)

    expect(result.warnings).toEqual([])
  })
})
