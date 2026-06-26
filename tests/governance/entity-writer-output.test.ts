/**
 * Testes de governanca — saida do Entity Writer (@screena/schemas).
 *
 * Garantem a invariante 12: o Entity Writer so escreve fatos presentes no
 * payload controlado. Nomes citados fora do payload viram warning de
 * alucinacao.
 *
 * Cobrem tambem a extensao do contrato (Fase 3A / Etapa 1): o payload aceita
 * campos opcionais (entityType, title, year, runtimeMinutes, languageCode,
 * castMembers) sem quebrar o payload minimo `{ director, cast }` e sem
 * afrouxar a anti-alucinacao — title, castMembers[].name e
 * castMembers[].character passam a ser fatos permitidos.
 */

import { describe, expect, it } from 'vitest'
import {
  validateAgainstPayload,
  validateEntityWriterOutput,
  type CastMember,
  type EntityPayload,
  type EntityType,
  type EntityWriterOutput,
} from '@screena/schemas'

// Payload minimo historico: continua valido apos a extensao.
const payload: EntityPayload = {
  director: 'Denis Villeneuve',
  cast: ['Timothee Chalamet', 'Rebecca Ferguson'],
}

// Membro tipado para exercitar a exportacao de CastMember.
const stilgar: CastMember = {
  name: 'Javier Bardem',
  character: 'Stilgar',
  billingOrder: 4,
}

// Tipo exportado de entidade.
const kind: EntityType = 'movie'

// Payload estendido com todos os campos opcionais.
const extendedPayload: EntityPayload = {
  director: 'Denis Villeneuve',
  cast: ['Timothee Chalamet', 'Rebecca Ferguson'],
  entityType: kind,
  title: 'Duna: Parte Dois',
  year: 2024,
  runtimeMinutes: 166,
  languageCode: 'pt-BR',
  castMembers: [{ name: 'Zendaya', character: 'Chani', billingOrder: 3 }, stilgar],
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

  it('(3) payload minimo { director, cast } continua valido (compatibilidade)', () => {
    const legacy: EntityPayload = {
      director: 'Denis Villeneuve',
      cast: ['Timothee Chalamet'],
    }
    const output: EntityWriterOutput = {
      cast_intro: 'O destaque do elenco fica com Timothee Chalamet.',
      warnings: [],
    }

    const result = validateAgainstPayload(legacy, output)

    expect(result.warnings).toEqual([])
  })

  it('(4) aceita payload estendido e nao alucina com nome vindo de castMembers[].name', () => {
    const output: EntityWriterOutput = {
      cast_intro: 'No elenco, Zendaya e Javier Bardem reforcam o grupo principal.',
      warnings: [],
    }

    const result = validateAgainstPayload(extendedPayload, output)

    expect(result.warnings).toEqual([])
  })

  it('(5) nao gera warning para personagem vindo de castMembers[].character', () => {
    const output: EntityWriterOutput = {
      editorial_intro: 'A jornada de Chani conduz a segunda metade da historia.',
      warnings: [],
    }

    const result = validateAgainstPayload(extendedPayload, output)

    expect(result.warnings).toEqual([])
  })

  it('(6) nao gera warning para titulo vindo de payload.title', () => {
    const output: EntityWriterOutput = {
      editorial_intro: 'O filme Duna expande o universo do deserto.',
      warnings: [],
    }

    const result = validateAgainstPayload(extendedPayload, output)

    expect(result.warnings).toEqual([])
  })

  it('(7) nome fora do payload continua gerando warning mesmo com campos opcionais', () => {
    const output: EntityWriterOutput = {
      cast_intro: 'O elenco ainda traz Florence Pugh em participacao especial.',
      warnings: [],
    }

    const result = validateAgainstPayload(extendedPayload, output)

    expect(result.warnings).toContain('fato fora do payload: Florence Pugh')
  })
})

describe('validateEntityWriterOutput', () => {
  it('(8) saida sem warnings e invalida', () => {
    const result = validateEntityWriterOutput({ editorial_intro: 'texto editorial' })

    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('warnings'))).toBe(true)
  })

  it('(9) saida flat valida (editorial_intro + cast_intro + warnings) e aceita', () => {
    const result = validateEntityWriterOutput({
      editorial_intro: 'texto editorial',
      cast_intro: 'apresentacao do elenco',
      warnings: [],
    })

    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })
})
