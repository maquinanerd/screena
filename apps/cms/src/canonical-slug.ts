/**
 * canonical-slug.ts — A slug e DERIVADA aqui, nunca aceita como veio. PURO.
 *
 * `slugSuggestion` e o nome certo do campo do contrato: sugestao. O que vira URL
 * publica sai desta funcao, e ela e deterministica — a mesma entrada produz a
 * mesma slug em qualquer maquina, hoje e daqui a um ano.
 *
 * Por que nao confiar no produtor: a slug e IDENTIDADE PUBLICA. Ela entra no
 * canonical, no sitemap, em links de terceiros e na memoria dos buscadores.
 * Aceitar uma string arbitraria significaria aceitar acento, barra, `..`, espaco
 * e maiuscula em algo que precisa ser estavel e comparavel.
 */

/**
 * Palavras que nao podem virar slug de materia.
 *
 * Colidem com segmentos de rota do site ou com convencoes de arquivo. Uma
 * materia com slug `api` seria inalcancavel — e o defeito so apareceria em
 * producao, no dia da publicacao.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'api',
  'admin',
  'assets',
  'media',
  'static',
  'public',
  'pt',
  'en',
  'es',
  'noticias',
  'news',
  'filmes',
  'series',
  'pessoas',
  'busca',
  'search',
  'sitemap',
  'robots',
  'favicon',
  'null',
  'undefined',
  'new',
  'edit',
  'preview',
])

export const SLUG_LIMITS = {
  maxLength: 96,
  maxWords: 12,
  minLength: 3,
} as const

export type SlugRejection = 'empty_after_normalization' | 'reserved' | 'too_short'

export type SlugResult =
  | { readonly ok: true; readonly slug: string; readonly changed: boolean }
  | { readonly ok: false; readonly reason: SlugRejection }

/**
 * Normaliza uma sugestao em slug canonica.
 *
 * A ordem dos passos importa: decompor o Unicode ANTES de remover caracteres
 * invalidos e o que transforma `é` em `e` em vez de descartar a letra inteira.
 * Fazer o inverso produziria `caf` no lugar de `cafe`.
 */
export function canonicalizeSlug(suggestion: string): SlugResult {
  const normalized = suggestion
    // NFD separa a letra do acento; a faixa combinante remove so o acento.
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // `&` vira "e" antes da limpeza: descarta-lo perderia a conjuncao.
    .replace(/&/g, ' e ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  if (normalized === '') return { ok: false, reason: 'empty_after_normalization' }

  // Corta por PALAVRA, nao por caractere: truncar no meio de uma palavra produz
  // slug ilegivel e prejudica o proprio SEO que a sugestao buscava.
  const words = normalized.split('-').filter((word) => word !== '')
  let slug = words.slice(0, SLUG_LIMITS.maxWords).join('-')
  while (slug.length > SLUG_LIMITS.maxLength && slug.includes('-')) {
    slug = slug.slice(0, slug.lastIndexOf('-'))
  }
  slug = slug.slice(0, SLUG_LIMITS.maxLength).replace(/-+$/, '')

  if (slug === '') return { ok: false, reason: 'empty_after_normalization' }
  if (slug.length < SLUG_LIMITS.minLength) return { ok: false, reason: 'too_short' }
  if (RESERVED_SLUGS.has(slug)) return { ok: false, reason: 'reserved' }

  return { ok: true, slug, changed: slug !== suggestion }
}

/**
 * Resolve colisao acrescentando um sufixo NUMERICO curto.
 *
 * Deterministico: recebe as slugs ja tomadas e devolve sempre a mesma escolha
 * para o mesmo conjunto. Nada de timestamp nem aleatorio — uma slug que muda a
 * cada tentativa quebraria o retry e produziria duas URLs para a mesma materia.
 */
export function resolveSlugCollision(
  base: string,
  taken: ReadonlySet<string>,
  maxAttempts = 50,
): string | null {
  if (!taken.has(base)) return base
  for (let suffix = 2; suffix <= maxAttempts; suffix += 1) {
    const candidate = `${base}-${String(suffix)}`.slice(0, SLUG_LIMITS.maxLength)
    if (!taken.has(candidate)) return candidate
  }
  return null
}

/**
 * Como identificar, para um humano, a materia que ja segurava a slug.
 *
 * O titulo vem primeiro porque e o que a redacao reconhece; o id vem junto
 * porque titulo se repete e id abre a materia direto no painel. Sem titulo
 * (rascunho recem-criado) o id sozinho ainda resolve.
 */
export function describeArticleHolder(doc: Record<string, unknown>): string {
  const id = doc.id === undefined || doc.id === null ? null : String(doc.id)
  const title = typeof doc.title === 'string' ? doc.title.trim() : ''
  if (title !== '' && id !== null) return `"${title}" (id ${id})`
  if (title !== '') return `"${title}"`
  if (id !== null) return `materia sem titulo (id ${id})`
  return 'outra materia'
}

/**
 * Colisao de slug que o sufixo nao resolveu.
 *
 * Existe como TIPO, e nao como string solta, porque o chamador precisa
 * distingui-la de qualquer outra falha para devolver o status certo — e porque
 * a mensagem tem de chegar em portugues a quem opera, dizendo QUAL slug esta
 * tomada e POR QUEM. "constraint violation" nao e informacao para a redacao.
 */
export class SlugCollisionError extends Error {
  readonly slug: string
  readonly language: string
  readonly holder: string | null

  constructor(slug: string, language: string, holder: string | null) {
    super(
      holder === null
        ? `A slug "${slug}" ja esta em uso no idioma ${language}, e as variacoes numeradas tambem. Escolha outro titulo.`
        : `A slug "${slug}" ja esta em uso no idioma ${language} pela materia ${holder}, e as variacoes numeradas tambem. Escolha outro titulo.`,
    )
    this.name = 'SlugCollisionError'
    this.slug = slug
    this.language = language
    this.holder = holder
  }
}

export type SlugChangePolicy =
  | { readonly action: 'keep'; readonly reason: string }
  | { readonly action: 'change'; readonly slug: string; readonly needsRedirect: boolean }

/**
 * A slug de uma materia JA PUBLICADA pode mudar numa atualizacao automatica?
 *
 * NAO. Mudar a URL de algo que ja esta no indice quebra links de terceiros e
 * apaga o historico de ranqueamento; e se a mudanca vier de uma automacao, ela
 * acontece sem ninguem olhando.
 *
 * A slug so muda enquanto a materia ainda nao foi publicada, ou por decisao
 * humana — que passa por outro caminho e cria redirect.
 */
export function decideSlugChange(input: {
  readonly currentSlug: string
  readonly proposedSlug: string
  readonly alreadyPublished: boolean
  readonly automated: boolean
}): SlugChangePolicy {
  if (input.currentSlug === input.proposedSlug) {
    return { action: 'keep', reason: 'slug inalterada' }
  }
  if (input.alreadyPublished && input.automated) {
    return {
      action: 'keep',
      reason: 'materia publicada: automacao nao altera identidade publica',
    }
  }
  if (!input.alreadyPublished) {
    // Ainda nao ha URL no mundo: trocar nao quebra nada e nao exige redirect.
    return { action: 'change', slug: input.proposedSlug, needsRedirect: false }
  }
  // Decisao humana sobre materia publicada: muda, mas COM redirect.
  return { action: 'change', slug: input.proposedSlug, needsRedirect: true }
}
