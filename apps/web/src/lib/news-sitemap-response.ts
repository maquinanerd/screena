/**
 * news-sitemap-response.ts — que resposta HTTP o `/news-sitemap.xml` dá em cada
 * desfecho. PURO.
 *
 * ============================================================================
 * POR QUE ISTO EXISTE
 * ============================================================================
 * O formato não tem estado vazio. O XSD do protocolo exige pelo menos uma
 * `<url>` dentro de `<urlset>`, então "nenhuma matéria agora" não cabe no XML —
 * e a rota servia um `<urlset>` sem filho, que o Search Console reprovou em
 * 29/09/2026 ("Tag XML ausente — Linha 4, tag pai: urlset, tag: url").
 *
 * Quem tem como dizer isso é a resposta HTTP, e ela distingue duas coisas que o
 * arquivo vazio confundia num único corpo:
 *
 *   - **não há o que anunciar** (redação parada, ambiente que não indexa) → 404;
 *   - **não dá para saber** (banco fora) → 503, que preserva o estado anterior
 *     no buscador em vez de afirmar zero matéria.
 *
 * Esse segundo caso era o mais caro: o código já dizia que "as ausências parecem
 * despublicação", e mesmo assim respondia 200 com lista vazia numa queda de
 * banco. 503 é a mesma recusa, dita onde o crawler a entende.
 *
 * O 404 segue o precedente do `/llms.txt`, que já some no ambiente que não
 * indexa em vez de se apresentar vazio.
 */

import { sitemapCacheControl } from "./sitemap-cache-control";

/** O que a montagem do sitemap de notícias apurou. */
export type NewsSitemapOutcome =
  /** Há matéria na janela: o XML tem ao menos uma `<url>`. */
  | { readonly kind: "urlset"; readonly xml: string; readonly contentType: string }
  /** Não há o que anunciar agora — e isso não é falha. */
  | { readonly kind: "no-entries" }
  /** Não foi possível apurar (banco indisponível). */
  | { readonly kind: "unavailable" };

export interface NewsSitemapResponseInit {
  readonly status: number;
  readonly body: string;
  readonly headers: Record<string, string>;
}

const TEXT = "text/plain; charset=utf-8";

/** Converte o desfecho em status, corpo e cabeçalhos. Total: cobre os três. */
export function newsSitemapResponse(outcome: NewsSitemapOutcome): NewsSitemapResponseInit {
  switch (outcome.kind) {
    case "urlset":
      return {
        status: 200,
        body: outcome.xml,
        headers: {
          "content-type": outcome.contentType,
          "cache-control": sitemapCacheControl("news", false),
        },
      };
    case "no-entries":
      // Cacheável pela MESMA janela curta do sitemap cheio: a primeira matéria
      // publicada precisa aparecer em minutos, não no dia seguinte.
      return {
        status: 404,
        body: "Nenhuma matéria nas últimas 48 horas.\n",
        headers: {
          "content-type": TEXT,
          "cache-control": sitemapCacheControl("news", false),
        },
      };
    case "unavailable":
      // `no-store` vem do mesmo lugar do fail-closed: a resposta de uma falha
      // nunca fica guardada na borda.
      return {
        status: 503,
        body: "Sitemap de notícias indisponível no momento.\n",
        headers: {
          "content-type": TEXT,
          "cache-control": sitemapCacheControl("news", true),
          "retry-after": "300",
        },
      };
  }
}
