/**
 * REVISAO ATUALIZA A MATERIA — nao cria outra.
 *
 * Este arquivo existe por causa de um defeito que nenhum teste anterior podia
 * pegar: a busca pela materia existente usava `automationIdempotencyKey`, uma
 * chave que MUDA a cada revisao. Nenhum pedido de update encontrava nada,
 * `existingId` nascia nulo e a persistencia caia sempre no `create`. O sintoma
 * so aparece com DUAS revisoes do MESMO cluster — e todo teste ate aqui mandava
 * uma so, com cluster novo a cada pedido.
 *
 * A consequencia era dupla e as duas metades sao provadas aqui:
 *
 *  1. Duplicacao. Com a indexacao ligada, rev-1, rev-2 e rev-3 virariam tres
 *     URLs distintas competindo entre si no indice.
 *  2. QUATRO GUARDAS DORMENTES. `staleRevision`, `authorChangeRequiresHuman`,
 *     `ENTITY_LINK_NOT_REAPPLIED` e `idempotencyConflict` dependem todas de
 *     `existing`. Com `existing` sempre nulo, nenhuma delas jamais rodou num
 *     update real: estavam escritas, tinham teste de unidade, e em producao
 *     nunca foram exercidas. Acordam todas juntas com esta correcao — por isso
 *     cada uma chega aqui com um cenario ponta a ponta, contra HTTP e banco
 *     reais, e nao so contra a funcao pura.
 *
 * As envs sao definidas ANTES do import do harness: o servidor e um processo
 * separado e herda o ambiente no `spawn`.
 */

import { randomUUID } from 'node:crypto'

process.env.EDITORIAL_AUTO_PUBLISH_ENABLED = 'true'
process.env.EDITORIAL_AUTO_PUBLISH_DAILY_LIMIT = '200'
process.env.EDITORIAL_AUTO_PUBLISH_PER_AUTHOR_LIMIT = '100'
process.env.EDITORIAL_AUTO_PUBLISH_PER_SECTION_LIMIT = '150'
process.env.EDITORIAL_AUTO_PUBLISH_PER_CONTENT_TYPE_LIMIT = '150'
// Folgado de proposito: aqui o alvo e a CHAVE do contador de atualizacao, nao o
// esgotamento dele (que ja tem cenario proprio em `quota.integration.test.ts`).
process.env.EDITORIAL_AUTO_PUBLISH_PER_ARTICLE_UPDATE_LIMIT = '10'
process.env.EDITORIAL_AUTO_PUBLISH_TIME_ZONE = 'America/Sao_Paulo'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'

import { validPublicationRequest } from '@screena/editorial-contracts'

import { apiKeyAuthorization, startCmsHarness, type CmsHarness } from './harness.js'

let harness: CmsHarness
let payload: Payload
let baseUrl: string
let publisherKey = ''
let authorId = ''
let otherAuthorId = ''
/**
 * O EDITOR-CHEFE que faz a curadoria a mao.
 *
 * `overrideAccess` nao basta: `enforceEditorialGovernance` recusa escrita sem
 * ator autenticado, e essa recusa esta certa — um teste que a contornasse
 * estaria provando um caminho que producao nao tem.
 */
let humanEditor: Record<string, unknown> | null = null

/** Hash de 64 hex — a forma que o contrato exige. */
function hash64(seed: string): string {
  const base = seed.replace(/[^a-f0-9]/gi, '').toLowerCase()
  return (base + '0'.repeat(64)).slice(0, 64)
}

interface RevisionInput {
  readonly cluster: string
  readonly revision: number
  readonly slugSuggestion: string
  readonly intent: 'publish' | 'update'
  readonly targetArticleId?: string
  readonly authorId?: string
  readonly payloadHash?: string
  readonly entityLinks?: readonly unknown[]
  readonly title?: string
}

/**
 * Um pedido de UMA revisao de UM cluster.
 *
 * O que muda entre revisoes e exatamente o que muda na vida real: `requestId`,
 * `idempotencyKey` e `sourceRevision`. O `sourceClusterId` NAO muda — e essa
 * estabilidade que a correcao passa a usar como identidade.
 */
