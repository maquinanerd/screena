/**
 * qa-editorial-seed.ts — Seed editorial EXCLUSIVO DE QA/E2E LOCAL. Worker-only.
 *
 * Cria um pequeno conjunto DETERMINÍSTICO de artigos publicados (pt-BR) para
 * exercitar visualmente News (tela 03) e Artigo (tela 05): manchete, deck,
 * corpo, autoria, data, entidades relacionadas e busca (via reprojeção real).
 *
 * GOVERNANÇA:
 *  - LOCAL ONLY / TEST ONLY / NO PRODUCTION: mesma barreira anti-produção do
 *    editorial.ts — recusa DATABASE_URL que se pareça com produção.
 *  - NÃO representa publicação editorial real da Cinerie e NÃO altera a
 *    governança humana do editorial: é um fixture de banco local descartável.
 *  - Idempotente: upsert por slug `qa-seed-*`; rodar duas vezes não duplica.
 *  - Zero API externa; só PostgreSQL local.
 *
 * Uso (a partir da raiz, com DATABASE_URL do banco LOCAL de QA):
 *   pnpm --filter @screena/news-ingestion exec tsx bin/qa-editorial-seed.ts --apply
 */

import { getPrismaClient } from '@screena/db/server'

import { reprojectArticle } from '../src/persistence/editorial-store.js'

function assertNotProduction(): void {
  const url = process.env.DATABASE_URL ?? ''
  if (url === '') throw new Error('DATABASE_URL ausente')
  // FAIL-CLOSED por ALLOWLIST: este seed cria artigos published/index — so
  // roda contra banco LOCAL. Denylist de nomes nao basta (m4 adversarial).
  let host = ''
  try {
    host = new URL(url).hostname
  } catch {
    throw new Error('DATABASE_URL invalida. Abortado.')
  }
  const localHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
  if (!localHosts.has(host) || process.env.NODE_ENV === 'production') {
    throw new Error(
      'qa-editorial-seed so roda contra banco LOCAL (host 127.0.0.1/localhost). Abortado.',
    )
  }
}

interface QaArticle {
  slug: string
  title: string
  deck: string
  body: string
  category: string
  authorName: string
  readTimeMinutes: number
  daysAgo: number
  entity?: { entityType: 'movie' | 'tv'; titleContains: string }
}

/** Conteúdo sintético e neutro (QA), sem fato real afirmado como notícia. */
const QA_ARTICLES: QaArticle[] = [
  {
    slug: 'qa-seed-bastidores-da-fotografia',
    title: 'Como a fotografia recente do cinema redescobriu a luz natural',
    deck: 'Um panorama de QA sobre a tendência visual que dominou os grandes lançamentos do ano.',
    body: 'Texto sintético de QA. Este corpo existe apenas para validar tipografia, ritmo vertical e composição do artigo canônico em ambiente local.\n\nSegundo parágrafo de QA, com extensão suficiente para exercitar o corpo do artigo, entrelinhas e a coluna de leitura de 720px definida pelo design system.\n\nTerceiro parágrafo de QA para dar altura à página e permitir validar a barra de progresso de leitura e os blocos relacionados.',
    category: 'Bastidores',
    authorName: 'Redação Cinerie',
    readTimeMinutes: 5,
    daysAgo: 1,
    entity: { entityType: 'movie', titleContains: 'Dune' },
  },
  {
    slug: 'qa-seed-temporada-de-estreias',
    title: 'A temporada de estreias que promete lotar as salas de novo',
    deck: 'Levantamento sintético de QA sobre o calendário de lançamentos do próximo trimestre.',
    body: 'Texto sintético de QA para a listagem de notícias. Parágrafo único mais curto, útil para validar cards de resumo.\n\nSegundo parágrafo breve de QA.',
    category: 'Estreias',
    authorName: 'Equipe de QA',
    readTimeMinutes: 3,
    daysAgo: 2,
    entity: { entityType: 'movie', titleContains: 'Superman' },
  },
  {
    slug: 'qa-seed-series-em-alta',
    title: 'Por que as séries de meia hora voltaram a dominar a conversa',
    deck: 'Análise sintética de QA sobre o formato que virou aposta das plataformas.',
    body: 'Texto sintético de QA sobre séries. Existe para dar conteúdo real ao filtro "Séries" da tela de notícias.\n\nSegundo parágrafo de QA.',
    category: 'Séries',
    authorName: 'Equipe de QA',
    readTimeMinutes: 4,
    daysAgo: 3,
    entity: { entityType: 'tv', titleContains: 'Stranger Things' },
  },
  {
    slug: 'qa-seed-cinema-de-genero',
    title: 'O novo fôlego do cinema de gênero nas produções nacionais',
    deck: 'Observatório sintético de QA sobre terror e suspense produzidos no Brasil.',
    body: 'Texto sintético de QA sobre cinema. Alimenta o filtro "Cinema" da listagem.\n\nSegundo parágrafo de QA.',
    category: 'Cinema',
    authorName: 'Redação Cinerie',
    readTimeMinutes: 6,
    daysAgo: 4,
  },
  {
    slug: 'qa-seed-entrevista-fotografa',
    title: 'Entrevista de QA: a diretora de fotografia por trás do plano-sequência',
    deck: 'Conversa sintética de QA para validar a categoria Entrevista.',
    body: 'Texto sintético de QA em formato de entrevista.\n\nPergunta de QA?\n\nResposta de QA com um parágrafo completo para dar corpo à página.',
    category: 'Entrevista',
    authorName: 'Equipe de QA',
    readTimeMinutes: 8,
    daysAgo: 5,
    entity: { entityType: 'tv', titleContains: 'The Last of Us' },
  },
  {
    slug: 'qa-seed-guia-de-plataformas',
    title: 'Guia de QA: como acompanhar lançamentos sem perder nenhuma estreia',
    deck: 'Serviço sintético de QA para a última posição da listagem.',
    body: 'Texto sintético de QA de serviço.\n\nSegundo parágrafo de QA.',
    category: 'Streaming',
    authorName: 'Redação Cinerie',
    readTimeMinutes: 4,
    daysAgo: 6,
  },
]

