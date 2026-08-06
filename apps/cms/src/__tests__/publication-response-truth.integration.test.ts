/**
 * O que o `2xx` da autopublicacao PROMETE, contra o que o banco recebeu.
 *
 * Cada caso aqui existia como defeito silencioso: o endpoint respondia
 * `PUBLISHED` e, do outro lado, faltava a capa, faltavam os vinculos de
 * entidade, faltava metade do SEO, e um bloco de imagem sumia sem uma linha na
 * resposta. Tudo isso e invisivel para teste puro — a unica prova possivel e
 * publicar de verdade e ir olhar a linha.
 *
 * Por que arquivo PROPRIO e nao um `describe` em `auto-publication`: aquele
 * arquivo mede quota e autoria com tetos calibrados para isso, e midia removida
 * de proposito das fixtures. Aqui a midia E o assunto.
 *
 * As envs vao ANTES do harness: o servidor e processo separado e herda o
 * ambiente no `spawn`.
 */

import { randomUUID } from 'node:crypto'

process.env.EDITORIAL_AUTO_PUBLISH_ENABLED = 'true'
process.env.EDITORIAL_AUTO_PUBLISH_DAILY_LIMIT = '80'
process.env.EDITORIAL_AUTO_PUBLISH_PER_AUTHOR_LIMIT = '60'
process.env.EDITORIAL_AUTO_PUBLISH_PER_SECTION_LIMIT = '60'
process.env.EDITORIAL_AUTO_PUBLISH_PER_CONTENT_TYPE_LIMIT = '60'
process.env.EDITORIAL_AUTO_PUBLISH_PER_ARTICLE_UPDATE_LIMIT = '5'
process.env.EDITORIAL_AUTO_PUBLISH_TIME_ZONE = 'America/Sao_Paulo'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'

import { validPublicationRequest } from '@screena/editorial-contracts'

import { apiKeyAuthorization, decodableJpegBytes, startCmsHarness, type CmsHarness } from './harness.js'

let harness: CmsHarness
let payload: Payload
let baseUrl: string

let publisherKey = ''
let authorId = ''
/** Aprovada para uso editorial E para capa. */
let heroMediaId = ''
/** Aprovada para uso editorial, PROIBIDA como capa. */
let inlineOnlyMediaId = ''
/** Uma segunda capa legitima, para o caso de ambiguidade. */
let secondHeroMediaId = ''
/** Humano da redacao, para simular a confirmacao de vinculo no admin. */
let chiefId = 0

interface Overrides {
  readonly [key: string]: unknown
}

/**
 * Pedido valido derivado da fixture canonica.
 *
 * A fixture aponta para `media-9001` e para `tv-12345`, que nao existem neste
 * banco; cada caso declara a propria midia e os proprios vinculos. `seo` e
 * MESCLADO para nao perder a slug unica por engano.
 */
function requestBody(overrides: Overrides = {}): Record<string, unknown> {
  const id = randomUUID()
  const { seo: seoOverrides, ...rest } = overrides as { seo?: Overrides }
  return {
    ...validPublicationRequest,
    media: [],
    entityLinks: [],
    requestId: `req-${id}`,
    idempotencyKey: `idem-${id}`,
    sourceClusterId: `cluster-${id.slice(0, 8)}`,
    publicAuthorId: authorId,
    ...rest,
    seo: {
      ...validPublicationRequest.seo,
      imageAltSuggestions: [],
      internalLinkSuggestions: [],
      slugSuggestion: `materia-${id.slice(0, 8)}`,
      ...(seoOverrides ?? {}),
    },
  }
}

interface PublishResult {
  readonly status: number
  readonly body: Record<string, unknown>
}

async function publish(body: Record<string, unknown>): Promise<PublishResult> {
  const response = await fetch(`${baseUrl}/api/internal/editorial-publications`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: apiKeyAuthorization('service-accounts', publisherKey),
    },
    body: JSON.stringify(body),
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
  if (parsed.outcome === 'OPERATIONAL_ERROR') {
    console.error(`[servidor]\n${harness.serverLog().slice(-4000)}`)
  }
  return { status: response.status, body: parsed }
}

