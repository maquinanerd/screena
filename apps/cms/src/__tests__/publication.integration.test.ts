/**
 * Integracao REAL: Payload + PostgreSQL 16 efemero.
 *
 * Prova o que os testes puros nao conseguiam — que a governanca esta LIGADA:
 * autenticacao real por API key, access control real, hooks reais na collection
 * e outbox gravada na mesma transacao da publicacao.
 */

import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'

import { validEditorialDraft } from '@screena/editorial-contracts'

import { apiKeyHeaders, startCmsHarness, type CmsHarness } from './harness.js'
import { editorialDraftsEndpoint } from '../endpoints/editorial-drafts.js'

let harness: CmsHarness
let payload: Payload

const ids = {
  admin: '',
  chief: '',
  editor: '',
  reviewer: '',
  writer: '',
  service: '',
  serviceInactive: '',
  author: '',
  authorInactive: '',
  mediaApproved: '',
  mediaProhibited: '',
  mediaExpired: '',
}
let serviceApiKey = ''
let inactiveApiKey = ''

/** Executa o endpoint com um `req` autenticado de verdade pelo Payload. */
async function callDraftEndpoint(
  body: unknown,
  headers: Headers,
): Promise<{ status: number; json: Record<string, unknown> }> {
  // `payload.auth` faz a verificacao REAL da credencial (inclusive API key).
  const { user } = await payload.auth({ headers })
  const raw = JSON.stringify(body)
  const req = {
    payload,
    user,
    headers,
    text: async () => raw,
  } as unknown as Parameters<typeof editorialDraftsEndpoint.handler>[0]

  const response = (await editorialDraftsEndpoint.handler(req)) as Response
  return { status: response.status, json: (await response.json()) as Record<string, unknown> }
}

async function outboxRows(articleId?: string) {
  const found = await payload.find({
    collection: 'publication-outbox',
    where: articleId === undefined ? {} : { aggregateId: { equals: articleId } },
    limit: 100,
    overrideAccess: true,
  })
  return found.docs
}

/** Cria um artigo pronto para publicar, ja em `ready_to_publish`. */
async function seedPublishableArticle(suffix: string, overrides: Record<string, unknown> = {}) {
  const created = await payload.create({
    collection: 'articles',
    data: {
      title: `Materia ${suffix}`,
      slug: `materia-${suffix}`,
      summary: 'Resumo editorial proprio da Cinerie para efeito de teste.',
      language: 'pt-BR',
      contentType: 'news',
      workflowStatus: 'draft',
      body: [{ blockType: 'paragraph', blockId: 'b1', text: 'Corpo editorial proprio.' }],
      authors: [ids.author],
      qaPassedAt: new Date().toISOString(),
      externalSources: [
        { sourceId: 's1', name: 'Variety', url: 'https://variety.com/x', role: 'primary' },
      ],
      ...overrides,
    } as never,
    overrideAccess: true,
  })

  const id = String(created.id)
  for (const status of ['needs_review', 'in_review', 'human_reviewed', 'ready_to_publish']) {
    await payload.update({
      collection: 'articles',
      id,
      data: { workflowStatus: status } as never,
      overrideAccess: false,
      user: { ...(await payload.findByID({ collection: 'editorial-users', id: ids.chief, overrideAccess: true })), collection: 'editorial-users' } as never,
    })
  }
  return id
}

async function userDoc(id: string) {
  const doc = await payload.findByID({ collection: 'editorial-users', id, overrideAccess: true })
  return { ...doc, collection: 'editorial-users' } as never
}

