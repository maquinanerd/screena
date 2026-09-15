/**
 * title-routes.ts — As URLs do painel para titulos. PURO.
 *
 * O segmento da URL diz o tipo POR EXTENSO ("filme" / "serie"), como o site
 * publico: a diferenca filme/serie nunca depende so de cor, nem aqui.
 */

/** Os tipos de titulo que o painel diagnostica. */
export type TitleKind = "movie" | "tv";

const KIND_BY_SEGMENT: Readonly<Record<string, TitleKind>> = { filme: "movie", serie: "tv" };

/** O segmento de URL de cada tipo. */
export const SEGMENT_BY_KIND: Readonly<Record<TitleKind, "filme" | "serie">> = { movie: "filme", tv: "serie" };

/** O rotulo de cada tipo. */
export const KIND_LABEL: Readonly<Record<TitleKind, string>> = { movie: "Filme", tv: "Série" };

/** `filme`/`serie` -> tipo. Qualquer outra coisa -> `null`. */
export function parseTitleSegment(segment: string): TitleKind | null {
  return KIND_BY_SEGMENT[segment] ?? null;
}

const ENTITY_ID = /^[1-9]\d{0,18}$/;

/** Id interno (BIGINT) valido, como texto. */
export function parseEntityId(raw: string): string | null {
  return ENTITY_ID.test(raw) ? raw : null;
}

/** A ficha do titulo no painel. */
export function titlePath(kind: TitleKind, id: string): string {
  return `/titulos/${SEGMENT_BY_KIND[kind]}/${id}`;
}

/** A tela de confirmacao de uma acao. */
export function forceTitlePath(kind: TitleKind, id: string, action: string): string {
  return `${titlePath(kind, id)}/forcar/${action}`;
}

/** A URL publica canonica (pt-BR) de um titulo com slug. */
export function publicTitleUrl(kind: TitleKind, slug: string): string {
  return `https://cinerie.com/pt/${kind === "movie" ? "filmes" : "series"}/${slug}/`;
}

/** Um nonce de 24 hex para o formulario de confirmacao. */
export function isRequestToken(value: string): boolean {
  return /^[0-9a-f]{24}$/.test(value);
}
