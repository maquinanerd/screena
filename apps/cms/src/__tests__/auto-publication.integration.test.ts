/**
 * Autopublicacao do MNScr por HTTP REAL, contra PostgreSQL 16 efemero.
 *
 * O que so este arquivo prova: que a decisao pura, a politica de autoria, a
 * reserva de quota e a persistencia estao LIGADAS umas as outras. Cada peca ja
 * tem teste proprio; nenhum deles pega uma reserva que roda fora da transacao
 * da publicacao, um limite lido de uma env que o servidor nao enxerga, ou um
 * retry que republica.
 *
 * As envs sao definidas ANTES do harness de proposito: o servidor e um processo
 * separado e herda o ambiente no `spawn`. Mudar `process.env` depois nao chega
 * la — e o teste passaria a medir os defaults, nao o que ele declara medir.
 */

import { randomUUID } from 'node:crypto'

// Os tetos GLOBAIS ficam folgados de proposito, e o esgotamento e provado pelo
// teto do PROPRIO autor.
//
// A primeira versao usava um teto global apertado, e o resultado foi um teste
// que dependia da ordem: os cenarios anteriores gastavam o dia e o setup do
// seguinte era recusado por um limite que ele nem estava medindo. Teto por
// autor da a cada cenario um orcamento proprio.
process.env.EDITORIAL_AUTO_PUBLISH_ENABLED = 'true'
process.env.EDITORIAL_AUTO_PUBLISH_DAILY_LIMIT = '80'
process.env.EDITORIAL_AUTO_PUBLISH_PER_AUTHOR_LIMIT = '20'
process.env.EDITORIAL_AUTO_PUBLISH_PER_SECTION_LIMIT = '50'
process.env.EDITORIAL_AUTO_PUBLISH_PER_CONTENT_TYPE_LIMIT = '50'
process.env.EDITORIAL_AUTO_PUBLISH_PER_ARTICLE_UPDATE_LIMIT = '1'
process.env.EDITORIAL_AUTO_PUBLISH_TIME_ZONE = 'America/Sao_Paulo'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'

import { validPublicationRequest } from '@screena/editorial-contracts'

import { apiKeyAuthorization, startCmsHarness, type CmsHarness } from './harness.js'

let harness: CmsHarness
let payload: Payload
let baseUrl: string

let publisherKey = ''
let draftOnlyKey = ''
let authorId = ''
let otherAuthorId = ''
let restrictedAuthorId = ''
let cappedAuthorId = ''
let exhaustedAuthorId = ''

/* ------------------------------------------------------------------ */
/* Fixtures                                                           */
/* ------------------------------------------------------------------ */

interface Overrides {
  readonly [key: string]: unknown
}

/**
 * Pedido valido derivado da fixture canonica.
 *
 * `media` e removida: a fixture aponta para `media-9001`, que nao existe neste
 * banco, e midia nao verificavel bloqueia a publicacao — com razao. Aqui o alvo
 * e a quota e a autoria, nao o gate de midia (que tem teste proprio).
 */
function requestBody(overrides: Overrides = {}): Record<string, unknown> {
  const id = randomUUID()
  const { seo: seoOverrides, ...rest } = overrides as { seo?: Overrides }
  return {
    ...validPublicationRequest,
    media: [],
    requestId: `req-${id}`,
    idempotencyKey: `idem-${id}`,
    sourceClusterId: `cluster-${id.slice(0, 8)}`,
    publicAuthorId: authorId,
    ...rest,
    // O `seo` e mesclado, NAO substituido: um override parcial que apagasse a
    // slug unica faria todos os pedidos colidirem na mesma slug e o teste
    // mediria a resolucao de colisao em vez do que ele declara medir.
    seo: {
      ...validPublicationRequest.seo,
      imageAltSuggestions: [],
      slugSuggestion: `materia-${id.slice(0, 8)}`,
      ...(seoOverrides ?? {}),
    },
  }
}

