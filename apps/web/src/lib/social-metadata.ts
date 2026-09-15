/**
 * social-metadata.ts — a ponte entre as paginas e `@screena/seo` para o cartao
 * social (Open Graph + X).
 *
 * Toda pagina publica monta o cartao por aqui, e o motivo e o layout: no Next, o
 * `openGraph` de uma pagina SUBSTITUI o do layout inteiro. A pagina que montava o
 * proprio objeto so com titulo e URL apagava `siteName`, `locale` e a imagem — foi
 * assim que galeria, temporada e episodio perderam `og:locale` (auditoria de SEO
 * de 11/09/2026). Aqui o objeto sai completo, e a marca entra sozinha como ULTIMA
 * candidata de imagem (decisao do dono D4).
 *
 * A decisao de COMO o cartao se monta mora em `@screena/seo`
 * (`social-metadata.ts`, puro e testado); isto so fornece o que e do site: nome,
 * idioma, origem e o arquivo da marca.
 */

import {
  buildSocialOpenGraph,
  buildSocialTwitter,
  type SocialImage,
  type SocialOpenGraph,
  type SocialPageType,
  type SocialTwitterCard,
} from "@screena/seo";

import { CINERIE_SOCIAL_CARD } from "./brand-logos";
import { SITE_URL } from "./site";

export const SOCIAL_SITE_NAME = "Cinerie";

/** O idioma de publicacao do MVP (invariante 7). */
export const SOCIAL_LANGUAGE = "pt-BR";

/** Caminho servido pelo proprio site -> URL absoluta; URL absoluta passa intacta. */
export function absoluteAssetUrl(src: string, siteUrl: string = SITE_URL): string {
  if (/^https?:\/\//i.test(src)) return src;
  return `${siteUrl.replace(/\/+$/, "")}/${src.replace(/^\/+/, "")}`;
}

/** O cartao da marca — a ultima candidata de toda pagina. */
export function brandSocialImage(siteUrl: string = SITE_URL): SocialImage {
  return {
    url: absoluteAssetUrl(CINERIE_SOCIAL_CARD.src, siteUrl),
    alt: SOCIAL_SITE_NAME,
    shape: "landscape",
    width: CINERIE_SOCIAL_CARD.width,
    height: CINERIE_SOCIAL_CARD.height,
  };
}

/**
 * A arte que a pagina JA exibe, como candidata. `null` entra e `null` sai: a
 * ausencia nao e preenchida aqui, e sim pela candidata seguinte.
 */
export function socialArt(
  asset: { readonly src: string } | null,
  alt: string,
  shape: SocialImage["shape"],
): SocialImage | null {
  if (asset === null) return null;
  return { url: absoluteAssetUrl(asset.src), alt, shape };
}

export interface SocialMetadataInput<T extends SocialPageType> {
  readonly type: T;
  readonly title: string;
  readonly description: string | null;
  readonly canonicalUrl: string | null;
  /** A arte da propria pagina, em ordem de preferencia. A marca entra sozinha no fim. */
  readonly images?: readonly (SocialImage | null)[];
}

export function socialMetadata<T extends SocialPageType>(
  input: SocialMetadataInput<T>,
): { openGraph: SocialOpenGraph<T>; twitter: SocialTwitterCard } {
  const facts = {
    type: input.type,
    title: input.title,
    description: input.description,
    canonicalUrl: input.canonicalUrl,
    siteName: SOCIAL_SITE_NAME,
    language: SOCIAL_LANGUAGE,
    images: [...(input.images ?? []), brandSocialImage()],
  };
  return { openGraph: buildSocialOpenGraph(facts), twitter: buildSocialTwitter(facts) };
}
