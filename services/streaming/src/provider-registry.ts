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
 * REGRA DE OURO DO REGISTRO: alias NAO se inventa. Isso deixou de ser prosa e
 * virou DUAS travas mecanicas e independentes:
 *
 *   1. cada alias declara `evidence` — a medicao real de onde a chave saiu,
 *      de um conjunto FECHADO (`ALIAS_EVIDENCE_SOURCES`). Fora do conjunto (ou
 *      ausente) => `validateProviderRegistry` erra => `plan.ok = false` =>
 *      `applyProviderRegistryPlan` lanca. Puro, roda na CI, sem banco;
 *   2. `register-watch-providers` confronta cada alias a CRIAR contra os pares
 *      `(provider_api, provider_key)` REALMENTE observados em
 *      `watch_availability` e RECUSA o que o dado nunca viu
 *      (`checkAliasEvidenceAgainstOffers`). Precisa de banco, e por isso e a
 *      unica que pega um id DIGITADO ERRADO (`1852` em vez de `1853`): esse
 *      passa na trava 1 e credita a plataforma errada.
 *
 * Provedor canonico pode nascer SEM alias: ele ja recebe licenca e decisao do
 * legal apply, e o alias entra quando a colheita
 * (`bin/reprocess-watch-providers.ts` da ingestao, que lista os provedores
 * VISTOS no dado real) confirmar a chave. Oferta sem alias continua logando o
 * motivo — nunca some, e desde 2026-08-19 o motivo tem nome proprio na revisao
 * (`no-canonical-provider`).
 */

/** Fornecedores tecnicos que podem ancorar um alias. */
export const ALIAS_PROVIDER_APIS = ['streaming_availability', 'tmdb'] as const
export type AliasProviderApi = (typeof ALIAS_PROVIDER_APIS)[number]

/**
 * ============ DE ONDE UM `externalKey` PODE VIR (conjunto FECHADO) ============
 *
 * "Alias nao se inventa" era uma regra escrita em prosa no topo deste arquivo e
 * confiada a revisao humana. Passou a ser um CAMPO, com conjunto fechado, e
 * `validateProviderRegistry` recusa o que estiver fora dele — logo `plan.ok`
 * fica `false` e `applyProviderRegistryPlan` lanca. Chave sem proveniencia
 * declarada nao chega ao banco por caminho nenhum.
 *
 * Cada valor nomeia UMA medicao real, e nada mais:
 *
 *  - `rapidapi-fixture` — `service.id` dos fixtures do proprio mapper da
 *    Streaming Availability (`src/__tests__/fixtures/*.ts`). Bytes do
 *    fornecedor, guardados no repo.
 *  - `tmdb-harvest-2026-08-13` — saida de `reprocess-watch-providers` (dry-run,
 *    291 provedores TMDB vistos), transcrita em
 *    `src/__tests__/provider-registry-tmdb-harvest.test.ts`. Volume GLOBAL.
 *  - `br-offer-census-2026-08-19` — censo das ofertas BR ja gravadas em
 *    `watch_availability`, por `(provider_key, provider_name)`, transcrito em
 *    `src/__tests__/provider-registry-br-census.test.ts`. E a medicao que
 *    responde a pergunta que a colheita global NAO respondia: o provedor tem
 *    oferta NO BRASIL.
 *
 * Por que o censo BR e evidencia legitima do `provider_id` do TMDB:
 * `watch_availability.provider_key` e `String(provider_id)` copiado VERBATIM do
 * payload por `normalizeWatchProviders` (services/ingestion), e
 * `provider_name` idem. O censo le o mesmo par que o payload publicou — nao ha
 * transformacao entre os dois pontos onde um id pudesse trocar de dono.
 *
 * SEGUNDA LINHA, no banco: `register-watch-providers` confronta cada alias a
 * CRIAR contra os pares `(provider_api, provider_key)` REALMENTE observados em
 * `watch_availability` e RECUSA o que nunca apareceu (ver
 * `checkAliasEvidenceAgainstOffers`). Evidencia declarada no fonte e evidencia
 * medida no banco sao checagens independentes; nenhuma substitui a outra.
 */
export const ALIAS_EVIDENCE_SOURCES = [
  'rapidapi-fixture',
  'tmdb-harvest-2026-08-13',
  'br-offer-census-2026-08-19',
] as const
export type AliasEvidenceSource = (typeof ALIAS_EVIDENCE_SOURCES)[number]

