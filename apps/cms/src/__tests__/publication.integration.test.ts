/**
 * Integracao REAL do CMS: Next + Payload + PostgreSQL 16 efemero.
 *
 * As asercoes de autenticacao e de entrada de draft vao por HTTP de verdade
 * (`fetch` contra o servidor iniciado pelo harness). A Local API aparece so para
 * montar fixtures e para inspecionar o banco — nunca para simular requisicao.
 *
 * Ordem deliberada: a autenticacao isolada (`/api/service-accounts/me`) vem
 * primeiro. Enquanto ela nao estiver verde, qualquer falha adiante seria eco.
 */

import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'

import { parsePublicationEventV1, validEditorialDraft } from '@screena/editorial-contracts'

import { apiKeyAuthorization, startCmsHarness, type CmsHarness } from './harness.js'
import {
  INSTITUTIONAL_AUTHOR_SLUG,
  seedInstitutionalAuthor,
} from '../../scripts/seed-dev.js'

let harness: CmsHarness
let payload: Payload
let baseUrl = ''

// Ids como NUMERO: a PK no Postgres e inteira e o Payload valida o tipo do id
// em `relationship`. Guardar `String(id)` fazia `authors: ["1"]` ser recusado
// com "The following field is invalid: Authors".
const ids = {
  admin: 0,
  chief: 0,
  editor: 0,
  reviewer: 0,
  writer: 0,
  author: 0,
  authorInactive: 0,
  mediaApproved: 0,
  mediaProhibited: 0,
  mediaExpired: 0,
}

let activeKey = ''
let inactiveKey = ''
let scopelessKey = ''
let humanToken = ''

/* ------------------------------------------------------------------ */
/* Helpers de HTTP                                                     */
/* ------------------------------------------------------------------ */

async function httpGet(path: string, authorization?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: authorization === undefined ? {} : { Authorization: authorization },
  })
  const text = await response.text()
  let json: Record<string, unknown> = {}
  try {
    json = JSON.parse(text) as Record<string, unknown>
  } catch {
    json = { raw: text }
  }
  return { status: response.status, json, text }
}

async function postDraft(body: unknown, authorization?: string) {
  const response = await fetch(`${baseUrl}/api/internal/editorial-drafts`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authorization === undefined ? {} : { Authorization: authorization }),
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let json: Record<string, unknown> = {}
  try {
    json = JSON.parse(text) as Record<string, unknown>
  } catch {
    json = { raw: text }
  }
  return { status: response.status, json, text }
}

function draftWith(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(JSON.parse(JSON.stringify(validEditorialDraft)) as Record<string, unknown>),
    ...overrides,
  }
}

/* ------------------------------------------------------------------ */
/* Helpers de banco (Local API — fixtures e inspecao)                  */
/* ------------------------------------------------------------------ */

async function userDoc(id: number) {
  const doc = await payload.findByID({ collection: 'editorial-users', id, overrideAccess: true })
  return { ...doc, collection: 'editorial-users' } as never
}

async function outboxRows(articleId: string) {
  const found = await payload.find({
    collection: 'publication-outbox',
    where: { aggregateId: { equals: articleId } },
    limit: 100,
    overrideAccess: true,
  })
  return found.docs
}

async function articleById(id: string) {
  return payload.findByID({ collection: 'articles', id, overrideAccess: true })
}

