/**
 * manual-editorial.integration.test.ts — FASE 2G.
 *
 * O caminho EDITORIAL HUMANO ponta a ponta, contra Next + Payload + PostgreSQL
 * 16 reais. A pergunta que esta suite responde e uma so:
 *
 *   O CMS publica uma materia escrita a mao SEM nenhum campo, credencial,
 *   variavel ou endpoint do MNScr?
 *
 * Nada aqui envia `requestId`, `idempotencyKey`, `sourceClusterId`,
 * `sourceRevision`, `sourcePayloadHash`, `schemaHash`, `pipelineVersion`, chave
 * de API do MNScr ou conta `editorial_auto_publish`. Se algum desses fosse
 * exigido em silencio, a publicacao manual falharia aqui.
 *
 * Escrita HUMANA vai por HTTP REAL com sessao de usuario (JWT emitido pelo
 * proprio login do Payload) — o mesmo caminho do painel `/admin`. A Local API
 * aparece so para montar fixtures (usuarios, autor, midia) e para INSPECIONAR o
 * banco nas asercoes; ela nunca substitui a requisicao sob teste.
 */

import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'

import {
  apiKeyAuthorization,
  decodableJpegBytes,
  startCmsHarness,
  type CmsHarness,
} from './harness.js'

let harness: CmsHarness
let payload: Payload
let baseUrl = ''

const ids = {
  admin: 0,
  chief: 0,
  editor: 0,
  reviewer: 0,
  writer: 0,
  newsroomAuthor: 0,
  bylineAuthor: 0,
  mediaApproved: 0,
  mediaProhibited: 0,
}

/** Sessao HTTP por papel. Chave = papel, valor = JWT do login real. */
const tokens: Record<string, string> = {}
let ingestKey = ''

/* ------------------------------------------------------------------ */
/* Campos EXCLUSIVOS da automacao — nenhum e enviado por esta suite    */
/* ------------------------------------------------------------------ */

/**
 * Colunas que so a autopublicacao/ingestao preenche. Toda materia manual desta
 * suite tem que sair com TODAS elas vazias — essa e a prova de independencia,
 * e ela e verificada no banco, nao na resposta HTTP.
 */
const MNSCR_ONLY_FIELDS = [
  'automationActorId',
  'automationActorLabel',
  'automationReceivedAt',
  'automationIdempotencyKey',
  'automationSourceRevision',
  'automationPayloadHash',
  'automationPipelineVersion',
  'automationContractVersion',
  'automationContractName',
  'automationSchemaHash',
  'automationAttributionMode',
  'automationDraftId',
  'idempotencyKey',
  'sourceClusterId',
  'sourceRevision',
  'sourcePayloadHash',
  'draftPayloadHash',
  'pipelineVersion',
] as const

function expectNoAutomationTrace(article: Record<string, unknown>): void {
  // `autoPublished` e o indicador EXPLICITO, e ele precisa ser `false` — nao
  // `null`. "Nao sei" nao e resposta para "isso foi publicado por robo?".
  expect(article.autoPublished).toBe(false)
  const dirty = MNSCR_ONLY_FIELDS.filter((field) => {
    const value = article[field]
    return value !== null && value !== undefined && value !== '' &&
      !(Array.isArray(value) && value.length === 0)
  })
  expect(dirty).toEqual([])
  expect(article.automationScopesUsed ?? []).toEqual([])
}

/* ------------------------------------------------------------------ */
/* Helpers de HTTP com sessao HUMANA                                   */
/* ------------------------------------------------------------------ */

async function asRole(role: keyof typeof tokens, path: string, init: RequestInit = {}) {
  const token = tokens[role]
  if (token === undefined || token === '') throw new Error(`sem sessao para o papel ${role}`)
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      Authorization: `JWT ${token}`,
      ...(init.headers ?? {}),
    },
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

/** `POST /api/articles` — criacao pela REST API, como o painel faz. */
async function createArticle(role: string, data: Record<string, unknown>) {
  return asRole(role, '/api/articles', { method: 'POST', body: JSON.stringify(data) })
}

