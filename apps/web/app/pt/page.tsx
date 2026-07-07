import type { Metadata } from "next";
import type { ReactNode } from "react";

import type { EntityCard } from "../../src/lib/entity-index-presenter";
import { HeroCarousel } from "../_components/hero-carousel";
import { EpisodesTicker } from "../_components/episodes-ticker";
import { ComingSoonRail } from "../_components/coming-soon-rail";
import type { ComingSoonItem } from "../_components/coming-soon-rail";
import {
  getMovieIndexData,
  getPersonIndexData,
  getSeriesIndexData,
} from "../../src/server/entity-indexes";
import { getHomeHeroSlides } from "../../src/server/home-hero";
import { getHomeUpcomingMovies } from "../../src/server/home-upcoming";
import { getNewsIndexData } from "../../src/server/news-pages";
import {
  countPopulatedSections,
  evaluatePortalIndexability,
  HOME_ENTITY_CARD_LIMIT,
  HOME_NEWS_CARD_LIMIT,
  takeSectionCards,
} from "../../src/lib/portal-presenter";
import { allowHomeVisualPlaceholders } from "../../src/lib/home-placeholder-governance";
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
 * render). NADA e inventado: as secoes de entidade (Destaques/Filmes/Series/
 * Estatisticas) so aparecem quando ha dado real; sem dados, degradam para o hero
 * institucional (fallback seguro, sem poster). "Em breve" usa DADO REAL: filmes
 * com estreia futura ingeridos do TMDB (offline) e lidos do banco
 * (`getHomeUpcomingMovies`), sem trailer/duracao fake; sem upcoming real, cai no
 * placeholder so em dev/preview. Os demais blocos de FIDELIDADE VISUAL sem fonte
 * real (Noticias mock, Publicidade) sao gateados por `allowHomeVisualPlaceholders`:
 * visiveis em dev/preview, OCULTOS em producao — nunca fingem manchete/anuncio
 * reais. Sem ranking/Top 10, sem watchlist,
 * sem botao de feature inativa, sem streaming, sem numeros fake. A nota exibida
 * nos cards e a nota editorial PROPRIA governada do Screen (`screen_score`), com
 * o mesmo gate do hero — so aparece quando liberada, nunca e rating externo
 * (IMDb/RT/TMDB) nem AggregateRating. As estatisticas sao contagens REAIS do
 * catalogo. As imagens vem de caminhos LOCAIS (dado do TMDB ingerido offline
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
 * Plataforma VISUAL (placeholder de fidelidade v4) para o chip dos tiles de
 * Séries. NAO e watch_availability real: nao afirma streaming, nao vem de fonte,
 * nao e persistida, nao vira schema. Ciclo deterministico por posicao do slot.
 * A trocar por `watch_availability` governada (display_allowed/licenca) ou
 * remover — mesma divida do Episodes Ticker.
 */
const HOME_VISUAL_PLATFORMS = [
  "Max",
  "Netflix",
  "Apple TV+",
  "Star+",
  "Prime Video",
  "Disney+",
] as const;

function homeVisualPlatform(index: number): string {
  return HOME_VISUAL_PLATFORMS[index % HOME_VISUAL_PLATFORMS.length] as string;
}

/**
 * "Em breve" (v4 §7) — trilho horizontal de trailers de próximos lançamentos.
 * MOCK VISUAL/draft: `HOME_COMING_SOON_ITEMS` são lançamentos/datas/durações de
 * placeholder (SEM trailer real, SEM player), linkando ao índice REAL /pt/filmes.
 * Dívida técnica: trocar por dado real (estreias governadas) ou remover antes de
 * indexar. NÃO afirma trailer/estreia real como produto.
 */
const HOME_COMING_SOON_ITEMS: readonly ComingSoonItem[] = [
  { title: "Ghostbusters: Frozen Empire", date: "22 de Março", duration: "2:05", href: MOVIES_INDEX_PATH },
  { title: "Godzilla x Kong: The New Empire", date: "25 de Março", duration: "1:48", href: MOVIES_INDEX_PATH },
  { title: "Demon Slayer: Infinity Castle", date: "29 de Março", duration: "2:30", href: MOVIES_INDEX_PATH },
  { title: "Challengers", date: "26 de Abril", duration: "2:10", href: MOVIES_INDEX_PATH },
  { title: "Inside Out 2", date: "14 de Junho", duration: "1:40", href: MOVIES_INDEX_PATH },
  { title: "Deadpool & Wolverine", date: "26 de Julho", duration: "2:15", href: MOVIES_INDEX_PATH },
];

/**
 * Notícias / Top News (v4 §8) — 1 destaque grande + grade 2×2 de menores. Usa
 * artigos REAIS quando existem; como o seed demo NÃO tem notícias, cai nos
 * placeholders editoriais do MD (`HOME_FEATURED_NEWS` / `HOME_GRID_NEWS`). MOCK
 * VISUAL/draft: manchetes de exemplo, linkam ao índice REAL /pt/noticias, nada
 * persistido/schema. Dívida técnica: trocar por artigos reais ou ocultar antes
 * de indexar. É a mais sensível das dívidas visuais (conteúdo editorial).
 */
type HomeNewsImage = { src: string; width: number; height: number };
type HomeNewsFeature = {
  badge: string;
  title: string;
  sub: string | null;
  href: string;
  image: HomeNewsImage | null;
};
type HomeNewsMini = {
  title: string;
  sub: string | null;
  href: string;
  image: HomeNewsImage | null;
};

const HOME_FEATURED_NEWS: HomeNewsFeature = {
  badge: "Em alta esta semana",
  title: "Por que Oppenheimer dominou a temporada de prêmios",
  sub: "A leitura de Nolan sobre ciência, culpa e poder rendeu o maior sucesso adulto do ano.",
  href: NEWS_INDEX_PATH,
  image: null,
};

const HOME_GRID_NEWS: readonly HomeNewsMini[] = [
  {
    title: "Duna: onde Feyd-Rautha se encaixa, explicado",
    sub: "Com Parte Dois nos cinemas, revisitamos o vilão.",
    href: NEWS_INDEX_PATH,
    image: null,
  },
  {
    title: "Bilheteria: Arthur, o Rei faz US$ 825 mil em prévias",
    sub: "Estreia modesta para o drama de Mark Wahlberg.",
    href: NEWS_INDEX_PATH,
    image: null,
  },
  {
    title: "Os personagens mais poderosos de Duna 2, ranqueados",
    sub: "Do Imperador aos Fremen.",
    href: NEWS_INDEX_PATH,
    image: null,
  },
  {
    title: "Stranger Things: o que esperar da temporada final",
    sub: "Hawkins se despede em grande estilo.",
    href: NEWS_INDEX_PATH,
    image: null,
  },
];

/**
 * SectionHeader (v4 §SectionHeader): barra de acento (cor por contexto) + titulo
 * 30px/800 + link "Ver tudo ›". Variantes: amarela (Destaques/Top 10), vermelha
 * (Filmes), verde (Series).
 */
function SectionHeader({
  title,
  titleId,
  href,
  accent = "yellow",
}: {
  title: string;
  titleId: string;
  href: string;
  accent?: "yellow" | "red" | "green";
}) {
  const accentClass =
    accent === "yellow"
      ? "home-v4-section-accent"
      : `home-v4-section-accent home-v4-section-accent--${accent}`;
  return (
    <div className="home-v4-section-head">
      <div className="home-v4-section-title-wrap">
        <span className={accentClass} aria-hidden="true" />
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
 * + linha de rating + "Marcar como assistido"). O rank e VISUAL (posição do
 * slot, não ranking real). A nota (`card.screenScore`) é a nota editorial
 * PRÓPRIA do Screen, governada — mesma fonte/gate do hero (`screen_score` +
 * `screen_score_display`); só aparece quando liberada, nunca é rating externo
 * (IMDb/RT/TMDB) nem AggregateRating. "Avaliar" e "Marcar como assistido" são
 * affordances DESABILITADAS (aria-disabled), sem onClick/mutation/estado.
 */
function HomeV4BigCard({ card, rank }: { card: EntityCard; rank: number }) {
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
          {card.screenScore !== null ? (
            <span className="home-v4-rating" aria-hidden="true">
              <span className="home-v4-star">★</span>
              {card.screenScore}
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
 * é VISUAL (posição do slot, não ranking real); a nota (`card.screenScore`) é a
 * nota editorial PRÓPRIA governada do Screen (mesmo gate do hero), nunca rating
 * externo/AggregateRating. Nunca poster vertical grande.
 */
function HomeV4CompactCard({ card, rank }: { card: EntityCard; rank: number }) {
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
        {card.screenScore !== null ? (
          <span className="home-v4-compact-rating" aria-hidden="true">
            <span className="home-v4-star">★</span>
            {card.screenScore}
          </span>
        ) : null}
      </span>
    </a>
  );
}

/**
 * HomeV4PosterCard — MediaCard do v4 da grade de Filmes em destaque (04 §4):
 * pôster 2/3 (raio 12px + sombra) com badge FILME (sup-esq) + título 13px +
 * linha meta (ano) com a nota à direita (estrela dourada + nota). A nota
 * (`card.screenScore`) é a nota editorial PRÓPRIA governada do Screen (mesmo
 * gate do hero, `screen_score` + `screen_score_display`): NÃO é rating externo
 * (IMDb/RT/TMDB), não é atribuída a terceiro, não vira AggregateRating/
 * ExternalRating. Sem nota liberada, o espaço some. Imagem LOCAL real; sem
 * imagem, gradiente por vertical.
 */
function HomeV4PosterCard({ card }: { card: EntityCard }) {
  const isMovie = card.kind === "movie";
  return (
    <a
      href={card.href}
      className="home-v4-poster-card"
      data-entity-type={card.kind}
    >
      <HighlightPoster card={card} className="home-v4-media-poster">
        <span
          className={`home-v4-media-badge home-v4-media-badge--${isMovie ? "movie" : "series"}`}
        >
          {isMovie ? "FILME" : "SÉRIE"}
        </span>
      </HighlightPoster>
      <span className="home-v4-poster-title">{card.title}</span>
      <span className="home-v4-poster-meta-row">
        <span className="home-v4-poster-meta">{card.meta ?? ""}</span>
        {card.screenScore !== null ? (
          <span className="home-v4-media-rating" aria-hidden="true">
            <span className="home-v4-star">★</span>
            {card.screenScore}
          </span>
        ) : null}
      </span>
    </a>
  );
}

/**
 * HomeV4SeriesTile — tile-poster do v4 da grade de Séries em destaque (04 §6):
 * pôster 2/3 com título SOBREPOSTO no centro + badge SÉRIE (sup-esq) + chip de
 * plataforma (base-dir). O chip de plataforma é placeholder VISUAL (ver
 * `homeVisualPlatform`): NAO é watch_availability real, não afirma streaming,
 * não é persistido (aria-hidden). Imagem LOCAL real; sem imagem, gradiente verde.
 */
function HomeV4SeriesTile({
  card,
  platform,
}: {
  card: EntityCard;
  platform: string;
}) {
  return (
    <a
      href={card.href}
      className="home-v4-series-tile"
      data-entity-type="series"
    >
      <span className="home-v4-series-tile__poster">
        {card.image !== null ? (
          <img
            src={card.image.src}
            alt={`Pôster de ${card.title}`}
            width={card.image.width}
            height={card.image.height}
            className="home-v4-series-tile__img"
            loading="lazy"
          />
        ) : null}
        <span className="home-v4-series-tile__scrim" aria-hidden="true" />
        <span className="home-v4-media-badge home-v4-media-badge--series">
          SÉRIE
        </span>
        <span className="home-v4-series-platform" aria-hidden="true">
          {platform}
        </span>
        <span className="home-v4-series-title">{card.title}</span>
      </span>
    </a>
  );
}

/**
 * HomeV4NewsFeature — card em destaque grande de Notícias (v4 §8): imagem/backdrop
 * (real quando existe) + scrim + badge vermelho + título 28px + subtítulo. Fundo
 * escuro permitido (card de mídia). Conteúdo pode ser placeholder VISUAL.
 */
function HomeV4NewsFeature({ item }: { item: HomeNewsFeature }) {
  return (
    <a href={item.href} className="home-v4-news-feature">
      {item.image !== null ? (
        <img
          src={item.image.src}
          alt={`Imagem de ${item.title}`}
          width={item.image.width}
          height={item.image.height}
          className="home-v4-news-img"
          loading="lazy"
        />
      ) : null}
      <div className="home-v4-news-scrim" aria-hidden="true" />
      <div className="home-v4-news-body">
        <span className="home-v4-news-badge">{item.badge}</span>
        <h3 className="home-v4-news-feature-title">{item.title}</h3>
        {item.sub !== null ? (
          <p className="home-v4-news-feature-sub">{item.sub}</p>
        ) : null}
      </div>
    </a>
  );
}

/**
 * HomeV4NewsMiniCard — card menor da grade 2×2 de Notícias (v4 §8): imagem/backdrop
 * + scrim + título + subtítulo. Conteúdo pode ser placeholder VISUAL.
 */
function HomeV4NewsMiniCard({ item }: { item: HomeNewsMini }) {
  return (
    <a href={item.href} className="home-v4-news-mini">
      {item.image !== null ? (
        <img
          src={item.image.src}
          alt={`Imagem de ${item.title}`}
          width={item.image.width}
          height={item.image.height}
          className="home-v4-news-img"
          loading="lazy"
        />
      ) : null}
      <div className="home-v4-news-scrim" aria-hidden="true" />
      <div className="home-v4-news-body">
        <h4 className="home-v4-news-mini-title">{item.title}</h4>
        {item.sub !== null ? (
          <p className="home-v4-news-mini-sub">{item.sub}</p>
        ) : null}
      </div>
    </a>
  );
}

export default async function HomePage() {
  const [{ movieCards, seriesCards, newsCards, counts }, heroSlides, upcomingMovies] =
    await Promise.all([getHomeData(), getHomeHeroSlides(), getHomeUpcomingMovies()]);

  const hasCounts = counts.movies > 0 || counts.series > 0 || counts.people > 0;

  // Gate de placeholders visuais (Fase 1.1B): em producao sem dado real, os
  // blocos de FIDELIDADE VISUAL (Noticias mock, "Em breve" mock, Publicidade
  // estatica) NAO renderizam — nunca fingem manchete/estreia/anuncio reais. Em
  // dev/preview (ou com SCREEN_HOME_VISUAL_PLACEHOLDERS=1) seguem visiveis.
  const allowPlaceholders = allowHomeVisualPlaceholders();

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
  // Filmes/Séries em destaque (grids de 6): mesma regra de slots — 6 sempre
  // cheios com itens REAIS (repetidos em ciclo se houver poucos); sem itens, a
  // seção correspondente é omitida. Nunca 3 cards perdidos, nunca trilho.
  const movieSlots = fillSlots(movieCards, 6);
  const seriesSlots = fillSlots(seriesCards, 6);
  // Notícias (destaque + grade 2×2): usa artigos REAIS quando existem; sem reais
  // (o seed demo não tem notícias), placeholders editoriais do MD — mas SÓ em
  // dev/preview (gate `allowPlaceholders`). Em produção sem artigo real a seção
  // inteira é omitida (nunca manchete falsa). O gate anti-thin segue contando só
  // `newsCards` reais (getHomeData) — placeholder NÃO infla indexabilidade.
  const firstNews = newsCards[0];
  const hasRealNews = firstNews !== undefined;
  const featuredNews: HomeNewsFeature =
    firstNews !== undefined
      ? {
          badge: firstNews.category ?? "Em destaque",
          title: firstNews.title,
          sub: firstNews.deck ?? null,
          href: firstNews.href,
          image:
            firstNews.image !== null
              ? {
                  src: firstNews.image.src,
                  width: firstNews.image.width,
                  height: firstNews.image.height,
                }
              : null,
        }
      : HOME_FEATURED_NEWS;
  const gridNews: HomeNewsMini[] =
    firstNews !== undefined
      ? fillSlots(
          newsCards.map((card) => ({
            title: card.title,
            sub: card.deck ?? null,
            href: card.href,
            image:
              card.image !== null
                ? {
                    src: card.image.src,
                    width: card.image.width,
                    height: card.image.height,
                  }
                : null,
          })),
          4,
        )
      : [...HOME_GRID_NEWS];

  // "Em breve": DADO REAL (filmes upcoming do TMDB, sem duração de trailer) tem
  // prioridade. Sem upcoming real, cai no placeholder mock — mas SÓ em dev/
  // preview (`allowPlaceholders`); em produção sem dado real a seção é omitida.
  const upcomingRailItems: ComingSoonItem[] = upcomingMovies.map((movie) => ({
    title: movie.title,
    date: movie.date,
    href: movie.href,
  }));
  const hasRealUpcoming = upcomingRailItems.length > 0;
  const comingSoonItems: ComingSoonItem[] | null = hasRealUpcoming
    ? upcomingRailItems
    : allowPlaceholders
      ? [...HOME_COMING_SOON_ITEMS]
      : null;
  // Copy honesta: com dado real não prometemos trailer.
  const comingSoonSubtitle = hasRealUpcoming
    ? "Próximos lançamentos no catálogo"
    : "Trailers de próximos lançamentos";

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

      {/* Faixa amarela abaixo do hero — Episodes Ticker (carrossel de episódios
          novos do dia, design v4). MOCK VISUAL: dados de episódio/streaming são
          placeholder de fidelidade (sem watch_availability real); ver
          episodes-ticker.tsx e a dívida técnica registrada. */}
      <EpisodesTicker />

      {/* Seção principal: Destaques no The Screen — Top 10 do v4 portado com
          governança honesta: 4 HighlightCards grandes (card branco + pôster +
          corpo) + 6 RankingItems compactos horizontais. Filmes+séries reais
          intercalados. O #N é posição VISUAL do slot (não ranking real); a nota
          é a nota editorial PRÓPRIA governada do Screen (só quando liberada),
          nunca rating externo/AggregateRating. Avaliar/Marcar são affordances
          DESABILITADAS (sem watchlist real). Slots sempre cheios (fillSlots) —
          nunca 4+2, nunca card órfão, nunca trilho horizontal. */}
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

      {/* Filmes em destaque — banda creme v4 (04 §4 "Filmes em alta"): grid de 6
          MediaCards reais com pôster local + badge FILME. Slots sempre cheios; a
          nota (quando exibida) é a nota editorial PRÓPRIA governada do Screen —
          nunca rating externo/AggregateRating. Sem Avaliar. */}
      {movieSlots.length > 0 ? (
        <section
          className="home-v4-band home-v4-band--warm"
          aria-labelledby="home-movies-title"
        >
          <div className="home-v4-section home-v4-section--band">
            <SectionHeader
              accent="red"
              title="Filmes em destaque"
              titleId="home-movies-title"
              href={MOVIES_INDEX_PATH}
            />
            <div className="home-v4-media-grid">
              {movieSlots.slice(0, 6).map((card, index) => (
                <HomeV4PosterCard
                  key={`movie-${card.href}-${index}`}
                  card={card}
                />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* Faixa preta v4 (04 §5 "Seu mês em números") — statbar honesta: kicker
          amarelo + contagens REAIS do catálogo (filmes/séries/pessoas), nunca
          watchlist/assistidos. CTA à direita aponta para uma rota REAL (Explorar). */}
      {hasCounts ? (
        <section className="home-v4-stats-band" aria-label="Catálogo do Screen">
          <div className="home-v4-stats-inner">
            <div className="home-v4-stats-group">
              <span className="home-v4-stats-label">NO CATÁLOGO DO SCREEN</span>
              <span className="home-v4-stat">
                <strong>{counts.movies}</strong> filmes
              </span>
              <span className="home-v4-stat">
                <strong>{counts.series}</strong> séries
              </span>
              <span className="home-v4-stat">
                <strong>{counts.people}</strong> pessoas
              </span>
            </div>
            <a className="home-v4-stats-link" href={EXPLORE_PATH}>
              Explorar o catálogo →
            </a>
          </div>
        </section>
      ) : null}

      {/* Séries em destaque — v4 (04 §6 "Séries da semana"): grid de 6 tiles com
          título SOBREPOSTO + badge SÉRIE + chip de plataforma VISUAL (placeholder,
          não é watch_availability real). SEM tabs de plataforma e SEM segunda
          grade de streaming (adiado). SEM nota/Avaliar. */}
      {seriesSlots.length > 0 ? (
        <section
          className="home-v4-section home-v4-section--series"
          aria-labelledby="home-series-title"
        >
          <SectionHeader
            accent="green"
            title="Séries em destaque"
            titleId="home-series-title"
            href={SERIES_INDEX_PATH}
          />
          <div className="home-v4-media-grid">
            {seriesSlots.slice(0, 6).map((card, index) => (
              <HomeV4SeriesTile
                key={`series-${card.href}-${index}`}
                card={card}
                platform={homeVisualPlatform(index)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* Em breve (v4 §7) — trilho de próximos lançamentos. Usa DADO REAL:
          filmes com estreia futura ingeridos do TMDB (offline) e lidos do banco
          (`getHomeUpcomingMovies`) — data/pôster/slug/link reais, SEM trailer,
          SEM duração fake. Sem upcoming real, cai no placeholder mock, mas só em
          dev/preview (`allowPlaceholders`); em produção sem dado real a seção é
          OMITIDA. A copy do subtítulo é honesta conforme a origem (real vs mock).
          Trilho + setas FUNCIONAIS no client `ComingSoonRail`; header server. */}
      {comingSoonItems !== null ? (
        <section className="home-v4-soon" aria-labelledby="home-soon-title">
          <ComingSoonRail
            items={comingSoonItems}
            heading={
              <div>
                <div className="home-v4-section-title-wrap">
                  <span
                    className="home-v4-section-accent home-v4-section-accent--red"
                    aria-hidden="true"
                  />
                  <h2 id="home-soon-title" className="home-v4-section-title">
                    Em breve
                  </h2>
                  <span className="home-v4-title-chevron" aria-hidden="true">
                    ›
                  </span>
                </div>
                <p className="home-v4-soon-sub">{comingSoonSubtitle}</p>
              </div>
            }
          />
        </section>
      ) : null}

      {/* Publicidade — o v4 mostra um leaderboard entre "Em breve" e "Notícias".
          Placeholder ESTÁTICO (caixa listrada + rótulo), só para fidelidade
          visual: SEM AdSense/GPT, SEM script externo, SEM iframe, SEM integração.
          Como não há anúncio real, só aparece em dev/preview (gate
          `allowPlaceholders`); em produção fica OCULTO — nunca exibe "Google
          AdSense" sem AdSense real. Trocar pelo slot real quando/se a monetização
          entrar. */}
      {allowPlaceholders ? (
        <div className="home-v4-ad-placeholder" aria-label="Espaço publicitário">
          <div className="home-v4-ad-label">PUBLICIDADE</div>
          <div className="home-v4-ad-box" aria-hidden="true">
            <strong>Google AdSense</strong>
            <span>728 × 90 · Leaderboard</span>
          </div>
        </div>
      ) : null}

      {/* Notícias / Top News (v4 §8) — destaque grande (min-height 430) + grade
          2×2 de menores (min-height 200). Com artigos REAIS, renderiza normal.
          Sem reais, os placeholders editoriais do MD (badge "Em alta esta
          semana", manchetes de exemplo) só aparecem em dev/preview (gate
          `allowPlaceholders`); em produção sem artigo real a seção é OMITIDA —
          nunca manchete falsa. Links reais para /pt/noticias. */}
      {hasRealNews || allowPlaceholders ? (
        <section className="home-v4-news" aria-labelledby="home-news-title">
          <SectionHeader
            accent="red"
            title="Notícias"
            titleId="home-news-title"
            href={NEWS_INDEX_PATH}
          />
          <div className="home-v4-news-grid">
            <HomeV4NewsFeature item={featuredNews} />
            <div className="home-v4-news-mini-grid">
              {gridNews.map((item, index) => (
                <HomeV4NewsMiniCard
                  key={`home-news-mini-${item.href}-${index}`}
                  item={item}
                />
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
