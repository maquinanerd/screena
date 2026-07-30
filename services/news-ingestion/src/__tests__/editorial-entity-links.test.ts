/**
 * Vinculos entidade <-> materia: o recorte do que o lado publico sabe ligar.
 *
 * O ponto sensivel destes testes nao e "movie passa". E o que acontece com o que
 * NAO passa: tipo fora do recorte, id malformado e id fora do alcance do BIGINT
 * precisam produzir AVISO e nenhum vinculo — nunca um vinculo para a entidade
 * errada, e nunca um valor que va estourar dentro da transacao.
 */

import { describe, expect, it } from 'vitest'

import {
  PUBLIC_LINKABLE_ENTITY_KINDS,
  isPublicLinkableEntityKind,
  planEntityLinks,
  toCatalogEntityId,
  type EventEntityLink,
} from '../editorial-entity-links.js'

function entity(overrides: Partial<EventEntityLink> = {}): EventEntityLink {
  return { entityKind: 'movie', entityId: '42', relation: 'primary_subject', ...overrides }
}

describe('recorte de tipos vinculaveis', () => {
  it('suporta exatamente movie, tv e person', () => {
    expect([...PUBLIC_LINKABLE_ENTITY_KINDS]).toEqual(['movie', 'tv', 'person'])
  })

  it('recusa os tipos do contrato que o lado publico nao renderiza', () => {
    // `season`/`episode` existem no enum do banco mas nenhuma pagina resolve o
    // vinculo; `character`/`franchise` nao existem nem como EntityType e
    // abortariam a transacao no enum do PostgreSQL.
    for (const kind of ['season', 'episode', 'character', 'franchise']) {
      expect(isPublicLinkableEntityKind(kind), kind).toBe(false)
    }
  })
})

describe('normalizacao do id de catalogo', () => {
  it('aceita inteiro positivo e normaliza zeros a esquerda', () => {
    expect(toCatalogEntityId('42')).toBe('42')
    expect(toCatalogEntityId('  42  ')).toBe('42')
    // Duas representacoes textuais do mesmo id furariam a deduplicacao.
    expect(toCatalogEntityId('0042')).toBe('42')
  })

  it('recusa qualquer coisa que nao seja inteiro positivo', () => {
    for (const bad of ['', '   ', '0', '-1', '1.5', '12abc', 'abc', '1e3', '1 2', '٤٢']) {
      expect(toCatalogEntityId(bad), JSON.stringify(bad)).toBeNull()
    }
  })

  it('recusa id acima do teto do BIGINT do PostgreSQL', () => {
    // O `BigInt` do JavaScript aceitaria; o banco nao. Recusar aqui e o que
    // impede a transacao inteira (artigo + traducao + recibo) de abortar.
    expect(toCatalogEntityId('9223372036854775807')).toBe('9223372036854775807')
    expect(toCatalogEntityId('9223372036854775808')).toBeNull()
    expect(toCatalogEntityId('9'.repeat(40))).toBeNull()
  })
})

describe('planEntityLinks', () => {
  it('sem entidades produz plano vazio e nenhum aviso', () => {
    expect(planEntityLinks([])).toEqual({ links: [], warnings: [] })
  })

  it('projeta movie, tv e person preservando a ordem de citacao', () => {
    const plan = planEntityLinks([
      entity({ entityKind: 'movie', entityId: '10' }),
      entity({ entityKind: 'tv', entityId: '20' }),
      entity({ entityKind: 'person', entityId: '30' }),
    ])
    expect(plan.links).toEqual([
      { entityType: 'movie', entityId: '10' },
      { entityType: 'tv', entityId: '20' },
      { entityType: 'person', entityId: '30' },
    ])
    expect(plan.warnings).toEqual([])
  })

  it('tipo nao suportado NAO vira vinculo e gera aviso com kind e id', () => {
    const plan = planEntityLinks([
      entity({ entityKind: 'franchise', entityId: '7', relation: 'mentioned' }),
      entity({ entityKind: 'movie', entityId: '10' }),
    ])
    // A materia continua publicavel com a entidade que o publico entende.
    expect(plan.links).toEqual([{ entityType: 'movie', entityId: '10' }])
    expect(plan.warnings).toHaveLength(1)
    // O aviso precisa dizer QUAL entidade caiu; um "tipo invalido" generico
    // obriga a instrumentar o worker para descobrir de qual materia se trata.
    expect(plan.warnings[0]).toContain('franchise')
    expect(plan.warnings[0]).toContain('id=7')
    expect(plan.warnings[0]).toContain('movie|tv|person')
  })

  it('id invalido NAO vira vinculo falso', () => {
    const plan = planEntityLinks([entity({ entityId: '12abc' })])
    // O risco real: um parse tolerante viraria vinculo para o filme 12 — uma
    // materia sobre um filme aparecendo na ficha de outro.
    expect(plan.links).toEqual([])
    expect(plan.warnings[0]).toContain('id invalido')
  })

  it('a MESMA entidade citada duas vezes e um vinculo, nao dois', () => {
    const plan = planEntityLinks([
      entity({ entityKind: 'movie', entityId: '10', relation: 'primary_subject' }),
      entity({ entityKind: 'movie', entityId: '0010', relation: 'reviewed' }),
    ])
    expect(plan.links).toEqual([{ entityType: 'movie', entityId: '10' }])
    expect(plan.warnings[0]).toContain('repetida')
  })

  it('o mesmo id em tipos DIFERENTES sao vinculos distintos', () => {
    // `movie:10` e `tv:10` sao entidades diferentes; colapsa-las perderia uma.
    const plan = planEntityLinks([
      entity({ entityKind: 'movie', entityId: '10' }),
      entity({ entityKind: 'tv', entityId: '10' }),
    ])
    expect(plan.links).toHaveLength(2)
    expect(plan.warnings).toEqual([])
  })
})
