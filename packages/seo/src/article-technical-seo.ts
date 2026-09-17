/**
 * article-technical-seo.ts — SEO tecnico da pagina de materia. PURO.
 *
 * A DIVISAO QUE ESTE MODULO DEFENDE:
 *
 *   O CMS aprova SINAIS (meta title, keyphrase, secao, alt, links).
 *   O lado publico DERIVA a estrutura (canonical, robots, JSON-LD, sitemap).
 *
 * Projetar canonical ou robots do CMS criaria duas fontes discordando sobre a
 * mesma URL, e a divergencia so apareceria no indice do buscador — tarde demais
 * e sem sintoma local. Por isso as funcoes abaixo recebem o sinal aprovado e a
 * decisao de indexabilidade separadamente, e sao elas que resolvem o conflito.
 *
 * Nada aqui toca rede, banco ou relogio: recebe fatos, devolve estrutura.
 */

// `IndexDecision` vem de `resolver.ts`, nao e redeclarada aqui: duas definicoes
// do mesmo tipo divergem no primeiro estado novo, e o TypeScript nao avisa
// enquanto os valores coincidirem.
import type { IndexDecision } from './resolver.js'
import {
  organizationId,
  profilePersonId,
  publicHomeUrl,
  publishingPrinciplesUrl,
} from './site-identity.js'
import { toOpenGraphLocale } from './social-metadata.js'

export type { IndexDecision }

/** Uma obra ou pessoa CITADA na materia, com a pagina publica dela. */
export interface ArticleSchemaMention {
  readonly type: 'Movie' | 'TVSeries' | 'Person'
  readonly name: string
  /** Absoluta. */
  readonly url: string
}

export interface ArticleSeoFacts {
  /** URL canonica DERIVADA de `slugs`/`redirects`. Absoluta. */
  readonly canonicalUrl: string
  /**
   * Excecao editorial explicita (sindicacao, conteudo espelhado). Absoluta.
   * `null` no caso normal — que e a esmagadora maioria.
   */
  readonly canonicalOverride: string | null
  readonly decision: IndexDecision
  readonly title: string
  readonly metaTitle: string | null
  readonly metaDescription: string | null
  readonly deck: string | null
  readonly socialTitle: string | null
  readonly socialDescription: string | null
  readonly articleSection: string | null
  readonly schemaTypeRecommendation: string | null
  readonly imageUrl: string | null
  readonly imageAlt: string | null
  readonly publishedAtIso: string | null
  readonly updatedAtIso: string | null
  readonly authorName: string | null
  /**
   * A pagina de autor, absoluta, quando existe. Ausente ou `null`: a assinatura
   * nao tem pagina, e o JSON-LD nao promete uma.
   */
  readonly authorUrl?: string | null
  /** Obras e pessoas CITADAS e visiveis na materia ("Entidades citadas"). */
  readonly mentions?: readonly ArticleSchemaMention[]
  readonly siteName: string
  /** Idioma BCP-47 (`pt-BR`) — o formato do JSON-LD. O Open Graph o converte. */
  readonly locale: string
  /**
   * O cartao social da materia SEM capa: a ultima candidata da decisao do dono D4
   * (a marca). So o cartao a usa — o `image` do JSON-LD continua sendo so a capa
   * real, porque logo nao e foto da materia.
   */
  readonly socialFallbackImage?: { readonly url: string; readonly alt: string } | null
}

/* ------------------------------------------------------------------ */
/* Canonical                                                           */
/* ------------------------------------------------------------------ */

export interface CanonicalVerdict {
  readonly href: string
  /** O override foi aplicado? Util para log e para o teste dizer o porque. */
  readonly overridden: boolean
  readonly reason: string
}

/**
 * Qual URL a pagina declara como canonica?
 *
 * O override so vale quando a pagina INDEXA. Uma pagina `noindex`/`blocked`
 * apontando canonical para outra URL e pior que inutil: consolida sinais numa
 * pagina cujo conteudo o buscador foi instruido a ignorar, e ainda sugere que a
 * versao correta e outra. Nesse caso a pagina e autorreferente e pronto.
 *
 * Override vazio, relativo ou identico a canonical nao e override — e ruido de
 * dado, e aplicar ruido silenciosamente e como perder a canonical de vista.
 */
