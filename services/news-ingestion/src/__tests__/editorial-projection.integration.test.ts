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

import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'

import {
  decodableJpegBytes as jpegBytes,
  decodablePngBytes as pngBytes,
  startCmsHarness,
  type CmsHarness,
} from '@cms-harness'

import { mapPublicationEvent } from '../editorial-event-mapper.js'
import { applyProjectionEvent } from '../persistence/editorial-projection-store.js'
import { startScreenDbHarness, type ScreenDbHarness } from './screen-db-harness.js'
import { createLocalMediaStorage } from '../media/local-storage.js'
import { planEventMedia } from '../media/media-plan.js'
import { projectEventMedia, MediaPipelineError } from '../media/media-pipeline.js'
import type { MediaStoragePort } from '../media/storage-port.js'

let cms: CmsHarness
let screen: ScreenDbHarness
let payload: Payload
let baseUrl = ''

const ids = { chief: 0, author: 0 }
let projectionKey = ''
let ingestKey = ''

const WORKER = 'worker-integracao'

let storageRoot = ''
let storage: MediaStoragePort
const mediaIdsByLabel: Record<string, number> = {}

/** Id de uma midia semeada. Lanca se o rotulo nao existir: um `undefined` aqui
 * viraria um teste que passa sem exercitar nada. */
function mediaId(label: string): number {
  const found = mediaIdsByLabel[label]
  if (found === undefined) throw new Error(`fixture de midia ausente: ${label}`)
  return found
}

/* ------------------------------------------------------------------ */
/* Bytes de imagem REAIS (cabecalho valido, nao nome de arquivo)       */
/* ------------------------------------------------------------------ */

// As duas funcoes abaixo vinham montadas a mao aqui e produziam arquivos com
// cabecalho valido porem INDECODIFICAVEIS — o JPEG sem SOS e sem varredura, o
// PNG so com IHDR. Isso bastava enquanto a coleccao `media` nao gerava
// miniatura; com `imageSizes`, o sharp precisa decodificar e recusa os dois ja
// no `metadata()`. A geracao real vive no harness do CMS, que e a ponte unica
// deste pacote para `apps/cms` e o unico lado onde `sharp` e dependencia
// declarada.