/** `PATCH /api/articles/:id` — atualizacao pela REST API, como o painel faz. */
async function patchArticle(role: string, id: string, data: Record<string, unknown>) {
  return asRole(role, `/api/articles/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
}

/** Le o documento REAL do banco. Asercao nunca confia no eco da resposta. */
async function articleById(id: string): Promise<Record<string, unknown>> {
  const doc = await payload.findByID({
    collection: 'articles',
    id,
    depth: 0,
    overrideAccess: true,
  })
  return doc as unknown as Record<string, unknown>
}

async function outboxRows(articleId: string) {
  const found = await payload.find({
    collection: 'publication-outbox',
    where: { aggregateId: { equals: articleId } },
    limit: 100,
    sort: 'createdAt',
    overrideAccess: true,
  })
  return found.docs as unknown as Record<string, unknown>[]
}

/* ------------------------------------------------------------------ */
/* Corpo editorial REAL — todos os tipos de bloco governados           */
/* ------------------------------------------------------------------ */

/**
 * Corpo com TODOS os tipos de bloco que uma materia de redacao usa, em ordem
 * definida.
 *
 * O vocabulario e o do CMS, nao o de um editor de texto: nao existe bloco de
 * "lista" nem link inline, porque nao existe rich text — o corpo e uma lista de
 * blocos TIPADOS, e a ausencia de HTML livre e a defesa contra injecao. Os
 * equivalentes governados sao `factBox` (itens rotulo/valor), `sourceList`
 * (referencias de fonte) e `divider` (separador).
 */
function editorialBody(mediaId: number): Record<string, unknown>[] {
  return [
    { blockType: 'paragraph', blockId: 'p-1', text: 'Abertura escrita por uma pessoa da redacao.' },
    { blockType: 'heading', blockId: 'h-1', level: '2', text: 'O que se sabe ate agora' },
    { blockType: 'paragraph', blockId: 'p-2', text: 'Desenvolvimento com contexto proprio.' },
    {
      blockType: 'factBox',
      blockId: 'f-1',
      title: 'Ficha rapida',
      items: [
        { label: 'Estreia', value: '12 de agosto' },
        { label: 'Episodios', value: '8' },
      ],
    },
    { blockType: 'quote', blockId: 'q-1', text: 'Uma citacao curta e atribuida.', attribution: 'Fonte declarada' },
    { blockType: 'image', blockId: 'i-1', media: mediaId, alt: 'Cena de divulgacao', caption: 'Legenda', credit: 'Divulgacao' },
    { blockType: 'divider', blockId: 'd-1' },
    { blockType: 'sourceList', blockId: 's-1', sourceRefs: ['s-1'] },
    { blockType: 'paragraph', blockId: 'p-3', text: 'Fechamento com o proximo passo.' },
  ]
}

/** Sinais de SEO que o CMS aprova. Estrutura (canonical/robots/JSON-LD) NAO. */
function seoSignals(): Record<string, unknown> {
  return {
    metaTitle: 'Titulo de busca escrito pela redacao',
    metaDescription: 'Descricao curta, propria, sem copiar sinopse de terceiro.',
    focusKeyphrase: 'estreia da temporada',
    relatedKeyphrases: ['data de estreia', 'onde assistir'],
    editorialKeywords: ['serie', 'estreia'],
    articleSection: 'Series',
    schemaTypeRecommendation: 'NewsArticle',
    socialTitle: 'Titulo social',
    socialDescription: 'Descricao social',
  }
}

/**
 * Materia manual COMPLETA em `draft`, criada por HTTP com sessao humana.
 *
 * Repare no que NAO esta aqui: nenhum campo do MNScr, nenhum `publicAuthorId`
 * vindo de variavel de ambiente, nenhuma chave de idempotencia. So o que uma
 * pessoa digita.
 */
async function createManualDraft(
  role: string,
  suffix: string,
  overrides: Record<string, unknown> = {},
) {
  const result = await createArticle(role, {
    title: `Materia manual ${suffix}`,
    subtitle: 'Linha de apoio',
    slug: `materia-manual-${suffix}`,
    summary: 'Resumo editorial proprio da Cinerie, escrito por uma pessoa.',
    language: 'pt-BR',
    contentType: 'news',
    workflowStatus: 'draft',
    body: editorialBody(ids.mediaApproved),
    heroMedia: ids.mediaApproved,
    authors: [ids.newsroomAuthor],
    primaryAuthor: ids.newsroomAuthor,
    section: 'series',
    aiAssisted: false,
    qaPassedAt: new Date().toISOString(),
    externalSources: [
      { sourceId: 's-1', name: 'Variety', url: 'https://variety.com/exemplo', role: 'primary' },
    ],
    ...seoSignals(),
    ...overrides,
  })
  if (result.status !== 201) {
    throw new Error(`criacao manual falhou (${String(result.status)}): ${result.text.slice(0, 600)}`)
  }
  const doc = (result.json.doc ?? {}) as { id?: unknown }
  return String(doc.id)
}

/** Percorre as transicoes humanas de `draft` ate `ready_to_publish`. */
async function advanceToReady(role: string, id: string): Promise<void> {
  for (const status of ['needs_review', 'in_review', 'human_reviewed', 'ready_to_publish']) {
    const step = await patchArticle(role, id, { workflowStatus: status })
    if (step.status !== 200) {
      throw new Error(`transicao ${status} falhou (${String(step.status)}): ${step.text.slice(0, 400)}`)
    }
  }
}

/* ------------------------------------------------------------------ */
/* Setup                                                              */
/* ------------------------------------------------------------------ */

beforeAll(async () => {
  harness = await startCmsHarness()
  payload = harness.payload
  baseUrl = harness.baseUrl

  const password = (role: string) => `senha-de-teste-${role}-0123456789`

  const makeUser = async (role: string, key: keyof typeof ids) => {
    const created = await payload.create({
      collection: 'editorial-users',
      data: {
        email: `${role}.2g@cinerie.test`,
        password: password(role),
        displayName: `${role} 2G`,
        role,
        active: true,
      } as never,
      overrideAccess: true,
    })
    ids[key] = Number(created.id)

    // Sessao REAL: o mesmo login que o painel `/admin` usa.
    const login = await fetch(`${baseUrl}/api/editorial-users/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `${role}.2g@cinerie.test`, password: password(role) }),
    })
    const text = await login.text()
    let body: { token?: string } = {}
    try {
      body = JSON.parse(text) as { token?: string }
    } catch {
      throw new Error(
        `login de ${role} nao devolveu JSON (${String(login.status)}): ${text.slice(0, 200)}
[servidor]
${harness.serverLog().slice(-2000)}`,
      )
    }
    const token = String(body.token ?? '')
    if (token === '') throw new Error(`login de ${role} sem token: ${text.slice(0, 200)}`)
    tokens[role] = token
  }

  await makeUser('administrator', 'admin')
  await makeUser('editor_in_chief', 'chief')
  await makeUser('editor', 'editor')
  await makeUser('reviewer', 'reviewer')
  await makeUser('writer', 'writer')

  // DOIS autores publicos. A distincao entre "quem operou o CMS" e "quem
  // assina a materia" so pode ser provada com mais de uma assinatura possivel.
  const newsroom = await payload.create({
    collection: 'authors',
    data: { name: 'Redacao Cinerie', slug: 'redacao-cinerie', active: true, isOrganization: true } as never,
    overrideAccess: true,
  })
  ids.newsroomAuthor = Number(newsroom.id)

  const byline = await payload.create({
    collection: 'authors',
    data: { name: 'Marina Prado', slug: 'marina-prado', active: true, isOrganization: false } as never,
    overrideAccess: true,
  })
  ids.bylineAuthor = Number(byline.id)

  /*
   * Midia REAL — DECODIFICAVEL, nao apenas com cabecalho valido.
   *
   * Antes era um JPEG montado a mao com SOI + JFIF + SOF0 + EOI e NENHUM
   * segmento de scan. Passava na checagem de cabecalho do Payload e nunca
   * precisava ser decodificado, entao servia.
   *
   * Deixou de servir quando `media.upload` ganhou `imageSizes`: gerar a
   * miniatura obriga o sharp a DECODIFICAR os bytes, e ele recusa ja no
   * `metadata()` — corretamente, porque aquilo nao era uma imagem.
   *
   * A geracao vive no harness porque QUATRO superficies sobem midia (esta
   * suite, o `global-setup` do E2E, a projecao editorial do news-ingestion e o
   * canario de `apps/web`), e as outras tres quebravam pelo mesmo motivo.
   * Corrigir so aqui deixaria as outras para a proxima volta de CI.
   */
  const jpeg = await decodableJpegBytes(1200, 630)

  const makeMedia = async (label: string, fields: Record<string, unknown>) => {
    const created = await payload.create({
      collection: 'media',
      data: {
        alt: `alt ${label}`,
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
      file: { data: jpeg, mimetype: 'image/jpeg', name: `${label}-${randomUUID()}.jpg`, size: jpeg.byteLength },
    })
    return Number(created.id)
  }

  ids.mediaApproved = await makeMedia('aprovada', {})
  ids.mediaProhibited = await makeMedia('proibida', {
    licenseStatus: 'prohibited',
    allowedForEditorial: false,
    allowedForHero: false,
  })

  // Conta tecnica de INGESTAO — existe so para provar que ela NAO alcanca o
  // fluxo humano. Nenhuma conta `editorial_auto_publish` e criada nesta suite.
  ingestKey = randomUUID()
  await payload.create({
    collection: 'service-accounts',
    data: {
      apiKey: ingestKey,
      label: 'ingestao-2g',
      purpose: 'mnscr',
      active: true,
      scopes: ['draft_ingest'],
    } as never,
    overrideAccess: true,
  })
}, 600_000)