export function resolveCanonical(facts: ArticleSeoFacts): CanonicalVerdict {
  const override = (facts.canonicalOverride ?? '').trim()

  if (override === '') {
    return { href: facts.canonicalUrl, overridden: false, reason: 'sem override' }
  }
  if (!/^https:\/\//i.test(override)) {
    // Absoluta e https, sempre. Uma canonical relativa e resolvida contra a URL
    // corrente e vira autorreferente sem ninguem perceber.
    return { href: facts.canonicalUrl, overridden: false, reason: 'override nao e https absoluta' }
  }
  if (override === facts.canonicalUrl) {
    return { href: facts.canonicalUrl, overridden: false, reason: 'override igual a canonical' }
  }
  if (facts.decision !== 'index') {
    return {
      href: facts.canonicalUrl,
      overridden: false,
      reason: 'pagina nao indexavel: override ignorado',
    }
  }
  return { href: override, overridden: true, reason: 'override editorial aplicado' }
}

/* ------------------------------------------------------------------ */
/* Robots                                                              */
/* ------------------------------------------------------------------ */

export interface RobotsDirective {
  readonly index: boolean
  readonly follow: boolean
  readonly 'max-image-preview'?: 'large'
  readonly googleBot?: {
    readonly index: boolean
    readonly follow: boolean
    readonly 'max-image-preview'?: 'large'
  }
}

/**
 * Diretiva de robots derivada da decisao.
 *
 * `follow` permanece TRUE mesmo em `noindex`: nao indexar esta pagina nao e
 * motivo para desperdicar os links dela. `noindex, nofollow` so faria sentido
 * para conteudo que nao queremos nem rastrear, e nao e o caso de uma materia
 * em revisao ou de idioma ainda nao publicado.
 */
export function articleRobots(decision: IndexDecision): RobotsDirective {
  const index = decision === 'index'
  if (!index) return { index, follow: true, googleBot: { index, follow: true } }
  // `max-image-preview:large` (auditoria de SEO de 11/09/2026, secao 3.3):
  // nenhuma pagina o emitia, nem a materia — a que mais vive de imagem grande no
  // Discover. So em pagina que indexa, e nos DOIS metas, para `robots` e
  // `googlebot` dizerem a mesma coisa.
  return {
    index,
    follow: true,
    'max-image-preview': 'large',
    googleBot: { index, follow: true, 'max-image-preview': 'large' },
  }
}

/* ------------------------------------------------------------------ */
/* Open Graph e Twitter                                                */
/* ------------------------------------------------------------------ */

export interface OpenGraphPayload {
  readonly type: 'article'
  readonly title: string
  readonly description?: string
  readonly url: string
  readonly siteName: string
  readonly locale: string
  readonly publishedTime?: string
  readonly modifiedTime?: string
  readonly section?: string
  readonly authors?: string[]
  readonly images?: { url: string; alt: string }[]
}

/**
 * Cascata de titulo social: `socialTitle` -> `metaTitle` -> titulo da materia.
 *
 * A ordem nao e arbitraria. O titulo social existe porque o que funciona numa
 * SERP nao funciona num card de rede social; quando o editor escreveu um, ele
 * sabia disso. Cair direto no `metaTitle` apagaria essa distincao.
 */
export function socialTitleOf(facts: ArticleSeoFacts): string {
  const social = (facts.socialTitle ?? '').trim()
  if (social !== '') return social
  const meta = (facts.metaTitle ?? '').trim()
  return meta === '' ? facts.title : meta
}

export function socialDescriptionOf(facts: ArticleSeoFacts): string | null {
  for (const candidate of [facts.socialDescription, facts.metaDescription, facts.deck]) {
    const value = (candidate ?? '').trim()
    if (value !== '') return value
  }
  return null
}

