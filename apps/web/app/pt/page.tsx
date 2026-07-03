import type { Metadata } from "next";

import { HomeV4Hero, HomeV4Ticker } from "../_components/home-v4-hero";
import {
  HomeV4ComingRail,
  HomeV4PlatformTabs,
  HomeV4PosterRail,
  HomeV4RankRail,
  type RankItem,
} from "../_components/home-v4-rails";
import { HomeV4NewsMagazine, HomeV4StatsBand, type HomeStat } from "../_components/home-v4-blocks";
import {
  getMovieIndexData,
  getPersonIndexData,
  getSeriesIndexData,
} from "../../src/server/entity-indexes";
import { getNewsIndexData } from "../../src/server/news-pages";
import type { EntityCard } from "../../src/lib/entity-index-presenter";
import {
  countPopulatedSections,
  evaluatePortalIndexability,
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
 * Home publica pt-BR — /pt/. Estrutura visual portada com fidelidade da tela
 * canonica do Claude Design `Screen Screens v4.dc.html` (bloco HOME): hero
 * cinematografico escuro + faixa de destaque + Top 10 + Filmes em alta + faixa
 * de metricas + Series da semana + Em breve + Noticias (magazine) + footer.
 *
 * Server component puro (invariantes 3/4): le SO PostgreSQL pelos getters de
 * listagem ja existentes; zero API externa, zero Gemini, zero TMDB no render.
 * NADA e inventado: sem nota/estrela fake, sem disponibilidade fake, sem numero
 * alto fabricado. As secoes so aparecem quando ha dado real (com estado vazio
 * consistente na de noticias); os mesmos titulos reais podem aparecer em secoes
 * diferentes quando o catalogo e pequeno. Gate anti-thin (invariante 5): com
 * menos de 2 secoes com dado real, a home existe mas recebe `noindex`.
 */

export const dynamic = "force-dynamic";

const HOME_TITLE = "Screen — filmes, séries, pessoas e notícias";
const HOME_DESCRIPTION =
  "Base editorial de entretenimento em português: fichas de filmes e séries, perfis de pessoas e notícias com curadoria própria da redação do Screen.";

/** Intercala dois conjuntos preservando a ordem de cada um (sem inventar). */
function interleave(a: readonly EntityCard[], b: readonly EntityCard[]): EntityCard[] {
  const out: EntityCard[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i += 1) {
    if (i < a.length) out.push(a[i]!);
    if (i < b.length) out.push(b[i]!);
  }
  return out;
}

async function getHomeData() {
  const [movies, series, people, news] = await Promise.all([
    getMovieIndexData(),
    getSeriesIndexData(),
    getPersonIndexData(),
    getNewsIndexData(),
  ]);

  const movieCards = movies.view.cards;
  const seriesCards = series.view.cards;

  const featured =
    [...movieCards, ...seriesCards].find((card) => card.image !== null) ??
    movieCards[0] ??
    seriesCards[0] ??
    null;

  const mixed = interleave(movieCards, seriesCards);
  const topTen = mixed.slice(0, 10);
  const rankBig: RankItem[] = topTen.slice(0, 4).map((card, i) => ({ card, rank: i + 1 }));
  const rankSmall: RankItem[] = topTen.slice(4, 10).map((card, i) => ({ card, rank: i + 5 }));

  const filmesAlta = movieCards.slice(0, 6);
  const seriesWeek = seriesCards.slice(0, 6);
  const coming = mixed.slice(0, 6);

  const newsFeatured = news.view.featured;
  const newsCards = news.view.cards.slice(0, 4);
  const newsPopulated = (newsFeatured !== null ? 1 : 0) + newsCards.length;

  // Faixa preta: metricas REAIS do catalogo (contagens do banco), nunca numeros
  // fabricados nem estatistica pessoal de usuario inexistente.
  const stats: HomeStat[] = [
    { value: String(movies.view.totalCount), label: "filmes" },
    { value: String(series.view.totalCount), label: "séries" },
    { value: String(people.view.totalCount), label: "pessoas" },
    { value: String(news.view.totalCount), label: "notícias" },
  ];

  const indexability = evaluatePortalIndexability({
    populatedSectionCount: countPopulatedSections([
      movieCards.length,
      seriesCards.length,
      newsPopulated,
    ]),
  });

  return {
    featured,
    rankBig,
    rankSmall,
    filmesAlta,
    seriesWeek,
    coming,
    newsFeatured,
    newsCards,
    stats,
    indexability,
  };
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
  const {
    featured,
    rankBig,
    rankSmall,
    filmesAlta,
    seriesWeek,
    coming,
    newsFeatured,
    newsCards,
    stats,
  } = await getHomeData();

  const hasTop = rankBig.length > 0;
  const hasFilmes = filmesAlta.length > 0;
  const hasSeries = seriesWeek.length > 0;
  const hasComing = coming.length > 0;

  return (
    <main className="home-v4" data-vertical="home">
      <HomeV4Hero featured={featured} />
      <HomeV4Ticker featured={featured} />

      {hasTop ? (
        <section className="home-v4-section" aria-labelledby="home-top-title">
          <div className="container">
            <div className="sc-sechead">
              <h2 id="home-top-title" className="sc-sechead__title">
                Top 10 no The Screen esta semana
              </h2>
              <a className="sc-sechead__more" href={EXPLORE_PATH}>
                Ver tudo&nbsp;›
              </a>
            </div>
            <HomeV4RankRail big={rankBig} small={rankSmall} />
          </div>
        </section>
      ) : null}

      {hasFilmes ? (
        <section className="home-v4-section home-v4-section--warm" aria-labelledby="home-movies-title">
          <div className="container">
            <div className="sc-sechead">
              <h2 id="home-movies-title" className="sc-sechead__title" data-vertical="movie">
                Filmes em alta
              </h2>
              <a className="sc-sechead__more" href={MOVIES_INDEX_PATH}>
                Ver tudo&nbsp;›
              </a>
            </div>
            <HomeV4PosterRail items={filmesAlta} />
          </div>
        </section>
      ) : null}

      <HomeV4StatsBand stats={stats} />

      {hasSeries ? (
        <section className="home-v4-section" aria-labelledby="home-series-title">
          <div className="container">
            <div className="sc-sechead">
              <h2 id="home-series-title" className="sc-sechead__title" data-vertical="series">
                Séries da semana
              </h2>
              <a className="sc-sechead__more" href={SERIES_INDEX_PATH}>
                Ver tudo&nbsp;›
              </a>
            </div>
            <HomeV4PlatformTabs />
            <HomeV4PosterRail items={seriesWeek} />
          </div>
        </section>
      ) : null}

      {hasComing ? (
        <section className="home-v4-section" aria-labelledby="home-coming-title">
          <div className="container">
            <div className="sc-sechead">
              <h2 id="home-coming-title" className="sc-sechead__title" data-vertical="movie">
                Em breve
              </h2>
              <a className="sc-sechead__more" href={EXPLORE_PATH}>
                Ver tudo&nbsp;›
              </a>
            </div>
            <HomeV4ComingRail items={coming} />
          </div>
        </section>
      ) : null}

      <section className="home-v4-section" aria-labelledby="home-news-title">
        <div className="container">
          <div className="sc-sechead">
            <h2 id="home-news-title" className="sc-sechead__title" data-vertical="movie">
              Notícias
            </h2>
            <a className="sc-sechead__more" href={NEWS_INDEX_PATH}>
              Ver tudo&nbsp;›
            </a>
          </div>
          <HomeV4NewsMagazine featured={newsFeatured} cards={newsCards} />
        </div>
      </section>
    </main>
  );
}
