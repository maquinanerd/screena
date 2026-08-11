/**
 * canary-entity-link-auto-verification-real-postgres.ts — A cadeia da AUTOMACAO.
 *
 *   MNScr -> /api/internal/editorial-publications -> entityReferences
 *         -> outbox -> publication-event-v1 -> worker -> entity_news_links
 *         -> LOADERS do apps/web -> superficies publicas
 *
 * POR QUE ELE EXISTE. O canario vizinho
 * (`canary-editorial-entity-links-real-postgres.ts`) percorre a MESMA segunda
 * metade, mas entra pelo caminho HUMANO — ele ate se recusa a rodar com
 * automacao no ambiente. Isso deixava a cadeia da automacao provada so em
 * pedacos: o CMS tem teste de integracao para o que ele grava, e a projecao tem
 * teste para o que ela recebe, e ninguem media o TRECHO ENTRE OS DOIS.
 *
 * O trecho entre os dois e exatamente onde vivia o defeito que o ADR 0019
 * corrige: o vinculo nascia `verified: false`, o mapeador de evento filtrava por
 * `verified === true`, e `entity_news_links` ficava vazio — com `201` na
 * resposta, com os ids certos, sem uma linha de erro em lugar nenhum.
 *
 * A PERGUNTA, entao, e uma so: o limiar de confianca separa o que atravessa do
 * que espera humano, DE PONTA A PONTA?
 *
 *   confidence 1.00 (tmdb_id)    -> verificado -> chega ao site
 *   confidence 0.85 (exact_name) -> pendente   -> NAO chega
 *   ...e o humano continua conseguindo empurrar o segundo, a mao.
 *
 * ESCOPO DELIBERADO: sem midia (a projecao de capa tem canario proprio) e sem
 * retratacao/replay (o canario vizinho ja os cobre, e repetir aqui so somaria
 * minutos). Tudo efemero: DOIS PostgreSQL 16, Next em modo producao, HTTP real,
 * nenhuma API externa e nenhuma credencial de verdade.
 *
 * Uso: pnpm --filter @screena/web canary:entity-link-auto-verification
 */

import { randomUUID } from 'node:crypto'

/* ------------------------------------------------------------------ */
/* Ambiente da automacao — ANTES de qualquer import do harness         */
/* ------------------------------------------------------------------ */
//
// O servidor do CMS e um processo SEPARADO e herda o ambiente no `spawn`.
// Definir isto depois do harness nao chegaria la, e o canario mediria os
// defaults enquanto declarava medir a automacao ligada.
process.env.EDITORIAL_AUTO_PUBLISH_ENABLED = 'true'
process.env.EDITORIAL_AUTO_PUBLISH_DAILY_LIMIT = '50'
process.env.EDITORIAL_AUTO_PUBLISH_PER_AUTHOR_LIMIT = '20'
process.env.EDITORIAL_AUTO_PUBLISH_PER_SECTION_LIMIT = '50'
process.env.EDITORIAL_AUTO_PUBLISH_PER_CONTENT_TYPE_LIMIT = '50'
process.env.EDITORIAL_AUTO_PUBLISH_PER_ARTICLE_UPDATE_LIMIT = '5'
process.env.EDITORIAL_AUTO_PUBLISH_TIME_ZONE = 'America/Sao_Paulo'
// O LIMIAR NAO E DECLARADO DE PROPOSITO: o canario prova o DEFAULT (0.9), que
// e o valor com que o servidor sobe em producao se ninguem configurar nada.

/* ------------------------------------------------------------------ */
/* Relatorio                                                           */
/* ------------------------------------------------------------------ */

interface CheckResult {
  readonly n: number
  readonly name: string
  readonly ok: boolean
  readonly detail: string
}

const results: CheckResult[] = []
let step = 0

