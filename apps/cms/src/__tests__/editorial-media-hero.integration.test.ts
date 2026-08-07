/**
 * editorial-media-hero.integration.test.ts —
 * `PATCH /api/internal/editorial-media/:mediaId/hero` contra Payload +
 * PostgreSQL 16 REAIS.
 *
 * POR QUE INTEGRACAO, E NAO SO O NUCLEO PURO. `hero-link.test.ts` cobre a
 * decisao. O que ele NAO consegue provar e exatamente o que fez o `setAsHero`
 * ser removido no PR #136 — porque aquele defeito nao estava na decisao, e sim
 * no que o Payload FAZ com a escrita:
 *
 *  1. o hook de governanca (`hooks/articles.ts`) acrescenta `workflowStatus` e
 *     `_status` ao payload de toda service account sem `editorial_auto_publish`.
 *     Que isso seja INOFENSIVO numa materia ja em `automation_draft` e uma
 *     afirmacao sobre o runtime, nao sobre a funcao pura;
 *  2. que a escrita NAO emita evento na outbox — `emitPublicationEvent` roda em
 *     `afterChange` e decide pelo par de estados, que nenhum teste puro executa;
 *  3. que nenhuma cota seja consumida — os contadores sao linhas de banco;
 *  4. que a materia que um humano promoveu a `ready_to_publish` continue la
 *     DEPOIS da recusa. E a assercao central deste arquivo: era este exato
 *     estado que o desenho anterior destruia em silencio, com `201` na resposta.
 *
 * O caminho testado e o REAL: rascunho pelo endpoint do MNScr -> foto pelo
 * endpoint de midia -> capa por esta rota. Nenhum artigo e criado a mao.
 */

import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'

import { validEditorialDraft } from '@screena/editorial-contracts'

import {
  apiKeyAuthorization,
  decodableJpegBytes,
  startCmsHarness,
  type CmsHarness,
} from './harness.js'

let harness: CmsHarness
let payload: Payload
let baseUrl = ''

let mediaKey = ''
let draftKey = ''
let chiefId = 0

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

async function makeServiceAccount(label: string, scopes: string[]): Promise<string> {
  const apiKey = randomUUID()
  await payload.create({
    collection: 'service-accounts',
    data: { label, purpose: 'mnscr', active: true, scopes, apiKey, enableAPIKey: true } as never,
    overrideAccess: true,
  })
  return apiKey
}

/**
 * O editor-chefe que representa a redacao.
 *
 * `overrideAccess: true` dispensa ACCESS CONTROL, mas NAO dispensa ator: o hook
 * de governanca recusa escrita anonima em `articles` — e essa recusa esta certa.
 */
async function chief(): Promise<never> {
  const doc = await payload.findByID({
    collection: 'editorial-users',
    id: chiefId,
    overrideAccess: true,
  })
  return { ...doc, collection: 'editorial-users' } as never
}

interface HttpResult {
  readonly status: number
  readonly body: Record<string, unknown>
}

async function request(
  method: string,
  path: string,
  apiKey: string | null,
  body?: unknown,
): Promise<HttpResult> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (apiKey !== null) headers.Authorization = apiKeyAuthorization('service-accounts', apiKey)
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const raw = await response.text()
  let parsed: Record<string, unknown> = {}
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    throw new Error(
      `resposta nao-JSON (status ${String(response.status)}): ${raw.slice(0, 300)}\n[servidor]\n${harness.serverLog().slice(-2000)}`,
    )
  }
  return { status: response.status, body: parsed }
}

function setHero(mediaId: string, articleId: string, apiKey: string | null): Promise<HttpResult> {
  return request('PATCH', `/api/internal/editorial-media/${mediaId}/hero`, apiKey, { articleId })
}

/** Cria a materia pelo caminho REAL do MNScr: ela nasce `automation_draft`. */
async function createAutomationDraft(): Promise<string> {
  const cluster = `hero-${randomUUID().slice(0, 8)}`
  const base = JSON.parse(JSON.stringify(validEditorialDraft)) as Record<string, unknown>
  const result = await request('POST', '/api/internal/editorial-drafts', draftKey, {
    ...base,
    draftId: `draft-${cluster}`,
    idempotencyKey: `${cluster}:rev-1`,
    sourceClusterId: cluster,
    sourceRevision: 1,
    slugProposal: `materia-${cluster}`,
    mediaCandidates: [],
    blocks: [{ type: 'paragraph', id: 'p1', text: 'Texto de abertura da materia de teste.' }],
  })
  if (result.status >= 300) {
    throw new Error(`draft recusado (${String(result.status)}): ${JSON.stringify(result.body)}`)
  }
  return String(result.body.articleId)
}

