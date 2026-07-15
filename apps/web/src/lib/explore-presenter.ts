/**
 * explore-presenter.ts — Decisao PURA e UNICA de indexabilidade do hub
 * `/pt/explorar/`.
 *
 * Prompt 3 (§3): antes desta fase a PAGINA decidia o robots a partir apenas dos
 * "lancamentos da semana" (`upcomingMovies.length`), enquanto o SITEMAP decidia
 * a inclusao do explorar a partir do catalogo amplo (filmes/series/pessoas/
 * noticias). Duas decisoes divergentes para a MESMA URL.
 *
 * Correcao: uma unica funcao governa os dois lados. O explorar e um HUB de
 * descoberta; ele indexa quando ha conteudo real de catalogo para descobrir
 * (>= 1 secao populada entre filmes/series/pessoas/noticias). A agenda semanal
 * e uma subsecao volatil e NAO deve, sozinha, tirar o hub do indice — por isso
 * a decisao passa a se basear no catalogo, identica em pagina e sitemap.
 *
 * PURO: sem rede/DB/IO. O snapshot de contagens vem do PostgreSQL na camada
 * server-only e alimenta os dois consumidores com os MESMOS numeros.
 */

import {
  countPopulatedSections,
  evaluatePortalIndexability,
  type IndexabilityResult,
} from "./portal-presenter";

/**
 * Contagens de catalogo que governam a indexabilidade do explorar. Sao as
 * MESMAS contagens usadas pelo sitemap (itens validos: slug canonico + titulo,
 * e noticia publicavel), garantindo que pagina e sitemap concordem por
 * construcao.
 */
export interface ExploreSectionFacts {
  movieCount: number;
  seriesCount: number;
  peopleCount: number;
  newsCount: number;
}

/**
 * Decide a indexabilidade do hub explorar a partir do catalogo. Reusa o
 * avaliador canonico de portal (indexacao total: >= 1 secao real -> index;
 * vazio -> noindex tecnico).
 */
export function evaluateExploreIndexability(
  facts: ExploreSectionFacts,
): IndexabilityResult {
  const populatedSectionCount = countPopulatedSections([
    facts.movieCount,
    facts.seriesCount,
    facts.peopleCount,
    facts.newsCount,
  ]);
  return evaluatePortalIndexability({ populatedSectionCount });
}
