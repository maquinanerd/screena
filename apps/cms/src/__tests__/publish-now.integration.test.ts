/**
 * O botao "Publicar" de um clique, contra um Payload e um PostgreSQL de verdade.
 *
 * POR QUE ESTE ARQUIVO EXISTE, E NAO SO O TESTE PURO.
 *
 * `publish-path.test.ts` prova que o PLANO nao pula degrau. Isso e metade da
 * promessa. A outra metade — que o servidor realmente SOBE os degraus, que cada
 * um passa pelos hooks, e que um gate barrado nao move nada — so aparece com o
 * runtime ligado. Um endpoint que respondesse 200 sem escrever nada passaria no
 * teste puro sem hesitar.
 *
 * A suite roda em Node 24 porque `vitest.integration.config.ts` inlina
 * `drizzle-orm`/`@payloadcms`; o E2E de navegador nao tem esse desvio e exige
 * Node 22.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { startCmsHarness, type CmsHarness } from './harness.js'

let harness: CmsHarness
let payload: CmsHarness['payload']
let baseUrl = ''

const SENHA = 'senha-de-teste-publish-now-0123456789'
const tokens: Record<string, string> = {}
const userIds: Record<string, number> = {}
let authorId = 0

/**
 * `overrideAccess: true` dispensa o ACCESS CONTROL, nao o ATOR: o hook de
 * governanca exige saber quem escreve, e recusa escrita anonima mesmo pela
 * Local API. Por isso a fixture se identifica.
 */
async function userDoc(role: string): Promise<unknown> {
  return payload.findByID({
    collection: 'editorial-users',
    id: userIds[role] ?? 0,
    overrideAccess: true,
  })
}

async function login(role: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/editorial-users/login`, {
    body: JSON.stringify({ email: `${role}@publish-now.test`, password: SENHA }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  const text = await response.text()
  let body: { token?: string } = {}
  try {
    body = JSON.parse(text) as { token?: string }
  } catch {
    throw new Error(`login ${role} nao devolveu JSON (${String(response.status)}): ${text.slice(0, 200)}`)
  }
  return String(body.token ?? '')
}

/** Materia pronta para publicar, faltando so a subida. */
async function makeReadyArticle(suffix: string): Promise<number> {
  const created = await payload.create({
    collection: 'articles',
    data: {
      title: `Materia pronta ${suffix}`,
      slug: `materia-pronta-${suffix}`,
      // O contrato de saida exige resumo nao-vazio: sem ele a subida chega a
      // `ready_to_publish` e morre no ultimo degrau, que e outro teste.
      summary: 'Resumo editorial proprio da redacao, escrito para o teste.',
      language: 'pt-BR',
      contentType: 'news',
      workflowStatus: 'draft',
      authors: [authorId],
      // O gate exige QA aprovado. Sem isto o teste mediria o bloqueio, nao a subida.
      qaPassedAt: new Date().toISOString(),
      body: [{ blockType: 'paragraph', blockId: `b-${suffix}`, text: 'Corpo proprio da redacao.' }],
    } as never,
    overrideAccess: true,
    user: (await userDoc('administrator')) as never,
  })
  return Number(created.id)
}

async function publishNow(id: number, token: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api/internal/publish-now`, {
    body: JSON.stringify({ id: String(id) }),
    headers: {
      'content-type': 'application/json',
      // Mesma forma que o resto da suite usa para identidade humana.
      ...(token === '' ? {} : { Authorization: `JWT ${token}` }),
    },
    method: 'POST',
  })
  const text = await response.text()
  let body: Record<string, unknown> = {}
  try {
    body = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error(`resposta nao-JSON (${String(response.status)}): ${text.slice(0, 300)}`)
  }
  return { status: response.status, body }
}

async function readArticle(id: number): Promise<Record<string, unknown>> {
  return (await payload.findByID({
    collection: 'articles',
    id,
    overrideAccess: true,
  })) as unknown as Record<string, unknown>
}

beforeAll(async () => {
  harness = await startCmsHarness()
  payload = harness.payload
  baseUrl = harness.baseUrl

  for (const role of ['administrator', 'editor', 'writer']) {
    const user = await payload.create({
      collection: 'editorial-users',
      data: {
        email: `${role}@publish-now.test`,
        password: SENHA,
        displayName: role,
        role,
        active: true,
      } as never,
      overrideAccess: true,
    })
    userIds[role] = Number(user.id)
    tokens[role] = await login(role)
  }

  const author = await payload.create({
    collection: 'authors',
    data: { name: 'Redacao Cinerie', slug: 'redacao-cinerie-publish-now', active: true } as never,
    overrideAccess: true,
  })
  authorId = Number(author.id)
}, 300_000)