beforeAll(async () => {
  harness = await startCmsHarness()
  payload = harness.payload

  const makeUser = async (role: string, key: keyof typeof ids) => {
    const created = await payload.create({
      collection: 'editorial-users',
      data: {
        email: `${role}@cinerie.test`,
        password: `senha-de-teste-${role}-0123456789`,
        displayName: role,
        role,
        active: true,
      } as never,
      overrideAccess: true,
    })
    ids[key] = String(created.id)
  }

  await makeUser('administrator', 'admin')
  await makeUser('editor_in_chief', 'chief')
  await makeUser('editor', 'editor')
  await makeUser('reviewer', 'reviewer')
  await makeUser('writer', 'writer')

  // O Payload NAO gera a API key sozinho no servidor — no painel isso e um
  // botao. Pela Local API a chave e fornecida e o Payload deriva o
  // `apiKeyIndex` cifrado a partir dela. O teste cria a sua, em banco
  // descartavel, e a destroi junto com o Postgres.
  const makeServiceAccount = async (label: string, active: boolean) => {
    const key = randomUUID()
    const created = await payload.create({
      collection: 'service-accounts',
      data: { label, purpose: 'mnscr', active, enableAPIKey: true, apiKey: key } as never,
      overrideAccess: true,
    })
    return { id: String(created.id), key }
  }

  const service = await makeServiceAccount('mnscr-test', true)
  ids.service = service.id
  serviceApiKey = service.key

  const inactive = await makeServiceAccount('mnscr-off', false)
  ids.serviceInactive = inactive.id
  inactiveApiKey = inactive.key

  const author = await payload.create({
    collection: 'authors',
    data: { name: 'Redacao Cinerie', slug: 'redacao-cinerie', active: true, isOrganization: true } as never,
    overrideAccess: true,
  })
  ids.author = String(author.id)

  const inactiveAuthor = await payload.create({
    collection: 'authors',
    data: { name: 'Autor Inativo', slug: 'autor-inativo', active: false } as never,
    overrideAccess: true,
  })
  ids.authorInactive = String(inactiveAuthor.id)

  // `media` e upload collection: exige arquivo de verdade. Um PNG 1x1 real
  // (nao um placeholder de bytes) para o `sharp` conseguir processar.
  const onePixelPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )

  const makeMedia = async (alt: string, licenseStatus: string, allowed: boolean) => {
    const created = await payload.create({
      collection: 'media',
      data: {
        alt,
        licenseStatus,
        allowedForEditorial: allowed,
        allowedForHero: allowed,
        requiresAttribution: false,
        provenanceType: 'cinerie_catalog',
      } as never,
      overrideAccess: true,
      file: {
        data: onePixelPng,
        mimetype: 'image/png',
        name: `${alt.replace(/\s+/g, '-')}-${String(Date.now())}.png`,
        size: onePixelPng.byteLength,
      },
    })
    return String(created.id)
  }
  ids.mediaApproved = await makeMedia('aprovada', 'approved', true)
  ids.mediaProhibited = await makeMedia('proibida', 'prohibited', false)
  ids.mediaExpired = await makeMedia('expirada', 'expired', true)
}, 300_000)

afterAll(async () => {
  await harness?.stop()
}, 120_000)

/* ------------------------------------------------------------------ */
/* 1. Autenticacao real por API key                                    */
/* ------------------------------------------------------------------ */

