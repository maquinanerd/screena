/**
 * editorial.ts — CLI OFFLINE da plataforma editorial. Worker-only.
 *
 * Uso (a partir da raiz):
 *   pnpm --filter @screena/news-ingestion editorial <comando> [opcoes]
 *
 * Comandos:
 *   sources                        lista as fontes registradas
 *   ingest --source <slug> --external-id <id> --title <t> [--url <u>] [--excerpt <e>]
 *                                  ingere UM item (idempotente)
 *   reproject --article <id>       reprojeta busca + indexabilidade de um artigo
 *   census                         imprime o censo editorial + alertas da sentinela
 *
 * Governanca:
 *  - Invariantes 3 e 4: nada disto roda no render.
 *  - NUNCA publica: nao ha comando de publicacao. Publicar e decisao editorial
 *    humana registrada, feita pelo admin — uma CLI que publicasse seria
 *    exatamente o atalho que a invariante 12 proibe.
 *  - RECUSA rodar contra base que se pareca com producao (ver `assertNotProduction`).
 */

import { getPrismaClient } from '@screena/db/server'

import {
  ingestSourceItem,
  readEditorialCensus,
  reprojectArticle,
} from '../src/persistence/editorial-store.js'
import { evaluateEditorialSentinel } from '../src/metrics.js'

/**
 * Barreira anti-producao.
 *
 * Esta CLI escreve. Rodar por engano contra a base de producao criaria itens e
 * reescreveria projecoes reais — por isso a checagem e por PADRAO DE NOME/HOST,
 * nao por confianca no operador. `--force-unsafe-production` existe so para o
 * caso deliberado e deixa rastro no log.
 */
function assertNotProduction(argv: readonly string[]): void {
  if (argv.includes('--force-unsafe-production')) {
    console.warn('[editorial] AVISO: barreira de producao IGNORADA por --force-unsafe-production')
    return
  }
  const url = process.env.DATABASE_URL ?? ''
  if (url === '') {
    throw new Error('DATABASE_URL ausente')
  }
  // Nunca imprime a URL: ela carrega credencial.
  const suspicious = [/rss_prime/i, /_prod/i, /production/i, /screena-db/i, /cinerie-db/i]
  const hit = suspicious.find((p) => p.test(url))
  if (hit !== undefined || process.env.NODE_ENV === 'production') {
    throw new Error(
      'DATABASE_URL/NODE_ENV parecem apontar para PRODUCAO. Abortado. ' +
        'Use uma base isolada, ou --force-unsafe-production se for deliberado.',
    )
  }
}

function flag(argv: readonly string[], name: string): string | null {
  const index = argv.indexOf(`--${name}`)
  if (index === -1) return null
  return argv[index + 1] ?? null
}

function required(argv: readonly string[], name: string): string {
  const value = flag(argv, name)
  if (value === null || value.trim() === '') {
    throw new Error(`--${name} e obrigatorio`)
  }
  return value
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const command = argv[0] ?? 'help'

  if (command === 'help' || command === '--help') {
    console.log(
      [
        'Comandos: sources | ingest | reproject | census',
        '  ingest    --source <slug> --external-id <id> --title <t> [--url <u>] [--excerpt <e>]',
        '  reproject --article <id>',
        '',
        'Esta CLI NAO publica artigo: publicacao e decisao editorial humana.',
      ].join('\n'),
    )
    return
  }

  assertNotProduction(argv)
  const prisma = getPrismaClient()

  try {
    if (command === 'sources') {
      const sources = await prisma.editorialSource.findMany({
        select: { id: true, slug: true, name: true, domain: true, status: true, useRights: true },
        orderBy: { slug: 'asc' },
      })
      for (const s of sources) {
        console.log(
          `${s.slug}\t${s.domain}\tstatus=${s.status}\tuse_rights=${s.useRights}\t(${s.name})`,
        )
      }
      console.log(`\n${sources.length} fonte(s).`)
      return
    }

    if (command === 'ingest') {
      const slug = required(argv, 'source')
      const source = await prisma.editorialSource.findUnique({
        where: { slug },
        select: { id: true, status: true },
      })
      if (source === null) throw new Error(`fonte desconhecida: ${slug}`)
      if (String(source.status) !== 'active') {
        // Fonte nasce `paused` de proposito: ingerir de uma fonte nao ativada
        // seria contornar a decisao humana que a ativa.
        throw new Error(`fonte ${slug} nao esta ativa (status=${source.status})`)
      }

      const result = await ingestSourceItem(prisma, {
        sourceId: source.id.toString(),
        externalId: required(argv, 'external-id'),
        title: required(argv, 'title'),
        url: flag(argv, 'url'),
        excerpt: flag(argv, 'excerpt'),
        publishedAtIso: flag(argv, 'published-at'),
      })
      console.log(JSON.stringify(result, null, 2))
      return
    }

    if (command === 'reproject') {
      const articleId = required(argv, 'article')
      const outcome = await reprojectArticle(prisma, articleId, new Date().toISOString())
      if (outcome === null) {
        console.log(`artigo ${articleId} sem traducao pt-BR; nada a projetar.`)
        return
      }
      console.log(JSON.stringify(outcome, null, 2))
      return
    }

    if (command === 'census') {
      const census = await readEditorialCensus(prisma, new Date().toISOString())
      console.log(JSON.stringify(census, null, 2))
      const alerts = evaluateEditorialSentinel(census)
      if (alerts.length === 0) {
        console.log('\nSentinela: nenhum alerta.')
        return
      }
      console.log('\nSentinela:')
      for (const a of alerts) console.log(`  [${a.severity}] ${a.code} — ${a.message}`)
      // Alerta critico sai com codigo != 0 para o agendador perceber.
      if (alerts.some((a) => a.severity === 'critical')) process.exitCode = 1
      return
    }

    throw new Error(`comando desconhecido: ${command}`)
  } finally {
    await prisma.$disconnect()
  }
}

await main()