/** Artigo pronto para publicar, ja em `ready_to_publish`. */
async function seedPublishableArticle(suffix: string, overrides: Record<string, unknown> = {}) {
  const created = await payload.create({
    collection: 'articles',
    data: {
      title: `Materia ${suffix}`,
      slug: `materia-${suffix.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
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
    // `overrideAccess: true` dispensa o ACCESS CONTROL, mas nao dispensa ATOR: o
    // hook de governanca exige saber quem esta escrevendo, e um artigo sem autor
    // da mudanca nao deveria existir. Por isso a fixture se identifica.
    overrideAccess: true,
    user: await userDoc(ids.chief),
  })

  const id = String(created.id)
  const chief = await userDoc(ids.chief)
  for (const status of ['needs_review', 'in_review', 'human_reviewed', 'ready_to_publish']) {
    await payload.update({
      collection: 'articles',
      id,
      data: { workflowStatus: status } as never,
      overrideAccess: false,
      user: chief,
    })
  }
  return id
}

async function publishAs(id: string, userId: number) {
  return payload.update({
    collection: 'articles',
    id,
    data: { workflowStatus: 'published' } as never,
    overrideAccess: false,
    user: await userDoc(userId),
  })
}

/* ------------------------------------------------------------------ */
/* Setup                                                              */
/* ------------------------------------------------------------------ */

beforeAll(async () => {
  harness = await startCmsHarness()
  payload = harness.payload
  baseUrl = harness.baseUrl

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
    ids[key] = Number(created.id)
  }

  await makeUser('administrator', 'admin')
  await makeUser('editor_in_chief', 'chief')
  await makeUser('editor', 'editor')
  await makeUser('reviewer', 'reviewer')
  await makeUser('writer', 'writer')

  // O Payload NAO gera a API key sozinho no servidor (no painel isso e um
  // botao). Pela Local API a chave e fornecida, e o hook `beforeValidate` do
  // campo `apiKeyIndex` deriva HMAC-SHA256(secret, apiKey) — exatamente o que a
  // estrategia procura na autenticacao.
  const makeServiceAccount = async (label: string, active: boolean, scopes = ['draft_ingest']) => {
    const key = randomUUID()
    await payload.create({
      collection: 'service-accounts',
      data: {
        label,
        purpose: 'mnscr',
        active,
        // ESCOPO EXPLICITO. O MNScr ingere rascunho; nao consome a outbox de
        // publicacao. Sem escopo, a conta autentica e nao pode nada.
        scopes,
        enableAPIKey: true,
        apiKey: key,
      } as never,
      overrideAccess: true,
    })
    return key
  }

  activeKey = await makeServiceAccount('mnscr-test', true)
  inactiveKey = await makeServiceAccount('mnscr-off', false)
  scopelessKey = await makeServiceAccount('mnscr-sem-escopo', true, [])

  // Token humano REAL, obtido por login HTTP: e assim que um humano chegaria ao
  // endpoint, e e essa identidade que precisa ser recusada por ele.
  const login = await fetch(`${baseUrl}/api/editorial-users/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'editor_in_chief@cinerie.test',
      password: 'senha-de-teste-editor_in_chief-0123456789',
    }),
  })
  // Parse DEFENSIVO com diagnostico. Um `.json()` cego sobre uma pagina de erro
  // do Next estoura com "Unexpected token '<'" no `beforeAll`, a suite inteira
  // e marcada como falha de colecao e o motivo real fica invisivel.
  const loginText = await login.text()
  let loginBody: { token?: string } = {}
  try {
    loginBody = JSON.parse(loginText) as { token?: string }
  } catch {
    throw new Error(
      `login do humano nao devolveu JSON (status ${String(login.status)}): ${loginText.slice(0, 200)}
[servidor]
${harness.serverLog().slice(-3000)}`,
    )
  }
  humanToken = String(loginBody.token ?? '')

  const author = await payload.create({
    collection: 'authors',
    data: {
      name: 'Redacao Cinerie',
      slug: 'redacao-cinerie',
      active: true,
      isOrganization: true,
    } as never,
    overrideAccess: true,
  })
  ids.author = Number(author.id)

  const inactiveAuthor = await payload.create({
    collection: 'authors',
    data: { name: 'Autor Inativo', slug: 'autor-inativo', active: false } as never,
    overrideAccess: true,
  })
  ids.authorInactive = Number(inactiveAuthor.id)

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
        name: `${alt}-${randomUUID()}.png`,
        size: onePixelPng.byteLength,
      },
    })
    return Number(created.id)
  }
  ids.mediaApproved = await makeMedia('aprovada', 'approved', true)
  ids.mediaProhibited = await makeMedia('proibida', 'prohibited', false)
  ids.mediaExpired = await makeMedia('expirada', 'expired', true)
}, 900_000)

afterAll(async () => {
  await harness?.stop()
}, 180_000)

