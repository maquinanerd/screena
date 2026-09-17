/**
 * entity-page-images.ts — A arte que a ficha de filme ou de serie EXIBE, como
 * lista de URLs absolutas.
 *
 * Uma lista, duas superficies: o `image` do JSON-LD da ficha e as `<image:image>`
 * da URL da ficha no sitemap. Se cada superficie montasse a sua, bastaria a ficha
 * ganhar ou perder uma arte para o sitemap anunciar imagem que a pagina nao
 * mostra — exatamente o que a extensao de imagem nao pode fazer.
 *
 * A LICENCA NAO MORA AQUI. `media` chega de `selectMovieMedia`/`selectSeriesMedia`,
 * que so devolvem arte autorizada por `source_licenses` (tmdb/image) ou caminho
 * local do proprio site. Esta funcao so ordena (poster, depois backdrop), resolve
 * caminho local na origem e tira repeticao.
 *
 * PURO: sem banco, rede ou relogio.
 */

import { schemaImageUrls } from "@screena/seo";

/** A arte que a ficha exibe: poster e backdrop ja autorizados, ou `null`. */
export interface EntityPageMedia {
  readonly poster: { readonly src: string } | null;
  readonly backdrop: { readonly src: string } | null;
}

/** As URLs absolutas da arte exibida: poster primeiro, sem repeticao. */
export function entityPageImageUrls(media: EntityPageMedia, siteUrl: string): string[] {
  return schemaImageUrls([media.poster?.src, media.backdrop?.src], siteUrl);
}
