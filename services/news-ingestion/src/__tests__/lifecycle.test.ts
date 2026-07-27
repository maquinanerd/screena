/**
 * Testes do ciclo de vida editorial: transicoes, gate de publicacao,
 * agendamento e plano de atualizacao/correcao.
 */

import { describe, expect, it } from 'vitest'

import {
  canTransition,
  evaluatePublishGate,
  isScheduled,
  MIN_PUBLISHABLE_BODY_CHARS,
  planArticleUpdate,
  targetStatusOf,
  type PublishGateInput,
} from '../lifecycle.js'

const NOW = '2026-07-01T12:00:00.000Z'
const BODY = 'x'.repeat(MIN_PUBLISHABLE_BODY_CHARS)

function gateInput(overrides: Partial<PublishGateInput> = {}): PublishGateInput {
  return {
    reviewStatus: 'human_reviewed',
    licenseStatus: 'official',
    displayAllowed: true,
    slug: 'materia',
    title: 'Uma materia real',
    body: BODY,
    languageCode: 'pt-BR',
    publishedAtIso: '2026-07-01T10:00:00.000Z',
    requiresAttribution: false,
    requiresLinkback: false,
    sourceName: null,
    sourceUrl: null,
    provenanceCount: 1,
    ...overrides,
  }
}

describe('transicoes', () => {
  it('permite o caminho editorial normal', () => {
    expect(canTransition('draft', 'needs_review').allowed).toBe(true)
    expect(canTransition('needs_review', 'human_reviewed').allowed).toBe(true)
    expect(canTransition('human_reviewed', 'published').allowed).toBe(true)
    expect(canTransition('published', 'needs_update').allowed).toBe(true)
  })

  it('proibe publicar pulando a revisao', () => {
    expect(canTransition('draft', 'published').allowed).toBe(false)
    expect(canTransition('ai_generated', 'published').allowed).toBe(false)
    expect(canTransition('needs_review', 'published').allowed).toBe(false)
  })

  it('materia retratada nunca volta direto a published', () => {
    // Voltar `archived`/`blocked` para `published` republicaria sem nova
    // revisao humana exatamente o conteudo que foi retirado.
    expect(canTransition('archived', 'published').allowed).toBe(false)
    expect(canTransition('blocked', 'published').allowed).toBe(false)
    expect(canTransition('archived', 'needs_review').allowed).toBe(true)
  })

  it('recusa transicao para o mesmo estado', () => {
    expect(canTransition('published', 'published').allowed).toBe(false)
  })

  it('mapeia acao -> estado alvo', () => {
    expect(targetStatusOf('publish')).toBe('published')
    expect(targetStatusOf('unpublish')).toBe('blocked')
    expect(targetStatusOf('retract')).toBe('archived')
    expect(targetStatusOf('approve')).toBe('human_reviewed')
  })
})

describe('gate de publicacao', () => {
  it('publica quando tudo esta presente', () => {
    const r = evaluatePublishGate(gateInput(), NOW)
    expect(r.canPublish).toBe(true)
    expect(r.reasons).toEqual([])
  })

  it('exige proveniencia: artigo sem nenhuma fonte nao publica', () => {
    const r = evaluatePublishGate(gateInput({ provenanceCount: 0 }), NOW)
    expect(r.canPublish).toBe(false)
    expect(r.reasons).toContain('missing_required_provenance')
  })

  it('exige corpo proprio real', () => {
    expect(evaluatePublishGate(gateInput({ body: 'curto' }), NOW).reasons).toContain('missing_body')
    expect(evaluatePublishGate(gateInput({ body: null }), NOW).reasons).toContain('missing_body')
  })

  it('exige idioma e licenca exibivel', () => {
    expect(evaluatePublishGate(gateInput({ languageCode: '  ' }), NOW).reasons).toContain(
      'missing_language',
    )
    expect(evaluatePublishGate(gateInput({ licenseStatus: 'unknown' }), NOW).reasons).toContain(
      'blocked_license',
    )
    expect(evaluatePublishGate(gateInput({ displayAllowed: false }), NOW).reasons).toContain(
      'display_not_allowed',
    )
  })

  it('exige atribuicao/linkback quando a licenca cobra', () => {
    expect(
      evaluatePublishGate(gateInput({ requiresAttribution: true, sourceName: null }), NOW).reasons,
    ).toContain('missing_required_attribution')
    expect(
      evaluatePublishGate(gateInput({ requiresLinkback: true, sourceUrl: null }), NOW).reasons,
    ).toContain('missing_required_linkback')
  })

  it('AGENDAR e legitimo: data futura nao bloqueia o ato de publicar', () => {
    // O embargo e aplicado na LEITURA publica, nao na escrita editorial.
    const r = evaluatePublishGate(
      gateInput({ publishedAtIso: '2026-12-01T00:00:00.000Z' }),
      NOW,
    )
    expect(r.canPublish).toBe(true)
    expect(r.reasons).not.toContain('future_scheduled')
  })
})

describe('agendamento', () => {
  it('published + data futura = agendada', () => {
    expect(isScheduled('published', '2026-12-01T00:00:00.000Z', NOW)).toBe(true)
  })

  it('published + data passada = no ar', () => {
    expect(isScheduled('published', '2026-01-01T00:00:00.000Z', NOW)).toBe(false)
  })

  it('rascunho nunca e "agendado"', () => {
    expect(isScheduled('draft', '2026-12-01T00:00:00.000Z', NOW)).toBe(false)
  })
})

describe('atualizacao e correcao', () => {
  it('atualizacao normal preserva slug e published_at', () => {
    const plan = planArticleUpdate({ correctionNote: null })
    expect(plan.preservesSlug).toBe(true)
    expect(plan.preservesPublishedAt).toBe(true)
    expect(plan.touchesUpdatedAt).toBe(true)
    expect(plan.isMaterialCorrection).toBe(false)
  })

  it('correcao material exige nota explicita (nunca inferida do diff)', () => {
    expect(planArticleUpdate({ correctionNote: '   ' }).isMaterialCorrection).toBe(false)
    expect(
      planArticleUpdate({ correctionNote: 'Corrigido o nome do diretor.' }).isMaterialCorrection,
    ).toBe(true)
  })
})