async function publish(
  body: Record<string, unknown>,
  key = publisherKey,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api/internal/editorial-publications`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: apiKeyAuthorization('service-accounts', key),
    },
    body: JSON.stringify(body),
  })
  const raw = await response.text()
  let parsed: Record<string, unknown> = {}
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    // Parse defensivo: um `.json()` cego sobre uma pagina de erro do Next
    // estoura com "Unexpected token '<'" e o motivo real fica invisivel.
    throw new Error(
      `resposta nao-JSON (status ${String(response.status)}): ${raw.slice(0, 300)}\n[servidor]\n${harness.serverLog().slice(-2000)}`,
    )
  }
  if (parsed.outcome === 'OPERATIONAL_ERROR') {
    // 503 e falha de PLATAFORMA, e a resposta ao produtor e deliberadamente
    // generica. Sem despejar o log do servidor aqui, um teste vermelho diria
    // apenas "esperava PUBLISHED, recebi OPERATIONAL_ERROR" — que foi
    // exatamente o beco sem saida da primeira investigacao.
    console.error(`[servidor]
${harness.serverLog().slice(-4000)}`)
  }
  return { status: response.status, body: parsed }
}

async function counterFor(dimension: string, key: string): Promise<number> {
  const found = await payload.find({
    collection: 'autopublish-quota-counters',
    where: {
      and: [{ dimensionType: { equals: dimension } }, { dimensionKey: { equals: key } }],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const doc = found.docs[0] as { currentCount?: unknown } | undefined
  return doc === undefined ? 0 : Number(doc.currentCount)
}

/* ------------------------------------------------------------------ */
/* Setup                                                              */
/* ------------------------------------------------------------------ */

beforeAll(async () => {
  harness = await startCmsHarness()
  payload = harness.payload
  baseUrl = harness.baseUrl

  const makeServiceAccount = async (label: string, scopes: string[]) => {
    const key = randomUUID()
    await payload.create({
      collection: 'service-accounts',
      data: { label, purpose: 'mnscr', active: true, scopes, enableAPIKey: true, apiKey: key } as never,
      overrideAccess: true,
    })
    return key
  }
  publisherKey = await makeServiceAccount('mnscr-publisher', ['editorial_auto_publish'])
  // Os tres poderes sao disjuntos: quem ingere rascunho nao publica.
  draftOnlyKey = await makeServiceAccount('mnscr-draft', ['draft_ingest'])

  const makeAuthor = async (
    name: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> => {
    const created = await payload.create({
      collection: 'authors',
      data: {
        name,
        slug: `${name.toLowerCase().replace(/[^a-z]+/g, '-')}-${randomUUID().slice(0, 6)}`,
        active: true,
        automationPublishingAllowed: true,
        allowedAutomationContentTypes: ['news'],
        allowedAutomationSections: ['Series'],
        automationAttributionModes: ['newsroom'],
        ...extra,
      } as never,
      overrideAccess: true,
    })
    return String(created.id)
  }

  authorId = await makeAuthor('Redacao Principal')
  otherAuthorId = await makeAuthor('Redacao Secundaria')
  // Nao aceita `newsroom`: a decisao sobre o proprio nome e do autor.
  restrictedAuthorId = await makeAuthor('Redacao Restrita', { automationAttributionModes: ['byline'] })
  // Teto PROPRIO menor que o da plataforma.
  cappedAuthorId = await makeAuthor('Redacao Com Teto', { automationDailyLimit: 1 })
  // Orcamento proprio para o cenario de esgotamento, sem contaminar os demais.
  exhaustedAuthorId = await makeAuthor('Redacao Esgotavel', { automationDailyLimit: 2 })
}, 900_000)

afterAll(async () => {
  await harness?.stop()
}, 180_000)

/* ------------------------------------------------------------------ */
/* 1. AUTORIZACAO                                                     */
/* ------------------------------------------------------------------ */

describe('autorizacao do endpoint de autopublicacao', () => {
  it('sem credencial: 401', async () => {
    const response = await fetch(`${baseUrl}/api/internal/editorial-publications`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody()),
    })
    expect(response.status).toBe(401)
  })

  it('escopo de rascunho NAO publica', async () => {
    // `draft_ingest` e `editorial_auto_publish` sao poderes diferentes. Uma
    // conta que so ingere rascunho nao pode virar publicadora por acidente de
    // configuracao.
    const result = await publish(requestBody(), draftOnlyKey)
    expect(result.status).toBe(403)
    expect(result.body.error).toBe('forbidden_scope')
  })

  it('autor que nao aceita o modo de assinatura e BLOQUEADO, nao enfileirado', async () => {
    // BLOCKED e nao ROUTED_TO_REVIEW de proposito: recusa de POLITICA nao se
    // resolve com espera. Mandar para revisao humana pediria a um editor que
    // decidisse algo que o autor ja decidiu — e reenviar igual repetiria o
    // mesmo defeito.
    const result = await publish(requestBody({ publicAuthorId: restrictedAuthorId }))
    expect(result.body.outcome).toBe('BLOCKED')
    expect(JSON.stringify(result.body.reasons)).toContain('attribution_mode_not_allowed')
  })

  it('autor inexistente e bloqueado, nao publica', async () => {
    const result = await publish(requestBody({ publicAuthorId: '999999' }))
    expect(result.body.outcome).toBe('BLOCKED')
    expect(JSON.stringify(result.body.reasons)).toContain('author_not_found')
  })
})

/* ------------------------------------------------------------------ */
/* 2. PUBLICACAO E CONSUMO DE QUOTA                                   */
/* ------------------------------------------------------------------ */

describe('publicacao consome quota na MESMA transacao', () => {
  it('publica, incrementa contadores e registra o consumo', async () => {
    const globalBefore = await counterFor('global', 'all')
    const body = requestBody()
    const result = await publish(body)

    expect(result.status).toBe(201)
    expect(result.body.outcome).toBe('PUBLISHED')
    expect(result.body.articleId).toBeTruthy()

    // O ATOR TECNICO e a conta de servico; o autor publico e o do pedido. Os
    // dois convivem — colapsar um no outro faria a automacao virar "autora" na
    // ficha publica ou apagaria quem operou do registro.
    expect(result.body.technicalActorId).toBeTruthy()
    expect(result.body.publicAuthorId).toBe(authorId)

    expect(await counterFor('global', 'all')).toBe(globalBefore + 1)
    expect(await counterFor('author', authorId)).toBeGreaterThan(0)

    const usage = await payload.find({
      collection: 'autopublish-quota-usage',
      where: { requestId: { equals: body.requestId } },
      limit: 1,
      overrideAccess: true,
    })
    expect(usage.docs).toHaveLength(1)
  }, 120_000)

  it('reenvio do MESMO requestId nao consome quota de novo', async () => {
    // O retry de um HTTP perdido no caminho ja consumiu o teto na primeira
    // tentativa. Consumir de novo faria o produtor gastar o dia reenviando o
    // mesmo pedido — e o teto protegeria contra a coisa errada.
    const body = requestBody()
    const first = await publish(body)
    expect(first.body.outcome).toBe('PUBLISHED')

    const globalAfterFirst = await counterFor('global', 'all')
    const second = await publish(body)

    expect(second.body.idempotent).toBe(true)
    expect(await counterFor('global', 'all')).toBe(globalAfterFirst)

    const usage = await payload.count({
      collection: 'autopublish-quota-usage',
      where: { requestId: { equals: body.requestId } },
      overrideAccess: true,
    })
    expect(usage.totalDocs).toBe(1)
  }, 120_000)

  it('bloqueio por autoria NAO consome quota', async () => {
    // Publicacao que nem aconteceu nao pode gastar o dia da redacao.
    const before = await counterFor('global', 'all')
    await publish(requestBody({ publicAuthorId: restrictedAuthorId }))
    expect(await counterFor('global', 'all')).toBe(before)
  }, 120_000)

  it('o teto PROPRIO do autor vence o teto da plataforma quando e menor', async () => {
    // A plataforma permite 3 por autor; este autor declarou 1. A decisao dele
    // sobre o proprio nome nao pode ser afrouxada pela configuracao global.
    const first = await publish(requestBody({ publicAuthorId: cappedAuthorId }))
    expect(first.body.outcome).toBe('PUBLISHED')

    const second = await publish(requestBody({ publicAuthorId: cappedAuthorId }))
    expect(second.body.outcome).toBe('ROUTED_TO_REVIEW')
    expect(JSON.stringify(second.body.reasons)).toContain(
      'AUTO_PUBLISH_AUTHOR_DAILY_LIMIT_REACHED',
    )
    // Recusa DIARIA promete horario: o produtor sabe quando reenfileirar.
    expect(second.body.nextEligibleAt ?? null).not.toBeNull()
    expect(await counterFor('author', cappedAuthorId)).toBe(1)
  }, 180_000)
})

/* ------------------------------------------------------------------ */
/* 3. TROCA DE AUTOR EM MATERIA PUBLICADA                             */
/* ------------------------------------------------------------------ */

describe('troca de autor exige humano', () => {
  it('atualizar mantendo o MESMO autor e aceito', async () => {
    const first = await publish(requestBody())
    expect(first.body.outcome).toBe('PUBLISHED')
    const articleId = String(first.body.articleId)

    const update = await publish(
      requestBody({
        publicationIntent: 'update',
        idempotencyKey: String((first.body as { idempotencyKey?: unknown }).idempotencyKey),
        targetArticleId: articleId,
        sourceRevision: 99,
        publicAuthorId: authorId,
      }),
    )

    expect(['PUBLISHED', 'ROUTED_TO_REVIEW']).toContain(update.body.outcome)
    expect(JSON.stringify(update.body.reasons)).not.toContain('AUTHOR_CHANGE_REQUIRES_HUMAN')
  }, 180_000)

  it('trocar o autor de materia publicada NAO aplica NADA', async () => {
    const first = await publish(requestBody())
    expect(first.body.outcome).toBe('PUBLISHED')
    const articleId = String(first.body.articleId)

    const before = (await payload.findByID({
      collection: 'articles',
      id: articleId,
      depth: 0,
      overrideAccess: true,
    })) as unknown as Record<string, unknown>

    const update = await publish(
      requestBody({
        publicationIntent: 'update',
        idempotencyKey: String((first.body as { idempotencyKey?: unknown }).idempotencyKey),
        targetArticleId: articleId,
        sourceRevision: 99,
        publicAuthorId: otherAuthorId,
        title: 'Titulo completamente diferente para provar que nada foi aplicado',
      }),
    )

    expect(update.body.outcome).toBe('ROUTED_TO_REVIEW')
    expect(JSON.stringify(update.body.reasons)).toContain('AUTHOR_CHANGE_REQUIRES_HUMAN')

    // MUTACAO PARCIAL E PIOR QUE NENHUMA. Aplicar o corpo novo e recusar so a
    // assinatura deixaria a materia com texto de um pedido e autor de outro,
    // sem ninguem ter decidido isso.
    const after = (await payload.findByID({
      collection: 'articles',
      id: articleId,
      depth: 0,
      overrideAccess: true,
    })) as unknown as Record<string, unknown>
    expect(after.title).toBe(before.title)
    expect(String(after.primaryAuthor)).toBe(String(before.primaryAuthor))
  }, 180_000)
})

/* ------------------------------------------------------------------ */
/* 4. TETO DIARIO PELO CAMINHO HTTP                                   */
/* ------------------------------------------------------------------ */

describe('teto diario esgotado', () => {
  it('esgotar o teto roteia para revisao com horario de liberacao', async () => {
    // Este autor aceita 2 publicacoes automaticas por dia. A terceira nao e
    // erro do produtor: o conteudo passou por todas as validacoes e o que falta
    // e decisao humana — por isso 202 e nao 4xx, e por isso o conteudo nao e
    // jogado fora.
    expect((await publish(requestBody({ publicAuthorId: exhaustedAuthorId }))).body.outcome).toBe(
      'PUBLISHED',
    )
    expect((await publish(requestBody({ publicAuthorId: exhaustedAuthorId }))).body.outcome).toBe(
      'PUBLISHED',
    )

    const third = await publish(requestBody({ publicAuthorId: exhaustedAuthorId }))
    expect(third.status).toBe(202)
    expect(third.body.outcome).toBe('ROUTED_TO_REVIEW')
    expect(JSON.stringify(third.body.reasons)).toContain('AUTO_PUBLISH_AUTHOR_DAILY_LIMIT_REACHED')
    // Dimensao DIARIA promete horario: o produtor sabe quando reenfileirar.
    expect(third.body.nextEligibleAt ?? null).not.toBeNull()

    expect(await counterFor('author', exhaustedAuthorId)).toBe(2)
  }, 300_000)
})