/** Ingere uma foto PARA aquela materia, pelo endpoint real. */
async function ingestMedia(articleId: string, salt: number): Promise<string> {
  const jpeg = await decodableJpegBytes(320, 200, salt)
  const result = await request('POST', '/api/internal/editorial-media', mediaKey, {
    articleId,
    sourceUrl: `https://exemplo.com/imprensa/${articleId}-${String(salt)}.jpg`,
    sourceName: 'Estudio Exemplo',
    rightsHolder: 'Estudio Exemplo',
    credit: 'Divulgacao/Estudio Exemplo',
    alt: 'Cena oficial do filme',
    contentType: 'image/jpeg',
    contentBase64: jpeg.toString('base64'),
  })
  if (result.status >= 300) {
    throw new Error(`ingestao recusada (${String(result.status)}): ${JSON.stringify(result.body)}`)
  }
  return String(result.body.mediaId)
}

/** `depth: 0` para `heroMedia` voltar como id, e nao como objeto populado. */
async function articleById(id: string): Promise<Record<string, unknown>> {
  return (await payload.findByID({
    collection: 'articles',
    id: Number(id),
    depth: 0,
    overrideAccess: true,
  })) as unknown as Record<string, unknown>
}

async function outboxCountFor(articleId: string): Promise<number> {
  const found = await payload.count({
    collection: 'publication-outbox',
    where: { aggregateId: { equals: articleId } },
    overrideAccess: true,
  })
  return found.totalDocs
}

async function quotaCounterTotal(): Promise<number> {
  const found = await payload.count({
    collection: 'autopublish-quota-counters',
    overrideAccess: true,
  })
  return found.totalDocs
}

async function versionCountFor(articleId: string): Promise<number> {
  const found = await payload.countVersions({
    collection: 'articles',
    where: { parent: { equals: Number(articleId) } },
    overrideAccess: true,
  })
  return found.totalDocs
}

/* ------------------------------------------------------------------ */
/* Setup                                                              */
/* ------------------------------------------------------------------ */

beforeAll(async () => {
  harness = await startCmsHarness()
  payload = harness.payload
  baseUrl = harness.baseUrl

  const editor = await payload.create({
    collection: 'editorial-users',
    data: {
      email: `chefe-${randomUUID().slice(0, 8)}@exemplo.test`,
      password: `senha-de-teste-${randomUUID()}`,
      displayName: 'Editor-chefe de teste',
      role: 'editor_in_chief',
      active: true,
    } as never,
    overrideAccess: true,
  })
  chiefId = Number(editor.id)

  mediaKey = await makeServiceAccount('mnscr — midia (capa)', ['editorial_media_ingest'])
  // A conta de TEXTO. Ela cria o rascunho e — o ponto — NAO aponta a capa.
  draftKey = await makeServiceAccount('mnscr — texto (capa)', ['draft_ingest'])
}, 600_000)

afterAll(async () => {
  await harness?.stop()
}, 180_000)

/* ------------------------------------------------------------------ */
/* 1. Escopo                                                          */
/* ------------------------------------------------------------------ */

