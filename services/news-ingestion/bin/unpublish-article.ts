/**
 * unpublish-article.ts — DESPUBLICACAO DE EMERGENCIA de UM artigo, por id,
 * direto no banco publico. Worker-only/offline (invariantes 3 e 4).
 *
 * Uso (a partir da raiz):
 *   pnpm --filter @screena/news-ingestion unpublish-article -- --article 41
 *   pnpm --filter @screena/news-ingestion unpublish-article -- --article 41 --apply
 *   pnpm --filter @screena/news-ingestion unpublish-article -- \
 *     --article 41 --mode blocked --reason "decisao judicial X" --apply --confirm-production
 *
 * POR QUE ESTE COMANDO EXISTE
 * ---------------------------
 * O caminho normal de despublicacao e a transicao de workflow no CMS
 * (published -> retracted/blocked/archived), que emite evento e o worker
 * projeta. Este comando cobre o caso em que esse caminho NAO existe mais:
 * artigo apagado no CMS (caso real: article 41), worker parado, ou urgencia
 * juridica que nao pode esperar a fila. Ele espelha EXATAMENTE o que a
 * projecao de remocao gravaria (`review_status` blocked/archived +
 * `index_status` noindex) e reprojeta as superficies derivadas (busca +
 * indexabilidade).
 *
 * O que ele NUNCA faz:
 *  - apagar linha alguma (despublicar preserva auditoria e permite reverter);
 *  - publicar (nao ha caminho de subida aqui — so rebaixamento);
 *  - falhar em silencio: todo desfecho loga, e `updated` divergente do plano
 *    e ERRO (padrao que ja mordeu este projeto seis vezes).
 *
 * PRODUCAO: diferente do `editorial.ts` (que recusa producao), este comando e
 * feito PARA a emergencia em producao — mas so com dupla confirmacao explicita:
 * `--apply` E `--confirm-production` quando a URL/NODE_ENV parecem producao.
 */

import { getPrismaClient } from '@screena/db/server'

import { isUnpublishMode } from '../src/unpublish.js'
import { unpublishArticle } from '../src/persistence/unpublish-store.js'

function flag(argv: readonly string[], name: string): string | null {
  const index = argv.indexOf(`--${name}`)
  if (index === -1) return null
  return argv[index + 1] ?? null
}

/** A URL/ambiente parecem producao? (mesmos padroes do editorial.ts — nunca imprime a URL) */
function looksLikeProduction(): boolean {
  const url = process.env.DATABASE_URL ?? ''
  const suspicious = [/rss_prime/i, /_prod/i, /production/i, /screena-db/i, /cinerie-db/i]
  return suspicious.some((p) => p.test(url)) || process.env.NODE_ENV === 'production'
}

