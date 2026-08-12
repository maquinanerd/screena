/**
 * Governanca de EXCLUSAO de artigo — os hooks, com `req` stub.
 *
 * O caso real: article 41 foi apagado no admin do Payload e a projecao publica
 * ficou orfa no ar — apagar nao emitia evento nenhum. Estes testes provam os
 * dois lados da correcao SEM subir o CMS inteiro:
 *
 *  1. `guardArticleDelete` RECUSA excluir materia no ar (published/needs_update),
 *     com erro acionavel — e o caminho de recusa loga (nada de silencio).
 *  2. `emitDeletionUnpublish` emite `article.unpublished` para artigo que JA
 *     foi publicado um dia, e NAO emite para artigo que nunca publicou.
 *
 * O harness HTTP completo (apps/cms/src/__tests__/harness.ts) continua sendo a
 * prova de fio para os hooks de mudanca; aqui o que esta sob teste e a decisao
 * e a emissao, e o stub cobre exatamente o contrato que os hooks usam:
 * findByID / find / create / logger.
 */

import { describe, expect, it } from 'vitest'

import { emitDeletionUnpublish, guardArticleDelete } from '../hooks/articles.js'

interface OutboxRow {
  readonly eventType: string
  readonly aggregateId: string
  readonly idempotencyKey: string
}

/**
 * Stub minimo do `req` que os hooks de delete consomem.
 *
 * `outbox` comeca com o historico desejado e recebe o que os hooks criarem.
 */
function stubReq(input: {
  readonly doc: Record<string, unknown>
  readonly outbox?: OutboxRow[]
  readonly authors?: readonly Record<string, unknown>[]
}) {
  const outbox: OutboxRow[] = [...(input.outbox ?? [])]
  const warnings: string[] = []
  const infos: string[] = []
  const req = {
    user: { id: 'admin-1', role: 'administrator', collection: 'editorial-users', active: true },
    payload: {
      findByID: async () => input.doc,
      find: async (args: { collection: string; where: Record<string, unknown> }) => {
        if (args.collection === 'publication-outbox') {
          const where = JSON.stringify(args.where)
          const docs = outbox.filter((row) => {
            if (where.includes('idempotencyKey')) {
              return where.includes(row.idempotencyKey)
            }
            // consulta "ja publicou alguma vez?": aggregateId + eventType
            return (
              where.includes(`"${row.aggregateId}"`) && where.includes('article.published')
              && row.eventType === 'article.published'
            )
          })
          return { totalDocs: docs.length, docs }
        }
        if (args.collection === 'authors') {
          return { totalDocs: input.authors?.length ?? 0, docs: input.authors ?? [] }
        }
        if (args.collection === 'media') {
          return { totalDocs: 0, docs: [] }
        }
        throw new Error(`stub sem collection ${args.collection}`)
      },
      create: async (args: { collection: string; data: Record<string, unknown> }) => {
        if (args.collection !== 'publication-outbox') {
          throw new Error(`stub: create inesperado em ${args.collection}`)
        }
        outbox.push({
          eventType: String(args.data.eventType),
          aggregateId: String(args.data.aggregateId),
          idempotencyKey: String(args.data.idempotencyKey),
        })
        return args.data
      },
      logger: {
        warn: (_meta: unknown, message: string) => warnings.push(message),
        info: (_meta: unknown, message: string) => infos.push(message),
      },
    },
  }
  return { req: req as never, outbox, warnings, infos }
}

function articleDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 41,
    workflowStatus: 'published',
    title: 'Materia de prova',
    slug: 'materia-de-prova',
    summary: 'Resumo.',
    language: 'pt-BR',
    contentType: 'news',
    body: [],
    authors: [],
    heroMedia: null,
    gallery: [],
    entityReferences: [],
    externalSources: [],
    publishedAt: '2026-08-11T10:00:00.000Z',
    aiAssisted: false,
    ...overrides,
  }
}

describe('guardArticleDelete — excluir NAO despublica', () => {
  it('RECUSA excluir materia published, com erro acionavel e log', async () => {
    const { req, warnings } = stubReq({ doc: articleDoc({ workflowStatus: 'published' }) })
    await expect(
      guardArticleDelete({ req, id: 41, collection: {} as never, context: {} as never }),
    ).rejects.toThrow(/excluir nao despublica/i)
    expect(warnings.some((w) => w.includes('RECUSADA'))).toBe(true)
  })

  it('RECUSA excluir materia needs_update (reedicao continua NO AR)', async () => {
    const { req } = stubReq({ doc: articleDoc({ workflowStatus: 'needs_update' }) })
    await expect(
      guardArticleDelete({ req, id: 41, collection: {} as never, context: {} as never }),
    ).rejects.toThrow(/retrate/i)
  })

  it('permite excluir rascunho nunca publicado', async () => {
    const { req } = stubReq({ doc: articleDoc({ workflowStatus: 'draft' }) })
    await expect(
      guardArticleDelete({ req, id: 41, collection: {} as never, context: {} as never }),
    ).resolves.toBeUndefined()
  })

  it('permite excluir materia ja retirada do ar (archived)', async () => {
    const { req } = stubReq({ doc: articleDoc({ workflowStatus: 'archived' }) })
    await expect(
      guardArticleDelete({ req, id: 41, collection: {} as never, context: {} as never }),
    ).resolves.toBeUndefined()
  })
})

describe('emitDeletionUnpublish — rede de seguranca da exclusao', () => {
  it('artigo que JA publicou: emite article.unpublished na outbox', async () => {
    const doc = articleDoc({ workflowStatus: 'archived' })
    const { req, outbox, warnings } = stubReq({
      doc,
      outbox: [
        {
          eventType: 'article.published',
          aggregateId: '41',
          idempotencyKey: 'idem-publicacao-antiga',
        },
      ],
    })
    await emitDeletionUnpublish({
      req,
      id: 41,
      doc: doc as never,
      collection: {} as never,
      context: {} as never,
    })
    const emitted = outbox.filter((row) => row.eventType === 'article.unpublished')
    expect(emitted).toHaveLength(1)
    expect(emitted[0]?.aggregateId).toBe('41')
    expect(warnings.some((w) => w.includes('rede de seguranca'))).toBe(true)
  })

  it('artigo que NUNCA publicou: nao emite nada (e loga o porque)', async () => {
    const doc = articleDoc({ workflowStatus: 'draft' })
    const { req, outbox, infos } = stubReq({ doc, outbox: [] })
    await emitDeletionUnpublish({
      req,
      id: 41,
      doc: doc as never,
      collection: {} as never,
      context: {} as never,
    })
    expect(outbox).toHaveLength(0)
    expect(infos.some((m) => m.includes('nenhum evento a emitir'))).toBe(true)
  })

  it('emissao repetida deduplica pela idempotencyKey (nao vira erro nem duplicata)', async () => {
    const doc = articleDoc({ workflowStatus: 'archived' })
    const { req, outbox } = stubReq({
      doc,
      outbox: [
        {
          eventType: 'article.published',
          aggregateId: '41',
          idempotencyKey: 'idem-publicacao-antiga',
        },
      ],
    })
    const hookArgs = {
      req,
      id: 41,
      doc: doc as never,
      collection: {} as never,
      context: {} as never,
    }
    await emitDeletionUnpublish(hookArgs)
    await emitDeletionUnpublish(hookArgs)
    expect(outbox.filter((row) => row.eventType === 'article.unpublished')).toHaveLength(1)
  })
})