function record(name: string, ok: boolean, detail: string): void {
  step += 1
  results.push({ n: step, name, ok, detail })
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${String(step)}. ${name} - ${detail}`)
}

/* ------------------------------------------------------------------ */
/* Identidades do catalogo publico                                     */
/* ------------------------------------------------------------------ */
//
// Ids internos FIXOS e distintos por tipo: `entity_news_links` e chaveada por
// (tipo, id), e um id repetido entre tipos mascararia troca de vertical.
const MOVIE_ID = 1001n
const PERSON_ID = 3001n

const RUN = randomUUID().slice(0, 8)
const MOVIE_SLUG = `filme-auto-${RUN}`
const PERSON_SLUG = `pessoa-auto-${RUN}`
const WORKER = `canary-auto-verify-${RUN}`

/** Os dois casamentos que a rota `/api/internal/entity-resolve` emite. */
const TMDB_ID_CONFIDENCE = 1
const EXACT_NAME_CONFIDENCE = 0.85

async function main(): Promise<void> {
  const { apiKeyAuthorization, startCmsHarness } = await import('../../cms/src/__tests__/harness.ts')
  const { startScreenDbHarness } = await import(
    '../../../services/news-ingestion/src/__tests__/screen-db-harness.ts'
  )
  const { validPublicationRequest } = await import('@screena/editorial-contracts')

  // SEQUENCIAL: dois `embedded-postgres` inicializando juntos no Windows
  // derrubam um ao outro.
  const cms = await startCmsHarness()
  const screen = await startScreenDbHarness()

  const payload = cms.payload
  const baseUrl = cms.baseUrl

  try {
    /* --- 1. Catalogo publico: filme e pessoa ----------------------- */
    //
    // A linha em `entities` nasce por TRIGGER de `movies`/`people`; sem ela o
    // vinculo daquele tipo nao passa por `reconcileEntityLinks`.
    await screen.prisma.movie.create({
      data: {
        id: MOVIE_ID,
        tmdbId: 910001,
        titleOriginal: 'Filme da Automacao',
        releaseDate: new Date('2026-03-01T00:00:00.000Z'),
      },
    })
    await screen.prisma.person.create({
      data: { id: PERSON_ID, tmdbId: 910003, name: 'Pessoa da Automacao' },
    })

    const seedSlugAndTranslation = async (
      entityType: 'movie' | 'person',
      entityId: bigint,
      slug: string,
      title: string,
    ): Promise<void> => {
      await screen.prisma.slug.create({
        data: { entityType, entityId, languageCode: 'pt-BR', slug, isCanonical: true },
      })
      await screen.prisma.entityTranslation.create({
        data: {
          entityType,
          entityId,
          languageCode: 'pt-BR',
          title,
          summary: `Resumo pt-BR de catalogo para ${title}.`,
        },
      })
    }
    await seedSlugAndTranslation('movie', MOVIE_ID, MOVIE_SLUG, 'Filme da Automacao')
    await seedSlugAndTranslation('person', PERSON_ID, PERSON_SLUG, 'Pessoa da Automacao')

    const registered = await screen.prisma.$queryRawUnsafe<{ entity_type: string }[]>(
      `select entity_type from entities where (entity_type, entity_id) in (('movie',$1),('person',$2)) order by entity_type`,
      MOVIE_ID,
      PERSON_ID,
    )
    record(
      'catalogo semeado e os dois tipos registrados em `entities` pelo trigger',
      registered.length === 2,
      `entities=${registered.map((row) => row.entity_type).join(',')}`,
    )

    /* --- 2. Identidades do CMS ------------------------------------- */
    const author = await payload.create({
      collection: 'authors',
      data: {
        name: 'Redacao Cinerie',
        slug: `redacao-${RUN}`,
        active: true,
        isOrganization: true,
        automationPublishingAllowed: true,
        allowedAutomationContentTypes: ['news'],
        // A secao do pedido vem de `seo.articleSectionSuggestion` da fixture.
        allowedAutomationSections: ['Series'],
        automationAttributionModes: ['newsroom'],
      } as never,
      overrideAccess: true,
    })

    const publisherKey = randomUUID()
    await payload.create({
      collection: 'service-accounts',
      data: {
        label: 'mnscr-publisher-canario',
        purpose: 'mnscr',
        active: true,
        scopes: ['editorial_auto_publish'],
        enableAPIKey: true,
        apiKey: publisherKey,
      } as never,
      overrideAccess: true,
    })

    const projectionKey = randomUUID()
    await payload.create({
      collection: 'service-accounts',
      data: {
        label: 'worker-projecao-canario',
        purpose: 'internal_tooling',
        active: true,
        scopes: ['publication_projection'],
        enableAPIKey: true,
        apiKey: projectionKey,
      } as never,
      overrideAccess: true,
    })

    const humanPassword = `senha-canario-${randomUUID()}`
    await payload.create({
      collection: 'editorial-users',
      data: {
        email: 'chefe.auto@cinerie.test',
        password: humanPassword,
        displayName: 'Editora-chefe do canario de automacao',
        role: 'editor_in_chief',
        active: true,
      } as never,
      overrideAccess: true,
    })
    const login = await fetch(`${baseUrl}/api/editorial-users/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'chefe.auto@cinerie.test', password: humanPassword }),
    })
    const humanToken = String(((await login.json()) as { token?: string }).token ?? '')
    if (humanToken === '') throw new Error('login da editora-chefe do canario falhou')

    const asHuman = async (method: string, url: string, data?: unknown) => {
      const response = await fetch(`${baseUrl}${url}`, {
        method,
        headers: { 'content-type': 'application/json', Authorization: `JWT ${humanToken}` },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      })
      const text = await response.text()
      return { status: response.status, text }
    }

    /* --- 3. O pedido de publicacao do MNScr ------------------------ */
    const SLUG = `materia-auto-${RUN}`
    const requestId = randomUUID()
    const publicationBody = {
      ...validPublicationRequest,
      // Sem midia: a fixture aponta para uma linha que nao existe neste banco, e
      // midia nao verificavel bloqueia a publicacao — com razao, e fora do
      // escopo desta pergunta.
      media: [],
      requestId: `req-${requestId}`,
      idempotencyKey: `idem-${requestId}`,
      sourceClusterId: `cluster-${RUN}`,
      publicAuthorId: String(author.id),
      entityLinks: [
        // `tmdb_id`: identificador exato. Atravessa.
        {
          entityKind: 'movie',
          entityId: MOVIE_ID.toString(),
          relation: 'primary_subject',
          confidence: TMDB_ID_CONFIDENCE,
        },
        // `exact_name`: nome unico, sem um SEGUNDO campo confirmando identidade.
        // Espera humano — e e este o vinculo que o passo 8 empurra a mao.
        {
          entityKind: 'person',
          entityId: PERSON_ID.toString(),
          relation: 'mentioned',
          confidence: EXACT_NAME_CONFIDENCE,
        },
      ],
      seo: {
        ...validPublicationRequest.seo,
        imageAltSuggestions: [],
        slugSuggestion: SLUG,
      },
    }

    const publishResponse = await fetch(`${baseUrl}/api/internal/editorial-publications`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: apiKeyAuthorization('service-accounts', publisherKey),
      },
      body: JSON.stringify(publicationBody),
    })
    const publishText = await publishResponse.text()
    let published: Record<string, unknown> = {}
    try {
      published = JSON.parse(publishText) as Record<string, unknown>
    } catch {
      throw new Error(
        `resposta nao-JSON (${String(publishResponse.status)}): ${publishText.slice(0, 300)}\n[servidor]\n${cms.serverLog().slice(-2000)}`,
      )
    }
    if (published.outcome !== 'PUBLISHED') {
      console.error(`[servidor]\n${cms.serverLog().slice(-3000)}`)
    }
    const articleId = String(published.articleId ?? '')
    record(
      'MNScr publicou pelo endpoint de autopublicacao',
      published.outcome === 'PUBLISHED' && articleId !== '',
      `outcome=${String(published.outcome)} id=${articleId} motivos=${JSON.stringify(published.reasons).slice(0, 200)}`,
    )

    const warningCodes = (
      (published.warningDetails ?? []) as { code?: unknown }[]
    ).map((warning) => String(warning.code))
    record(
      'a resposta separa o que nasceu verificado do que ficou pendente',
      warningCodes.includes('ENTITY_LINK_AUTO_VERIFIED') &&
        warningCodes.includes('ENTITY_LINK_UNVERIFIED'),
      `codigos=${JSON.stringify(warningCodes)}`,
    )

    /* --- 4. O que ficou GRAVADO no CMS ----------------------------- */
    const doc = (await payload.findByID({
      collection: 'articles',
      id: articleId,
      depth: 0,
      overrideAccess: true,
    })) as unknown as Record<string, unknown>
    const refs = (doc.entityReferences ?? []) as Record<string, unknown>[]
    const movieRef = refs.find((ref) => ref.entityKind === 'movie')
    const personRef = refs.find((ref) => ref.entityKind === 'person')
    record(
      'vinculo 1.0 nasceu VERIFICADO; 0.85 nasceu pendente',
      movieRef?.verified === true && personRef?.verified === false,
      `movie.verified=${String(movieRef?.verified)} person.verified=${String(personRef?.verified)}`,
    )
    record(
      'so o auto-verificado carrega a proveniencia da maquina',
      movieRef?.verificationSource === 'automation_confidence' &&
        (personRef?.verificationSource ?? null) === null,
      `movie.source=${String(movieRef?.verificationSource)} person.source=${String(personRef?.verificationSource ?? null)}`,
    )

    /* --- 5. Worker real: claim -> projecao -> ack ------------------ */
    const { mapPublicationEvent } = await import(
      '../../../services/news-ingestion/src/editorial-event-mapper.ts'
    )
    const { applyProjectionEvent } = await import(
      '../../../services/news-ingestion/src/persistence/editorial-projection-store.ts'
    )
    const workerAuth = `service-accounts API-Key ${projectionKey}`

    const callOutbox = async (op: string, body: unknown) => {
      const response = await fetch(`${baseUrl}/api/internal/publication-outbox/${op}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: workerAuth },
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

    const drainOutbox = async (): Promise<{ processed: number; warnings: string[] }> => {
      const claimed = await callOutbox('claim', { workerId: WORKER, batchSize: 20 })
      const events = (claimed.json.events ?? []) as {
        eventId: string
        emissionSequence: number
        contentVersion: string
        leaseToken: string
        payload: unknown
      }[]
      const warnings: string[] = []
      for (const event of events) {
        const mapping = mapPublicationEvent(event.payload, event.emissionSequence)
        if (!mapping.ok) {
          throw new Error(`evento fora do contrato: ${JSON.stringify(mapping.issues).slice(0, 300)}`)
        }
        const result = await applyProjectionEvent(screen.prisma, {
          event: mapping.event,
          contentVersion: event.contentVersion,
          workerId: WORKER,
        })
        warnings.push(...result.warnings)
        await callOutbox('ack', {
          workerId: WORKER,
          eventId: event.eventId,
          leaseToken: event.leaseToken,
          outcome: result.outcome,
        })
      }
      return { processed: events.length, warnings }
    }

    const drained = await drainOutbox()
    record(
      'worker consumiu o evento da autopublicacao',
      drained.processed >= 1,
      `eventos=${String(drained.processed)} avisos=${JSON.stringify(drained.warnings).slice(0, 200)}`,
    )

    /* --- 6. entity_news_links -------------------------------------- */
    const publicArticle = await screen.prisma.article.findFirst({
      where: { translations: { some: { slug: SLUG } } },
      select: { id: true },
    })
    const linkKeys = async (): Promise<string[]> => {
      if (publicArticle === null) return []
      const rows = await screen.prisma.entityNewsLink.findMany({
        where: { articleId: publicArticle.id },
        orderBy: [{ entityType: 'asc' }, { entityId: 'asc' }],
        select: { entityType: true, entityId: true },
      })
      return rows.map((row) => `${String(row.entityType)}:${row.entityId.toString()}`)
    }
    const keys = await linkKeys()
    record(
      'A PROVA: entity_news_links tem o vinculo 1.0 e SO ele',
      keys.length === 1 && keys[0] === `movie:${MOVIE_ID}`,
      `vinculos=${JSON.stringify(keys)}`,
    )
    record(
      'o vinculo 0.85 NAO atravessou: ele espera confirmacao humana',
      !keys.some((key) => key.startsWith('person:')),
      `vinculos=${JSON.stringify(keys)}`,
    )

    /* --- 7. Superficies publicas ----------------------------------- */
    //
    // `DATABASE_URL` e definida ANTES do import: o cliente Prisma do apps/web a
    // le na primeira resolucao do modulo.
    process.env.DATABASE_URL = screen.url
    const { getPrismaClient } = (await import('@screena/db/server')) as {
      getPrismaClient: () => never
    }
    const { getRelatedNewsForEntity } = (await import('../src/server/related-news.ts')) as {
      getRelatedNewsForEntity: (
        prisma: unknown,
        entityType: 'movie' | 'tv' | 'person',
        entityId: bigint,
      ) => Promise<{ slug: string }[]>
    }
    const { getHomeEditorialHighlights } = (await import('../src/server/home-editorial.ts')) as {
      getHomeEditorialHighlights: () => Promise<{
        movies: readonly { slug: string }[]
        series: readonly { slug: string }[]
      }>
    }
    const webPrisma = getPrismaClient()

    const surfaces = async () => {
      const [movie, person, home] = await Promise.all([
        getRelatedNewsForEntity(webPrisma, 'movie', MOVIE_ID),
        getRelatedNewsForEntity(webPrisma, 'person', PERSON_ID),
        getHomeEditorialHighlights(),
      ])
      const has = (cards: readonly { slug: string }[]): boolean =>
        cards.some((card) => card.slug === SLUG)
      return {
        movie: has(movie),
        person: has(person),
        homeMovies: has(home.movies),
        homeSeries: has(home.series),
      }
    }

    const before = await surfaces()
    record('pagina do FILME recebe a materia', before.movie, `related-news movie ${MOVIE_ID}`)
    record(
      'pagina da PESSOA NAO recebe: o vinculo dela ficou pendente',
      !before.person,
      `related-news person ${PERSON_ID}`,
    )
    record(
      'A ABA CERTA: a Home classifica em FILMES por causa do vinculo auto-verificado',
      before.homeMovies && !before.homeSeries,
      `filmes=${String(before.homeMovies)} series=${String(before.homeSeries)}`,
    )

    /* --- 8. O humano continua no comando --------------------------- */
    //
    // Confirmar o vinculo pendente e uma decisao humana, e ela tem de chegar ao
    // site — senao o limiar teria trocado "tudo espera humano" por "o que o
    // humano decide nao vale".
    await asHuman('PATCH', `/api/articles/${articleId}`, { workflowStatus: 'needs_update' })
    const curated = refs.map((ref) => ({ ...ref, verified: true }))
    const patched = await asHuman('PATCH', `/api/articles/${articleId}`, {
      entityReferences: curated,
    })
    for (const workflowStatus of ['needs_review', 'in_review', 'human_reviewed', 'ready_to_publish', 'published']) {
      const move = await asHuman('PATCH', `/api/articles/${articleId}`, { workflowStatus })
      if (move.status !== 200) record(`transicao ${workflowStatus}`, false, move.text.slice(0, 200))
    }
    record(
      'editora-chefe confirmou o vinculo pendente no admin',
      patched.status === 200,
      `status=${String(patched.status)}`,
    )

    await drainOutbox()
    const keysAfter = await linkKeys()
    record(
      'confirmado por humano, o vinculo de PESSOA passa a atravessar',
      keysAfter.length === 2 && keysAfter.includes(`person:${PERSON_ID}`),
      `vinculos=${JSON.stringify(keysAfter)}`,
    )

    const after = await surfaces()
    record('pagina da PESSOA passa a receber a materia', after.person, 'related-news person')
    record('pagina do FILME continua recebendo', after.movie, 'vinculo preservado')

    // O rastro de ORIGEM sobrevive a confirmacao humana do OUTRO vinculo: quem
    // auditar amanha continua sabendo qual das duas linhas a maquina afirmou.
    const finalDoc = (await payload.findByID({
      collection: 'articles',
      id: articleId,
      depth: 0,
      overrideAccess: true,
    })) as unknown as Record<string, unknown>
    const finalRefs = (finalDoc.entityReferences ?? []) as Record<string, unknown>[]
    const finalMovie = finalRefs.find((ref) => ref.entityKind === 'movie')
    const finalPerson = finalRefs.find((ref) => ref.entityKind === 'person')
    record(
      'a origem continua distinguindo o automatico do humano depois da curadoria',
      finalMovie?.verificationSource === 'automation_confidence' &&
        finalPerson?.verified === true &&
        (finalPerson.verificationSource ?? null) === null,
      `movie.source=${String(finalMovie?.verificationSource)} person.source=${String(finalPerson?.verificationSource ?? null)}`,
    )
  } finally {
    delete process.env.DATABASE_URL
    await screen.stop()
    await cms.stop()
  }

  /* --- Relatorio final ------------------------------------------- */
  const failed = results.filter((result) => !result.ok)
  console.log(`\n${'='.repeat(64)}`)
  console.log(
    `canario de auto-verificacao por confianca: ${String(results.length - failed.length)}/${String(results.length)} verificacoes`,
  )
  console.log('='.repeat(64))
  if (failed.length > 0) {
    for (const result of failed) console.log(`  FALHOU ${String(result.n)}. ${result.name} - ${result.detail}`)
    process.exitCode = 1
    return
  }
  console.log('cadeia da automacao provada: limiar -> verificado -> projetado -> superficie')
}

main().catch((error: unknown) => {
  // Sem eco do conteudo da materia nem da URL do banco.
  console.error('[canario] falhou:', error instanceof Error ? error.message : 'erro desconhecido')
  process.exitCode = 1
})