/** Codigos dos avisos ESTRUTURADOS da resposta. */
function warningCodes(body: Record<string, unknown>): string[] {
  const details = body.warningDetails
  return Array.isArray(details) ? details.map((entry) => String((entry as { code: string }).code)) : []
}

function warningFor(body: Record<string, unknown>, code: string): Record<string, unknown> | null {
  const details = body.warningDetails
  if (!Array.isArray(details)) return null
  return (
    (details.find((entry) => (entry as { code?: unknown }).code === code) as
      | Record<string, unknown>
      | undefined) ?? null
  )
}

async function readArticle(id: string): Promise<Record<string, unknown>> {
  return (await payload.findByID({
    collection: 'articles',
    id,
    depth: 0,
    overrideAccess: true,
  })) as unknown as Record<string, unknown>
}

/**
 * O chefe de redacao, na forma que `toActor` reconhece.
 *
 * Escrita editorial pela Local API exige ator autenticado — a mesma guarda que
 * impede uma automacao de editar por fora do endpoint. Simular a confirmacao
 * humana com `overrideAccess` e sem usuario nao provaria nada: o teste passaria
 * por um caminho que o admin nao tem.
 */
async function chief(): Promise<never> {
  const doc = await payload.findByID({
    collection: 'editorial-users',
    id: chiefId,
    overrideAccess: true,
  })
  return { ...doc, collection: 'editorial-users' } as never
}

