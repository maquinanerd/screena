/**
 * validate-editorial-platform-real-postgres.ts — Prova, em PostgreSQL 16 REAL e
 * efemero, a cadeia editorial do Prompt 10: fonte -> item recebido ->
 * proveniencia -> artigo -> publicacao -> projecao publica.
 *
 * Nao testa SQL sintetico: aplica a migration REAL, usa os MESMOS adapters do
 * runtime (`../src/persistence/editorial-store.js`) e verifica o estado
 * resultante e as travas do banco (CHECKs, uniques parciais, FKs).
 *
 * FERRAMENTA DE DESENVOLVIMENTO DESCARTAVEL — nunca em produto/render/producao.
 * Motor: embedded-postgres (PostgreSQL 16 real, efemero), devDependency-only.
 * Seguranca: nenhum segredo; DATABASE_URL so em memoria; PG derrubado no finally.
 *
 * Uso (a partir da raiz): pnpm validate:editorial-platform
 */

import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import net from 'node:net'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import EmbeddedPostgres from 'embedded-postgres'
import { PrismaClient } from '@prisma/client'

import {
  countArticleProvenance,
  ingestSourceItem,
  linkArticleSource,
  readEditorialCensus,
  reprojectArticle,
  writeArticleSlugRedirect,
} from '../src/persistence/editorial-store.js'
import { evaluatePublishGate } from '../src/lifecycle.js'
import { evaluateEditorialSentinel } from '../src/metrics.js'
import { planArticleSlugChange } from '../src/slug.js'

const require = createRequire(import.meta.url)
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..', '..', '..')
const dbDir = path.join(repoRoot, 'packages', 'db')
const schemaPath = path.join(dbDir, 'prisma', 'schema.prisma')

const NOW = '2026-07-20T12:00:00.000Z'
const LONG_BODY = 'Corpo editorial proprio da Cinerie. '.repeat(12)

