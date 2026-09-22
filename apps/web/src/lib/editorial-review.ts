/**
 * editorial-review.ts — quando a página pode dizer "em revisão editorial".
 *
 * O DEFEITO MEDIDO (22/09/2026). As fichas de filme, série e pessoa diziam
 * "Esta página ainda está em revisão editorial." sempre que a página não estava
 * `index`. Em produção, a página do Josh Brolin e a ficha `tmdb-1465816` diziam
 * isso, e as duas estavam fora do índice por PORTÃO DE QUALIDADE (D2 e D3).
 * Ninguém as revisava: a frase era falsa em dezenas de milhares de páginas.
 *
 * A REGRA. A frase só aparece quando a página está de fato ESPERANDO uma
 * decisão:
 *
 *   - `entity-not-published`: a entidade ainda não foi publicada;
 *   - `absent-decision-armed`: ainda não há decisão vigente para ela;
 *   - `stale-invalidation`: foi invalidada e espera ser revalidada.
 *
 * Nunca por portão de qualidade (a página está completa e não tem o conteúdo
 * que a sustentaria no índice), caso técnico, idioma, licença, decisão já
 * registrada ou pela válvula de emergência. Nenhum desses é uma revisão em
 * andamento, e dizer que é engana o leitor.
 *
 * PURO: sem rede, sem banco.
 */

import type { DecisionSource, PageSeoResolution } from "@screena/seo";

/** Fontes de decisão que significam "a página espera uma decisão". */
const REVIEW_PENDING_SOURCES: ReadonlySet<DecisionSource> = new Set<DecisionSource>([
  "entity-not-published",
  "absent-decision-armed",
  "stale-invalidation",
]);

/** A página está fora do índice porque espera uma decisão ainda não tomada? */
export function isEditorialReviewPending(
  seo: Pick<PageSeoResolution, "decision" | "decisionSource">,
): boolean {
  if (seo.decision === "index") return false;
  return REVIEW_PENDING_SOURCES.has(seo.decisionSource);
}