describe('endpoint do MNScr com autenticacao REAL', () => {
  it('sem Authorization -> 401', async () => {
    const result = await callDraftEndpoint(validEditorialDraft, new Headers())
    expect(result.status).toBe(401)
  })

  it('API key invalida -> 401', async () => {
    const result = await callDraftEndpoint(
      validEditorialDraft,
      apiKeyHeaders('service-accounts', 'chave-que-nao-existe'),
    )
    expect(result.status).toBe(401)
  })

  it('service account INATIVA -> 403 (desativar revoga de fato)', async () => {
    const result = await callDraftEndpoint(
      validEditorialDraft,
      apiKeyHeaders('service-accounts', inactiveApiKey),
    )
    expect(result.status).toBe(403)
  })

  it('service account valida cria automation_draft', async () => {
    const result = await callDraftEndpoint(
      validEditorialDraft,
      apiKeyHeaders('service-accounts', serviceApiKey),
    )
    expect(result.status).toBe(201)
    expect(result.json.outcome).toBe('create')
    expect(result.json.workflowStatus).toBe('automation_draft')

    const article = await payload.findByID({
      collection: 'articles',
      id: String(result.json.articleId),
      overrideAccess: true,
    })
    expect(article.workflowStatus).toBe('automation_draft')
    expect(article._status).toBe('draft')
  })

  it('reenvio identico e idempotente e nao duplica', async () => {
    const before = await payload.count({ collection: 'articles', overrideAccess: true })
    const result = await callDraftEndpoint(
      validEditorialDraft,
      apiKeyHeaders('service-accounts', serviceApiKey),
    )
    expect(result.status).toBe(200)
    expect(result.json.outcome).toBe('duplicate_noop')
    const after = await payload.count({ collection: 'articles', overrideAccess: true })
    expect(after.totalDocs).toBe(before.totalDocs)
  })

  it('mesma chave com corpo diferente -> 409', async () => {
    const mutated = JSON.parse(JSON.stringify(validEditorialDraft)) as Record<string, unknown>
    mutated.title = 'Outro titulo completamente diferente'
    const result = await callDraftEndpoint(
      mutated,
      apiKeyHeaders('service-accounts', serviceApiKey),
    )
    expect(result.status).toBe(409)
  })

  it('tentativa de publicar embutida no draft e rejeitada', async () => {
    const mutated = JSON.parse(JSON.stringify(validEditorialDraft)) as Record<string, unknown>
    mutated.idempotencyKey = 'cluster-x:rev-1'
    mutated.sourceClusterId = 'cluster-x'
    mutated.autoPublish = true
    const result = await callDraftEndpoint(
      mutated,
      apiKeyHeaders('service-accounts', serviceApiKey),
    )
    expect(result.status).toBe(422)
  })

  it('a resposta nunca devolve conteudo do artigo nem credencial', async () => {
    const result = await callDraftEndpoint(
      validEditorialDraft,
      apiKeyHeaders('service-accounts', serviceApiKey),
    )
    const serialized = JSON.stringify(result.json)
    expect(serialized).not.toContain(serviceApiKey)
    expect(serialized).not.toContain('Warner')
    expect(Object.keys(result.json).sort()).toEqual(
      ['articleId', 'draftPayloadHash', 'outcome'].sort(),
    )
  })
})

/* ------------------------------------------------------------------ */
/* 2. Access control real                                              */
/* ------------------------------------------------------------------ */

describe('access control real (Local API com overrideAccess: false)', () => {
  it('anonimo nao le artigos nem a outbox', async () => {
    await expect(
      payload.find({ collection: 'articles', overrideAccess: false, user: null }),
    ).rejects.toThrow()
    await expect(
      payload.find({ collection: 'publication-outbox', overrideAccess: false, user: null }),
    ).rejects.toThrow()
  })

  it('ninguem cria evento na outbox pela API (nem administrador)', async () => {
    await expect(
      payload.create({
        collection: 'publication-outbox',
        data: {
          eventId: 'manual',
          idempotencyKey: 'manual',
          eventType: 'article.published',
          aggregateType: 'article',
          aggregateId: 'x',
          aggregateVersion: 'v',
          payload: {},
          status: 'pending',
          attempts: 0,
          availableAt: new Date().toISOString(),
        } as never,
        overrideAccess: false,
        user: await userDoc(ids.admin),
      }),
    ).rejects.toThrow()
  })
})

/* ------------------------------------------------------------------ */
/* 3. Workflow real via hooks                                          */
/* ------------------------------------------------------------------ */

