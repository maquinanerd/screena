/**
 * social-metadata.ts — Open Graph e cartao do X das paginas que NAO sao materia.
 * PURO: sem rede, banco, relogio ou `next`.
 *
 * O DEFEITO QUE ISTO CORRIGE (auditoria de SEO de 11/09/2026, secao 3.3): 25 das
 * 29 paginas 200 amostradas saiam sem `og:image` e sem `twitter:image`, com
 * `twitter:card=summary`; home, listagens, filmes, series e pessoas tambem sem
 * `og:url`. As fichas declaravam `og:type=website`, e galeria, temporada e
 * episodio perdiam `og:locale`. So a materia tinha cartao completo — pelo gemeo
 * deste modulo, `article-technical-seo.ts`.
 *
 * POR QUE `og:locale` SUMIA: no Next, o `openGraph` de uma pagina SUBSTITUI o do
 * layout, nao se mistura com ele. A pagina que declarava so titulo e URL apagava
 * `siteName` e `locale` sem sintoma nenhum na tela. Por isso o objeto daqui sai
 * sempre completo.
 *
 * A IMAGEM (decisao do dono D4, `docs/seo/DECISOES-DO-DONO-2026-09-11.md`): a
 * MESMA arte que a pagina ja exibe, sob a mesma licenca — o cartao nao cria uso
 * novo. As candidatas chegam em ordem (arte da entidade -> imagem editorial ->
 * marca) e a primeira utilizavel vence. Nunca uma imagem inventada.
 */

/** O `og:type` de cada superficie. A materia usa `article`, no gemeo. */
export type SocialPageType =
  | "website"
  | "video.movie"
  | "video.tv_show"
  | "video.episode"
  | "profile";

/**
 * O formato da arte, e ele decide o cartao do X: `summary_large_image` recorta a
 * imagem em 2:1. Serve a backdrop, still e ao cartao da marca; num poster ou num
 * retrato, cortaria o titulo ou a cabeca — esses vao no cartao pequeno.
 */
export type SocialImageShape = "landscape" | "portrait";

export interface SocialImage {
  /** URL ABSOLUTA: robo de rede social nao resolve caminho relativo. */
  readonly url: string;
  readonly alt: string;
  readonly shape: SocialImageShape;
  /**
   * Dimensoes so quando conhecidas EXATAMENTE (arquivo proprio). A arte do TMDB
   * as omite: o tamanho pedido fixa a largura, e a altura depende do original.
   */
  readonly width?: number;
  readonly height?: number;
}

export interface SocialPageFacts<T extends SocialPageType = SocialPageType> {
  readonly type: T;
  readonly title: string;
  readonly description: string | null;
  /** A canonical da pagina; `null` quando ela nao tem uma — entao sem `og:url`. */
  readonly canonicalUrl: string | null;
  readonly siteName: string;
  /** Idioma BCP-47 da pagina (`pt-BR`). */
  readonly language: string;
  /** Candidatas na ordem da D4. `null` = a pagina nao tem aquela arte. */
  readonly images: readonly (SocialImage | null)[];
}

export interface SocialOpenGraphImage {
  url: string;
  alt: string;
  width?: number;
  height?: number;
}

/** Open Graph no formato que `Metadata.openGraph` do Next aceita. */
export interface SocialOpenGraph<T extends SocialPageType = SocialPageType> {
  type: T;
  title: string;
  description?: string;
  url?: string;
  siteName: string;
  locale: string;
  images?: SocialOpenGraphImage[];
}

/** Cartao do X no formato que `Metadata.twitter` do Next aceita. */
export interface SocialTwitterCard {
  card: "summary_large_image" | "summary";
  title: string;
  description?: string;
  images?: string[];
}

/**
 * `pt-BR` -> `pt_BR`. O Open Graph usa SUBLINHADO; o `lang` do HTML e o
 * `inLanguage` do JSON-LD usam hifen. Uma string servindo as duas especificacoes
 * foi o `og:locale` invalido que a auditoria achou nas materias.
 */
export function toOpenGraphLocale(language: string): string {
  return language.trim().replace("-", "_");
}

const ABSOLUTE_URL = /^https?:\/\//i;

/**
 * A primeira candidata utilizavel, na ordem recebida. Caminho relativo NAO e
 * utilizavel: o robo do WhatsApp ou do Facebook nao conhece a origem da pagina
 * que o citou, e a candidata seguinte (no fim, a marca) assume.
 */
export function pickSocialImage(
  candidates: readonly (SocialImage | null)[],
): SocialImage | null {
  for (const candidate of candidates) {
    if (candidate !== null && ABSOLUTE_URL.test(candidate.url.trim())) return candidate;
  }
  return null;
}

function trimmedOrNull(value: string | null): string | null {
  const text = (value ?? "").trim();
  return text === "" ? null : text;
}

export function buildSocialOpenGraph<T extends SocialPageType>(
  facts: SocialPageFacts<T>,
): SocialOpenGraph<T> {
  const description = trimmedOrNull(facts.description);
  const canonical = trimmedOrNull(facts.canonicalUrl);
  const image = pickSocialImage(facts.images);
  return {
    type: facts.type,
    title: facts.title,
    ...(description === null ? {} : { description }),
    // `og:url` e a canonical, sempre: cartao e canonical apontando para URLs
    // diferentes dividem o sinal social entre duas paginas.
    ...(canonical === null ? {} : { url: canonical }),
    siteName: facts.siteName,
    locale: toOpenGraphLocale(facts.language),
    ...(image === null
      ? {}
      : {
          images: [
            {
              url: image.url,
              // `alt` vazio numa imagem de conteudo e falha de acessibilidade, nao
              // decisao decorativa: cai no titulo da pagina.
              alt: image.alt.trim() === "" ? facts.title : image.alt,
              ...(image.width === undefined || image.height === undefined
                ? {}
                : { width: image.width, height: image.height }),
            },
          ],
        }),
  };
}

export function buildSocialTwitter(facts: SocialPageFacts): SocialTwitterCard {
  const description = trimmedOrNull(facts.description);
  const image = pickSocialImage(facts.images);
  return {
    card: image !== null && image.shape === "landscape" ? "summary_large_image" : "summary",
    title: facts.title,
    ...(description === null ? {} : { description }),
    ...(image === null ? {} : { images: [image.url] }),
  };
}
