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
 *
 * ============================================================================
 * USO (a partir da raiz do repo)
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

import { parsePromoteMediaArgs } from '../src/media-promotion/args.js'
import { renderPromotionReport, summaryLine } from '../src/media-promotion/report.js'
import { runMediaPromotion } from '../src/media-promotion/run.js'
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
  try {
    const result = await runMediaPromotion(
      {
        scope: {
          target: args.target,
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
      {
        store: createPrismaMediaPromotionStore(prisma),
        // O provider tecnico do log e o TMDB: a midia promovida e dele, ainda
        // que nenhuma requisicao tenha sido feita nesta execucao.
        syncLog: createPrismaSyncLog(prisma, 'tmdb'),
        now: () => new Date(),
      },
    )

    if (args.json) {
      // BigInt ja virou string no store; nenhum `id` cru vaza aqui.
      console.log(JSON.stringify(result, null, 2))
    } else {
      console.log(renderPromotionReport(result))
    }
    if (args.reviewer !== null) console.log(`revisor: ${args.reviewer}`)
    console.log(summaryLine(result))

    // ---- Exit codes: contrato para o script de operacao. -------------------
    switch (result.outcome) {
      case 'license-denied':
        process.exitCode = EXIT_CODES.blocked
        break
      case 'mass-change-blocked':
        // Code PROPRIO (5), nunca `failed`: quem chama precisa distinguir "o
        // comando quebrou" de "o comando se recusou de proposito e espera um
        // humano".
        process.exitCode = EXIT_CODES.massChangeBlocked
        break
      case 'applied':
        process.exitCode = result.refusals.length > 0 ? EXIT_CODES.failed : EXIT_CODES.ok
        break
      default:
        process.exitCode = EXIT_CODES.ok
    }
  } catch (error) {
    console.error(redactSecrets(error instanceof Error ? error.stack ?? error.message : String(error)))
    process.exitCode = EXIT_CODES.error
  } finally {
    await disconnectPrisma()
  }
}

await main()