describe('escopo: quem poe a foto no acervo e quem aponta a capa sao a mesma conta', () => {
  it('sem credencial: 401', async () => {
    const result = await setHero('1', '1', null)
    expect(result.status).toBe(401)
    expect(result.body).toMatchObject({ error: 'unauthenticated' })
  })

  it('conta com draft_ingest NAO aponta a capa: 403', async () => {
    // A separacao que o CMS ja testa na ingestao de bytes vale aqui inteira. Se
    // este caso virar verde com 200, a separacao existe so no comentario.
    const articleId = await createAutomationDraft()
    const mediaId = await ingestMedia(articleId, 11)

    const result = await setHero(mediaId, articleId, draftKey)
    expect(result.status).toBe(403)
    expect(result.body).toMatchObject({ error: 'forbidden_scope' })

    const doc = await articleById(articleId)
    expect(doc.heroMedia ?? null).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* 2. O caminho que o log de producao pedia                            */
/* ------------------------------------------------------------------ */

describe('a capa e apontada FORA do eixo de revisao', () => {
  let articleId = ''
  let mediaId = ''
  let quotaBefore = 0

  it('rascunho -> foto -> capa, em tres chamadas', async () => {
    // Este e o no que a rota desfaz: `editorial-media` exige `articleId`, que so
    // existe depois da materia; e `media[].mediaId` do contrato de publicacao
    // precisa existir no momento do envio. Em producao o log registrou
    // "mediaId=14 obtido para article_id=19, mas a capa NAO foi apontada".
    articleId = await createAutomationDraft()
    mediaId = await ingestMedia(articleId, 21)
    quotaBefore = await quotaCounterTotal()

    const result = await setHero(mediaId, articleId, mediaKey)
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({
      outcome: 'linked',
      articleId,
      mediaId,
      previousMediaId: null,
    })

    const doc = await articleById(articleId)
    expect(String(doc.heroMedia)).toBe(mediaId)
  })

  it('`workflowStatus` e `_status` NAO se mexeram', async () => {
    // O hook acrescenta os dois campos ao payload de toda service account sem
    // `editorial_auto_publish`. Como a materia ja esta em `automation_draft`, o
    // valor forcado E o valor gravado — nao existe degrau para descer.
    const doc = await articleById(articleId)
    expect(doc.workflowStatus).toBe('automation_draft')
    expect(doc._status).toBe('draft')
  })

  it('nenhum evento foi para a outbox', async () => {
    // Apontar capa nao e publicacao, correcao nem retratacao: o lado publico nao
    // tem nada a saber, e emitir aqui poluiria a fila.
    expect(await outboxCountFor(articleId)).toBe(0)
  })

  it('nenhuma cota foi consumida', async () => {
    // Gastar teto de `article_update` por causa de uma foto faria o pipeline
    // perder o dia da redacao.
    expect(await quotaCounterTotal()).toBe(quotaBefore)
  })

  it('reenviar o MESMO pedido devolve `unchanged` e NAO cria versao nova', async () => {
    const versionsBefore = await versionCountFor(articleId)

    const result = await setHero(mediaId, articleId, mediaKey)
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ outcome: 'unchanged', mediaId })

    // Nao e otimizacao: um pipeline que reenvia a cada revisao encheria o
    // historico da materia com versoes que nao mudaram nada.
    expect(await versionCountFor(articleId)).toBe(versionsBefore)
    expect(String((await articleById(articleId)).heroMedia)).toBe(mediaId)
  })

  it('a fonte trocou a foto: a capa acompanha o novo mediaId', async () => {
    const novoMediaId = await ingestMedia(articleId, 22)
    expect(novoMediaId).not.toBe(mediaId)

    const result = await setHero(novoMediaId, articleId, mediaKey)
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ outcome: 'replaced', previousMediaId: mediaId })
    expect(String((await articleById(articleId)).heroMedia)).toBe(novoMediaId)

    const doc = await articleById(articleId)
    expect(doc.workflowStatus).toBe('automation_draft')
  })
})

/* ------------------------------------------------------------------ */
/* 3. A regressao do PR #136                                           */
/* ------------------------------------------------------------------ */

describe('materia tocada por humano nao tem capa trocada por robo', () => {
  it('materia em `ready_to_publish` recusa a capa E CONTINUA em ready_to_publish', async () => {
    // ESTE E O TESTE CENTRAL DO ARQUIVO.
    //
    // O `setAsHero` removido no PR #136 escrevia primeiro e descobria depois.
    // Aqui a recusa acontece ANTES de qualquer escrita, e a prova nao e o status
    // HTTP: e o estado da materia DEPOIS da recusa.
    //
    // CONTROLE NEGATIVO EXECUTADO (removendo a guarda de `hero-link.ts`): a
    // escrita e tentada, o hook a recusa e a rota devolve `500` opaco. Ou seja,
    // hoje o rebaixamento nao acontece — o que a guarda entrega e o MOTIVO no
    // lugar do `500`, e uma garantia que nao depende do hook continuar negando.
    const articleId = await createAutomationDraft()
    const mediaId = await ingestMedia(articleId, 31)

    await payload.update({
      collection: 'articles',
      id: Number(articleId),
      data: { workflowStatus: 'ready_to_publish' } as never,
      overrideAccess: true,
      user: await chief(),
    })
    expect((await articleById(articleId)).workflowStatus).toBe('ready_to_publish')

    const result = await setHero(mediaId, articleId, mediaKey)
    expect(result.status).toBe(409)
    expect(result.body).toMatchObject({ error: 'article_not_automation_draft' })

    const doc = await articleById(articleId)
    expect(doc.workflowStatus).toBe('ready_to_publish')
    expect(doc.heroMedia ?? null).toBeNull()
  })

  it('capa escolhida por gente sobrevive ao pedido da maquina', async () => {
    const articleId = await createAutomationDraft()
    const mediaId = await ingestMedia(articleId, 41)

    // O humano escolhe a capa no painel: um item do acervo que NAO veio da
    // ingestao por maquina.
    const humanMedia = await payload.create({
      collection: 'media',
      data: {
        alt: 'Foto escolhida por uma pessoa',
        credit: 'Divulgacao',
        sourceName: 'Estudio',
        rightsHolder: 'Estudio',
        licenseStatus: 'approved',
        requiresAttribution: true,
        allowedForEditorial: true,
        allowedForHero: true,
        provenanceType: 'external_source',
      } as never,
      file: {
        data: await decodableJpegBytes(200, 150, 42),
        mimetype: 'image/jpeg',
        name: `humana-${randomUUID().slice(0, 8)}.jpg`,
        size: (await decodableJpegBytes(200, 150, 42)).length,
      },
      overrideAccess: true,
      user: await chief(),
    })

    await payload.update({
      collection: 'articles',
      id: Number(articleId),
      data: { heroMedia: Number(humanMedia.id) } as never,
      overrideAccess: true,
      user: await chief(),
    })

    const result = await setHero(mediaId, articleId, mediaKey)
    expect(result.status).toBe(409)
    expect(result.body).toMatchObject({ error: 'hero_not_owned_by_automation' })
    expect(String((await articleById(articleId)).heroMedia)).toBe(String(humanMedia.id))
  })
})