interface CheckResult {
  n: number
  name: string
  ok: boolean
  detail: string
}
const results: CheckResult[] = []
function record(n: number, name: string, ok: boolean, detail: string): void {
  results.push({ n, name, ok, detail })
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${n}. ${name} — ${detail}`)
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      resolve(typeof addr === 'object' && addr ? addr.port : 0)
      srv.close()
    })
  })
}

function prismaBin(): string {
  const pkgPath = require.resolve('prisma/package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { bin: string | Record<string, string> }
  const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.prisma
  return path.join(path.dirname(pkgPath), rel)
}

async function safeRm(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return
    } catch {
      await new Promise((r) => setTimeout(r, 300))
    }
  }
}

/** Uma operacao que DEVE ser recusada pelo banco. */
async function expectRejected(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn()
    return null
  } catch (error) {
    return (error as Error).message.split('\n').find((l) => l.trim() !== '') ?? 'erro'
  }
}

async function runChecks(url: string): Promise<void> {
  const prisma = new PrismaClient({ datasources: { db: { url } } })
  try {
    /* ---------------------------------------------------------- */
    /* 1-3. Fonte editorial                                        */
    /* ---------------------------------------------------------- */

    const source = await prisma.editorialSource.create({
      data: { slug: 'collider', name: 'Collider', domain: 'collider.com' },
      select: { id: true, status: true, useRights: true, requiresAttribution: true },
    })
    record(
      1,
      'fonte criada com defaults SEGUROS',
      String(source.status) === 'paused' &&
        String(source.useRights) === 'unknown' &&
        source.requiresAttribution === true,
      `status=${source.status} use_rights=${source.useRights}`,
    )

    const badDomain = await expectRejected(() =>
      prisma.editorialSource.create({
        data: { slug: 'ruim', name: 'Ruim', domain: 'https://www.Ruim.com/feed' },
      }),
    )
    record(2, 'CHECK recusa dominio nao normalizado', badDomain !== null, badDomain ?? 'ACEITOU')

    const dupDomain = await expectRejected(() =>
      prisma.editorialSource.create({
        data: { slug: 'collider-2', name: 'Collider 2', domain: 'collider.com' },
      }),
    )
    record(3, 'dominio e unico', dupDomain !== null, dupDomain ?? 'ACEITOU')

    const sourceId = source.id.toString()
    await prisma.editorialSource.update({
      where: { id: source.id },
      data: { status: 'active', useRights: 'headline_and_link_only' },
    })

    /* ---------------------------------------------------------- */
    /* 4-9. Ingestao e deduplicacao                                */
    /* ---------------------------------------------------------- */

    const rawItem = {
      sourceId,
      externalId: 'collider-123',
      url: 'https://www.collider.com/duna-trailer/?utm_source=rss',
      title: 'Trailer de Duna e divulgado',
      excerpt: 'Warner mostrou a primeira previa.',
      publishedAtIso: '2026-07-18T09:00:00.000Z',
      rawPayload: { id: 123 },
    }

    const first = await ingestSourceItem(prisma, rawItem)
    record(4, 'item recebido criado', first.outcome === 'created', `outcome=${first.outcome}`)

    const second = await ingestSourceItem(prisma, rawItem)
    const itemCount = await prisma.sourceItem.count()
    record(
      5,
      'REINGESTAO e idempotente: zero duplicata',
      second.outcome === 'unchanged' && second.itemId === first.itemId && itemCount === 1,
      `outcome=${second.outcome} itens=${itemCount}`,
    )

    const viaOtherChannel = await ingestSourceItem(prisma, {
      ...rawItem,
      url: 'https://collider.com/duna-trailer?utm_source=twitter&fbclid=x',
    })
    const afterChannel = await prisma.sourceItem.count()
    record(
      6,
      'mesma URL com tracking diferente nao duplica',
      afterChannel === 1 && viaOtherChannel.itemId === first.itemId,
      `itens=${afterChannel}`,
    )

    const updated = await ingestSourceItem(prisma, {
      ...rawItem,
      title: 'Trailer de Duna e divulgado (atualizado)',
    })
    const afterUpdate = await prisma.sourceItem.count()
    record(
      7,
      'item ATUALIZADO na fonte atualiza, nao duplica',
      updated.outcome === 'updated' && afterUpdate === 1,
      `outcome=${updated.outcome} itens=${afterUpdate}`,
    )

    // REGRESSAO (revisao adversarial): o MESMO recurso reaparecendo na MESMA
    // fonte com outro external_id - feed que regenera GUIDs, ou duas categorias
    // do mesmo site carregando a mesma materia. O adapter tentava criar uma
    // linha nova e batia no unique parcial (source_id, normalized_url),
    // ABORTANDO a ingestao. Uma duplicata ESPERADA nunca pode virar erro.
    const sameUrlOtherGuid = await ingestSourceItem(prisma, {
      ...rawItem,
      externalId: 'collider-123-regenerado',
    })
    const afterSameUrl = await prisma.sourceItem.count()
    record(
      31,
      'mesmo recurso com outro external_id NA MESMA fonte deduplica sem abortar',
      sameUrlOtherGuid.outcome === 'duplicate' &&
        sameUrlOtherGuid.itemId === first.itemId &&
        afterSameUrl === 1,
      `outcome=${sameUrlOtherGuid.outcome} itens=${afterSameUrl}`,
    )

    const excerptTooLong = await expectRejected(() =>
      prisma.sourceItem.create({
        data: {
          sourceId: source.id,
          externalId: 'corpo-inteiro',
          title: 'Espelho de conteudo alheio',
          excerpt: 'x'.repeat(1001),
        },
      }),
    )
    record(
      8,
      'CHECK impede espelhar corpo integral de terceiro',
      excerptTooLong !== null,
      excerptTooLong ?? 'ACEITOU',
    )

    const selfDuplicate = await expectRejected(() =>
      prisma.$executeRawUnsafe(
        `UPDATE source_items SET dedup_verdict = 'duplicate', duplicate_of_id = id WHERE id = ${first.itemId}`,
      ),
    )
    record(
      9,
      'CHECK impede item ser duplicata de si mesmo',
      selfDuplicate !== null,
      selfDuplicate ?? 'ACEITOU',
    )

    const relatedWithPrimary = await expectRejected(() =>
      prisma.$executeRawUnsafe(
        `UPDATE source_items SET dedup_verdict = 'related', duplicate_of_id = ${first.itemId} WHERE id = ${first.itemId}`,
      ),
    )
    record(
      10,
      'fail-closed: veredito `related` nunca aponta primario',
      relatedWithPrimary !== null,
      relatedWithPrimary ?? 'ACEITOU',
    )

    /* ---------------------------------------------------------- */
    /* 11-14. Artigo, proveniencia e entidades                     */
    /* ---------------------------------------------------------- */

    await prisma.language.upsert({
      where: { code: 'pt-BR' },
      create: { code: 'pt-BR', namePt: 'Portugues (Brasil)', nameEn: 'Portuguese (Brazil)', isPublished: true, indexDefault: true },
      update: {},
    })

    const article = await prisma.article.create({
      data: {
        category: 'Trailers',
        authorName: 'Redacao Cinerie',
        publishedAt: new Date('2026-07-19T10:00:00.000Z'),
        licenseStatus: 'official',
        displayAllowed: true,
        sourceName: 'Collider',
        sourceUrl: 'https://collider.com/duna-trailer',
      },
      select: { id: true },
    })
    const articleId = article.id.toString()

    await prisma.articleTranslation.create({
      data: {
        articleId: article.id,
        languageCode: 'pt-BR',
        slug: 'trailer-de-duna',
        title: 'Trailer de Duna e divulgado',
        deck: 'Warner mostra a primeira previa',
        body: LONG_BODY,
        reviewStatus: 'draft',
        indexStatus: 'noindex',
      },
    })

    const gateWithoutProvenance = evaluatePublishGate(
      {
        reviewStatus: 'human_reviewed',
        licenseStatus: 'official',
        displayAllowed: true,
        slug: 'trailer-de-duna',
        title: 'Trailer de Duna e divulgado',
        body: LONG_BODY,
        languageCode: 'pt-BR',
        publishedAtIso: '2026-07-19T10:00:00.000Z',
        requiresAttribution: false,
        requiresLinkback: false,
        sourceName: 'Collider',
        sourceUrl: 'https://collider.com/duna-trailer',
        provenanceCount: await countArticleProvenance(prisma, articleId),
      },
      NOW,
    )
    record(
      11,
      'gate BLOQUEIA publicar artigo sem proveniencia',
      !gateWithoutProvenance.canPublish &&
        gateWithoutProvenance.reasons.includes('missing_required_provenance'),
      gateWithoutProvenance.reasons.join(','),
    )

    await linkArticleSource(prisma, {
      articleId,
      sourceId,
      sourceItemId: first.itemId,
      role: 'primary',
    })
    await linkArticleSource(prisma, {
      articleId,
      sourceId,
      sourceItemId: first.itemId,
      role: 'primary',
    })
    const provenance = await countArticleProvenance(prisma, articleId)
    record(12, 'proveniencia e idempotente', provenance === 1, `links=${provenance}`)

    // Duas fontes primarias no mesmo artigo violam o unique parcial.
    const otherSource = await prisma.editorialSource.create({
      data: { slug: 'variety', name: 'Variety', domain: 'variety.com' },
      select: { id: true },
    })
    const twoPrimaries = await expectRejected(() =>
      prisma.articleSourceLink.create({
        data: { articleId: article.id, sourceId: otherSource.id, role: 'primary' },
      }),
    )
    record(
      13,
      'no maximo UMA fonte primaria por artigo',
      twoPrimaries !== null,
      twoPrimaries ?? 'ACEITOU',
    )

    // Fonte que sustenta artigo publicado NAO pode ser apagada (RESTRICT):
    // "parar de ingerir" e diferente de "apagar evidencia".
    const deleteSource = await expectRejected(() =>
      prisma.editorialSource.delete({ where: { id: source.id } }),
    )
    record(
      14,
      'FK RESTRICT preserva evidencia historica da fonte',
      deleteSource !== null,
      deleteSource ?? 'ACEITOU',
    )

    /* ---------------------------------------------------------- */
    /* 15-20. Projecao publica: draft, agendada, publicada         */
    /* ---------------------------------------------------------- */

    const draftProjection = await reprojectArticle(prisma, articleId, NOW)
    const draftDocs = await prisma.searchDocument.count({ where: { docKind: 'article' } })
    record(
      15,
      'RASCUNHO nao entra na busca nem indexa',
      draftProjection?.searchDocument === 'removed' &&
        draftProjection.decision === 'noindex' &&
        draftDocs === 0,
      `decision=${draftProjection?.decision} docs=${draftDocs}`,
    )

    // Publicada com data FUTURA (agendada).
    await prisma.articleTranslation.updateMany({
      where: { articleId: article.id },
      data: {
        reviewStatus: 'published',
        indexStatus: 'index',
        publishedAt: new Date('2026-12-01T00:00:00.000Z'),
      },
    })
    const scheduledProjection = await reprojectArticle(prisma, articleId, NOW)
    const scheduledDocs = await prisma.searchDocument.count({ where: { docKind: 'article' } })
    record(
      16,
      'AGENDADA (published_at futuro) nao vaza para busca nem indice',
      scheduledProjection?.searchDocument === 'removed' &&
        scheduledProjection.decision === 'noindex' &&
        scheduledDocs === 0,
      `decision=${scheduledProjection?.decision} docs=${scheduledDocs}`,
    )

    // Agora publicada de verdade.
    await prisma.articleTranslation.updateMany({
      where: { articleId: article.id },
      data: { publishedAt: new Date('2026-07-19T10:00:00.000Z') },
    })
    const publishedProjection = await reprojectArticle(prisma, articleId, NOW)
    const searchDoc = await prisma.searchDocument.findFirst({
      where: { docKind: 'article', articleId: article.id },
      select: { canonicalUrl: true, entityType: true, entityId: true, normalizedText: true },
    })
    record(
      17,
      'PUBLICADA entra na busca e indexa',
      publishedProjection?.searchDocument === 'upserted' &&
        publishedProjection.decision === 'index' &&
        searchDoc?.canonicalUrl === '/pt/noticias/trailer-de-duna/',
      `decision=${publishedProjection?.decision} url=${searchDoc?.canonicalUrl}`,
    )
    record(
      18,
      'documento de artigo NAO carrega entity_type/entity_id (CHECK de forma)',
      searchDoc?.entityType === null && searchDoc?.entityId === null,
      `entity_type=${searchDoc?.entityType} entity_id=${searchDoc?.entityId}`,
    )
    record(
      19,
      'busca NAO indexa o corpo do artigo',
      searchDoc?.normalizedText !== undefined &&
        !searchDoc.normalizedText.includes('corpo editorial proprio'),
      `normalized_text=${(searchDoc?.normalizedText ?? '').slice(0, 60)}...`,
    )

    // Reprojetar duas vezes nao duplica documento nem decisao.
    await reprojectArticle(prisma, articleId, NOW)
    const docsAfter = await prisma.searchDocument.count({
      where: { docKind: 'article', articleId: article.id },
    })
    const currentDecisions = await prisma.pageIndexabilityDecision.count({
      where: { docKind: 'article', articleId: article.id, isCurrent: true },
    })
    record(
      20,
      'reprojecao e IDEMPOTENTE (1 documento, 1 decisao vigente)',
      docsAfter === 1 && currentDecisions === 1,
      `docs=${docsAfter} decisoes_vigentes=${currentDecisions}`,
    )

    /* ---------------------------------------------------------- */
    /* 21-24. Travas de forma e unicidade                          */
    /* ---------------------------------------------------------- */

    const twoArticleDocs = await expectRejected(() =>
      prisma.searchDocument.create({
        data: {
          docKind: 'article',
          articleId: article.id,
          locale: 'pt-BR',
          primaryText: 'duplicado',
          normalizedText: 'duplicado',
        },
      }),
    )
    record(
      21,
      'unique parcial impede 2 documentos de busca do MESMO artigo',
      twoArticleDocs !== null,
      twoArticleDocs ?? 'ACEITOU',
    )

    const hybridDoc = await expectRejected(() =>
      prisma.searchDocument.create({
        data: {
          docKind: 'article',
          articleId: article.id,
          entityType: 'movie',
          entityId: 1n,
          locale: 'en',
          primaryText: 'hibrido',
          normalizedText: 'hibrido',
        },
      }),
    )
    record(
      22,
      'CHECK impede documento hibrido entidade+artigo',
      hybridDoc !== null,
      hybridDoc ?? 'ACEITOU',
    )

    const twoCurrent = await expectRejected(() =>
      prisma.pageIndexabilityDecision.create({
        data: {
          docKind: 'article',
          articleId: article.id,
          languageCode: 'pt-BR',
          url: '/pt/noticias/trailer-de-duna/',
          decision: 'index',
          isCurrent: true,
        },
      }),
    )
    record(
      23,
      'unique parcial impede 2 decisoes VIGENTES do mesmo artigo',
      twoCurrent !== null,
      twoCurrent ?? 'ACEITOU',
    )

    const correctionHalf = await expectRejected(() =>
      prisma.$executeRawUnsafe(
        `UPDATE article_translations SET corrected_at = NOW() WHERE article_id = ${articleId}`,
      ),
    )
    record(
      24,
      'CHECK exige correcao completa (data + nota)',
      correctionHalf !== null,
      correctionHalf ?? 'ACEITOU',
    )

    /* ---------------------------------------------------------- */
    /* 25-27. Correcao, slug e redirect                            */
    /* ---------------------------------------------------------- */

    const before = await prisma.articleTranslation.findFirst({
      where: { articleId: article.id },
      select: { publishedAt: true, slug: true, updatedAt: true },
    })
    await new Promise((r) => setTimeout(r, 20))
    await prisma.articleTranslation.updateMany({
      where: { articleId: article.id },
      data: {
        body: `${LONG_BODY} Texto corrigido.`,
        correctedAt: new Date(NOW),
        correctionNote: 'Corrigido o nome do diretor.',
      },
    })
    const after = await prisma.articleTranslation.findFirst({
      where: { articleId: article.id },
      select: { publishedAt: true, slug: true, updatedAt: true, correctionNote: true },
    })
    record(
      25,
      'correcao preserva slug e published_at, so anda updated_at',
      after?.slug === before?.slug &&
        after?.publishedAt?.getTime() === before?.publishedAt?.getTime() &&
        (after?.updatedAt.getTime() ?? 0) > (before?.updatedAt.getTime() ?? 0) &&
        after?.correctionNote === 'Corrigido o nome do diretor.',
      `slug=${after?.slug} updated_at avancou=${(after?.updatedAt.getTime() ?? 0) > (before?.updatedAt.getTime() ?? 0)}`,
    )

    const noSlugChange = planArticleSlugChange({
      currentSlug: 'trailer-de-duna',
      title: 'Titulo completamente diferente agora',
      isPublished: true,
    })
    record(
      26,
      'titulo novo NAO troca slug de artigo publicado',
      !noSlugChange.changed && noSlugChange.redirect === null,
      noSlugChange.reason,
    )

    const deliberate = planArticleSlugChange({
      currentSlug: 'trailer-de-duna',
      title: 'x',
      isPublished: true,
      requestedSlug: 'trailer-de-duna-parte-2',
    })
    if (deliberate.redirect !== null) {
      await writeArticleSlugRedirect(prisma, deliberate.redirect)
      await prisma.articleTranslation.updateMany({
        where: { articleId: article.id },
        data: { slug: deliberate.nextSlug },
      })
    }
    const redirectRow = await prisma.redirect.findFirst({
      where: { fromPath: '/pt/noticias/trailer-de-duna/' },
      select: { toPath: true, statusCode: true },
    })
    record(
      27,
      'troca DELIBERADA de slug publicado grava 301',
      redirectRow?.toPath === '/pt/noticias/trailer-de-duna-parte-2/' &&
        redirectRow.statusCode === 301,
      `-> ${redirectRow?.toPath} (${redirectRow?.statusCode})`,
    )

    /* ---------------------------------------------------------- */
    /* 28-30. Retratacao, cascade e sentinela                      */
    /* ---------------------------------------------------------- */

    await reprojectArticle(prisma, articleId, NOW)
    await prisma.articleTranslation.updateMany({
      where: { articleId: article.id },
      data: { reviewStatus: 'archived' },
    })
    const retracted = await reprojectArticle(prisma, articleId, NOW)
    const docsAfterRetraction = await prisma.searchDocument.count({
      where: { docKind: 'article', articleId: article.id },
    })
    const provenanceAfterRetraction = await countArticleProvenance(prisma, articleId)
    record(
      28,
      'RETRATADA sai da busca mas PRESERVA a proveniencia',
      retracted?.searchDocument === 'removed' &&
        docsAfterRetraction === 0 &&
        provenanceAfterRetraction === 1,
      `docs=${docsAfterRetraction} proveniencia=${provenanceAfterRetraction}`,
    )

    // Sentinela: neste ponto ha artigo "publicado"? Nao (foi arquivado), entao
    // o censo precisa refletir isso sem alarme falso de projecao quebrada.
    const census = await readEditorialCensus(prisma, NOW)
    const alerts = evaluateEditorialSentinel(census)
    record(
      29,
      'sentinela le o censo real sem alarme falso de projecao',
      !alerts.some((a) => a.code === 'search_projection_broken'),
      `alertas=${alerts.map((a) => a.code).join(',') || 'nenhum'}`,
    )

    // Apagar o artigo leva junto documentos e decisoes (CASCADE), mas a
    // fonte e os itens recebidos permanecem: sao evidencia independente.
    await prisma.article.delete({ where: { id: article.id } })
    const orphanDocs = await prisma.searchDocument.count({ where: { docKind: 'article' } })
    const orphanDecisions = await prisma.pageIndexabilityDecision.count({
      where: { docKind: 'article' },
    })
    const survivingItems = await prisma.sourceItem.count()
    record(
      30,
      'CASCADE limpa projecao do artigo; item recebido sobrevive',
      orphanDocs === 0 && orphanDecisions === 0 && survivingItems === 1,
      `docs=${orphanDocs} decisoes=${orphanDecisions} itens=${survivingItems}`,
    )
  } finally {
    await prisma.$disconnect()
  }
}

async function main(): Promise<void> {
  const port = await freePort()
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cinerie-editorial-pg-'))
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
  })
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/cinerie_editorial?schema=public`
  console.log(`\n=== editorial platform — PostgreSQL efemero :${port} (postgres:****) ===\n`)

  let started = false
  try {
    await pg.initialise()
    await pg.start()
    started = true
    await pg.createDatabase('cinerie_editorial')
    const env = { ...process.env, DATABASE_URL: url }
    console.log('--- prisma migrate deploy ---')
    execFileSync('node', [prismaBin(), 'migrate', 'deploy', '--schema', schemaPath], {
      env,
      stdio: 'inherit',
      cwd: dbDir,
    })
    record(-1, 'migrate deploy (do zero)', true, 'ok')
    await runChecks(url)
  } catch (e) {
    record(0, 'boot', false, (e as Error).message.split('\n')[0])
  } finally {
    if (started) {
      try {
        await pg.stop()
      } catch {
        /* best-effort */
      }
    }
    await safeRm(dataDir)
    console.log('\n=== Postgres efemero derrubado ===')
  }

  const failed = results.filter((r) => !r.ok)
  const total = results.filter((r) => r.n > 0).length
  console.log(
    `\nRESUMO (editorial platform): ${total - failed.filter((f) => f.n > 0).length}/${total} checks OK.`,
  )
  if (failed.length > 0) {
    console.error('FALHAS:', failed.map((f) => `${f.n}.${f.name}`).join(' | '))
    process.exit(1)
  }
  console.log(
    'Resultado: PASSOU. Cadeia editorial provada: ingestao idempotente, dedup fail-closed, proveniencia obrigatoria, rascunho/agendada/retratada nunca vazam, projecao reversivel.',
  )
}

await main()
