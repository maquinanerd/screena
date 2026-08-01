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

import { shouldRetry } from '../auto-publication.js'
import { editorialDayWindowUtc } from '../env-auto-publish.js'
import { localDateIn } from '../quota.js'

import { apiKeyAuthorization, startCmsHarness, type CmsHarness } from './harness.js'

/** O MESMO fuso declarado nas envs acima. */
const TIME_ZONE = 'America/Sao_Paulo'

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
): Promise<{
  status: number
  body: Record<string, unknown>
  /** `Retry-After` cru. `null` quando o servidor NAO emitiu o header. */
  retryAfter: string | null
  /** Instante imediatamente anterior ao envio, para conferir o `Retry-After`. */
  sentAtMs: number
}> {
  const sentAtMs = Date.now()
  const response = await fetch(`${baseUrl}/api/internal/editorial-publications`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: apiKeyAuthorization('service-accounts', key),
    },
    body: JSON.stringify(body),
  })
  const retryAfter = response.headers.get('retry-after')
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
  return { status: response.status, body: parsed, retryAfter, sentAtMs }
}

/** Quantos ARTIGOS existem com esta chave de idempotencia. */
async function articleCountFor(idempotencyKey: string): Promise<number> {
  const found = await payload.count({
    collection: 'articles',
    where: { automationIdempotencyKey: { equals: idempotencyKey } },
    overrideAccess: true,
  })
  return found.totalDocs
}

/** Quantos REGISTROS DE CONSUMO existem para este `requestId`. */
async function usageCountFor(requestId: string): Promise<number> {
  const found = await payload.count({
    collection: 'autopublish-quota-usage',
    where: { requestId: { equals: requestId } },
    overrideAccess: true,
  })
  return found.totalDocs
}

