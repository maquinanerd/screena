/**
 * publication-intake.test.ts — O que o pedido do MNScr vira, e o que ele PERDE.
 *
 * Este arquivo cobre a parte PURA da correcao: dado o pedido ja validado pelo
 * contrato, quais campos atravessam para a persistencia e quais sao descartados
 * — cada descarte com um codigo que sai na resposta HTTP.
 *
 * O que estes testes NAO provam: que o Payload aceita os campos resultantes.
 * Essa pergunta e de integracao e vive em
 * `publication-response-truth.integration.test.ts`. Aqui se prova a decisao; la,
 * o efeito.
 */

import { describe, expect, it } from 'vitest'

import {
  findStrippedBlockMarks,
  planSeoPersistence,
  resolveEntityReferences,
  resolveHeroMedia,
  type MediaAuthorizationFacts,
  type SeoProposalFacts,
} from '../publication-intake.js'

/** Codigos dos avisos, na ordem em que sairam. */
function codes(warnings: readonly { readonly code: string }[]): string[] {
  return warnings.map((warning) => warning.code)
}

function authorized(overrides: Partial<MediaAuthorizationFacts> = {}): MediaAuthorizationFacts {
  return { exists: true, licenseApproved: true, allowedForHero: true, ...overrides }
}

/* ------------------------------------------------------------------ */
/* F2 — hero                                                          */
/* ------------------------------------------------------------------ */

describe('resolveHeroMedia', () => {
  it('midia marcada como hero e autorizada vira a capa', () => {
    const result = resolveHeroMedia(
      [{ mediaId: '7', intendedUse: 'hero' }],
      new Map([['7', authorized()]]),
    )
    expect(result.heroMediaId).toBe('7')
    expect(result.warnings).toEqual([])
  })

  it('sem nenhuma midia marcada como hero: nada a decidir, nenhum aviso', () => {
    const result = resolveHeroMedia(
      [{ mediaId: '7', intendedUse: 'inline' }],
      new Map([['7', authorized()]]),
    )
    expect(result.heroMediaId).toBeNull()
    expect(result.warnings).toEqual([])
  })

  it('sem allowedForHero: NAO grava, e diz por que', () => {
    const result = resolveHeroMedia(
      [{ mediaId: '7', intendedUse: 'hero' }],
      new Map([['7', authorized({ allowedForHero: false })]]),
    )
    expect(result.heroMediaId).toBeNull()
    expect(codes(result.warnings)).toEqual(['HERO_MEDIA_NOT_AUTHORIZED'])
    expect(result.warnings[0]?.detail).toContain('allowedForHero')
  })

  it('licenca editorial nao aprovada tambem recusa a capa', () => {
    const result = resolveHeroMedia(
      [{ mediaId: '7', intendedUse: 'hero' }],
      new Map([['7', authorized({ licenseApproved: false })]]),
    )
    expect(result.heroMediaId).toBeNull()
    expect(codes(result.warnings)).toEqual(['HERO_MEDIA_NOT_AUTHORIZED'])
  })

  it('midia inexistente no CMS recusa a capa em vez de apontar para o vazio', () => {
    const result = resolveHeroMedia([{ mediaId: '7', intendedUse: 'hero' }], new Map())
    expect(result.heroMediaId).toBeNull()
    expect(codes(result.warnings)).toEqual(['HERO_MEDIA_NOT_AUTHORIZED'])
  })

  it('mais de uma capa: usa a PRIMEIRA e nomeia as demais', () => {
    const result = resolveHeroMedia(
      [
        { mediaId: '7', intendedUse: 'hero' },
        { mediaId: '8', intendedUse: 'hero' },
        { mediaId: '9', intendedUse: 'hero' },
      ],
      new Map([
        ['7', authorized()],
        ['8', authorized()],
        ['9', authorized()],
      ]),
    )
    expect(result.heroMediaId).toBe('7')
    expect(codes(result.warnings)).toEqual([
      'HERO_MEDIA_EXTRA_IGNORED',
      'HERO_MEDIA_EXTRA_IGNORED',
    ])
    expect(result.warnings.map((warning) => warning.field)).toEqual([
      'media[1].intendedUse',
      'media[2].intendedUse',
    ])
  })

  it('primeira capa recusada NAO promove a segunda em silencio', () => {
    // Promover a segunda seria escolher por conta propria a imagem que
    // representa a materia. O pedido diz qual e a capa; sem ela, nao ha capa.
    const result = resolveHeroMedia(
      [
        { mediaId: '7', intendedUse: 'hero' },
        { mediaId: '8', intendedUse: 'hero' },
      ],
      new Map([
        ['7', authorized({ allowedForHero: false })],
        ['8', authorized()],
      ]),
    )
    expect(result.heroMediaId).toBeNull()
    expect(codes(result.warnings)).toEqual([
      'HERO_MEDIA_NOT_AUTHORIZED',
      'HERO_MEDIA_EXTRA_IGNORED',
    ])
  })
})

