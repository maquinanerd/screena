/**
 * Testes dos contratos editoriais.
 *
 * Cada caso invalido DERIVA da fixture valida alterando um campo. Isso garante
 * que a rejeicao vem da regra sob teste, e nao de outro defeito acidental do
 * objeto — um teste que monta um objeto invalido do zero passa mesmo quando a
 * regra que ele deveria provar foi removida.
 */

import { describe, expect, it } from 'vitest'

import {
  EDITORIAL_BLOCK_TYPES,
  FACT_ORIGINS,
  editorialBody,
  publishedEditorialBody,
  findForbiddenMarkup,
  findForbiddenPublishKey,
  isMediaUsableForEditorial,
  parseCinerieEditorialContextV1,
  parseEditorialDraftV1,
  parsePublicationEventV1,
  validEditorialContext,
  validEditorialDraft,
  validPublicationEvent,
  type ContextMedia,
} from '../index.js'

/** Copia profunda simples (as fixtures sao JSON puro). */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/* ------------------------------------------------------------------ */
/* editorial-draft-v1                                                  */
/* ------------------------------------------------------------------ */

describe('editorial-draft-v1', () => {
  it('aceita a fixture valida', () => {
    const result = parseEditorialDraftV1(validEditorialDraft)
    expect(result.ok, JSON.stringify(result.ok ? [] : result.issues, null, 2)).toBe(true)
  })

  it('recusa contractVersion incompativel', () => {
    const draft = clone(validEditorialDraft) as Record<string, unknown>
    draft.contractVersion = 'editorial-draft-v2'
    const result = parseEditorialDraftV1(draft)
    expect(result.ok).toBe(false)
  })

  it('recusa QUALQUER tentativa de auto-publicacao, em qualquer nivel', () => {
    for (const key of ['publish', 'autoPublish', 'bypassReview', 'workflowStatus', '_status']) {
      const draft = clone(validEditorialDraft) as Record<string, unknown>
      draft[key] = true
      const result = parseEditorialDraftV1(draft)
      expect(result.ok, `chave ${key} deveria ser recusada`).toBe(false)
      if (!result.ok) {
        expect(result.issues[0]?.message).toContain('o writer nunca publica')
      }
    }
  })

  it('acha chave proibida ANINHADA (defesa em profundidade)', () => {
    expect(findForbiddenPublishKey({ a: { b: [{ autoPublish: true }] } })).toBe('autoPublish')
    expect(findForbiddenPublishKey({ a: { b: [{ ok: true }] } })).toBeNull()
  })

  it('recusa bloco com HTML/script', () => {
    const draft = clone(validEditorialDraft)
    const block = draft.blocks[0]
    if (block?.type !== 'paragraph') throw new Error('fixture mudou')
    block.text = 'texto <script>alert(1)</script>'
    const result = parseEditorialDraftV1(draft)
    expect(result.ok).toBe(false)
  })

  it('recusa origem factual invalida', () => {
    const draft = clone(validEditorialDraft) as Record<string, unknown>
    const claims = draft.claimsUsed as Record<string, unknown>[]
    claims[0]!.origin = 'wikipedia_guess'
    expect(parseEditorialDraftV1(draft).ok).toBe(false)
  })

  it('recusa sourceRef que nao existe em externalSources', () => {
    const draft = clone(validEditorialDraft)
    draft.claimsUsed[0]!.sourceRefs = ['src-inexistente']
    const result = parseEditorialDraftV1(draft)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.some((i) => i.message.includes('sourceRef inexistente'))).toBe(true)
    }
  })

  it('recusa mediaRef que nao existe em mediaCandidates', () => {
    const draft = clone(validEditorialDraft)
    draft.blocks.push({ id: 'b9', type: 'image', mediaRef: 'nao-existe', alt: 'x' })
    expect(parseEditorialDraftV1(draft).ok).toBe(false)
  })

  it('recusa update/link/consolidate sem targetArticleId', () => {
    for (const action of ['update', 'link', 'consolidate'] as const) {
      const draft = clone(validEditorialDraft)
      draft.proposedAction = action
      const result = parseEditorialDraftV1(draft)
      expect(result.ok, `${action} sem alvo deveria falhar`).toBe(false)
    }
  })

  it('recusa create COM targetArticleId', () => {
    const draft = clone(validEditorialDraft)
    draft.targetArticleId = 'article-1'
    expect(parseEditorialDraftV1(draft).ok).toBe(false)
  })

  it('aceita update com targetArticleId', () => {
    const draft = clone(validEditorialDraft)
    draft.proposedAction = 'update'
    draft.targetArticleId = 'article-880'
    expect(parseEditorialDraftV1(draft).ok).toBe(true)
  })

  it('recusa campo desconhecido (strict)', () => {
    const draft = clone(validEditorialDraft) as Record<string, unknown>
    draft.campoNovoNaoPrevisto = 'x'
    expect(parseEditorialDraftV1(draft).ok).toBe(false)
  })

  it('recusa instante sem timezone', () => {
    const draft = clone(validEditorialDraft)
    draft.generatedAt = '2026-07-28T12:30:00'
    expect(parseEditorialDraftV1(draft).ok).toBe(false)
  })

  it('nao vaza o valor recebido nas mensagens de erro', () => {
    const draft = clone(validEditorialDraft) as Record<string, unknown>
    draft.title = 'SEGREDO-NAO-DEVE-APARECER'.repeat(50)
    const result = parseEditorialDraftV1(draft)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const joined = JSON.stringify(result.issues)
      expect(joined).not.toContain('SEGREDO-NAO-DEVE-APARECER')
    }
  })
})