/* ------------------------------------------------------------------ */
/* 1. AUTENTICACAO ISOLADA — /api/service-accounts/me por HTTP real    */
/* ------------------------------------------------------------------ */

describe('autenticacao isolada por API key (HTTP real)', () => {
  it('sem header nao autentica', async () => {
    const result = await httpGet('/api/service-accounts/me')
    expect(result.json.user ?? null).toBeNull()
  })

  it('header malformado nao autentica', async () => {
    const result = await httpGet('/api/service-accounts/me', `Bearer ${activeKey}`)
    expect(result.json.user ?? null).toBeNull()
  })

  it('slug de collection incorreto nao autentica', async () => {
    const result = await httpGet(
      '/api/service-accounts/me',
      apiKeyAuthorization('editorial-users', activeKey),
    )
    expect(result.json.user ?? null).toBeNull()
  })

  it('chave incorreta nao autentica', async () => {
    const result = await httpGet(
      '/api/service-accounts/me',
      apiKeyAuthorization('service-accounts', randomUUID()),
    )
    expect(result.json.user ?? null).toBeNull()
  })

  it('chave valida retorna a service account correta', async () => {
    const result = await httpGet(
      '/api/service-accounts/me',
      apiKeyAuthorization('service-accounts', activeKey),
    )
    const user = result.json.user as Record<string, unknown> | null
    expect(user, JSON.stringify(result.json)).not.toBeNull()
    expect(user?.label).toBe('mnscr-test')
    expect(user?.active).toBe(true)
  })

  it('conta INATIVA e identidade reconhecida, mas bloqueada no uso operacional', async () => {
    const me = await httpGet(
      '/api/service-accounts/me',
      apiKeyAuthorization('service-accounts', inactiveKey),
    )
    // A chave continua sendo uma credencial valida — o Payload autentica. Mas a
    // conta inativa nao e um ator (`toActor` a rebaixa a anonimo), entao ela nem
    // enxerga o proprio documento.
    expect(me.text).not.toContain(inactiveKey)

    // O bloqueio acontece no ENDPOINT, nao na identidade.
    const draft = await postDraft(
      validEditorialDraft,
      apiKeyAuthorization('service-accounts', inactiveKey),
    )
    expect(draft.status).toBe(403)
  })

  it('a resposta nao devolve API key, indice nem segredo', async () => {
    const result = await httpGet(
      '/api/service-accounts/me',
      apiKeyAuthorization('service-accounts', activeKey),
    )
    expect(result.text).not.toContain(activeKey)
    expect(result.text.toLowerCase()).not.toContain('apikeyindex')
    expect(result.text).not.toContain(process.env.PAYLOAD_SECRET ?? '__sem_segredo__')
  })
})

/* ------------------------------------------------------------------ */
/* 2. ENDPOINT REAL — POST /api/internal/editorial-drafts              */
/* ------------------------------------------------------------------ */