export interface ProviderAliasEntry {
  readonly providerApi: AliasProviderApi
  /** Chave crua do upstream: `service.id` (SA) ou `String(provider_id)` (TMDB). */
  readonly externalKey: string
  /** Nome exibido pelo upstream — auditoria, nunca identidade. */
  readonly displayName: string
  /** Medicao real de onde este `externalKey` saiu. Sem ela, o plano nao aplica. */
  readonly evidence: AliasEvidenceSource
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
 * ============ OS ~250 RESTANTES (revisado em 2026-08-19) ============
 *
 * A redacao anterior desta secao dizia: "Nao entram. A maioria e canal dentro
 * de outro servico (...) e exibir um canal como se fosse assinatura propria e
 * decisao de EXIBICAO, nao de alias. As plataformas brasileiras avulsas (Claro
 * video, Mercado Play, Looke, Oldflix...) tambem nao entram ainda: a colheita
 * mede volume GLOBAL, e um provedor com 324 ofertas em 7 paises pode nao ter
 * nenhuma em BR."
 *
 * As duas metades foram RESOLVIDAS, cada uma pelo que lhe faltava:
 *  - a decisao de exibicao veio (dono, 2026-08-19: canal entra);
 *  - a medicao por pais veio (censo BR 2026-08-19).
 *
 * Ver o bloco "LEVA BR 2026-08-19" logo abaixo, dentro do registro. Os que
 * continuam de fora sao os que o censo BR nao viu — e continuam de fora
 * exatamente pelo motivo original: sem numero de BR, nao ha o que registrar.
 *
 * Oferta sem alias continua ingerida, auditavel e invisivel, e o motivo agora
 * aparece nomeado na revisao (`no-canonical-provider`) — nunca some.
 */
export const WATCH_PROVIDER_REGISTRY: readonly ProviderRegistryEntry[] = [
  {
    slug: 'netflix',
    canonicalName: 'Netflix',
    aliases: [
      { providerApi: 'streaming_availability', externalKey: 'netflix', displayName: 'Netflix', evidence: 'rapidapi-fixture' },
      { providerApi: 'tmdb', externalKey: '8', displayName: 'Netflix', evidence: 'tmdb-harvest-2026-08-13' },
      // PLANOS da Netflix, nao servicos distintos: duas linhas "Netflix" e
      // "Netflix Standard with Ads" na mesma pagina e o hub duplicado de novo.
      { providerApi: 'tmdb', externalKey: '1796', displayName: 'Netflix Standard with Ads', evidence: 'tmdb-harvest-2026-08-13' },
      { providerApi: 'tmdb', externalKey: '175', displayName: 'Netflix Kids', evidence: 'tmdb-harvest-2026-08-13' },
    ],
  },
  {
    slug: 'prime-video',
    canonicalName: 'Prime Video',
    aliases: [
      { providerApi: 'streaming_availability', externalKey: 'prime', displayName: 'Prime Video', evidence: 'rapidapi-fixture' },
      // Dois ids do TMDB, uma plataforma: o upstream exibe o MESMO nome nos
      // dois. `10` ("Amazon Video", a LOJA) tem slug proprio — ver `amazon-video`.
      { providerApi: 'tmdb', externalKey: '119', displayName: 'Amazon Prime Video', evidence: 'tmdb-harvest-2026-08-13' },
      { providerApi: 'tmdb', externalKey: '9', displayName: 'Amazon Prime Video', evidence: 'tmdb-harvest-2026-08-13' },
      // PLANOS do Prime Video. `613` e `ads` (gratuito com anuncio), nao
      // assinatura — o colapso so e honesto porque a MODALIDADE vai para a tela:
      // a linha le "Prime Video · Grátis com anúncios", nunca "Assinatura".
      { providerApi: 'tmdb', externalKey: '2100', displayName: 'Amazon Prime Video with Ads', evidence: 'tmdb-harvest-2026-08-13' },
      { providerApi: 'tmdb', externalKey: '613', displayName: 'Amazon Prime Video Free with Ads', evidence: 'tmdb-harvest-2026-08-13' },
    ],
  },
  {
    // A LOJA transacional da Amazon (buy+rent, zero assinatura). Slug PROPRIO,
    // nunca dobrado em `prime-video`: colapsar afirmaria que uma compra avulsa
    // esta inclusa na assinatura. Mesma natureza de `apple-tv` e `google-play`,
    // e agora com o MESMO tratamento — ver a nota "LOJA != SERVICO" no topo.
    slug: 'amazon-video',
    canonicalName: 'Amazon Video',
    aliases: [{ providerApi: 'tmdb', externalKey: '10', displayName: 'Amazon Video', evidence: 'tmdb-harvest-2026-08-13' }],
  },
  {
    slug: 'max',
    canonicalName: 'Max',
    aliases: [
      { providerApi: 'streaming_availability', externalKey: 'max', displayName: 'Max', evidence: 'rapidapi-fixture' },
      { providerApi: 'tmdb', externalKey: '1899', displayName: 'Max', evidence: 'tmdb-harvest-2026-08-13' },
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
      { providerApi: 'streaming_availability', externalKey: 'apple', displayName: 'Apple TV', evidence: 'rapidapi-fixture' },
      { providerApi: 'tmdb', externalKey: '2', displayName: 'Apple TV Store', evidence: 'tmdb-harvest-2026-08-13' },
    ],
  },
  {
    slug: 'pluto-tv',
    canonicalName: 'Pluto TV',
    aliases: [
      { providerApi: 'streaming_availability', externalKey: 'plutotv', displayName: 'Pluto TV', evidence: 'rapidapi-fixture' },
      { providerApi: 'tmdb', externalKey: '300', displayName: 'Pluto TV', evidence: 'tmdb-harvest-2026-08-13' },
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
        evidence: 'rapidapi-fixture',
      },
      // 2o provedor mais frequente do corpus (9043 ofertas) e o unico dos dois
      // fornecedores com o nome EXIBIDO identico ao alias da RapidAPI.
      { providerApi: 'tmdb', externalKey: '3', displayName: 'Google Play Movies', evidence: 'tmdb-harvest-2026-08-13' },
    ],
  },
  {
    slug: 'disney-plus',
    canonicalName: 'Disney+',
    // `122` NAO entra: mesmo nome, 21x menos volume, marca conjunta possivel.
    aliases: [{ providerApi: 'tmdb', externalKey: '337', displayName: 'Disney Plus', evidence: 'tmdb-harvest-2026-08-13' }],
  },
  {
    slug: 'globoplay',
    canonicalName: 'Globoplay',
    aliases: [{ providerApi: 'tmdb', externalKey: '307', displayName: 'Globoplay', evidence: 'tmdb-harvest-2026-08-13' }],
  },

