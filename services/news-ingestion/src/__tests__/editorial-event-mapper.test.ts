/**
 * editorial-event-mapper.test.ts — Traducao contrato -> projecao.
 *
 * O evento chega de FORA (fila do CMS) e e tratado como dado nao confiavel:
 * sem passar pelo contrato, nao vira projecao.
 */

import { describe, expect, it } from 'vitest'

import { validPublicationEvent } from '@screena/editorial-contracts'

import { mapPublicationEvent } from '../editorial-event-mapper.js'

describe('mapeamento do evento de publicacao', () => {
  it('mapeia a fixture canonica do contrato', () => {
    const mapping = mapPublicationEvent(validPublicationEvent, 3)
    expect(mapping.ok).toBe(true)
    if (!mapping.ok) return
    expect(mapping.event.eventId).toBe(validPublicationEvent.eventId)
    expect(mapping.event.payloadDocumentId).toBe(validPublicationEvent.payloadDocumentId)
    // A ordem NAO vem do corpo do evento: vem da outbox, que e quem ordena.
    // O `aggregateVersion` do proprio evento e um HASH — nao ordenaria nada.
    expect(mapping.event.emissionSequence).toBe(3)
    expect(mapping.event.publishedContent?.authorName).toBe(
      validPublicationEvent.publishedContent?.authors[0]?.name,
    )
  })

  it('recusa evento fora do contrato SEM ecoar o corpo', () => {
    const mapping = mapPublicationEvent(
      { ...validPublicationEvent, language: 'idioma-que-nao-existe', publishedContent: undefined },
      1,
    )
    expect(mapping.ok).toBe(false)
    if (mapping.ok) return
    const text = mapping.issues.join(' | ')
    expect(text).toContain('language')
    // O valor recusado nao pode vazar para o log do worker.
    expect(text).not.toContain('idioma-que-nao-existe')
  })

  it('recusa qualquer coisa que nao seja um evento', () => {
    for (const junk of [null, 'texto', 42, [], {}]) {
      expect(mapPublicationEvent(junk, 1).ok).toBe(false)
    }
  })

  it('credita SOMENTE a fonte primaria — nunca a primeira da lista', () => {
    // Creditar a fonte errada e pior do que nao creditar.
    const semPrimaria = mapPublicationEvent(
      {
        ...validPublicationEvent,
        provenance: {
          ...validPublicationEvent.provenance,
          externalSources: [
            { name: 'Secundaria', url: 'https://secundaria.test/a', role: 'secondary' },
          ],
        },
      },
      1,
    )
    expect(semPrimaria.ok).toBe(true)
    if (!semPrimaria.ok) return
    expect(semPrimaria.event.provenance.primarySourceName).toBeNull()
    expect(semPrimaria.event.provenance.primarySourceUrl).toBeNull()

    // Controle positivo: com `primary` declarada, o credito aparece.
    const comPrimaria = mapPublicationEvent(
      {
        ...validPublicationEvent,
        provenance: {
          ...validPublicationEvent.provenance,
          externalSources: [
            { name: 'Secundaria', url: 'https://secundaria.test/a', role: 'secondary' },
            { name: 'Principal', url: 'https://principal.test/b', role: 'primary' },
          ],
        },
      },
      1,
    )
    expect(comPrimaria.ok).toBe(true)
    if (!comPrimaria.ok) return
    expect(comPrimaria.event.provenance.primarySourceName).toBe('Principal')
  })
})