afterAll(async () => {
  await harness?.stop?.()
}, 120_000)

describe('POST /api/internal/publish-now', () => {
  it('leva a materia de draft a published numa requisicao', async () => {
    const id = await makeReadyArticle('feliz')
    const { status, body } = await publishNow(id, tokens.administrator ?? '')

    expect(status, JSON.stringify(body)).toBe(200)
    expect(body.ok).toBe(true)
    // Os cinco degraus, na ordem — nao um salto.
    expect(body.walked).toEqual([
      'needs_review',
      'in_review',
      'human_reviewed',
      'ready_to_publish',
      'published',
    ])

    const article = await readArticle(id)
    expect(article.workflowStatus).toBe('published')
    // `_status` e DERIVADO: se ficasse em draft, a materia estaria "publicada"
    // so no enum editorial e invisivel para o resto do sistema.
    expect(article._status).toBe('published')
    expect(article.publishedAt).toBeTruthy()
  }, 120_000)

  it('o rastro guarda as cinco transicoes, nao so o resultado', async () => {
    const id = await makeReadyArticle('rastro')
    await publishNow(id, tokens.administrator ?? '')

    const versions = await payload.findVersions({
      collection: 'articles',
      where: { parent: { equals: id } },
      limit: 200,
      overrideAccess: true,
    })
    const seen = new Set(
      versions.docs.map((doc) =>
        String((doc.version as unknown as Record<string, unknown>).workflowStatus),
      ),
    )
    // Era este o requisito da fase: juntar os CLIQUES, nunca as transicoes.
    for (const step of ['needs_review', 'in_review', 'human_reviewed', 'ready_to_publish', 'published']) {
      expect(seen, `faltou ${step} no rastro`).toContain(step)
    }
  }, 120_000)

  it('publicar emite UM evento de publicacao na outbox', async () => {
    const id = await makeReadyArticle('outbox')
    await publishNow(id, tokens.administrator ?? '')

    const outbox = await payload.find({
      collection: 'publication-outbox',
      where: { aggregateId: { equals: String(id) } },
      limit: 50,
      overrideAccess: true,
    })
    // Cinco degraus, mas so o ultimo e publicacao. Um evento por degrau
    // inundaria o worker com atualizacoes que nao aconteceram.
    expect(outbox.docs).toHaveLength(1)
    expect(String(outbox.docs[0]?.eventType)).toBe('article.published')
  }, 120_000)

  it('gate barrado NAO move nenhum degrau — a materia continua em draft', async () => {
    // O caso que motivou o pre-voo. Sem autor ativo, uma subida ingenua andaria
    // quatro degraus e morreria no quinto, deixando a materia em
    // `ready_to_publish` — estado que AFIRMA revisao e liberacao que nao houve.
    const created = await payload.create({
      collection: 'articles',
      data: {
        title: 'Materia sem autor',
        slug: 'materia-sem-autor',
        language: 'pt-BR',
        contentType: 'news',
        workflowStatus: 'draft',
        qaPassedAt: new Date().toISOString(),
      } as never,
      overrideAccess: true,
      user: (await userDoc('administrator')) as never,
    })
    const id = Number(created.id)

    const { status, body } = await publishNow(id, tokens.administrator ?? '')
    expect(status).toBe(422)
    expect(body.error).toBe('blocked')
    expect(body.reasons).toContain('missing_active_author')

    const article = await readArticle(id)
    expect(article.workflowStatus, 'nada pode ter se movido').toBe('draft')
    expect(article._status).not.toBe('published')
  }, 120_000)

  it('editor avanca ate a fronteira da alcada e NAO publica', async () => {
    // MUDANCA DELIBERADA DE COMPORTAMENTO (amarra 2). Antes a recusa era seca e
    // a materia nao saia do lugar: a pessoa apertava "Publicar", nada mudava, e
    // apertava de novo. Agora a materia anda ate onde o papel alcanca e a tela
    // diz o que faltou. O que NAO pode mudar e o teto: `editor` nao publica.
    const id = await makeReadyArticle('editor')
    const { status, body } = await publishNow(id, tokens.editor ?? '')

    expect(status, JSON.stringify(body)).toBe(200)
    expect(body.partial).toBe(true)
    expect(body.reason).toBe('forbidden_for_role')
    expect(body.stoppedAt).toBe('ready_to_publish')

    const article = await readArticle(id)
    expect(article.workflowStatus).toBe('ready_to_publish')
    // A trava de governanca continua inteira.
    expect(article.workflowStatus).not.toBe('published')
    expect(article._status).not.toBe('published')
  }, 120_000)

  it('writer para em needs_review, que e onde a alcada dele termina', async () => {
    const id = await makeReadyArticle('writer')
    const { status, body } = await publishNow(id, tokens.writer ?? '')

    expect(status, JSON.stringify(body)).toBe(200)
    expect(body.partial).toBe(true)
    expect(body.stoppedAt).toBe('needs_review')

    const article = await readArticle(id)
    expect(article.workflowStatus).toBe('needs_review')
    expect(article._status).not.toBe('published')
  }, 120_000)

  it('AMARRA: o carimbo do colapso sai IDENTICO nas cinco linhas de versao', async () => {
    // A prova central. Sem ela, "as cinco linhas carregam o mesmo carimbo" e uma
    // afirmacao de commit, nao um fato verificado — e e justamente o que impede
    // o trilho de parecer revisao de terceiro.
    const id = await makeReadyArticle('carimbo')
    const { status } = await publishNow(id, tokens.administrator ?? '')
    expect(status).toBe(200)

    const versions = await payload.findVersions({
      collection: 'articles',
      where: { parent: { equals: id } },
      limit: 200,
      overrideAccess: true,
    })

    const stamped = versions.docs
      .map((doc) => doc.version as unknown as Record<string, unknown>)
      .filter((version) => version.collapseId !== null && version.collapseId !== undefined)

    // Os cinco degraus da escada completa.
    expect(stamped.length).toBeGreaterThanOrEqual(5)

    const ids = new Set(stamped.map((version) => String(version.collapseId)))
    const ats = new Set(stamped.map((version) => String(version.collapsedAt)))
    const froms = new Set(stamped.map((version) => String(version.collapsedFrom)))
    const reasons = new Set(stamped.map((version) => String(version.collapseReason)))

    // UM valor para cada campo em TODAS as linhas — e isso que as agrupa como
    // uma unica operacao.
    expect(ids.size, 'collapseId deveria ser o mesmo nas cinco').toBe(1)
    expect(ats.size, 'collapsedAt deveria ser o mesmo nas cinco').toBe(1)
    expect(froms).toEqual(new Set(['draft']))
    expect(reasons).toEqual(new Set(['publicacao_direta']))

    // CONTROLE NEGATIVO: `updatedAt` NAO foi sobrescrito — ele continua honesto
    // sobre quando cada linha foi escrita. Se alguem "consertar" isso igualando
    // os `updatedAt`, este teste avisa.
    const updatedAts = new Set(stamped.map((version) => String(version.updatedAt)))
    expect(updatedAts.size, 'updatedAt deveria VARIAR entre as linhas').toBeGreaterThan(1)
  }, 120_000)

  it('AMARRA: humano nao consegue FORJAR o carimbo pela API', async () => {
    // O carimbo so pode vir de um colapso de verdade. Se o formulario pudesse
    // escrever, daria para afirmar "publicacao direta" numa materia que passou
    // por revisao — ou apagar a marca de um colapso real.
    const id = await makeReadyArticle('forja')
    const response = await fetch(`${baseUrl}/api/articles/${String(id)}`, {
      body: JSON.stringify({
        collapseId: 'forjado-por-humano',
        collapseReason: 'invencao',
        collapsedFrom: 'published',
      }),
      headers: {
        'content-type': 'application/json',
        Authorization: `JWT ${tokens.administrator ?? ''}`,
      },
      method: 'PATCH',
    })
    expect(response.status).toBeLessThan(500)

    const article = await readArticle(id)
    expect(article.collapseId, 'o campo forjado nao pode ter sido gravado').not.toBe(
      'forjado-por-humano',
    )
    expect(article.collapseReason).not.toBe('invencao')
  }, 120_000)

  it('anonimo e recusado antes de qualquer leitura do acervo', async () => {
    const id = await makeReadyArticle('anon')
    const { status } = await publishNow(id, '')
    expect(status).toBe(403)
    expect((await readArticle(id)).workflowStatus).toBe('draft')
  }, 120_000)

  it('publicar de novo nao acontece: ja publicada nao gera plano', async () => {
    const id = await makeReadyArticle('duas-vezes')
    expect((await publishNow(id, tokens.administrator ?? '')).status).toBe(200)

    const again = await publishNow(id, tokens.administrator ?? '')
    expect(again.status).toBe(409)
    expect(again.body.reason).toBe('already_published')
  }, 120_000)
})
