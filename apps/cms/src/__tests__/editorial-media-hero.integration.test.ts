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
 *
 * O QUE ESTE ARQUIVO NAO ALCANCAVA, e que deixou passar o defeito medido em
 * producao (materia 23, midia 18, `409 article_not_automation_draft`): ele so
 * chegava a materia por `/internal/editorial-drafts`, que a DEIXA em
 * `automation_draft`. O caminho que produz a materia em producao e
 * `/internal/editorial-publications`, que cria em `automation_draft` e caminha
 * ate `needs_review` ou `published` na MESMA chamada, ANTES de devolver o
 * `articleId`. Os dois intakes agora estao aqui, e o segundo e o que prova a
 * correcao.
 */

import { randomUUID } from 'node:crypto'

// O endpoint de autopublicacao le estas envs no PROCESSO DO SERVIDOR, que o
// harness sobe por `spawn` herdando o ambiente. Sem o kill switch ligado todo
// pedido sai como `ROUTED_TO_REVIEW`, e o desfecho `published` — o que de fato
// quebrou em producao — nunca seria exercido.
process.env.EDITORIAL_AUTO_PUBLISH_ENABLED = 'true'
process.env.EDITORIAL_AUTO_PUBLISH_DAILY_LIMIT = '80'
process.env.EDITORIAL_AUTO_PUBLISH_PER_AUTHOR_LIMIT = '40'
process.env.EDITORIAL_AUTO_PUBLISH_PER_SECTION_LIMIT = '80'
process.env.EDITORIAL_AUTO_PUBLISH_PER_CONTENT_TYPE_LIMIT = '80'
process.env.EDITORIAL_AUTO_PUBLISH_PER_ARTICLE_UPDATE_LIMIT = '5'
process.env.EDITORIAL_AUTO_PUBLISH_TIME_ZONE = 'America/Sao_Paulo'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'

import { validEditorialDraft, validPublicationRequest } from '@screena/editorial-contracts'

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
let publisherKey = ''
let chiefId = 0
let authorId = ''

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

/**
 * Cria a materia pelo OUTRO caminho real: o de autopublicacao.
 *
 * E este que produz o estado de producao. `qaPassed: false` desvia para
 * `ROUTED_TO_REVIEW` (202, materia em `needs_review`); `true` publica (201,
 * materia em `published`). Nos DOIS a materia ja saiu de `automation_draft`
 * quando o `articleId` chega ao emissor.
 */
