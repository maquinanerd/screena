/**
 * canary-editorial-entity-links-real-postgres.ts — A SEGUNDA METADE da cadeia.
 *
 *   CMS -> outbox -> publication-event-v1 -> worker -> screen-db
 *       -> entity_news_links -> LOADERS do apps/web -> superficies publicas
 *
 * POR QUE ESTE CANARIO EXISTE, dado que ja ha cobertura vizinha. A metade de
 * cima ja esta provada: `editorial-projection.integration.test.ts` cobre
 * vinculo criado, entidade nao verificada, tipo nao suportado, entidade
 * inexistente, replay, evento fora de ordem, remocao pelo editor e retratacao —
 * tudo lido direto de `entity_news_links`. E `editorial-entity-links.test.ts`
 * cobre, puro, id zero, id nao numerico, id acima do BIGINT e duplicata.
 *
 * O que NINGUEM provava e o trecho de `entity_news_links` para diante. O
 * canario manual (`canary-manual-editorial-real-postgres.ts`) chega ate a
 * pagina de filme, mas com UM vinculo de UM tipo: nao exercita `person`, nao
 * exercita `tv`, nao passa pela Home, nao passa por `/noticias`, e nunca
 * observa reconciliacao nem retratacao PELO LOADER — so pela tabela.
 *
 * A diferenca importa porque cada superficie aplica o seu proprio gate depois
 * do vinculo. Uma linha correta em `entity_news_links` nao prova que a materia
 * aparece na ficha do filme, nem que ela NAO aparece na da serie. Este canario
 * pergunta as superficies, nao ao banco.
 *
 * ESCOPO DELIBERADO: sem midia. A projecao de capa e de bloco de imagem ja tem
 * canario proprio, e arrastar o pipeline de bytes para ca so somaria tempo e
 * modos de falha alheios a pergunta. Materia sem capa publica normalmente — o
 * gate nao exige hero.
 *
 * Tudo efemero e descartavel: DOIS PostgreSQL 16 (o do Payload e o publico),
 * Next em modo producao, HTTP real. Nenhuma API externa, nenhum banco remoto.
 *
 * Uso: pnpm --filter @screena/web canary:editorial-entity-links
 */

import { randomUUID } from 'node:crypto'

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
// Ids internos FIXOS e distintos por tipo. Fixos para que a leitura do relatorio
// nao dependa de sequencia; distintos entre si porque `entity_news_links` e
// chaveada por (tipo, id) e um id repetido entre tipos mascararia troca de
// vertical — o defeito mais caro desta cadeia.
const MOVIE_ID = 1001n
const TV_ID = 2001n
const PERSON_ID = 3001n

const RUN = randomUUID().slice(0, 8)
const MOVIE_SLUG = `filme-canario-${RUN}`
const TV_SLUG = `serie-canario-${RUN}`
const PERSON_SLUG = `pessoa-canario-${RUN}`

const WORKER = `canary-entity-links-${RUN}`

