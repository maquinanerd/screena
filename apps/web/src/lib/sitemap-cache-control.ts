/**
 * sitemap-cache-control.ts — o `Cache-Control` dos sitemaps. PURO.
 *
 * O DEFEITO (auditoria de SEO de 11/09/2026, achado M2): os sitemaps saiam sem
 * cabecalho de cache nenhum, a borda respondia `DYNAMIC`, e cada leitura refazia
 * as agregacoes de todos os tipos — de 11,8 s (indice) a 19,6 s (shard) por
 * arquivo, a cada visita de crawler.
 *
 * `s-maxage` CURTO, e nao de horas: o sitemap segue a decisao de indexabilidade e
 * o kill switch de indexacao, e uma copia velha na borda atrasaria os dois.
 * `stale-while-revalidate` deixa a borda entregar a copia anterior enquanto busca
 * a nova, em vez de fazer o crawler esperar a agregacao. `max-age=0`: o navegador
 * sempre revalida.
 *
 * O FAIL-CLOSED NAO E GUARDADO. O indice vazio de uma falha de banco e a resposta
 * honesta daquele instante, nao do quarto de hora seguinte — guarda-lo na borda
 * prolongaria a queda muito alem dela.
 *
 * Se a borda vai honrar o cabecalho depende da regra de cache dela, e isso e
 * infraestrutura: ver `docs/seo/SEO-INFRA-CHANGES-2026-09-11.md`.
 */

/** Indice e shards: mudam quando o catalogo ou uma decisao mudam. */
export const SITEMAP_CACHE_CONTROL = "public, max-age=0, s-maxage=900, stale-while-revalidate=3600";

/** Google News: janela de 48 h que muda a cada materia publicada. */
export const NEWS_SITEMAP_CACHE_CONTROL = "public, max-age=0, s-maxage=300, stale-while-revalidate=600";

/** A resposta de uma falha nunca fica na borda. */
export const DEGRADED_SITEMAP_CACHE_CONTROL = "no-store";

export type SitemapKind = "sitemap" | "news";

/** O `Cache-Control` de uma resposta de sitemap: falha nunca e guardada. */
export function sitemapCacheControl(kind: SitemapKind, degraded: boolean | undefined): string {
  if (degraded === true) return DEGRADED_SITEMAP_CACHE_CONTROL;
  return kind === "news" ? NEWS_SITEMAP_CACHE_CONTROL : SITEMAP_CACHE_CONTROL;
}
