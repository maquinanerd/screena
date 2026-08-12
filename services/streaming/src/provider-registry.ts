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
 * Disney+ e Globoplay entram SEM alias: nenhum fixture do repo confirma as
 * chaves. O caminho e rodar a colheita em producao e estender este registro
 * numa PR com a saida real ("use essa saida como base, em vez de inventar").
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
    ],
  },
  // SEM alias ate a colheita confirmar as chaves reais (ver doc acima).
  { slug: 'disney-plus', canonicalName: 'Disney+', aliases: [] },
  { slug: 'globoplay', canonicalName: 'Globoplay', aliases: [] },
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