describe('workflow real', () => {
  it('service account nao consegue publicar mesmo escrevendo direto', async () => {
    const id = await seedPublishableArticle('svc')
    const serviceUser = {
      ...(await payload.findByID({
        collection: 'service-accounts',
        id: ids.service,
        overrideAccess: true,
      })),
      collection: 'service-accounts',
    } as never
    await expect(
      payload.update({
        collection: 'articles',
        id,
        data: { workflowStatus: 'published', _status: 'published' } as never,
        overrideAccess: false,
        user: serviceUser,
      }),
    ).rejects.toThrow()
  })

  it('writer, reviewer e editor NAO publicam', async () => {
    for (const key of ['writer', 'reviewer', 'editor'] as const) {
      const id = await seedPublishableArticle(`nopub-${key}`)
      await expect(
        payload.update({
          collection: 'articles',
          id,
          data: { workflowStatus: 'published' } as never,
          overrideAccess: false,
          user: await userDoc(ids[key]),
        }),
      ).rejects.toThrow()
    }
  })

  it('_status published sozinho NAO publica (a armadilha do Payload)', async () => {
    const id = await seedPublishableArticle('status-solto')
    await expect(
      payload.update({
        collection: 'articles',
        id,
        data: { _status: 'published' } as never,
        overrideAccess: false,
        user: await userDoc(ids.chief),
      }),
    ).rejects.toThrow()
  })

  it('editor_in_chief publica e o _status acompanha', async () => {
    const id = await seedPublishableArticle('publica-ok')
    const published = await payload.update({
      collection: 'articles',
      id,
      data: { workflowStatus: 'published' } as never,
      overrideAccess: false,
      user: await userDoc(ids.chief),
    })
    expect(published.workflowStatus).toBe('published')
    expect(published._status).toBe('published')
    expect(published.publishedAt).toBeTruthy()
  })

  it('publicacao sem autor ativo falha', async () => {
    const semAutor = await seedPublishableArticle('sem-autor', { authors: [] })
    await expect(
      payload.update({
        collection: 'articles',
        id: semAutor,
        data: { workflowStatus: 'published' } as never,
        overrideAccess: false,
        user: await userDoc(ids.chief),
      }),
    ).rejects.toThrow()

    const inativo = await seedPublishableArticle('autor-inativo', {
      authors: [ids.authorInactive],
    })
    await expect(
      payload.update({
        collection: 'articles',
        id: inativo,
        data: { workflowStatus: 'published' } as never,
        overrideAccess: false,
        user: await userDoc(ids.chief),
      }),
    ).rejects.toThrow()
  })

  it('publicacao sem QA e com erro bloqueante falha', async () => {
    const semQa = await seedPublishableArticle('sem-qa', { qaPassedAt: null })
    await expect(
      payload.update({
        collection: 'articles',
        id: semQa,
        data: { workflowStatus: 'published' } as never,
        overrideAccess: false,
        user: await userDoc(ids.chief),
      }),
    ).rejects.toThrow()

    const comErro = await seedPublishableArticle('com-erro', {
      blockingErrors: ['fato sem fonte'],
    })
    await expect(
      payload.update({
        collection: 'articles',
        id: comErro,
        data: { workflowStatus: 'published' } as never,
        overrideAccess: false,
        user: await userDoc(ids.chief),
      }),
    ).rejects.toThrow()
  })

  it('midia prohibited e expired bloqueiam; approved libera', async () => {
    for (const media of [ids.mediaProhibited, ids.mediaExpired]) {
      const id = await seedPublishableArticle(`midia-${media}`, { heroMedia: media })
      await expect(
        payload.update({
          collection: 'articles',
          id,
          data: { workflowStatus: 'published' } as never,
          overrideAccess: false,
          user: await userDoc(ids.chief),
        }),
      ).rejects.toThrow()
    }

    const ok = await seedPublishableArticle('midia-ok', { heroMedia: ids.mediaApproved })
    const published = await payload.update({
      collection: 'articles',
      id: ok,
      data: { workflowStatus: 'published' } as never,
      overrideAccess: false,
      user: await userDoc(ids.chief),
    })
    expect(published.workflowStatus).toBe('published')
  })
})

/* ------------------------------------------------------------------ */
/* 4. Outbox: eventos reais                                            */
/* ------------------------------------------------------------------ */