describe('endpoint editorial-drafts (HTTP real)', () => {
  it('sem Authorization -> 401', async () => {
    expect((await postDraft(validEditorialDraft)).status).toBe(401)
  })

  it('chave invalida -> 401', async () => {
    const result = await postDraft(
      validEditorialDraft,
      apiKeyAuthorization('service-accounts', randomUUID()),
    )
    expect(result.status).toBe(401)
  })

  it('conta tecnica SEM ESCOPO -> 403 (autenticar nao e poder)', async () => {
    // A conta e valida e esta ativa; ela so nao recebeu `draft_ingest`. Sem
    // este teste, "ser service account" voltaria a valer como permissao.
    const result = await postDraft(
      validEditorialDraft,
      apiKeyAuthorization('service-accounts', scopelessKey),
    )
    expect(result.status).toBe(403)
  })

  it('usuario HUMANO autenticado -> 403 (este canal e do pipeline)', async () => {
    expect(humanToken).not.toBe('')
    const result = await postDraft(validEditorialDraft, `JWT ${humanToken}`)
    expect(result.status).toBe(403)
  })

  it('service account valida cria o artigo como automation_draft', async () => {
    const result = await postDraft(
      validEditorialDraft,
      apiKeyAuthorization('service-accounts', activeKey),
    )
    expect(result.status, JSON.stringify(result.json)).toBe(201)
    expect(result.json.outcome).toBe('create')
    expect(result.json.workflowStatus).toBe('automation_draft')

    const article = await articleById(String(result.json.articleId))
    expect(article.workflowStatus).toBe('automation_draft')
    expect(article._status).toBe('draft')
    for (const ref of (article.entityReferences ?? []) as { verified?: boolean }[]) {
      expect(ref.verified).toBe(false)
    }
  })

  it('reenvio identico e idempotente e nao duplica', async () => {
    const before = await payload.count({ collection: 'articles', overrideAccess: true })
    const result = await postDraft(
      validEditorialDraft,
      apiKeyAuthorization('service-accounts', activeKey),
    )
    expect(result.status).toBe(200)
    expect(result.json.outcome).toBe('duplicate_noop')
    const after = await payload.count({ collection: 'articles', overrideAccess: true })
    expect(after.totalDocs).toBe(before.totalDocs)
  })

  it('mesma chave com corpo diferente -> 409', async () => {
    const result = await postDraft(
      draftWith({ title: 'Titulo completamente diferente do original' }),
      apiKeyAuthorization('service-accounts', activeKey),
    )
    expect(result.status).toBe(409)
  })

  it('tentativa de publicacao embutida no draft -> 422', async () => {
    const result = await postDraft(
      draftWith({
        idempotencyKey: 'cluster-y:rev-1',
        sourceClusterId: 'cluster-y',
        autoPublish: true,
      }),
      apiKeyAuthorization('service-accounts', activeKey),
    )
    expect(result.status).toBe(422)
  })

  it('a resposta nao vaza conteudo do artigo nem credencial', async () => {
    const result = await postDraft(
      validEditorialDraft,
      apiKeyAuthorization('service-accounts', activeKey),
    )
    expect(result.text).not.toContain(activeKey)
    expect(result.text).not.toContain('Warner')
    expect(Object.keys(result.json).sort()).toEqual(
      ['articleId', 'draftPayloadHash', 'outcome'].sort(),
    )
  })

  it('artigo com autoria humana NAO e sobrescrito pela automacao', async () => {
    const created = await postDraft(
      draftWith({ idempotencyKey: 'cluster-humano:rev-1', sourceClusterId: 'cluster-humano' }),
      apiKeyAuthorization('service-accounts', activeKey),
    )
    expect(created.status).toBe(201)
    const articleId = String(created.json.articleId)

    // Um humano assume o texto.
    await payload.update({
      collection: 'articles',
      id: articleId,
      data: { workflowStatus: 'needs_review' } as never,
      overrideAccess: false,
      user: await userDoc(ids.editor),
    })

    const retry = await postDraft(
      draftWith({
        idempotencyKey: 'cluster-humano:rev-2',
        sourceClusterId: 'cluster-humano',
        sourceRevision: 9,
        proposedAction: 'update',
        targetArticleId: articleId,
        title: 'Automacao tentando reescrever texto humano',
      }),
      apiKeyAuthorization('service-accounts', activeKey),
    )
    expect(retry.status).toBe(409)

    const after = await articleById(articleId)
    expect(after.title).not.toBe('Automacao tentando reescrever texto humano')
    expect(after.workflowStatus).toBe('needs_review')
  })
})

/* ------------------------------------------------------------------ */
/* 3. WORKFLOW REAL (hooks da collection)                              */
/* ------------------------------------------------------------------ */

