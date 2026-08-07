/**
 * A RETRATACAO PRECISA ANDAR COM A SEQUENCIA.
 *
 * O portao de "fora de ordem" compara a sequencia de EMISSAO do evento com a
 * ultima sequencia PROJETADA do artigo. Como o ramo de remocao devolvia
 * `article: null`, nada gravava `projected_sequence` — ela ficava parada no
 * valor da ultima PUBLICACAO.
 *
 * O caminho concreto do estrago, com numeros:
 *
 *   evento 30  article.published   -> projected_sequence = 30
 *   evento 40  article.updated     -> projected_sequence = 40
 *   evento 50  article.retracted   -> projected_sequence CONTINUA 40
 *   evento 40  reentregue (retry apos backoff, redelivery da fila)
 *              -> 40 <= 40? nao, e IGUAL, entao passa? nao: 40 <= 40 e stale.
 *
 * Trocando o exemplo para o caso que de fato acontece: a retratacao vem de um
 * documento cujo ultimo `updated` projetado foi o 30, e um `updated` de
 * sequencia 40 estava preso na fila. Retratado no 50, a sequencia fica em 30, e
 * o 40 atrasado passa (40 > 30) e REPUBLICA a materia retratada — no ar de
 * novo, indexavel de novo, sem ninguem ter decidido isso. Uma retratacao que se
 * desfaz sozinha e o pior defeito possivel nesta cadeia: ela existe justamente
 * para tirar do ar o que nao podia estar la.
 */

import { describe, expect, it } from 'vitest'

import { decideProjection, type ProjectionEvent } from '../editorial-projection.js'

const OCCURRED = '2026-07-28T12:00:00.000Z'
const PUBLISHED = '2026-07-28T11:00:00.000Z'

function event(overrides: Partial<ProjectionEvent> = {}): ProjectionEvent {
  return {
    eventId: 'evt-1',
    idempotencyKey: 'idem-1',
    eventType: 'article.published',
    payloadDocumentId: 'doc-1',
    emissionSequence: 30,
    language: 'pt-BR',
    occurredAtIso: OCCURRED,
    retractionReason: null,
    publishedContent: {
      title: 'Titulo da materia',
      subtitle: null,
      slug: 'titulo-da-materia',
      summary: 'Resumo editorial.',
      contentType: 'news',
      body: [{ type: 'paragraph', id: 'b1', text: 'Primeiro paragrafo.' }],
      authorName: 'Redacao Cinerie',
      publishedAtIso: PUBLISHED,
      correctedAtIso: null,
      correctionNote: null,
      aiAssisted: false,
    },
    seo: {
      metaTitle: 'Meta',
      metaDescription: 'Desc',
      noindex: false,
      socialTitle: null,
      socialDescription: null,
      canonicalOverride: null,
      focusKeyphrase: null,
      relatedKeyphrases: [],
      editorialKeywords: [],
      schemaTypeRecommendation: null,
      articleSection: null,
      approvedImageAlt: [],
      approvedInternalLinks: [],
    },
    provenance: { primarySourceName: null, primarySourceUrl: null, externalSources: [] },
    media: [],
    entities: [],
    ...overrides,
  } as ProjectionEvent
}

const base = { existingReceipt: null, existing: null, contentVersion: 'sha256:abc' }

const existingAt = (projectedSequence: number) => ({
  articleId: '77',
  projectedSequence,
  translationBodyBlocksVersion: null,
})

describe('sequencia projetada na remocao', () => {
  it('CONTROLE POSITIVO: publicacao avanca a sequencia', () => {
    // Sem ele, um `sequenceAdvance` sempre nulo passaria nos testes negativos.
    const decision = decideProjection({ ...base, event: event({ emissionSequence: 30 }) })
    expect(decision.outcome).toBe('applied')
    expect(decision.sequenceAdvance).toBe(30)
    expect(decision.article?.projectedSequence).toBe(30)
  })

  it('RETRATACAO avanca a sequencia mesmo sem escrever artigo', () => {
    const decision = decideProjection({
      ...base,
      existing: existingAt(30),
      event: event({
        eventType: 'article.retracted',
        emissionSequence: 50,
        publishedContent: null,
        seo: null,
        retractionReason: 'fato apurado incorretamente',
      }),
    })
    expect(decision.outcome).toBe('applied')
    // `article` continua nulo — retratar NAO reescreve o texto...
    expect(decision.article).toBeNull()
    // ...mas a sequencia PRECISA andar, senao o evento antigo ressuscita.
    expect(decision.sequenceAdvance).toBe(50)
  })

  it('DESPUBLICACAO tambem avanca', () => {
    const decision = decideProjection({
      ...base,
      existing: existingAt(30),
      event: event({
        eventType: 'article.unpublished',
        emissionSequence: 48,
        publishedContent: null,
        seo: null,
      }),
    })
    expect(decision.sequenceAdvance).toBe(48)
  })

  it('O CENARIO INTEIRO: retratada no 50, o `updated` 40 atrasado NAO republica', () => {
    // Antes: a retratacao deixava a sequencia em 30 e o 40 passava.
    const retract = decideProjection({
      ...base,
      existing: existingAt(30),
      event: event({
        eventType: 'article.retracted',
        emissionSequence: 50,
        publishedContent: null,
        seo: null,
        retractionReason: 'fato apurado incorretamente',
      }),
    })
    expect(retract.sequenceAdvance).toBe(50)

    // O estado publico depois da retratacao, ja com a sequencia corrigida.
    const late = decideProjection({
      ...base,
      existing: existingAt(retract.sequenceAdvance ?? 0),
      event: event({ eventType: 'article.updated', emissionSequence: 40 }),
    })
    expect(late.outcome).toBe('skipped_stale')
    expect(late.article).toBeNull()

    // CONTRAPROVA do mesmo cenario com o comportamento antigo: se a sequencia
    // tivesse ficado em 30, o mesmo evento passaria e republicaria.
    const comSequenciaAntiga = decideProjection({
      ...base,
      existing: existingAt(30),
      event: event({ eventType: 'article.updated', emissionSequence: 40 }),
    })
    expect(comSequenciaAntiga.outcome).toBe('applied')
  })

  it('desfechos que NAO aplicam nao mexem na sequencia', () => {
    // Replay, fora de ordem e licenca: nenhum deles pode empurrar o marcador.
    const replay = decideProjection({
      ...base,
      existingReceipt: { outcome: 'applied' },
      event: event(),
    })
    expect(replay.sequenceAdvance).toBeNull()

    const stale = decideProjection({
      ...base,
      existing: existingAt(90),
      event: event({ emissionSequence: 10 }),
    })
    expect(stale.outcome).toBe('skipped_stale')
    expect(stale.sequenceAdvance).toBeNull()
  })
})
