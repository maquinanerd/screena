/**
 * provider-registry.ts — Registro CANONICO de provedores de streaming +
 * aliases por fornecedor tecnico. Nucleo PURO (sem Prisma/IO).
 *
 * POR QUE ISTO EXISTE: a oferta de streaming morre em `no-alias` porque NENHUM
 * caminho de producao popula `watch_providers`/`watch_provider_aliases` — os
 * unicos INSERTs do repo eram scripts efemeros de validacao e o demo-seed (que
 * aborta em producao). A cadeia e:
 *
 *   oferta crua -> watch_provider_aliases -> watch_providers
 *              -> licenca + decisao de uso (legal apply) -> display
 *
 * e o `legal apply` gera a licenca `watch_availability` + a decisao
 * `watch_offer_display` POR PROVEDOR REGISTRADO ("em producao, com zero
 * provedores registrados, retorna lista vazia" — authorization-spec.ts). Este
 * modulo e o primeiro elo: o dado versionado + o plano idempotente.
 *
 * REGRA DE OURO DO REGISTRO: alias NAO se inventa. Cada externalKey daqui tem
 * evidencia no proprio repo (fixtures reais dos dois fornecedores). Provedor
 * canonico pode nascer SEM alias (Disney+, Globoplay): ele ja recebe licenca e
 * decisao do legal apply, e o alias entra quando a colheita
 * (`bin/reprocess-watch-providers.ts` da ingestao, que lista os provedores
 * VISTOS no dado real) confirmar a chave. Oferta sem alias continua logando o
 * motivo — nunca some.
 */

/** Fornecedores tecnicos que podem ancorar um alias. */
export const ALIAS_PROVIDER_APIS = ['streaming_availability', 'tmdb'] as const
export type AliasProviderApi = (typeof ALIAS_PROVIDER_APIS)[number]

export interface ProviderAliasEntry {
  readonly providerApi: AliasProviderApi
  /** Chave crua do upstream: `service.id` (SA) ou `String(provider_id)` (TMDB). */
  readonly externalKey: string
  /** Nome exibido pelo upstream — auditoria, nunca identidade. */
  readonly displayName: string
}

export interface ProviderRegistryEntry {
  /** Slug canonico (unico; formato ^[a-z0-9]+(-[a-z0-9]+)*$, CHECK no banco). */
  readonly slug: string
  readonly canonicalName: string
  readonly aliases: readonly ProviderAliasEntry[]
}

/**
 * O registro canonico versionado.
 *
 * EVIDENCIA por alias (nunca chute):
 *  - streaming_availability: `service.id` real dos fixtures do proprio mapper
 *    (services/streaming/src/__tests__/fixtures/*.ts — netflix, prime, apple,
 *    max, google, plutotv).
 *  - tmdb: `provider_id` real dos fixtures do normalizador
 *    (services/ingestion/src/__tests__/fixtures/watch-providers-payload.ts —
 *    8=Netflix, 2=Apple TV, 300=Pluto TV; e o teste do normalizador usa
 *    1899=Max).
 *
 * ============ COLHEITA DE PRODUCAO 2026-08-13 ============
 *
 * A colheita finalmente rodou contra o dado real (`reprocess-watch-providers`,
 * dry-run em producao): 291 provedores TMDB vistos. Os ids abaixo entram com
 * EVIDENCIA — sao o `provider_id` e o `provider_name` impressos pelo proprio
 * comando, nao chute:
 *
 *     3  Google Play Movies  (9043 ofertas)  -> google-play
 *   119  Amazon Prime Video  (1525 ofertas)  -> prime-video
 *     9  Amazon Prime Video  (  94 ofertas)  -> prime-video
 *   337  Disney Plus         (1204 ofertas)  -> disney-plus
 *   307  Globoplay           (   7 ofertas)  -> globoplay
 *
 * `9` e `119` sao a MESMA plataforma canonica sob dois registros do TMDB — o
 * proprio upstream os exibe com o nome identico ("Amazon Prime Video"). Dois
 * ids apontando para um slug e exatamente o que um registro POR ALIAS existe
 * para permitir; forcar um id por plataforma e que produziria oferta orfa.
 *
 * ============ DOIS IDS QUE NAO ENTRAM (e por que) ============
 *
 *    10  Amazon Video        (5123 ofertas)  -> NAO MAPEADO
 *   122  Disney+             (  57 ofertas)  -> NAO MAPEADO
 *
 * `10` NAO tem o nome das outras duas Amazon: "Amazon Video" e o rotulo com que
 * o TMDB identifica a LOJA transacional (aluguel/compra), enquanto "Amazon
 * Prime Video" e o servico por assinatura. Aponta-lo para `prime-video`
 * afirmaria que uma compra avulsa esta inclusa na assinatura — uma afirmacao
 * comercial falsa na tela do usuario, e do mesmo tipo que a invariante 1
 * proibe entre fontes de rating. Ele merece slug proprio, mas isso e criar um
 * provedor canonico novo (que puxa licenca e decisao de uso no `legal apply`):
 * decisao de produto, nao efeito colateral desta PR.
 *
 * `122` colide com `337` no nome exibido ("Disney+" vs "Disney Plus") com 21x
 * menos volume, e o id 122 do TMDB carrega historicamente a marca conjunta
 * Disney+/Hotstar em alguns territorios. Mapea-lo para `disney-plus` pelo nome
 * creditaria possivelmente outra plataforma. Fica aberto ate a colheita
 * enriquecida (modalidade + paises por provedor, ver
 * `WatchProviderSighting.offerTypes`) responder pelo PAYLOAD: se `122` aparecer
 * so em IN/ID e `337` no resto, sao servicos distintos; se dividirem
 * territorio, sao o mesmo e entram juntos.
 *
 * Os outros ~280 provedores da colheita NAO entram: a maioria e canal dentro de
 * outro servico ("HBO Max Amazon Channel", "Paramount+ Amazon Channel"), e
 * exibir um canal como se fosse assinatura propria e decisao de produto. Ver o
 * relatorio da PR para a lista curta que merece discussao.
 *
 * Oferta sem alias continua ingerida, auditavel e invisivel, logando `no-alias`
 * — nunca some.
 */