describe('workflow real', () => {
  it('writer, reviewer e editor NAO publicam', async () => {
    for (const key of ['writer', 'reviewer', 'editor'] as const) {
      const id = await seedPublishableArticle(`nopub-${key}`)
      await expect(publishAs(id, ids[key])).rejects.toThrow()
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
    const published = await publishAs(id, ids.chief)
    expect(published.workflowStatus).toBe('published')
    expect(published._status).toBe('published')
    expect(published.publishedAt).toBeTruthy()
  })

  it('administrator tambem publica', async () => {
    const id = await seedPublishableArticle('publica-admin')
    expect((await publishAs(id, ids.admin)).workflowStatus).toBe('published')
  })

  it('publicacao sem autor ativo falha', async () => {
    const semAutor = await seedPublishableArticle('sem-autor', { authors: [] })
    await expect(publishAs(semAutor, ids.chief)).rejects.toThrow()

    const inativo = await seedPublishableArticle('autor-inativo', {
      authors: [ids.authorInactive],
    })
    await expect(publishAs(inativo, ids.chief)).rejects.toThrow()
  })

  it('publicacao sem QA e com erro bloqueante falha', async () => {
    const semQa = await seedPublishableArticle('sem-qa', { qaPassedAt: null })
    await expect(publishAs(semQa, ids.chief)).rejects.toThrow()

    const comErro = await seedPublishableArticle('com-erro', { blockingErrors: ['sem fonte'] })
    await expect(publishAs(comErro, ids.chief)).rejects.toThrow()
  })

  it('midia prohibited e expired bloqueiam; approved libera', async () => {
    const proibida = await seedPublishableArticle('midia-proibida', {
      heroMedia: ids.mediaProhibited,
    })
    await expect(publishAs(proibida, ids.chief)).rejects.toThrow()

    const expirada = await seedPublishableArticle('midia-expirada', {
      heroMedia: ids.mediaExpired,
    })
    await expect(publishAs(expirada, ids.chief)).rejects.toThrow()

    const ok = await seedPublishableArticle('midia-ok', { heroMedia: ids.mediaApproved })
    expect((await publishAs(ok, ids.chief)).workflowStatus).toBe('published')
  })
})

/* ------------------------------------------------------------------ */
/* 4. OUTBOX                                                           */
/* ------------------------------------------------------------------ */

describe('publication outbox', () => {
  it('primeira publicacao cria EXATAMENTE um evento', async () => {
    const id = await seedPublishableArticle('evt-1')
    expect(await outboxRows(id)).toHaveLength(0)
    await publishAs(id, ids.chief)

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

  it('retratacao cria seu proprio evento', async () => {
    const id = await seedPublishableArticle('evt-ciclo')
    await publishAs(id, ids.chief)
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
    await publishAs(id, ids.chief)

    const chief = await userDoc(ids.chief)
    for (const status of ['needs_update', 'ready_to_publish']) {
      await payload.update({
        collection: 'articles',
        id,
        data: { workflowStatus: status } as never,
        overrideAccess: false,
        user: chief,
      })
    }
    await publishAs(id, ids.chief)

    const rows = await outboxRows(id)
    expect(rows.filter((row) => row.eventType === 'article.published')).toHaveLength(1)
  })

  it('conteudo DIFERENTE gera evento novo (a chave nao engole mudanca real)', async () => {
    const id = await seedPublishableArticle('evt-novo')
    await publishAs(id, ids.chief)

    const chief = await userDoc(ids.chief)
    await payload.update({
      collection: 'articles',
      id,
      data: { workflowStatus: 'needs_update' } as never,
      overrideAccess: false,
      user: chief,
    })
    await payload.update({
      collection: 'articles',
      id,
      data: { title: 'Titulo materialmente diferente' } as never,
      overrideAccess: false,
      user: chief,
    })
    await payload.update({
      collection: 'articles',
      id,
      data: { workflowStatus: 'ready_to_publish' } as never,
      overrideAccess: false,
      user: chief,
    })
    await publishAs(id, ids.chief)

    expect((await outboxRows(id)).length).toBeGreaterThanOrEqual(2)
  })

  it('o evento gravado valida contra publication-event-v1', async () => {
    const id = await seedPublishableArticle('evt-valido')
    await publishAs(id, ids.chief)
    const rows = await outboxRows(id)
    const parsed = parsePublicationEventV1(rows[0]?.payload)
    expect(parsed.ok, parsed.ok ? '' : JSON.stringify(parsed.issues)).toBe(true)
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
/* 5. ATOMICIDADE                                                      */
/* ------------------------------------------------------------------ */

describe('atomicidade: artigo e outbox vivem ou morrem juntos', () => {
  it('evento invalido derruba a publicacao inteira', async () => {
    const id = await seedPublishableArticle('atomico')
    // Slug fora do formato do contrato: o `buildOutboxRecord` recusa o evento e
    // o `afterChange` lanca. Se a transacao nao fosse compartilhada, o artigo
    // ficaria publicado SEM evento — o estado que nao pode existir.
    await payload.update({
      collection: 'articles',
      id,
      data: { slug: 'Slug Invalido Com Espacos' } as never,
      overrideAccess: true,
      user: await userDoc(ids.chief),
    })

    const before = await articleById(id)
    await expect(publishAs(id, ids.chief)).rejects.toThrow()

    const after = await articleById(id)
    expect(after.workflowStatus, 'artigo nao pode ficar publicado sem evento').toBe(
      before.workflowStatus,
    )
    expect(after._status).not.toBe('published')
    expect(await outboxRows(id)).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ */
/* 6. SEED DE DESENVOLVIMENTO contra PostgreSQL real                   */
/* ------------------------------------------------------------------ */

describe('seed:dev contra PostgreSQL real', () => {
  it('e idempotente: rodar duas vezes nao duplica a Redacao Cinerie', async () => {
    const first = await seedInstitutionalAuthor(payload as never)
    const second = await seedInstitutionalAuthor(payload as never)

    expect(['created', 'updated', 'unchanged']).toContain(first.outcome)
    expect(second.outcome).toBe('unchanged')

    const found = await payload.find({
      collection: 'authors',
      where: { slug: { equals: INSTITUTIONAL_AUTHOR_SLUG } },
      limit: 10,
      overrideAccess: true,
    })
    expect(found.totalDocs, 'o autor institucional precisa ser unico').toBe(1)
  })

  it('nao cria usuario, service account nem API key', async () => {
    const usersBefore = await payload.count({
      collection: 'editorial-users',
      overrideAccess: true,
    })
    const accountsBefore = await payload.count({
      collection: 'service-accounts',
      overrideAccess: true,
    })

    await seedInstitutionalAuthor(payload as never)

    expect((await payload.count({ collection: 'editorial-users', overrideAccess: true })).totalDocs)
      .toBe(usersBefore.totalDocs)
    expect((await payload.count({ collection: 'service-accounts', overrideAccess: true })).totalDocs)
      .toBe(accountsBefore.totalDocs)
  })
})

/* ------------------------------------------------------------------ */
/* 7. PRONTIDAO DE IMPLANTACAO (FASE 2E)                               */
/* ------------------------------------------------------------------ */

describe('health e readiness do CMS (HTTP real)', () => {
  it('/healthz responde sem tocar banco nem configuracao', async () => {
    const response = await fetch(`${baseUrl}/healthz`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.status).toBe('ok')
    expect(body.service).toBe('cinerie-cms')
    // Liveness nao pode expor topologia: nem banco, nem storage, nem versao de
    // infraestrutura.
    const text = JSON.stringify(body)
    expect(text).not.toContain('postgres')
    expect(text).not.toContain('secret')
  })

  it('/readyz fica PRONTO com banco e migrations aplicadas', async () => {
    // O harness aplicou as migrations antes de subir o servidor: este e o
    // CONTROLE POSITIVO da readiness. Sem ele, uma readiness que bloqueasse
    // sempre passaria em todos os testes negativos sem nunca liberar o servico.
    const response = await fetch(`${baseUrl}/readyz`)
    const body = (await response.json()) as {
      status?: string
      checks?: { name: string; status: string; detail: string }[]
    }
    expect(response.status, JSON.stringify(body)).toBe(200)
    expect(body.status).toBe('ready')

    const byName = new Map((body.checks ?? []).map((check) => [check.name, check]))
    expect(byName.get('database')?.status).toBe('ok')
    expect(byName.get('migrations')?.status).toBe('ok')
    expect(byName.get('collections')?.status).toBe('ok')
  })

  it('a readiness NUNCA expoe segredo, URL de banco ou caminho de storage', async () => {
    const text = await (await fetch(`${baseUrl}/readyz`)).text()
    for (const secret of ['postgresql://', 'PAYLOAD_SECRET=', 'password', 'AKIA']) {
      expect(text).not.toContain(secret)
    }
    // Controle positivo: o relatorio realmente tem conteudo util.
    expect(text).toContain('migrations')
  })
})