async function articleCountFor(idempotencyKey: string): Promise<number> {
  const found = await payload.count({
    collection: 'articles',
    where: { automationIdempotencyKey: { equals: idempotencyKey } },
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

  publisherKey = randomUUID()
  await payload.create({
    collection: 'service-accounts',
    data: {
      label: 'mnscr-publisher-truth',
      purpose: 'mnscr',
      active: true,
      scopes: ['editorial_auto_publish'],
      enableAPIKey: true,
      apiKey: publisherKey,
    } as never,
    overrideAccess: true,
  })

  const chiefUser = await payload.create({
    collection: 'editorial-users',
    data: {
      email: 'chefe-verdade@cinerie.test',
      password: 'senha-de-teste-chefe-0123456789',
      displayName: 'chefe da verdade',
      role: 'editor_in_chief',
      active: true,
    } as never,
    overrideAccess: true,
  })
  chiefId = Number(chiefUser.id)

  const author = await payload.create({
    collection: 'authors',
    data: {
      name: 'Redacao da Verdade',
      slug: `redacao-verdade-${randomUUID().slice(0, 6)}`,
      active: true,
      automationPublishingAllowed: true,
      allowedAutomationContentTypes: ['news'],
      allowedAutomationSections: ['Series'],
      automationAttributionModes: ['newsroom'],
    } as never,
    overrideAccess: true,
  })
  authorId = String(author.id)

  const makeMedia = async (alt: string, allowedForHero: boolean): Promise<string> => {
    const bytes = await decodableJpegBytes(48, 48, alt.length)
    const created = await payload.create({
      collection: 'media',
      data: {
        alt,
        licenseStatus: 'approved',
        allowedForEditorial: true,
        allowedForHero,
        requiresAttribution: false,
        provenanceType: 'cinerie_catalog',
      } as never,
      overrideAccess: true,
      file: {
        data: bytes,
        mimetype: 'image/jpeg',
        name: `${alt}-${randomUUID()}.jpg`,
        size: bytes.byteLength,
      },
    })
    return String(created.id)
  }
  heroMediaId = await makeMedia('capa-liberada', true)
  secondHeroMediaId = await makeMedia('segunda-capa', true)
  inlineOnlyMediaId = await makeMedia('so-interna', false)
}, 900_000)

afterAll(async () => {
  await harness?.stop()
}, 180_000)

/* ------------------------------------------------------------------ */
/* F1 — a resposta deixa de mentir                                    */
/* ------------------------------------------------------------------ */

describe('F1: avisos do mapeamento chegam ao emissor', () => {
  it('imagem cujo mediaRef nao tem par em media[] some do corpo — e o pedido fica sabendo', async () => {
    // Ate aqui o bloco era descartado dentro de `persistPublication`, DEPOIS da
    // resposta: a materia publicava sem a imagem e o `2xx` nao dizia nada.
    const body = requestBody({
      blocks: [
        { type: 'paragraph', id: 'b1', text: 'Um paragrafo com corpo suficiente para o QA.' },
        { type: 'image', id: 'i1', mediaRef: 'media-que-nao-veio', alt: 'Cartaz oficial' },
      ],
    })
    const { body: response } = await publish(body)

    expect(response.outcome).toBe('PUBLISHED')
    expect(warningCodes(response)).toContain('BLOCK_IMAGE_MEDIA_UNRESOLVED')

    const warning = warningFor(response, 'BLOCK_IMAGE_MEDIA_UNRESOLVED')
    expect(warning?.blockId).toBe('i1')
    expect(warning?.field).toBe('blocks[1].mediaRef')
    expect(String(warning?.detail)).toContain('media-que-nao-veio')

    // A materia CONTINUA sendo criada: o bloco perdido nao invalida o texto.
    const article = await readArticle(String(response.articleId))
    const blocks = article.body as { blockType: string }[]
    expect(blocks.map((block) => block.blockType)).toEqual(['paragraph'])
  })

  it('proveniencia fora de paragrafo nao persiste — e sai nomeada por bloco', async () => {
    const { body: response } = await publish(
      requestBody({
        blocks: [
          { type: 'paragraph', id: 'b1', text: 'Um paragrafo com corpo suficiente para o QA.' },
          {
            type: 'heading',
            id: 'h1',
            level: 2,
            text: 'Um subtitulo',
            provenance: [{ origin: 'external_source', ref: 'src-variety' }],
          },
        ],
      }),
    )

    expect(response.outcome).toBe('PUBLISHED')
    const warning = warningFor(response, 'BLOCK_PROVENANCE_DROPPED')
    expect(warning?.blockId).toBe('h1')
    expect(warning?.field).toBe('blocks[1].provenance')
  })

  it('o admin guarda EXATAMENTE os avisos que o emissor recebeu — sem duplicata', async () => {
    // A promessa escrita em `persistPublication` e que "o revisor humano ve no
    // admin a mesma verdade que o emissor recebeu por HTTP". Este caso cobra a
    // promessa nos DOIS sentidos, com uma perda de cada familia do mapeador:
    //
    //  - `image` sem par em `media[]` => aviso de par 1:1 (string e detail sao
    //    a MESMA frase). Se a lista do artigo somar as duas origens, a frase
    //    aparece DUAS vezes.
    //  - `heading` com `provenance` => detail POR BLOCO mais uma string
    //    AGREGADA. A agregada nao tem par na resposta: e um aviso que so o
    //    admin ve, com outra redacao para o mesmo fato.
    const { body: response } = await publish(
      requestBody({
        blocks: [
          { type: 'paragraph', id: 'b1', text: 'Um paragrafo com corpo suficiente para o QA.' },
          { type: 'image', id: 'i1', mediaRef: 'media-que-nao-veio', alt: 'Cartaz oficial' },
          {
            type: 'heading',
            id: 'h1',
            level: 2,
            text: 'Um subtitulo',
            provenance: [{ origin: 'external_source', ref: 'src-variety' }],
          },
        ],
      }),
    )
    expect(response.outcome).toBe('PUBLISHED')

    const details = (response.warningDetails as { detail: string }[]).map((entry) => entry.detail)
    expect(details.length).toBeGreaterThan(0)

    const article = await readArticle(String(response.articleId))
    const persisted = article.warnings as string[]

    // (a) cada aviso da resposta aparece UMA vez no artigo.
    for (const detail of details) {
      expect(persisted.filter((entry) => entry === detail)).toHaveLength(1)
    }

    // (b) e o artigo nao carrega aviso que a resposta nao carregue. O QA entra
    // por outra porta (`request.qa.warnings`) e nao conta aqui — a fixture o
    // mantem vazio, entao qualquer sobra e do mapeador.
    expect(persisted.filter((entry) => !details.includes(entry))).toEqual([])
  })

  it('marks removido pelo contrato de entrada vira aviso, nao silencio', async () => {
    // `marks` so existe no bloco PUBLICADO. Na entrada o `z.object` remove a
    // chave sem erro: o emissor mandava negrito e recebia `2xx` sem formatacao.
    const { body: response } = await publish(
      requestBody({
        blocks: [
          {
            type: 'paragraph',
            id: 'b1',
            text: 'Um paragrafo com corpo suficiente para o QA.',
            marks: [{ start: 0, end: 2, type: 'bold' }],
          },
        ],
      }),
    )

    expect(response.outcome).toBe('PUBLISHED')
    const warning = warningFor(response, 'BLOCK_MARKS_STRIPPED')
    expect(warning?.blockId).toBe('b1')
    expect(warning?.field).toBe('blocks[0].marks')
  })

  it('campo de SEO aceito pelo contrato e sem coluna sai como lacuna nomeada', async () => {
    const { body: response } = await publish(
      requestBody({
        media: [{ mediaId: heroMediaId, intendedUse: 'hero', altSuggestion: 'Cartaz' }],
        seo: {
          ...validPublicationRequest.seo,
          slugSuggestion: `materia-seo-${randomUUID().slice(0, 8)}`,
          imageAltSuggestions: [{ mediaRef: heroMediaId, alt: 'Cartaz oficial da serie' }],
          internalLinkSuggestions: [
            { targetType: 'tv_show', targetPath: '/pt/series/x', anchorText: 'a serie' },
          ],
        },
      }),
    )

    expect(response.outcome).toBe('PUBLISHED')
    const fields = (response.warningDetails as { code: string; field: string }[])
      .filter((entry) => entry.code === 'SEO_FIELD_NOT_PERSISTED')
      .map((entry) => entry.field)
    expect(fields).toContain('seo.imageAltSuggestions')
    expect(fields).toContain('seo.internalLinkSuggestions')
  })

  it('`warnings` continua sendo lista de STRINGS — nenhum consumidor antigo quebra', async () => {
    const { body: response } = await publish(
      requestBody({
        blocks: [
          { type: 'paragraph', id: 'b1', text: 'Um paragrafo com corpo suficiente para o QA.' },
          { type: 'image', id: 'i1', mediaRef: 'ausente', alt: 'Cartaz oficial' },
        ],
      }),
    )
    const warnings = response.warnings as unknown[]
    expect(Array.isArray(warnings)).toBe(true)
    expect(warnings.every((entry) => typeof entry === 'string')).toBe(true)
    expect(warnings.some((entry) => String(entry).includes('ausente'))).toBe(true)
  })

  it('pedido integro nao inventa aviso nenhum', async () => {
    const { body: response } = await publish(requestBody())
    expect(response.outcome).toBe('PUBLISHED')
    expect(response.warningDetails).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* F2 — a capa deixa de evaporar                                      */
/* ------------------------------------------------------------------ */

describe('F2: intendedUse hero vira heroMedia', () => {
  it('midia liberada para capa vira a capa da materia', async () => {
    const { body: response } = await publish(
      requestBody({
        media: [{ mediaId: heroMediaId, intendedUse: 'hero', altSuggestion: 'Cartaz' }],
      }),
    )
    expect(response.outcome).toBe('PUBLISHED')

    const article = await readArticle(String(response.articleId))
    expect(String(article.heroMedia)).toBe(heroMediaId)
  })

  it('sem allowedForHero: nada e gravado e o motivo sai na resposta', async () => {
    // O gate de licenca ja recusa o pedido inteiro (invariante 6). O que muda
    // aqui e a resposta DIZER qual midia e por que: antes o produtor recebia
    // "1 midia(s) sem autorizacao" e ficava adivinhando.
    const key = `idem-${randomUUID()}`
    const { body: response } = await publish(
      requestBody({
        idempotencyKey: key,
        media: [{ mediaId: inlineOnlyMediaId, intendedUse: 'hero', altSuggestion: 'Cartaz' }],
      }),
    )

    expect(response.outcome).toBe('BLOCKED')
    const warning = warningFor(response, 'HERO_MEDIA_NOT_AUTHORIZED')
    expect(String(warning?.detail)).toContain('allowedForHero')
    expect(String(warning?.detail)).toContain(inlineOnlyMediaId)
    expect(await articleCountFor(key)).toBe(0)
  })

  it('duas capas: usa a primeira e nomeia a segunda', async () => {
    const { body: response } = await publish(
      requestBody({
        media: [
          { mediaId: heroMediaId, intendedUse: 'hero', altSuggestion: 'Primeira' },
          { mediaId: secondHeroMediaId, intendedUse: 'hero', altSuggestion: 'Segunda' },
        ],
      }),
    )
    expect(response.outcome).toBe('PUBLISHED')

    const article = await readArticle(String(response.articleId))
    expect(String(article.heroMedia)).toBe(heroMediaId)
    expect(String(warningFor(response, 'HERO_MEDIA_EXTRA_IGNORED')?.detail)).toContain(
      secondHeroMediaId,
    )
  })

  it('update SEM capa preserva a capa que ja existe', async () => {
    // Este e o comportamento que a correcao NAO podia quebrar: hoje o endpoint
    // preserva o hero de uma materia editada por humano justamente porque nao
    // tocava no campo. Gravar `heroMedia: null` quando o pedido nao traz capa
    // seria a regressao obvia.
    const key = `idem-${randomUUID()}`
    const cluster = `cluster-${randomUUID().slice(0, 8)}`
    const slug = `materia-update-${randomUUID().slice(0, 8)}`

    const created = await publish(
      requestBody({
        idempotencyKey: key,
        sourceClusterId: cluster,
        sourceRevision: 1,
        media: [{ mediaId: heroMediaId, intendedUse: 'hero', altSuggestion: 'Cartaz' }],
        seo: { slugSuggestion: slug },
      }),
    )
    expect(created.body.outcome).toBe('PUBLISHED')
    const articleId = String(created.body.articleId)
    expect(String((await readArticle(articleId)).heroMedia)).toBe(heroMediaId)

    const updated = await publish(
      requestBody({
        idempotencyKey: key,
        sourceClusterId: cluster,
        sourceRevision: 2,
        publicationIntent: 'update',
        targetArticleId: articleId,
        media: [],
        seo: { slugSuggestion: slug },
      }),
    )
    expect(updated.body.outcome).toBe('PUBLISHED')
    expect(String((await readArticle(articleId)).heroMedia)).toBe(heroMediaId)
  })
})

/* ------------------------------------------------------------------ */
/* F3 — o vinculo deixa de morrer no salto                            */
/* ------------------------------------------------------------------ */

describe('F3: entityLinks viram entityReferences', () => {
  it('vinculo com id interno e gravado — como NAO verificado', async () => {
    const { body: response } = await publish(
      requestBody({
        entityLinks: [
          { entityKind: 'movie', entityId: '4210', relation: 'primary_subject', confidence: 0.9 },
        ],
      }),
    )
    expect(response.outcome).toBe('PUBLISHED')

    const article = await readArticle(String(response.articleId))
    const refs = article.entityReferences as Record<string, unknown>[]
    expect(refs).toHaveLength(1)
    expect(refs[0]?.entityKind).toBe('movie')
    expect(refs[0]?.entityId).toBe('4210')
    expect(refs[0]?.relation).toBe('primary_subject')
    // `verified` e ato HUMANO. A automacao nunca o afirma (ADR 0018), e o
    // evento de publicacao so leva o que esta verificado.
    expect(refs[0]?.verified).toBe(false)
    expect(warningCodes(response)).toContain('ENTITY_LINK_UNVERIFIED')
  })

  it('id fora da forma de id interno e RECUSADO, e o resto do pedido sobrevive', async () => {
    // Um id do TMDB nao falha em lugar nenhum: e um inteiro valido. O que a
    // forma pega e o id EXTERNO declarado como interno.
    const { body: response } = await publish(
      requestBody({
        entityLinks: [
          { entityKind: 'movie', entityId: 'tt0111161', relation: 'mentioned', confidence: 0.5 },
          { entityKind: 'tv', entityId: '77', relation: 'primary_subject', confidence: 0.9 },
        ],
      }),
    )
    expect(response.outcome).toBe('PUBLISHED')

    const refused = warningFor(response, 'ENTITY_LINK_ID_NOT_INTERNAL')
    expect(refused?.field).toBe('entityLinks[0].entityId')

    const article = await readArticle(String(response.articleId))
    const refs = article.entityReferences as Record<string, unknown>[]
    expect(refs.map((ref) => ref.entityId)).toEqual(['77'])
  })

  it('update NAO reescreve vinculos: a confirmacao humana sobrevive', async () => {
    const key = `idem-${randomUUID()}`
    const cluster = `cluster-${randomUUID().slice(0, 8)}`
    const slug = `materia-vinculo-${randomUUID().slice(0, 8)}`

    const created = await publish(
      requestBody({
        idempotencyKey: key,
        sourceClusterId: cluster,
        sourceRevision: 1,
        entityLinks: [
          { entityKind: 'movie', entityId: '4210', relation: 'primary_subject', confidence: 0.9 },
        ],
        seo: { slugSuggestion: slug },
      }),
    )
    expect(created.body.outcome).toBe('PUBLISHED')
    const articleId = String(created.body.articleId)

    // Um humano confirma o vinculo no admin.
    const before = await readArticle(articleId)
    await payload.update({
      collection: 'articles',
      id: articleId,
      data: {
        entityReferences: (before.entityReferences as Record<string, unknown>[]).map((ref) => ({
          ...ref,
          verified: true,
        })),
      } as never,
      user: await chief(),
    })

    const updated = await publish(
      requestBody({
        idempotencyKey: key,
        sourceClusterId: cluster,
        sourceRevision: 2,
        publicationIntent: 'update',
        targetArticleId: articleId,
        entityLinks: [
          { entityKind: 'movie', entityId: '4210', relation: 'primary_subject', confidence: 0.9 },
        ],
        seo: { slugSuggestion: slug },
      }),
    )
    expect(updated.body.outcome).toBe('PUBLISHED')
    expect(warningCodes(updated.body)).toContain('ENTITY_LINK_NOT_REAPPLIED')

    const after = await readArticle(articleId)
    const refs = after.entityReferences as Record<string, unknown>[]
    expect(refs).toHaveLength(1)
    expect(refs[0]?.verified).toBe(true)
  })

  it('update com id EXTERNO ainda recusa o vinculo — e diz que recusou', async () => {
    // O buraco que este caso fecha: na atualizacao, TODO aviso de vinculo era
    // trocado pelo de "nao reaplicado" — e esse so existe quando alguma linha
    // sobrevive a validacao. Com um id externo unico, nada sobrevive, entao a
    // lista ficava vazia e o emissor recebia um `2xx` limpo com o vinculo
    // perdido. Id malformado e malformado em qualquer intencao: a recusa nao
    // depende de a materia ja existir.
    const key = `idem-${randomUUID()}`
    const cluster = `cluster-${randomUUID().slice(0, 8)}`
    const slug = `materia-vinculo-ext-${randomUUID().slice(0, 8)}`

    const created = await publish(
      requestBody({
        idempotencyKey: key,
        sourceClusterId: cluster,
        sourceRevision: 1,
        seo: { slugSuggestion: slug },
      }),
    )
    expect(created.body.outcome).toBe('PUBLISHED')
    const articleId = String(created.body.articleId)

    const updated = await publish(
      requestBody({
        idempotencyKey: key,
        sourceClusterId: cluster,
        sourceRevision: 2,
        publicationIntent: 'update',
        targetArticleId: articleId,
        // Um id do TMDB, sozinho: nenhuma linha valida sobra.
        entityLinks: [
          { entityKind: 'movie', entityId: 'tt0111161', relation: 'mentioned', confidence: 0.5 },
        ],
        seo: { slugSuggestion: slug },
      }),
    )
    expect(updated.body.outcome).toBe('PUBLISHED')

    const refused = warningFor(updated.body, 'ENTITY_LINK_ID_NOT_INTERNAL')
    expect(refused?.field).toBe('entityLinks[0].entityId')
    expect(String(refused?.detail)).toContain('tt0111161')

    // O aviso de "gravados como NAO verificados" continua fora do update: no
    // update nada e gravado, e afirma-lo seria a mentira simetrica.
    expect(warningCodes(updated.body)).not.toContain('ENTITY_LINK_UNVERIFIED')

    // E o admin ve a mesma recusa.
    const after = await readArticle(articleId)
    expect((after.warnings as string[]).some((entry) => entry.includes('tt0111161'))).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* F4 — o SEO deixa de ser jogado fora                                */
/* ------------------------------------------------------------------ */

describe('F4: sinais de SEO aceitos pelo contrato passam a ser gravados', () => {
  it('editorialKeywords e relatedKeyphrases sao gravados e recuperaveis', async () => {
    const { body: response } = await publish(
      requestBody({
        seo: {
          slugSuggestion: `materia-kw-${randomUUID().slice(0, 8)}`,
          editorialKeywords: ['estreia', 'elenco', 'temporada'],
          relatedKeyphrases: ['data de lancamento', 'onde assistir'],
        },
      }),
    )
    expect(response.outcome).toBe('PUBLISHED')

    const article = await readArticle(String(response.articleId))
    expect(article.editorialKeywords).toEqual(['estreia', 'elenco', 'temporada'])
    expect(article.relatedKeyphrases).toEqual(['data de lancamento', 'onde assistir'])
  })

  it('sugestao de Open Graph vira o par social da materia', async () => {
    const { body: response } = await publish(
      requestBody({
        seo: {
          slugSuggestion: `materia-og-${randomUUID().slice(0, 8)}`,
          openGraphTitleSuggestion: 'Titulo social proprio',
          openGraphDescriptionSuggestion: 'Descricao social propria da materia.',
        },
      }),
    )
    expect(response.outcome).toBe('PUBLISHED')

    const article = await readArticle(String(response.articleId))
    expect(article.socialTitle).toBe('Titulo social proprio')
    expect(article.socialDescription).toBe('Descricao social propria da materia.')
  })

  it('os cinco campos que ja atravessavam continuam atravessando', async () => {
    const { body: response } = await publish(requestBody())
    const article = await readArticle(String(response.articleId))
    expect(article.metaTitle).toBe(validPublicationRequest.seo.title)
    expect(article.metaDescription).toBe(validPublicationRequest.seo.metaDescription)
    expect(article.focusKeyphrase).toBe(validPublicationRequest.seo.focusKeyphrase)
    expect(article.schemaTypeRecommendation).toBe('NewsArticle')
    expect(article.articleSection).toBe('Series')
  })
})