export const WATCH_PROVIDER_REGISTRY: readonly ProviderRegistryEntry[] = [
  {
    slug: 'netflix',
    canonicalName: 'Netflix',
    aliases: [
      { providerApi: 'streaming_availability', externalKey: 'netflix', displayName: 'Netflix' },
      { providerApi: 'tmdb', externalKey: '8', displayName: 'Netflix' },
    ],
  },
  {
    slug: 'prime-video',
    canonicalName: 'Prime Video',
    aliases: [
      { providerApi: 'streaming_availability', externalKey: 'prime', displayName: 'Prime Video' },
      // Dois ids do TMDB, uma plataforma: o upstream exibe o MESMO nome nos
      // dois. `10` ("Amazon Video", a loja) fica de fora — ver doc no topo.
      { providerApi: 'tmdb', externalKey: '119', displayName: 'Amazon Prime Video' },
      { providerApi: 'tmdb', externalKey: '9', displayName: 'Amazon Prime Video' },
    ],
  },
  {
    slug: 'max',
    canonicalName: 'Max',
    aliases: [
      { providerApi: 'streaming_availability', externalKey: 'max', displayName: 'Max' },
      { providerApi: 'tmdb', externalKey: '1899', displayName: 'Max' },
    ],
  },
  {
    slug: 'apple-tv',
    canonicalName: 'Apple TV',
    aliases: [
      { providerApi: 'streaming_availability', externalKey: 'apple', displayName: 'Apple TV' },
      { providerApi: 'tmdb', externalKey: '2', displayName: 'Apple TV' },
    ],
  },
  {
    slug: 'pluto-tv',
    canonicalName: 'Pluto TV',
    aliases: [
      { providerApi: 'streaming_availability', externalKey: 'plutotv', displayName: 'Pluto TV' },
      { providerApi: 'tmdb', externalKey: '300', displayName: 'Pluto TV' },
    ],
  },
  {
    slug: 'google-play',
    canonicalName: 'Google Play',
    aliases: [
      {
        providerApi: 'streaming_availability',
        externalKey: 'google',
        displayName: 'Google Play Movies',
      },
      // 2o provedor mais frequente do corpus (9043 ofertas) e o unico dos dois
      // fornecedores com o nome EXIBIDO identico ao alias da RapidAPI.
      { providerApi: 'tmdb', externalKey: '3', displayName: 'Google Play Movies' },
    ],
  },
  {
    slug: 'disney-plus',
    canonicalName: 'Disney+',
    // `122` NAO entra: mesmo nome, 21x menos volume, marca conjunta possivel.
    aliases: [{ providerApi: 'tmdb', externalKey: '337', displayName: 'Disney Plus' }],
  },
  {
    slug: 'globoplay',
    canonicalName: 'Globoplay',
    aliases: [{ providerApi: 'tmdb', externalKey: '307', displayName: 'Globoplay' }],
  },
] as const

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** Valida a FORMA do registro. Registro invalido nunca chega ao banco. */
export function validateProviderRegistry(
  registry: readonly ProviderRegistryEntry[],
): readonly string[] {
  const errors: string[] = []
  const slugs = new Set<string>()
  const aliasKeys = new Set<string>()
  for (const entry of registry) {
    if (!SLUG_PATTERN.test(entry.slug)) {
      errors.push(`slug invalido: "${entry.slug}" (esperado ^[a-z0-9]+(-[a-z0-9]+)*$)`)
    }
    if (slugs.has(entry.slug)) errors.push(`slug repetido: "${entry.slug}"`)
    slugs.add(entry.slug)
    if (entry.canonicalName.trim() === '') {
      errors.push(`canonicalName vazio para "${entry.slug}"`)
    }
    for (const alias of entry.aliases) {
      if (!(ALIAS_PROVIDER_APIS as readonly string[]).includes(alias.providerApi)) {
        errors.push(`providerApi desconhecido em "${entry.slug}": "${alias.providerApi}"`)
      }
      if (alias.externalKey.trim() === '') {
        errors.push(`externalKey vazio em "${entry.slug}" (${alias.providerApi})`)
      }
      const key = `${alias.providerApi}:${alias.externalKey}`
      if (aliasKeys.has(key)) {
        errors.push(`alias repetido no registro: ${key}`)
      }
      aliasKeys.add(key)
    }
  }
  return errors
}

