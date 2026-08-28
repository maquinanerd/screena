#!/usr/bin/env node
/**
 * bin/promote-media.ts — Promocao/reversao GOVERNADA de midia do TMDB.
 *
 * ============================================================================
 * O QUE ESTE COMANDO CONSERTA
 * ============================================================================
 * Duas tabelas nascem `display_allowed = false` E `license_status = 'unknown'`
 * por linha, e ate hoje NADA no repositorio as promovia:
 *
 *   `tmdb_videos`                       -> trailer da ficha, galeria de videos,
 *                                          trilho "Em breve" da home;
 *   `tmdb_images` (pessoa / profile)    -> galeria de fotos em /pt/pessoas/.
 *
 * A licenca da FONTE ja existe para as duas (`source_licenses`), e e por isso
 * que a galeria de imagens de TITULO acendeu em 21-22/08 — aquela e gated pela
 * fonte. Estas duas sao gated pela LINHA, e a linha nunca foi escrita.
 *
 * ============================================================================
 * O QUE ELE NAO FAZ
 * ============================================================================
 * Nao chama rede (nem TMDB, nem nada — `quota_cost = 0` no log e a prova). Nao
 * cria linha. Nao roda ingestao. Nao toca `external_ratings`, `watch_availability`,
 * `content_blocks` nem `page_indexability_decisions`. Nao mexe na galeria de
 * imagens de TITULO (gated pela fonte; a coluna da linha e ignorada la de
 * proposito — ver `apps/web/src/server/entity-gallery.ts`).
 *
 * ============================================================================
 * TRES BARREIRAS, NENHUMA CONTORNAVEL POR FLAG
 * ============================================================================
 *   1. LICENCA   — le `source_licenses`. Nao existe `--license-ok`; `--force`
 *                  nao a pula e `--confirm` nao a substitui.
 *   2. GUARDRAIL — por linha, espelhando o que o render aceitaria.
 *   3. FREIO     — teto de volume (500 / 5%), como o freio da #221. Exit 5.
 *                  NAO e teto por execucao: e o ponto em que o comando exige
 *                  `--confirm-mass-change`. Com o opt-in, UMA execucao promove
 *                  o acervo inteiro.
 *
 * ============================================================================
 * O COMANDO UNICO — UMA EXECUCAO, ACERVO INTEIRO
 * ============================================================================
 *   corepack pnpm --filter @screena/ingestion media:liberar-tudo  *     --reviewer="Pablo Eduardo"
 *
 * E ISSO. Uma vez. Nao ha teto por execucao a ser contornado com repeticao: o
 * lote de 200 do `updateMany` e interno, o comando itera sozinho ate acabar, e
 * `--target=all` cobre os dois alvos na MESMA execucao (cada um com censo e
 * freio proprios). O `--reviewer` continua obrigatorio: identidade humana no
 * relatorio e no log e barata e insubstituivel.
 *
 * Para reverter tudo:
 *   corepack pnpm --filter @screena/ingestion media:reverter-tudo  *     --reviewer="Pablo Eduardo"
 *
 * ============================================================================
 * DEPOIS DESTA LEVA, ESTE COMANDO E FERRAMENTA DE ACERVO
 * ============================================================================
 * A linha de midia passou a NASCER no estado que a licenca autoriza (ver
 * `src/media-promotion/birth.ts`). Logo este comando existe para o que ja estava
 * no banco antes de 2026-08-28 e para reverter. Ele deixou de ser rotina.
 *
 * ============================================================================
 * USO GRANULAR (ensaio, alvo unico, reversao pontual)
 * ============================================================================
 *   # DRY-RUN (default): mostra o censo, nada muda
 *   corepack pnpm --filter @screena/ingestion promote:media --target=video
 *
 *   # so uma entidade, para ensaiar
 *   corepack pnpm --filter @screena/ingestion promote:media --target=video --tmdb-id=82856
 *
 *   # aplicar (a primeira execucao estoura o freio: e o desenho)
 *   corepack pnpm --filter @screena/ingestion promote:media --target=video \
 *     --confirm --reviewer="Pablo Eduardo" --confirm-mass-change
 *
 *   # fotos de pessoa
 *   corepack pnpm --filter @screena/ingestion promote:media --target=person-photo
 *
 *   # reverter
 *   corepack pnpm --filter @screena/ingestion promote:media --target=video \
 *     --revoke --confirm --reviewer="Pablo Eduardo" --confirm-mass-change
 *
 * NAO use `--`: medido no pnpm 9.15.4 deste repositorio, o separador chega
 * LITERAL como argumento e o parser o recusa.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { disconnectPrisma, getPrismaClient } from '@screena/db/server'

import { parsePromoteMediaArgs, resolveTargets } from '../src/media-promotion/args.js'
import { renderPromotionReport, summaryLine } from '../src/media-promotion/report.js'
import { combinedExitCode, runMediaPromotion, type PromotionResult } from '../src/media-promotion/run.js'
import { createPrismaMediaPromotionStore } from '../src/persistence/media-promotion-store.js'
import { createPrismaSyncLog } from '../src/persistence/sync-log.js'
import { EXIT_CODES, evaluateCatalogGate, redactSecrets } from '../src/cli/exit.js'

function repoRoot(): string {
  const dir = path.dirname(fileURLToPath(import.meta.url)) // services/ingestion/bin
  return path.resolve(dir, '..', '..', '..')
}

function loadRepoEnv(): void {
  const envPath = path.join(repoRoot(), '.env')
  if (typeof process.loadEnvFile === 'function' && existsSync(envPath)) {
    process.loadEnvFile(envPath)
  }
}

async function main(): Promise<void> {
  loadRepoEnv()

  const parsed = parsePromoteMediaArgs(process.argv.slice(2))
  if (!parsed.ok) {
    console.error(`Argumentos invalidos: ${parsed.error}`)
    process.exitCode = EXIT_CODES.usage
    return
  }
  const args = parsed.args

  // Gate de ambiente: sem DATABASE_URL nada roda; escrita em producao exige
  // `--confirm` (que ja e a flag de mutacao desta CLI) mais o freio.
  const gate = evaluateCatalogGate({
    env: process.env,
    mutates: args.confirm,
    confirmProductionRead: true,
    force: args.confirm,
  })
  if (!gate.ok) {
    console.error(`Bloqueado: ${gate.message}`)
    process.exitCode = EXIT_CODES.blocked
    return
  }

  const prisma = getPrismaClient()
  const alvos = resolveTargets(args.target)
  try {
    const store = createPrismaMediaPromotionStore(prisma)
    // O provider tecnico do log e o TMDB: a midia promovida e dele, ainda que
    // nenhuma requisicao tenha sido feita nesta execucao.
    const syncLog = createPrismaSyncLog(prisma, 'tmdb')
    const resultados: PromotionResult[] = []

    // UM ALVO POR VEZ, na MESMA execucao. Cada iteracao roda a promocao inteira
    // (licenca, guardrails, freio, censo) com o denominador do seu proprio
    // alvo — os censos nao se misturam, e por isso `--target=all` nao afrouxa o
    // freio: ele o aplica N vezes. Ver `ALL_TARGETS` em `src/media-promotion/args.ts`.
    for (const target of alvos) {
      const result = await runMediaPromotion(
        {
          scope: {
            target,
            entityType: args.entityType,
            tmdbId: args.tmdbId,
            limit: args.limit,
          },
          confirm: args.confirm,
          revoke: args.revoke,
          confirmMassChange: args.confirmMassChange,
          guardrails: { onlyOfficial: args.onlyOfficial },
          thresholds: {
            ...(args.maxChanges !== null ? { maxChanges: args.maxChanges } : {}),
            ...(args.maxChangePercent !== null
              ? { maxChangeRatio: args.maxChangePercent / 100 }
              : {}),
          },
        },
        { store, syncLog, now: () => new Date() },
      )
      resultados.push(result)
    }

    if (args.json) {
      // BigInt ja virou string no store; nenhum `id` cru vaza aqui.
      console.log(JSON.stringify(alvos.length === 1 ? resultados[0] : resultados, null, 2))
    } else {
      for (const result of resultados) console.log(renderPromotionReport(result))
    }
    if (args.reviewer !== null) console.log(`revisor: ${args.reviewer}`)
    for (const result of resultados) console.log(summaryLine(result))
    if (resultados.length > 1) {
      const mutadas = resultados.reduce((soma, r) => soma + r.updated, 0)
      console.log(`TOTAL (${resultados.length} alvos) · linhas mutadas=${mutadas}`)
    }

    process.exitCode = combinedExitCode(resultados)
  } catch (error) {
    console.error(redactSecrets(error instanceof Error ? error.stack ?? error.message : String(error)))
    process.exitCode = EXIT_CODES.error
  } finally {
    await disconnectPrisma()
  }
}

await main()
