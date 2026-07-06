import type { Metadata } from "next";

import { EntityCardLink } from "../_components/entity-card";
import { NewsCard } from "../_components/news-card";
import { HeroCarousel } from "../_components/hero-carousel";
import {
  getMovieIndexData,
  getPersonIndexData,
  getSeriesIndexData,
} from "../../src/server/entity-indexes";
import { getHomeHeroSlides } from "../../src/server/home-hero";
import { getNewsIndexData } from "../../src/server/news-pages";
import {
  countPopulatedSections,
  evaluatePortalIndexability,
  HOME_ENTITY_CARD_LIMIT,
  HOME_NEWS_CARD_LIMIT,
  takeSectionCards,
} from "../../src/lib/portal-presenter";
import {
  canonicalPublicUrl,
  EXPLORE_PATH,
  HOME_PATH,
  MOVIES_INDEX_PATH,
  NEWS_INDEX_PATH,
  SERIES_INDEX_PATH,
} from "../../src/lib/site";

/**
 * Home publica pt-BR — /pt/ = `Public Marketing Home v4` (ver docs/frontend/page-map.md):
 * home editorial/cinematografica no ritmo do design v4 — NAO e catalogo generico.
 *
 * Server component puro: le somente PostgreSQL via os getters de listagem ja
 * existentes (invariantes 3/4 — zero API externa, zero Gemini, zero TMDB no
 * render). NADA e inventado: cada secao so aparece quando ha dado real; sem
 * dados, degrada para o hero institucional (fallback seguro, sem poster). Sem
 * ranking/Top 10, sem nota nos cards, sem watchlist, sem botao de feature
 * inativa, sem streaming, sem numeros fake. As estatisticas sao contagens REAIS
 * do catalogo. As imagens vem de caminhos LOCAIS (dado do TMDB ingerido offline
 * pela ingestao — nunca CDN externo no render).
 *
 * Gate anti-thin (invariante 5): com menos de 2 secoes com dado real, a home
 * existe mas recebe `noindex` (decisao de `evaluatePortalIndexability`).
 */

export const dynamic = "force-dynamic";

const HOME_TITLE = "Screen — filmes, séries, pessoas e notícias";
const HOME_DESCRIPTION =
  "Base editorial de entretenimento em português: fichas de filmes e séries, perfis de pessoas e notícias com curadoria própria da redação do Screen.";

/**
 * Preenche `count` slots visuais com itens REAIS existentes, repetindo em ciclo
 * quando ha poucos itens (ate a ingestao TMDB popular mais catalogo). Nao
 * inventa dado: cada slot e um item real (mesmo `EntityCard` reaparece). A `key`
 * do React combina href + indice do slot (o mesmo href pode repetir). Lista
 * vazia -> nenhum slot.
 */
function fillSlots<T>(items: readonly T[], count: number): T[] {
  if (items.length === 0 || count <= 0) return [];
  return Array.from({ length: count }, (_, index) => items[index % items.length] as T);
}

async function getHomeData() {
  const [movies, series, people, news] = await Promise.all([
    getMovieIndexData(),
    getSeriesIndexData(),
    getPersonIndexData(),
    getNewsIndexData(),
  ]);
  const movieCards = takeSectionCards(movies.view.cards, HOME_ENTITY_CARD_LIMIT);
  const seriesCards = takeSectionCards(series.view.cards, HOME_ENTITY_CARD_LIMIT);
  // `featured` e o primeiro card do feed em destaque na listagem de noticias;
  // na home usamos a lista unica (featured + demais), sem duplicar.
  const newsCards = takeSectionCards(
    [
      ...(news.view.featured !== null ? [news.view.featured] : []),
      ...news.view.cards,
    ],
    HOME_NEWS_CARD_LIMIT,
  );
  // Contagens REAIS do catalogo publico (itens com slug canonico pt-BR), para a
  // faixa de estatisticas honesta — nunca watchlist/assistidos/avaliacoes.
  const counts = {
    movies: movies.view.totalCount,
    series: series.view.totalCount,
    people: people.view.totalCount,
  };
  const indexability = evaluatePortalIndexability({
    populatedSectionCount: countPopulatedSections([
      movieCards.length,
      seriesCards.length,
      newsCards.length,
    ]),
  });
  return { movieCards, seriesCards, newsCards, counts, indexability };
}

export async function generateMetadata(): Promise<Metadata> {
  const { indexability } = await getHomeData();
  const shouldIndex = indexability.decision === "index";
  return {
    title: { absolute: HOME_TITLE },
    description: HOME_DESCRIPTION,
    robots: shouldIndex
      ? { index: true, follow: true }
      : { index: false, follow: false },
    alternates: { canonical: canonicalPublicUrl(HOME_PATH) },
  };
}

