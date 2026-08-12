/**
 * provider-registry-store.ts — Adapter Prisma do registro de provedores.
 *
 * Le o estado atual (`watch_providers` + `watch_provider_aliases`) e aplica o
 * plano do nucleo puro (`../provider-registry.js`) numa TRANSACAO.
 *
 * O que ele NUNCA faz:
 *  - apagar linha alguma (provedor/alias fora do registro fica no banco e e
 *    reportado como "desconhecido do registro" — remocao e decisao humana);
 *  - retargetear alias de outro provedor (o planner ja transforma isso em
 *    CONFLITO e o plano nao aplica);
 *  - escrever com plano invalido (fail-closed).
 */

import type { PrismaClient } from '@prisma/client'

import type { ProviderRegistryPlan, ProviderRegistryState } from '../provider-registry.js'

export async function readProviderRegistryState(
  prisma: PrismaClient,
): Promise<ProviderRegistryState> {
  const [providers, aliases] = await Promise.all([
    prisma.watchProvider.findMany({ select: { slug: true, canonicalName: true } }),
    prisma.watchProviderAlias.findMany({
      select: { providerApi: true, externalKey: true, provider: { select: { slug: true } } },
    }),
  ])
  return {
    providers: new Map(providers.map((p) => [p.slug, p.canonicalName])),
    aliases: new Map(
      aliases.map((a) => [`${a.providerApi}:${a.externalKey}`, a.provider.slug]),
    ),
  }
}

export interface ApplyRegistryOutcome {
  readonly providersCreated: number
  readonly providersRenamed: number
  readonly aliasesCreated: number
}

/**
 * Aplica o plano. Lanca com plano invalido/conflitado — o chamador ja mostrou
 * o motivo; escrever "so a parte boa" esconderia o conflito.
 */
export async function applyProviderRegistryPlan(
  prisma: PrismaClient,
  plan: ProviderRegistryPlan,
): Promise<ApplyRegistryOutcome> {
  if (!plan.ok) {
    throw new Error(
      '[provider-registry] plano invalido/conflitado nao se aplica — resolva os conflitos primeiro.',
    )
  }

  return prisma.$transaction(async (tx) => {
    let providersCreated = 0
    let providersRenamed = 0
    let aliasesCreated = 0

    for (const provider of plan.providers) {
      if (provider.action === 'create') {
        await tx.watchProvider.create({
          data: { slug: provider.slug, canonicalName: provider.canonicalName },
        })
        providersCreated += 1
      } else if (provider.action === 'rename') {
        await tx.watchProvider.update({
          where: { slug: provider.slug },
          data: { canonicalName: provider.canonicalName },
        })
        providersRenamed += 1
      }
    }

    for (const alias of plan.aliases) {
      if (alias.action !== 'create') continue
      const provider = await tx.watchProvider.findUnique({
        where: { slug: alias.slug },
        select: { id: true },
      })
      if (provider === null) {
        // So acontece se a transacao acima falhou em criar — melhor morrer
        // aqui, alto, do que gravar alias orfao.
        throw new Error(`[provider-registry] provedor "${alias.slug}" nao existe para o alias`)
      }
      await tx.watchProviderAlias.create({
        data: {
          providerId: provider.id,
          providerApi: alias.providerApi,
          externalKey: alias.externalKey,
          displayName: alias.displayName,
        },
      })
      aliasesCreated += 1
    }

    return { providersCreated, providersRenamed, aliasesCreated }
  })
}