  /* ================================================================== *
   * LEVA BR 2026-08-19 — "todo provedor com disponibilidade real no     *
   * Brasil entra no Onde assistir" (decisao de Pablo Eduardo).          *
   *                                                                     *
   * O QUE MUDOU DE PRINCIPIO. Ate a leva anterior este registro tinha    *
   * DUAS recusas de politica, escritas no topo do arquivo:               *
   *                                                                     *
   *   (a) "canal dentro de outro servico nao entra" — HBO Max Amazon     *
   *       Channel, Telecine Amazon Channel, Paramount+ Amazon Channel;   *
   *   (b) "plataforma BR sem numero de BR nao entra" — Claro video,      *
   *       Mercado Play, Looke, Oldflix, NetMovies...                     *
   *                                                                     *
   * As duas cairam, por motivos DIFERENTES e igualmente concretos:       *
   *                                                                     *
   *   (a) caiu por DECISAO do dono: um canal vendido dentro da Amazon    *
   *       ou da Apple e uma forma real de assistir no Brasil. Para quem  *
   *       quer assistir hoje nao ha diferenca entre assinar o Paramount+ *
   *       direto e assinar o Paramount+ dentro do Prime. Omitir a        *
   *       segunda nao protege ninguem — esconde oferta legal e existente.*
   *   (b) caiu por MEDICAO: a recusa era honesta enquanto a unica        *
   *       colheita media volume GLOBAL ("324 ofertas em 7 paises" nao    *
   *       diz se alguma e do Brasil). O censo BR de 2026-08-19 conta     *
   *       ofertas JA GRAVADAS com `country_code = 'BR'`. A duvida que    *
   *       justificava a recusa deixou de existir para estes 24.          *
   *                                                                     *
   * O QUE **NAO** MUDOU:                                                 *
   *  - NADA e colapsado nesta leva. Cada `provider_id` vira um slug      *
   *    PROPRIO. "Paramount Plus" (531), "Paramount Plus Premium" (2303)  *
   *    e "Paramount+ Amazon Channel" (582) sao TRES produtos comerciais: *
   *    quem assina o plano de entrada nao assiste ao que so esta no      *
   *    Premium, e quem assina pelo Prime paga em outro lugar. Fundir     *
   *    afirmaria um acesso que o leitor talvez nao tenha — o inverso     *
   *    exato de `netflix`/`1796`, onde o colapso e de PLANO da MESMA     *
   *    assinatura, com o mesmo catalogo. Colapsar afirma equivalencia;   *
   *    separar so mostra o que o upstream declarou.                      *
   *  - `logoAllowed` continua o literal `false` na licenca gerada        *
   *    (`authorization-spec.ts`): nenhum logo de marca, credito textual. *
   *  - O territorio continua BR e so BR (ver `PROMOTION_COUNTRY`).       *
   *  - Nenhum id foi digitado de memoria: os 24 vem do censo, e 10 deles *
   *    (167, 2302, 484, 499, 19, 47, 447, 477, 2156, 2157) ja apareciam  *
   *    na colheita global de 08-13 — duas medicoes independentes         *
   *    concordando no mesmo par (id, nome).                              *
   *                                                                     *
   * O NOME DUPLICADO NA TELA ("HBO Max" e "HBO Max Amazon Channel" na    *
   * mesma pagina) e consequencia REAL desta decisao e NAO se resolve     *
   * aqui: resolve-se na apresentacao, e a proposta esta no relatorio da  *
   * PR, aguardando decisao humana. Ate la o painel os lista lado a lado  *
   * — o que e verdade, ainda que deselegante.                            *
   * ================================================================== */
  {
    slug: 'hbo-max-amazon-channel',
    canonicalName: 'HBO Max Amazon Channel',
    // O maior volume BR desta leva (35 ofertas). NAO e o slug `max` (id 1899):
    // ids diferentes, produtos comerciais diferentes, lugares de compra
    // diferentes. Dobra-lo em `max` afirmaria que quem assina o HBO Max direto
    // alcanca esta oferta pelo mesmo caminho.
    aliases: [
      {
        providerApi: 'tmdb',
        externalKey: '1825',
        displayName: 'HBO Max Amazon Channel',
        evidence: 'br-offer-census-2026-08-19',
      },
    ],
  },
  {
    slug: 'claro-video',
    canonicalName: 'Claro video',
    // Ja visto na colheita global de 08-13 (324 ofertas: rent/subscription/buy);
    // o censo BR confirma 23 no Brasil. Duas medicoes, mesmo par (id, nome).
    aliases: [
      {
        providerApi: 'tmdb',
        externalKey: '167',
        displayName: 'Claro video',
        evidence: 'br-offer-census-2026-08-19',
      },
    ],
  },
  {
    slug: 'telecine-amazon-channel',
    canonicalName: 'Telecine Amazon Channel',
    aliases: [
      {
        providerApi: 'tmdb',
        externalKey: '2156',
        displayName: 'Telecine Amazon Channel',
        evidence: 'br-offer-census-2026-08-19',
      },
    ],
  },
  {
    slug: 'paramount-plus-amazon-channel',
    canonicalName: 'Paramount+ Amazon Channel',
    aliases: [
      {
        providerApi: 'tmdb',
        externalKey: '582',
        displayName: 'Paramount+ Amazon Channel',
        evidence: 'br-offer-census-2026-08-19',
      },
    ],
  },
  {
    slug: 'claro-tv-plus',
    canonicalName: 'Claro tv+',
    aliases: [
      {
        providerApi: 'tmdb',
        externalKey: '484',
        displayName: 'Claro tv+',
        evidence: 'br-offer-census-2026-08-19',
      },
    ],
  },
  {
    slug: 'paramount-plus',
    canonicalName: 'Paramount Plus',
    // Assinatura propria. Slug SEPARADO de `paramount-plus-premium` (2303) e de
    // `paramount-plus-amazon-channel` (582) — ver a nota do topo desta leva.
    aliases: [
      {
        providerApi: 'tmdb',
        externalKey: '531',
        displayName: 'Paramount Plus',
        evidence: 'br-offer-census-2026-08-19',
      },
    ],
  },
  {
    slug: 'paramount-plus-premium',
    canonicalName: 'Paramount Plus Premium',
    // NAO e "o mesmo servico com anuncio" (o caso `netflix`/`1796`): o Premium
    // carrega catalogo que o plano de entrada nao tem. Colapsa-lo em
    // `paramount-plus` diria a quem assina o plano de entrada que o titulo esta
    // incluso quando nao esta.
    aliases: [
      {
        providerApi: 'tmdb',
        externalKey: '2303',
        displayName: 'Paramount Plus Premium',
        evidence: 'br-offer-census-2026-08-19',
      },
    ],
  },
  {
    slug: 'universal-plus-amazon-channel',
    canonicalName: 'Universal+ Amazon Channel',
    aliases: [
      {
        providerApi: 'tmdb',
        externalKey: '1889',
        displayName: 'Universal+ Amazon Channel',
        evidence: 'br-offer-census-2026-08-19',
      },
    ],
  },
  {
    slug: 'oldflix',
    canonicalName: 'Oldflix',
    aliases: [
      {
        providerApi: 'tmdb',
        externalKey: '499',
        displayName: 'Oldflix',
        evidence: 'br-offer-census-2026-08-19',
      },
    ],
  },
  {
    slug: 'mercado-play',
    canonicalName: 'Mercado Play',
    // ATENCAO OPERACIONAL: na colheita de 08-13 as 76 ofertas do Mercado Play
    // eram TODAS `ads`, modalidade que NAO esta em `PROMOTABLE_OFFER_TYPES`. O
    // alias sozinho nao acende nada aqui — o que ele muda e a QUALIDADE da
    // recusa: de `no-canonical-provider` (elo faltando) para
    // `invalid-offer-type` (decisao de produto pendente). Exibir oferta
    // gratuita com anuncio e decisao do dono, nao consequencia deste alias.
    aliases: [
      {
        providerApi: 'tmdb',
        externalKey: '2302',
        displayName: 'Mercado Play',
        evidence: 'br-offer-census-2026-08-19',
      },
    ],
  },
  {
    slug: 'sony-one-amazon-channel',
    canonicalName: 'Sony One Amazon Channel',
    aliases: [
      {
        providerApi: 'tmdb',
        externalKey: '2161',
        displayName: 'Sony One Amazon Channel',
        evidence: 'br-offer-census-2026-08-19',
      },
    ],
  },
  {
    slug: 'paramount-plus-apple-tv-channel',
    canonicalName: 'Paramount Plus Apple TV Channel',
    aliases: [
      {
        providerApi: 'tmdb',
        externalKey: '1853',
        displayName: 'Paramount Plus Apple TV Channel',
        evidence: 'br-offer-census-2026-08-19',
      },
    ],
  },
  {
    slug: 'looke',
    canonicalName: 'Looke',
    aliases: [
      {
        providerApi: 'tmdb',
        externalKey: '47',
        displayName: 'Looke',
        evidence: 'br-offer-census-2026-08-19',
      },
    ],
  },
  {
    slug: 'netmovies',
    canonicalName: 'NetMovies',
    aliases: [
      {
        providerApi: 'tmdb',
        externalKey: '19',
        displayName: 'NetMovies',
        evidence: 'br-offer-census-2026-08-19',
      },
    ],
  },
  {
    slug: 'lionsgate-plus-amazon-channels',
    canonicalName: 'Lionsgate+ Amazon Channels',
    aliases: [
      {
        providerApi: 'tmdb',
        externalKey: '2358',
        displayName: 'Lionsgate+ Amazon Channels',
        evidence: 'br-offer-census-2026-08-19',
      },
    ],
  },
  {
    slug: 'plex',
    canonicalName: 'Plex',
    aliases: [
      {
        providerApi: 'tmdb',
        externalKey: '538',
        displayName: 'Plex',
        evidence: 'br-offer-census-2026-08-19',
      },
    ],
  },
  {
    slug: 'belas-artes-a-la-carte',
    // Slug em ASCII (o CHECK do banco e `^[a-z0-9]+(-[a-z0-9]+)*$`); o nome
    // canonico preserva a grafia que o upstream publica.
    canonicalName: 'Belas Artes à La Carte',
    aliases: [
      {
        providerApi: 'tmdb',
        externalKey: '447',
        displayName: 'Belas Artes à La Carte',
        evidence: 'br-offer-census-2026-08-19',
      },
    ],
  },
  {
    slug: 'looke-amazon-channel',
    canonicalName: 'Looke Amazon Channel',
    aliases: [
      {
        providerApi: 'tmdb',
        externalKey: '683',
        displayName: 'Looke Amazon Channel',
        evidence: 'br-offer-census-2026-08-19',
      },
    ],
  },
  {
    slug: 'mgm-plus-apple-tv-channel',
    canonicalName: 'MGM+ Apple TV Channel',
    aliases: [
      {
        providerApi: 'tmdb',
        externalKey: '2142',
        displayName: 'MGM+ Apple TV Channel',
        evidence: 'br-offer-census-2026-08-19',
      },
    ],
  },
  {
    slug: 'filmelier-plus-amazon-channel',
    canonicalName: 'Filmelier Plus Amazon Channel',
    aliases: [
      {
        providerApi: 'tmdb',
        externalKey: '2356',
        displayName: 'Filmelier Plus Amazon Channel',
        evidence: 'br-offer-census-2026-08-19',
      },
    ],
  },
  {
    slug: 'gospel-play',
    // Caixa alta preservada: e o nome que o upstream publica, e este registro
    // audita o upstream, nao o corrige.
    canonicalName: 'GOSPEL PLAY',
    aliases: [
      {
        providerApi: 'tmdb',
        externalKey: '477',
        displayName: 'GOSPEL PLAY',
        evidence: 'br-offer-census-2026-08-19',
      },
    ],
  },
  {
    slug: 'mgm-plus-amazon-channel',
    // Marca IRMA de `mgm-plus-apple-tv-channel` (2142) e ainda assim outro
    // produto: um canal dentro da Amazon, outro dentro da Apple. Ids
    // diferentes, lojas diferentes, slugs diferentes.
    canonicalName: 'MGM Plus Amazon Channel',
    aliases: [
      {
        providerApi: 'tmdb',
        externalKey: '2141',
        displayName: 'MGM Plus Amazon Channel',
        evidence: 'br-offer-census-2026-08-19',
      },
    ],
  },
  {
    slug: 'arte-amazon-channel',
    canonicalName: 'Arte Amazon Channel',
    aliases: [
      {
        providerApi: 'tmdb',
        externalKey: '2607',
        displayName: 'Arte Amazon Channel',
        evidence: 'br-offer-census-2026-08-19',
      },
    ],
  },
  {
    slug: 'reserva-imovision-amazon-channel',
    canonicalName: 'Reserva Imovision Amazon Channel',
    aliases: [
      {
        providerApi: 'tmdb',
        externalKey: '2157',
        displayName: 'Reserva Imovision Amazon Channel',
        evidence: 'br-offer-census-2026-08-19',
      },
    ],
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
      // EVIDENCIA AUSENTE OU INVENTADA => plano invalido => nada e escrito.
      // Ausente e inventada dao no mesmo lugar de proposito: as duas significam
      // que ninguem consegue apontar a medicao de onde a chave saiu, e um alias
      // errado credita a plataforma errada — pior que a ausencia do provedor.
      if (!(ALIAS_EVIDENCE_SOURCES as readonly string[]).includes(alias.evidence)) {
        errors.push(
          `evidencia invalida em "${entry.slug}" (${alias.providerApi}:${alias.externalKey}): ` +
            `${JSON.stringify(alias.evidence)} nao esta em ALIAS_EVIDENCE_SOURCES ` +
            `(${ALIAS_EVIDENCE_SOURCES.join(', ')}). Alias sem medicao real nao entra.`,
        )
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

/* ------------------------------------------------------------------ */
/* Evidencia MEDIDA no banco (2a linha, independente da declarada)      */
/* ------------------------------------------------------------------ */

/**
 * Um par `(provider_api, provider_key)` REALMENTE observado em
 * `watch_availability`, com o nome que o upstream gravou naquela linha.
 */
export interface ObservedOfferProvider {
  readonly providerApi: string
  readonly providerKey: string
  /** `watch_availability.provider_name` — o que o upstream chamou de si mesmo. */
  readonly providerName: string
  /** Quantas ofertas carregam esse par (so relatorio; nunca decide). */
  readonly offers: number
}

/** Um alias que o plano quer CRIAR e que o dado nunca viu. Isto RECUSA. */
export interface UnobservedAlias {
  readonly providerApi: AliasProviderApi
  readonly externalKey: string
  readonly slug: string
  readonly evidence: AliasEvidenceSource
}

/** Alias observado sob OUTRO nome. Isto AVISA (nome nunca foi identidade). */
export interface RenamedAlias {
  readonly providerApi: AliasProviderApi
  readonly externalKey: string
  readonly slug: string
  readonly declaredName: string
  readonly observedName: string
}

export interface AliasEvidenceCheck {
  readonly ok: boolean
  /** Aliases a CRIAR sem nenhuma oferta correspondente no banco. */
  readonly unobserved: readonly UnobservedAlias[]
  /** Aliases a CRIAR cujo nome no banco difere do declarado. */
  readonly renamed: readonly RenamedAlias[]
  /** Aliases a CRIAR confirmados pelo dado, com o volume observado. */
  readonly confirmed: readonly (UnobservedAlias & { readonly offers: number })[]
}

/**
 * Confronta os aliases a CRIAR contra os pares realmente observados nas ofertas.
 *
 * POR QUE ISTO EXISTE. `validateProviderRegistry` prova que alguem DECLAROU uma
 * medicao; nao prova que a medicao existe. Um `externalKey` digitado errado
 * (`1852` em vez de `1853`) passa na validacao declarativa e credita a
 * plataforma errada em toda oferta daquele id. Este check e a unica etapa que
 * pergunta ao DADO.
 *
 * DOIS DESFECHOS, deliberadamente com pesos diferentes:
 *
 *  - NUNCA OBSERVADO => `ok = false`. Criar alias para uma chave que o corpus
 *    jamais publicou nao tem desfecho bom: ou o id esta errado (e vai creditar
 *    outra plataforma quando aparecer), ou e um provedor que nao existe no
 *    nosso dado (e a licenca + a decisao de uso que o `legal apply` vai gerar
 *    ficam orfas). Recusar e a unica leitura honesta.
 *  - OBSERVADO SOB OUTRO NOME => AVISO, nao recusa. `displayName` e declarado
 *    neste arquivo como "auditoria, nunca identidade": o TMDB renomeia
 *    provedor ("Apple TV" -> "Apple TV Store") sem trocar o `provider_id`, e
 *    derrubar o registro inteiro por uma troca de rotulo seria fail-closed no
 *    campo errado. O aviso vai para a saida do comando e para o relatorio.
 *
 * SO OLHA `action === 'create'`: alias ja existente no banco e `keep`, e
 * re-checar o passado transformaria um comando idempotente numa auditoria
 * retroativa que pode falhar por dado que ninguem esta mexendo agora.
 *
 * PURO: recebe o plano e a lista de observados; nao consulta nada.
 */
export function checkAliasEvidenceAgainstOffers(
  plan: ProviderRegistryPlan,
  observed: readonly ObservedOfferProvider[],
): AliasEvidenceCheck {
  const byKey = new Map<string, ObservedOfferProvider>()
  for (const row of observed) {
    byKey.set(`${row.providerApi}:${row.providerKey}`, row)
  }

  const unobserved: UnobservedAlias[] = []
  const renamed: RenamedAlias[] = []
  const confirmed: (UnobservedAlias & { readonly offers: number })[] = []

  for (const alias of plan.aliases) {
    if (alias.action !== 'create') continue
    const entry = WATCH_PROVIDER_REGISTRY.find((p) => p.slug === alias.slug)
    const declared = entry?.aliases.find(
      (a) => a.providerApi === alias.providerApi && a.externalKey === alias.externalKey,
    )
    const identity: UnobservedAlias = {
      providerApi: alias.providerApi,
      externalKey: alias.externalKey,
      slug: alias.slug,
      evidence: declared?.evidence ?? ('br-offer-census-2026-08-19' as AliasEvidenceSource),
    }

    const hit = byKey.get(`${alias.providerApi}:${alias.externalKey}`)
    if (hit === undefined) {
      unobserved.push(identity)
      continue
    }
    confirmed.push({ ...identity, offers: hit.offers })
    if (hit.providerName.trim() !== alias.displayName.trim()) {
      renamed.push({
        providerApi: alias.providerApi,
        externalKey: alias.externalKey,
        slug: alias.slug,
        declaredName: alias.displayName,
        observedName: hit.providerName,
      })
    }
  }

  return { ok: unobserved.length === 0, unobserved, renamed, confirmed }
}
