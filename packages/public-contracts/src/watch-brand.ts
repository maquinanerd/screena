/**
 * watch-brand.ts — Decomposicao DECLARADA de um provedor canonico em
 * marca / variante / vendido em. Modulo PURO (sem rede, DB, IO ou `Date`).
 *
 * ============ A DECISAO QUE ISTO MATERIALIZA ============
 *
 * Decisao de Pablo Eduardo, 2026-08-19 (opcao A): a fileira "Onde assistir"
 * agrupa pela MARCA. O leitor ve "Paramount+" uma vez, com as rotas clicaveis
 * embaixo — assinatura direta, plano Premium, e o canal dentro do Prime.
 *
 * Isso so ficou necessario porque a leva BR registrou 24 provedores novos, e com
 * eles o mesmo titulo passou a listar "HBO Max" e "HBO Max Amazon Channel" lado
 * a lado, "Paramount Plus" e "Paramount Plus Premium" e "Paramount+ Amazon
 * Channel". Tudo verdade factual; nada disso pode sumir. O que muda e a
 * APRESENTACAO.
 *
 * ============ POR QUE DECLARADO, E NUNCA DERIVADO DO NOME ============
 *
 * A tentacao obvia e derivar: cortar " Amazon Channel" do fim da string, tratar
 * o prefixo como marca. Isso e exatamente o "decidir pelo nome" que o registro
 * canonico de provedores proibe, e por tres razoes que ja custaram caro aqui:
 *
 *  1. O nome vem VERBATIM do payload de terceiro. A TMDB renomeia provedor
 *     quando quiser, sem aviso e sem trocar o `provider_id` ("Apple TV" virou
 *     "Apple TV Store"). Uma derivacao por string muda de resultado no dia em
 *     que o upstream mudar de humor.
 *  2. Nomes parecidos NAO sao a mesma marca. "Claro video" (loja transacional) e
 *     "Claro tv+" (o streaming da operadora) sao produtos diferentes; qualquer
 *     heuristica de prefixo os funde. O mesmo vale para "Amazon Video" (a loja)
 *     e "Amazon Prime Video" (a assinatura) — funde-los afirmaria que uma compra
 *     avulsa esta inclusa na assinatura.
 *  3. Nomes DIFERENTES podem ser a mesma marca: "HBO Max" (1899) e "HBO Max
 *     Amazon Channel" (1825) agrupam; "Max" e o nome canonico de um e nao do
 *     outro. Derivacao nenhuma acerta os dois casos ao mesmo tempo.
 *
 * ============ AGRUPAMENTO E OPT-IN, NUNCA UM `else` ============
 *
 * Provedor sem `brand` declarada **aparece sozinho, como sempre apareceu**. Nao
 * ha ramo que "adivinhe" a marca de quem nao esta aqui: o desconhecido segue
 * exibido com o proprio nome, que e o comportamento honesto. Acrescentar um
 * provedor a este arquivo e um ato deliberado, com o mesmo peso de acrescentar
 * um alias.
 *
 * ============ ONDE ISTO MORA, E POR QUE NAO NO REGISTRO ============
 *
 * O pedido foi "declarados no registro". A identidade tecnica (slug + aliases +
 * evidencia) vive em `services/streaming/src/provider-registry.ts`, que e um
 * WORKER. O render publico nao pode depender de um servico de worker — nem por
 * um tipo — sem abrir a porta para que um import futuro arraste Prisma ou um
 * client de API para dentro do bundle (invariante 3).
 *
 * Entao a decomposicao mora aqui, em `@screena/public-contracts` — o pacote cuja
 * razao de existir e, literalmente, "contratos de apresentacao do render
 * publico" — e os dois lados sao amarrados por
 * `tests/governance/watch-brand-registry-sync.test.ts`, que reprova se um slug
 * existir num e nao no outro. Uma declaracao, dois leitores, zero deriva
 * possivel.
 */

/** A decomposicao declarada de UM provedor canonico. */
export interface WatchBrandDeclaration {
  /** `watch_providers.slug` — a identidade canonica, a mesma do registro. */
  readonly slug: string
  /**
   * A marca que o leitor reconhece. `null` = **nunca agrupa**: este provedor
   * aparece sozinho, com o proprio nome, como antes desta decisao.
   */
  readonly brand: string | null
  /**
   * Plano/edicao DENTRO da mesma marca (ex.: `'Premium'`). Distingue duas rotas
   * que nao dao o mesmo acesso. Exige `brand`.
   */
  readonly variant: string | null
  /**
   * Onde a assinatura e VENDIDA quando nao e direto (ex.: `'Prime Video'`,
   * `'Apple TV'`). Exige `brand`.
   *
   * Este campo carrega a informacao mais importante da rota: e ele que diz ao
   * leitor que, para assistir, ele precisa do servico hospedeiro **mais** o
   * canal. Some-lo do rotulo seria esconder um custo atras do nome da marca.
   */
  readonly soldVia: string | null
}

