/**
 * Snapshot de catálogo para a faixa “Filmes em alta” da home canônica.
 *
 * Somente PostgreSQL local: a consulta não chama TMDB nem qualquer serviço no
 * render. O presenter puro preserva a ordem e nunca repete cards.
 *
 * ============================================================================
 * A FAIXA SE CHAMA "EM ALTA", E ATÉ 2026-08-21 ELA NÃO ERA
 * ============================================================================
 * A ordenação era `popularity desc` — um número **acumulado**, sem janela
 * nenhuma. O comentário anterior deste arquivo dizia que registros sem
 * `popularity` eram omitidos "para que a UI nunca rotule uma ordenação
 * arbitrária como 'em alta'", e o cuidado era real: só que `popularity` também
 * não é "em alta". Um título que estreou ontem e explodiu tem popularity
 * acumulada baixa e nunca aparecia; um título morno de dez anos atrás aparecia
 * todo dia.
 *
 * Agora a faixa lê o `trending/day` capturado pela fila `trending` do agendador
 * (`services/sync/src/scheduler/rhythms.ts`, 6 h). `buildTrendingMovieCards`
 * passou a fazer o que o nome dele diz.
 *
 * SEM FALLBACK para popularidade quando o trending vem vazio — ver
 * `trending-snapshot.ts`. Vazio => faixa ausente com o motivo nomeado.
 */

import { cache } from "react";
import { getPrismaClient } from "@screena/db/server";

import { resolveEditorialScoreSources } from "./editorial-score";
import {
  getTrendingSnapshot,
  orderByTrending,
  trendingAbsenceFor,
  type TrendingAbsenceReason,
} from "./trending-snapshot";

import {
  buildTrendingMovieCards,
  buildTrendingSeriesCards,
  HOME_TRENDING_CARD_LIMIT,
} from "../lib/home-catalog-presenter";
import type {
  EntityCard,
  MovieListItemInput,
  SeriesListItemInput,
} from "../lib/entity-index-presenter";

const LANGUAGE_CODE = "pt-BR";

function yearFromDate(date: Date | null): number | null {
  return date === null ? null : date.getUTCFullYear();
}