afterAll(async () => {
  await harness?.stop()
}, 180_000)

/* ------------------------------------------------------------------ */
/* 1. Publicacao manual sem NENHUM campo do MNScr                      */
/* ------------------------------------------------------------------ */

describe('publicacao manual sem MNScr', () => {
  it('administrador escreve, revisa e publica SOZINHO, e o rastro fica completo', async () => {
    const id = await createManualDraft('administrator', `solo-${randomUUID().slice(0, 8)}`)

    const afterCreate = await articleById(id)
    expect(afterCreate.workflowStatus).toBe('draft')
    expect(String(afterCreate.createdBy)).toBe(String(ids.admin))
    expect(String(afterCreate.updatedBy)).toBe(String(ids.admin))
    // Antes de publicar nao ha quem publicou.
    expect(afterCreate.publishedBy ?? null).toBeNull()
    expectNoAutomationTrace(afterCreate)

    await advanceToReady('administrator', id)
    const publish = await patchArticle('administrator', id, { workflowStatus: 'published' })
    expect(publish.status, publish.text.slice(0, 600)).toBe(200)

    const published = await articleById(id)
    expect(published.workflowStatus).toBe('published')
    expect(published._status).toBe('published')
    // Publicacao SOLO: o mesmo humano criou, revisou e publicou. Cada transicao
    // foi executada e auditada; nenhuma foi pulada e nenhuma revisao inventada.
    expect(String(published.createdBy)).toBe(String(ids.admin))
    expect(String(published.publishedBy)).toBe(String(ids.admin))
    expect(typeof published.publishedAt).toBe('string')
    expectNoAutomationTrace(published)

    // O evento nasceu — o lado publico sera avisado.
    const events = await outboxRows(id)
    expect(events.map((row) => row.eventType)).toEqual(['article.published'])
  })

  it('editor-chefe tambem publica sozinho', async () => {
    const id = await createManualDraft('editor_in_chief', `chefe-${randomUUID().slice(0, 8)}`)
    await advanceToReady('editor_in_chief', id)
    expect((await patchArticle('editor_in_chief', id, { workflowStatus: 'published' })).status).toBe(200)
    const doc = await articleById(id)
    expect(doc.workflowStatus).toBe('published')
    expect(String(doc.publishedBy)).toBe(String(ids.chief))
    expectNoAutomationTrace(doc)
  })

  it('o corpo editorial sobrevive a salvar, reabrir e publicar', async () => {
    const id = await createManualDraft('administrator', `corpo-${randomUUID().slice(0, 8)}`)

    // "Reabrir": leitura pelo MESMO caminho do painel, nao pelo eco do POST.
    const reopened = await asRole('administrator', `/api/articles/${id}?depth=0`)
    expect(reopened.status).toBe(200)
    const reopenedBody = ((reopened.json as { body?: unknown[] }).body ?? []) as Record<string, unknown>[]
    expect(reopenedBody.length).toBe(9)

    await advanceToReady('administrator', id)
    await patchArticle('administrator', id, { workflowStatus: 'published' })

    const doc = await articleById(id)
    const body = (doc.body ?? []) as Record<string, unknown>[]
    // ORDEM preservada, tipo e id de bloco preservados.
    expect(body.map((block) => block.blockType)).toEqual([
      'paragraph', 'heading', 'paragraph', 'factBox', 'quote', 'image', 'divider', 'sourceList', 'paragraph',
    ])
    expect(body.map((block) => block.blockId)).toEqual([
      'p-1', 'h-1', 'p-2', 'f-1', 'q-1', 'i-1', 'd-1', 's-1', 'p-3',
    ])
    expect(body[0]?.text).toBe('Abertura escrita por uma pessoa da redacao.')
    // Nenhum campo `blocks` fantasma: o corpo mora em `body`.
    expect(doc.blocks).toBeUndefined()
    // Nada de HTML ou script no texto — o corpo e uma lista de blocos tipados.
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain('<script')
    expect(serialized).not.toContain('javascript:')
  })

  it('os SINAIS de SEO chegam ao banco; a ESTRUTURA nao e pedida ao CMS', async () => {
    const id = await createManualDraft('administrator', `seo-${randomUUID().slice(0, 8)}`)
    await advanceToReady('administrator', id)
    await patchArticle('administrator', id, { workflowStatus: 'published' })

    const doc = await articleById(id)
    expect(doc.metaTitle).toBe('Titulo de busca escrito pela redacao')
    expect(doc.focusKeyphrase).toBe('estreia da temporada')
    expect(doc.relatedKeyphrases).toEqual(['data de estreia', 'onde assistir'])
    expect(doc.editorialKeywords).toEqual(['serie', 'estreia'])
    expect(doc.articleSection).toBe('Series')
    expect(doc.schemaTypeRecommendation).toBe('NewsArticle')

    // O CMS NAO guarda robots, JSON-LD, publisher, datePublished derivado,
    // sitemap nem News Sitemap: essas sao estrutura, e estrutura e derivada no
    // lado publico. Duas fontes discordando sobre a mesma URL e o defeito que
    // esta fronteira existe para impedir.
    for (const absent of [
      'robots', 'jsonLd', 'publisher', 'dateModified', 'sitemap', 'newsSitemap', 'structuredData',
    ]) {
      expect(doc[absent]).toBeUndefined()
    }
  })
})

