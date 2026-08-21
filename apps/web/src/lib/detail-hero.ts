/**
 * detail-hero.ts — Utilitários PUROS do topo canônico das páginas de detalhe.
 *
 * A sinopse do TOPO tem três linhas na largura do canônico (56–58ch) — não é o
 * despejo inteiro da TMDB. O corte é por PALAVRA INTEIRA, com limite de
 * caracteres; o texto completo vive na seção "A OBRA", mais abaixo na página.
 */

/**
 * Orçamento de caracteres do topo: ~3 linhas de 58ch na tipografia do canônico
 * (16px/1.65). O CSS ainda aplica `line-clamp: 3` como cinto de segurança para
 * larguras menores — mas o corte DE TEXTO acontece aqui, em palavra inteira.
 */
export const HERO_SYNOPSIS_MAX_CHARS = 180;

/** Reticências tipográficas do corte. */
export const HERO_SYNOPSIS_ELLIPSIS = "…";

/**
 * Trunca em palavra inteira: nunca corta no meio de uma palavra, nunca deixa
 * pontuação órfã antes das reticências. Texto dentro do limite volta intacto.
 */
export function truncateAtWord(
  text: string,
  maxChars: number = HERO_SYNOPSIS_MAX_CHARS,
): { readonly text: string; readonly truncated: boolean } {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= maxChars) return { text: trimmed, truncated: false };

  const slice = trimmed.slice(0, maxChars + 1);
  const lastSpace = slice.lastIndexOf(" ");
  // Sem espaço no orçamento inteiro (uma "palavra" gigante): corta duro no
  // limite — caso degenerado, não texto real de sinopse.
  const head = lastSpace > 0 ? slice.slice(0, lastSpace) : trimmed.slice(0, maxChars);
  const clean = head.replace(/[\s,;:.!?…-]+$/u, "");
  return { text: `${clean}${HERO_SYNOPSIS_ELLIPSIS}`, truncated: true };
}

/**
 * O gênero do BREADCRUMB (o do meio: `Séries / Drama / Vale dos Corvos`).
 * É o primeiro da lista determinística; sem gênero, o crumb do meio não existe
 * e a trilha fica `Séries / Título`.
 */
export function breadcrumbGenre(genres: readonly string[]): string | null {
  return genres.length > 0 ? (genres[0] as string) : null;
}

/**
 * Quantos chips de gênero o topo mostra. O canônico desenha dois; mais que
 * isso disputa a linha com o meta e a classificação.
 */
export const HERO_GENRE_CHIP_COUNT = 2;

export function heroGenreChips(genres: readonly string[]): readonly string[] {
  return genres.slice(0, HERO_GENRE_CHIP_COUNT);
}