/* ------------------------------------------------------------------ */
/* F3 — entityLinks                                                   */
/* ------------------------------------------------------------------ */

describe('resolveEntityReferences', () => {
  /** Abaixo do limiar: o caso que continua esperando humano. */
  const link = {
    entityKind: 'movie',
    entityId: '4210',
    relation: 'primary_subject',
    confidence: 0.85,
  }
  /** O limiar de producao. Toda chamada declara o seu — nao ha default aqui. */
  const options = { minConfidence: 0.9 }

  it('confianca ABAIXO do limiar atravessa como NAO verificado, sem proveniencia', () => {
    const result = resolveEntityReferences([link], options)
    expect(result.rows).toEqual([
      {
        entityKind: 'movie',
        entityId: '4210',
        relation: 'primary_subject',
        confidence: 0.85,
        verified: false,
      },
    ])
    expect(result.autoVerified).toEqual([])
  })

  it('confianca NO limiar ja nasce verificada, com a proveniencia da maquina', () => {
    // O corte e `>=`, nao `>`: `exact_title_year` da entity-resolve vale
    // exatamente 0.9, e um `>` deixaria de fora justamente o casamento que o
    // ADR 0019 decidiu incluir.
    const result = resolveEntityReferences([{ ...link, confidence: 0.9 }], options)
    expect(result.rows).toEqual([
      {
        entityKind: 'movie',
        entityId: '4210',
        relation: 'primary_subject',
        confidence: 0.9,
        verified: true,
        verificationSource: 'automation_confidence',
      },
    ])
    expect(result.autoVerified).toEqual([
      { entityKind: 'movie', entityId: '4210', confidence: 0.9 },
    ])
  })

  it('tmdb_id (1.0) nasce verificado; exact_name (0.85) nao — na mesma chamada', () => {
    const result = resolveEntityReferences(
      [
        { ...link, confidence: 1 },
        { ...link, entityKind: 'person', entityId: '77', confidence: 0.85 },
      ],
      options,
    )
    expect(result.rows.map((row) => [row.entityId, row.verified])).toEqual([
      ['4210', true],
      ['77', false],
    ])
    expect(codes(result.warnings)).toEqual([
      'ENTITY_LINK_AUTO_VERIFIED',
      'ENTITY_LINK_UNVERIFIED',
    ])
  })

  it('o limiar e CONFIGURAVEL: apertar o corte devolve o vinculo ao humano', () => {
    const result = resolveEntityReferences([{ ...link, confidence: 0.9 }], {
      minConfidence: 0.95,
    })
    expect(result.rows[0]?.verified).toBe(false)
    expect(result.autoVerified).toEqual([])
  })

  it('limiar invalido NAO auto-verifica nada — nem com confianca 1', () => {
    // `0` e o que `parseFloat("0,9")` devolve. Se ele valesse como limiar, o
    // erro de digitacao mais provavel desta variavel seria o que verifica tudo.
    for (const minConfidence of [0, Number.NaN, -1, 2]) {
      const result = resolveEntityReferences([{ ...link, confidence: 1 }], { minConfidence })
      expect(result.rows[0]?.verified).toBe(false)
      expect(result.rows[0]?.verificationSource).toBeUndefined()
    }
  })

  it('tipo que a resolucao de entidade nao traduz nunca nasce verificado', () => {
    // `season`, `episode`, `character` e `franchise` nao tem resolvedor atras do
    // numero: a confianca ali e um julgamento que ninguem reproduz.
    for (const entityKind of ['season', 'episode', 'character', 'franchise']) {
      const result = resolveEntityReferences([{ ...link, entityKind, confidence: 1 }], options)
      expect(result.rows[0]?.verified).toBe(false)
    }
  })

  it('lista vazia nao produz linha nem aviso', () => {
    const result = resolveEntityReferences([], options)
    expect(result.rows).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('avisa que o vinculo abaixo do limiar nao chega ao site sem confirmacao humana', () => {
    const result = resolveEntityReferences([link], options)
    expect(codes(result.warnings)).toEqual(['ENTITY_LINK_UNVERIFIED'])
  })

  it('o aviso de auto-verificacao nomeia confianca e limiar', () => {
    const result = resolveEntityReferences([{ ...link, confidence: 1 }], options)
    const notice = result.warnings.find((warning) => warning.code === 'ENTITY_LINK_AUTO_VERIFIED')
    expect(notice?.detail).toContain('0.9')
    expect(notice?.detail).toContain('movie:4210=1')
  })

  it('id fora da forma de id interno e RECUSADO, nunca gravado no otimismo', () => {
    // O caso perigoso: um id do TMDB e um inteiro valido e nao falha em lugar
    // nenhum — ele vincula a entidade ERRADA se o numero existir como id
    // interno. Aqui so a FORMA e checavel; a existencia e o tipo sao conferidos
    // no lado publico (ADR 0018), e o ADR 0019 NAO afrouxou isso: confianca 1.0
    // sobre id de forma errada continua recusada.
    const result = resolveEntityReferences(
      [
        { ...link, entityId: 'tt0111161', confidence: 1 },
        { ...link, entityId: 'tmdb:550', confidence: 1 },
        { ...link, entityId: '0', confidence: 1 },
        { ...link, entityId: '007', confidence: 1 },
      ],
      options,
    )
    expect(result.rows).toEqual([])
    expect(result.autoVerified).toEqual([])
    expect(codes(result.warnings)).toEqual([
      'ENTITY_LINK_ID_NOT_INTERNAL',
      'ENTITY_LINK_ID_NOT_INTERNAL',
      'ENTITY_LINK_ID_NOT_INTERNAL',
      'ENTITY_LINK_ID_NOT_INTERNAL',
    ])
  })

  it('recusa um vinculo nao derruba os demais', () => {
    const result = resolveEntityReferences([{ ...link, entityId: 'tt0111161' }, link], options)
    expect(result.rows.map((row) => row.entityId)).toEqual(['4210'])
    expect(codes(result.warnings)).toEqual([
      'ENTITY_LINK_ID_NOT_INTERNAL',
      'ENTITY_LINK_UNVERIFIED',
    ])
  })

  it('o aviso de recusa nomeia o indice do vinculo', () => {
    const result = resolveEntityReferences([link, { ...link, entityId: 'nope' }], options)
    const refused = result.warnings.find((warning) => warning.code === 'ENTITY_LINK_ID_NOT_INTERNAL')
    expect(refused?.field).toBe('entityLinks[1].entityId')
  })
})

/* ------------------------------------------------------------------ */
/* F4 — SEO                                                           */
/* ------------------------------------------------------------------ */

/** Proposta minima; cada teste sobrepoe o que mede. */
function seo(overrides: Partial<SeoProposalFacts> = {}): SeoProposalFacts {
  return {
    relatedKeyphrases: [],
    editorialKeywords: [],
    imageAltSuggestions: [],
    internalLinkSuggestions: [],
    ...overrides,
  }
}

describe('planSeoPersistence', () => {
  it('editorialKeywords e relatedKeyphrases passam a ser gravados', () => {
    const plan = planSeoPersistence(seo({
      editorialKeywords: ['estreia', 'elenco'],
      relatedKeyphrases: ['data de estreia'],
    }))
    expect(plan.fields.editorialKeywords).toEqual(['estreia', 'elenco'])
    expect(plan.fields.relatedKeyphrases).toEqual(['data de estreia'])
  })

  it('lista vazia NAO grava chave: update nao apaga o vocabulario da redacao', () => {
    // Os dois campos tem `.default([])` no contrato. Um pipeline que nao os
    // preenche manda `[]` a cada revisao, e gravar isso limparia o que um
    // humano digitou — a mesma armadilha da capa, com outra roupa.
    const plan = planSeoPersistence(seo())
    expect('editorialKeywords' in plan.fields).toBe(false)
    expect('relatedKeyphrases' in plan.fields).toBe(false)
  })

  it('sugestao de Open Graph vira o par social da collection', () => {
    const plan = planSeoPersistence(seo({
      openGraphTitleSuggestion: 'Titulo social',
      openGraphDescriptionSuggestion: 'Descricao social',
    }))
    expect(plan.fields.socialTitle).toBe('Titulo social')
    expect(plan.fields.socialDescription).toBe('Descricao social')
  })

  it('campo social ausente nao grava chave — nao apaga o que a redacao escreveu', () => {
    const plan = planSeoPersistence(seo())
    expect('socialTitle' in plan.fields).toBe(false)
    expect('socialDescription' in plan.fields).toBe(false)
  })

  it('proposta sem lacuna nao inventa aviso', () => {
    expect(planSeoPersistence(seo()).warnings).toEqual([])
  })

  it('sugestao de alt de imagem nao tem campo: lacuna NOMEADA', () => {
    const plan = planSeoPersistence(seo({
      imageAltSuggestions: [{ mediaRef: 'media-1', alt: 'uma descricao' }],
    }))
    expect(codes(plan.warnings)).toEqual(['SEO_FIELD_NOT_PERSISTED'])
    expect(plan.warnings[0]?.field).toBe('seo.imageAltSuggestions')
  })

  it('sugestao de link interno nao tem campo: lacuna NOMEADA', () => {
    const plan = planSeoPersistence(seo({
      internalLinkSuggestions: [
        { targetType: 'article', targetPath: '/pt/noticias/x', anchorText: 'leia' },
      ],
    }))
    expect(codes(plan.warnings)).toEqual(['SEO_FIELD_NOT_PERSISTED'])
    expect(plan.warnings[0]?.field).toBe('seo.internalLinkSuggestions')
  })

  it('titulo de Twitter DIFERENTE do de Open Graph se perde, e o emissor fica sabendo', () => {
    // A collection tem UM par social, consumido pelas duas redes. Um valor
    // proprio do Twitter nao tem onde morar.
    const plan = planSeoPersistence(seo({
      openGraphTitleSuggestion: 'Um',
      twitterTitleSuggestion: 'Outro',
    }))
    expect(codes(plan.warnings)).toEqual(['SEO_FIELD_NOT_PERSISTED'])
    expect(plan.warnings[0]?.field).toBe('seo.twitterTitleSuggestion')
  })

  it('titulo de Twitter IGUAL ao de Open Graph nao perde nada: sem aviso', () => {
    const plan = planSeoPersistence(seo({
      openGraphTitleSuggestion: 'Um',
      twitterTitleSuggestion: 'Um',
    }))
    expect(plan.warnings).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* F1 — marks removido pelo contrato                                  */
/* ------------------------------------------------------------------ */

describe('findStrippedBlockMarks', () => {
  it('paragrafo com marks: o emissor mandou e perdeu — precisa saber', () => {
    // `marks` so existe no bloco PUBLICADO. No contrato de ENTRADA o `z.object`
    // remove a chave desconhecida em silencio, e ate aqui o silencio ia ate o
    // fim: a materia saia sem a formatacao e ninguem era avisado.
    const warnings = findStrippedBlockMarks({
      blocks: [
        { id: 'b1', type: 'paragraph', text: 'Oi', marks: [{ start: 0, end: 2, type: 'bold' }] },
      ],
    })
    expect(codes(warnings)).toEqual(['BLOCK_MARKS_STRIPPED'])
    expect(warnings[0]?.blockId).toBe('b1')
    expect(warnings[0]?.field).toBe('blocks[0].marks')
  })

  it('corpo sem marks nao produz aviso', () => {
    const warnings = findStrippedBlockMarks({
      blocks: [{ id: 'b1', type: 'paragraph', text: 'Oi' }],
    })
    expect(warnings).toEqual([])
  })

  it('corpo ausente ou de outro formato nao quebra a varredura', () => {
    expect(findStrippedBlockMarks(null)).toEqual([])
    expect(findStrippedBlockMarks({})).toEqual([])
    expect(findStrippedBlockMarks({ blocks: 'nao e lista' })).toEqual([])
    expect(findStrippedBlockMarks({ blocks: [null, 7, 'x'] })).toEqual([])
  })

  it('cada bloco com marks rende um aviso proprio', () => {
    const warnings = findStrippedBlockMarks({
      blocks: [
        { id: 'b1', type: 'paragraph', text: 'a', marks: [] },
        { id: 'b2', type: 'paragraph', text: 'b' },
        { id: 'b3', type: 'paragraph', text: 'c', marks: [{ start: 0, end: 1, type: 'italic' }] },
      ],
    })
    expect(warnings.map((warning) => warning.blockId)).toEqual(['b1', 'b3'])
  })
})