function usage(): void {
  console.log(
    [
      'unpublish-article — tira UM artigo do ar, por id, direto no banco publico.',
      '',
      '  --article <id>           id publico do artigo (obrigatorio)',
      '  --mode archived|blocked  archived = despublicacao (default); blocked = retratacao',
      '  --reason "<texto>"       motivo, gravado no log da execucao',
      '  --apply                  sem esta flag e DRY-RUN: mostra o plano e nao escreve',
      '  --confirm-production     obrigatoria quando DATABASE_URL/NODE_ENV parecem producao',
      '',
      'Este comando NUNCA publica nem apaga: so rebaixa review_status/index_status.',
      'Se o documento ainda existir no CMS, retrate/arquive tambem la — um novo',
      'evento de publicacao pode recolocar a materia no ar.',
    ].join('\n'),
  )
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.length === 0) {
    usage()
    return
  }

  const articleRaw = flag(argv, 'article')
  if (articleRaw === null || !/^\d+$/.test(articleRaw.trim())) {
    console.error('[unpublish] ERRO: --article <id numerico> e obrigatorio.')
    process.exitCode = 2
    return
  }
  const articleId = BigInt(articleRaw.trim())

  const mode = flag(argv, 'mode') ?? 'archived'
  if (!isUnpublishMode(mode)) {
    console.error(`[unpublish] ERRO: --mode invalido ("${mode}"); use archived ou blocked.`)
    process.exitCode = 2
    return
  }
  const apply = argv.includes('--apply')
  const reason = flag(argv, 'reason')

  if ((process.env.DATABASE_URL ?? '') === '') {
    console.error('[unpublish] ERRO: DATABASE_URL ausente no ambiente.')
    process.exitCode = 2
    return
  }
  const production = looksLikeProduction()
  if (production && apply && !argv.includes('--confirm-production')) {
    console.error(
      '[unpublish] ERRO: DATABASE_URL/NODE_ENV parecem PRODUCAO. ' +
        'Para aplicar em producao, repita com --confirm-production (dupla confirmacao deliberada).',
    )
    process.exitCode = 3
    return
  }

  console.log('== Cinerie · despublicacao de emergencia ==')
  console.log(
    `artigo=${articleId} modo=${mode} apply=${apply ? 'SIM' : 'nao (dry-run)'} producao=${production ? 'SIM' : 'nao'}`,
  )
  if (reason !== null) console.log(`motivo: ${reason}`)

  const prisma = getPrismaClient()
  try {
    const result = await unpublishArticle(prisma, {
      articleId,
      mode,
      apply,
      nowIso: new Date().toISOString(),
    })

    if (result.outcome === 'article_not_found') {
      console.error(`[unpublish] ERRO: artigo ${articleId} nao existe no banco publico.`)
      process.exitCode = 2
      return
    }
    if (result.outcome === 'no_translations') {
      console.error(
        `[unpublish] ERRO: artigo ${articleId} existe mas nao tem NENHUMA traducao — nada a despublicar (estado inesperado, investigue).`,
      )
      process.exitCode = 2
      return
    }

    console.log(`\nEstado atual (${result.before.length} traducao/oes):`)
    for (const t of result.before) {
      console.log(
        `  [${t.languageCode}] slug=${t.slug} review_status=${t.reviewStatus} index_status=${t.indexStatus} render=${t.renderable ? 'NO AR' : '404'}`,
      )
    }

    if (result.outcome === 'noop') {
      console.log(
        `\n[unpublish] Nada a fazer: todas as traducoes ja estao review_status=${mode} + index_status=noindex (idempotente).`,
      )
      return
    }

    if (result.outcome === 'planned') {
      console.log(
        `\nPlano: rebaixar ${result.plannedCount} traducao/oes para review_status=${mode} + index_status=noindex.`,
      )
      console.log('[unpublish] DRY-RUN: nada foi escrito. Repita com --apply para executar.')
      return
    }

    console.log(`\n[unpublish] rebaixadas: ${result.updatedCount} traducao/oes.`)
    console.log(
      result.reprojected
        ? '[unpublish] reprojecao: busca + indexabilidade atualizadas.'
        : '[unpublish] reprojecao: artigo sem traducao pt-BR; nada a reprojetar.',
    )
    console.log('\nEstado final:')
    for (const t of result.after) {
      console.log(
        `  [${t.languageCode}] review_status=${t.reviewStatus} index_status=${t.indexStatus} -> render: ${t.renderable ? 'AINDA NO AR (!)' : '404'}`,
      )
    }
    console.log(
      `\n[unpublish] OK: artigo ${articleId} fora do ar (pagina 404, fora da listagem, fora do sitemap).`,
    )
    if (reason !== null) console.log(`[unpublish] motivo registrado no log: ${reason}`)
    console.log(
      '[unpublish] Lembrete: se o documento AINDA existir no CMS, um novo evento de publicacao pode recoloca-lo no ar — retrate/arquive tambem la.',
    )
  } finally {
    await prisma.$disconnect()
  }
}

await main().catch((error: unknown) => {
  console.error(String(error instanceof Error ? error.message : error))
  process.exitCode = 1
})