/**
 * As declaracoes vigentes.
 *
 * Cobre os provedores canonicos onde a marca REPETE (o problema que a decisao
 * resolve) e os pares de nome parecido que **nao** podem agrupar. Provedor
 * ausente daqui nao agrupa — e isso e um desfecho valido, nao um esquecimento.
 */
export const WATCH_BRAND_DECLARATIONS: readonly WatchBrandDeclaration[] = [
  // ---- HBO Max: assinatura propria + canal na Amazon --------------------
  { slug: 'max', brand: 'HBO Max', variant: null, soldVia: null },
  { slug: 'hbo-max-amazon-channel', brand: 'HBO Max', variant: null, soldVia: 'Prime Video' },

  // ---- Paramount+: tres rotas, tres acessos DIFERENTES ------------------
  // `paramount-plus-premium` NAO e "o mesmo com anuncio": carrega catalogo que o
  // plano de entrada nao tem. Agrupa na marca (o leitor procura "Paramount+"),
  // mas continua sendo uma ROTA propria, com rotulo proprio e link proprio.
  { slug: 'paramount-plus', brand: 'Paramount+', variant: null, soldVia: null },
  { slug: 'paramount-plus-premium', brand: 'Paramount+', variant: 'Premium', soldVia: null },
  { slug: 'paramount-plus-amazon-channel', brand: 'Paramount+', variant: null, soldVia: 'Prime Video' },
  { slug: 'paramount-plus-apple-tv-channel', brand: 'Paramount+', variant: null, soldVia: 'Apple TV' },

  // ---- MGM+: a MESMA marca em duas lojas -------------------------------
  { slug: 'mgm-plus-amazon-channel', brand: 'MGM+', variant: null, soldVia: 'Prime Video' },
  { slug: 'mgm-plus-apple-tv-channel', brand: 'MGM+', variant: null, soldVia: 'Apple TV' },

  // ---- Looke: plataforma propria + canal na Amazon ---------------------
  { slug: 'looke', brand: 'Looke', variant: null, soldVia: null },
  { slug: 'looke-amazon-channel', brand: 'Looke', variant: null, soldVia: 'Prime Video' },

  // ---- Marcas que so aparecem como canal --------------------------------
  // Agrupar uma marca com UMA rota nao junta nada; o ganho e outro: o leitor le
  // "Telecine · canal no Prime Video" em vez de "Telecine Amazon Channel", e a
  // frase diz o que ele precisa ter.
  { slug: 'telecine-amazon-channel', brand: 'Telecine', variant: null, soldVia: 'Prime Video' },
  { slug: 'universal-plus-amazon-channel', brand: 'Universal+', variant: null, soldVia: 'Prime Video' },
  { slug: 'sony-one-amazon-channel', brand: 'Sony One', variant: null, soldVia: 'Prime Video' },
  { slug: 'lionsgate-plus-amazon-channels', brand: 'Lionsgate+', variant: null, soldVia: 'Prime Video' },
  { slug: 'filmelier-plus-amazon-channel', brand: 'Filmelier Plus', variant: null, soldVia: 'Prime Video' },
  { slug: 'arte-amazon-channel', brand: 'Arte', variant: null, soldVia: 'Prime Video' },
  { slug: 'reserva-imovision-amazon-channel', brand: 'Reserva Imovision', variant: null, soldVia: 'Prime Video' },

  // ================= OS QUE NAO AGRUPAM, DECLARADOS ====================
  //
  // `brand: null` e uma AFIRMACAO, nao ausencia de dado: "este provedor aparece
  // sozinho". Estao aqui, e nao fora do arquivo, porque sao justamente os pares
  // que uma derivacao por string fundiria — e o unico jeito de provar que nao
  // fundimos e nomea-los.
  //
  // Claro: a loja transacional e o streaming da operadora sao produtos
  // diferentes. "Claro video" e "Claro tv+" compartilham prefixo e mais nada.
  { slug: 'claro-video', brand: null, variant: null, soldVia: null },
  { slug: 'claro-tv-plus', brand: null, variant: null, soldVia: null },
  // Amazon: a LOJA (compra avulsa) e a ASSINATURA. Funde-las afirmaria que a
  // compra esta inclusa — o defeito que `amazon-video` nasceu para impedir.
  { slug: 'amazon-video', brand: null, variant: null, soldVia: null },
  { slug: 'prime-video', brand: null, variant: null, soldVia: null },
  // Lojas transacionais: cada uma responde por si.
  { slug: 'apple-tv', brand: null, variant: null, soldVia: null },
  { slug: 'google-play', brand: null, variant: null, soldVia: null },
  // Plataformas avulsas sem irma no catalogo.
  { slug: 'netflix', brand: null, variant: null, soldVia: null },
  { slug: 'disney-plus', brand: null, variant: null, soldVia: null },
  { slug: 'globoplay', brand: null, variant: null, soldVia: null },
  { slug: 'pluto-tv', brand: null, variant: null, soldVia: null },
  { slug: 'oldflix', brand: null, variant: null, soldVia: null },
  { slug: 'mercado-play', brand: null, variant: null, soldVia: null },
  { slug: 'netmovies', brand: null, variant: null, soldVia: null },
  { slug: 'plex', brand: null, variant: null, soldVia: null },
  { slug: 'belas-artes-a-la-carte', brand: null, variant: null, soldVia: null },
  { slug: 'gospel-play', brand: null, variant: null, soldVia: null },
]

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * Valida a FORMA das declaracoes. Declaracao invalida nao chega a tela.
 *
 * A regra que merece nome: `variant`/`soldVia` sem `brand` sao um qualificador
 * sem nada para qualificar. Renderizar "· canal no Prime Video" sob um provedor
 * que nao agrupa produziria uma linha solta afirmando uma hierarquia que nao
 * existe.
 */