function revisionBody(input: RevisionInput): Record<string, unknown> {
  const id = randomUUID()
  return {
    ...validPublicationRequest,
    media: [],
    requestId: `req-${id}`,
    idempotencyKey: `mnscr:${input.cluster}:rev-${String(input.revision)}`,
    sourceClusterId: input.cluster,
    sourceRevision: input.revision,
    sourcePayloadHash: input.payloadHash ?? hash64(`${input.cluster}${String(input.revision)}`),
    publicationIntent: input.intent,
    ...(input.targetArticleId === undefined ? {} : { targetArticleId: input.targetArticleId }),
    publicAuthorId: input.authorId ?? authorId,
    title: input.title ?? validPublicationRequest.title,
    entityLinks: input.entityLinks ?? [],
    seo: {
      ...validPublicationRequest.seo,
      imageAltSuggestions: [],
      slugSuggestion: input.slugSuggestion,
    },
  }
}

async function publish(body: Record<string, unknown>): Promise<{
  status: number
  body: Record<string, unknown>
}> {
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

/** Quantas materias existem para este cluster. */
async function articlesForCluster(cluster: string): Promise<Record<string, unknown>[]> {
  const found = await payload.find({
    collection: 'articles',
    where: { sourceClusterId: { equals: cluster } },
    limit: 20,
    depth: 0,
    sort: 'createdAt',
    overrideAccess: true,
  })
  return found.docs as unknown as Record<string, unknown>[]
}

/** Quantas materias existem com esta slug base (pega duplicata com slug -2). */
async function articlesWithSlugPrefix(prefix: string): Promise<number> {
  const found = await payload.count({
    collection: 'articles',
    where: { slug: { like: prefix } },
    overrideAccess: true,
  })
  return found.totalDocs
}

async function articleById(id: string): Promise<Record<string, unknown>> {
  return (await payload.findByID({
    collection: 'articles',
    id,
    depth: 0,
    overrideAccess: true,
  })) as unknown as Record<string, unknown>
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

function warningCodes(body: Record<string, unknown>): string[] {
  const details = body.warningDetails
  if (!Array.isArray(details)) return []
  return details.map((entry) => String((entry as { code?: unknown }).code ?? ''))
}

function reasonCodes(body: Record<string, unknown>): string[] {
  const reasons = body.reasons
  if (!Array.isArray(reasons)) return []
  return reasons.map((entry) => String((entry as { code?: unknown }).code ?? ''))
}

/* ------------------------------------------------------------------ */
/* Setup                                                              */
/* ------------------------------------------------------------------ */

beforeAll(async () => {
  harness = await startCmsHarness()
  payload = harness.payload
  baseUrl = harness.baseUrl

  const key = randomUUID()
  await payload.create({
    collection: 'service-accounts',
    data: {
      label: 'mnscr-publisher-revisoes',
      purpose: 'mnscr',
      active: true,
      scopes: ['editorial_auto_publish'],
      enableAPIKey: true,
      apiKey: key,
    } as never,
    overrideAccess: true,
  })
  publisherKey = key

  const makeAuthor = async (name: string): Promise<string> => {
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
      } as never,
      overrideAccess: true,
    })
    return String(created.id)
  }

  authorId = await makeAuthor('Redacao Revisoes')
  otherAuthorId = await makeAuthor('Redacao Revisoes Dois')

  const editor = await payload.create({
    collection: 'editorial-users',
    data: {
      email: `curadoria-${randomUUID().slice(0, 8)}@cinerie.test`,
      password: randomUUID(),
      displayName: 'Curadoria Humana',
      role: 'editor_in_chief',
      active: true,
    } as never,
    overrideAccess: true,
  })
  humanEditor = { ...(editor as unknown as Record<string, unknown>), collection: 'editorial-users' }
}, 900_000)

afterAll(async () => {
  await harness?.stop()
}, 180_000)

/* ------------------------------------------------------------------ */
/* 1. A revisao ATUALIZA                                              */
/* ------------------------------------------------------------------ */