async function createViaPublications(qaPassed: boolean): Promise<string> {
  const id = randomUUID()
  const base = JSON.parse(JSON.stringify(validPublicationRequest)) as Record<string, unknown>
  // `qa.passed=false` sem `blockingErrors` e recusado pelo CONTRATO ("exige ao
  // menos um blockingError declarado"), antes de qualquer decisao editorial.
  const qa = {
    ...(base.qa as Record<string, unknown>),
    passed: qaPassed,
    ...(qaPassed ? {} : { blockingErrors: ['revisao humana pedida pelo teste'] }),
  }
  const result = await request('POST', '/api/internal/editorial-publications', publisherKey, {
    ...base,
    // A fixture aponta para `media-9001`, que nao existe neste banco — e midia
    // nao verificavel bloqueia a publicacao, com razao. A capa deste arquivo
    // entra pela rota que ele testa, nao pelo contrato.
    media: [],
    requestId: `req-${id}`,
    idempotencyKey: `idem-${id}`,
    sourceClusterId: `cluster-${id.slice(0, 8)}`,
    publicAuthorId: authorId,
    qa,
    seo: {
      ...(base.seo as Record<string, unknown>),
      imageAltSuggestions: [],
      slugSuggestion: `materia-pub-${id.slice(0, 8)}`,
    },
  })
  const articleId = result.body.articleId
  if (typeof articleId !== 'string' || articleId === '') {
    throw new Error(
      `publicacao nao devolveu articleId (${String(result.status)}): ${JSON.stringify(result.body)}`,
    )
  }
  return articleId
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
  // A conta que PUBLICA. E o caminho de producao, e o que o arquivo nao cobria.
  publisherKey = await makeServiceAccount('mnscr — publicacao (capa)', ['editorial_auto_publish'])

  const author = await payload.create({
    collection: 'authors',
    data: {
      name: 'Redacao Cinerie (capa)',
      slug: `redacao-capa-${randomUUID().slice(0, 6)}`,
      active: true,
      automationPublishingAllowed: true,
      allowedAutomationContentTypes: ['news'],
      allowedAutomationSections: ['Series'],
      automationAttributionModes: ['newsroom'],
    } as never,
    overrideAccess: true,
  })
  authorId = String(author.id)
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
  it('a materia promovida a `ready_to_publish` recebe a capa E CONTINUA em ready_to_publish', async () => {
    // ESTE E O TESTE CENTRAL DO ARQUIVO, e ele mudou de sentido com a correcao.
    //
    // Antes ele media a RECUSA por estado. Aquela recusa era o defeito: no
    // caminho real a materia NUNCA esta em `automation_draft` quando o emissor
    // recebe o `articleId`, e a rota inteira ficava inalcancavel.
    //
    // O que continua sendo o invariante do PR #136 e o que ele media de fato: o
    // ESTADO NAO SE MEXE. O `setAsHero` removido naquele PR rebaixava a materia
    // a `automation_draft` e devolvia sucesso. Aqui a escrita acontece e o
    // estado promovido pelo humano sobrevive byte a byte.
    const articleId = await createAutomationDraft()
    const mediaId = await ingestMedia(articleId, 31)

    await payload.update({
      collection: 'articles',
      id: Number(articleId),
      data: { workflowStatus: 'ready_to_publish' } as never,
      overrideAccess: true,
      user: await chief(),
    })
    const before = await articleById(articleId)
    expect(before.workflowStatus).toBe('ready_to_publish')

    const result = await setHero(mediaId, articleId, mediaKey)
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ outcome: 'linked' })

    const doc = await articleById(articleId)
    expect(doc.workflowStatus).toBe('ready_to_publish')
    expect(doc._status).toBe(before._status)
    expect(String(doc.heroMedia)).toBe(mediaId)
  })

  it('materia ESCRITA POR GENTE recusa a capa da maquina, mesmo sem capa nenhuma', async () => {
    // A proveniencia que substituiu a trava de estado, medida no unico lugar em
    // que ela pode ser medida: uma materia sem NENHUMA marca de automacao.
    // Sem esta recusa, bastaria ingerir uma foto "para" uma pauta humana para
    // pendurar a capa nela.
    const humanArticle = await payload.create({
      collection: 'articles',
      data: {
        title: 'Materia escrita por uma pessoa',
        slug: `humana-${randomUUID().slice(0, 8)}`,
        language: 'pt-BR',
        contentType: 'news',
        workflowStatus: 'draft',
      } as never,
      overrideAccess: true,
      user: await chief(),
    })
    const articleId = String(humanArticle.id)
    const mediaId = await ingestMedia(articleId, 33)

    const result = await setHero(mediaId, articleId, mediaKey)
    expect(result.status).toBe(409)
    expect(result.body).toMatchObject({ error: 'article_not_automation_origin' })
    expect((await articleById(articleId)).heroMedia ?? null).toBeNull()
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
/* 3b. O DEFEITO MEDIDO EM PRODUCAO: o caminho de autopublicacao       */
/* ------------------------------------------------------------------ */

describe('a capa alcanca a materia que o MNScr acabou de enviar por editorial-publications', () => {
  it('desfecho 202 (`needs_review`): a capa entra, e o estado nao se mexe', async () => {
    // Producao registrou `409 article_not_automation_draft` aqui. O motivo esta
    // no proprio endpoint: ele cria em `automation_draft` e caminha por
    // `['needs_review']` ANTES de a resposta com o `articleId` sair.
    const articleId = await createViaPublications(false)
    const antes = await articleById(articleId)
    expect(antes.workflowStatus).toBe('needs_review')

    const mediaId = await ingestMedia(articleId, 91)
    const outboxBefore = await outboxCountFor(articleId)
    const quotaBefore = await quotaCounterTotal()

    const result = await setHero(mediaId, articleId, mediaKey)
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ outcome: 'linked', articleId, mediaId })

    const depois = await articleById(articleId)
    expect(String(depois.heroMedia)).toBe(mediaId)
    expect(depois.workflowStatus).toBe('needs_review')
    expect(depois._status).toBe(antes._status)

    // Materia nao publica nao anuncia nada ao lado publico.
    expect(await outboxCountFor(articleId)).toBe(outboxBefore)
    // Apontar capa nao e `article_update`: gastar teto aqui faria o pipeline
    // perder o dia da redacao por causa de uma foto.
    expect(await quotaCounterTotal()).toBe(quotaBefore)
  })

  it('desfecho 201 (`published`): a capa entra, a materia continua publicada', async () => {
    const articleId = await createViaPublications(true)
    const antes = await articleById(articleId)
    expect(antes.workflowStatus).toBe('published')
    expect(antes._status).toBe('published')

    const mediaId = await ingestMedia(articleId, 92)
    const quotaBefore = await quotaCounterTotal()

    const result = await setHero(mediaId, articleId, mediaKey)
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ outcome: 'linked' })

    const depois = await articleById(articleId)
    expect(String(depois.heroMedia)).toBe(mediaId)
    // O invariante do PR #136, no estado mais sensivel que existe: uma materia
    // PUBLICA nao pode ser rebaixada a rascunho por causa de uma foto.
    expect(depois.workflowStatus).toBe('published')
    expect(depois._status).toBe('published')
    expect(await quotaCounterTotal()).toBe(quotaBefore)
  })

  it('a capa da materia PUBLICA chega ao lado publico por `article.updated`', async () => {
    // A UNICA propriedade do desenho original que esta correcao nao preserva, e
    // ela nao poderia preservar: a materia ja esta no ar. Sem evento, a capa
    // ficaria so no CMS e a pagina publica continuaria sem foto — que e a
    // mesma falha silenciosa que a rota existe para fechar.
    //
    // O evento nao e emitido por esta rota: quem emite e `emitPublicationEvent`,
    // pela regra que ja valia para qualquer edicao de materia publicada. Em
    // materia nao publicada ele continua devolvendo `null` (caso acima).
    const articleId = await createViaPublications(true)
    const mediaId = await ingestMedia(articleId, 93)
    const antes = await outboxCountFor(articleId)

    await setHero(mediaId, articleId, mediaKey)

    const eventos = await payload.find({
      collection: 'publication-outbox',
      where: { aggregateId: { equals: articleId } },
      limit: 20,
      depth: 0,
      overrideAccess: true,
    })
    expect(eventos.totalDocs).toBe(antes + 1)
    expect(eventos.docs.map((doc) => String((doc as { eventType: unknown }).eventType))).toContain(
      'article.updated',
    )
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