export function validateWatchBrandDeclarations(
  declarations: readonly WatchBrandDeclaration[],
): readonly string[] {
  const errors: string[] = []
  const seen = new Set<string>()
  for (const entry of declarations) {
    if (!SLUG_PATTERN.test(entry.slug)) {
      errors.push(`slug invalido: "${entry.slug}"`)
    }
    if (seen.has(entry.slug)) errors.push(`slug repetido: "${entry.slug}"`)
    seen.add(entry.slug)

    if (entry.brand !== null && entry.brand.trim() === '') {
      errors.push(`brand vazia em "${entry.slug}" (use null para nao agrupar)`)
    }
    if (entry.brand === null && entry.variant !== null) {
      errors.push(`"${entry.slug}": variant exige brand (qualificador sem marca)`)
    }
    if (entry.brand === null && entry.soldVia !== null) {
      errors.push(`"${entry.slug}": soldVia exige brand (qualificador sem marca)`)
    }
    if (entry.variant !== null && entry.variant.trim() === '') {
      errors.push(`variant vazia em "${entry.slug}" (use null)`)
    }
    if (entry.soldVia !== null && entry.soldVia.trim() === '') {
      errors.push(`soldVia vazio em "${entry.slug}" (use null)`)
    }
  }
  return errors
}

const BY_SLUG: ReadonlyMap<string, WatchBrandDeclaration> = new Map(
  WATCH_BRAND_DECLARATIONS.map((entry) => [entry.slug, entry]),
)

/**
 * A declaracao de um slug, ou `null` quando nao ha nenhuma.
 *
 * `null` e o caminho do provedor que **nao agrupa** — o mesmo desfecho de uma
 * declaracao com `brand: null`. Os dois convergem de proposito: o consumidor nao
 * precisa distinguir "nao declarado" de "declarado como solo", porque a tela e
 * a mesma. O que a declaracao explicita acrescenta e a PROVA, no teste, de que
 * a escolha foi feita.
 */
export function findWatchBrand(slug: string | null | undefined): WatchBrandDeclaration | null {
  if (typeof slug !== 'string') return null
  const key = slug.trim()
  if (key === '') return null
  return BY_SLUG.get(key) ?? null
}

/**
 * Rotulo pt-BR da ROTA, dado o que a declaracao afirma.
 *
 * `null` significa "esta rota nao precisa de rotulo" — o caso do provedor que
 * aparece sozinho, onde o nome da marca ja e a linha inteira.
 *
 * As quatro formas sao declaradas aqui, num lugar so, e nao montadas por
 * concatenacao no componente: um rotulo que muda conforme quem renderiza e como
 * "Prime Video" e "Amazon Prime Video" viraram duas linhas na mesma pagina.
 */
export function watchRouteLabel(
  declaration: WatchBrandDeclaration | null,
  options: { readonly aloneInBrand: boolean },
): string | null {
  if (declaration === null || declaration.brand === null) return null

  const { variant, soldVia } = declaration
  // "canal no X": a palavra `canal` esta la porque `no X` sozinho poderia ser
  // lido como "assista pelo app do X". Canal e um produto que se assina DENTRO
  // do hospedeiro — o leitor precisa dos dois.
  if (soldVia !== null && variant !== null) return `plano ${variant}, canal no ${soldVia}`
  if (soldVia !== null) return `canal no ${soldVia}`
  if (variant !== null) return `plano ${variant}`
  // Rota direta. So ganha rotulo quando ha OUTRA rota da mesma marca para
  // distinguir; sozinha, "Netflix · direto" e ruido.
  return options.aloneInBrand ? null : 'direto'
}