describe('revisao do mesmo cluster', () => {
  it('rev-2 atualiza a materia de rev-1 em vez de criar outra', async () => {
    const cluster = `cluster-${randomUUID().slice(0, 8)}`
    const slug = `revisao-atualiza-${randomUUID().slice(0, 8)}`

    const first = await publish(
      revisionBody({ cluster, revision: 1, slugSuggestion: slug, intent: 'publish' }),
    )
    expect(first.status).toBe(201)
    const firstId = String(first.body.articleId ?? '')
    expect(firstId).not.toBe('')

    const second = await publish(
      revisionBody({
        cluster,
        revision: 2,
        slugSuggestion: slug,
        intent: 'update',
        targetArticleId: firstId,
        title: 'Estudio antecipa a data de estreia da nova serie',
      }),
    )

    expect(second.status).toBe(201)
    // O MESMO id: e isto que separa "atualizou" de "duplicou".
    expect(String(second.body.articleId ?? '')).toBe(firstId)

    const docs = await articlesForCluster(cluster)
    expect(docs).toHaveLength(1)
    expect(String(docs[0]?.id)).toBe(firstId)
    // Sem `-2` pendurada: a duplicata antiga nascia com slug derivada, e era ela
    // que viraria a segunda URL no indice.
    expect(await articlesWithSlugPrefix(`${slug}%`)).toBe(1)

    // O conteudo novo ENTROU — atualizar nao pode virar no-op silencioso.
    const doc = await articleById(firstId)
    expect(String(doc.title)).toBe('Estudio antecipa a data de estreia da nova serie')
    expect(Number(doc.automationSourceRevision)).toBe(2)
    // A identidade do cluster fica gravada: e a chave que a proxima revisao usa.
    expect(String(doc.sourceClusterId)).toBe(cluster)
  })

  it('materia criada por `publish` ja nasce com o cluster gravado', async () => {
    // Sem esta gravacao a busca nova nao acha nada e a revisao seguinte duplica
    // de novo — o defeito voltaria inteiro por uma linha ausente.
    const cluster = `cluster-${randomUUID().slice(0, 8)}`
    const result = await publish(
      revisionBody({
        cluster,
        revision: 1,
        slugSuggestion: `cluster-gravado-${randomUUID().slice(0, 8)}`,
        intent: 'publish',
      }),
    )
    expect(result.status).toBe(201)
    const doc = await articleById(String(result.body.articleId))
    expect(String(doc.sourceClusterId)).toBe(cluster)
  })
})

/* ------------------------------------------------------------------ */
/* 2. As quatro guardas dormentes                                     */
/* ------------------------------------------------------------------ */

