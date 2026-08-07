/**
 * editorial-media-ingest.integration.test.ts — `POST /api/internal/editorial-media`
 * contra Payload + PostgreSQL 16 REAIS.
 *
 * POR QUE INTEGRACAO, E NAO SO O NUCLEO PURO. `media-intake.test.ts` cobre a
 * decisao. O que ele NAO consegue provar e justamente o que faz a foto ir ao ar:
 *
 *  1. o escopo `editorial_media_ingest` existe no ENUM do banco — um valor de
 *     enum que falta e erro de driver no primeiro POST em producao, e o teste
 *     puro nunca toca o enum;
 *  2. o upload real atravessa o Payload: bytes gravados, miniatura gerada por
 *     `imageSizes`, `filename` derivado;
 *  3. a idempotencia funciona sobre a COLUNA nova (`ingested_for_article_id`),
 *     com o indice e a FK que a migration criou;
 *  4. a midia ingerida passa no gate de entrega — a decisao do operador
 *     ("imagem de robo e publica sempre") so vale se `authorizeMediaDelivery`
 *     concordar, e ele le o documento do banco, nao o objeto que escrevi.
 *
 * O ponto (4) e o que fecha o circuito: sem ele, a foto entraria no acervo e
 * morreria calada na hora de servir.
 */

import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'

import {
  apiKeyAuthorization,
  decodableJpegBytes,
  decodablePngBytes,
  startCmsHarness,
  type CmsHarness,
} from './harness.js'

let harness: CmsHarness
let payload: Payload
let baseUrl: string

let ingestKey = ''
let draftOnlyKey = ''
let articleId = 0
let chiefId = 0

const INGEST_PATH = '/api/internal/editorial-media'

/**
 * Usuario editorial dono das fixtures.
 *
 * `overrideAccess: true` dispensa ACCESS CONTROL, mas NAO dispensa ator: o hook
 * de governanca (`hooks/articles.ts`) recusa escrita anonima em `articles`. Sem
 * isto o `beforeAll` inteiro morria com 403 e os 18 casos saiam "skipped" — que
 * na tabela final se parece com sucesso.
 */
async function userDoc(id: number) {
  const doc = await payload.findByID({ collection: 'editorial-users', id, overrideAccess: true })
  return { ...doc, collection: 'editorial-users' } as never
}

async function makeServiceAccount(label: string, scopes: string[]): Promise<string> {
  const apiKey = randomUUID()
  await payload.create({
    collection: 'service-accounts',
    data: { label, purpose: 'mnscr', active: true, scopes, apiKey, enableAPIKey: true } as never,
    overrideAccess: true,
  })
  return apiKey
}