/* ------------------------------------------------------------------ */
/* 2. Rastro humano: createdBy / updatedBy / publishedBy               */
/* ------------------------------------------------------------------ */

describe('rastro humano de autoria', () => {
  it('createdBy nao muda; updatedBy segue o ULTIMO humano; publishedBy marca a transicao', async () => {
    const id = await createManualDraft('writer', `rastro-${randomUUID().slice(0, 8)}`)
    expect(String((await articleById(id)).createdBy)).toBe(String(ids.writer))

    // Outro humano edita: `createdBy` fica, `updatedBy` muda.
    expect((await patchArticle('editor', id, { subtitle: 'Revisto pelo editor' })).status).toBe(200)
    const edited = await articleById(id)
    expect(String(edited.createdBy)).toBe(String(ids.writer))
    expect(String(edited.updatedBy)).toBe(String(ids.editor))

    await advanceToReady('editor', id)
    // Quem publica e um TERCEIRO humano.
    expect((await patchArticle('editor_in_chief', id, { workflowStatus: 'published' })).status).toBe(200)
    const published = await articleById(id)
    expect(String(published.createdBy)).toBe(String(ids.writer))
    expect(String(published.publishedBy)).toBe(String(ids.chief))

    // Edicao POSTERIOR na materia publicada nao reescreve quem publicou. E o
    // ponto exato do campo: quando uma materia sai errada, a pergunta e quem
    // apertou o botao — nao quem corrigiu a virgula depois.
    expect((await patchArticle('administrator', id, { correctionNote: 'ajuste de virgula' })).status).toBe(200)
    const corrected = await articleById(id)
    expect(String(corrected.publishedBy)).toBe(String(ids.chief))
    expect(String(corrected.updatedBy)).toBe(String(ids.admin))
    expect(String(corrected.createdBy)).toBe(String(ids.writer))
  })

  it('o rastro NUNCA vem do corpo da requisicao', async () => {
    // Um cliente que pudesse enviar `publishedBy` escolheria quem assina a
    // decisao — e a auditoria apontaria para a pessoa errada exatamente no caso
    // em que ela importa.
    const id = await createManualDraft('writer', `forjado-${randomUUID().slice(0, 8)}`, {
      createdBy: ids.admin,
      updatedBy: ids.admin,
      publishedBy: ids.admin,
    })
    const doc = await articleById(id)
    expect(String(doc.createdBy)).toBe(String(ids.writer))
    expect(String(doc.updatedBy)).toBe(String(ids.writer))
    expect(doc.publishedBy ?? null).toBeNull()

    // E nem no update.
    await patchArticle('editor', id, { publishedBy: ids.admin, createdBy: ids.admin })
    const after = await articleById(id)
    expect(String(after.createdBy)).toBe(String(ids.writer))
    expect(after.publishedBy ?? null).toBeNull()
  })

  it('humano NAO consegue se declarar automacao', async () => {
    // `admin.readOnly` protege o formulario; a REST API aceitaria o campo. Sem
    // a lista de proibicao, um `PATCH` faria uma materia escrita a mao afirmar
    // que o pipeline a publicou.
    const id = await createManualDraft('administrator', `falsa-auto-${randomUUID().slice(0, 8)}`, {
      autoPublished: true,
      automationActorId: 'sa-mnscr-inventada',
      automationActorLabel: 'MNScr',
      automationContractName: 'editorial-publication-v1',
      automationSchemaHash: 'sha256:falso',
      idempotencyKey: 'chave-forjada',
      sourceClusterId: 'cluster-forjado',
      pipelineVersion: 'v99',
    })
    expectNoAutomationTrace(await articleById(id))

    await patchArticle('administrator', id, { autoPublished: true, automationActorId: 'x' })
    expectNoAutomationTrace(await articleById(id))
  })
})