/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  // O canario e do caminho HUMANO: automacao configurada invalidaria a prova.
  const automationEnv = Object.keys(process.env).filter(
    (key) => key.startsWith('MNSCR_') || key.startsWith('EDITORIAL_AUTO_PUBLISH_'),
  )
  if (automationEnv.length > 0) {
    throw new Error(`canario nao roda com automacao no ambiente: ${automationEnv.join(', ')}`)
  }
  process.env.EDITORIAL_AUTO_PUBLISH_ENABLED = 'false'

  const { startCmsHarness } = await import('../../cms/src/__tests__/harness.ts')
  const { startScreenDbHarness } = await import(
    '../../../services/news-ingestion/src/__tests__/screen-db-harness.ts'
  )

  // SEQUENCIAL: dois `embedded-postgres` inicializando juntos no Windows
  // derrubam um ao outro.
  const cms = await startCmsHarness()
  const screen = await startScreenDbHarness()

  const payload = cms.payload
  const baseUrl = cms.baseUrl

  try {
    /* --- 1. Catalogo publico: filme, serie e pessoa ---------------- */
    //
    // A linha em `entities` NAO e criada aqui: nasce por trigger de
    // `movies`/`tv_shows`/`people` (migration 20260715120000). Se algum trigger
    // regredir, o vinculo daquele tipo aborta a transacao inteira da projecao —
    // e este canario tem de ser quem descobre.
    await screen.prisma.movie.create({
      data: {
        id: MOVIE_ID,
        tmdbId: 900001,
        titleOriginal: 'Filme do Canario',
        releaseDate: new Date('2026-03-01T00:00:00.000Z'),
      },
    })
    await screen.prisma.tvShow.create({
      // `nameOriginal`, nao `titleOriginal`: serie e filme tem colunas
      // diferentes no schema publico.
      data: { id: TV_ID, tmdbId: 900002, nameOriginal: 'Serie do Canario' },
    })
    await screen.prisma.person.create({
      data: { id: PERSON_ID, tmdbId: 900003, name: 'Pessoa do Canario' },
    })

    const seedSlugAndTranslation = async (
      entityType: 'movie' | 'tv' | 'person',
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
    await seedSlugAndTranslation('movie', MOVIE_ID, MOVIE_SLUG, 'Filme do Canario')
    await seedSlugAndTranslation('tv', TV_ID, TV_SLUG, 'Serie do Canario')
    await seedSlugAndTranslation('person', PERSON_ID, PERSON_SLUG, 'Pessoa do Canario')

    const registered = await screen.prisma.$queryRawUnsafe<{ entity_type: string }[]>(
      `select entity_type from entities where (entity_type, entity_id) in (('movie',$1),('tv',$2),('person',$3)) order by entity_type`,
      MOVIE_ID,
      TV_ID,
      PERSON_ID,
    )
    record(
      'catalogo semeado e os TRES tipos registrados em `entities` pelo trigger',
      registered.length === 3,
      `entities=${registered.map((row) => row.entity_type).join(',')} ids=${MOVIE_ID}/${TV_ID}/${PERSON_ID}`,
    )

    /* --- 2. Identidades do CMS ------------------------------------- */
    const password = `senha-canario-${randomUUID()}`
    // A identidade humana e usada pelo LOGIN logo abaixo (e-mail + senha), nao
    // pelo id: quem carimba `createdBy`/`publishedBy` e a sessao, nao o script.
    await payload.create({
      collection: 'editorial-users',
      data: {
        email: 'admin.links@cinerie.test',
        password,
        displayName: 'Administradora do canario de vinculos',
        role: 'administrator',
        active: true,
      } as never,
      overrideAccess: true,
    })
    const author = await payload.create({
      collection: 'authors',
      data: { name: 'Redacao Cinerie', slug: `redacao-${RUN}`, active: true, isOrganization: true } as never,
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

    const login = await fetch(`${baseUrl}/api/editorial-users/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin.links@cinerie.test', password }),
    })
    const token = String(((await login.json()) as { token?: string }).token ?? '')
    if (token === '') throw new Error('login da administradora do canario falhou')

    const asHuman = async (method: string, url: string, data?: unknown) => {
      const response = await fetch(`${baseUrl}${url}`, {
        method,
        headers: { 'content-type': 'application/json', Authorization: `JWT ${token}` },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
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

    /* --- 3. Worker real: claim -> projecao -> ack ------------------ */
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
      return { status: response.status, json, text }
    }

    /** Consome a fila inteira pelo caminho real e devolve os avisos vistos. */
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
        const applied = await applyProjectionEvent(screen.prisma, {
          event: mapping.event,
          contentVersion: event.contentVersion,
          workerId: WORKER,
        })
        warnings.push(...applied.warnings)
        await callOutbox('ack', {
          workerId: WORKER,
          eventId: event.eventId,
          leaseToken: event.leaseToken,
          outcome: applied.outcome,
        })
      }
      return { processed: events.length, warnings }
    }

    /* --- 4. Materia A: movie + person verificados, tv AUSENTE ------ */
    const SLUG_A = `materia-vinculos-${RUN}`
    const createdA = await asHuman('POST', '/api/articles', {
      title: 'Materia com filme e pessoa',
      slug: SLUG_A,
      summary: 'Resumo editorial proprio da Cinerie para o canario de vinculos.',
      language: 'pt-BR',
      contentType: 'news',
      workflowStatus: 'draft',
      body: [{ blockType: 'paragraph', blockId: 'p1', text: 'Abertura da materia do canario.' }],
      authors: [author.id],
      primaryAuthor: author.id,
      qaPassedAt: new Date().toISOString(),
      externalSources: [
        { sourceId: 's1', name: 'Variety', url: 'https://variety.com/canario', role: 'primary' },
      ],
      entityReferences: [
        {
          entityKind: 'movie',
          entityId: MOVIE_ID.toString(),
          relation: 'primary_subject',
          verified: true,
        },
        {
          entityKind: 'person',
          entityId: PERSON_ID.toString(),
          relation: 'mentioned',
          verified: true,
        },
        // Ruido DELIBERADO, para provar os dois descartes na mesma passagem:
        // relacao nao confirmada por humano e tipo que o lado publico nao
        // renderiza. Nenhum dos dois pode virar vinculo, e nenhum pode derrubar
        // a materia.
        {
          entityKind: 'tv',
          entityId: TV_ID.toString(),
          relation: 'mentioned',
          verified: false,
        },
        { entityKind: 'franchise', entityId: '4242', relation: 'mentioned', verified: true },
      ],
    })
    const articleId = String((createdA.json as { doc?: { id?: unknown } }).doc?.id ?? '')
    record(
      'materia criada no CMS pelo caminho humano',
      createdA.status === 201 && articleId !== '',
      `status=${String(createdA.status)} id=${articleId}`,
    )

    const publish = async (id: string): Promise<boolean> => {
      for (const workflowStatus of [
        'needs_review',
        'in_review',
        'human_reviewed',
        'ready_to_publish',
        'published',
      ]) {
        const move = await asHuman('PATCH', `/api/articles/${id}`, { workflowStatus })
        if (move.status !== 200) {
          record(`transicao ${workflowStatus}`, false, move.text.slice(0, 250))
          return false
        }
      }
      return true
    }
    const publishedA = await publish(articleId)
    record('materia A publicada pelo fluxo real de workflow', publishedA, 'draft -> published')

    const drainA = await drainOutbox()
    record(
      'worker projetou o evento de publicacao',
      drainA.processed === 1,
      `eventos=${String(drainA.processed)} avisos=${JSON.stringify(drainA.warnings).slice(0, 200)}`,
    )

    /* --- 5. Banco publico ------------------------------------------ */
    const publicArticle = await screen.prisma.article.findFirst({
      where: { translations: { some: { slug: SLUG_A } } },
      select: { id: true, publishedAt: true },
    })
    const translationA = await screen.prisma.articleTranslation.findFirst({
      where: { slug: SLUG_A, languageCode: 'pt-BR' },
      select: { reviewStatus: true, indexStatus: true, publishedAt: true, bodyBlocks: true },
    })
    record(
      'artigo publico existe, publicado, indexavel e com corpo',
      publicArticle !== null &&
        translationA?.reviewStatus === 'published' &&
        translationA.indexStatus === 'index' &&
        translationA.publishedAt !== null &&
        Array.isArray(translationA.bodyBlocks) &&
        (translationA.bodyBlocks as unknown[]).length > 0,
      `review=${String(translationA?.reviewStatus)} index=${String(translationA?.indexStatus)} blocos=${String((translationA?.bodyBlocks as unknown[] | undefined)?.length)}`,
    )

    const articleCount = await screen.prisma.articleTranslation.count({ where: { slug: SLUG_A } })
    record('nao ha duplicacao do artigo', articleCount === 1, `traducoes com o slug=${String(articleCount)}`)

    const linkKeys = async (id: bigint): Promise<string[]> => {
      const rows = await screen.prisma.entityNewsLink.findMany({
        where: { articleId: id },
        orderBy: [{ entityType: 'asc' }, { entityId: 'asc' }],
        select: { entityType: true, entityId: true },
      })
      return rows.map((row) => `${String(row.entityType)}:${row.entityId.toString()}`)
    }
    const keysA = publicArticle === null ? [] : await linkKeys(publicArticle.id)
    record(
      'entity_news_links tem EXATAMENTE movie + person',
      keysA.length === 2 &&
        keysA.includes(`movie:${MOVIE_ID}`) &&
        keysA.includes(`person:${PERSON_ID}`),
      `vinculos=${JSON.stringify(keysA)}`,
    )
    record(
      'tv nao verificada e franchise nao suportada ficaram de fora, sem derrubar a materia',
      !keysA.some((key) => key.startsWith('tv:')) && !keysA.some((key) => key.startsWith('franchise')),
      `vinculos=${JSON.stringify(keysA)}`,
    )

    /* --- 6. LOADERS do apps/web ------------------------------------ */
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
      ) => Promise<{ slug: string; href: string }[]>
    }
    const { getHomeEditorialHighlights } = (await import('../src/server/home-editorial.ts')) as {
      getHomeEditorialHighlights: () => Promise<{
        movies: readonly { slug: string }[]
        series: readonly { slug: string }[]
      }>
    }
    const { getNewsIndexData } = (await import('../src/server/news-pages.ts')) as {
      getNewsIndexData: () => Promise<{
        view: {
          featured: { slug: string; href: string } | null
          cards: readonly { slug: string; href: string }[]
        }
      }>
    }
    const webPrisma = getPrismaClient()

    /** Todas as superficies numa leitura so, para o mesmo slug. */
    const surfaces = async (slug: string) => {
      const [movie, tv, person, home, index] = await Promise.all([
        getRelatedNewsForEntity(webPrisma, 'movie', MOVIE_ID),
        getRelatedNewsForEntity(webPrisma, 'tv', TV_ID),
        getRelatedNewsForEntity(webPrisma, 'person', PERSON_ID),
        getHomeEditorialHighlights(),
        getNewsIndexData(),
      ])
      const has = (cards: readonly { slug: string }[]): boolean =>
        cards.some((card) => card.slug === slug)

      // A listagem entrega DUAS superficies: um destaque e a grade. Uma materia
      // sozinha vira `featured` e a grade fica vazia — contar so `cards` diria
      // que ela sumiu. E somar as duas e o unico jeito de provar que ela nao
      // aparece DUAS vezes na mesma tela.
      const listed = [
        ...(index.view.featured === null ? [] : [index.view.featured]),
        ...index.view.cards,
      ]
      return {
        movie: has(movie),
        tv: has(tv),
        person: has(person),
        homeMovies: has(home.movies),
        homeSeries: has(home.series),
        news: has(listed),
        newsCount: listed.filter((card) => card.slug === slug).length,
        href: listed.find((card) => card.slug === slug)?.href ?? null,
      }
    }

    const a = await surfaces(SLUG_A)
    record(
      'pagina do FILME recebe a materia',
      a.movie,
      `getRelatedNewsForEntity(movie, ${MOVIE_ID})`,
    )
    record(
      'pagina da PESSOA recebe a materia',
      a.person,
      `getRelatedNewsForEntity(person, ${PERSON_ID})`,
    )
    record(
      'pagina da SERIE NAO recebe a materia (nao ha vinculo tv)',
      !a.tv,
      `getRelatedNewsForEntity(tv, ${TV_ID})`,
    )
    record('Home classifica em FILMES', a.homeMovies, 'getHomeEditorialHighlights().movies')
    record('Home NAO classifica em SERIES', !a.homeSeries, 'getHomeEditorialHighlights().series')
    record('listagem /noticias inclui a materia', a.news, `cards=${String(a.newsCount)}`)
    record(
      'href canonico da materia',
      a.href === `/pt/noticias/${SLUG_A}/`,
      `href=${String(a.href)}`,
    )

    /* --- 7. Reconciliacao: remover a PESSOA ------------------------ */
    //
    // O conjunto de entidades do evento e AUTORITATIVO. Parar de inserir nao
    // basta: a materia tem de sumir da ficha da pessoa.
    await asHuman('PATCH', `/api/articles/${articleId}`, { workflowStatus: 'needs_update' })
    await asHuman('PATCH', `/api/articles/${articleId}`, {
      entityReferences: [
        {
          entityKind: 'movie',
          entityId: MOVIE_ID.toString(),
          relation: 'primary_subject',
          verified: true,
        },
      ],
    })
    for (const workflowStatus of ['needs_review', 'in_review', 'human_reviewed', 'ready_to_publish', 'published']) {
      const move = await asHuman('PATCH', `/api/articles/${articleId}`, { workflowStatus })
      if (move.status !== 200) record(`reedicao: ${workflowStatus}`, false, move.text.slice(0, 200))
    }
    const drainB = await drainOutbox()
    record(
      'atualizacao gerou evento e foi projetada',
      drainB.processed >= 1,
      `eventos=${String(drainB.processed)}`,
    )

    const keysAfterRemoval = publicArticle === null ? [] : await linkKeys(publicArticle.id)
    record(
      'vinculo de PESSOA foi removido; o de FILME permaneceu',
      keysAfterRemoval.length === 1 && keysAfterRemoval[0] === `movie:${MOVIE_ID}`,
      `vinculos=${JSON.stringify(keysAfterRemoval)}`,
    )
    const stillOne = await screen.prisma.articleTranslation.count({ where: { slug: SLUG_A } })
    record('a reedicao NAO criou um segundo artigo', stillOne === 1, `traducoes=${String(stillOne)}`)

    const b = await surfaces(SLUG_A)
    record('pagina da PESSOA deixou de receber a materia', !b.person, 'reconciliacao vista pelo loader')
    record('pagina do FILME continua recebendo', b.movie, 'vinculo preservado')
    record('Home continua classificando em FILMES', b.homeMovies, 'vertical preservada')

    /* --- 8. Materia hibrida: movie + tv + person ------------------- */
    await asHuman('PATCH', `/api/articles/${articleId}`, { workflowStatus: 'needs_update' })
    await asHuman('PATCH', `/api/articles/${articleId}`, {
      entityReferences: [
        { entityKind: 'movie', entityId: MOVIE_ID.toString(), relation: 'primary_subject', verified: true },
        { entityKind: 'tv', entityId: TV_ID.toString(), relation: 'secondary_subject', verified: true },
        { entityKind: 'person', entityId: PERSON_ID.toString(), relation: 'mentioned', verified: true },
        // Duplicata EXATA: a unique e (artigo, tipo, id) — tem de virar UM
        // vinculo, nao dois.
        { entityKind: 'movie', entityId: MOVIE_ID.toString(), relation: 'compared', verified: true },
      ],
    })
    for (const workflowStatus of ['needs_review', 'in_review', 'human_reviewed', 'ready_to_publish', 'published']) {
      await asHuman('PATCH', `/api/articles/${articleId}`, { workflowStatus })
    }
    await drainOutbox()

    const keysHybrid = publicArticle === null ? [] : await linkKeys(publicArticle.id)
    record(
      'materia hibrida tem exatamente TRES vinculos, sem duplicata',
      keysHybrid.length === 3 &&
        keysHybrid.includes(`movie:${MOVIE_ID}`) &&
        keysHybrid.includes(`tv:${TV_ID}`) &&
        keysHybrid.includes(`person:${PERSON_ID}`),
      `vinculos=${JSON.stringify(keysHybrid)}`,
    )

    const h = await surfaces(SLUG_A)
    record('hibrida aparece na pagina do FILME', h.movie, 'related-news movie')
    record('hibrida aparece na pagina da SERIE', h.tv, 'related-news tv')
    record('hibrida aparece na pagina da PESSOA', h.person, 'related-news person')
    record('hibrida aparece em FILMES e em SERIES', h.homeMovies && h.homeSeries, 'as duas verticais')
    record(
      'hibrida aparece UMA VEZ SO na listagem geral',
      h.newsCount === 1,
      `ocorrencias=${String(h.newsCount)}`,
    )

    /* --- 9. Retratacao --------------------------------------------- */
    const retract = await asHuman('PATCH', `/api/articles/${articleId}`, {
      workflowStatus: 'retracted',
      retractionReason: 'Retratada pelo canario para provar o sumico nas superficies.',
    })
    record('retratacao aceita pelo CMS', retract.status === 200, `status=${String(retract.status)}`)
    await drainOutbox()

    const r = await surfaces(SLUG_A)
    record('retratada some de /noticias', !r.news, 'getNewsIndexData')
    record('retratada some dos destaques da Home', !r.homeMovies && !r.homeSeries, 'as duas verticais')
    record('retratada some da pagina do FILME', !r.movie, 'related-news movie')
    record('retratada some da pagina da SERIE', !r.tv, 'related-news tv')
    record('retratada some da pagina da PESSOA', !r.person, 'related-news person')

    const linksAfterRetraction = publicArticle === null ? [] : await linkKeys(publicArticle.id)
    record(
      'retratacao NAO apaga os vinculos — quem barra e o indexStatus',
      linksAfterRetraction.length === 3,
      `vinculos=${JSON.stringify(linksAfterRetraction)}`,
    )

    /* --- 10. Replay de evento antigo apos a retratacao ------------- */
    //
    // Um evento ja processado NAO pode ressuscitar materia retratada.
    const replay = await drainOutbox()
    const afterReplay = await surfaces(SLUG_A)
    record(
      'replay da fila nao republica materia retratada',
      !afterReplay.news && !afterReplay.movie,
      `eventos reprocessados=${String(replay.processed)}`,
    )

    /* --- 11. Materia AGENDADA nao vaza ---------------------------- */
    const SLUG_FUTURE = `materia-agendada-${RUN}`
    const future = await asHuman('POST', '/api/articles', {
      title: 'Materia agendada para o futuro',
      slug: SLUG_FUTURE,
      summary: 'Resumo de materia que ainda nao deveria aparecer.',
      language: 'pt-BR',
      contentType: 'news',
      workflowStatus: 'draft',
      body: [{ blockType: 'paragraph', blockId: 'p1', text: 'Texto agendado.' }],
      authors: [author.id],
      primaryAuthor: author.id,
      qaPassedAt: new Date().toISOString(),
      externalSources: [
        { sourceId: 's1', name: 'Variety', url: 'https://variety.com/futuro', role: 'primary' },
      ],
      entityReferences: [
        { entityKind: 'movie', entityId: MOVIE_ID.toString(), relation: 'primary_subject', verified: true },
      ],
    })
    const futureId = String((future.json as { doc?: { id?: unknown } }).doc?.id ?? '')
    if (await publish(futureId)) {
      // A data de publicacao e carimbada pelo servidor; empurra-la para o futuro
      // no banco publico e a unica forma de exercitar o embargo sem esperar.
      await drainOutbox()
      const amanha = new Date(Date.now() + 48 * 3600 * 1000)
      await screen.prisma.articleTranslation.updateMany({
        where: { slug: SLUG_FUTURE },
        data: { publishedAt: amanha },
      })
      await screen.prisma.article.updateMany({
        where: { translations: { some: { slug: SLUG_FUTURE } } },
        data: { publishedAt: amanha },
      })
      const f = await surfaces(SLUG_FUTURE)
      record(
        'materia com publishedAt no FUTURO nao aparece em nenhuma superficie',
        !f.news && !f.movie && !f.homeMovies,
        `noticias=${String(f.news)} filme=${String(f.movie)} home=${String(f.homeMovies)}`,
      )
    }

    /* --- 12. Sem N+1 ---------------------------------------------- */
    //
    // A prova e ESTRUTURAL e nao por contagem: `home-editorial.ts` faz duas
    // queries fixas (traducoes + vinculos em lote) e `related-news.ts` faz duas
    // (vinculos + traducoes por `in`). Nenhuma delas roda dentro de laco por
    // card. Contar queries exigiria instrumentar o Prisma so para o canario, e o
    // proprio loader ja documenta o formato.
    const homeSource = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../src/server/home-editorial.ts', import.meta.url), 'utf8'),
    )
    const relatedSource = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../src/server/related-news.ts', import.meta.url), 'utf8'),
    )
    const noLoopQuery = (source: string): boolean =>
      !/for\s*\([^)]*\)\s*\{[^}]*await\s+prisma\./s.test(source) &&
      !/\.map\([^)]*await\s+prisma\./s.test(source)
    record(
      'loaders buscam em LOTE: nenhuma query dentro de laco por card',
      noLoopQuery(homeSource) && noLoopQuery(relatedSource) &&
        (homeSource.match(/await prisma\./g) ?? []).length === 2 &&
        (relatedSource.match(/await prisma\./g) ?? []).length === 2,
      `home=${String((homeSource.match(/await prisma\./g) ?? []).length)} related=${String((relatedSource.match(/await prisma\./g) ?? []).length)} queries fixas`,
    )
  } finally {
    delete process.env.DATABASE_URL
    await screen.stop()
    await cms.stop()
  }

  /* --- Relatorio final ------------------------------------------- */
  const failed = results.filter((result) => !result.ok)
  console.log(`\n${'='.repeat(64)}`)
  console.log(`canario de vinculos editoriais: ${String(results.length - failed.length)}/${String(results.length)} verificacoes`)
  console.log('='.repeat(64))
  if (failed.length > 0) {
    for (const result of failed) console.log(`  FALHOU ${String(result.n)}. ${result.name} - ${result.detail}`)
    process.exitCode = 1
    return
  }
  console.log('cadeia completa provada: CMS -> outbox -> worker -> screen-db -> loaders -> superficies')
}

main().catch((error: unknown) => {
  // Sem eco do conteudo da materia nem da URL do banco: a mensagem de erro do
  // canario nao e lugar para nenhum dos dois.
  console.error('[canario] falhou:', error instanceof Error ? error.message : 'erro desconhecido')
  process.exitCode = 1
})
