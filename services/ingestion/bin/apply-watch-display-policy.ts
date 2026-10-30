#!/usr/bin/env node
/**
 * bin/apply-watch-display-policy.ts — Aplica a politica de exibicao de ofertas
 * ao ACERVO ja gravado em `watch_availability`.
 *
 * O sync de detalhe passou a acender sozinho, depois de cada snapshot, a oferta
 * com licenca e decisao vigentes (decisao do dono de 2026-10-29,
 * `src/persistence/watch-display-policy.ts`). Isso so alcanca o titulo que
 * sincronizar de novo. As ofertas que ja estao no banco — 58.823 linhas de filme
 * prontas e apagadas, medidas em 29/10/2026 — esperam este comando.
 *
 * Sem `--confirm` e dry-run: so CONTA quantas acenderiam, nada muda.
 * Com `--confirm`: acende em lotes, uma linha por UPDATE, e o trigger de
 * exibicao continua sendo a ultima palavra (a recusa e listada pelo motivo).
 *
 * NAO FAZ: rede, cota, linha nova, outro `provider_api` que nao `tmdb`, outro
 * pais que nao BR, nota externa. So `display_allowed` (e o carimbo de revisao
 * da politica) em ofertas TMDB BR elegiveis.
 *
 * Uso (a partir da raiz — NUNCA use `--`, ele chega como argumento literal):
 *   pnpm --filter @screena/ingestion apply-watch-display-policy
 *   pnpm --filter @screena/ingestion apply-watch-display-policy --confirm
 *   # flags: --batch=N (default 500, teto 5000) · --limit=N (teto total; default sem teto)
 *
 * EXIT CODES: 0 ok · 2 flag invalida · 4 houve recusa do trigger (acionavel).
 */

import { disconnectPrisma, getPrismaClient } from '@screena/db/server'

import {
  AUTO_DISPLAY_MAX_OFFER_AGE_DAYS,
  WATCH_AUTO_REVIEWER,
  applyWatchDisplayPolicy,
  countWatchDisplayCandidates,
  type WatchDisplayRefusal,
} from '../src/persistence/watch-display-policy.js'

const MAX_BATCH = 5000

interface Args {
  readonly confirm: boolean
  readonly batch: number
  readonly limit: number | null
}

function parseArgs(argv: readonly string[]): Args {
  let confirm = false
  let batch = 500
  let limit: number | null = null
  for (const arg of argv) {
    if (arg === '--confirm') confirm = true
    else if (arg.startsWith('--batch=')) batch = Number(arg.slice('--batch='.length))
    else if (arg.startsWith('--limit=')) limit = Number(arg.slice('--limit='.length))
    else throw new Error(`flag desconhecida: ${arg}`)
  }
  if (!Number.isInteger(batch) || batch < 1 || batch > MAX_BATCH) {
    throw new Error(`--batch precisa ser inteiro entre 1 e ${String(MAX_BATCH)}`)
  }
  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error('--limit precisa ser inteiro positivo')
  }
  return { confirm, batch, limit }
}

async function main(): Promise<number> {
  let args: Args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`[watch-policy] ${(error as Error).message}`)
    return 2
  }

  const prisma = getPrismaClient()
  try {
    const candidates = await countWatchDisplayCandidates(prisma, {})
    console.log(
      `[watch-policy] ofertas TMDB/BR elegiveis agora: ${String(candidates)} ` +
        `(coletadas nos ultimos ${String(AUTO_DISPLAY_MAX_OFFER_AGE_DAYS)} dias, snapshot atual, ` +
        'licenca e decisao vigentes).',
    )
    if (!args.confirm) {
      console.log('[watch-policy] dry-run: nada foi alterado. Rode com --confirm para acender.')
      return 0
    }

    console.log(`[watch-policy] acendendo com reviewed_by=${WATCH_AUTO_REVIEWER}`)
    let displayed = 0
    // Por id: a linha recusada continua elegivel e volta no lote seguinte.
    const refusalsById = new Map<string, WatchDisplayRefusal>()
    for (;;) {
      const remaining = args.limit === null ? args.batch : Math.min(args.batch, args.limit - displayed)
      if (remaining <= 0) break
      const pass = await applyWatchDisplayPolicy(prisma, { limit: remaining })
      displayed += pass.displayed
      for (const refusal of pass.refusals) refusalsById.set(refusal.id, refusal)
      console.log(
        `[watch-policy] lote: ${String(pass.eligible)} candidatas, ${String(pass.displayed)} acesas, ` +
          `${String(pass.refusals.length)} recusadas · total aceso ${String(displayed)}`,
      )
      // Lote sem nenhuma acesa: o que sobrou e so recusa. Repetir buscaria as
      // MESMAS linhas para sempre.
      if (pass.eligible === 0 || pass.displayed === 0) break
    }

    const refusals = [...refusalsById.values()]
    console.log(`[watch-policy] FIM: ${String(displayed)} ofertas acesas, ${String(refusals.length)} recusadas.`)
    for (const refusal of refusals.slice(0, 20)) {
      console.log(`  recusa ${refusal.id}: ${refusal.message}`)
    }
    return refusals.length > 0 ? 4 : 0
  } finally {
    await disconnectPrisma()
  }
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    console.error(error)
    process.exitCode = 1
  },
)
