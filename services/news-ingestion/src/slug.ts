/**
 * slug.ts — Slug de artigo e plano de redirect. PURO.
 *
 * Reusa a MESMA tabela `redirects` do catalogo (nao existe segundo sistema de
 * redirect): `apps/web` ja resolve a cadeia persistida via
 * `src/server/seo/redirect-lookup.ts`, entao gravar a linha basta para servir
 * o 301.
 *
 * Artigos deliberadamente NAO usam a tabela `slugs` (que e de entidades de
 * catalogo, com FK composta para `entities`); o slug do artigo vive em
 * `article_translations.slug`, unico por idioma. Isso ja estava decidido no
 * schema — aqui so acrescentamos estabilidade e redirect.
 */

const ARTICLE_PATH_PREFIX = '/pt/noticias/'

/** Comprimento maximo do slug gerado (limite pratico de URL legivel). */
export const MAX_ARTICLE_SLUG_LENGTH = 90

/**
 * Gera o slug a partir do titulo: NFD, sem acento, minusculo, so `[a-z0-9-]`,
 * hifens colapsados e aparados, truncado sem deixar hifen na borda.
 *
 * Determinista e idempotente: `slugifyArticleTitle(slugifyArticleTitle(x))`
 * e igual a `slugifyArticleTitle(x)`.
 */
export function slugifyArticleTitle(title: string): string {
  const base = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (base.length <= MAX_ARTICLE_SLUG_LENGTH) return base
  return base.slice(0, MAX_ARTICLE_SLUG_LENGTH).replace(/-+$/, '')
}

/**
 * Resolve colisao de slug de forma determinista, sufixando `-2`, `-3`, ...
 * `taken` traz os slugs JA usados no mesmo idioma.
 */
export function resolveArticleSlugCollision(
  base: string,
  taken: ReadonlySet<string>,
): string {
  if (base === '') return ''
  if (!taken.has(base)) return base
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base}-${taken.size + 1}`
}

/** Caminho publico canonico de um artigo pt-BR. */
export function articlePath(slug: string): string {
  return `${ARTICLE_PATH_PREFIX}${slug}/`
}

export interface SlugChangePlan {
  /** O slug deve mudar? */
  readonly changed: boolean
  readonly nextSlug: string
  /** Redirect a gravar em `redirects`, ou `null` quando nada muda. */
  readonly redirect: { readonly fromPath: string; readonly toPath: string; readonly statusCode: 301 } | null
  readonly reason: string
}

/**
 * Planeja a mudanca de slug de um artigo.
 *
 * Duas regras que evitam estrago:
 *
 *  - Artigo JA PUBLICADO nao troca de slug por mudanca de titulo. Trocar a URL
 *    de uma materia no ar quebra links externos e zera o historico da pagina;
 *    a troca so acontece quando pedida DELIBERADAMENTE (`requestedSlug`).
 *  - Nenhum redirect e gravado quando nada mudou. Um redirect de A para A e um
 *    loop, e a tabela e lida em cadeia pelo runtime.
 */
export function planArticleSlugChange(input: {
  readonly currentSlug: string
  readonly title: string
  readonly isPublished: boolean
  /** Slug pedido explicitamente por um editor (troca deliberada). */
  readonly requestedSlug?: string | null
  readonly taken?: ReadonlySet<string>
}): SlugChangePlan {
  const taken = input.taken ?? new Set<string>()
  const requested = (input.requestedSlug ?? '').trim()

  const desiredRaw = requested !== ''
    ? slugifyArticleTitle(requested)
    : input.isPublished
      ? input.currentSlug // publicado: titulo nao arrasta o slug
      : slugifyArticleTitle(input.title)

  if (desiredRaw === '' || desiredRaw === input.currentSlug) {
    return {
      changed: false,
      nextSlug: input.currentSlug,
      redirect: null,
      reason:
        desiredRaw === ''
          ? 'slug derivado vazio; mantem o atual'
          : 'slug inalterado; nenhum redirect gravado',
    }
  }

  // A colisao e checada contra os slugs em uso, excluindo o proprio atual.
  const others = new Set([...taken].filter((slug) => slug !== input.currentSlug))
  const nextSlug = resolveArticleSlugCollision(desiredRaw, others)

  if (nextSlug === input.currentSlug) {
    return {
      changed: false,
      nextSlug: input.currentSlug,
      redirect: null,
      reason: 'colisao resolveu para o slug atual; nenhum redirect gravado',
    }
  }

  return {
    changed: true,
    nextSlug,
    // So artigo publicado gera redirect: um rascunho nunca teve URL publica,
    // entao criar redirect para ele encheria a tabela de linhas mortas.
    redirect: input.isPublished
      ? {
          fromPath: articlePath(input.currentSlug),
          toPath: articlePath(nextSlug),
          statusCode: 301,
        }
      : null,
    reason: input.isPublished
      ? 'slug publicado alterado deliberadamente; redirect 301 gravado'
      : 'slug de rascunho ajustado; sem redirect (nunca foi publico)',
  }
}
