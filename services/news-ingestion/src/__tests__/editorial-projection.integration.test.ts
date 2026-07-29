/**
 * Integracao REAL da projecao editorial: CMS (Payload + PG16) -> banco publico
 * (Prisma + PG16). DOIS PostgreSQL efemeros ao mesmo tempo.
 *
 * O caminho sob teste e o de producao inteiro: um editor-chefe publica pela
 * Local API do Payload, o hook emite o evento na outbox, o worker reclama por
 * HTTP REAL com uma chave de API real, o adapter Prisma projeta no screen-db e
 * confirma. Nada aqui e simulado — nem a fila, nem a autenticacao, nem as
 * migrations.
 *
 * Os dois bancos sao separados de proposito: a separacao e a tese do ADR 0015,
 * e uma suite que rodasse os dois lados sobre a mesma base nao provaria nada
 * sobre ela.
 */

import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'

import { startCmsHarness, type CmsHarness } from '@cms-harness'

import { mapPublicationEvent } from '../editorial-event-mapper.js'
import { applyProjectionEvent } from '../persistence/editorial-projection-store.js'
import { startScreenDbHarness, type ScreenDbHarness } from './screen-db-harness.js'

let cms: CmsHarness
let screen: ScreenDbHarness
let payload: Payload
let baseUrl = ''

const ids = { chief: 0, author: 0 }
let projectionKey = ''
let ingestKey = ''

const WORKER = 'worker-integracao'

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function auth(key: string): string {
  return `service-accounts API-Key ${key}`
}

