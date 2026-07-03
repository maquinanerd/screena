import type { Metadata } from "next";

import { HomeV4Header } from "../_components/home-v4-header";
import { HomeV4Hero, HomeV4Ticker, type HeroDetail } from "../_components/home-v4-hero";
import {
  HomeV4ComingRail,
  HomeV4PlatformTabs,
  HomeV4PosterRail,
  HomeV4RankRail,
  HomeV4SeriesFeatureRail,
  type RankItem,
} from "../_components/home-v4-rails";
import { HomeV4NewsMagazine, HomeV4StatsBand } from "../_components/home-v4-blocks";
import {
  getMovieIndexData,
  getSeriesIndexData,
} from "../../src/server/entity-indexes";
import { getMoviePageData } from "../../src/server/movie-page";
import { getSeriesPageData } from "../../src/server/series-page";
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
 * canonica do Claude Design `Screen Screens v4.dc.html` (bloco HOME).
 *
 * Server component puro (invariantes 3/4): le SO PostgreSQL pelos getters de
 * listagem/detalhe ja existentes; zero API externa, zero Gemini, zero TMDB.
 * NADA e inventado: sem nota/estrela, sem disponibilidade fake, sem numero de
 * usuario fabricado; a faixa "Seu mes em numeros" fica em estado neutro (0).
 *
 * VITRINE VISUAL: como o catalogo demo e pequeno, os trilhos sao PREENCHIDOS
 * reutilizando os MESMOS titulos reais (`fillTo`) para preservar o layout do
 * design — isolado como fallback de demonstracao, nunca dado novo inventado.
 * Gate anti-thin (invariante 5) usa as contagens REAIS (nao as preenchidas).
 */

export const dynamic = "force-dynamic";

const HOME_TITLE = "Screen — filmes, séries, pessoas e notícias";
const HOME_DESCRIPTION =
  "Base editorial de entretenimento em português: fichas de filmes e séries, perfis de pessoas e notícias com curadoria própria da redação do Screen.";

/** Intercala dois conjuntos preservando a ordem de cada um. */
function interleave(a: readonly EntityCard[], b: readonly EntityCard[]): EntityCard[] {
  const out: EntityCard[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i += 1) {
    if (i < a.length) out.push(a[i]!);
    if (i < b.length) out.push(b[i]!);
  }
  return out;
}

/**
 * Preenche uma grade ate `n` itens REUTILIZANDO os itens reais (demo). Cicla os
 * mesmos titulos — nunca cria entidade nem dado novo. Vazio permanece vazio.
 */
function fillTo(items: readonly EntityCard[], n: number): EntityCard[] {
  if (items.length === 0) return [];
  const out: EntityCard[] = [];
  for (let i = 0; i < n; i += 1) out.push(items[i % items.length]!);
  return out;
}

/** Extrai o slug canonico do href da ficha (`/pt/filmes/{slug}/`). */
function slugFromHref(href: string): string | null {
  const parts = href.split("/").filter((p) => p !== "");
  return parts.length > 0 ? parts[parts.length - 1]! : null;
}

/** Detalhe REAL do destaque (elenco + sinopse) para o painel lateral do hero. */
async function getFeaturedDetail(featured: EntityCard | null): Promise<HeroDetail | null> {
  if (featured === null || featured.kind === "person") return null;
  const slug = slugFromHref(featured.href);
  if (slug === null) return null;
  const data =
    featured.kind === "movie" ? await getMoviePageData(slug) : await getSeriesPageData(slug);
  if (data === null) return null;
  const castNames =
    data.cast.length > 0 ? data.cast.slice(0, 3).map((member) => member.name).join(", ") : null;
  return { castNames, synopsis: data.view.metaDescription };
}

async function getHomeData() {
  const [movies, series, news] = await Promise.all([
    getMovieIndexData(),
    getSeriesIndexData(),
    getNewsIndexData(),
  ]);

  const movieCards = movies.view.cards;
  const seriesCards = series.view.cards;

  const featured =
    [...movieCards, ...seriesCards].find((card) => card.image !== null) ??
    movieCards[0] ??
    seriesCards[0] ??
    null;
  const featuredDetail = await getFeaturedDetail(featured);

  const mixed = interleave(movieCards, seriesCards);
  const topTen = fillTo(mixed, 10);
  const rankBig: RankItem[] = topTen.slice(0, 4).map((card, i) => ({ card, rank: i + 1 }));
  const rankSmall: RankItem[] = topTen.slice(4, 10).map((card, i) => ({ card, rank: i + 5 }));

  const filmesAlta = fillTo(movieCards, 6);
  const seriesFeature = fillTo(seriesCards, 6);
  const seriesGrid = fillTo(seriesCards, 6);
  const coming = fillTo(mixed, 5);

  const newsFeatured = news.view.featured;
  const newsCards = news.view.cards.slice(0, 4);
  const newsPopulated = (newsFeatured !== null ? 1 : 0) + newsCards.length;

  // Gate anti-thin usa as contagens REAIS (nunca as preenchidas para vitrine).
  const indexability = evaluatePortalIndexability({
    populatedSectionCount: countPopulatedSections([
      movieCards.length,
      seriesCards.length,
      newsPopulated,
    ]),
  });

  return {
    featured,
    featuredDetail,
    rankBig,
    rankSmall,
    filmesAlta,
    seriesFeature,
    seriesGrid,
    coming,
    newsFeatured,
    newsCards,
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

/** Setas circulares decorativas do cabecalho de secao (sem carrossel JS). */
function SectionArrows() {
  return (
    <span className="home-v4-arrows" aria-hidden="true">
      <span className="home-v4-arrow">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 5 8 12 15 19" />
        </svg>
      </span>
      <span className="home-v4-arrow">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 5 16 12 9 19" />
        </svg>
      </span>
    </span>
  );
}

export default async function HomePage() {
  const {
    featured,
    featuredDetail,
    rankBig,
    rankSmall,
    filmesAlta,
    seriesFeature,
    seriesGrid,
    coming,
    newsFeatured,
    newsCards,
  } = await getHomeData();

  const hasTop = rankBig.length > 0;
  const hasFilmes = filmesAlta.length > 0;
  const hasSeries = seriesFeature.length > 0;
  const hasComing = coming.length > 0;

  return (
    <main className="home-v4" data-vertical="home">
      <HomeV4Header />
      <HomeV4Hero featured={featured} detail={featuredDetail} />
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

      <HomeV4StatsBand />

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
            <HomeV4SeriesFeatureRail items={seriesFeature} />
            <HomeV4PlatformTabs />
            <HomeV4PosterRail items={seriesGrid} />
          </div>
        </section>
      ) : null}

      {hasComing ? (
        <section className="home-v4-section" aria-labelledby="home-coming-title">
          <div className="container">
            <div className="sc-sechead sc-sechead--split">
              <div className="sc-sechead__group">
                <h2 id="home-coming-title" className="sc-sechead__title" data-vertical="movie">
                  Em breve
                </h2>
                <p className="sc-sechead__sub">Trailers de próximos lançamentos</p>
              </div>
              <SectionArrows />
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
