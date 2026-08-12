/**
 * register-watch-providers.ts — Registra os provedores CANONICOS de streaming
 * e seus aliases por fornecedor tecnico. Worker-only/offline; IDEMPOTENTE;
 * versionado no repo (o dado vive em ../src/provider-registry.ts).
 *
 * Uso (a partir da raiz):
 *   pnpm --filter @screena/streaming register-watch-providers            # dry-run
 *   pnpm --filter @screena/streaming register-watch-providers --apply
 *   # em producao: --apply --confirm-production
 *
 * ONDE ISTO ENTRA NA CADEIA (o elo que faltava):
 *   oferta crua -> watch_provider_aliases -> watch_providers
 *              -> `pnpm legal sources apply` (licenca + decisao watch_offer_display)
 *              -> sync/promocao com display
 *
 * Nenhum caminho de producao populava as duas tabelas; sem elas o proprio
 * `legal apply` gera ZERO decisoes de streaming ("com zero provedores
 * registrados, retorna lista vazia") e toda oferta morre em `no-alias`.
 *
 * O que este comando NUNCA faz: apagar linha, retargetear alias de outro
 * provedor (conflito aborta, alto), inventar chave (todo alias do registro tem
 * evidencia — ver provider-registry.ts). Alias visto no banco e desconhecido
 * do registro e REPORTADO, nunca tocado.
 */

import { getPrismaClient } from '@screena/db/server'

import {
  ALIAS_PROVIDER_APIS,
  WATCH_PROVIDER_REGISTRY,
  planProviderRegistration,
} from '../src/provider-registry.js'
import {
  applyProviderRegistryPlan,
  readProviderRegistryState,
} from '../src/persistence/provider-registry-store.js'

/** A URL/ambiente parecem producao? (mesmos padroes dos demais bins — nunca imprime a URL) */
function looksLikeProduction(): boolean {
  const url = process.env.DATABASE_URL ?? ''
  const suspicious = [/rss_prime/i, /_prod/i, /production/i, /screena-db/i, /cinerie-db/i]
  return suspicious.some((p) => p.test(url)) || process.env.NODE_ENV === 'production'
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const apply = argv.includes('--apply')

  if ((process.env.DATABASE_URL ?? '') === '') {
    console.error('[provider-registry] ERRO: DATABASE_URL ausente no ambiente.')
    process.exitCode = 2
    return
  }
  const production = looksLikeProduction()
  if (production && apply && !argv.includes('--confirm-production')) {
    console.error(
      '[provider-registry] ERRO: DATABASE_URL/NODE_ENV parecem PRODUCAO. ' +
        'Para aplicar em producao, repita com --confirm-production (dupla confirmacao deliberada).',
    )
    process.exitCode = 3
    return
  }

  console.log('== Cinerie · registro de provedores de streaming ==')
  console.log(`modo=${apply ? 'APPLY' : 'dry-run'} producao=${production ? 'SIM' : 'nao'}`)

  const prisma = getPrismaClient()
  try {
    // Pre-condicao de FK: os fornecedores tecnicos precisam existir em
    // api_providers (vem do `pnpm --filter @screena/db db:seed`). Checar antes
    // troca um erro de FK criptico por uma instrucao.
    const apiProviders = await prisma.apiProvider.findMany({
      where: { key: { in: [...ALIAS_PROVIDER_APIS] } },
      select: { key: true },
    })
    const missing = ALIAS_PROVIDER_APIS.filter(
      (key) => !apiProviders.some((row) => row.key === key),
    )
    if (missing.length > 0) {
      console.error(
        `[provider-registry] ERRO: api_providers sem ${missing.join(', ')} — rode antes: corepack pnpm --filter @screena/db db:seed`,
      )
      process.exitCode = 2
      return
    }

    const state = await readProviderRegistryState(prisma)
    const plan = planProviderRegistration(WATCH_PROVIDER_REGISTRY, state)

    console.log(`\nProvedores (${plan.providers.length}):`)
    for (const p of plan.providers) {
      console.log(`  ${p.action.toUpperCase().padEnd(6)} ${p.slug} (${p.canonicalName})`)
    }
    console.log(`\nAliases (${plan.aliases.length}):`)
    for (const a of plan.aliases) {
      console.log(
        `  ${a.action.toUpperCase().padEnd(6)} (${a.providerApi}, ${a.externalKey}) -> ${a.slug}`,
      )
    }
    if (plan.unknownDbAliases.length > 0) {
      console.log(
        `\nAliases no banco que o registro NAO conhece (${plan.unknownDbAliases.length}) — nada sera tocado:`,
      )
      for (const key of plan.unknownDbAliases) console.log(`  ? ${key}`)
    }
    for (const error of plan.errors) console.error(`[provider-registry] ERRO: ${error}`)
    for (const conflict of plan.conflicts) {
      console.error(
        `[provider-registry] CONFLITO: (${conflict.providerApi}, ${conflict.externalKey}) ja pertence a "${conflict.currentSlug}", o registro quer "${conflict.wantedSlug}". Retargetear e decisao humana — resolva no banco ou no registro.`,
      )
    }
    if (!plan.ok) {
      console.error('[provider-registry] plano INVALIDO — nada foi/sera escrito.')
      process.exitCode = 1
      return
    }

    const pendingWrites =
      plan.providers.filter((p) => p.action !== 'keep').length +
      plan.aliases.filter((a) => a.action !== 'keep').length
    if (pendingWrites === 0) {
      console.log('\n[provider-registry] Nada a fazer: o banco ja corresponde ao registro (idempotente).')
      return
    }

    if (!apply) {
      console.log(
        `\n[provider-registry] DRY-RUN: ${pendingWrites} escrita(s) planejada(s), nada foi escrito. Repita com --apply.`,
      )
      return
    }

    const outcome = await applyProviderRegistryPlan(prisma, plan)
    console.log(
      `\n[provider-registry] aplicado: ${outcome.providersCreated} provedor(es) criado(s), ${outcome.providersRenamed} renomeado(s), ${outcome.aliasesCreated} alias(es) criado(s).`,
    )
    console.log(
      '[provider-registry] PROXIMO PASSO: rode `pnpm legal sources apply --reviewer=... --policy-version="cinerie-source-auth/2026-07-v1" --confirm` — e ele que gera a licenca + decisao watch_offer_display por provedor registrado. Sem esse passo, oferta continua sem display.',
    )
    console.log(
      '[provider-registry] Para descobrir chaves que faltam (Disney+, Globoplay...): rode a colheita `bin/reprocess-watch-providers.ts` da ingestao e estenda o registro numa PR com a saida real.',
    )
  } finally {
    await prisma.$disconnect()
  }
}

await main().catch((error: unknown) => {
  console.error(String(error instanceof Error ? error.message : error))
  process.exitCode = 1
})