export function buildOpenGraph(facts: ArticleSeoFacts): OpenGraphPayload {
  const canonical = resolveCanonical(facts)
  const description = socialDescriptionOf(facts)
  const section = (facts.articleSection ?? '').trim()
  const author = (facts.authorName ?? '').trim()

  return {
    type: 'article',
    title: socialTitleOf(facts),
    ...(description === null ? {} : { description }),
    // A URL do card acompanha a CANONICAL, incluindo o override: apontar o
    // compartilhamento para uma URL e a canonical para outra divide o sinal
    // social entre duas paginas.
    url: canonical.href,
    siteName: facts.siteName,
    // O Open Graph escreve o idioma com sublinhado (`pt_BR`); `facts.locale` e
    // BCP-47 (`pt-BR`), o formato do JSON-LD. Passar direto era o `og:locale`
    // invalido que a auditoria de SEO achou em toda materia.
    locale: toOpenGraphLocale(facts.locale),
    ...(facts.publishedAtIso === null ? {} : { publishedTime: facts.publishedAtIso }),
    ...(facts.updatedAtIso === null
      ? {}
      : { modifiedTime: modifiedIsoOf(facts) ?? facts.updatedAtIso }),
    ...(section === '' ? {} : { section }),
    ...(author === '' ? {} : { authors: [author] }),
    ...(facts.imageUrl !== null
      ? {
          images: [
            {
              url: facts.imageUrl,
              // `alt` vazio numa imagem de conteudo e falha de acessibilidade,
              // nao decisao decorativa. Cair no titulo e melhor que cair no
              // nada.
              alt: (facts.imageAlt ?? '').trim() === '' ? facts.title : (facts.imageAlt as string),
            },
          ],
        }
      : facts.socialFallbackImage
        ? // Sem capa, o cartao leva a MARCA (decisao do dono D4) em vez de sair
          // sem imagem nenhuma.
          {
            images: [
              { url: facts.socialFallbackImage.url, alt: facts.socialFallbackImage.alt },
            ],
          }
        : {}),
  }
}

export interface TwitterPayload {
  readonly card: 'summary_large_image' | 'summary'
  readonly title: string
  readonly description?: string
  readonly images?: string[]
}

/**
 * Card do Twitter/X.
 *
 * `summary_large_image` exige imagem. Declarar o card grande SEM imagem produz
 * um card degradado — por isso o tipo acompanha a existencia da imagem em vez
 * de ser fixo. A marca de reserva e 1200x630 e cabe no recorte do card grande.
 */
export function buildTwitter(facts: ArticleSeoFacts): TwitterPayload {
  const description = socialDescriptionOf(facts)
  const imageUrl = facts.imageUrl ?? facts.socialFallbackImage?.url ?? null
  return {
    card: imageUrl === null ? 'summary' : 'summary_large_image',
    title: socialTitleOf(facts),
    ...(description === null ? {} : { description }),
    ...(imageUrl === null ? {} : { images: [imageUrl] }),
  }
}

/* ------------------------------------------------------------------ */
/* Tipo de schema                                                      */
/* ------------------------------------------------------------------ */

export const ARTICLE_SCHEMA_TYPES = ['NewsArticle', 'Article'] as const
export type ArticleSchemaType = (typeof ARTICLE_SCHEMA_TYPES)[number]

export interface SchemaTypeVerdict {
  readonly type: ArticleSchemaType
  readonly accepted: boolean
  readonly reason: string
}

/**
 * O tipo de JSON-LD e uma RECOMENDACAO do CMS, nao uma ordem.
 *
 * `Review` e recusado aqui sem excecao. Emitir `Review` para uma materia que
 * nao carrega review PROPRIA da Cinerie e schema falso — a mesma familia de
 * problema que fabricar `AggregateRating`. E a decisao de ter review propria
 * nao pertence ao pipeline editorial.
 *
 * `ItemList` e `HowTo` tambem sao recusados: descrevem a ESTRUTURA da pagina
 * (lista numerada, passo a passo), e o render e quem sabe se ela existe. Aceitar
 * a recomendacao cega marcaria como lista uma pagina de paragrafos corridos.
 */
export function resolveSchemaType(recommendation: string | null): SchemaTypeVerdict {
  const value = (recommendation ?? '').trim()
  if (value === '') {
    return { type: 'NewsArticle', accepted: false, reason: 'sem recomendacao: NewsArticle' }
  }
  if (value === 'NewsArticle' || value === 'Article') {
    return { type: value, accepted: true, reason: 'recomendacao aceita' }
  }
  return {
    type: 'NewsArticle',
    accepted: false,
    reason: `recomendacao "${value}" recusada: exige decisao do lado publico`,
  }
}

/* ------------------------------------------------------------------ */
/* JSON-LD                                                             */
/* ------------------------------------------------------------------ */

/**
 * JSON-LD da materia.
 *
 * `mainEntityOfPage` aponta para a canonical resolvida, nao para a URL da
 * requisicao: e assim que se diz "esta marcacao descreve AQUELA pagina".
 *
 * Nao ha `aggregateRating` nem `review` aqui, e isso e permanente enquanto
 * ratings externos e reviews proprias nao forem produto ativo com licenca
 * decidida.
 */