/* ------------------------------------------------------------------ */
/* 4. Pertencimento e recusas nomeadas                                 */
/* ------------------------------------------------------------------ */

describe('recusas que chegam ao EMISSOR', () => {
  it('foto ingerida para OUTRA materia: 409 dizendo para qual', async () => {
    // Sem esta guarda o `mediaId` seria escrita arbitraria: bastaria enumerar
    // ids para pendurar qualquer imagem do acervo em qualquer materia.
    const alvo = await createAutomationDraft()
    const outra = await createAutomationDraft()
    const mediaDaOutra = await ingestMedia(outra, 51)

    const result = await setHero(mediaDaOutra, alvo, mediaKey)
    expect(result.status).toBe(409)
    expect(result.body).toMatchObject({ error: 'media_not_ingested_for_article' })
    expect(JSON.stringify(result.body.issues)).toContain(outra)

    expect((await articleById(alvo)).heroMedia ?? null).toBeNull()
  })

  it('midia inexistente: 404, sem erro de driver', async () => {
    const articleId = await createAutomationDraft()
    const result = await setHero('999999', articleId, mediaKey)
    expect(result.status).toBe(404)
    expect(result.body).toMatchObject({ error: 'media_not_found' })
  })

  it('materia inexistente: 404', async () => {
    const articleId = await createAutomationDraft()
    const mediaId = await ingestMedia(articleId, 61)
    const result = await setHero(mediaId, '999999', mediaKey)
    expect(result.status).toBe(404)
    expect(result.body).toMatchObject({ error: 'article_not_found' })
  })

  it('id nao numerico e recusado com 422, nunca com erro de banco', async () => {
    const result = await request('PATCH', '/api/internal/editorial-media/abc/hero', mediaKey, {
      articleId: '1',
    })
    expect(result.status).toBe(422)
    expect(result.body).toMatchObject({ error: 'validation_failed' })
  })

  it('corpo sem articleId: 422 com o campo nomeado', async () => {
    const articleId = await createAutomationDraft()
    const mediaId = await ingestMedia(articleId, 71)
    const result = await request(
      'PATCH',
      `/api/internal/editorial-media/${mediaId}/hero`,
      mediaKey,
      {},
    )
    expect(result.status).toBe(422)
    expect(JSON.stringify(result.body.issues)).toContain('articleId ausente')
  })

  it('licenca revogada no painel barra a capa (invariante 6)', async () => {
    const articleId = await createAutomationDraft()
    const mediaId = await ingestMedia(articleId, 81)

    await payload.update({
      collection: 'media',
      id: Number(mediaId),
      data: { allowedForHero: false } as never,
      overrideAccess: true,
      user: await chief(),
    })

    const result = await setHero(mediaId, articleId, mediaKey)
    expect(result.status).toBe(409)
    expect(result.body).toMatchObject({ error: 'media_not_hero_eligible' })
    expect((await articleById(articleId)).heroMedia ?? null).toBeNull()
  })
})