function decimalToNumber(
  value: { toString(): string } | number | null,
): number | null {
  if (value == null) return null;
  const parsed = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Slug canônico + título pt-BR das entidades pedidas.
 *
 * `scope` NÃO é otimização prematura: sem ele a consulta traz TODOS os slugs
 * canônicos do catálogo e todas as traduções, em toda requisição, numa página
 * `force-dynamic`. O trilho usa no máximo 20 ids (o snapshot é um topo), então
 * o custo era O(catálogo) para responder uma pergunta O(20).
 *
 * Isso era tolerável com 129 filmes. Em 2026-08-26 o catálogo passou de 1.485
 * para 6.985 filmes em uma hora, e continua crescendo — a consulta cresce
 * junto, e o único lugar onde isso aparece é a latência da home.
 *
 * O resultado é o MESMO: quem não tem slug canônico simplesmente não volta, e
 * `buildMovieCard`/`buildSeriesCard` já devolvem `null` para item sem slug.
 */
async function canonicalIdentity(
  entityType: "movie" | "tv",
  scope: readonly bigint[],
): Promise<{
  ids: bigint[];
  slugById: Map<string, string>;
  titleById: Map<string, string | null>;
}> {
  const prisma = getPrismaClient();
  if (scope.length === 0) return { ids: [], slugById: new Map(), titleById: new Map() };
  const slugs = await prisma.slug.findMany({
    where: {
      entityType,
      languageCode: LANGUAGE_CODE,
      isCanonical: true,
      entityId: { in: [...scope] },
    },
    select: { entityId: true, slug: true },
  });
  const ids = slugs.map((row) => row.entityId);
  const slugById = new Map(
    slugs.map((row) => [row.entityId.toString(), row.slug] as const),
  );
  if (ids.length === 0) return { ids, slugById, titleById: new Map() };

  const translations = await prisma.entityTranslation.findMany({
    where: { entityType, entityId: { in: ids }, languageCode: LANGUAGE_CODE },
    select: { entityId: true, title: true },
  });
  const titleById = new Map(
    translations.map((row) => [row.entityId.toString(), row.title] as const),
  );
  return { ids, slugById, titleById };
}

export interface HomeCatalogData {
  movies: EntityCard[];
  /**
   * `null` quando a faixa veio cheia; senão o motivo, para o log da superfície.
   *
   * A faixa sumir calada seria o defeito que esta mudança combate com outra
   * roupa: antes ela mentia, agora ela poderia desaparecer sem dizer por quê.
   */
  trendingAbsence: TrendingAbsenceReason | null;

  /**
   * Trilho "Séries da semana" — o irmão de `movies`, que NÃO existia.
   *
   * Até 2026-08-26 a home montava esse trilho com `seriesIndex.view.cards` (a
   * listagem genérica de séries). Ver `buildTrendingSeriesCards`.
   */
  series: EntityCard[];

  /** `null` quando o trilho de séries veio cheio; senão o motivo. */
  seriesTrendingAbsence: TrendingAbsenceReason | null;
}

export const getHomeCatalogData = cache(async (): Promise<HomeCatalogData> => {
  const prisma = getPrismaClient();
  const snapshot = await getTrendingSnapshot("movie", "day");
  // A identidade é pedida SÓ para os ids do trending — ver `canonicalIdentity`.
  const movieIdentity = await canonicalIdentity("movie", snapshot.entityIds);

  // A ordem é a do trending, resolvida EM MEMÓRIA: SQL não sabe ordenar por uma
  // lista de ids sem um `CASE` gerado, e o conjunto é um topo de 20.
  const trendingIds = movieIdentity.ids;
  const rows =
    trendingIds.length === 0
      ? []
      : await prisma.movie.findMany({
          where: { id: { in: trendingIds } },
          select: {
            id: true,
            titleOriginal: true,
            releaseDate: true,
            posterPath: true,
            screenScore: true,
            screenScoreScale: true,
            screenScoreDisplay: true,
          },
        });
  const movies = orderByTrending(rows, (row) => row.id, snapshot.entityIds).slice(
    0,
    HOME_TRENDING_CARD_LIMIT,
  );

  // Procedencia do Cinerie Score em LOTE (ver `editorial-score`): sem calculo
  // `calculated` coerente, a nota fica sem origem editorial e o card a oculta.
  const scoreSources = await resolveEditorialScoreSources(
    prisma,
    "movie",
    movies.map((movie) => ({
      entityId: movie.id,
      screenScore: decimalToNumber(movie.screenScore),
      screenScoreScale: movie.screenScoreScale,
    })),
  );

  const movieInputs: MovieListItemInput[] = movies.map((movie) => {
    const key = movie.id.toString();
    return {
      id: key,
      titleOriginal: movie.titleOriginal,
      translationTitle: movieIdentity.titleById.get(key) ?? null,
      slug: movieIdentity.slugById.get(key) ?? null,
      year: yearFromDate(movie.releaseDate),
      posterPath: movie.posterPath,
      screenScore: decimalToNumber(movie.screenScore),
      screenScoreScale: movie.screenScoreScale,
      screenScoreDisplay: movie.screenScoreDisplay,
      screenScoreSource: scoreSources.get(key) ?? null,
    };
  });
  const cards = buildTrendingMovieCards(movieInputs);

  const series = await trendingSeriesCards(prisma);

  return {
    movies: cards,
    trendingAbsence: trendingAbsenceFor(snapshot, cards.length),
    series: series.cards,
    seriesTrendingAbsence: series.absence,
  };
});

/**
 * O trilho "Séries da semana", lido do MESMO lugar que o de filmes.
 *
 * Espelha `getHomeCatalogData` para `tv`, com uma diferença deliberada de
 * janela: filmes usam `trending/day` (a faixa se chama "em alta"), séries usam
 * `trending/week` — porque o rótulo do trilho diz "da semana", e uma série
 * semanal não tem sinal diário que signifique alguma coisa.
 *
 * SEM FALLBACK para a listagem de séries. Era exatamente esse fallback que
 * colocava o começo do alfabeto sob o rótulo "Séries da semana"; trocá-lo por
 * outro seria repetir o defeito com roupa nova. Vazio => o trilho some, com o
 * motivo nomeado em `seriesTrendingAbsence`.
 */
async function trendingSeriesCards(
  prisma: ReturnType<typeof getPrismaClient>,
): Promise<{ cards: EntityCard[]; absence: TrendingAbsenceReason | null }> {
  const snapshot = await getTrendingSnapshot("tv", "week");
  const identity = await canonicalIdentity("tv", snapshot.entityIds);
  const trendingIds = identity.ids;
  const rows =
    trendingIds.length === 0
      ? []
      : await prisma.tvShow.findMany({
          where: { id: { in: trendingIds } },
          select: {
            id: true,
            nameOriginal: true,
            firstAirDate: true,
            lastAirDate: true,
            posterPath: true,
            screenScore: true,
            screenScoreScale: true,
            screenScoreDisplay: true,
          },
        });
  const ordered = orderByTrending(rows, (row) => row.id, snapshot.entityIds).slice(
    0,
    HOME_TRENDING_CARD_LIMIT,
  );

  const scoreSources = await resolveEditorialScoreSources(
    prisma,
    "tv",
    ordered.map((show) => ({
      entityId: show.id,
      screenScore: decimalToNumber(show.screenScore),
      screenScoreScale: show.screenScoreScale,
    })),
  );

  const inputs: SeriesListItemInput[] = ordered.map((show) => {
    const key = show.id.toString();
    return {
      id: key,
      nameOriginal: show.nameOriginal,
      translationTitle: identity.titleById.get(key) ?? null,
      slug: identity.slugById.get(key) ?? null,
      firstAirYear: yearFromDate(show.firstAirDate),
      lastAirYear: yearFromDate(show.lastAirDate),
      posterPath: show.posterPath,
      screenScore: decimalToNumber(show.screenScore),
      screenScoreScale: show.screenScoreScale,
      screenScoreDisplay: show.screenScoreDisplay,
      screenScoreSource: scoreSources.get(key) ?? null,
    };
  });

  const cards = buildTrendingSeriesCards(inputs);
  return { cards, absence: trendingAbsenceFor(snapshot, cards.length) };
}