// Feed adicional: garante volume para o feed "Últimas notícias" + "Mais lidas".
const CATEGORIAS_FEED = ['Prêmios', 'Bastidores', 'Bilheteria', 'Estreias', 'Crítica', 'Séries', 'Streaming', 'Entrevista'] as const
for (let i = 0; i < CATEGORIAS_FEED.length; i++) {
  const categoria = CATEGORIAS_FEED[i] as string
  QA_ARTICLES.push({
    slug: `qa-seed-feed-${i + 1}`,
    title: `Panorama de QA ${i + 1}: o que movimentou a semana em ${categoria.toLowerCase()}`,
    deck: `Resumo sintético de QA para o feed de últimas notícias (${categoria}).`,
    body: `Texto sintético de QA para o item ${i + 1} do feed.\n\nSegundo parágrafo de QA.`,
    category: categoria,
    authorName: i % 2 === 0 ? 'Redação Cinerie' : 'Equipe de QA',
    readTimeMinutes: 3 + (i % 5),
    daysAgo: 7 + i,
  })
}

async function main(): Promise<void> {
  assertNotProduction()
  const apply = process.argv.includes('--apply')
  if (!apply) {
    console.log(`[qa-seed] dry-run: ${QA_ARTICLES.length} artigo(s) planejado(s). Use --apply.`)
    return
  }
  const prisma = getPrismaClient()
  const now = new Date()

  for (const item of QA_ARTICLES) {
    const publishedAt = new Date(now.getTime() - item.daysAgo * 24 * 60 * 60 * 1000)

    const existing = await prisma.articleTranslation.findFirst({
      where: { languageCode: 'pt-BR', slug: item.slug },
      select: { articleId: true },
    })

    let articleId: bigint
    if (existing !== null) {
      articleId = existing.articleId
      await prisma.article.update({
        where: { id: articleId },
        data: {
          category: item.category,
          authorName: item.authorName,
          publishedAt,
          readTimeMinutes: item.readTimeMinutes,
          licenseStatus: 'official',
          displayAllowed: true,
        },
      })
      await prisma.articleTranslation.updateMany({
        where: { articleId, languageCode: 'pt-BR' },
        data: {
          title: item.title,
          deck: item.deck,
          body: item.body,
          reviewStatus: 'published',
          indexStatus: 'index',
          publishedAt,
        },
      })
    } else {
      const created = await prisma.article.create({
        data: {
          category: item.category,
          authorName: item.authorName,
          publishedAt,
          readTimeMinutes: item.readTimeMinutes,
          licenseStatus: 'official',
          displayAllowed: true,
          translations: {
            create: {
              languageCode: 'pt-BR',
              slug: item.slug,
              title: item.title,
              deck: item.deck,
              body: item.body,
              metaTitle: item.title,
              metaDescription: item.deck,
              reviewStatus: 'published',
              indexStatus: 'index',
              publishedAt,
            },
          },
        },
        select: { id: true },
      })
      articleId = created.id
    }

    if (item.entity !== undefined) {
      const entityId =
        item.entity.entityType === 'movie'
          ? (
              await prisma.movie.findFirst({
                where: { titleOriginal: { contains: item.entity.titleContains } },
                select: { id: true },
              })
            )?.id
          : (
              await prisma.tvShow.findFirst({
                where: { nameOriginal: { contains: item.entity.titleContains } },
                select: { id: true },
              })
            )?.id
      if (entityId !== undefined) {
        await prisma.entityNewsLink.upsert({
          where: {
            articleId_entityType_entityId: {
              articleId,
              entityType: item.entity.entityType,
              entityId,
            },
          },
          create: { articleId, entityType: item.entity.entityType, entityId },
          update: {},
        })
      }
    }

    // Projeção REAL (busca + indexabilidade) pela mesma rotina do pipeline.
    await reprojectArticle(prisma, articleId.toString(), now.toISOString())
    console.log(`[qa-seed] ok: ${item.slug}`)
  }
  console.log(`[qa-seed] concluído: ${QA_ARTICLES.length} artigo(s).`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[qa-seed] falha:', error instanceof Error ? error.message : error)
    process.exit(1)
  })