describe('guardas que so existem quando a materia e encontrada', () => {
  it('revisao FORA DE ORDEM e recusada (staleRevision)', async () => {
    const cluster = `cluster-${randomUUID().slice(0, 8)}`
    const slug = `fora-de-ordem-${randomUUID().slice(0, 8)}`

    const first = await publish(
      revisionBody({ cluster, revision: 5, slugSuggestion: slug, intent: 'publish' }),
    )
    expect(first.status).toBe(201)
    const articleId = String(first.body.articleId)

    // Evento antigo chegando depois — o caso classico de fila fora de ordem.
    const late = await publish(
      revisionBody({
        cluster,
        revision: 4,
        slugSuggestion: slug,
        intent: 'update',
        targetArticleId: articleId,
        title: 'Versao ANTIGA que nao pode sobrescrever a nova',
      }),
    )

    expect(late.status).toBe(409)
    expect(reasonCodes(late.body)).toContain('stale_revision')

    // E o mais importante: a materia NAO regrediu.
    const doc = await articleById(articleId)
    expect(Number(doc.automationSourceRevision)).toBe(5)
    expect(String(doc.title)).not.toBe('Versao ANTIGA que nao pode sobrescrever a nova')
  })

  it('TROCA DE AUTOR em materia publicada vai para revisao humana', async () => {
    const cluster = `cluster-${randomUUID().slice(0, 8)}`
    const slug = `troca-de-autor-${randomUUID().slice(0, 8)}`

    const first = await publish(
      revisionBody({ cluster, revision: 1, slugSuggestion: slug, intent: 'publish' }),
    )
    expect(first.status).toBe(201)
    const articleId = String(first.body.articleId)

    const second = await publish(
      revisionBody({
        cluster,
        revision: 2,
        slugSuggestion: slug,
        intent: 'update',
        targetArticleId: articleId,
        authorId: otherAuthorId,
        title: 'Materia reassinada por outra pessoa',
      }),
    )

    expect(second.status).toBe(202)
    expect(second.body.outcome).toBe('ROUTED_TO_REVIEW')
    expect(reasonCodes(second.body)).toContain('AUTHOR_CHANGE_REQUIRES_HUMAN')

    // METADE DE UM UPDATE E PIOR QUE NENHUM: a assinatura antiga continua, e o
    // corpo novo NAO entrou junto com ela.
    const doc = await articleById(articleId)
    expect(String(doc.primaryAuthor)).toBe(authorId)
    expect(String(doc.title)).not.toBe('Materia reassinada por outra pessoa')
  })

  it('VINCULO CURADO por humano sobrevive a atualizacao', async () => {
    const cluster = `cluster-${randomUUID().slice(0, 8)}`
    const slug = `vinculo-curado-${randomUUID().slice(0, 8)}`
    const link = {
      entityKind: 'tv',
      entityId: '12345',
      relation: 'primary_subject',
      confidence: 0.95,
    }

    const first = await publish(
      revisionBody({
        cluster,
        revision: 1,
        slugSuggestion: slug,
        intent: 'publish',
        entityLinks: [link],
      }),
    )
    expect(first.status).toBe(201)
    const articleId = String(first.body.articleId)

    // O humano confirma o vinculo no admin. E exatamente esta decisao que uma
    // reescrita automatica apagaria, devolvendo tudo a `verified: false`.
    const created = await articleById(articleId)
    const refs = created.entityReferences as Record<string, unknown>[]
    expect(refs).toHaveLength(1)
    await payload.update({
      collection: 'articles',
      id: articleId,
      data: {
        entityReferences: refs.map((row) => ({ ...row, verified: true })),
      } as never,
      overrideAccess: true,
      user: humanEditor as never,
    })

    const second = await publish(
      revisionBody({
        cluster,
        revision: 2,
        slugSuggestion: slug,
        intent: 'update',
        targetArticleId: articleId,
        entityLinks: [link],
      }),
    )
    expect(second.status).toBe(201)
    expect(warningCodes(second.body)).toContain('ENTITY_LINK_NOT_REAPPLIED')

    const after = await articleById(articleId)
    const afterRefs = after.entityReferences as Record<string, unknown>[]
    expect(afterRefs).toHaveLength(1)
    expect(afterRefs[0]?.verified).toBe(true)
  })

  it('MESMA revisao com bytes diferentes e conflito, tambem em update', async () => {
    const cluster = `cluster-${randomUUID().slice(0, 8)}`
    const slug = `conflito-de-revisao-${randomUUID().slice(0, 8)}`

    const first = await publish(
      revisionBody({
        cluster,
        revision: 7,
        slugSuggestion: slug,
        intent: 'publish',
        payloadHash: hash64('aaaa1111'),
      }),
    )
    expect(first.status).toBe(201)
    const articleId = String(first.body.articleId)

    // Revisao 7 de novo, conteudo outro. Um dos dois envios esta errado, e
    // adivinhar qual seria pior do que recusar.
    const conflicting = await publish(
      revisionBody({
        cluster,
        revision: 7,
        slugSuggestion: slug,
        intent: 'update',
        targetArticleId: articleId,
        payloadHash: hash64('bbbb2222'),
        title: 'Outro texto sob a MESMA revisao',
      }),
    )

    expect(conflicting.status).toBe(409)
    expect(reasonCodes(conflicting.body)).toContain('idempotency_conflict')

    const doc = await articleById(articleId)
    expect(String(doc.title)).not.toBe('Outro texto sob a MESMA revisao')
  })
})