async function callOutbox(path: string, body: unknown, key = projectionKey) {
  const response = await fetch(`${baseUrl}/api/internal/publication-outbox/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: auth(key) },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let json: Record<string, unknown> = {}
  try {
    json = JSON.parse(text) as Record<string, unknown>
  } catch {
    json = { raw: text }
  }
  return { status: response.status, json }
}

interface ClaimedEvent {
  eventId: string
  eventType: string
  emissionSequence: number
  contentVersion: string
  leaseToken: string
  payload: unknown
}

async function claim(batchSize = 10, key = projectionKey) {
  const result = await callOutbox('claim', { workerId: WORKER, batchSize }, key)
  return {
    status: result.status,
    events: (result.json.events ?? []) as ClaimedEvent[],
  }
}

async function userDoc(id: number) {
  const doc = await payload.findByID({ collection: 'editorial-users', id, overrideAccess: true })
  return { ...doc, collection: 'editorial-users' } as never
}

/** Artigo publicavel, levado ate `ready_to_publish` pelo fluxo real. */
async function seedArticle(suffix: string) {
  const created = await payload.create({
    collection: 'articles',
    data: {
      title: `Materia ${suffix}`,
      slug: `materia-${suffix}`,
      summary: 'Resumo editorial proprio da Cinerie para efeito de teste de projecao.',
      language: 'pt-BR',
      contentType: 'news',
      workflowStatus: 'draft',
      body: [
        {
          blockType: 'paragraph',
          blockId: 'b1',
          text: 'Corpo editorial proprio da Cinerie, escrito para o teste de projecao publica.',
        },
      ],
      authors: [ids.author],
      qaPassedAt: new Date().toISOString(),
      externalSources: [
        { sourceId: 's1', name: 'Variety', url: 'https://variety.com/x', role: 'primary' },
      ],
    } as never,
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

async function moveTo(id: string, status: string, extra: Record<string, unknown> = {}) {
  await payload.update({
    collection: 'articles',
    id,
    data: { workflowStatus: status, ...extra } as never,
    overrideAccess: false,
    user: await userDoc(ids.chief),
  })
}

/** Reclama, projeta e confirma — o ciclo completo do worker, em uma chamada. */
async function drain() {
  const { events } = await claim()
  const outcomes: string[] = []
  for (const event of events) {
    const mapping = mapPublicationEvent(event.payload, event.emissionSequence)
    expect(mapping.ok, `evento ${event.eventId} deveria passar no contrato`).toBe(true)
    if (!mapping.ok) continue
    const result = await applyProjectionEvent(screen.prisma as never, {
      event: mapping.event,
      contentVersion: event.contentVersion,
      workerId: WORKER,
    })
    outcomes.push(result.outcome)
    await callOutbox('ack', {
      eventId: event.eventId,
      leaseToken: event.leaseToken,
      workerId: WORKER,
      projectionReceiptId: result.articleId ?? event.eventId,
      projectedAt: new Date().toISOString(),
    })
  }
  return { outcomes, events }
}

async function publicArticle(payloadDocumentId: string) {
  return screen.prisma.article.findUnique({
    where: { payloadDocumentId },
    include: { translations: true },
  })
}

/* ------------------------------------------------------------------ */
/* Setup                                                              */
/* ------------------------------------------------------------------ */

beforeAll(async () => {
  // SEQUENCIAL, nao `Promise.all`. Duas instancias de `embedded-postgres`
  // inicializando ao mesmo tempo no Windows derrubam uma a outra (a conexao do
  // primeiro morre com ECONNRESET no meio do initdb do segundo).
  cms = await startCmsHarness()
  screen = await startScreenDbHarness()
  payload = cms.payload
  baseUrl = cms.baseUrl

  const chief = await payload.create({
    collection: 'editorial-users',
    data: {
      email: 'chefe@cinerie.test',
      password: 'senha-de-teste-chefe-0123456789',
      displayName: 'Chefe',
      role: 'editor_in_chief',
      active: true,
    } as never,
    overrideAccess: true,
  })
  ids.chief = Number(chief.id)

  const author = await payload.create({
    collection: 'authors',
    data: { name: 'Redacao Cinerie', slug: 'redacao-cinerie', active: true, isOrganization: true } as never,
    overrideAccess: true,
  })
  ids.author = Number(author.id)

  const makeAccount = async (label: string, scopes: string[]) => {
    const key = randomUUID()
    await payload.create({
      collection: 'service-accounts',
      data: {
        label,
        purpose: 'internal_tooling',
        active: true,
        scopes,
        enableAPIKey: true,
        apiKey: key,
      } as never,
      overrideAccess: true,
    })
    return key
  }
  projectionKey = await makeAccount('projetor', ['publication_projection'])
  ingestKey = await makeAccount('mnscr', ['draft_ingest'])
}, 900_000)

afterAll(async () => {
  await Promise.allSettled([cms?.stop(), screen?.stop()])
}, 300_000)

/* ------------------------------------------------------------------ */
/* 1. Escopo — a porta antes de tudo                                   */
/* ------------------------------------------------------------------ */

describe('escopo da conta tecnica', () => {
  it('sem credencial nao reclama a fila', async () => {
    const response = await fetch(`${baseUrl}/api/internal/publication-outbox/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workerId: WORKER }),
    })
    expect(response.status).toBe(401)
  })

  it('chave de INGESTAO nao consome a outbox de publicacao', async () => {
    // O MNScr cria rascunho; ele nao tem nada que drenar a fila de publicacao.
    // Um booleano generico de "automacao" daria esse poder de graca.
    const result = await claim(10, ingestKey)
    expect(result.status).toBe(403)
  })

  it('chave de PROJECAO nao cria rascunho editorial', async () => {
    const response = await fetch(`${baseUrl}/api/internal/editorial-drafts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: auth(projectionKey) },
      body: JSON.stringify({ contractVersion: 'editorial-draft-v1' }),
    })
    expect(response.status).toBe(403)
  })
})

/* ------------------------------------------------------------------ */
/* 2. Publicacao ponta a ponta                                         */
/* ------------------------------------------------------------------ */

describe('publicacao projetada no banco publico', () => {
  it('materia publicada no CMS vira artigo publico completo', async () => {
    const id = await seedArticle('ponta-a-ponta')
    await moveTo(id, 'published')

    const { outcomes } = await drain()
    expect(outcomes).toContain('applied')

    const article = await publicArticle(id)
    expect(article).not.toBeNull()
    expect(article?.payloadDocumentId).toBe(id)
    expect(article?.displayAllowed).toBe(true)
    expect(String(article?.licenseStatus)).toBe('official')
    // Fonte primaria declarada: credito e linkback exigidos.
    expect(article?.sourceName).toBe('Variety')
    expect(article?.requiresLinkback).toBe(true)

    const translation = article?.translations[0]
    expect(translation?.languageCode).toBe('pt-BR')
    expect(String(translation?.reviewStatus)).toBe('published')
    expect(String(translation?.indexStatus)).toBe('index')
    expect(translation?.body ?? '').toContain('Corpo editorial proprio')
    // Blocos estruturados chegam junto com sua versao (CHECK do banco).
    expect(Array.isArray(translation?.bodyBlocks)).toBe(true)
    expect(translation?.bodyBlocksVersion ?? '').not.toBe('')
  })

  it('grava RECIBO e marca o evento como processado', async () => {
    const receipts = await screen.prisma.editorialProjectionReceipt.findMany({
      where: { outcome: 'applied' },
    })
    expect(receipts.length).toBeGreaterThan(0)
    expect(receipts[0]?.workerId).toBe(WORKER)

    const rows = await payload.find({
      collection: 'publication-outbox',
      where: { status: { equals: 'processed' } },
      limit: 50,
      overrideAccess: true,
    })
    expect(rows.docs.length).toBeGreaterThan(0)
    // Lease devolvida: um evento processado nao fica com dono.
    expect(rows.docs[0]?.leaseToken ?? null).toBeNull()
  })

  it('a materia entra na BUSCA publica (modelo de leitura derivado)', async () => {
    const docs = await screen.prisma.searchDocument.findMany({ where: { docKind: 'article' } })
    expect(docs.length).toBeGreaterThan(0)
    const decisions = await screen.prisma.pageIndexabilityDecision.findMany({
      where: { docKind: 'article', isCurrent: true },
    })
    expect(decisions.length).toBeGreaterThan(0)
  })
})

/* ------------------------------------------------------------------ */
/* 3. Idempotencia e ordem                                             */
/* ------------------------------------------------------------------ */

describe('idempotencia da projecao', () => {
  it('REPLAY do mesmo evento nao duplica artigo nem recibo', async () => {
    const id = await seedArticle('replay')
    await moveTo(id, 'published')
    const { events } = await claim()
    const target = events.find((event) => event.eventId.startsWith(id))
    expect(target).toBeDefined()
    if (target === undefined) return

    const mapping = mapPublicationEvent(target.payload, target.emissionSequence)
    expect(mapping.ok).toBe(true)
    if (!mapping.ok) return

    const first = await applyProjectionEvent(screen.prisma as never, {
      event: mapping.event,
      contentVersion: target.contentVersion,
      workerId: WORKER,
    })
    expect(first.outcome).toBe('applied')

    // Exatamente o que acontece quando o worker cai entre o commit do
    // screen-db e o ack: o evento volta e e reprocessado.
    const second = await applyProjectionEvent(screen.prisma as never, {
      event: mapping.event,
      contentVersion: target.contentVersion,
      workerId: WORKER,
    })
    expect(second.outcome).toBe('skipped_duplicate')

    const articles = await screen.prisma.article.findMany({ where: { payloadDocumentId: id } })
    expect(articles).toHaveLength(1)
    const receipts = await screen.prisma.editorialProjectionReceipt.findMany({
      where: { eventId: target.eventId },
    })
    expect(receipts).toHaveLength(1)
  })

  it('evento FORA DE ORDEM nao reescreve o estado mais novo', async () => {
    const id = await seedArticle('fora-de-ordem')
    await moveTo(id, 'published')
    const { events } = await claim()
    const target = events.find((event) => event.eventId.startsWith(id))
    expect(target).toBeDefined()
    if (target === undefined) return

    const mapping = mapPublicationEvent(target.payload, target.emissionSequence)
    if (!mapping.ok) return
    await applyProjectionEvent(screen.prisma as never, {
      event: mapping.event,
      contentVersion: target.contentVersion,
      workerId: WORKER,
    })

    // Um retry antigo (mesma materia, emissao anterior, eventId diferente)
    // chegando depois. Sem a trava, ele reescreveria o presente com passado.
    const stale = await applyProjectionEvent(screen.prisma as never, {
      event: {
        ...mapping.event,
        eventId: `${target.eventId}-antigo`,
        emissionSequence: mapping.event.emissionSequence - 1,
        publishedContent:
          mapping.event.publishedContent === null
            ? null
            : { ...mapping.event.publishedContent, title: 'TITULO ANTIGO' },
      },
      contentVersion: 'sha256:antigo',
      workerId: WORKER,
    })
    expect(stale.outcome).toBe('skipped_stale')

    const article = await publicArticle(id)
    expect(article?.translations[0]?.title).not.toBe('TITULO ANTIGO')
  })
})

/* ------------------------------------------------------------------ */
/* 4. Concorrencia da fila                                             */
/* ------------------------------------------------------------------ */

describe('concorrencia de dois workers', () => {
  it('o MESMO evento nunca e entregue a dois workers', async () => {
    const id = await seedArticle('concorrencia')
    await moveTo(id, 'published')

    // Duas reclamacoes SIMULTANEAS. Sem o compare-and-swap por linha, as duas
    // veriam o mesmo `pending` e as duas o levariam.
    const [a, b] = await Promise.all([
      callOutbox('claim', { workerId: 'worker-a', batchSize: 10 }),
      callOutbox('claim', { workerId: 'worker-b', batchSize: 10 }),
    ])
    const idsA = ((a.json.events ?? []) as ClaimedEvent[]).map((event) => event.eventId)
    const idsB = ((b.json.events ?? []) as ClaimedEvent[]).map((event) => event.eventId)
    const overlap = idsA.filter((eventId) => idsB.includes(eventId))
    expect(overlap).toEqual([])
    expect(idsA.length + idsB.length).toBeGreaterThan(0)
  })

  it('lease de OUTRO worker nao pode ser confirmada', async () => {
    const id = await seedArticle('lease-alheia')
    await moveTo(id, 'published')
    const { events } = await claim()
    const target = events.find((event) => event.eventId.startsWith(id))
    expect(target).toBeDefined()
    if (target === undefined) return

    const roubo = await callOutbox('ack', {
      eventId: target.eventId,
      leaseToken: target.leaseToken,
      workerId: 'worker-intruso',
      projectionReceiptId: 'x',
      projectedAt: new Date().toISOString(),
    })
    expect(roubo.status).toBe(409)

    const tokenErrado = await callOutbox('ack', {
      eventId: target.eventId,
      leaseToken: 'token-inventado',
      workerId: WORKER,
      projectionReceiptId: 'x',
      projectedAt: new Date().toISOString(),
    })
    expect(tokenErrado.status).toBe(409)

    // Controle positivo: o portador legitimo confirma.
    const legitimo = await callOutbox('ack', {
      eventId: target.eventId,
      leaseToken: target.leaseToken,
      workerId: WORKER,
      projectionReceiptId: 'x',
      projectedAt: new Date().toISOString(),
    })
    expect(legitimo.status).toBe(200)

    // E repetir o ack de um evento ja processado e IDEMPOTENTE, nao erro.
    const repetido = await callOutbox('ack', {
      eventId: target.eventId,
      leaseToken: target.leaseToken,
      workerId: WORKER,
      projectionReceiptId: 'x',
      projectedAt: new Date().toISOString(),
    })
    expect(repetido.status).toBe(200)
    expect(repetido.json.outcome).toBe('already_processed')
  })
})

/* ------------------------------------------------------------------ */
/* 5. Falha, backoff e dead-letter                                     */
/* ------------------------------------------------------------------ */

describe('falha e dead-letter', () => {
  it('falha retentavel agenda nova tentativa com atraso', async () => {
    const id = await seedArticle('falha-retentavel')
    await moveTo(id, 'published')
    const { events } = await claim()
    const target = events.find((event) => event.eventId.startsWith(id))
    expect(target).toBeDefined()
    if (target === undefined) return

    const failed = await callOutbox('fail', {
      eventId: target.eventId,
      leaseToken: target.leaseToken,
      workerId: WORKER,
      errorCode: 'screen_db_unavailable',
      message: 'connect ECONNREFUSED postgresql://u:senha@host:5432/base',
      retryable: true,
      failedAt: new Date().toISOString(),
    })
    expect(failed.status).toBe(200)
    expect(failed.json.outcome).toBe('failed')
    expect(String(failed.json.availableAt ?? '')).not.toBe('')

    const row = await payload.find({
      collection: 'publication-outbox',
      where: { eventId: { equals: target.eventId } },
      limit: 1,
      overrideAccess: true,
    })
    const doc = row.docs[0] as Record<string, unknown> | undefined
    expect(doc?.status).toBe('failed')
    expect(doc?.errorCode).toBe('screen_db_unavailable')
    // A connection string NAO pode sobreviver no painel do CMS.
    expect(String(doc?.lastError ?? '')).not.toContain('senha')
    expect(String(doc?.lastError ?? '')).toContain('[redigido]')
    // Lease devolvida junto com a falha: o evento nao fica com dono morto.
    expect(doc?.leaseToken ?? null).toBeNull()
  })

  it('falha PERMANENTE vai direto para dead_letter, sem gastar tentativas', async () => {
    const id = await seedArticle('falha-permanente')
    await moveTo(id, 'published')
    const { events } = await claim()
    const target = events.find((event) => event.eventId.startsWith(id))
    expect(target).toBeDefined()
    if (target === undefined) return

    const failed = await callOutbox('fail', {
      eventId: target.eventId,
      leaseToken: target.leaseToken,
      workerId: WORKER,
      errorCode: 'contract_invalid',
      message: 'evento fora do contrato',
      retryable: false,
      failedAt: new Date().toISOString(),
    })
    expect(failed.json.outcome).toBe('dead_letter')

    // Dead-letter NAO volta para a fila.
    const next = await claim()
    expect(next.events.map((event) => event.eventId)).not.toContain(target.eventId)
  })
})

/* ------------------------------------------------------------------ */
/* 6. Ciclo de vida: retratacao                                        */
/* ------------------------------------------------------------------ */

describe('retratacao projetada', () => {
  it('retratar tira do indice mas NAO apaga a materia', async () => {
    const id = await seedArticle('retratada')
    await moveTo(id, 'published')
    await drain()

    const publicada = await publicArticle(id)
    expect(String(publicada?.translations[0]?.indexStatus)).toBe('index')
    const tituloOriginal = publicada?.translations[0]?.title

    await moveTo(id, 'retracted', { retractionReason: 'Fato nao confirmado pela fonte.' })
    await drain()

    const retratada = await publicArticle(id)
    const translation = retratada?.translations[0]
    expect(String(translation?.reviewStatus)).toBe('blocked')
    expect(String(translation?.indexStatus)).toBe('noindex')
    // O texto continua la, e o motivo fica registrado: retratacao e evidencia,
    // nao apagamento.
    expect(translation?.title).toBe(tituloOriginal)
    expect(translation?.correctionNote).toBe('Fato nao confirmado pela fonte.')
    expect(translation?.correctedAt).not.toBeNull()

    // E a materia sai da busca publica.
    const docs = await screen.prisma.searchDocument.findMany({
      where: { docKind: 'article', articleId: retratada?.id },
    })
    expect(docs).toHaveLength(0)
  })
})