function sha256(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

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
async function seedArticle(suffix: string, extra: Record<string, unknown> = {}) {
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
      ...extra,
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

/** Tenta publicar e devolve o motivo da recusa, se houver. */
async function tryMoveTo(id: string, status: string): Promise<string | null> {
  try {
    await payload.update({
      collection: 'articles',
      id,
      data: { workflowStatus: status } as never,
      overrideAccess: false,
      user: await userDoc(ids.chief),
    })
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'erro desconhecido'
  }
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

    // MESMA ORDEM DO WORKER REAL: midia antes da transacao.
    const plan = planEventMedia(mapping.event)
    const projected =
      plan.requests.length === 0
        ? { assets: new Map(), warnings: [] }
        : await projectEventMedia(
            {
              fetch: {
                baseUrl,
                authorization: auth(projectionKey),
                requestTimeoutMs: 20_000,
                maxBytes: 15 * 1024 * 1024,
              },
              storage,
            },
            plan.requests,
          )

    const result = await applyProjectionEvent(screen.prisma as never, {
      event: mapping.event,
      contentVersion: event.contentVersion,
      workerId: WORKER,
      media: projected.assets as never,
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

/** Vinculos de entidade de uma materia, em forma comparavel. */
async function entityLinks(payloadDocumentId: string): Promise<string[]> {
  const article = await publicArticle(payloadDocumentId)
  if (article === null) return []
  const links = await screen.prisma.entityNewsLink.findMany({
    where: { articleId: article.id },
    orderBy: { id: 'asc' },
    select: { entityType: true, entityId: true },
  })
  return links.map((link) => `${String(link.entityType)}:${link.entityId.toString()}`)
}

/**
 * Filme REAL no catalogo publico (com slug canonico e titulo pt-BR).
 *
 * A linha em `entities` nasce por TRIGGER do `movies` (migration
 * `20260715120000_data_governance_hardening`) — nao e criada aqui de proposito:
 * se o trigger regredir, o vinculo passa a abortar a transacao e este teste
 * precisa ser quem descobre.
 */
async function seedCatalogMovie(opts: {
  tmdbId: number
  titleOriginal: string
  slug: string
}): Promise<string> {
  const movie = await screen.prisma.movie.create({
    data: {
      tmdbId: opts.tmdbId,
      titleOriginal: opts.titleOriginal,
      releaseDate: new Date('2025-07-11T00:00:00.000Z'),
      posterPath: '/poster-superman.jpg',
    },
    select: { id: true },
  })
  await screen.prisma.slug.create({
    data: {
      entityType: 'movie',
      entityId: movie.id,
      languageCode: 'pt-BR',
      slug: opts.slug,
      isCanonical: true,
    },
  })
  await screen.prisma.entityTranslation.create({
    data: {
      entityType: 'movie',
      entityId: movie.id,
      languageCode: 'pt-BR',
      title: opts.titleOriginal,
      summary: 'Resumo pt-BR do catalogo.',
    },
  })
  return movie.id.toString()
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

  // Storage LOCAL temporario. Arquivo real em disco real — o teste confere o
  // filesystem, nao um dublê em memoria.
  storageRoot = mkdtempSync(path.join(tmpdir(), 'cinerie-media-it-'))
  storage = createLocalMediaStorage({
    driver: 'local',
    root: storageRoot,
    publicBasePath: '/media',
  })

  const makeMedia = async (
    label: string,
    data: Buffer,
    mimetype: string,
    fields: Record<string, unknown>,
  ) => {
    const created = await payload.create({
      collection: 'media',
      data: {
        alt: `alt ${label}`,
        caption: `legenda ${label}`,
        credit: 'Divulgacao',
        licenseStatus: 'approved',
        requiresAttribution: false,
        allowedForEditorial: true,
        allowedForHero: true,
        allowedForSocial: false,
        provenanceType: 'cinerie_editorial',
        ...fields,
      } as never,
      overrideAccess: true,
      file: {
        data,
        mimetype,
        name: `${label}-${randomUUID()}.${mimetype === 'image/png' ? 'png' : 'jpg'}`,
        size: data.byteLength,
      },
    })
    mediaIdsByLabel[label] = Number(created.id)
  }

  await makeMedia('hero-jpeg', await jpegBytes(1200, 630, 1), 'image/jpeg', {})
  await makeMedia('hero-png', await pngBytes(1200, 630), 'image/png', {})
  await makeMedia('corpo', await jpegBytes(800, 600, 2), 'image/jpeg', {})
  await makeMedia('licenca-unknown', await jpegBytes(400, 300, 3), 'image/jpeg', {
    licenseStatus: 'unknown',
  })
  await makeMedia('licenca-pending', await jpegBytes(400, 300, 4), 'image/jpeg', {
    licenseStatus: 'pending',
  })
  await makeMedia('licenca-prohibited', await jpegBytes(400, 300, 5), 'image/jpeg', {
    licenseStatus: 'prohibited',
  })
  await makeMedia('licenca-vencida', await jpegBytes(400, 300, 6), 'image/jpeg', {
    licenseExpiresAt: '2020-01-01T00:00:00.000Z',
  })
  await makeMedia('sem-hero', await jpegBytes(400, 300, 7), 'image/jpeg', { allowedForHero: false })
  await makeMedia('sem-credito', await jpegBytes(400, 300, 8), 'image/jpeg', {
    requiresAttribution: true,
    credit: '',
  })
}, 900_000)

afterAll(async () => {
  // SEQUENCIAL. Derrubar os dois PostgreSQL ao mesmo tempo no Windows e a mesma
  // disputa de I/O que obriga a SUBIR os dois em serie.
  //
  // Isto NAO foi o que causou o "Connection terminated unexpectedly" que
  // aparecia aqui — essa era o pool do Payload sobrevivendo ao banco, e o
  // conserto esta em `apps/cms/src/__tests__/harness.ts`. Serializar continua
  // valendo por si, mas nao e o remedio daquele sintoma.
  //
  // `allSettled` com UM item por vez preserva a garantia original: falhar ao
  // parar o primeiro nao impede parar o segundo.
  await Promise.allSettled([cms?.stop()])
  await Promise.allSettled([screen?.stop()])
  // Teardown nao deixa arquivo para tras.
  if (storageRoot !== '') rmSync(storageRoot, { recursive: true, force: true })
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

/* ------------------------------------------------------------------ */
/* 7. MIDIA EDITORIAL GOVERNADA (FASE 2D)                              */
/* ------------------------------------------------------------------ */

const FETCH_DEPS = () => ({
  fetch: {
    baseUrl,
    authorization: auth(projectionKey),
    requestTimeoutMs: 20_000,
    maxBytes: 15 * 1024 * 1024,
  },
  storage,
})

/** Busca UM asset pelo endpoint interno, como o worker faria. */
async function fetchAsset(mediaId: number, purpose: 'hero' | 'editorial' | 'social' = 'hero') {
  return projectEventMedia(FETCH_DEPS(), [
    { mediaId: String(mediaId), purpose, usage: 'hero' as const, required: true },
  ])
}

async function mediaResponse(mediaId: string, purpose: string, key = projectionKey) {
  return fetch(
    `${baseUrl}/api/internal/publication-media/${encodeURIComponent(mediaId)}?purpose=${purpose}`,
    { headers: { Authorization: auth(key) } },
  )
}

describe('endpoint interno de midia: autorizacao', () => {
  it('sem credencial nao entrega bytes', async () => {
    const response = await fetch(
      `${baseUrl}/api/internal/publication-media/${String(mediaId('hero-jpeg'))}?purpose=hero`,
    )
    expect(response.status).toBe(401)
  })

  it('chave de INGESTAO nao busca midia de publicacao', async () => {
    const response = await mediaResponse(String(mediaId('hero-jpeg')), 'hero', ingestKey)
    expect(response.status).toBe(403)
  })

  it('entrega midia aprovada com metadados VERIFICAVEIS em header', async () => {
    const response = await mediaResponse(String(mediaId('hero-jpeg')), 'hero')
    // O corpo entra na mensagem de falha: um 404 sem motivo obriga a instrumentar
    // o endpoint a mao para descobrir se foi licenca, arquivo ou identidade.
    const diagnostic = response.ok ? '' : await response.clone().text()
    expect(response.status, diagnostic).toBe(200)
    const bytes = Buffer.from(await response.arrayBuffer())
    expect(bytes.byteLength).toBeGreaterThan(0)
    // O hash prometido bate com os bytes recebidos: e o que permite ao worker
    // detectar corpo alterado sem depender so do TLS.
    expect(response.headers.get('x-cinerie-media-content-hash')).toBe(sha256(bytes))
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    expect(decodeURIComponent(response.headers.get('x-cinerie-media-credit') ?? '')).toBe(
      'Divulgacao',
    )
  })

  it('licenca unknown, pending, prohibited e vencida sao recusadas', async () => {
    for (const label of [
      'licenca-unknown',
      'licenca-pending',
      'licenca-prohibited',
      'licenca-vencida',
    ]) {
      const response = await mediaResponse(String(mediaId(label)), 'hero')
      expect(response.status, label).toBe(403)
      const body = (await response.json()) as { code?: string }
      expect(['license_not_approved', 'license_expired'], label).toContain(body.code)
    }
  })

  it('allowedForHero false recusa como HERO mas serve como editorial', async () => {
    expect((await mediaResponse(String(mediaId('sem-hero')), 'hero')).status).toBe(403)
    // Controle positivo: a mesma midia continua servindo no corpo.
    expect((await mediaResponse(String(mediaId('sem-hero')), 'editorial')).status).toBe(200)
  })

  it('atribuicao obrigatoria sem credito e recusada (invariante 6)', async () => {
    const response = await mediaResponse(String(mediaId('sem-credito')), 'hero')
    expect(response.status).toBe(403)
    expect(((await response.json()) as { code?: string }).code).toBe('attribution_missing')
  })

  it('mediaId inexistente ou malformado nao vaza erro de banco', async () => {
    for (const bad of ['999999', 'nao-e-id', '../../etc/passwd']) {
      const response = await mediaResponse(bad, 'hero')
      expect([403, 404], bad).toContain(response.status)
      const body = JSON.stringify(await response.json()).toLowerCase()
      expect(body).not.toContain('prisma')
      expect(body).not.toContain('postgres')
      expect(body).not.toContain('select ')
    }
  })

  it('finalidade desconhecida e recusada', async () => {
    expect((await mediaResponse(String(mediaId('hero-jpeg')), 'qualquer')).status).toBe(400)
  })
})

describe('projecao de midia: hero', () => {
  it('hero JPEG aprovado vira arquivo real e caminho publico LOCAL', async () => {
    const id = await seedArticle('capa-jpeg', { heroMedia: mediaId('hero-jpeg') })
    await moveTo(id, 'published')
    await drain()

    const article = await publicArticle(id)
    const heroPath = article?.heroImagePath ?? ''
    expect(heroPath).toMatch(/^\/media\/editorial\/[0-9a-f]{2}\/[0-9a-f]{64}\.jpg$/)
    // A REGRA DA FASE: nunca URL. O normalizador do apps/web recusa http(s).
    expect(heroPath).not.toMatch(/^https?:/)

    // O arquivo existe MESMO no storage, com os bytes certos.
    const key = heroPath.replace('/media/', '')
    expect(await storage.exists(key)).toBe(true)
    const stored = await storage.read(key)
    expect(stored).not.toBeNull()
    const expectedHash = key.split('/').pop()?.split('.')[0] ?? ''
    expect(sha256(Buffer.from(stored ?? []))).toBe(`sha256:${expectedHash}`)

    // E o asset carrega a proveniencia que um caminho de string perderia.
    const asset = await screen.prisma.editorialMediaAsset.findUnique({
      where: { payloadMediaId: String(mediaId('hero-jpeg')) },
    })
    expect(asset?.mimeType).toBe('image/jpeg')
    expect(asset?.width).toBe(1200)
    expect(asset?.height).toBe(630)
    expect(asset?.credit).toBe('Divulgacao')
    expect(asset?.alt).toBe('alt hero-jpeg')
    expect(String(asset?.licenseStatus)).toBe('approved')
    expect(article?.heroMediaAssetId).toBe(asset?.id)
  })

  it('hero PNG aprovado tambem e projetado, com a extensao do MIME REAL', async () => {
    const id = await seedArticle('capa-png', { heroMedia: mediaId('hero-png') })
    await moveTo(id, 'published')
    await drain()
    const article = await publicArticle(id)
    expect(article?.heroImagePath ?? '').toMatch(/\.png$/)
  })

  it('artigo SEM midia continua sendo publicado', async () => {
    const id = await seedArticle('sem-capa')
    await moveTo(id, 'published')
    const { outcomes } = await drain()
    expect(outcomes).toContain('applied')
    const article = await publicArticle(id)
    expect(article?.heroImagePath).toBeNull()
    expect(article?.heroMediaAssetId).toBeNull()
  })

  it('capa com licenca proibida e recusada JA NO CMS — nao chega ao worker', async () => {
    // Melhor recusar onde ha um humano olhando do que deixar publicar no CMS e
    // morrer no worker, com a redacao vendo um artigo "publicado" que nunca
    // aparece no site.
    const id = await seedArticle('capa-proibida', { heroMedia: mediaId('licenca-prohibited') })
    const failure = await tryMoveTo(id, 'published')
    expect(failure ?? '').toContain('unauthorized_media')
    expect(await publicArticle(id)).toBeNull()
  })

  it('capa sem permissao de HERO tambem e recusada na publicacao', async () => {
    const id = await seedArticle('capa-sem-hero', { heroMedia: mediaId('sem-hero') })
    const failure = await tryMoveTo(id, 'published')
    expect(failure ?? '').toContain('unauthorized_media')
  })

  it('falha de licenca e PERMANENTE — nao gasta tentativa a toa', async () => {
    await expect(fetchAsset(mediaId('licenca-vencida'))).rejects.toSatisfy(
      (error: unknown) => error instanceof MediaPipelineError && error.retryable === false,
    )
  })
})

describe('projecao de midia: idempotencia', () => {
  it('o MESMO asset em duas materias nao duplica arquivo nem linha', async () => {
    const id = await seedArticle('capa-reuso', { heroMedia: mediaId('hero-jpeg') })
    await moveTo(id, 'published')
    await drain()
    const rows = await screen.prisma.editorialMediaAsset.count({
      where: { payloadMediaId: String(mediaId('hero-jpeg')) },
    })
    expect(rows).toBe(1)
  })

  it('reprojetar apos o storage ja ter o arquivo REAPROVEITA, nao regrava', async () => {
    // Simula o retry depois de gravar o arquivo e antes do commit: a chave e
    // derivada do conteudo, entao "ja existe" implica "identico".
    const first = await fetchAsset(mediaId('corpo'), 'editorial')
    const asset = first.assets.get(String(mediaId('corpo')))
    expect(asset).toBeDefined()
    const second = await fetchAsset(mediaId('corpo'), 'editorial')
    const again = second.assets.get(String(mediaId('corpo')))
    expect(again?.reused).toBe(true)
    expect(again?.storageKey).toBe(asset?.storageKey)
  })
})

describe('projecao de midia: blocos do corpo', () => {
  it('bloco de imagem recebe caminho publico e perde o id interno do CMS', async () => {
    const id = await seedArticle('corpo-com-imagem', {
      body: [
        {
          blockType: 'paragraph',
          blockId: 'p1',
          text: 'Corpo editorial proprio da Cinerie antes da imagem.',
        },
        {
          blockType: 'image',
          blockId: 'img1',
          media: mediaId('corpo'),
          alt: 'alt do bloco',
          caption: 'legenda do bloco',
        },
      ],
    })
    await moveTo(id, 'published')
    await drain()

    const article = await publicArticle(id)
    const blocks = (article?.translations[0]?.bodyBlocks ?? []) as Record<string, unknown>[]
    const image = blocks.find((block) => block.type === 'image')
    expect(image).toBeDefined()
    expect(String(image?.publicPath ?? '')).toMatch(/^\/media\/editorial\//)
    // O id do CMS nao serve para nada no render e e vazamento de identificador.
    expect(image?.mediaRef).toBeUndefined()
    // Ordem, id e texto do bloco preservados.
    expect(blocks.map((block) => block.id)).toEqual(['p1', 'img1'])
    expect(image?.alt).toBe('alt do bloco')
    expect(image?.caption).toBe('legenda do bloco')
  })

  it('bloco do CORPO com midia proibida e recusado na publicacao', async () => {
    // Lacuna fechada nesta fase: o gate contava capa e galeria, mas nao a midia
    // referenciada dentro dos blocos.
    const id = await seedArticle('corpo-proibido', {
      body: [
        { blockType: 'paragraph', blockId: 'p1', text: 'Corpo editorial proprio para o teste.' },
        { blockType: 'image', blockId: 'img1', media: mediaId('licenca-prohibited'), alt: 'proibida' },
      ],
    })
    const failure = await tryMoveTo(id, 'published')
    expect(failure ?? '').toContain('unauthorized_media')
    expect(await publicArticle(id)).toBeNull()
  })

  it('pipeline recusa midia proibida mesmo se o gate for contornado', async () => {
    // Defesa em profundidade: se um evento chegar por outro caminho (replay de
    // fila antiga, fixture), a projecao ainda falha fechada.
    await expect(
      projectEventMedia(FETCH_DEPS(), [
        {
          mediaId: String(mediaId('licenca-prohibited')),
          purpose: 'editorial' as const,
          usage: { blockId: 'img1' },
          required: true,
        },
      ]),
    ).rejects.toBeInstanceOf(MediaPipelineError)
  })
})

/* ------------------------------------------------------------------ */
/* 8. VINCULO COM O CATALOGO (`entity_news_links`)                     */
/* ------------------------------------------------------------------ */

describe('vinculo entidade <-> materia', () => {
  it('entidade movie VERIFICADA vira exatamente UM vinculo', async () => {
    const movieId = await seedCatalogMovie({
      tmdbId: 1_061_474,
      titleOriginal: 'Superman',
      slug: 'superman',
    })
    const id = await seedArticle('com-entidade', {
      entityReferences: [
        { entityKind: 'movie', entityId: movieId, relation: 'primary_subject', verified: true },
      ],
    })
    await moveTo(id, 'published')
    const { outcomes } = await drain()
    expect(outcomes).toContain('applied')

    expect(await entityLinks(id)).toEqual([`movie:${movieId}`])
  })

  it('entidade NAO verificada nao atravessa (o CMS ja a barra)', async () => {
    const movieId = await seedCatalogMovie({
      tmdbId: 1_061_475,
      titleOriginal: 'Nao Verificado',
      slug: 'nao-verificado',
    })
    const id = await seedArticle('entidade-nao-verificada', {
      entityReferences: [
        { entityKind: 'movie', entityId: movieId, relation: 'mentioned', verified: false },
      ],
    })
    await moveTo(id, 'published')
    await drain()
    expect(await entityLinks(id)).toEqual([])
  })

  it('tipo NAO suportado nao vira vinculo e a materia continua publicada', async () => {
    // `franchise` e relacao editorial legitima no CMS, mas nao existe como
    // `EntityType` no banco publico: gravar abortaria a transacao no enum.
    const id = await seedArticle('entidade-franquia', {
      entityReferences: [
        { entityKind: 'franchise', entityId: '999', relation: 'mentioned', verified: true },
      ],
    })
    await moveTo(id, 'published')
    const { outcomes } = await drain()
    expect(outcomes).toContain('applied')
    expect(await publicArticle(id)).not.toBeNull()
    expect(await entityLinks(id)).toEqual([])
  })

  it('entidade INEXISTENTE no catalogo nao cria vinculo falso — nem derruba a materia', async () => {
    // O caminho que a FK composta (entity_type, entity_id) -> entities tornaria
    // fatal: sem a verificacao previa, a transacao inteira abortaria e levaria
    // junto artigo, traducao e recibo.
    const id = await seedArticle('entidade-fantasma', {
      entityReferences: [
        { entityKind: 'movie', entityId: '987654321', relation: 'primary_subject', verified: true },
      ],
    })
    await moveTo(id, 'published')
    const { outcomes } = await drain()
    expect(outcomes).toContain('applied')

    const article = await publicArticle(id)
    expect(article).not.toBeNull()
    expect(String(article?.translations[0]?.indexStatus)).toBe('index')
    expect(await entityLinks(id)).toEqual([])
  })

  it('REPROCESSAR o mesmo evento nao duplica o vinculo', async () => {
    const movieId = await seedCatalogMovie({
      tmdbId: 1_061_476,
      titleOriginal: 'Reprocessado',
      slug: 'reprocessado',
    })
    const id = await seedArticle('vinculo-replay', {
      entityReferences: [
        { entityKind: 'movie', entityId: movieId, relation: 'primary_subject', verified: true },
      ],
    })
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
    expect(await entityLinks(id)).toEqual([`movie:${movieId}`])

    // Mesmo evento de novo (worker morreu entre o commit e o ack).
    const second = await applyProjectionEvent(screen.prisma as never, {
      event: mapping.event,
      contentVersion: target.contentVersion,
      workerId: WORKER,
    })
    expect(second.outcome).toBe('skipped_duplicate')
    expect(await entityLinks(id)).toEqual([`movie:${movieId}`])

    // E um evento NOVO com o mesmo conjunto (edicao que nao mexeu nas
    // entidades) tambem nao duplica: a unique + reconciliacao seguram.
    const reedicao = await applyProjectionEvent(screen.prisma as never, {
      event: {
        ...mapping.event,
        eventId: `${target.eventId}-reedicao`,
        emissionSequence: mapping.event.emissionSequence + 1,
      },
      contentVersion: `${target.contentVersion}-2`,
      workerId: WORKER,
    })
    expect(reedicao.outcome).toBe('applied')
    expect(await entityLinks(id)).toEqual([`movie:${movieId}`])
  })

  it('entidade REMOVIDA pelo editor sai das relacionadas na reprojecao', async () => {
    // So inserir deixaria a materia citada para sempre numa ficha da qual ela
    // foi retirada. O evento carrega o conjunto autoritativo, entao reconcilia.
    const movieId = await seedCatalogMovie({
      tmdbId: 1_061_477,
      titleOriginal: 'Removido',
      slug: 'removido',
    })
    const id = await seedArticle('vinculo-removido', {
      entityReferences: [
        { entityKind: 'movie', entityId: movieId, relation: 'primary_subject', verified: true },
      ],
    })
    await moveTo(id, 'published')
    await drain()
    expect(await entityLinks(id)).toEqual([`movie:${movieId}`])

    // O editor desmarca a entidade e republica pelo caminho real de edicao:
    // `published -> needs_update -> ready_to_publish -> published` (a allowlist
    // de transicao nao permite atalho).
    await moveTo(id, 'needs_update')
    await payload.update({
      collection: 'articles',
      id,
      data: { entityReferences: [] } as never,
      overrideAccess: true,
      user: await userDoc(ids.chief),
    })
    await moveTo(id, 'ready_to_publish')
    await moveTo(id, 'published')
    await drain()

    expect(await entityLinks(id)).toEqual([])
  })

  it('retratacao NAO apaga os vinculos — o gate e o indexStatus', async () => {
    const movieId = await seedCatalogMovie({
      tmdbId: 1_061_478,
      titleOriginal: 'Retratado',
      slug: 'retratado',
    })
    const id = await seedArticle('vinculo-retratado', {
      entityReferences: [
        { entityKind: 'movie', entityId: movieId, relation: 'primary_subject', verified: true },
      ],
    })
    await moveTo(id, 'published')
    await drain()

    await moveTo(id, 'retracted', { retractionReason: 'Fato nao confirmado.' })
    await drain()

    const article = await publicArticle(id)
    expect(String(article?.translations[0]?.indexStatus)).toBe('noindex')
    // O vinculo sobrevive, como o texto: se a materia voltar apos revisao
    // humana, a citacao volta com ela. O que a tira das relacionadas do filme e
    // o `indexStatus`, filtrado na LEITURA (`related-news.ts`).
    expect(await entityLinks(id)).toEqual([`movie:${movieId}`])
  })
})

/* ------------------------------------------------------------------ */
/* 9. CORPO ESTRUTURADO (blocos que so existem em `body_blocks`)        */
/* ------------------------------------------------------------------ */

describe('corpo estruturado projetado', () => {
  it('os blocos do contrato chegam ao banco publico com id, ordem e tipo', async () => {
    const movieId = await seedCatalogMovie({
      tmdbId: 1_061_479,
      titleOriginal: 'Corpo Estruturado',
      slug: 'corpo-estruturado',
    })
    const id = await seedArticle('corpo-rico', {
      entityReferences: [
        { entityKind: 'movie', entityId: movieId, relation: 'primary_subject', verified: true },
      ],
      body: [
        { blockType: 'paragraph', blockId: 'p1', text: 'Abertura editorial propria da Cinerie.' },
        { blockType: 'heading', blockId: 'h1', level: '2', text: 'O que se sabe' },
        { blockType: 'quote', blockId: 'q1', text: 'Uma frase atribuida.', attribution: 'James Gunn' },
        {
          blockType: 'entityCard',
          blockId: 'ec1',
          entityKind: 'movie',
          entityId: movieId,
          note: 'Nota do editor sobre o filme.',
        },
        {
          blockType: 'factBox',
          blockId: 'fb1',
          title: 'Ficha tecnica',
          items: [{ label: 'Diretor', value: 'James Gunn' }],
        },
        { blockType: 'sourceList', blockId: 'sl1', sourceRefs: ['s1'] },
        { blockType: 'divider', blockId: 'dv1' },
      ],
    })
    await moveTo(id, 'published')
    const { outcomes } = await drain()
    expect(outcomes).toContain('applied')

    const article = await publicArticle(id)
    const blocks = (article?.translations[0]?.bodyBlocks ?? []) as Record<string, unknown>[]
    expect(blocks.map((block) => block.id)).toEqual(['p1', 'h1', 'q1', 'ec1', 'fb1', 'sl1', 'dv1'])
    expect(blocks.map((block) => block.type)).toEqual([
      'paragraph',
      'heading',
      'quote',
      'entityCard',
      'factBox',
      'sourceList',
      'divider',
    ])
    // Blocos e versao andam juntos (CHECK do banco).
    expect(article?.translations[0]?.bodyBlocksVersion ?? '').not.toBe('')
  })

  it('bloco sourceList chega RESOLVIDO (nome + url), sem o id interno do CMS', async () => {
    const id = await seedArticle('corpo-fontes', {
      body: [
        { blockType: 'paragraph', blockId: 'p1', text: 'Corpo editorial proprio para o teste.' },
        { blockType: 'sourceList', blockId: 'sl1', sourceRefs: ['s1'] },
      ],
    })
    await moveTo(id, 'published')
    await drain()

    const article = await publicArticle(id)
    const blocks = (article?.translations[0]?.bodyBlocks ?? []) as Record<string, unknown>[]
    const sourceList = blocks.find((block) => block.type === 'sourceList')
    expect(sourceList).toBeDefined()
    // `seedArticle` declara a fonte `s1` = Variety.
    expect(sourceList?.sources).toEqual([{ name: 'Variety', url: 'https://variety.com/x' }])
    // Id interno do CMS nao serve ao render e e vazamento de identificador.
    expect(sourceList?.sourceRefs).toBeUndefined()
  })

  it('ref de fonte que nao existe e DESCARTADA, nunca substituida por outra', async () => {
    const id = await seedArticle('corpo-fonte-fantasma', {
      body: [
        { blockType: 'paragraph', blockId: 'p1', text: 'Corpo editorial proprio para o teste.' },
        { blockType: 'sourceList', blockId: 'sl1', sourceRefs: ['nao-existe'] },
      ],
    })
    await moveTo(id, 'published')
    await drain()

    const article = await publicArticle(id)
    const blocks = (article?.translations[0]?.bodyBlocks ?? []) as Record<string, unknown>[]
    const sourceList = blocks.find((block) => block.type === 'sourceList')
    // Creditar a fonte errada e pior do que nao creditar.
    expect(sourceList?.sources).toEqual([])
  })
})

describe('nenhuma URL http chega ao banco publico', () => {
  it('nem em hero_image_path, nem em public_path de asset', async () => {
    const articles = await screen.prisma.article.findMany({
      where: { heroImagePath: { not: null } },
      select: { heroImagePath: true },
    })
    expect(articles.length).toBeGreaterThan(0)
    for (const article of articles) {
      expect(article.heroImagePath ?? '').toMatch(/^\//)
      expect(article.heroImagePath ?? '').not.toMatch(/^https?:/)
    }
    const assets = await screen.prisma.editorialMediaAsset.findMany({
      select: { publicPath: true, storageKey: true },
    })
    expect(assets.length).toBeGreaterThan(0)
    for (const asset of assets) {
      expect(asset.publicPath).not.toMatch(/^https?:/)
      expect(asset.storageKey).not.toContain('..')
    }
  })
})
