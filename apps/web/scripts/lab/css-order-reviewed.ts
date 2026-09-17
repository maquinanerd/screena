/**
 * css-order-reviewed.ts — empates de ordem que a heuristica acusa e que foram
 * REVISADOS contra o markup.
 *
 * `orderConflictDetails` (`css-order.ts`) aproxima "as duas regras alcancam o
 * mesmo elemento" por "os seletores citam uma classe em comum". Quando a
 * aproximacao erra e nao ha regra geral segura para corrigi-la, o par entra aqui,
 * com a evidencia. A checagem estatica (`css-move-check.ts`) nao esconde o caso:
 * imprime `[REVISADO]` com o motivo, e reprova a entrada que nao corresponder mais
 * a nenhum empate (`[REVISAO SEM USO]`), para a lista nao apodrecer.
 *
 * Cada entrada vale para UM par de seletores e UMA propriedade. Se qualquer das
 * duas regras ganhar outra propriedade em disputa, o empate novo volta a reprovar
 * e pede outra revisao.
 *
 * PURO: sem IO. Testado em `tests/web/css-order.test.ts`.
 */

import type { OrderConflict } from "./css-order";

export interface ReviewedOrderPair {
  readonly selectors: readonly [string, string];
  readonly property: string;
  /** Arquivos cujo markup sustenta a revisao (caminho a partir da raiz do repo). */
  readonly sources: readonly string[];
  readonly evidence: string;
}

const ARTICLE_PAGE = "apps/web/app/pt/noticias/[slug]/page.tsx";
const HERO_WITHOUT_MEDIA_INNER = ".art-hero:not([data-hero-media='true']) .art-hero__inner";

/** Por que um filho do hero COM imagem nunca disputa com a coluna do hero SEM imagem. */
const ONE_HERO =
  "a materia renderiza um `<header class=art-hero>` so, sem aninhamento, e ele nao satisfaz " +
  "`[data-hero-media='true']` e o `:not(...)` ao mesmo tempo";

export const REVIEWED_ORDER_PAIRS: readonly ReviewedOrderPair[] = [
  {
    selectors: [".art-hero[data-hero-media='true'] .art-title", HERO_WITHOUT_MEDIA_INNER],
    property: "max-width",
    sources: [ARTICLE_PAGE],
    evidence:
      "sujeitos diferentes: `.art-hero__inner` e o <div> filho do hero e `.art-title` e o <h1> dentro de " +
      `\`.art-hero__text\`, dentro dele — nenhum elemento leva as duas classes; e ${ONE_HERO}.`,
  },
  {
    selectors: [".art-hero[data-hero-media='true'] .art-deck", HERO_WITHOUT_MEDIA_INNER],
    property: "max-width",
    sources: [ARTICLE_PAGE],
    evidence:
      "sujeitos diferentes: `.art-hero__inner` e o <div> filho do hero e `.art-deck` e o <p> da linha fina dentro " +
      `de \`.art-hero__text\`, dentro dele — nenhum elemento leva as duas classes; e ${ONE_HERO}.`,
  },
];

/** A revisao que cobre o empate, em qualquer ordem dos dois seletores; `undefined` se nenhuma. */
export function reviewedPairFor(
  conflict: OrderConflict,
  pairs: readonly ReviewedOrderPair[] = REVIEWED_ORDER_PAIRS,
): ReviewedOrderPair | undefined {
  if (conflict.movedProperty !== conflict.laterProperty) return undefined;
  return pairs.find((pair) => {
    if (pair.property !== conflict.movedProperty) return false;
    const [a, b] = pair.selectors;
    return (
      (a === conflict.movedSelector && b === conflict.laterSelector) ||
      (b === conflict.movedSelector && a === conflict.laterSelector)
    );
  });
}
