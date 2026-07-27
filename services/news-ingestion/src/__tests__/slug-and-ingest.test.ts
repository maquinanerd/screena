/**
 * Testes de slug/redirect e da orquestracao idempotente de ingestao.
 */

import { describe, expect, it } from 'vitest'

import { clampExcerpt, ingestEditorialItem, MAX_EXCERPT_CHARS } from '../ingest.js'
import type { IngestSourceItemResult, SourceItemStorePort } from '../ports.js'
import {
  articlePath,
  planArticleSlugChange,
  resolveArticleSlugCollision,
  slugifyArticleTitle,
} from '../slug.js'

describe('slugifyArticleTitle', () => {
  it('normaliza acento, caixa e pontuacao', () => {
    expect(slugifyArticleTitle('Duna: Parte 2 é o maior filme!')).toBe(
      'duna-parte-2-e-o-maior-filme',
    )
  })

  it('e idempotente', () => {
    const once = slugifyArticleTitle('Ficção Científica — o guia')
    expect(slugifyArticleTitle(once)).toBe(once)
  })

  it('trunca sem deixar hifen na borda', () => {
    const slug = slugifyArticleTitle('palavra '.repeat(40))
    expect(slug.length).toBeLessThanOrEqual(90)
    expect(slug.endsWith('-')).toBe(false)
  })
})

describe('resolveArticleSlugCollision', () => {
  it('sufixa deterministicamente', () => {
    expect(resolveArticleSlugCollision('nota', new Set())).toBe('nota')
    expect(resolveArticleSlugCollision('nota', new Set(['nota']))).toBe('nota-2')
    expect(resolveArticleSlugCollision('nota', new Set(['nota', 'nota-2']))).toBe('nota-3')
  })
})

describe('planArticleSlugChange', () => {
  it('artigo PUBLICADO nao troca de slug quando so o titulo muda', () => {
    // Trocar a URL de uma materia no ar quebra links e zera o historico.
    const plan = planArticleSlugChange({
      currentSlug: 'trailer-de-duna',
      title: 'Trailer de Duna e divulgado (atualizado)',
      isPublished: true,
    })
    expect(plan.changed).toBe(false)
    expect(plan.redirect).toBeNull()
  })

  it('rascunho acompanha o titulo, sem redirect (nunca foi publico)', () => {
    const plan = planArticleSlugChange({
      currentSlug: 'rascunho-antigo',
      title: 'Titulo novo',
      isPublished: false,
    })
    expect(plan.changed).toBe(true)
    expect(plan.nextSlug).toBe('titulo-novo')
    expect(plan.redirect).toBeNull()
  })

  it('troca DELIBERADA em artigo publicado gera 301', () => {
    const plan = planArticleSlugChange({
      currentSlug: 'slug-antigo',
      title: 'Qualquer',
      isPublished: true,
      requestedSlug: 'slug-novo',
    })
    expect(plan.changed).toBe(true)
    expect(plan.redirect).toEqual({
      fromPath: '/pt/noticias/slug-antigo/',
      toPath: '/pt/noticias/slug-novo/',
      statusCode: 301,
    })
  })

  it('nada mudou -> nenhum redirect (A -> A seria um loop na cadeia)', () => {
    const plan = planArticleSlugChange({
      currentSlug: 'mesmo',
      title: 'Mesmo',
      isPublished: true,
      requestedSlug: 'mesmo',
    })
    expect(plan.changed).toBe(false)
    expect(plan.redirect).toBeNull()
  })

  it('articlePath monta o caminho canonico com barra final', () => {
    expect(articlePath('nota')).toBe('/pt/noticias/nota/')
  })
})

describe('clampExcerpt — retencao minima de conteudo de terceiro', () => {
  it('trunca no teto', () => {
    const long = 'a'.repeat(MAX_EXCERPT_CHARS + 500)
    expect(clampExcerpt(long)?.length).toBe(MAX_EXCERPT_CHARS)
  })

  it('vazio -> null', () => {
    expect(clampExcerpt('   ')).toBeNull()
    expect(clampExcerpt(null)).toBeNull()
  })
})