async function findCounterRow(
  dimension: string,
  key: string,
): Promise<Record<string, unknown> | null> {
  const found = await payload.find({
    collection: 'autopublish-quota-counters',
    where: {
      and: [
        { timeZone: { equals: TIME_ZONE } },
        { localDate: { equals: localDateIn(new Date().toISOString(), TIME_ZONE) } },
        { dimensionType: { equals: dimension } },
        { dimensionKey: { equals: key } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return (found.docs[0] ?? null) as Record<string, unknown> | null
}

/**
 * Roda o cenario com UMA dimensao esgotada e devolve o contador ao valor original.
 *
 * POR QUE MEXER NA LINHA EM VEZ DE PUBLICAR ATE ESTOURAR: o teto global e 80 e o
 * de secao e 50. Publicar 80 materias por cenario levaria a suite a dezenas de
 * minutos e mediria throughput, nao politica. O que o endpoint enxerga e uma
 * coisa so — `current_count < limit` —, e essa condicao e identica sendo a linha
 * preenchida por 80 publicacoes ou por este `update`.
 *
 * A RESTAURACAO no `finally` e o que mantem os cenarios independentes: sem ela o
 * primeiro teste a esgotar o global derrubaria todos os seguintes, e a suite
 * passaria a depender da ordem de execucao.
 *
 * Restaurar tambem SIMULA A VIRADA DA JANELA. Nao da para adiantar o relogio do
 * servidor; mas a meia-noite o que muda para o endpoint e exatamente isto — a
 * linha daquela chave deixa de estar cheia (la, porque `local_date` entra na
 * unique e nasce uma linha nova; aqui, porque o contador voltou).
 */
async function withExhaustedQuota<T>(
  dimension: string,
  key: string,
  limit: number,
  run: () => Promise<T>,
): Promise<T> {
  const nowIso = new Date().toISOString()
  const window = editorialDayWindowUtc(nowIso, TIME_ZONE)
  const existing = await findCounterRow(dimension, key)
  const restoreTo = existing === null ? 0 : Number(existing.currentCount)

  if (existing === null) {
    await payload.create({
      collection: 'autopublish-quota-counters',
      data: {
        timeZone: TIME_ZONE,
        localDate: localDateIn(nowIso, TIME_ZONE),
        dimensionType: dimension,
        dimensionKey: key,
        currentCount: limit,
        limitSnapshot: limit,
        windowStartUtc: window.startUtcIso,
        windowEndUtc: window.nextStartUtcIso,
      } as never,
      overrideAccess: true,
    })
  } else {
    await payload.update({
      collection: 'autopublish-quota-counters',
      id: existing.id as string,
      data: { currentCount: limit } as never,
      overrideAccess: true,
    })
  }

  try {
    return await run()
  } finally {
    const row = await findCounterRow(dimension, key)
    if (row !== null) {
      await payload.update({
        collection: 'autopublish-quota-counters',
        id: row.id as string,
        data: { currentCount: restoreTo } as never,
        overrideAccess: true,
      })
    }
  }
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
    // `DEFERRED`, nao `ROUTED_TO_REVIEW`: nada foi persistido para revisar.
    expect(second.body.outcome).toBe('DEFERRED')
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
    // Este autor aceita 2 publicacoes automaticas por dia. A terceira nao e erro
    // do produtor: o conteudo passou por todas as validacoes e o que falta e
    // COTA.
    //
    // O comentario aqui dizia "o conteudo nao e jogado fora" — e era falso. A
    // reserva falha dentro da transacao e o rollback nao deixa nada: nem artigo,
    // nem registro de consumo. Por isso o desfecho agora e `DEFERRED` (429), que
    // manda o produtor voltar, e nao `ROUTED_TO_REVIEW` (202), que mandava
    // esperar por uma revisao inexistente.
    expect((await publish(requestBody({ publicAuthorId: exhaustedAuthorId }))).body.outcome).toBe(
      'PUBLISHED',
    )
    expect((await publish(requestBody({ publicAuthorId: exhaustedAuthorId }))).body.outcome).toBe(
      'PUBLISHED',
    )

    const third = await publish(requestBody({ publicAuthorId: exhaustedAuthorId }))
    expect(third.status).toBe(429)
    expect(third.body.outcome).toBe('DEFERRED')
    expect(JSON.stringify(third.body.reasons)).toContain('AUTO_PUBLISH_AUTHOR_DAILY_LIMIT_REACHED')
    // Dimensao DIARIA promete horario: o produtor sabe quando reenfileirar.
    expect(third.body.nextEligibleAt ?? null).not.toBeNull()

    expect(await counterFor('author', exhaustedAuthorId)).toBe(2)
  }, 300_000)
})

/* ------------------------------------------------------------------ */
/* 5. DEFERRED — teto esgotado nao e "encaminhado para revisao"        */
/* ------------------------------------------------------------------ */

/**
 * O defeito que esta secao existe para travar.
 *
 * Teto esgotado respondia **202 `ROUTED_TO_REVIEW`** — o mesmo rotulo dos
 * caminhos de SEO, QA, kill switch e troca de autor. So que aqueles PERSISTEM a
 * materia em `needs_review`, e este nao persiste NADA: a reserva de quota falha
 * dentro da transacao, antes de `persistPublication`, e o rollback leva junto o
 * artigo que nem chegou a ser criado.
 *
 * O produtor entao lia "encaminhado para revisao", nao retentava (`shouldRetry`
 * devolvia `false` para tudo) e ficava esperando um editor abrir uma fila vazia.
 * A materia sumia com 2xx na resposta.
 */
describe('DEFERRED: teto esgotado adia, nao enfileira', () => {
  /**
   * Confere que o `Retry-After` aponta para o MESMO instante do `nextEligibleAt`.
   *
   * A tolerancia cobre latencia de rede e o intervalo entre o `Date.now()` do
   * teste e o `receivedAt` do servidor. Sem tolerancia o teste seria flaky; com
   * tolerancia grande demais ele passaria com o header vindo de outro relogio —
   * que e exatamente a contradicao a evitar.
   */
  function expectRetryAfterMatchesBody(result: {
    body: Record<string, unknown>
    retryAfter: string | null
    sentAtMs: number
  }): void {
    const nextEligibleAt = result.body.nextEligibleAt
    expect(typeof nextEligibleAt).toBe('string')
    expect(result.retryAfter).not.toBeNull()

    const seconds = Number(result.retryAfter)
    expect(Number.isInteger(seconds)).toBe(true)
    expect(seconds).toBeGreaterThan(0)

    const expected = Math.ceil((Date.parse(String(nextEligibleAt)) - result.sentAtMs) / 1000)
    expect(Math.abs(seconds - expected)).toBeLessThanOrEqual(10)
  }

  const DAILY_DIMENSIONS: readonly { dimension: string; key: () => string; limit: number }[] = [
    { dimension: 'global', key: () => 'all', limit: 80 },
    { dimension: 'content_type', key: () => 'news', limit: 50 },
    { dimension: 'section', key: () => 'Series', limit: 50 },
    { dimension: 'author', key: () => authorId, limit: 20 },
  ]

  for (const entry of DAILY_DIMENSIONS) {
    it(`teto de ${entry.dimension} esgotado: 429 DEFERRED, retentavel, e NENHUM artigo criado`, async () => {
      const body = requestBody()
      const idempotencyKey = String(body.idempotencyKey)
      const requestId = String(body.requestId)

      const result = await withExhaustedQuota(entry.dimension, entry.key(), entry.limit, () =>
        publish(body),
      )

      expect(result.status).toBe(429)
      expect(result.body.outcome).toBe('DEFERRED')
      expect(result.body.retryable).toBe(true)
      expect(shouldRetry('DEFERRED')).toBe(true)
      expect(JSON.stringify(result.body.reasons)).toContain(entry.dimension)
      expectRetryAfterMatchesBody(result)

      // O CORACAO DO DEFEITO: a resposta antiga dizia "encaminhado para revisao"
      // e nao havia NADA para revisar. Continua nao havendo — a diferenca e que
      // agora a resposta admite isso.
      expect(await articleCountFor(idempotencyKey)).toBe(0)
      expect(await usageCountFor(requestId)).toBe(0)
    }, 180_000)
  }

  it('ROLLBACK devolve as dimensoes consumidas ANTES da que estourou', async () => {
    // `author` e a quarta na ordem canonica: quando ela recusa, `global`,
    // `content_type` e `section` ja incrementaram. Se o rollback nao as
    // desfizesse, cada tentativa RECUSADA roubaria uma vaga do dia e o teto se
    // esgotaria sozinho a forca de recusas.
    const globalBefore = await counterFor('global', 'all')
    const contentTypeBefore = await counterFor('content_type', 'news')
    const sectionBefore = await counterFor('section', 'Series')

    const result = await withExhaustedQuota('author', authorId, 20, () => publish(requestBody()))
    expect(result.body.outcome).toBe('DEFERRED')

    expect(await counterFor('global', 'all')).toBe(globalBefore)
    expect(await counterFor('content_type', 'news')).toBe(contentTypeBefore)
    expect(await counterFor('section', 'Series')).toBe(sectionBefore)
  }, 180_000)

  it('ALICERCE: o MESMO requestId, reenviado depois que a janela libera, publica UMA vez', async () => {
    // Este e o teste que prova que a solucao funciona. `DEFERRED` so vale alguma
    // coisa se o reenvio depois nao criar duplicata — e ele nao cria porque nada
    // sobreviveu a primeira tentativa: sem artigo com aquela idempotencyKey e sem
    // linha em `autopublish-quota-usage`, o reenvio percorre o caminho inteiro
    // como se fosse o primeiro.
    const body = requestBody()
    const idempotencyKey = String(body.idempotencyKey)
    const requestId = String(body.requestId)

    const deferred = await withExhaustedQuota('global', 'all', 80, () => publish(body))
    expect(deferred.body.outcome).toBe('DEFERRED')
    expect(await articleCountFor(idempotencyKey)).toBe(0)
    expect(await usageCountFor(requestId)).toBe(0)

    // Janela liberada (o `finally` do helper restaurou o contador).
    // MESMO corpo, MESMO requestId, MESMA idempotencyKey.
    const retried = await publish(body)

    expect(retried.status).toBe(201)
    expect(retried.body.outcome).toBe('PUBLISHED')
    expect(retried.body.articleId).toBeTruthy()
    expect(retried.retryAfter).toBeNull()

    // EXATAMENTE UM. Nem zero (a materia teria se perdido), nem dois (o reenvio
    // teria duplicado).
    expect(await articleCountFor(idempotencyKey)).toBe(1)
    expect(await usageCountFor(requestId)).toBe(1)
  }, 240_000)

  it('reenvio AINDA DENTRO da janela: DEFERRED de novo, sem duplicata e sem gastar teto', async () => {
    const body = requestBody()
    const idempotencyKey = String(body.idempotencyKey)
    const requestId = String(body.requestId)

    await withExhaustedQuota('author', authorId, 20, async () => {
      const globalBefore = await counterFor('global', 'all')

      const first = await publish(body)
      const second = await publish(body)

      expect(first.body.outcome).toBe('DEFERRED')
      expect(second.body.outcome).toBe('DEFERRED')
      expect(second.status).toBe(429)

      // Retentar contra a parede nao pode custar nada: um `DEFERRED` que
      // consumisse teto transformaria a espera do produtor numa forma de gastar
      // o dia seguinte antes de ele comecar.
      expect(await counterFor('global', 'all')).toBe(globalBefore)
      expect(await articleCountFor(idempotencyKey)).toBe(0)
      expect(await usageCountFor(requestId)).toBe(0)
    })
  }, 240_000)

  it('teto de ARTICLE_UPDATE esgotado NAO e adiavel — nao promete horario nem header', async () => {
    // O teto por artigo existe para conter automacao em LACO. Responder "volte
    // amanha" ali autorizaria reescrever a mesma materia todo dia, que e
    // exatamente o comportamento contra o qual o teto foi criado. Entao ele e o
    // unico esgotamento que NAO vira `DEFERRED`.
    const first = await publish(requestBody())
    expect(first.body.outcome).toBe('PUBLISHED')
    const articleId = String(first.body.articleId)

    const update = await withExhaustedQuota('article_update', articleId, 1, () =>
      publish(
        requestBody({
          publicationIntent: 'update',
          idempotencyKey: String(first.body.idempotencyKey),
          targetArticleId: articleId,
          sourceRevision: 99,
        }),
      ),
    )

    expect(update.body.outcome).toBe('BLOCKED')
    expect(update.status).toBe(422)
    expect(update.body.retryable).toBe(false)
    expect(shouldRetry('BLOCKED')).toBe(false)
    expect(JSON.stringify(update.body.reasons)).toContain(
      'AUTO_PUBLISH_ARTICLE_UPDATE_LIMIT_REACHED',
    )

    // Sem horario prometido e, por consequencia, SEM header. Corpo e header nao
    // podem se contradizer: prometer `Retry-After` aqui mandaria o produtor
    // voltar para levar a mesma recusa.
    expect(update.body.nextEligibleAt ?? null).toBeNull()
    expect(update.retryAfter).toBeNull()
  }, 240_000)

  it('REGRESSAO: os ROUTED_TO_REVIEW que PERSISTEM continuam persistindo', async () => {
    // O contraste que da sentido a separacao. Aqui o conteudo E guardado em
    // `needs_review` e existe algo na fila do editor — por isso continua 202,
    // continua sem `Retry-After` e continua nao-retentavel.
    const result = await publish(
      requestBody({
        qa: { ...validPublicationRequest.qa, passed: false, blockingErrors: ['fato sem fonte'] },
      }),
    )

    expect(result.status).toBe(202)
    expect(result.body.outcome).toBe('ROUTED_TO_REVIEW')
    expect(result.body.articleId).toBeTruthy()
    expect(result.retryAfter).toBeNull()
    expect(shouldRetry('ROUTED_TO_REVIEW')).toBe(false)

    const article = (await payload.findByID({
      collection: 'articles',
      id: String(result.body.articleId),
      depth: 0,
      overrideAccess: true,
    })) as unknown as Record<string, unknown>
    expect(article.workflowStatus).toBe('needs_review')
  }, 180_000)
})