export function buildArticleJsonLd(facts: ArticleSeoFacts): Record<string, unknown> {
  const canonical = resolveCanonical(facts)
  const schema = resolveSchemaType(facts.schemaTypeRecommendation)
  const description = (facts.metaDescription ?? facts.deck ?? '').trim()
  const section = (facts.articleSection ?? '').trim()
  const author = (facts.authorName ?? '').trim()

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': schema.type,
    headline: facts.title,
    url: canonical.href,
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonical.href },
    inLanguage: facts.locale,
  }

  if (description !== '') jsonLd.description = description
  if (facts.publishedAtIso !== null) jsonLd.datePublished = facts.publishedAtIso
  // `dateModified` ausente faz o buscador presumir que a materia nunca mudou.
  // Quando nao ha data de atualizacao, a de publicacao e a verdade disponivel.
  const modified = modifiedIsoOf(facts)
  if (modified !== null) jsonLd.dateModified = modified
  if (author !== '') {
    // `url` SO com pagina de autor de verdade. Ate a auditoria de SEO de
    // 11/09/2026 ela nao existia, e omitir era a resposta certa: `url` para uma
    // pagina inexistente promete perfil verificavel e entrega 404. Quem decide se
    // a pagina existe e o lado publico; aqui so se recusa URL que nao e absoluta.
    const authorUrl = absoluteHttpUrl(facts.authorUrl)
    jsonLd.author =
      authorUrl === null
        ? { '@type': 'Person', name: author }
        : { '@type': 'Person', '@id': profilePersonId(authorUrl), name: author, url: authorUrl }
  }

  // `mentions`: o que a materia CITA e mostra ("Entidades citadas nesta materia").
  // `about` NAO e emitido: o banco nao marca qual entidade e o ASSUNTO da materia
  // — a ficha exibida e a da primeira citada, e chamar isso de assunto seria
  // afirmar o que ninguem declarou.
  const mentions = mentionsOf(facts.mentions)
  if (mentions.length > 0) jsonLd.mentions = mentions

  /*
   * PUBLISHER — estava AUSENTE, e a ausencia e um defeito de verdade.
   *
   * `NewsArticle` sem `publisher` perde a atribuicao de quem publicou, que e
   * justamente o que distingue uma materia de jornal de um texto solto. O nome
   * vem de `siteName` e a URL e a RAIZ da canonical ja resolvida — derivar em
   * vez de fixar evita que um ambiente de teste anuncie o dominio de producao.
   */
  const publisherUrl = originOf(canonical.href)
  jsonLd.publisher = {
    '@type': 'Organization',
    name: facts.siteName,
    ...(publisherUrl === null
      ? {}
      : {
          // O MESMO no da home (`@id`) e a mesma URL publica, a home canonica.
          // Ate 11/09/2026 o publisher apontava para a origem sem barra, a home
          // para `/pt/` e o WebSite para `/` — tres enderecos para uma
          // organizacao, sem `@id` (auditoria de SEO, M7).
          '@id': organizationId(publisherUrl),
          url: publicHomeUrl(publisherUrl),
          // A marca-mãe raster (PNG 672x163) — o mesmo arquivo de
          // `CINERIE_ORGANIZATION_LOGO` (apps/web/src/lib/brand-logos.ts),
          // amarrado por teste. Sem origem nao ha logo absoluto: o publisher
          // degrada inteiro, nunca aponta para caminho relativo.
          logo: { '@type': 'ImageObject', url: `${publisherUrl}/brand/cinerie-logo.png` },
          // Como a organizacao publica — o mesmo valor do no da home.
          publishingPrinciples: publishingPrinciplesUrl(publisherUrl),
        }),
  }

  /*
   * `articleSection` so entra quando e SECAO EDITORIAL de verdade.
   *
   * O presenter caia para `category`, que carrega o TIPO DE CONTEUDO — e o
   * resultado era `articleSection: "news"`, em ingles, num site em pt-BR.
   * "news" nao e editoria: e o formato do texto. Secao inventada e pior que
   * secao ausente, porque o buscador a usa para agrupar assunto.
   */
  if (section !== '' && !isContentTypeName(section)) jsonLd.articleSection = section
  if (facts.imageUrl !== null) jsonLd.image = [facts.imageUrl]

  return jsonLd
}

