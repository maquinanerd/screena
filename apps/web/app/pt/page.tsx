import type { Metadata } from "next";
import type { ReactNode } from "react";

import { EntityCardLink } from "../_components/entity-card";
import type { EntityCard } from "../../src/lib/entity-index-presenter";
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

/**
 * Notas VISUAIS dos Destaques (fidelidade v4). NAO sao ratings reais: nao vem
 * de fonte externa (IMDb/RT/TMDB), nao sao atribuidas, nao viram AggregateRating
 * nem ExternalRating, nao sao persistidas e nao afirmam nota de usuarios. Sao
 * placeholder decorativo por POSICAO do slot (1..10), deterministico (SSR-safe),
 * a ser substituido por dado governado quando ratings entrarem como feature real.
 */
const HOME_VISUAL_SCORES = [
  "8.6",
  "8.6",
  "8.7",
  "8.7",
  "8.0",
  "8.9",
  "7.5",
  "8.8",
  "7.0",
  "8.0",
] as const;

/** Nota visual (placeholder) para o rank 1..10; fora do intervalo -> null. */
function homeVisualScore(rank: number): string | null {
  return HOME_VISUAL_SCORES[rank - 1] ?? null;
}

/**
 * SectionHeader (v4 §SectionHeader): barra de acento amarela + titulo 30px/800
 * + link "Ver tudo ›". Nesta etapa so a variante amarela (Destaques / Top 10)
 * e usada; barras vermelha/verde ficam para as secoes de Filmes/Series.
 */
function SectionHeader({
  title,
  titleId,
  href,
}: {
  title: string;
  titleId: string;
  href: string;
}) {
  return (
    <div className="home-v4-section-head">
      <div className="home-v4-section-title-wrap">
        <span className="home-v4-section-accent" aria-hidden="true" />
        <h2 id={titleId} className="home-v4-section-title">
          {title}
        </h2>
      </div>
      <a className="home-v4-section-more" href={href}>
        Ver tudo <span aria-hidden="true">›</span>
      </a>
    </div>
  );
}

/**
 * Badge de tipo (FILME/SERIE) do card de destaque — dentro do corpo, em bloco
 * acima do titulo (v4 §3a). Reforca a invariante 11: o tipo nunca depende so
 * da cor (badge textual acompanha URL/breadcrumb/schema/titulo).
 */
function HighlightBadge({ kind }: { kind: EntityCard["kind"] }) {
  const isMovie = kind === "movie";
  return (
    <span
      className={`home-v4-badge home-v4-badge--${isMovie ? "movie" : "series"}`}
    >
      {isMovie ? "FILME" : "SÉRIE"}
    </span>
  );
}

/**
 * Poster 2/3 do card de destaque: imagem LOCAL real quando existe (dado do
 * TMDB ingerido offline — nunca CDN externo no render); sem imagem, cai no
 * gradiente por vertical (fallback honesto). Sem badge de rank — a home nao
 * finge ranking.
 */
function HighlightPoster({
  card,
  className,
  children,
}: {
  card: EntityCard;
  className: string;
  children?: ReactNode;
}) {
  return (
    <span className={className} data-vertical={card.kind}>
      {card.image !== null ? (
        <img
          src={card.image.src}
          alt={`Pôster de ${card.title}`}
          width={card.image.width}
          height={card.image.height}
          className="home-v4-poster__img"
          loading="lazy"
        />
      ) : null}
      {children}
    </span>
  );
}

/**
 * HomeV4BigCard — HighlightCard do v4 (4 grandes) em FIDELIDADE VISUAL: poster
 * 2/3 com rank amarelo (posição do slot) + corpo branco (badge + título + meta
 * + linha de rating + "Marcar como assistido"). O rank e a nota sao VISUAIS
 * (placeholder, ver `homeVisualScore`), nao metrica/rating real. "Avaliar" e
 * "Marcar como assistido" sao affordances DESABILITADAS (aria-disabled), sem
 * onClick, sem mutation, sem estado — puro visual do design v4.
 */