/* ------------------------------------------------------------------ */
/* blocos                                                              */
/* ------------------------------------------------------------------ */

describe('blocos editoriais', () => {
  it('recusa id de bloco duplicado', () => {
    const result = editorialBody.safeParse([
      { id: 'x', type: 'paragraph', text: 'um' },
      { id: 'x', type: 'paragraph', text: 'dois' },
    ])
    expect(result.success).toBe(false)
  })

  it('recusa tipo de bloco desconhecido', () => {
    expect(editorialBody.safeParse([{ id: 'x', type: 'rawHtml', html: '<b>x</b>' }]).success).toBe(
      false,
    )
  })

  it('recusa corpo vazio', () => {
    expect(editorialBody.safeParse([]).success).toBe(false)
  })

  /*
   * A formatacao inline vive SO no corpo publicado — e este e o teste que
   * segura o desenho.
   *
   * Os contratos de ENTRADA sao comparados por hash com igualdade estrita
   * (`checkContractCompatibility`), e o MNScr declara esse hash a cada pedido.
   * Se alguem "simplificar" trocando `editorialBody` por `publishedEditorialBody`
   * no contrato de entrada, o hash muda e TODO pedido em voo vira
   * `hash_mismatch` — em producao, sem nada aqui ficar vermelho. Estes dois
   * testes sao o alarme.
   */
  it('o corpo de ENTRADA PRESERVA a formatacao inline (contrato 1.1.0)', () => {
    // Ate a 1.0.0 este teste afirmava o contrario, e a razao era o hash: campo
    // novo na entrada derrubava emissor em voo. `SUPERSEDED_CONTRACTS` resolveu
    // aquilo, e negrito/italico/link passaram a poder nascer no pipeline.
    const marks = [{ start: 0, end: 3, type: 'bold' as const }]
    const result = editorialBody.safeParse([
      { id: 'x', type: 'paragraph', text: 'negrito', marks },
    ])
    expect(result.success).toBe(true)
    if (result.success) {
      const block = result.data[0]
      expect(block?.type === 'paragraph' ? block.marks : null).toEqual(marks)
    }
  })

  it('o corpo de ENTRADA recusa marcacao que o render nao saberia desenhar', () => {
    // A validacao de intervalo vale nas DUAS pontas, com a mesma funcao: um
    // emissor automatico erra offset com muito mais facilidade que um humano.
    const foraDoTexto = editorialBody.safeParse([
      { id: 'x', type: 'paragraph', text: 'curto', marks: [{ start: 0, end: 99, type: 'bold' }] },
    ])
    expect(foraDoTexto.success).toBe(false)

    const linkSemDestino = editorialBody.safeParse([
      { id: 'x', type: 'paragraph', text: 'texto', marks: [{ start: 0, end: 3, type: 'link' }] },
    ])
    expect(linkSemDestino.success).toBe(false)

    const sobrepostas = editorialBody.safeParse([
      {
        id: 'x',
        type: 'paragraph',
        text: 'um texto qualquer',
        marks: [
          { start: 0, end: 8, type: 'bold' },
          { start: 4, end: 12, type: 'bold' },
        ],
      },
    ])
    expect(sobrepostas.success).toBe(false)
  })

  it('o corpo PUBLICADO preserva a formatacao inline', () => {
    const marks = [{ start: 0, end: 3, type: 'bold' as const }]
    const result = publishedEditorialBody.safeParse([
      { id: 'x', type: 'paragraph', text: 'negrito', marks },
    ])
    expect(result.success).toBe(true)
    if (result.success) {
      const block = result.data[0]
      expect(block?.type === 'paragraph' ? block.marks : null).toEqual(marks)
    }
  })

  it('o corpo PUBLICADO recusa marcacao que o render nao saberia desenhar', () => {
    const cases: readonly unknown[] = [
      [{ start: 0, end: 99, type: 'bold' }],
      [{ start: 3, end: 1, type: 'bold' }],
      [{ start: 0, end: 3, type: 'link' }],
      [{ start: 0, end: 3, type: 'link', href: 'javascript:alert(1)' }],
      [{ start: 0, end: 3, type: 'bold', href: 'https://x.test' }],
      [
        { start: 0, end: 4, type: 'bold' },
        { start: 2, end: 6, type: 'bold' },
      ],
    ]
    for (const marks of cases) {
      const result = publishedEditorialBody.safeParse([
        { id: 'x', type: 'paragraph', text: 'negrito', marks },
      ])
      expect(result.success, JSON.stringify(marks)).toBe(false)
    }
  })

  it('o corpo PUBLICADO aceita tipos DIFERENTES sobrepostos', () => {
    const result = publishedEditorialBody.safeParse([
      {
        id: 'x',
        type: 'paragraph',
        text: 'negrito',
        marks: [
          { start: 0, end: 7, type: 'bold' },
          { start: 0, end: 7, type: 'link', href: 'https://cinerie.com' },
        ],
      },
    ])
    expect(result.success).toBe(true)
  })

  it('detecta markup proibido', () => {
    expect(findForbiddenMarkup('ok')).toBeNull()
    expect(findForbiddenMarkup('<script>x</script>')).toContain('script')
    expect(findForbiddenMarkup('<div>x</div>')).toContain('HTML')
    expect(findForbiddenMarkup('clique javascript:alert(1)')).toContain('javascript')
    expect(findForbiddenMarkup('<img onerror="x">')).not.toBeNull()
  })

  it('expoe a lista de tipos para o CMS espelhar', () => {
    expect(EDITORIAL_BLOCK_TYPES).toContain('paragraph')
    expect(EDITORIAL_BLOCK_TYPES).toContain('sourceList')
    expect(EDITORIAL_BLOCK_TYPES).not.toContain('rawHtml')
  })

  it('as origens factuais sao exatamente as seis do ADR 0015', () => {
    expect([...FACT_ORIGINS]).toEqual([
      'external_source',
      'cinerie_catalog',
      'cinerie_editorial',
      'licensed_media',
      'human_input',
      'inference',
    ])
  })
})