async function post(body: unknown, apiKey: string | null): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (apiKey !== null) headers.Authorization = apiKeyAuthorization('service-accounts', apiKey)
  return fetch(`${baseUrl}${INGEST_PATH}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

function payloadFor(overrides: Record<string, unknown>, bytes: Buffer, contentType: string) {
  return {
    articleId: String(articleId),
    sourceUrl: 'https://exemplo.com/imprensa/foto-oficial.jpg',
    sourceName: 'Estudio Exemplo',
    rightsHolder: 'Estudio Exemplo',
    credit: 'Divulgacao/Estudio Exemplo',
    alt: 'Cena oficial do filme',
    contentType,
    contentBase64: bytes.toString('base64'),
    ...overrides,
  }
}

beforeAll(async () => {
  harness = await startCmsHarness()
  payload = harness.payload
  baseUrl = harness.baseUrl

  const chief = await payload.create({
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
  chiefId = Number(chief.id)

  ingestKey = await makeServiceAccount('mnscr — midia', ['editorial_media_ingest'])
  // Conta com o escopo de TEXTO, para provar que ele nao habilita foto.
  draftOnlyKey = await makeServiceAccount('mnscr — texto', ['draft_ingest'])

  const article = await payload.create({
    collection: 'articles',
    data: {
      title: 'Materia de teste da ingestao de midia',
      slug: `ingestao-midia-${randomUUID().slice(0, 8)}`,
      language: 'pt-BR',
      workflowStatus: 'draft',
    } as never,
    overrideAccess: true,
    user: await userDoc(chiefId),
  })
  articleId = Number(article.id)
}, 300_000)

afterAll(async () => {
  await harness?.stop()
})

describe('escopo — o enum existe no banco e separa foto de texto', () => {
  it('sem credencial: 401', async () => {
    const jpeg = await decodableJpegBytes(64, 48)
    const response = await post(payloadFor({}, jpeg, 'image/jpeg'), null)
    expect(response.status).toBe(401)
  })

  it('conta com draft_ingest NAO sobe foto: 403', async () => {
    // O escopo de texto e o de foto sao disjuntos DE PROPOSITO. Se este teste
    // virar verde com 201, a separacao existe so no comentario.
    const jpeg = await decodableJpegBytes(64, 48)
    const response = await post(payloadFor({}, jpeg, 'image/jpeg'), draftOnlyKey)
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: 'forbidden_scope' })
  })

  it('o valor editorial_media_ingest esta GRAVADO no enum do PostgreSQL', async () => {
    // A conta foi criada com esse escopo no `beforeAll`; se o enum nao tivesse o
    // valor, a criacao teria falhado com erro de driver. A releitura confirma
    // que o valor sobreviveu ao round-trip do banco.
    const found = await payload.find({
      collection: 'service-accounts',
      where: { label: { equals: 'mnscr — midia' } },
      limit: 1,
      overrideAccess: true,
    })
    expect(found.docs[0]?.scopes).toEqual(['editorial_media_ingest'])
  })
})

describe('ingestao — a foto entra e nasce servivel', () => {
  let firstMediaId = ''
  let firstHash = ''

  it('POST valido cria a midia e devolve 201', async () => {
    const jpeg = await decodableJpegBytes(320, 200, 1)
    const response = await post(payloadFor({}, jpeg, 'image/jpeg'), ingestKey)
    expect(response.status).toBe(201)
    const body = (await response.json()) as Record<string, string | undefined>
    expect(body.outcome).toBe('created')
    expect(body.mediaId).toBeTruthy()
    expect(body.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    firstMediaId = body.mediaId ?? ''
    firstHash = body.contentHash ?? ''
  })

  it('os BYTES chegaram: arquivo, tamanho e miniatura', async () => {
    const doc = await payload.findByID({
      collection: 'media',
      id: Number(firstMediaId),
      overrideAccess: true,
    })
    expect(doc.filename).toMatch(/^mnscr-[0-9a-f]{32}\.jpg$/)
    expect(Number(doc.filesize)).toBeGreaterThan(0)
    expect(doc.mimeType).toBe('image/jpeg')
    // `imageSizes` gera a miniatura no upload real. Fixture so-cabecalho
    // quebraria exatamente aqui.
    expect(doc.sizes?.thumbnail?.filename).toBeTruthy()
  })

  it('nasce APROVADA e liberada para editorial e capa — decisao do operador', async () => {
    const doc = await payload.findByID({
      collection: 'media',
      id: Number(firstMediaId),
      overrideAccess: true,
    })
    expect(doc.licenseStatus).toBe('approved')
    expect(doc.allowedForEditorial).toBe(true)
    expect(doc.allowedForHero).toBe(true)
    // Social fica FALSE: card de rede social e outra superficie, com outro
    // acordo de uso. Ligar por simetria seria decidir sem base.
    expect(doc.allowedForSocial).toBe(false)
  })

  it('a PROVENIENCIA inteira foi gravada — e o que responde reclamacao', async () => {
    const doc = await payload.findByID({
      collection: 'media',
      id: Number(firstMediaId),
      overrideAccess: true,
    })
    expect(doc.credit).toBe('Divulgacao/Estudio Exemplo')
    expect(doc.sourceName).toBe('Estudio Exemplo')
    expect(doc.sourceUrl).toBe('https://exemplo.com/imprensa/foto-oficial.jpg')
    expect(doc.rightsHolder).toBe('Estudio Exemplo')
    expect(doc.requiresAttribution).toBe(true)
    expect(doc.contentHash).toBe(firstHash)
  })

  it('a coluna nova aponta para a materia (metade da chave de idempotencia)', async () => {
    const doc = await payload.findByID({
      collection: 'media',
      id: Number(firstMediaId),
      depth: 0,
      overrideAccess: true,
    })
    expect(Number(doc.ingestedForArticle)).toBe(articleId)
  })

  it('a midia ingerida PASSA no gate de entrega do worker', async () => {
    // O circuito so fecha aqui. Sem este 200, a foto entraria no acervo e
    // morreria calada em `authorizeMediaDelivery` com `attribution_missing` ou
    // `license_not_approved`.
    const response = await fetch(
      `${baseUrl}/api/internal/publication-media/${firstMediaId}?purpose=hero`,
      { headers: { Authorization: apiKeyAuthorization('service-accounts', await projectionKey()) } },
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(bytes.length).toBeGreaterThan(0)
    // Assinatura JPEG real de volta.
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xff, 0xd8, 0xff])
  })

  it('reenvio IDENTICO nao duplica: unchanged, mesmo mediaId', async () => {
    // O caso normal: o MNScr reprocessa a materia a cada revisao e reenvia a
    // mesma foto.
    const jpeg = await decodableJpegBytes(320, 200, 1)
    const response = await post(payloadFor({}, jpeg, 'image/jpeg'), ingestKey)
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, string>
    expect(body.outcome).toBe('unchanged')
    expect(body.mediaId).toBe(firstMediaId)

    const all = await payload.find({
      collection: 'media',
      where: { sourceUrl: { equals: 'https://exemplo.com/imprensa/foto-oficial.jpg' } },
      limit: 50,
      overrideAccess: true,
    })
    expect(all.totalDocs).toBe(1)
  })

  it('mesma url com conteudo DIFERENTE vira replaced, e a entrada antiga fica', async () => {
    // A fonte trocou a foto no mesmo endereco. Sobrescrever em silencio apagaria
    // uma imagem que ja pode estar publicada e servida por caminho derivado do
    // conteudo.
    const outra = await decodableJpegBytes(320, 200, 9)
    const response = await post(payloadFor({}, outra, 'image/jpeg'), ingestKey)
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, string>
    expect(body.outcome).toBe('replaced')
    expect(body.mediaId).not.toBe(firstMediaId)

    const antiga = await payload.findByID({
      collection: 'media',
      id: Number(firstMediaId),
      overrideAccess: true,
    })
    expect(antiga.id).toBeTruthy()
  })
})

describe('a mesma foto em DUAS materias nao colide', () => {
  it('cada materia tem a sua entrada, com o proprio alt', async () => {
    // Com chave por CONTEUDO isto colidiria e a segunda materia herdaria o `alt`
    // escrito para a primeira. A chave e (materia, url) por causa deste caso.
    const outroArtigo = await payload.create({
      collection: 'articles',
      data: {
        title: 'Segunda materia com a mesma foto',
        slug: `segunda-materia-${randomUUID().slice(0, 8)}`,
        language: 'pt-BR',
        workflowStatus: 'draft',
      } as never,
      overrideAccess: true,
      user: await userDoc(chiefId),
    })

    const png = await decodablePngBytes(200, 150, 3)
    const url = 'https://exemplo.com/imprensa/compartilhada.png'

    const a = await post(
      payloadFor({ sourceUrl: url, alt: 'Alt da primeira materia' }, png, 'image/png'),
      ingestKey,
    )
    const b = await post(
      {
        ...payloadFor({ sourceUrl: url, alt: 'Alt da segunda materia' }, png, 'image/png'),
        articleId: String(outroArtigo.id),
      },
      ingestKey,
    )

    expect(a.status).toBe(201)
    expect(b.status).toBe(201)
    const bodyA = (await a.json()) as Record<string, string>
    const bodyB = (await b.json()) as Record<string, string>
    expect(bodyA.mediaId).not.toBe(bodyB.mediaId)
    // Mesmo conteudo, mesmo hash — e ainda assim duas entradas.
    expect(bodyA.contentHash).toBe(bodyB.contentHash)

    const docB = await payload.findByID({
      collection: 'media',
      id: Number(bodyB.mediaId),
      overrideAccess: true,
    })
    expect(docB.alt).toBe('Alt da segunda materia')
  })
})

describe('recusas que chegam ao EMISSOR', () => {
  it('materia inexistente: 404 nomeado', async () => {
    const jpeg = await decodableJpegBytes(64, 48)
    const response = await post(
      payloadFor({ articleId: '999999' }, jpeg, 'image/jpeg'),
      ingestKey,
    )
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: 'article_not_found' })
  })

  it('sem credito: 422 com o campo nomeado, ANTES de gravar', async () => {
    // Este e o desenho inteiro: como a licenca nao bloqueia na saida, a
    // proveniencia e exigida na entrada, onde ha um emissor escutando.
    const jpeg = await decodableJpegBytes(64, 48)
    const response = await post(
      payloadFor({ credit: undefined, sourceUrl: 'https://exemplo.com/sem-credito.jpg' }, jpeg, 'image/jpeg'),
      ingestKey,
    )
    expect(response.status).toBe(422)
    const body = (await response.json()) as { error: string; issues: string[] }
    expect(body.error).toBe('validation_failed')
    expect(body.issues.join(' ')).toContain('credit ausente')

    const nenhuma = await payload.find({
      collection: 'media',
      where: { sourceUrl: { equals: 'https://exemplo.com/sem-credito.jpg' } },
      limit: 1,
      overrideAccess: true,
    })
    expect(nenhuma.totalDocs).toBe(0)
  })

  it('SVG disfarcado de PNG: 415 dizendo QUE formato era', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>', 'utf8')
    const response = await post(
      payloadFor({ sourceUrl: 'https://exemplo.com/svg.png' }, svg, 'image/png'),
      ingestKey,
    )
    expect(response.status).toBe(415)
    const body = (await response.json()) as { error: string; issues: string[] }
    expect(body.error).toBe('dangerous_format')
    expect(body.issues.join(' ')).toContain('svg_or_xml')
  })

  it('contentType MENTINDO sobre os bytes: 415', async () => {
    const png = await decodablePngBytes(64, 48, 5)
    const response = await post(
      payloadFor({ sourceUrl: 'https://exemplo.com/mentira.jpg' }, png, 'image/jpeg'),
      ingestKey,
    )
    expect(response.status).toBe(415)
    expect(await response.json()).toMatchObject({ error: 'bytes_mismatch' })
  })
})


/** Conta com o escopo do worker, criada sob demanda para o teste de entrega. */
let cachedProjectionKey = ''
async function projectionKey(): Promise<string> {
  if (cachedProjectionKey === '') {
    cachedProjectionKey = await makeServiceAccount('worker — projecao', ['publication_projection'])
  }
  return cachedProjectionKey
}