describe('publication outbox', () => {
  it('primeira publicacao cria EXATAMENTE um evento', async () => {
    const id = await seedPublishableArticle('evt-1')
    expect(await outboxRows(id)).toHaveLength(0)

    await payload.update({
      collection: 'articles',
      id,
      data: { workflowStatus: 'published' } as never,
      overrideAccess: false,
      user: await userDoc(ids.chief),
    })

    const rows = await outboxRows(id)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.eventType).toBe('article.published')
    expect(rows[0]?.status).toBe('pending')
  })

  it('movimento interno da redacao NAO cria evento', async () => {
    const id = await seedPublishableArticle('sem-evento')
    await payload.update({
      collection: 'articles',
      id,
      data: { assignedTo: ids.editor } as never,
      overrideAccess: false,
      user: await userDoc(ids.chief),
    })
    expect(await outboxRows(id)).toHaveLength(0)
  })

  it('despublicacao e retratacao criam um evento cada', async () => {
    const id = await seedPublishableArticle('evt-ciclo')
    await payload.update({
      collection: 'articles',
      id,
      data: { workflowStatus: 'published' } as never,
      overrideAccess: false,
      user: await userDoc(ids.chief),
    })
    await payload.update({
      collection: 'articles',
      id,
      data: { workflowStatus: 'retracted', retractionReason: 'Fato nao confirmado.' } as never,
      overrideAccess: false,
      user: await userDoc(ids.chief),
    })

    const rows = await outboxRows(id)
    expect(rows.map((row) => row.eventType).sort()).toEqual(
      ['article.published', 'article.retracted'].sort(),
    )
  })

  it('republicar o MESMO conteudo nao duplica evento (UNIQUE no banco)', async () => {
    const id = await seedPublishableArticle('evt-dup')
    const publish = async () =>
      payload.update({
        collection: 'articles',
        id,
        data: { workflowStatus: 'published' } as never,
        overrideAccess: false,
        user: await userDoc(ids.chief),
      })

    await publish()
    // Sai e volta para `published` sem alterar o conteudo publico: a chave de
    // idempotencia deriva do CONTEUDO, entao o segundo evento colide na UNIQUE.
    await payload.update({
      collection: 'articles',
      id,
      data: { workflowStatus: 'needs_update' } as never,
      overrideAccess: false,
      user: await userDoc(ids.chief),
    })
    await payload.update({
      collection: 'articles',
      id,
      data: { workflowStatus: 'ready_to_publish' } as never,
      overrideAccess: false,
      user: await userDoc(ids.chief),
    })
    await publish()

    const rows = await outboxRows(id)
    const published = rows.filter((row) => row.eventType === 'article.published')
    expect(published).toHaveLength(1)
  })

  it('o evento gravado valida contra publication-event-v1', async () => {
    const id = await seedPublishableArticle('evt-valido')
    await payload.update({
      collection: 'articles',
      id,
      data: { workflowStatus: 'published' } as never,
      overrideAccess: false,
      user: await userDoc(ids.chief),
    })
    const { parsePublicationEventV1 } = await import('@screena/editorial-contracts')
    const rows = await outboxRows(id)
    const parsed = parsePublicationEventV1(rows[0]?.payload)
    expect(parsed.ok, parsed.ok ? '' : JSON.stringify(parsed.issues)).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* 5. Atomicidade                                                      */
/* ------------------------------------------------------------------ */

describe('atomicidade: artigo e outbox vivem ou morrem juntos', () => {
  it('evento invalido derruba a publicacao inteira', async () => {
    // Artigo sem `slug`: o contrato de evento exige slug kebab-case, entao o
    // `buildOutboxRecord` recusa e o `afterChange` lanca. Se a transacao nao
    // fosse compartilhada, o artigo ficaria publicado SEM evento — que e
    // exatamente o estado que nao pode existir.
    const id = await seedPublishableArticle('atomico')
    await payload.update({
      collection: 'articles',
      id,
      data: { slug: 'Slug Invalido Com Espacos' } as never,
      overrideAccess: true,
    })

    await expect(
      payload.update({
        collection: 'articles',
        id,
        data: { workflowStatus: 'published' } as never,
        overrideAccess: false,
        user: await userDoc(ids.chief),
      }),
    ).rejects.toThrow()

    const after = await payload.findByID({ collection: 'articles', id, overrideAccess: true })
    expect(after.workflowStatus, 'artigo nao pode ficar publicado sem evento').not.toBe('published')
    expect(after._status).not.toBe('published')
    expect(await outboxRows(id)).toHaveLength(0)
  })
})
