/**
 * automation-draft-body.integration.test.ts — O CORPO do draft automatico chega
 * ao banco?
 *
 * A pergunta e estreita de proposito. `publication.integration.test.ts` ja prova
 * que `POST /api/internal/editorial-drafts` cria o artigo, que ele nasce
 * `automation_draft` e que as entidades sugeridas chegam nao verificadas — mas
 * NENHUMA assercao existente olha para `article.body`. Este arquivo olha.
 *
 * Por que INTEGRACAO e nao teste puro: a hipotese sob exame nao e "o mapper
 * devolve o objeto certo", e sim "o Payload aceita o que o endpoint manda".
 * Essa segunda pergunta so tem resposta com o Payload real — e a resposta dele,
 * quando o bloco nao casa, e o SILENCIO: em
 * `payload/dist/fields/hooks/beforeChange/promise.js` o bloco sem `blockType`
 * conhecido simplesmente nao e percorrido, sem erro e sem log.
 *
 * A CADEIA DE MIDIA, que o contrato define e o teste respeita:
 *
 *     block.mediaRef  ->  mediaCandidates[].id
 *                         mediaCandidates[].mediaRef  ->  linha em `media`
 *
 * O bloco NAO aponta para o CMS: ele aponta para uma CANDIDATA declarada no
 * mesmo draft, e so a candidata pode (opcionalmente) apontar para o acervo. Por
 * isso os dois casos abaixo sao diferentes de verdade, e nao variacao do mesmo:
 *  - RESOLVIVEL — a candidata tras `mediaRef` de item que ja existe no CMS;
 *  - PENDENTE   — a candidata so tras `url`, e aprovar e ato humano.
 */

import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'

import { validEditorialDraft } from '@screena/editorial-contracts'

import { apiKeyAuthorization, startCmsHarness, type CmsHarness } from './harness.js'

let harness: CmsHarness
let payload: Payload
let baseUrl = ''
let ingestKey = ''
let approvedMediaId = 0

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