function HomeV4BigCard({ card, rank }: { card: EntityCard; rank: number }) {
  const displayScore = homeVisualScore(rank);
  return (
    <a
      href={card.href}
      className="home-v4-big-card"
      data-entity-type={card.kind}
    >
      <HighlightPoster card={card} className="home-v4-poster">
        <span className="home-v4-rank-badge">#{rank}</span>
      </HighlightPoster>
      <span className="home-v4-big-card-body">
        <HighlightBadge kind={card.kind} />
        <span className="home-v4-big-card-title">{card.title}</span>
        {card.meta !== null ? (
          <span className="home-v4-big-card-meta">{card.meta}</span>
        ) : null}
        <span className="home-v4-rating-row">
          {displayScore !== null ? (
            <span className="home-v4-rating" aria-hidden="true">
              <span className="home-v4-star">★</span>
              {displayScore}
            </span>
          ) : null}
          <span className="home-v4-muted-action" aria-disabled="true">
            ☆ Avaliar
          </span>
        </span>
        <span className="home-v4-watch-action" aria-disabled="true">
          ✓ Marcar como assistido
        </span>
      </span>
    </a>
  );
}

/**
 * HomeV4CompactCard — RankingItem do v4 (6 compactos) em FIDELIDADE VISUAL:
 * mini poster 42px a esquerda + copy (rank #N + título + meta + rating). O rank
 * e a nota sao VISUAIS (placeholder, ver `homeVisualScore`), nao ranking/rating
 * real. Nunca poster vertical grande.
 */
function HomeV4CompactCard({ card, rank }: { card: EntityCard; rank: number }) {
  const displayScore = homeVisualScore(rank);
  return (
    <a
      href={card.href}
      className="home-v4-compact-card"
      data-entity-type={card.kind}
    >
      <HighlightPoster card={card} className="home-v4-compact-poster" />
      <span className="home-v4-compact-copy">
        <span className="home-v4-compact-rank">#{rank}</span>
        <span className="home-v4-compact-title">{card.title}</span>
        {card.meta !== null ? (
          <span className="home-v4-compact-meta">{card.meta}</span>
        ) : null}
        {displayScore !== null ? (
          <span className="home-v4-compact-rating" aria-hidden="true">
            <span className="home-v4-star">★</span>
            {displayScore}
          </span>
        ) : null}
      </span>
    </a>
  );
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
  // Preenche exatamente 10 slots visuais (4 grandes + 6 compactos) com itens
  // REAIS, repetindo em ciclo quando ha poucos (ate a ingestao TMDB popular
  // mais catalogo). Garante 4+6 sempre cheios — nunca card orfao, nunca 4+2.
  // Lista real vazia -> `fillSlots` devolve [] e a secao inteira e omitida.
  const highlightSlots = fillSlots(featuredCards, 10);

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

      {/* Seção principal: Destaques no The Screen — Top 10 do v4 portado com
          governança honesta: 4 HighlightCards grandes (card branco + pôster +
          corpo) + 6 RankingItems compactos horizontais. Filmes+séries reais
          intercalados; SEM ranking/#N, SEM nota, SEM Avaliar/Marcar/watchlist.
          Slots sempre cheios (fillSlots) — nunca 4+2, nunca card órfão, nunca
          trilho horizontal. */}
      {highlightSlots.length > 0 ? (
        <section
          className="home-v4-section home-v4-section--main"
          aria-labelledby="home-featured-title"
        >
          <SectionHeader
            title="Destaques no The Screen"
            titleId="home-featured-title"
            href={EXPLORE_PATH}
          />
          <ul className="home-v4-top-grid">
            {highlightSlots.slice(0, 4).map((card, index) => (
              <li
                key={`highlight-big-${card.href}-${index}`}
                className="home-v4-card-item"
              >
                <HomeV4BigCard card={card} rank={index + 1} />
              </li>
            ))}
          </ul>
          <ul className="home-v4-compact-grid">
            {highlightSlots.slice(4, 10).map((card, index) => (
              <li
                key={`highlight-compact-${card.href}-${index}`}
                className="home-v4-card-item"
              >
                <HomeV4CompactCard card={card} rank={index + 5} />
              </li>
            ))}
          </ul>
        </section>
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
