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
 * ============ LOJA != SERVICO, E A REGRA VALE PARA AS TRES ============
 *
 * A colheita ENRIQUECIDA (modalidade por provedor) desfez uma contradicao que a
 * #167 deixou de pe. Ela recusou mapear `10` "Amazon Video" POR SER LOJA — e
 * naquele momento duas lojas identicas ja estavam mapeadas e passando:
 *
 *      2  Apple TV Store      buy=5162 rent=4973  subscription=0  -> apple-tv
 *      3  Google Play Movies  buy=4698 rent=4345  subscription=0  -> google-play
 *     10  Amazon Video        buy=2579 rent=2544  subscription=0  -> amazon-video
 *
 * Os tres sao a MESMA natureza: catalogo transacional, zero assinatura. O
 * fixture da RapidAPI confirma o mesmo para os dois primeiros
 * (`titanic-show.ts`: `apple`/rent com link `tv.apple.com/.../rent`,
 * `google`/buy com link `play.google.com/store`). Nao havia principio que
 * separasse `10` de `2` — havia uma decisao aplicada a um e nao ao outro.
 *
 * O QUE TORNA MAPEAR LOJA HONESTO: a fileira "Onde assistir" passou a exibir a
 * MODALIDADE em texto visivel nos quatro consumidores
 * (`apps/web/src/lib/watch-offer-modality.ts`). "Apple TV Store · Compra" nao
 * afirma nada falso; "Apple TV" sozinho, num titulo que so tem compra, afirma
 * que esta incluso na assinatura que o leitor ja paga. **Este mapeamento so e
 * valido enquanto a modalidade estiver na tela** — se ela sair, estas tres
 * linhas voltam a mentir.
 *
 * `amazon-video` nasce como slug PROPRIO, nunca dobrado em `prime-video`: a
 * loja e o servico de assinatura sao produtos comerciais distintos, e colapsa-los
 * afirmaria que uma compra avulsa esta inclusa na assinatura. `apple-tv` foi
 * RENOMEADO para "Apple TV Store" (o rotulo que o proprio TMDB publica hoje):
 * o slug fica, porque `source_licenses.source_key` aponta para ele e renomea-lo
 * orfanaria a licenca — mas o nome exibido deixa de disputar com o "Apple TV+",
 * que e outro provedor (id 350) e ainda nao esta registrado.
 *
 * ============ VARIANTES DE PLANO: COLAPSAM NA MARCA ============
 *
 *   2100  Amazon Prime Video with Ads       subscription=238 -> prime-video
 *   1796  Netflix Standard with Ads         subscription=172 -> netflix
 *    613  Amazon Prime Video Free with Ads  ads=6            -> prime-video
 *    175  Netflix Kids                      subscription=2   -> netflix
 *
 * Sao PLANOS dentro do mesmo servico, nao servicos distintos. Listar "Netflix"
 * e "Netflix Standard with Ads" como duas linhas na mesma pagina e o defeito do
 * hub duplicado com outra roupa.
 *
 * `613` merece a nota que o resto nao merece: ele e `ads`, nao `subscription`.
 * Colapsa-lo em `prime-video` SEM a modalidade afirmaria que precisa de
 * assinatura. Com ela, a linha le "Prime Video · Grátis com anúncios" — que e
 * exatamente o que o dado diz. E a modalidade do render que torna o colapso
 * seguro, nao o alias.
 *
 * ============ AINDA ABERTO: 122 vs 337 ============
 *
 *   122  Disney+       subscription=57    em 3 paises   -> NAO MAPEADO
 *   337  Disney Plus   subscription=1204  em 57 paises  -> disney-plus
 *
 * A colheita imprimia "em N pais(es)", nao os CODIGOS — e sem eles a pergunta
 * nao tem resposta. Se `122` estiver so em IN/ID (ou equivalente), e a marca
 * conjunta Disney+/Hotstar e e OUTRO servico; se dividir territorio com `337`,
 * sao o mesmo e os dois entram no mesmo slug. A saida da colheita passou a
 * imprimir a lista de codigos (`WatchProviderSighting.countries`) exatamente
 * para fechar isso na proxima passada. **Nao decidir pelo nome**: "Disney+" e
 * "Disney Plus" sao o mesmo texto para um humano e podem ser produtos
 * diferentes para o TMDB.
 *
 * ============ OS ~250 RESTANTES ============
 *
 * Nao entram. A maioria e canal dentro de outro servico ("HBO Max Amazon
 * Channel", "Paramount+ Amazon Channel", "Telecine Amazon Channel"), e exibir
 * um canal como se fosse assinatura propria e decisao de EXIBICAO, nao de
 * alias. As plataformas brasileiras avulsas (Claro video, Mercado Play, Looke,
 * Oldflix...) tambem nao entram ainda: a colheita mede volume GLOBAL, e um
 * provedor com 324 ofertas em 7 paises pode nao ter nenhuma em BR. O campo
 * `offersInScope` foi acrescentado para responder isso — ver o relatorio da PR.
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
      // PLANOS da Netflix, nao servicos distintos: duas linhas "Netflix" e
      // "Netflix Standard with Ads" na mesma pagina e o hub duplicado de novo.
      { providerApi: 'tmdb', externalKey: '1796', displayName: 'Netflix Standard with Ads' },
      { providerApi: 'tmdb', externalKey: '175', displayName: 'Netflix Kids' },
    ],
  },
  {
    slug: 'prime-video',
    canonicalName: 'Prime Video',
    aliases: [
      { providerApi: 'streaming_availability', externalKey: 'prime', displayName: 'Prime Video' },
      // Dois ids do TMDB, uma plataforma: o upstream exibe o MESMO nome nos
      // dois. `10` ("Amazon Video", a LOJA) tem slug proprio — ver `amazon-video`.
      { providerApi: 'tmdb', externalKey: '119', displayName: 'Amazon Prime Video' },
      { providerApi: 'tmdb', externalKey: '9', displayName: 'Amazon Prime Video' },
      // PLANOS do Prime Video. `613` e `ads` (gratuito com anuncio), nao
      // assinatura — o colapso so e honesto porque a MODALIDADE vai para a tela:
      // a linha le "Prime Video · Grátis com anúncios", nunca "Assinatura".
      { providerApi: 'tmdb', externalKey: '2100', displayName: 'Amazon Prime Video with Ads' },
      { providerApi: 'tmdb', externalKey: '613', displayName: 'Amazon Prime Video Free with Ads' },
    ],
  },
  {
    // A LOJA transacional da Amazon (buy+rent, zero assinatura). Slug PROPRIO,
    // nunca dobrado em `prime-video`: colapsar afirmaria que uma compra avulsa
    // esta inclusa na assinatura. Mesma natureza de `apple-tv` e `google-play`,
    // e agora com o MESMO tratamento — ver a nota "LOJA != SERVICO" no topo.
    slug: 'amazon-video',
    canonicalName: 'Amazon Video',
    aliases: [{ providerApi: 'tmdb', externalKey: '10', displayName: 'Amazon Video' }],
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
    // RENOMEADO. A colheita provou `subscription=0` neste id: e a LOJA, e o
    // proprio TMDB ja a publica como "Apple TV Store". O slug fica como esta —
    // `source_licenses.source_key` aponta para ele, e renomear orfanaria a
    // licenca vigente. O nome exibido, sim, muda: "Apple TV" disputava leitura
    // com o "Apple TV+" (id 350 do TMDB), que e outro provedor e ainda nao esta
    // registrado.
    canonicalName: 'Apple TV Store',
    aliases: [
      { providerApi: 'streaming_availability', externalKey: 'apple', displayName: 'Apple TV' },
      { providerApi: 'tmdb', externalKey: '2', displayName: 'Apple TV Store' },
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