/* ------------------------------------------------------------------ */
/* 2-bis. A DECLARACAO nao desliga a guarda                            */
/* ------------------------------------------------------------------ */

/**
 * As guardas julgam a intencao RESOLVIDA, nao a declarada.
 *
 * O desvio era este: `staleRevision` lia `request.publicationIntent` — o que o
 * cliente DIZ — e so disparava para `update`. A cota e a persistencia liam
 * `resolvedIntent`, derivado do banco. Bastava rotular o pedido de `publish`
 * para a guarda se calar enquanto a persistencia fazia `UPDATE` do mesmo jeito.
 *
 * Nao havia truque nenhum a fazer: o contrato PROIBE `targetArticleId` em
 * `publish`, entao o pedido "de criacao" que atualizava materia existente
 * passava na validacao de forma sem uma unica divergencia visivel — e voltava
 * `201`, como se tivesse criado.
 */
describe('guarda burlavel pelo corpo do pedido', () => {
  it('declarar `publish` sobre revisao JA APLICADA vira CONFLICT, nao UPDATE silencioso', async () => {
    const cluster = `cluster-${randomUUID().slice(0, 8)}`
    const slug = `intent-mentiroso-${randomUUID().slice(0, 8)}`

    const first = await publish(
      revisionBody({
        cluster,
        revision: 5,
        slugSuggestion: slug,
        intent: 'publish',
        title: 'Texto original que NAO pode ser sobrescrito',
      }),
    )
    expect(first.status).toBe(201)
    const articleId = String(first.body.articleId)

    // A MESMA revisao 5, reenviada como se fosse criacao. O hash bate (mesmo
    // cluster, mesma revisao), entao `idempotencyConflict` nao pega: quem tem de
    // pegar e `staleRevision` — e ele so pega se ler a intencao resolvida.
    //
    // `revisionBody` sorteia um `requestId` novo a cada chamada, e essa e a
    // diferenca que separa este caso do retry legitimo (coberto logo abaixo):
    // outro pedido trazendo a mesma revisao e duplicata; o MESMO pedido chegando
    // duas vezes e o HTTP que se perdeu no caminho.
    const smuggled = await publish(
      revisionBody({
        cluster,
        revision: 5,
        slugSuggestion: slug,
        intent: 'publish',
        title: 'Texto contrabandeado pela declaracao de intent',
      }),
    )

    expect(smuggled.status).toBe(409)
    expect(reasonCodes(smuggled.body)).toContain('stale_revision')
    // A divergencia entre o declarado e o resolvido chega ao emissor NOMEADA.
    expect(warningCodes(smuggled.body)).toContain('PUBLICATION_INTENT_DIVERGENTE')

    // O ponto do teste: a materia nao foi tocada. Antes da correcao este mesmo
    // pedido respondia 201 e o titulo abaixo seria o contrabandeado.
    const doc = await articleById(articleId)
    expect(String(doc.title)).toBe('Texto original que NAO pode ser sobrescrito')
    expect(Number(doc.automationSourceRevision)).toBe(5)

    // Nem duplicou, nem consumiu cota de atualizacao.
    expect(await articlesForCluster(cluster)).toHaveLength(1)
    expect(await counterFor('article_update', articleId)).toBe(0)
  })

  it('o RETRY do mesmo pedido continua idempotente, e nao vira CONFLICT', async () => {
    // O outro lado da guarda recem-ligada, e o motivo de a leitura do consumo
    // anterior ter subido para antes dela. Um retry carrega, por definicao, a
    // revisao ja aplicada — se `staleRevision` julgasse antes de saber que
    // aquele `requestId` ja foi processado, o produtor que so quer confirmar o
    // desfecho de um HTTP perdido levaria `409` no lugar da confirmacao.
    const cluster = `cluster-${randomUUID().slice(0, 8)}`
    const body = revisionBody({
      cluster,
      revision: 1,
      slugSuggestion: `retry-idempotente-${randomUUID().slice(0, 8)}`,
      intent: 'publish',
    })

    const first = await publish(body)
    expect(first.status).toBe(201)
    const articleId = String(first.body.articleId)

    // O MESMO corpo, byte a byte — inclusive o `requestId`.
    const retry = await publish(body)

    expect(retry.status).toBe(201)
    expect(retry.body.idempotent).toBe(true)
    expect(reasonCodes(retry.body)).toContain('ALREADY_CONSUMED')
    expect(String(retry.body.articleId)).toBe(articleId)
    expect(await articlesForCluster(cluster)).toHaveLength(1)
    // Nada foi reaplicado: o retry nao consome cota de atualizacao.
    expect(await counterFor('article_update', articleId)).toBe(0)
  })

  it('declarar `publish` com bytes diferentes na mesma revisao segue CONFLICT', async () => {
    // Regressao do caminho que ja funcionava: a correcao nao pode abrir a porta
    // que o ramo antigo fechava por acidente.
    const cluster = `cluster-${randomUUID().slice(0, 8)}`
    const slug = `intent-mentiroso-hash-${randomUUID().slice(0, 8)}`

    const first = await publish(
      revisionBody({
        cluster,
        revision: 3,
        slugSuggestion: slug,
        intent: 'publish',
        payloadHash: hash64('cccc3333'),
      }),
    )
    expect(first.status).toBe(201)

    const conflicting = await publish(
      revisionBody({
        cluster,
        revision: 3,
        slugSuggestion: slug,
        intent: 'publish',
        payloadHash: hash64('dddd4444'),
        title: 'Outros bytes sob a mesma revisao, rotulados de criacao',
      }),
    )

    expect(conflicting.status).toBe(409)
    expect(reasonCodes(conflicting.body)).toContain('idempotency_conflict')
    const doc = await articleById(String(first.body.articleId))
    expect(String(doc.title)).not.toBe('Outros bytes sob a mesma revisao, rotulados de criacao')
  })

  it('revisao NOVA rotulada de `publish` atualiza a materia do cluster, com aviso', async () => {
    // O outro lado da mesma moeda, e por isso ele fica aqui: sob a intencao
    // resolvida, `publish` deixa de ser uma palavra magica que recusa o pedido
    // (o ramo antigo transformava toda revisao nova rotulada de `publish` em
    // `idempotency_conflict`) e passa a ser apenas um rotulo errado. Quem decide
    // e o banco: existe materia no cluster, entao e atualizacao — e o emissor
    // recebe a correcao por escrito em vez de um `201` que parece criacao.
    const cluster = `cluster-${randomUUID().slice(0, 8)}`
    const slug = `intent-rotulo-errado-${randomUUID().slice(0, 8)}`

    const first = await publish(
      revisionBody({ cluster, revision: 1, slugSuggestion: slug, intent: 'publish' }),
    )
    expect(first.status).toBe(201)
    const articleId = String(first.body.articleId)

    const second = await publish(
      revisionBody({
        cluster,
        revision: 2,
        slugSuggestion: slug,
        intent: 'publish',
        title: 'Revisao nova que chegou rotulada de criacao',
      }),
    )

    expect(second.status).toBe(201)
    expect(String(second.body.articleId)).toBe(articleId)
    expect(warningCodes(second.body)).toContain('PUBLICATION_INTENT_DIVERGENTE')
    expect(await articlesForCluster(cluster)).toHaveLength(1)

    const doc = await articleById(articleId)
    expect(String(doc.title)).toBe('Revisao nova que chegou rotulada de criacao')
    // A cota consumida e a de ATUALIZACAO — a mesma que a persistencia executou.
    expect(await counterFor('article_update', articleId)).toBe(1)
  })
})