async function postDraft(body: unknown) {
  const response = await fetch(`${baseUrl}/api/internal/editorial-drafts`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: apiKeyAuthorization('service-accounts', ingestKey),
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

/** Draft valido com identidade propria — a idempotencia e por cluster/revisao. */
function draftWith(
  cluster: string,
  blocks: readonly unknown[],
  mediaCandidates: readonly unknown[],
): Record<string, unknown> {
  const base = JSON.parse(JSON.stringify(validEditorialDraft)) as Record<string, unknown>
  return {
    ...base,
    draftId: `draft-${cluster}`,
    idempotencyKey: `${cluster}:rev-1`,
    sourceClusterId: cluster,
    sourceRevision: 1,
    slugProposal: `materia-${cluster}`,
    blocks,
    mediaCandidates,
  }
}

/**
 * Le o artigo pela Local API com `depth: 0`.
 *
 * `depth: 0` importa: com profundidade o Payload POPULA a relacao e `media`
 * volta como objeto, o que esconderia a diferenca entre "gravou o id certo" e
 * "gravou coisa nenhuma". Aqui queremos o id cru.
 */
async function articleOf(articleId: string): Promise<Record<string, unknown>> {
  return (await payload.findByID({
    collection: 'articles',
    id: articleId,
    depth: 0,
    overrideAccess: true,
  })) as unknown as Record<string, unknown>
}

async function bodyOf(articleId: string): Promise<Record<string, unknown>[]> {
  const body = (await articleOf(articleId)).body
  return Array.isArray(body) ? (body as Record<string, unknown>[]) : []
}

async function mediaCount(): Promise<number> {
  return (await payload.find({ collection: 'media', limit: 200, overrideAccess: true })).totalDocs
}

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */

beforeAll(async () => {
  harness = await startCmsHarness()
  payload = harness.payload
  baseUrl = harness.baseUrl

  ingestKey = randomUUID()
  await payload.create({
    collection: 'service-accounts',
    data: {
      label: 'mnscr-body-test',
      purpose: 'mnscr',
      active: true,
      scopes: ['draft_ingest'],
      enableAPIKey: true,
      apiKey: ingestKey,
    } as never,
    overrideAccess: true,
  })

  const onePixelPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
  const created = await payload.create({
    collection: 'media',
    data: {
      alt: 'midia aprovada de catalogo',
      licenseStatus: 'approved',
      allowedForEditorial: true,
      allowedForHero: true,
      requiresAttribution: false,
      provenanceType: 'cinerie_catalog',
    } as never,
    overrideAccess: true,
    file: {
      data: onePixelPng,
      mimetype: 'image/png',
      name: `aprovada-${randomUUID()}.png`,
      size: onePixelPng.byteLength,
    },
  })
  approvedMediaId = Number(created.id)
}, 900_000)

afterAll(async () => {
  await harness?.stop()
})

/* ------------------------------------------------------------------ */
/* 1. O corpo chega ao banco                                           */
/* ------------------------------------------------------------------ */

describe('corpo do automation_draft persistido', () => {
  const cluster = 'cluster-corpo-resolvivel'
  let articleId = ''
  let acceptStatus = 0
  let acceptText = ''

  beforeAll(async () => {
    const blocks = [
      { id: 'b1', type: 'paragraph', text: 'Abertura vinda do pipeline, com lastro em fonte.' },
      { id: 'b2', type: 'heading', level: 2, text: 'O que muda para a franquia' },
      {
        id: 'b3',
        type: 'image',
        // Aponta para a CANDIDATA declarada abaixo, nao para o CMS.
        mediaRef: 'cand-acervo',
        alt: 'Cena de divulgacao',
        caption: 'Legenda da cena',
        credit: 'Divulgacao',
      },
      { id: 'b4', type: 'sourceList', sourceRefs: ['src-variety'] },
    ]
    const mediaCandidates = [
      {
        id: 'cand-acervo',
        // A candidata SIM aponta para item que ja existe no acervo do CMS.
        mediaRef: String(approvedMediaId),
        kind: 'image',
        alt: 'Cena de divulgacao',
        origin: 'cinerie_catalog',
        intendedUse: 'inline',
      },
    ]
    const result = await postDraft(draftWith(cluster, blocks, mediaCandidates))
    acceptStatus = result.status
    acceptText = result.text
    articleId = String(result.json.articleId ?? '')
  }, 120_000)

  it('o endpoint aceita o draft', () => {
    expect(acceptStatus, acceptText.slice(0, 800)).toBe(201)
    expect(articleId).not.toBe('')
  })

  it('article.body NAO esta vazio', async () => {
    const body = await bodyOf(articleId)
    expect(
      body.length,
      'o corpo do draft nao chegou ao banco: o Payload descartou os blocos',
    ).toBeGreaterThan(0)
  })

  it('preserva quantidade e ORDEM dos blocos', async () => {
    const body = await bodyOf(articleId)
    expect(body.map((block) => block.blockType)).toEqual([
      'paragraph',
      'heading',
      'image',
      'sourceList',
    ])
  })

  it('preserva blockId de cada bloco, na ordem', async () => {
    const body = await bodyOf(articleId)
    expect(body.map((block) => block.blockId)).toEqual(['b1', 'b2', 'b3', 'b4'])
  })

  it('nenhum bloco carrega o vocabulario do CONTRATO (`type`/`id` cru)', async () => {
    const body = await bodyOf(articleId)
    expect(body.length).toBeGreaterThan(0)
    for (const block of body) {
      expect(block.blockType, 'bloco sem blockType e bloco que o Payload ignora').toBeTruthy()
      expect(block.type, 'o discriminador do contrato vazou para a persistencia').toBeUndefined()
    }
  })

  it('paragraph.text preservado', async () => {
    const paragraph = (await bodyOf(articleId)).find((b) => b.blockType === 'paragraph')
    expect(paragraph?.text).toBe('Abertura vinda do pipeline, com lastro em fonte.')
  })

  it('heading: texto preservado e level convertido para o formato do Payload', async () => {
    const heading = (await bodyOf(articleId)).find((b) => b.blockType === 'heading')
    expect(heading?.text).toBe('O que muda para a franquia')
    // A coluna e `enum_articles_blocks_heading_level AS ENUM('2','3','4')`: o
    // numero do contrato precisa virar string, senao nao ha valor de enum.
    expect(heading?.level).toBe('2')
  })

  it('image: `media` aponta para a midia do acervo e nao sobra `mediaRef` cru', async () => {
    const image = (await bodyOf(articleId)).find((b) => b.blockType === 'image')
    expect(image?.media, 'a relacao de midia ficou vazia').toBe(approvedMediaId)
    expect(image?.mediaRef, 'campo do contrato vazou para a persistencia').toBeUndefined()
    expect(image?.alt).toBe('Cena de divulgacao')
    expect(image?.caption).toBe('Legenda da cena')
    expect(image?.credit).toBe('Divulgacao')
  })

  it('sourceList: sourceRefs semanticamente preservados', async () => {
    const sourceList = (await bodyOf(articleId)).find((b) => b.blockType === 'sourceList')
    expect(sourceList?.sourceRefs).toEqual(['src-variety'])
  })

  /* --- Nada foi promovido pela ingestao ---------------------------- */

  it('workflowStatus continua automation_draft e _status continua draft', async () => {
    const article = await articleOf(articleId)
    expect(article.workflowStatus).toBe('automation_draft')
    expect(article._status).toBe('draft')
  })

  it('nenhum evento de publicacao foi criado pela ingestao', async () => {
    const rows = await payload.find({
      collection: 'publication-outbox',
      where: { aggregateId: { equals: articleId } },
      limit: 10,
      overrideAccess: true,
    })
    expect(rows.totalDocs).toBe(0)
  })

  it('a ingestao NAO cria nem aprova linha de midia', async () => {
    expect(await mediaCount()).toBe(1)
    const media = await payload.findByID({
      collection: 'media',
      id: approvedMediaId,
      overrideAccess: true,
    })
    expect((media as { licenseStatus?: unknown }).licenseStatus).toBe('approved')
  })

  it('entidades sugeridas continuam verified=false', async () => {
    const article = await articleOf(articleId)
    const refs = Array.isArray(article.entityReferences)
      ? (article.entityReferences as Record<string, unknown>[])
      : []
    expect(refs.length).toBeGreaterThan(0)
    for (const ref of refs) expect(ref.verified).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* 2. Candidata PENDENTE: o caso que nao pode derrubar a ingestao      */
/* ------------------------------------------------------------------ */

describe('imagem apontando para candidata ainda sem linha no CMS', () => {
  const cluster = 'cluster-corpo-pendente'
  let articleId = ''
  let acceptStatus = 0
  let acceptText = ''

  beforeAll(async () => {
    const blocks = [
      { id: 'c1', type: 'paragraph', text: 'Texto com imagem ainda nao licenciada.' },
      {
        id: 'c2',
        type: 'image',
        mediaRef: 'cand-pendente',
        alt: 'Imagem candidata aguardando avaliacao',
      },
      { id: 'c3', type: 'paragraph', text: 'Fechamento depois da imagem pendente.' },
    ]
    const mediaCandidates = [
      {
        id: 'cand-pendente',
        // SEM `mediaRef`: nao existe nada no acervo. Aprovar e ato humano.
        url: 'https://exemplo.test/imagem-candidata.jpg',
        kind: 'image',
        alt: 'Imagem candidata aguardando avaliacao',
        origin: 'external_source',
        intendedUse: 'inline',
      },
    ]
    const result = await postDraft(draftWith(cluster, blocks, mediaCandidates))
    acceptStatus = result.status
    acceptText = result.text
    articleId = String(result.json.articleId ?? '')
  }, 120_000)

  it('o draft continua sendo aceito', () => {
    expect(
      acceptStatus,
      `ingestao derrubada por imagem candidata: ${acceptText.slice(0, 800)}`,
    ).toBe(201)
  })

  it('o texto ao redor sobreviveu, na ordem', async () => {
    const body = await bodyOf(articleId)
    const paragraphs = body.filter((block) => block.blockType === 'paragraph')
    expect(paragraphs.map((block) => block.blockId)).toEqual(['c1', 'c3'])
  })

  it('a imagem pendente NAO some em silencio', async () => {
    const article = await articleOf(articleId)
    const warnings = Array.isArray(article.warnings) ? (article.warnings as string[]) : []
    const image = (await bodyOf(articleId)).find((block) => block.blockType === 'image')

    // Uma das duas precisa ser verdade — nunca nenhuma das duas:
    //  (a) o bloco esta la, sem relacao de midia, esperando aprovacao humana;
    //  (b) o bloco nao esta la, e ha aviso EXPLICITO nomeando o bloco.
    const preservedInBody = image !== undefined
    const reportedInWarnings = warnings.some((warning) => warning.includes('c2'))
    expect(
      preservedInBody || reportedInWarnings,
      `imagem candidata sumiu sem aviso. warnings=${JSON.stringify(warnings)}`,
    ).toBe(true)
  })

  it('a imagem pendente nunca ganha relacao de midia fabricada', async () => {
    const image = (await bodyOf(articleId)).find((block) => block.blockType === 'image')
    if (image !== undefined) {
      expect(
        image.media ?? null,
        'candidata sem linha no acervo nao pode virar relacao de midia',
      ).toBeNull()
    }
  })

  it('nenhuma linha de midia foi criada para a candidata', async () => {
    expect(await mediaCount()).toBe(1)
  })
})

/* ------------------------------------------------------------------ */
/* 3. Reenvio e atualizacao                                            */
/* ------------------------------------------------------------------ */

describe('reenvio e atualizacao do mesmo cluster', () => {
  const cluster = 'cluster-corpo-revisado'
  const candidates = [
    {
      id: 'cand-revisao',
      url: 'https://exemplo.test/candidata.jpg',
      kind: 'image',
      alt: 'candidata',
      origin: 'external_source',
      intendedUse: 'inline',
    },
  ]
  let articleId = ''

  it('primeira entrega cria o artigo com corpo', async () => {
    const first = await postDraft(
      draftWith(
        cluster,
        [{ id: 'r1', type: 'paragraph', text: 'Primeira versao do texto.' }],
        candidates,
      ),
    )
    expect(first.status, first.text.slice(0, 600)).toBe(201)
    articleId = String(first.json.articleId)
    const body = await bodyOf(articleId)
    expect(body.map((block) => block.blockId)).toEqual(['r1'])
  })

  it('reenvio IDENTICO nao duplica nem esvazia o corpo', async () => {
    const before = await payload.count({ collection: 'articles', overrideAccess: true })
    const again = await postDraft(
      draftWith(
        cluster,
        [{ id: 'r1', type: 'paragraph', text: 'Primeira versao do texto.' }],
        candidates,
      ),
    )
    expect(again.status).toBe(200)
    expect(again.json.outcome).toBe('duplicate_noop')
    const after = await payload.count({ collection: 'articles', overrideAccess: true })
    expect(after.totalDocs).toBe(before.totalDocs)
    expect((await bodyOf(articleId)).map((block) => block.blockId)).toEqual(['r1'])
  })

  it('revisao nova SUBSTITUI o corpo, ainda em automation_draft', async () => {
    const revised = {
      ...draftWith(
        cluster,
        [
          { id: 'r1', type: 'paragraph', text: 'Primeira versao do texto.' },
          { id: 'r2', type: 'heading', level: 3, text: 'Secao acrescentada' },
        ],
        candidates,
      ),
      idempotencyKey: `${cluster}:rev-2`,
      sourceRevision: 2,
      // `proposedAction` diferente de `create` exige alvo explicito: o contrato
      // nao deixa o pipeline "atualizar" sem dizer o que.
      proposedAction: 'update',
      targetArticleId: articleId,
    }
    const result = await postDraft(revised)
    expect([200, 201]).toContain(result.status)

    const body = await bodyOf(articleId)
    expect(body.map((block) => block.blockId)).toEqual(['r1', 'r2'])
    expect(body[1]?.level).toBe('3')

    const article = await articleOf(articleId)
    expect(article.workflowStatus).toBe('automation_draft')
    expect(article._status).toBe('draft')
  })
})

/* ------------------------------------------------------------------ */
/* 4. A imagem do CORPO entra mesmo no gate de midia                   */
/* ------------------------------------------------------------------ */
//
// Este bloco nao passa pelo endpoint de ingestao: ele monta o artigo pela Local
// API, ja no formato do Payload, porque a pergunta e sobre o GATE e nao sobre a
// traducao. O gate le `block.media`; antes desta correcao ele lia um campo que
// o caminho de ingestao nunca gravava, e imagem de corpo passava invisivel.

describe('gate de publicacao e a midia do corpo', () => {
  let chiefId = 0
  let authorId = 0
  let prohibitedMediaId = 0

  beforeAll(async () => {
    const chief = await payload.create({
      collection: 'editorial-users',
      data: {
        email: 'chief-body-gate@cinerie.test',
        password: 'senha-de-teste-chief-0123456789',
        displayName: 'chefe',
        role: 'editor_in_chief',
        active: true,
      } as never,
      overrideAccess: true,
    })
    chiefId = Number(chief.id)

    const author = await payload.create({
      collection: 'authors',
      data: { name: 'Redacao', slug: 'redacao-body-gate', active: true } as never,
      overrideAccess: true,
    })
    authorId = Number(author.id)

    const onePixelPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    )
    const prohibited = await payload.create({
      collection: 'media',
      data: {
        alt: 'midia proibida',
        licenseStatus: 'prohibited',
        allowedForEditorial: false,
        allowedForHero: false,
        requiresAttribution: false,
        provenanceType: 'external_source',
      } as never,
      overrideAccess: true,
      file: {
        data: onePixelPng,
        mimetype: 'image/png',
        name: `proibida-${randomUUID()}.png`,
        size: onePixelPng.byteLength,
      },
    })
    prohibitedMediaId = Number(prohibited.id)
  }, 120_000)

  async function chief() {
    const doc = await payload.findByID({
      collection: 'editorial-users',
      id: chiefId,
      overrideAccess: true,
    })
    return { ...doc, collection: 'editorial-users' } as never
  }

  /** Artigo humano levado ate `ready_to_publish`, com o corpo pedido. */
  async function seedReadyArticle(suffix: string, body: unknown[]): Promise<string> {
    const created = await payload.create({
      collection: 'articles',
      data: {
        title: `Materia ${suffix}`,
        slug: `materia-${suffix}`,
        summary: 'Resumo editorial proprio.',
        language: 'pt-BR',
        contentType: 'news',
        workflowStatus: 'draft',
        body,
        heroMedia: approvedMediaId,
        authors: [authorId],
        primaryAuthor: authorId,
        qaPassedAt: new Date().toISOString(),
        externalSources: [
          { sourceId: 's1', name: 'Variety', url: 'https://variety.com/x', role: 'primary' },
        ],
      } as never,
      overrideAccess: true,
      user: await chief(),
    })
    const id = String(created.id)
    for (const workflowStatus of ['needs_review', 'in_review', 'human_reviewed', 'ready_to_publish']) {
      await payload.update({
        collection: 'articles',
        id,
        data: { workflowStatus } as never,
        overrideAccess: false,
        user: await chief(),
      })
    }
    return id
  }

  it('corpo com midia APROVADA publica', async () => {
    const id = await seedReadyArticle('gate-aprovada', [
      { blockType: 'paragraph', blockId: 'p1', text: 'Texto.' },
      { blockType: 'image', blockId: 'i1', media: approvedMediaId, alt: 'ok' },
    ])
    await payload.update({
      collection: 'articles',
      id,
      data: { workflowStatus: 'published' } as never,
      overrideAccess: false,
      user: await chief(),
    })
    expect((await articleOf(id)).workflowStatus).toBe('published')
  })

  it('corpo com midia PROIBIDA bloqueia a publicacao', async () => {
    const id = await seedReadyArticle('gate-proibida', [
      { blockType: 'paragraph', blockId: 'p1', text: 'Texto.' },
      { blockType: 'image', blockId: 'i1', media: prohibitedMediaId, alt: 'proibida' },
    ])
    await expect(
      payload.update({
        collection: 'articles',
        id,
        data: { workflowStatus: 'published' } as never,
        overrideAccess: false,
        user: await chief(),
      }),
    ).rejects.toThrow(/unauthorized_media/)
    expect((await articleOf(id)).workflowStatus).toBe('ready_to_publish')
  })

  it('a collection RECUSA bloco de imagem sem `media` — por isso o mapper nao grava null', async () => {
    // Prova de que a alternativa "persistir com `media` vazio" nao existe:
    // `media` e `required` na collection e o Payload recusa. E o motivo de o
    // mapper transformar imagem sem midia aprovada em AVISO nomeado em vez de
    // tentar gravar o bloco pela metade.
    await expect(
      payload.create({
        collection: 'articles',
        data: {
          title: 'Materia sem relacao de midia',
          slug: 'materia-sem-relacao-de-midia',
          language: 'pt-BR',
          contentType: 'news',
          workflowStatus: 'draft',
          body: [{ blockType: 'image', blockId: 'i1', alt: 'sem relacao' }],
        } as never,
        overrideAccess: true,
        user: await chief(),
      }),
    ).rejects.toThrow(/Media/i)
  })

  it('imagem cuja midia foi APAGADA nao publica em silencio', async () => {
    // Este e o caminho REAL que produz um bloco de imagem sem midia: a FK e
    // `ON DELETE set null` (ver a migration inicial), entao apagar a linha de
    // `media` esvazia `media_id` nos blocos que a usavam. Sem
    // `unverifiableBodyMediaCount`, esse artigo publicaria com uma imagem que
    // aponta para nada.
    const onePixelPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    )
    const temporary = await payload.create({
      collection: 'media',
      data: {
        alt: 'midia que sera apagada',
        licenseStatus: 'approved',
        allowedForEditorial: true,
        allowedForHero: true,
        requiresAttribution: false,
        provenanceType: 'cinerie_editorial',
      } as never,
      overrideAccess: true,
      file: {
        data: onePixelPng,
        mimetype: 'image/png',
        name: `temporaria-${randomUUID()}.png`,
        size: onePixelPng.byteLength,
      },
    })
    const temporaryId = Number(temporary.id)

    const id = await seedReadyArticle('gate-midia-apagada', [
      { blockType: 'paragraph', blockId: 'p1', text: 'Texto.' },
      { blockType: 'image', blockId: 'i1', media: temporaryId, alt: 'vai perder a midia' },
    ])

    await payload.delete({ collection: 'media', id: temporaryId, overrideAccess: true })

    // A FK zerou a relacao: o bloco continua no corpo, agora sem midia.
    const image = (await bodyOf(id)).find((block) => block.blockType === 'image')
    expect(image, 'o bloco de imagem deveria continuar no corpo').toBeDefined()
    expect(image?.media ?? null).toBeNull()

    await expect(
      payload.update({
        collection: 'articles',
        id,
        data: { workflowStatus: 'published' } as never,
        overrideAccess: false,
        user: await chief(),
      }),
    ).rejects.toThrow(/unauthorized_media/)
    expect((await articleOf(id)).workflowStatus).toBe('ready_to_publish')
  })
})