/* ------------------------------------------------------------------ */
/* 3. Autor PUBLICO nao e usuario do CMS                               */
/* ------------------------------------------------------------------ */

describe('autor publico versus usuario do CMS', () => {
  it('o administrador publica materia assinada pela Redacao — e por outro autor', async () => {
    const newsroom = await createManualDraft('administrator', `assina-redacao-${randomUUID().slice(0, 8)}`)
    await advanceToReady('administrator', newsroom)
    await patchArticle('administrator', newsroom, { workflowStatus: 'published' })
    const first = await articleById(newsroom)
    expect(String(first.primaryAuthor)).toBe(String(ids.newsroomAuthor))
    expect(String(first.publishedBy)).toBe(String(ids.admin))

    const signed = await createManualDraft('administrator', `assina-byline-${randomUUID().slice(0, 8)}`, {
      authors: [ids.bylineAuthor],
      primaryAuthor: ids.bylineAuthor,
    })
    await advanceToReady('administrator', signed)
    await patchArticle('administrator', signed, { workflowStatus: 'published' })
    const second = await articleById(signed)
    expect(String(second.primaryAuthor)).toBe(String(ids.bylineAuthor))
    // MESMO operador, assinatura publica diferente: as duas identidades sao
    // independentes.
    expect(String(second.publishedBy)).toBe(String(ids.admin))
  })

  it('trocar quem EDITA nao troca a assinatura publica', async () => {
    const id = await createManualDraft('writer', `edita-${randomUUID().slice(0, 8)}`, {
      authors: [ids.bylineAuthor],
      primaryAuthor: ids.bylineAuthor,
    })
    await patchArticle('editor', id, { summary: 'Resumo reescrito por outro operador.' })
    const doc = await articleById(id)
    expect(String(doc.updatedBy)).toBe(String(ids.editor))
    expect(String(doc.primaryAuthor)).toBe(String(ids.bylineAuthor))
  })

  it('trocar a ASSINATURA publica nao troca o publishedBy humano', async () => {
    const id = await createManualDraft('administrator', `troca-assinatura-${randomUUID().slice(0, 8)}`)
    await advanceToReady('administrator', id)
    await patchArticle('administrator', id, { workflowStatus: 'published' })
    await patchArticle('editor_in_chief', id, {
      authors: [ids.bylineAuthor],
      primaryAuthor: ids.bylineAuthor,
    })
    const doc = await articleById(id)
    expect(String(doc.primaryAuthor)).toBe(String(ids.bylineAuthor))
    expect(String(doc.publishedBy)).toBe(String(ids.admin))
  })

  it('criar usuario do CMS NAO cria autor publico', async () => {
    // As duas colecoes sao separadas. Um usuario que virasse autor
    // automaticamente colocaria no site o nome de quem so opera o painel.
    const before = await payload.find({ collection: 'authors', limit: 0, overrideAccess: true })
    await payload.create({
      collection: 'editorial-users',
      data: {
        email: `operador.${randomUUID().slice(0, 8)}@cinerie.test`,
        password: 'senha-de-teste-operador-0123456789',
        displayName: 'Operador Sem Assinatura',
        role: 'editor',
        active: true,
      } as never,
      overrideAccess: true,
    })
    const after = await payload.find({ collection: 'authors', limit: 0, overrideAccess: true })
    expect(after.totalDocs).toBe(before.totalDocs)
    const named = await payload.find({
      collection: 'authors',
      where: { name: { equals: 'Operador Sem Assinatura' } },
      overrideAccess: true,
    })
    expect(named.totalDocs).toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/* 4. Workflow humano real                                             */
/* ------------------------------------------------------------------ */

describe('workflow humano', () => {
  it('changes_requested devolve para edicao e a materia publica na segunda revisao', async () => {
    const id = await createManualDraft('writer', `ciclo-${randomUUID().slice(0, 8)}`)
    expect((await patchArticle('writer', id, { workflowStatus: 'needs_review' })).status).toBe(200)
    expect((await patchArticle('reviewer', id, { workflowStatus: 'in_review' })).status).toBe(200)
    expect((await patchArticle('reviewer', id, { workflowStatus: 'changes_requested' })).status).toBe(200)
    expect((await patchArticle('writer', id, { workflowStatus: 'draft' })).status).toBe(200)
    expect((await patchArticle('writer', id, { summary: 'Resumo corrigido apos a revisao.' })).status).toBe(200)
    expect((await patchArticle('writer', id, { workflowStatus: 'needs_review' })).status).toBe(200)
    expect((await patchArticle('reviewer', id, { workflowStatus: 'in_review' })).status).toBe(200)
    expect((await patchArticle('reviewer', id, { workflowStatus: 'human_reviewed' })).status).toBe(200)
    expect((await patchArticle('editor', id, { workflowStatus: 'ready_to_publish' })).status).toBe(200)
    expect((await patchArticle('editor_in_chief', id, { workflowStatus: 'published' })).status).toBe(200)
    expect((await articleById(id)).workflowStatus).toBe('published')
  })

  it('atualizar materia publicada emite article.updated, nao uma segunda publicacao', async () => {
    const id = await createManualDraft('administrator', `atualiza-${randomUUID().slice(0, 8)}`)
    await advanceToReady('administrator', id)
    await patchArticle('administrator', id, { workflowStatus: 'published' })

    await patchArticle('administrator', id, { workflowStatus: 'needs_update' })
    await patchArticle('administrator', id, { summary: 'Resumo atualizado apos a publicacao.' })
    await patchArticle('administrator', id, { workflowStatus: 'ready_to_publish' })
    expect((await patchArticle('administrator', id, { workflowStatus: 'published' })).status).toBe(200)

    expect((await outboxRows(id)).map((row) => row.eventType)).toEqual([
      'article.published',
      'article.updated',
    ])
  })

  it('despublicar e retratar sao decisoes de quem publica, e cada uma tem seu evento', async () => {
    const unpublished = await createManualDraft('administrator', `despub-${randomUUID().slice(0, 8)}`)
    await advanceToReady('administrator', unpublished)
    await patchArticle('administrator', unpublished, { workflowStatus: 'published' })
    expect((await patchArticle('administrator', unpublished, { workflowStatus: 'archived' })).status).toBe(200)
    expect((await outboxRows(unpublished)).map((row) => row.eventType)).toEqual([
      'article.published',
      'article.unpublished',
    ])
    // Despublicado deixa de ser publicado tambem para o Payload.
    expect((await articleById(unpublished))._status).toBe('draft')

    const retracted = await createManualDraft('editor_in_chief', `retrata-${randomUUID().slice(0, 8)}`)
    await advanceToReady('editor_in_chief', retracted)
    await patchArticle('editor_in_chief', retracted, { workflowStatus: 'published' })
    expect(
      (await patchArticle('editor_in_chief', retracted, {
        workflowStatus: 'retracted',
        retractionReason: 'Informacao incorreta confirmada pela fonte.',
      })).status,
    ).toBe(200)
    expect((await outboxRows(retracted)).map((row) => row.eventType)).toEqual([
      'article.published',
      'article.retracted',
    ])
    // O que saiu do ar nao volta sem NOVA revisao.
    expect((await patchArticle('administrator', retracted, { workflowStatus: 'published' })).status).toBe(403)
  })

  it('writer e reviewer NAO publicam', async () => {
    const id = await createManualDraft('writer', `sem-poder-${randomUUID().slice(0, 8)}`)
    await advanceToReady('editor', id)
    expect((await patchArticle('writer', id, { workflowStatus: 'published' })).status).toBe(403)
    expect((await patchArticle('reviewer', id, { workflowStatus: 'published' })).status).toBe(403)
    expect((await patchArticle('editor', id, { workflowStatus: 'published' })).status).toBe(403)
    // A materia continua exatamente onde estava.
    expect((await articleById(id)).workflowStatus).toBe('ready_to_publish')
    // E o editor-chefe publica.
    expect((await patchArticle('editor_in_chief', id, { workflowStatus: 'published' })).status).toBe(200)
  })

  it('legal hold impede a publicacao ate ser liberado', async () => {
    const id = await createManualDraft('administrator', `hold-${randomUUID().slice(0, 8)}`, {
      legalHold: true,
    })
    await advanceToReady('administrator', id)
    const blocked = await patchArticle('administrator', id, { workflowStatus: 'published' })
    expect(blocked.status).toBe(403)
    expect(blocked.text).toContain('legal_hold')
    expect((await outboxRows(id))).toEqual([])

    expect((await patchArticle('administrator', id, { legalHold: false })).status).toBe(200)
    expect((await patchArticle('administrator', id, { workflowStatus: 'published' })).status).toBe(200)
  })

  it('conta tecnica NAO usa transicao humana nem se passa por operador', async () => {
    const id = await createManualDraft('administrator', `tecnica-${randomUUID().slice(0, 8)}`)
    const auth = apiKeyAuthorization('service-accounts', ingestKey)
    // Ela nem le a colecao de artigos: rascunho humano em revisao nao e assunto
    // de pipeline externo.
    const read = await fetch(`${baseUrl}/api/articles/${id}`, { headers: { Authorization: auth } })
    expect(read.status).toBe(403)

    const patch = await fetch(`${baseUrl}/api/articles/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', Authorization: auth },
      body: JSON.stringify({ workflowStatus: 'ready_to_publish', publishedBy: ids.admin }),
    })
    expect(patch.status).toBeGreaterThanOrEqual(400)
    const doc = await articleById(id)
    expect(doc.workflowStatus).toBe('draft')
    expect(doc.publishedBy ?? null).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* 3b. A migration do rastro humano, no banco de verdade               */
/* ------------------------------------------------------------------ */

describe('migration do rastro humano', () => {
  // A migration e ADITIVA: tres colunas novas em `articles` (e as espelhadas em
  // `_articles_v`), com FK para `editorial_users` e `ON DELETE SET NULL`. Ela
  // roda de banco VAZIO em toda execucao desta suite — o harness aplica a
  // cadeia inteira pelo CLI real antes de subir o servidor —, entao o que falta
  // provar e o COMPORTAMENTO das constraints.

  it('apagar o usuario NAO apaga a materia: o rastro vira nulo', async () => {
    // `ON DELETE SET NULL` e a escolha certa e precisa ser provada nos dois
    // sentidos. `CASCADE` apagaria materias publicadas ao desligar uma pessoa —
    // catastrofico. `RESTRICT` tornaria impossivel remover alguem que ja
    // publicou — e a materia publicada nao pode segurar um dado pessoal para
    // sempre. O que fica e a materia sem o nome, que e o resultado desejado.
    const temporary = await payload.create({
      collection: 'editorial-users',
      data: {
        email: `efemera.${randomUUID().slice(0, 8)}@cinerie.test`,
        password: 'senha-de-teste-efemera-0123456789',
        displayName: 'Editora efemera',
        role: 'administrator',
        active: true,
      } as never,
      overrideAccess: true,
    })
    const temporaryId = Number(temporary.id)

    const login = await fetch(`${baseUrl}/api/editorial-users/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: String((temporary as { email?: unknown }).email),
        password: 'senha-de-teste-efemera-0123456789',
      }),
    })
    tokens.efemera = String(((await login.json()) as { token?: string }).token ?? '')

    const id = await createManualDraft('efemera', `fk-${randomUUID().slice(0, 8)}`)
    await advanceToReady('efemera', id)
    expect((await patchArticle('efemera', id, { workflowStatus: 'published' })).status).toBe(200)
    expect(String((await articleById(id)).publishedBy)).toBe(String(temporaryId))

    await payload.delete({ collection: 'editorial-users', id: temporaryId, overrideAccess: true })

    const orphan = await articleById(id)
    expect(orphan.workflowStatus).toBe('published')
    expect(orphan.createdBy ?? null).toBeNull()
    expect(orphan.updatedBy ?? null).toBeNull()
    expect(orphan.publishedBy ?? null).toBeNull()
  })

  it('um id de usuario inventado e DESCARTADO antes de chegar ao banco', async () => {
    // O rastro e derivado da sessao, entao um id vindo de fora nunca deveria
    // sequer tentar a FK. Provar isso importa: se a guarda falhasse, o erro
    // apareceria como violacao de chave estrangeira — um 500 opaco no lugar de
    // um campo simplesmente ignorado.
    const id = await createManualDraft('administrator', `fk-invalido-${randomUUID().slice(0, 8)}`)
    const forged = await patchArticle('administrator', id, { createdBy: 987_654_321 })
    expect(forged.status).toBe(200)
    expect(String((await articleById(id)).createdBy)).toBe(String(ids.admin))
  })

  it('as tres FKs existem no banco com ON DELETE SET NULL', async () => {
    // Asercao direta sobre o SCHEMA aplicado, e nao sobre o arquivo de
    // migration: o que vale e o que o `payload migrate` produziu no PostgreSQL.
    // `confdeltype = 'n'` e o codigo de SET NULL no catalogo do Postgres.
    const pool = (payload.db as unknown as {
      pool: { query: (text: string) => Promise<{ rows: Record<string, unknown>[] }> }
    }).pool

    const { rows } = await pool.query(`
      SELECT c.conname, c.confdeltype
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_class r ON r.oid = c.confrelid
      WHERE c.contype = 'f'
        AND t.relname = 'articles'
        AND r.relname = 'editorial_users'
        AND c.conname LIKE '%\\_by\\_id\\_%'
      ORDER BY c.conname
    `)

    expect(rows.map((row) => String(row.conname))).toEqual([
      'articles_created_by_id_editorial_users_id_fk',
      'articles_published_by_id_editorial_users_id_fk',
      'articles_updated_by_id_editorial_users_id_fk',
    ])
    expect(rows.map((row) => String(row.confdeltype))).toEqual(['n', 'n', 'n'])
  })
})

/* ------------------------------------------------------------------ */
/* 4b. Readiness em production-like SEM MNScr                          */
/* ------------------------------------------------------------------ */

describe('readiness sem MNScr', () => {
  // O harness roda `next start` com `NODE_ENV=production` e SEM nenhuma
  // variavel de automacao — exatamente o ambiente de uma instalacao que so
  // publica por redacao humana. Se a readiness exigisse configuracao do MNScr,
  // o orquestrador tiraria do ar um CMS que funciona perfeitamente.

  it('nenhuma variavel do MNScr esta no ambiente do servidor', () => {
    const leaked = Object.keys(process.env).filter((key) => key.startsWith('MNSCR_'))
    expect(leaked).toEqual([])
    // A automacao esta desligada por AUSENCIA, que e o default correto.
    expect(process.env.EDITORIAL_AUTO_PUBLISH_ENABLED ?? 'false').not.toBe('true')
  })

  it('/healthz responde 200', async () => {
    const response = await fetch(`${baseUrl}/healthz`)
    expect(response.status).toBe(200)
  })

  it('/readyz responde 200 e o check de autopublicacao aparece como ok', async () => {
    const response = await fetch(`${baseUrl}/readyz`)
    const body = (await response.json()) as {
      status?: string
      checks?: { name: string; status: string; detail?: string }[]
    }
    expect(response.status, JSON.stringify(body)).toBe(200)
    expect(body.status).toBe('ready')

    const checks = body.checks ?? []
    const autoPublish = checks.find((check) => check.name === 'auto_publish')
    // O check EXISTE mesmo com a automacao desligada — e nesse caso e `ok`.
    // Kill switch desligado e estado operacional conhecido, nao avaria.
    expect(autoPublish?.status).toBe('ok')
    expect(autoPublish?.detail ?? '').toContain('desabilitada')
    // E nenhum check reprova por falta de configuracao do pipeline.
    expect(checks.filter((check) => check.status !== 'ok')).toEqual([])
  })

  it('o CMS manual continua atendendo: o painel responde e a REST publica', async () => {
    // Readiness verde tem que significar "da para trabalhar". Estas duas
    // chamadas sao o minimo dessa promessa.
    const panel = await fetch(`${baseUrl}/admin/login`)
    expect(panel.status).toBe(200)

    const id = await createManualDraft('administrator', `readiness-${randomUUID().slice(0, 8)}`)
    await advanceToReady('administrator', id)
    expect((await patchArticle('administrator', id, { workflowStatus: 'published' })).status).toBe(200)
  })
})

/* ------------------------------------------------------------------ */
/* 5. Midia manual                                                     */
/* ------------------------------------------------------------------ */

describe('midia manual', () => {
  it('a imagem enviada pelo painel existe no storage e NAO e publica', async () => {
    const media = await payload.findByID({
      collection: 'media',
      id: ids.mediaApproved,
      overrideAccess: true,
    })
    const filename = String((media as { filename?: unknown }).filename ?? '')
    expect(filename).not.toBe('')

    // Anonimo nao busca bytes do CMS. O CMS e a REDACAO, nao o CDN: quem serve
    // imagem ao publico e o storage publico, depois da projecao. Sem este
    // limite, uma capa embargada estaria no ar antes de a materia sair.
    const anonymous = await fetch(`${baseUrl}/api/media/file/${encodeURIComponent(filename)}`)
    expect(anonymous.status).toBe(403)

    // Com sessao humana o arquivo existe de verdade — nao so a linha no banco.
    const served = await asRole('administrator', `/api/media/file/${encodeURIComponent(filename)}`)
    expect(served.status).toBe(200)
    expect(served.text.length).toBeGreaterThan(0)
  })

  it('capa com licenca proibida NAO publica', async () => {
    const id = await createManualDraft('administrator', `capa-ruim-${randomUUID().slice(0, 8)}`, {
      heroMedia: ids.mediaProhibited,
    })
    await advanceToReady('administrator', id)
    const blocked = await patchArticle('administrator', id, { workflowStatus: 'published' })
    expect(blocked.status).toBe(403)
    expect(blocked.text).toContain('unauthorized_media')
  })

  it('midia proibida DENTRO do corpo tambem barra a publicacao', async () => {
    // Sem esta checagem a materia publicava no CMS e morria no worker de
    // projecao: a redacao ficaria com um artigo "publicado" que nunca aparece.
    const id = await createManualDraft('administrator', `corpo-ruim-${randomUUID().slice(0, 8)}`, {
      body: [
        { blockType: 'paragraph', blockId: 'p-1', text: 'Texto valido.' },
        {
          blockType: 'image',
          blockId: 'i-1',
          media: ids.mediaProhibited,
          alt: 'Imagem sem licenca',
        },
      ],
    })
    await advanceToReady('administrator', id)
    const blocked = await patchArticle('administrator', id, { workflowStatus: 'published' })
    expect(blocked.status).toBe(403)
    expect(blocked.text).toContain('unauthorized_media')
  })

  it('o alt aprovado atravessa para o evento de publicacao', async () => {
    const id = await createManualDraft('administrator', `alt-${randomUUID().slice(0, 8)}`)
    await advanceToReady('administrator', id)
    await patchArticle('administrator', id, { workflowStatus: 'published' })
    const [event] = await outboxRows(id)
    const payloadJson = JSON.stringify(event?.payload ?? {})
    expect(payloadJson).toContain('Cena de divulgacao')
  })
})