/* ------------------------------------------------------------------ */
/* 3. `targetArticleId` e conferencia, nunca chave de busca           */
/* ------------------------------------------------------------------ */

describe('targetArticleId', () => {
  it('divergente vira AVISO e nao redireciona a escrita', async () => {
    const clusterA = `cluster-${randomUUID().slice(0, 8)}`
    const clusterB = `cluster-${randomUUID().slice(0, 8)}`

    const a = await publish(
      revisionBody({
        cluster: clusterA,
        revision: 1,
        slugSuggestion: `alvo-a-${randomUUID().slice(0, 8)}`,
        intent: 'publish',
      }),
    )
    const b = await publish(
      revisionBody({
        cluster: clusterB,
        revision: 1,
        slugSuggestion: `alvo-b-${randomUUID().slice(0, 8)}`,
        intent: 'publish',
      }),
    )
    expect(a.status).toBe(201)
    expect(b.status).toBe(201)
    const idA = String(a.body.articleId)
    const idB = String(b.body.articleId)

    // O cluster A manda uma revisao apontando para a materia do cluster B. Se o
    // id do corpo fosse chave de busca, isto reescreveria materia alheia.
    const crossed = await publish(
      revisionBody({
        cluster: clusterA,
        revision: 2,
        slugSuggestion: `alvo-a-${randomUUID().slice(0, 8)}`,
        intent: 'update',
        targetArticleId: idB,
        title: 'Texto do cluster A',
      }),
    )

    expect(crossed.status).toBe(201)
    expect(warningCodes(crossed.body)).toContain('TARGET_ARTICLE_ID_DIVERGENTE')
    // Escreveu em A, que e o que o cluster resolve.
    expect(String(crossed.body.articleId)).toBe(idA)

    const docB = await articleById(idB)
    expect(String(docB.title)).not.toBe('Texto do cluster A')
    const docA = await articleById(idA)
    expect(String(docA.title)).toBe('Texto do cluster A')
  })

  it('sem correspondencia vira AVISO e o pedido segue como criacao', async () => {
    const cluster = `cluster-${randomUUID().slice(0, 8)}`
    const orphan = await publish(
      revisionBody({
        cluster,
        revision: 2,
        slugSuggestion: `sem-alvo-${randomUUID().slice(0, 8)}`,
        intent: 'update',
        // Id que nao corresponde a nada deste cluster.
        targetArticleId: '999999',
      }),
    )

    expect(orphan.status).toBe(201)
    expect(warningCodes(orphan.body)).toContain('TARGET_ARTICLE_ID_SEM_CORRESPONDENCIA')
    const docs = await articlesForCluster(cluster)
    expect(docs).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ */
/* 4. Cota e persistencia concordam                                   */
/* ------------------------------------------------------------------ */

describe('cota de atualizacao', () => {
  it('update real conta na chave da materia REALMENTE atualizada', async () => {
    const cluster = `cluster-${randomUUID().slice(0, 8)}`
    const slug = `cota-update-${randomUUID().slice(0, 8)}`

    const first = await publish(
      revisionBody({ cluster, revision: 1, slugSuggestion: slug, intent: 'publish' }),
    )
    expect(first.status).toBe(201)
    const articleId = String(first.body.articleId)
    // `publish` nao consome cota de atualizacao: nao ha o que atualizar.
    expect(await counterFor('article_update', articleId)).toBe(0)

    const second = await publish(
      revisionBody({
        cluster,
        revision: 2,
        slugSuggestion: slug,
        intent: 'update',
        targetArticleId: articleId,
      }),
    )
    expect(second.status).toBe(201)
    expect(await counterFor('article_update', articleId)).toBe(1)
  })

  it('pedido que se declara update mas CRIA nao queima cota de atualizacao', async () => {
    // O defeito na sua forma mais cara: o contador subia numa chave que a
    // persistencia nem usava, e ainda assim nascia materia nova. Uma revisao
    // gastava teto de atualizacao E duplicava.
    const cluster = `cluster-${randomUUID().slice(0, 8)}`
    const claimed = '999998'

    const result = await publish(
      revisionBody({
        cluster,
        revision: 3,
        slugSuggestion: `cota-fantasma-${randomUUID().slice(0, 8)}`,
        intent: 'update',
        targetArticleId: claimed,
      }),
    )

    expect(result.status).toBe(201)
    const createdId = String(result.body.articleId)
    // Nem na chave declarada...
    expect(await counterFor('article_update', claimed)).toBe(0)
    // ...nem na materia criada: criar nao e atualizar.
    expect(await counterFor('article_update', createdId)).toBe(0)
  })
})