/* ------------------------------------------------------------------ */
/* publication-event-v1                                                */
/* ------------------------------------------------------------------ */

describe('publication-event-v1', () => {
  it('aceita a fixture valida', () => {
    const result = parsePublicationEventV1(validPublicationEvent)
    expect(result.ok, JSON.stringify(result.ok ? [] : result.issues, null, 2)).toBe(true)
  })

  it('recusa published sem publishedContent', () => {
    const event = clone(validPublicationEvent) as Record<string, unknown>
    delete event.publishedContent
    expect(parsePublicationEventV1(event).ok).toBe(false)
  })

  it('recusa retracted sem retractionReason', () => {
    const event = clone(validPublicationEvent) as Record<string, unknown>
    event.eventType = 'article.retracted'
    delete event.publishedContent
    delete event.seo
    expect(parsePublicationEventV1(event).ok).toBe(false)
  })

  it('aceita retracted com motivo', () => {
    const event = clone(validPublicationEvent) as Record<string, unknown>
    event.eventType = 'article.retracted'
    delete event.publishedContent
    delete event.seo
    event.retractionReason = 'Fato central nao se confirmou.'
    expect(parsePublicationEventV1(event).ok).toBe(true)
  })

  it('recusa materia publicada sem autor', () => {
    const event = clone(validPublicationEvent)
    event.publishedContent!.authors = []
    expect(parsePublicationEventV1(event).ok).toBe(false)
  })

  it('recusa midia com requiresAttribution e sem credito', () => {
    const event = clone(validPublicationEvent)
    delete event.media[0]!.credit
    const result = parsePublicationEventV1(event)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.some((i) => i.message.includes('requiresAttribution'))).toBe(true)
    }
  })

  it('recusa conteudo aiAssisted sem nenhuma fonte externa', () => {
    const event = clone(validPublicationEvent)
    event.provenance.externalSources = []
    expect(parsePublicationEventV1(event).ok).toBe(false)
  })

  it('recusa ator que nao pode publicar', () => {
    const event = clone(validPublicationEvent) as Record<string, unknown>
    ;(event.actor as Record<string, unknown>).role = 'writer'
    expect(parsePublicationEventV1(event).ok).toBe(false)
  })

  it('recusa entidade nao verificada no evento publicado', () => {
    const event = clone(validPublicationEvent) as Record<string, unknown>
    ;(event.entities as Record<string, unknown>[])[0]!.verified = false
    expect(parsePublicationEventV1(event).ok).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* cinerie-editorial-context-v1                                        */
/* ------------------------------------------------------------------ */

describe('cinerie-editorial-context-v1', () => {
  it('aceita a fixture valida', () => {
    const result = parseCinerieEditorialContextV1(validEditorialContext)
    expect(result.ok, JSON.stringify(result.ok ? [] : result.issues, null, 2)).toBe(true)
  })

  it('recusa relacao apontando para entidade ausente', () => {
    const context = clone(validEditorialContext)
    context.relations[0]!.fromEntityId = 'entity-inexistente'
    expect(parseCinerieEditorialContextV1(context).ok).toBe(false)
  })

  it('recusa hero/social sem permissao editorial (permissao incoerente)', () => {
    const context = clone(validEditorialContext)
    context.media[0]!.allowedForEditorial = false
    context.media[0]!.allowedForHero = true
    expect(parseCinerieEditorialContextV1(context).ok).toBe(false)
  })

  it('midia so e usavel quando approved E allowedForEditorial (fail-closed)', () => {
    const base = validEditorialContext.media[0] as ContextMedia
    expect(isMediaUsableForEditorial(base)).toBe(true)

    for (const status of ['unknown', 'pending', 'restricted', 'expired', 'prohibited'] as const) {
      expect(isMediaUsableForEditorial({ ...base, licenseStatus: status })).toBe(false)
    }
    expect(isMediaUsableForEditorial({ ...base, allowedForEditorial: false })).toBe(false)
  })

  it('omissoes sao parte do contrato: ausencia nao significa inexistencia', () => {
    const result = parseCinerieEditorialContextV1(validEditorialContext)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.omissions[0]?.reason).toBe('license_unknown')
    }
  })
})