export default async function HomePage() {
  const [{ movieCards, seriesCards, newsCards, counts }, heroSlides] =
    await Promise.all([getHomeData(), getHomeHeroSlides()]);

  // Faixa amarela honesta: um título REAL em destaque (primeiro slide do hero).
  // Sem claim de "novo episódio"/streaming fake — só um atalho para a ficha.
  const spotlight = heroSlides[0] ?? null;
  const hasCounts = counts.movies > 0 || counts.series > 0 || counts.people > 0;

  // Seção principal densa "Destaques no The Screen": mistura filmes+séries reais
  // (intercalados p/ variedade). No ritmo do Top 10 do v4, mas SEM ranking, SEM
  // nota, SEM Avaliar/Marcar — só título/tipo/ano reais e link para a ficha.
  const highlights: typeof movieCards = [];
  const maxLen = Math.max(movieCards.length, seriesCards.length);
  for (let i = 0; i < maxLen; i += 1) {
    const movie = movieCards[i];
    if (movie) highlights.push(movie);
    const series = seriesCards[i];
    if (series) highlights.push(series);
  }
  const featuredCards = highlights.slice(0, 10);

  return (
    <main className="portal-page" data-vertical="home">
      {/* Hero-carousel (design v4): slides reais, metadados completos, sem poster
          lateral, botões só "Onde assistir" + "Ver ficha". Sem slides reais, cai
          para o hero institucional (copy própria, também sem poster). */}
      {heroSlides.length > 0 ? (
        <HeroCarousel slides={heroSlides} />
      ) : (
        <section className="sc-hero sc-hero--institutional">
          <div className="sc-hero__wash sc-hero__wash--neutral" aria-hidden="true" />
          <div className="sc-hero__scrim" aria-hidden="true" />
          <div className="sc-hero__inner">
            <div className="sc-hero__lead">
              <span className="sc-hero__eyebrow" data-vertical="neutral">
                The Screen
              </span>
              <h1 className="sc-hero__title sc-hero__title--sm">
                Filmes, séries, pessoas e notícias — em um só lugar.
              </h1>
              <p className="sc-hero__desc">{HOME_DESCRIPTION}</p>
            </div>
          </div>
        </section>
      )}

      {/* Faixa amarela (ritmo v4) — destaque editorial honesto, sem feature fake. */}
      {spotlight !== null ? (
        <div className="home-ticker">
          <div className="container home-ticker__inner">
            <div className="home-ticker__lead">
              <span className="home-ticker__badge">Destaque</span>
              <span className="home-ticker__text">{spotlight.title}</span>
            </div>
            <a className="home-ticker__cta" href={spotlight.href}>
              Ver ficha
            </a>
          </div>
        </div>
      ) : null}

      {/* Seção principal densa: Destaques no The Screen (filmes+séries reais,
          intercalados). Ritmo do Top 10 do v4, sem ranking/nota/Avaliar. */}
      {featuredCards.length > 0 ? (
        <div className="container">
          <section className="portal-section portal-section--lead" aria-labelledby="home-featured-title">
            <div className="portal-section__head">
              <h2 id="home-featured-title" className="portal-section__title">
                Destaques no The Screen
              </h2>
              <a className="portal-section__more" href={EXPLORE_PATH}>
                Ver tudo
              </a>
            </div>
            {/* Estrutura v4: fileira de 4 cartazes GRANDES + fileira secundária
                em GRID de 6 colunas. Slots preenchidos com itens reais (repetidos
                em ciclo quando ha poucos) — nunca card órfão nem buraco. */}
            <ul className="home-feat__big">
              {fillSlots(featuredCards, 4).map((card, index) => (
                <li key={`${card.href}-${index}`} className="entity-card-item">
                  <EntityCardLink card={card} />
                </li>
              ))}
            </ul>
            <ul className="entity-grid home-feat__small">
              {fillSlots(featuredCards, 6).map((card, index) => (
                <li key={`${card.href}-${index}`} className="entity-card-item">
                  <EntityCardLink card={card} />
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}

      {/* Filmes em destaque — banda quente v4 (cards reais com pôster local). */}
      {movieCards.length > 0 ? (
        <section className="portal-section--warm">
          <div className="container">
            <section className="portal-section" aria-labelledby="home-movies-title">
              <div className="portal-section__head">
                <h2 id="home-movies-title" className="portal-section__title" data-vertical="movie">
                  Filmes em destaque
                </h2>
                <a className="portal-section__more" href={MOVIES_INDEX_PATH}>
                  Ver todos os filmes
                </a>
              </div>
              <ul className="entity-grid">
                {fillSlots(movieCards, 6).map((card, index) => (
                  <li key={`${card.href}-${index}`} className="entity-card-item">
                    <EntityCardLink card={card} />
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </section>
      ) : null}

      {/* Faixa preta de estatísticas — contagens REAIS do catálogo (sem watchlist). */}
      {hasCounts ? (
        <section className="home-stats" aria-label="Catálogo do Screen">
          <div className="container home-stats__inner">
            <span className="home-stats__label">No catálogo do Screen</span>
            <span className="home-stats__item">
              <b>{counts.movies}</b> filmes
            </span>
            <span className="home-stats__item">
              <b>{counts.series}</b> séries
            </span>
            <span className="home-stats__item">
              <b>{counts.people}</b> pessoas
            </span>
          </div>
        </section>
      ) : null}

      <div className="container">
        {seriesCards.length > 0 ? (
          <section className="portal-section" aria-labelledby="home-series-title">
            <div className="portal-section__head">
              <h2 id="home-series-title" className="portal-section__title" data-vertical="series">
                Séries em destaque
              </h2>
              <a className="portal-section__more" href={SERIES_INDEX_PATH}>
                Ver todas as séries
              </a>
            </div>
            <ul className="entity-grid">
              {fillSlots(seriesCards, 6).map((card, index) => (
                <li key={`${card.href}-${index}`} className="entity-card-item">
                  <EntityCardLink card={card} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {newsCards.length > 0 ? (
          <section className="portal-section" aria-labelledby="home-news-title">
            <div className="portal-section__head">
              <h2 id="home-news-title" className="portal-section__title">
                Notícias
              </h2>
              <a className="portal-section__more" href={NEWS_INDEX_PATH}>
                Ver todas as notícias
              </a>
            </div>
            <ul className="news-grid">
              {newsCards.map((card) => (
                <li key={card.href} className="news-grid__item">
                  <NewsCard card={card} variant="feed" />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <p className="portal-explore-note">
          Quer navegar por tudo? <a href={EXPLORE_PATH}>Explore filmes, séries, pessoas e notícias</a>.
        </p>
      </div>
    </main>
  );
}
