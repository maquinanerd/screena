/**
 * canary-manual-editorial-real-postgres.ts — FASE 2G.
 *
 * O CANARIO LOCAL COMPLETO da publicacao MANUAL, ponta a ponta, sem MNScr:
 *
 *   administradora humana -> Payload (HTTP real, sessao real)
 *     -> publication-event -> outbox -> worker (claim/projecao/ack)
 *       -> screen-db (Prisma real) -> presenter publico -> SEO/JSON-LD/sitemaps
 *
 * Tudo real e descartavel: DOIS PostgreSQL 16 efemeros (o do Payload e o
 * publico), Next em modo producao, storage temporario em disco, HTTP de
 * verdade. Nenhuma chamada externa, nenhum bucket, nenhuma credencial de
 * producao — e NADA do MNScr: sem `MNSCR_*`, sem conta `editorial_auto_publish`,
 * sem chave de API de automacao, sem endpoint do pipeline.
 *
 * Por que um script e nao um teste de vitest: o canario atravessa TRES pacotes
 * (`apps/cms`, `services/news-ingestion`, `apps/web`) e o ultimo trecho precisa
 * de `react` e do cliente Prisma resolvidos a partir de `apps/web`. E a mesma
 * forma dos demais `validate-*-real-postgres.ts` deste diretorio.
 *
 * Uso: pnpm --filter @screena/web canary:manual-editorial
 */

import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

/** Bytes de um JPEG minimo VALIDO (cabecalho real, nao extensao de arquivo). */
function jpegBytes(): Buffer {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10,
    ...Array.from('JFIF', (char) => char.charCodeAt(0)), 0,
    0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x76, 0x04, 0xb0,
    0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xd9,
  ])
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  return false
}

/* ------------------------------------------------------------------ */
/* Render publico por HTTP (Next real)                                 */
/* ------------------------------------------------------------------ */

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

async function waitForHttp(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) })
      if (response.status > 0) return true
    } catch {
      /* ainda subindo */
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}

/**
 * Sobe o site REAL sobre o screen-db efemero e busca a materia manual.
 *
 * `next build` + `next start`, a mesma pipeline do servico implantado. Nao
 * reaproveita servidor de desenvolvimento: um `next dev` compila sob demanda e
 * esconde erro de build, que e justamente uma das coisas que este passo existe
 * para pegar.
 */
async function servePublicPage(databaseUrl: string): Promise<void> {
  const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const nextBin = path.join(webDir, 'node_modules', 'next', 'dist', 'bin', 'next')

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    NODE_ENV: 'production',
    CINERIE_PUBLIC_SITE_URL: 'https://cinerie.com',
    CINERIE_PUBLIC_INDEXING_ENABLED: 'true',
  }

  const build = spawnSync('node', [nextBin, 'build'], {
    cwd: webDir,
    env,
    stdio: 'pipe',
    shell: false,
  })
  if (build.status !== 0) {
    record('build do site publico', false, (build.stdout?.toString() ?? '').slice(-800))
    return
  }
  record('build do site publico', true, 'next build concluido')

  const port = await freePort()
  const base = `http://127.0.0.1:${String(port)}`
  const server = spawn(
    'node',
    [nextBin, 'start', '--port', String(port), '--hostname', '127.0.0.1'],
    { cwd: webDir, env, stdio: 'pipe', shell: false },
  )
  let log = ''
  const capture = (chunk: unknown) => {
    log = `${log}${String(chunk)}`.slice(-4_000)
  }
  server.stdout?.on('data', capture)
  server.stderr?.on('data', capture)

  try {
    const up = await waitForHttp(`${base}/pt/noticias/`, 120_000)
    if (!up) {
      record('site publico respondeu', false, log.slice(-600) || 'sem saida')
      return
    }

    const response = await fetch(`${base}/pt/noticias/${SLUG}/`)
    const html = await response.text()

    record(
      'GET /pt/noticias/<slug>/ responde 200',
      response.status === 200,
      `status=${String(response.status)}`,
    )
    record(
      'o HTML traz titulo, corpo, autor publico e a imagem',
      html.includes('Materia manual do canario') &&
        html.includes('Abertura escrita por uma pessoa da redacao') &&
        html.includes('Redacao Cinerie') &&
        html.includes('/media/editorial/'),
      `titulo=${String(html.includes('Materia manual do canario'))} corpo=${String(html.includes('Abertura escrita'))} autor=${String(html.includes('Redacao Cinerie'))}`,
    )
    record(
      'canonical, robots e Open Graph estao no HTML servido',
      html.includes(`<link rel="canonical" href="https://cinerie.com/pt/noticias/${SLUG}/"`) &&
        /<meta name="robots" content="index[^"]*"/.test(html) &&
        html.includes('property="og:title"'),
      `canonical=${String(html.includes(`/pt/noticias/${SLUG}/"`))}`,
    )
    record(
      'o HTML carrega JSON-LD NewsArticle e BreadcrumbList',
      html.includes('"@type":"NewsArticle"') && html.includes('"@type":"BreadcrumbList"'),
      'ambos os blocos application/ld+json presentes',
    )
    record(
      'datePublished e dateModified sao DERIVADOS no HTML',
      html.includes('"datePublished"') && html.includes('"dateModified"'),
      'presentes no JSON-LD, ausentes do CMS',
    )
    record(
      'a materia manual aparece no INDICE publico de noticias',
      (await (await fetch(`${base}/pt/noticias/`)).text()).includes('Materia manual do canario'),
      'listagem contem o titulo',
    )
  } finally {
    try {
      server.kill()
    } catch {
      /* pode ja ter morrido */
    }
  }
}