/* ------------------------------------------------------------------ */
/* Plano idempotente                                                   */
/* ------------------------------------------------------------------ */

/** Estado atual do banco, como o planner precisa ver. */
export interface ProviderRegistryState {
  /** slug -> canonicalName atual. */
  readonly providers: ReadonlyMap<string, string>
  /** `${providerApi}:${externalKey}` -> slug do provedor dono do alias. */
  readonly aliases: ReadonlyMap<string, string>
}

export interface ProviderAction {
  readonly slug: string
  readonly canonicalName: string
  readonly action: 'create' | 'keep' | 'rename'
}

export interface AliasAction {
  readonly providerApi: AliasProviderApi
  readonly externalKey: string
  readonly displayName: string
  readonly slug: string
  readonly action: 'create' | 'keep'
}

export interface AliasConflict {
  readonly providerApi: AliasProviderApi
  readonly externalKey: string
  readonly wantedSlug: string
  readonly currentSlug: string
}

export interface ProviderRegistryPlan {
  readonly ok: boolean
  readonly errors: readonly string[]
  readonly providers: readonly ProviderAction[]
  readonly aliases: readonly AliasAction[]
  /**
   * Alias que o banco ja atribuiu a OUTRO provedor. Retargetear em silencio
   * moveria ofertas historicas de dono — isso e decisao humana, nunca do
   * comando. Conflito => plan.ok = false.
   */
  readonly conflicts: readonly AliasConflict[]
  /** Aliases existentes no banco que o registro nao conhece (informativo). */
  readonly unknownDbAliases: readonly string[]
}

/** Monta o plano registro -> banco. Puro e deterministico. */
export function planProviderRegistration(
  registry: readonly ProviderRegistryEntry[],
  state: ProviderRegistryState,
): ProviderRegistryPlan {
  const errors = validateProviderRegistry(registry)
  const providers: ProviderAction[] = []
  const aliases: AliasAction[] = []
  const conflicts: AliasConflict[] = []

  for (const entry of registry) {
    const currentName = state.providers.get(entry.slug)
    if (currentName === undefined) {
      providers.push({ slug: entry.slug, canonicalName: entry.canonicalName, action: 'create' })
    } else if (currentName !== entry.canonicalName) {
      providers.push({ slug: entry.slug, canonicalName: entry.canonicalName, action: 'rename' })
    } else {
      providers.push({ slug: entry.slug, canonicalName: entry.canonicalName, action: 'keep' })
    }

    for (const alias of entry.aliases) {
      const key = `${alias.providerApi}:${alias.externalKey}`
      const currentOwner = state.aliases.get(key)
      if (currentOwner === undefined) {
        aliases.push({ ...alias, slug: entry.slug, action: 'create' })
      } else if (currentOwner === entry.slug) {
        aliases.push({ ...alias, slug: entry.slug, action: 'keep' })
      } else {
        conflicts.push({
          providerApi: alias.providerApi,
          externalKey: alias.externalKey,
          wantedSlug: entry.slug,
          currentSlug: currentOwner,
        })
      }
    }
  }

  const registryKeys = new Set(
    registry.flatMap((entry) => entry.aliases.map((a) => `${a.providerApi}:${a.externalKey}`)),
  )
  const unknownDbAliases = [...state.aliases.keys()].filter((key) => !registryKeys.has(key)).sort()

  return {
    ok: errors.length === 0 && conflicts.length === 0,
    errors,
    providers,
    aliases,
    conflicts,
    unknownDbAliases,
  }
}