/** Raiz (`https://host`) de uma URL absoluta, ou `null` se ela nao for uma. */
function originOf(href: string): string | null {
  try {
    return new URL(href).origin
  } catch {
    return null
  }
}

/**
 * A data de modificacao declarada: a da ultima gravacao, mas NUNCA anterior a da
 * publicacao. Materia agendada e gravada antes de ir ao ar, e `dateModified`
 * antes de `datePublished` seria uma contradicao dentro do proprio JSON-LD.
 */
function modifiedIsoOf(facts: ArticleSeoFacts): string | null {
  const published = facts.publishedAtIso
  const updated = facts.updatedAtIso
  if (updated === null) return published
  if (published === null) return updated
  return Date.parse(updated) < Date.parse(published) ? published : updated
}

/** http(s) absoluta, com host. Relativa, vazia ou de outro esquema nao passa. */
const ABSOLUTE_HTTP_URL = /^https?:\/\/[^\s/?#]+(?:[/?#]\S*)?$/i

function absoluteHttpUrl(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim()
  return ABSOLUTE_HTTP_URL.test(trimmed) ? trimmed : null
}

/** As citacoes validas, uma por URL, na ordem em que chegaram. */
function mentionsOf(
  mentions: readonly ArticleSchemaMention[] | undefined,
): Record<string, unknown>[] {
  const seen = new Set<string>()
  const out: Record<string, unknown>[] = []
  for (const mention of mentions ?? []) {
    const name = mention.name.trim()
    const url = absoluteHttpUrl(mention.url)
    if (name === '' || url === null || seen.has(url)) continue
    seen.add(url)
    out.push({ '@type': mention.type, name, url })
  }
  return out
}

/**
 * O valor e um TIPO DE CONTEUDO disfarcado de secao?
 *
 * Lista fechada e minuscula: sao os valores de `contentType` do contrato, que
 * vazavam para `articleSection` pelo fallback do presenter. Uma editoria de
 * verdade chamada "Review" existiria em portugues ("Crítica") — a comparacao e
 * feita sem acento e em minuscula justamente para nao recusar isso.
 */
const CONTENT_TYPE_NAMES = new Set(['news', 'review', 'feature', 'interview', 'list', 'guide'])

function isContentTypeName(value: string): boolean {
  return CONTENT_TYPE_NAMES.has(value.trim().toLowerCase())
}

/* ------------------------------------------------------------------ */
/* Links internos aprovados                                            */
/* ------------------------------------------------------------------ */

export interface ApprovedInternalLink {
  readonly targetType: string
  readonly targetId: string
  readonly anchorText: string
}

export interface ResolvedInternalLink {
  readonly href: string
  readonly anchorText: string
}

/** Rota publica de cada tipo de alvo. Tipo ausente daqui NAO vira link. */
const INTERNAL_LINK_ROUTES: Readonly<Record<string, string>> = {
  movie: '/pt/filmes',
  tv_show: '/pt/series',
  person: '/pt/pessoas',
  article: '/pt/noticias',
}

/**
 * Links internos aprovados -> hrefs reais.
 *
 * Recebe os SLUGS ja resolvidos porque este modulo e puro: resolver id -> slug
 * exige banco. Um alvo sem slug conhecido e DESCARTADO, nao renderizado com id
 * cru — link interno quebrado em pagina indexavel gasta rastreamento e sinaliza
 * qualidade baixa.
 */
export function resolveInternalLinks(
  links: readonly ApprovedInternalLink[],
  slugByTarget: Readonly<Record<string, string>>,
): ResolvedInternalLink[] {
  const seen = new Set<string>()
  const resolved: ResolvedInternalLink[] = []

  for (const link of links) {
    const base = INTERNAL_LINK_ROUTES[link.targetType]
    if (base === undefined) continue

    const slug = slugByTarget[`${link.targetType}:${link.targetId}`]
    if (slug === undefined || slug.trim() === '') continue

    const href = `${base}/${slug.trim()}/`
    // Dedup por DESTINO: dois links para a mesma pagina no mesmo texto diluem
    // a ancora e nao acrescentam sinal.
    if (seen.has(href)) continue
    seen.add(href)

    const anchor = link.anchorText.trim()
    if (anchor === '') continue
    resolved.push({ href, anchorText: anchor })
  }

  return resolved
}