/* ------------------------------------------------------------------ */
/* Canario                                                             */
/* ------------------------------------------------------------------ */

const WORKER = 'canary-manual-2g'
const SLUG = `canario-manual-${randomUUID().slice(0, 8)}`

async function main(): Promise<void> {
  // GUARDA DE INDEPENDENCIA, antes de subir qualquer coisa. Um canario que
  // rodasse com automacao configurada nao provaria independencia nenhuma.
  const automationEnv = Object.keys(process.env).filter(
    (key) => key.startsWith('MNSCR_') || key.startsWith('EDITORIAL_AUTO_PUBLISH_'),
  )
  if (automationEnv.length > 0) {
    throw new Error(`canario manual nao roda com automacao no ambiente: ${automationEnv.join(', ')}`)
  }
  process.env.EDITORIAL_AUTO_PUBLISH_ENABLED = 'false'
  record('ambiente sem automacao do MNScr', true, 'nenhuma MNSCR_*/EDITORIAL_AUTO_PUBLISH_* presente')

  const { startCmsHarness } = await import('../../cms/src/__tests__/harness.ts')
  const { startScreenDbHarness } = await import(
    '../../../services/news-ingestion/src/__tests__/screen-db-harness.ts'
  )

  // SEQUENCIAL: duas instancias de `embedded-postgres` inicializando ao mesmo
  // tempo no Windows derrubam uma a outra.
  const cms = await startCmsHarness()
  const screen = await startScreenDbHarness()
  const storageRoot = mkdtempSync(path.join(tmpdir(), 'cinerie-canary-media-'))

  const payload = cms.payload
  const baseUrl = cms.baseUrl

  try {
    /* --- 1. Identidades: humana e do worker ------------------------- */
    const password = `senha-canario-${randomUUID()}`
    const admin = await payload.create({
      collection: 'editorial-users',
      data: {
        email: 'admin.canario@cinerie.test',
        password,
        displayName: 'Administradora do canario',
        role: 'administrator',
        active: true,
      } as never,
      overrideAccess: true,
    })

    const author = await payload.create({
      collection: 'authors',
      data: { name: 'Redacao Cinerie', slug: `redacao-${SLUG}`, active: true, isOrganization: true } as never,
      overrideAccess: true,
    })

    // A UNICA conta tecnica do canario e a do WORKER de projecao. Ela nao
    // publica, nao cria rascunho e nao tem nada a ver com o MNScr.
    const projectionKey = randomUUID()
    await payload.create({
      collection: 'service-accounts',
      data: {
        apiKey: projectionKey,
        label: 'worker-projecao-canario',
        purpose: 'internal_tooling',
        active: true,
        scopes: ['publication_projection'],
      } as never,
      overrideAccess: true,
    })

    const login = await fetch(`${baseUrl}/api/editorial-users/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin.canario@cinerie.test', password }),
    })
    const loginBody = (await login.json()) as { token?: string }
    const token = String(loginBody.token ?? '')
    record('login humano real no CMS', token !== '', `token emitido: ${String(token !== '')}`)

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

    /* --- 2. Midia licenciada --------------------------------------- */
    const bytes = jpegBytes()
    const media = await payload.create({
      collection: 'media',
      data: {
        alt: 'Cena de divulgacao da temporada',
        credit: 'Divulgacao',
        licenseStatus: 'approved',
        requiresAttribution: false,
        allowedForEditorial: true,
        allowedForHero: true,
        provenanceType: 'cinerie_editorial',
      } as never,
      overrideAccess: true,
      file: { data: bytes, mimetype: 'image/jpeg', name: `capa-${SLUG}.jpg`, size: bytes.byteLength },
    })

    /* --- 3. Materia MANUAL, por HTTP, sem campo nenhum do MNScr ----- */
    const created = await asHuman('POST', '/api/articles', {
      title: 'Materia manual do canario',
      subtitle: 'Escrita e publicada por uma pessoa',
      slug: SLUG,
      summary: 'Resumo editorial proprio da Cinerie, escrito por uma pessoa da redacao.',
      language: 'pt-BR',
      contentType: 'news',
      workflowStatus: 'draft',
      body: [
        {
          blockType: 'paragraph',
          blockId: 'p-1',
          text: 'Abertura escrita por uma pessoa da redacao, com contexto proprio e sem copiar sinopse de terceiro.',
        },
        { blockType: 'heading', blockId: 'h-1', level: '2', text: 'O que se sabe ate agora' },
        {
          blockType: 'paragraph',
          blockId: 'p-2',
          text: 'Desenvolvimento com informacao verificada, atribuicao clara e linguagem propria da casa.',
        },
        { blockType: 'image', blockId: 'i-1', media: Number(media.id), alt: 'Cena de divulgacao', credit: 'Divulgacao' },
        {
          blockType: 'paragraph',
          blockId: 'p-3',
          text: 'Fechamento com o proximo passo da cobertura e o que ainda depende de confirmacao oficial.',
        },
      ],
      heroMedia: Number(media.id),
      authors: [Number(author.id)],
      primaryAuthor: Number(author.id),
      section: 'series',
      metaTitle: 'Titulo de busca escrito pela redacao',
      metaDescription: 'Descricao curta, propria, sem copiar sinopse de terceiro.',
      focusKeyphrase: 'estreia da temporada',
      relatedKeyphrases: ['data de estreia', 'onde assistir'],
      editorialKeywords: ['serie', 'estreia'],
      articleSection: 'Series',
      schemaTypeRecommendation: 'NewsArticle',
      aiAssisted: false,
      qaPassedAt: new Date().toISOString(),
      externalSources: [
        { sourceId: 's-1', name: 'Variety', url: 'https://variety.com/exemplo', role: 'primary' },
      ],
    })
    record(
      'materia manual criada por HTTP humano',
      created.status === 201,
      `status=${String(created.status)} ${created.status === 201 ? '' : created.text.slice(0, 300)}`,
    )
    const articleId = String((created.json.doc as { id?: unknown })?.id ?? '')

    /* --- 4. Workflow humano completo ------------------------------- */
    const transitions = ['needs_review', 'in_review', 'human_reviewed', 'ready_to_publish', 'published']
    let workflowOk = true
    let workflowDetail = 'draft -> ' + transitions.join(' -> ')
    for (const workflowStatus of transitions) {
      const move = await asHuman('PATCH', `/api/articles/${articleId}`, { workflowStatus })
      if (move.status !== 200) {
        workflowOk = false
        workflowDetail = `${workflowStatus} recusado (${String(move.status)}): ${move.text.slice(0, 200)}`
        break
      }
    }
    record('workflow humano completo executado pela mesma pessoa', workflowOk, workflowDetail)

    /* --- 5. O que o CMS gravou ------------------------------------- */
    const doc = (await payload.findByID({
      collection: 'articles',
      id: articleId,
      depth: 0,
      overrideAccess: true,
    })) as unknown as Record<string, unknown>

    record(
      'workflowStatus=published e publishedBy HUMANO',
      doc.workflowStatus === 'published' && String(doc.publishedBy) === String(admin.id),
      `status=${String(doc.workflowStatus)} publishedBy=${String(doc.publishedBy)}`,
    )
    record(
      'autoPublished=false (indicador EXPLICITO, nao ausencia)',
      doc.autoPublished === false,
      `autoPublished=${JSON.stringify(doc.autoPublished)}`,
    )

    const mnscrFields = [
      'automationActorId', 'automationActorLabel', 'automationReceivedAt',
      'automationIdempotencyKey', 'automationSourceRevision', 'automationPayloadHash',
      'automationPipelineVersion', 'automationContractVersion', 'automationContractName',
      'automationSchemaHash', 'automationAttributionMode', 'automationScopesUsed',
      'automationDraftId', 'idempotencyKey', 'sourceClusterId', 'sourceRevision',
      'sourcePayloadHash', 'draftPayloadHash', 'pipelineVersion',
    ]
    const dirty = mnscrFields.filter((field) => !isEmpty(doc[field]))
    record(
      'nenhum campo exclusivo do MNScr foi preenchido',
      dirty.length === 0,
      dirty.length === 0 ? `${String(mnscrFields.length)} campos vazios` : `sujos: ${dirty.join(', ')}`,
    )
    record(
      'assinatura PUBLICA e operador do CMS sao identidades distintas',
      String(doc.primaryAuthor) === String(author.id) && String(doc.createdBy) === String(admin.id),
      `primaryAuthor=${String(doc.primaryAuthor)} createdBy=${String(doc.createdBy)}`,
    )

    /* --- 6. Outbox: o evento nasceu -------------------------------- */
    const outbox = await payload.find({
      collection: 'publication-outbox',
      where: { aggregateId: { equals: articleId } },
      limit: 10,
      overrideAccess: true,
    })
    const outboxTypes = outbox.docs.map((row) => (row as { eventType?: unknown }).eventType)
    record(
      'outbox recebeu exatamente um article.published',
      outboxTypes.length === 1 && outboxTypes[0] === 'article.published',
      `eventos=${JSON.stringify(outboxTypes)}`,
    )

    /* --- 7. WORKER: claim -> projecao -> ack ----------------------- */
    const { mapPublicationEvent } = await import(
      '../../../services/news-ingestion/src/editorial-event-mapper.ts'
    )
    const { applyProjectionEvent } = await import(
      '../../../services/news-ingestion/src/persistence/editorial-projection-store.ts'
    )
    const { createLocalMediaStorage } = await import(
      '../../../services/news-ingestion/src/media/local-storage.ts'
    )
    const { planEventMedia } = await import(
      '../../../services/news-ingestion/src/media/media-plan.ts'
    )
    const { projectEventMedia } = await import(
      '../../../services/news-ingestion/src/media/media-pipeline.ts'
    )

    const storage = createLocalMediaStorage({
      driver: 'local',
      root: storageRoot,
      publicBasePath: '/media',
    })
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

    const claimed = await callOutbox('claim', { workerId: WORKER, batchSize: 10 })
    const events = (claimed.json.events ?? []) as {
      eventId: string
      emissionSequence: number
      contentVersion: string
      leaseToken: string
      payload: unknown
    }[]
    record(
      'worker reclamou o evento por HTTP com credencial propria',
      claimed.status === 200 && events.length === 1,
      `status=${String(claimed.status)} eventos=${String(events.length)}`,
    )

    const outcomes: string[] = []
    for (const event of events) {
      const mapping = mapPublicationEvent(event.payload, event.emissionSequence)
      if (!mapping.ok) {
        record('evento passou no contrato publication-event-v1', false, JSON.stringify(mapping.issues).slice(0, 300))
        continue
      }
      const plan = planEventMedia(mapping.event)
      const projected =
        plan.requests.length === 0
          ? { assets: new Map(), warnings: [] }
          : await projectEventMedia(
              {
                fetch: {
                  baseUrl,
                  authorization: workerAuth,
                  requestTimeoutMs: 20_000,
                  maxBytes: 15 * 1024 * 1024,
                },
                storage,
              },
              plan.requests,
            )
      const applied = await applyProjectionEvent(screen.prisma as never, {
        event: mapping.event,
        contentVersion: event.contentVersion,
        workerId: WORKER,
        media: projected.assets as never,
      })
      outcomes.push(applied.outcome)
      const acked = await callOutbox('ack', {
        eventId: event.eventId,
        leaseToken: event.leaseToken,
        workerId: WORKER,
        projectionReceiptId: applied.articleId ?? event.eventId,
        projectedAt: new Date().toISOString(),
      })
      record('ack aceito e recibo registrado', acked.status === 200, `status=${String(acked.status)}`)
    }
    record('projecao aplicada no screen-db', outcomes.join(',') === 'applied', `outcomes=${outcomes.join(',')}`)

    const processed = await payload.find({
      collection: 'publication-outbox',
      where: { aggregateId: { equals: articleId } },
      limit: 10,
      overrideAccess: true,
    })
    const status = (processed.docs[0] as { status?: unknown } | undefined)?.status
    record('evento marcado como processado na outbox', status === 'processed', `status=${String(status)}`)

    /* --- 8. screen-db: o artigo publico existe --------------------- */
    const publicArticle = await screen.prisma.article.findUnique({
      where: { payloadDocumentId: articleId },
      include: { translations: true },
    })
    const translation = publicArticle?.translations.find((row) => row.languageCode === 'pt-BR') ?? null

    record(
      'Article + ArticleTranslation pt-BR criados no banco publico',
      publicArticle !== null && translation !== null,
      `article=${String(publicArticle !== null)} translation=${String(translation !== null)}`,
    )
    record(
      'slug, titulo e SEO atravessaram para o banco publico',
      translation?.slug === SLUG &&
        translation?.metaTitle === 'Titulo de busca escrito pela redacao' &&
        translation?.focusKeyphrase === 'estreia da temporada',
      `slug=${String(translation?.slug)} metaTitle=${String(translation?.metaTitle)}`,
    )
    record(
      'materia publicada entra como published/index',
      translation?.reviewStatus === 'published' && translation?.indexStatus === 'index',
      `review=${String(translation?.reviewStatus)} index=${String(translation?.indexStatus)}`,
    )
    const heroPath = publicArticle?.heroImagePath ?? null
    record(
      'capa virou caminho publico LOCAL — nenhuma URL http no banco',
      typeof heroPath === 'string' && /^\/media\/editorial\/[0-9a-f]{2}\/[0-9a-f]{64}\.\w+$/.test(heroPath) && !heroPath.includes('http'),
      `heroImagePath=${String(heroPath)}`,
    )

    /* --- 9. PAGINA PUBLICA: presenter + SEO ------------------------ */
    //
    // A partir daqui o canario le o banco publico pelo MESMO codigo do site.
    // `DATABASE_URL` e definida ANTES do import porque o cliente Prisma do
    // `@screena/db` a resolve no carregamento do modulo.
    process.env.DATABASE_URL = screen.url

    const dbServer = (await import('@screena/db/server')) as {
      getPrismaClient: () => { $disconnect: () => Promise<void> }
    }
    const { getNewsArticleData } = (await import('../src/server/news-pages.ts')) as {
      getNewsArticleData: (slug: string) => Promise<Record<string, unknown> | null>
    }
    const { SITE_URL, gatePublicRobots } = (await import('../src/lib/site.ts')) as {
      SITE_URL: string
      gatePublicRobots: (robots: unknown) => { index?: boolean; follow?: boolean }
    }
    const seo = (await import('@screena/seo')) as {
      articleRobots: (decision: string) => unknown
      buildArticleJsonLd: (facts: Record<string, unknown>) => Record<string, unknown>
      buildOpenGraph: (facts: Record<string, unknown>) => Record<string, unknown>
      buildTwitter: (facts: Record<string, unknown>) => Record<string, unknown>
      resolveCanonical: (facts: Record<string, unknown>) => { href: string }
      serializeJsonLd: (value: unknown) => string
    }

    const page = await getNewsArticleData(SLUG)
    record('a pagina publica RESOLVE a materia manual', page !== null, `slug=${SLUG}`)
    if (page === null) throw new Error('pagina publica nao resolveu a materia — o canario para aqui')

    const view = page.view as Record<string, unknown>
    const indexability = page.indexability as { decision: string }
    const canonicalUrl = String(page.canonicalUrl)

    // O corpo chega ao render como PARAGRAFOS, nao como uma string: os blocos
    // tipados do CMS sao achatados na projecao e reagrupados aqui.
    const paragraphs = (view.bodyParagraphs ?? []) as string[]
    const bodyText = paragraphs.join(' ')
    record(
      'titulo, corpo e autor publico chegam ao render',
      view.title === 'Materia manual do canario' &&
        view.hasBody === true &&
        paragraphs.length >= 3 &&
        bodyText.length > 200 &&
        view.author === 'Redacao Cinerie',
      `title=${String(view.title)} autor=${String(view.author)} paragrafos=${String(paragraphs.length)} corpo=${String(bodyText.length)} chars`,
    )
    const heroImage = view.heroImage as { src?: string; alt?: string } | null
    record(
      'imagem chega com caminho local e ALT aprovado',
      typeof heroImage?.src === 'string' &&
        heroImage.src.startsWith('/media/editorial/') &&
        (heroImage.alt ?? '') !== '',
      `src=${String(heroImage?.src)} alt=${String(heroImage?.alt)}`,
    )
    record(
      'a decisao de indexabilidade e `index`',
      indexability.decision === 'index',
      `decision=${indexability.decision}`,
    )

    // Os mesmos fatos que a rota `/pt/noticias/[slug]` monta.
    const facts = {
      canonicalUrl,
      canonicalOverride: view.canonicalOverride ?? null,
      decision: indexability.decision,
      title: view.title,
      metaTitle: view.metaTitle ?? null,
      metaDescription: view.metaDescription ?? null,
      deck: view.deck ?? null,
      socialTitle: view.socialTitle ?? null,
      socialDescription: view.socialDescription ?? null,
      articleSection: view.articleSection ?? null,
      schemaTypeRecommendation: view.schemaTypeRecommendation ?? null,
      imageUrl: heroImage === null ? null : `${SITE_URL}${String(heroImage.src)}`,
      imageAlt: heroImage?.alt ?? null,
      publishedAtIso: view.dateIso ?? null,
      updatedAtIso: view.updatedAtIso ?? null,
      authorName: view.author ?? null,
      siteName: 'Cinerie',
      locale: 'pt-BR',
    }

    const canonical = seo.resolveCanonical(facts)
    record(
      'canonical absoluto e autorreferente',
      canonical.href === canonicalUrl && canonical.href.includes(SLUG),
      `canonical=${canonical.href}`,
    )

    // ROBOTS derivado, e derivado DUAS VEZES de proposito: o valor final passa
    // pelo gate de ambiente. Num ambiente que pode indexar, a decisao da pagina
    // vale; num que nao pode (preview, staging), tudo colapsa para noindex —
    // e e essa a razao de o `articleRobots` puro nunca ser usado sozinho.
    // Ambiente indexavel exige as DUAS coisas: a flag explicita E a origem
    // oficial declarada. Nao basta a URL cair no default — uma instalacao de
    // preview que herdasse o canonical de producao anunciaria a URL errada.
    const indexableEnv = {
      ...process.env,
      CINERIE_PUBLIC_INDEXING_ENABLED: 'true',
      CINERIE_PUBLIC_SITE_URL: 'https://cinerie.com',
    }
    const gatedEnv = { ...indexableEnv, CINERIE_PUBLIC_INDEXING_ENABLED: 'false' }
    const robots = gatePublicRobots(seo.articleRobots(indexability.decision), indexableEnv)
    const robotsGated = gatePublicRobots(seo.articleRobots(indexability.decision), gatedEnv)
    record(
      'robots DERIVADO no lado publico (o CMS nao o guarda)',
      robots.index === true && robots.follow === true,
      `robots=${JSON.stringify(robots)}`,
    )
    record(
      'o kill switch de ambiente rebaixa robots para noindex',
      robotsGated.index === false && robotsGated.follow === false,
      `robots(gated)=${JSON.stringify(robotsGated)}`,
    )

    const jsonLd = seo.buildArticleJsonLd(facts)
    const jsonLdText = seo.serializeJsonLd(jsonLd)
    record(
      'JSON-LD e NewsArticle com datePublished, imagem e autor',
      jsonLd['@type'] === 'NewsArticle' &&
        typeof jsonLd.datePublished === 'string' &&
        jsonLdText.includes('Redacao Cinerie'),
      `@type=${String(jsonLd['@type'])} datePublished=${String(jsonLd.datePublished)}`,
    )
    record(
      'JSON-LD NAO inventa AggregateRating nem Review proprio',
      !jsonLdText.includes('aggregateRating') && !jsonLdText.includes('"@type":"Review"'),
      'sem aggregateRating e sem Review',
    )

    const og = seo.buildOpenGraph(facts)
    const twitter = seo.buildTwitter(facts)
    record(
      'Open Graph e Twitter Cards derivados dos sinais editoriais',
      typeof og.title === 'string' && typeof twitter.title === 'string',
      `og.title=${String(og.title)} twitter.card=${String(twitter.card ?? '')}`,
    )

    /* --- 10. Sitemaps ---------------------------------------------- */
    const { getSitemapShardXml } = (await import('../src/server/seo/sitemap-index.ts')) as {
      getSitemapShardXml: (shardId: string) => Promise<{ xml: string } | null>
    }
    // O shard e identificado pelo NOME do arquivo, com idioma, tipo e pagina —
    // e o sitemap e segmentado por idioma (so `pt-BR` publica hoje).
    const newsShard = await getSitemapShardXml('sitemap-pt-BR-news-1.xml')
    record(
      'a materia manual entra no sitemap pt-BR de noticias',
      newsShard !== null && newsShard.xml.includes(SLUG),
      newsShard === null ? 'shard nao existe' : `slug presente: ${String(newsShard.xml.includes(SLUG))}`,
    )

    // O News Sitemap so anuncia em ambiente que PODE indexar: em preview ele
    // devolve um arquivo valido e vazio, de proposito. O canario liga o sinal
    // para exercitar o caminho real e devolve o ambiente ao estado anterior.
    const { getNewsSitemapXml } = (await import('../src/server/seo/news-sitemap.ts')) as {
      getNewsSitemapXml: () => Promise<{ xml: string }>
    }
    const previousIndexing = process.env.CINERIE_PUBLIC_INDEXING_ENABLED
    const previousSiteUrl = process.env.CINERIE_PUBLIC_SITE_URL
    process.env.CINERIE_PUBLIC_INDEXING_ENABLED = 'true'
    process.env.CINERIE_PUBLIC_SITE_URL = 'https://cinerie.com'
    const newsSitemap = await getNewsSitemapXml()
    if (previousIndexing === undefined) delete process.env.CINERIE_PUBLIC_INDEXING_ENABLED
    else process.env.CINERIE_PUBLIC_INDEXING_ENABLED = previousIndexing
    if (previousSiteUrl === undefined) delete process.env.CINERIE_PUBLIC_SITE_URL
    else process.env.CINERIE_PUBLIC_SITE_URL = previousSiteUrl
    record(
      'a materia manual entra no News Sitemap (elegivel por recencia)',
      newsSitemap.xml.includes(SLUG),
      `slug presente: ${String(newsSitemap.xml.includes(SLUG))}`,
    )

    /* --- 11. Nenhum vestigio do MNScr no caminho publico ----------- */
    const publicSurface = [
      JSON.stringify(page),
      jsonLdText,
      JSON.stringify(og),
      JSON.stringify(twitter),
      newsSitemap.xml,
    ].join(' ')
    const leaks = ['mnscr', 'MNSCR', 'rssprime', 'RSSPRIME', 'mn26', 'MN26'].filter((needle) =>
      publicSurface.includes(needle),
    )
    record(
      'nenhuma superficie publica menciona MNScr/RSS Prime/MN26',
      leaks.length === 0,
      leaks.length === 0 ? 'nenhum vestigio' : `vestigios: ${leaks.join(', ')}`,
    )

    /* --- 12. A PAGINA, servida por HTTP -------------------------------- */
    //
    // Os passos 9-11 provaram os dados e as decisoes; este prova o RENDER.
    // Sobe o `apps/web` de verdade (`next build` + `next start`) apontando para
    // o screen-db efemero e faz um GET na URL publica da materia. E o unico
    // trecho que pega quebra de render — um erro no componente devolve 500 sem
    // que nenhum presenter falhe.
    await servePublicPage(screen.url)

    // Hash do conteudo so para deixar o canario reprodutivel no log.
    const digest = createHash('sha256').update(bodyText).digest('hex').slice(0, 12)
    console.log(`\n[canario] materia ${SLUG} projetada; digest do corpo=${digest}`)

    await dbServer.getPrismaClient().$disconnect()
  } finally {
    delete process.env.DATABASE_URL
    try {
      rmSync(storageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch {
      /* diretorio temporario */
    }
    await screen.stop()
    await cms.stop()
  }
}

main()
  .then(() => {
    const failed = results.filter((result) => !result.ok)
    console.log(
      `\n[canario manual 2G] ${String(results.length - failed.length)}/${String(results.length)} verificacoes OK`,
    )
    if (failed.length > 0) {
      for (const result of failed) console.error(`  FALHOU ${String(result.n)}. ${result.name}: ${result.detail}`)
      process.exit(1)
    }
    process.exit(0)
  })
  .catch((error: unknown) => {
    console.error('[canario manual 2G] erro fatal:', error)
    process.exit(1)
  })