/** Store em memoria que respeita a unicidade (fonte, id externo). */
function createFakeStore() {
  const rows = new Map<
    string,
    {
      id: string
      sourceId: string
      externalId: string
      normalizedUrl: string | null
      contentFingerprint: string | null
      publishedAtIso: string | null
    }
  >()
  let seq = 0
  const calls: { verdict: string; duplicateOfId: string | null }[] = []

  const store: SourceItemStorePort = {
    async findDedupCandidates() {
      return [...rows.values()]
    },
    async upsertSourceItem(input, verdict, duplicateOfId): Promise<IngestSourceItemResult> {
      calls.push({ verdict, duplicateOfId })
      const key = `${input.sourceId}::${input.externalId}`
      const existing = rows.get(key)
      if (existing === undefined) {
        seq += 1
        const id = String(seq)
        rows.set(key, {
          id,
          sourceId: input.sourceId,
          externalId: input.externalId,
          normalizedUrl: input.normalizedUrl,
          contentFingerprint: input.contentFingerprint,
          publishedAtIso: input.publishedAtIso,
        })
        return { itemId: id, outcome: 'created', verdict }
      }
      const changed = existing.contentFingerprint !== input.contentFingerprint
      existing.contentFingerprint = input.contentFingerprint
      existing.normalizedUrl = input.normalizedUrl
      return { itemId: existing.id, outcome: changed ? 'updated' : 'unchanged', verdict }
    },
  }
  return { store, rows, calls }
}

describe('ingestEditorialItem — idempotencia', () => {
  const item = {
    sourceId: 's1',
    externalId: 'ext-1',
    url: 'https://collider.com/nota?utm_source=rss',
    title: 'Trailer de Duna',
    excerpt: 'Warner divulgou a previa.',
    publishedAtIso: '2026-07-01T10:00:00.000Z',
  }

  it('reingerir o mesmo item nao cria duplicata', async () => {
    const { store, rows } = createFakeStore()
    const first = await ingestEditorialItem(item, store)
    const second = await ingestEditorialItem(item, store)

    expect(first.outcome).toBe('created')
    expect(second.outcome).toBe('unchanged')
    expect(second.itemId).toBe(first.itemId)
    expect(rows.size).toBe(1)
  })

  it('reingestao do MESMO item nao se marca duplicata de si mesmo', async () => {
    // Marcar o item como duplicata de si proprio violaria o CHECK
    // `source_items_not_self_duplicate` e perderia a linha canonica.
    const { store, calls } = createFakeStore()
    await ingestEditorialItem(item, store)
    await ingestEditorialItem(item, store)
    expect(calls.every((c) => c.duplicateOfId === null)).toBe(true)
    expect(calls.every((c) => c.verdict === 'unique')).toBe(true)
  })

  it('item ATUALIZADO na fonte atualiza, nao duplica', async () => {
    const { store, rows } = createFakeStore()
    await ingestEditorialItem(item, store)
    const updated = await ingestEditorialItem(
      { ...item, title: 'Trailer de Duna (atualizado)' },
      store,
    )
    expect(updated.outcome).toBe('updated')
    expect(rows.size).toBe(1)
  })

  it('URL com tracking diferente ainda e o mesmo item', async () => {
    const { store, rows } = createFakeStore()
    await ingestEditorialItem(item, store)
    await ingestEditorialItem({ ...item, url: 'https://collider.com/nota?utm_source=twitter' }, store)
    expect(rows.size).toBe(1)
  })

  it('recusa item sem identidade util', async () => {
    const { store } = createFakeStore()
    await expect(ingestEditorialItem({ ...item, externalId: '  ' }, store)).rejects.toThrow(
      /externalId/,
    )
    await expect(ingestEditorialItem({ ...item, title: '  ' }, store)).rejects.toThrow(/title/)
  })

  it('URL de esquema proibido vira null, mas o item continua rastreado', async () => {
    const { store, rows } = createFakeStore()
    const r = await ingestEditorialItem({ ...item, url: 'javascript:alert(1)' }, store)
    expect(r.outcome).toBe('created')
    expect([...rows.values()][0]?.normalizedUrl).toBeNull()
  })
})
