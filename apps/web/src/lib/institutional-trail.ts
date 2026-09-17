/**
 * institutional-trail.ts — a trilha das paginas institucionais. PURO.
 *
 * A trilha VISIVEL (`app/_components/institutional-page.tsx`) e o `BreadcrumbList`
 * do JSON-LD saem da MESMA lista de degraus. Escritas em dois lugares, as duas
 * divergem no primeiro degrau renomeado — e o JSON-LD passa a descrever uma
 * trilha que a pagina nao mostra.
 */

import { HOME_PATH } from "./routes";

/** Um degrau depois de "Início". */
export interface TrailStep {
  readonly label: string;
  /** `null` no ultimo degrau: e a pagina atual. */
  readonly href: string | null;
}

/** O primeiro degrau de toda trilha. */
export const HOME_TRAIL_LABEL = "Início";

/**
 * O `BreadcrumbList` da trilha.
 *
 * Degrau com `href` aponta para a URL absoluta dele; o ultimo (sem `href`) aponta
 * para a canonical da pagina. Sem canonical, o ultimo degrau sai sem `item` — um
 * endereco inventado seria pior que nenhum.
 */
export function trailBreadcrumbJsonLd(
  trail: readonly TrailStep[],
  siteUrl: string,
  currentUrl: string | null,
): Record<string, unknown> {
  const origin = siteUrl.trim().replace(/\/+$/, "");
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: HOME_TRAIL_LABEL, item: `${origin}${HOME_PATH}` },
      ...trail.map((step, index) => {
        const item = step.href !== null ? `${origin}${step.href}` : currentUrl;
        return {
          "@type": "ListItem",
          position: index + 2,
          name: step.label,
          ...(item === null ? {} : { item }),
        };
      }),
    ],
  };
}
