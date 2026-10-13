/**
 * home-ticker.ts — Camada SERVER-ONLY da faixa amarela da home.
 *
 * A faixa é um CARROSSEL de novidades reais (4–5 itens, um visível por vez),
 * não "o episódio de hoje ou um fallback". Este módulo agrega QUATRO fontes
 * persistidas e entrega uma lista serializável já ordenada e deduplicada:
 *
 *   1. `episodes.air_date`   -> episódio de hoje / próximo episódio confirmado
 *   2. `movies.release_date` -> estreia de filme (hoje / confirmada)
 *   3. `seasons.air_date`    -> estreia de temporada (com `season_number` REAL)
 *   4. `watch_availability.available_from` -> chegada ao streaming, e SÓ com
 *      oferta aprovada pelo gate compartilhado `licensedWatchWhere`
 *
 * Invariantes 3/4: lê SOMENTE PostgreSQL local. Zero API externa, zero Gemini.
 *
 * SEM N+1: o número de queries é CONSTANTE, independente da quantidade de itens.
 * São 7 no caminho comum e no máximo 9:
 *
 *   4 de descoberta (episódio, filme, temporada, chegada ao streaming) — em paralelo
 *   3 de resolução em lote (slugs + traduções + provedores licenciados)
 *   0–2 de backfill de nome ORIGINAL, e só para as entidades que apareceram
 *     exclusivamente pela chegada ao streaming (essa query traz id e data, não
 *     título). Sem entidade nessa condição, as duas não acontecem.
 *
 * HONESTIDADE: só entra na faixa entidade com título real e slug canônico pt-BR.
 * Sem novidade nenhuma, a lista volta vazia e a faixa assume o estado neutro —
 * nunca episódio, data, sessão de cinema ou plataforma fabricados.
 */

import { cache } from "react";
import { getPrismaClient } from "@screena/db/server";

import { licensedWatchWhere } from "./entity-watch";
import { relevanceSql } from "./home-relevance";
import {
  formatEventDate,
  HOME_TICKER_ARRIVAL_WINDOW_DAYS,
  HOME_TICKER_FUTURE_WINDOW_DAYS,
  HOME_TICKER_MAX_ITEMS,
  orderAndDedupeTickerItems,
  startOfUtcDay,
  tickerItemId,
  type HomeTickerEntityType,
  type HomeTickerItem,
  type TickerProvider,
} from "../lib/home-ticker-presenter";
import { publicWatchProviderLogo } from "@screena/legal/public-credits";
import {
  selectTickerWatchOffer,
  type WatchAvailabilityRow,
} from "../lib/watch-availability-presenter";
import { watchModalityLabel } from "../lib/watch-offer-modality";
import { MOVIES_INDEX_PATH, SERIES_INDEX_PATH } from "../lib/site";

export type {
  HomeTickerItem,
  HomeTickerEpisodeItem,
  HomeTickerMovieReleaseItem,
  HomeTickerSeriesReleaseItem,
  HomeTickerStreamingItem,
  HomeTickerKind,
  HomeTickerBadge,
  TickerProvider,
} from "../lib/home-ticker-presenter";

const LANGUAGE_CODE = "pt-BR";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Escopo da faixa. A home e a UNIAO; `/pt/filmes` e `/pt/series` levam SO a sua
 * vertical.
 *
 * POR QUE O ESCOPO ENTRA NA CONSULTA E NAO NUM `.filter()` DEPOIS. Porque o cap
 * (`HOME_TICKER_MAX_ITEMS`) e a deduplicacao por entidade rodam ANTES de
 * qualquer filtro externo: filtrar a saida devolveria uma faixa mais curta que o
 * proprio catalogo permite — o mesmo defeito que deixou `/pt/series` sem hero.
 *
 * As quatro fontes se dividem por natureza: episodio e estreia de temporada sao
 * eventos de SERIE; estreia de filme e evento de FILME; chegada ao streaming
 * existe nas duas e e escopada pelo `entity_type` da oferta.
 *
 * O que NAO existe: sessao de cinema. `movies.release_date` afirma "estreia", e
 * o sistema nao persiste sala, formato nem numero de sessoes — a faixa de
 * `/pt/filmes` nunca diz "em cartaz" nem "4 sessoes" (ver o comentario do item
 * `movie_release` abaixo).
 */
export type TickerScope = "home" | "movies" | "series";

/** A faixa deste escopo mostra eventos de serie (episodio/temporada)? */
function scopeIncludesSeries(scope: TickerScope): boolean {
  return scope !== "movies";
}

/** A faixa deste escopo mostra eventos de filme (estreia)? */
function scopeIncludesMovies(scope: TickerScope): boolean {
  return scope !== "series";
}

/**
 * Teto de linhas lidas por fonte de evento (cap EXPLÍCITO e consciente).
 *
 * A faixa exibe no máximo `HOME_TICKER_MAX_ITEMS` e deduplica por ENTIDADE, ou
 * seja: 60 linhas precisam render ~5 entidades distintas. Isso cobre com folga
 * qualquer catálogo real. O caso extremo conhecido é uma temporada inteira
 * estreando no mesmo dia numa única série (as 60 linhas seriam do mesmo
 * `tv_show_id`): a faixa então mostra MENOS itens reais, nunca itens inventados
 * para completar. É a troca certa — a alternativa seria fabricar novidade.
 */
const EVENT_FETCH_LIMIT = 60;

/** Teto de ofertas lidas na descoberta de chegadas ao streaming. */
const ARRIVAL_FETCH_LIMIT = 40;

/** Teto de ofertas lidas na resolução em lote de provedores. */
const PROVIDER_FETCH_LIMIT = 160;

type PrismaClient = ReturnType<typeof getPrismaClient>;

/** Chave de mapa por entidade (`movie:12` / `tv:34`). */
function entityKey(entityType: HomeTickerEntityType, entityId: bigint | string): string {
  return `${entityType}:${entityId.toString()}`;
}

/** `YYYY-MM-DD` em UTC — a coluna é `@db.Date`; não alegamos hora. */
function toDateIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Linha de episódio na forma que a montagem lê (a mesma do `select` Prisma). */
interface EpisodeEventRow {
  tvShowId: bigint;
  episodeNumber: number;
  name: string | null;
  airDate: Date | null;
  season: { seasonNumber: number; tvShow: { nameOriginal: string } };
}

/** Linha de estreia de filme na forma que a montagem lê. */
interface MovieEventRow {
  id: bigint;
  titleOriginal: string;
  releaseDate: Date | null;
}

/** Linha de estreia de temporada na forma que a montagem lê. */
interface SeasonEventRow {
  tvShowId: bigint;
  seasonNumber: number;
  airDate: Date | null;
  tvShow: { nameOriginal: string };
}

/**
 * ============================================================================
 * NA HOME, A FAIXA SÓ ANUNCIA TÍTULO QUE ESTÁ NO ÍNDICE (decisão do dono, 13/10/2026)
 * ============================================================================
 * Medido no ar em 13/10/2026: o "NOVO" da home era "Ukryta prawda · T29 · E32 ·
 * novo episódio hoje" — novela polonesa cuja ficha responde `noindex, follow`
 * pelo portão de relevância de 24/09. A descoberta ordena por data e depois por
 * `tv_show_id`, então quem exibe episódio TODO DIA (novela, talk show) ocupava a
 * faixa por frequência, e não por interesse.
 *
 * O portão entra NA CONSULTA, e não num `.filter()` depois: o teto
 * (`EVENT_FETCH_LIMIT`) corta antes, e filtrar a saída devolveria uma faixa
 * vazia num dia de muitas novelas. Por isso estas três consultas são SQL — o
 * ramo "oferta no Brasil" do portão é uma tabela polimórfica, sem relação
 * Prisma que o `where` alcance. A ordem e as janelas são as MESMAS das
 * consultas Prisma das verticais; a data vai como `YYYY-MM-DD` para que o fuso
 * da sessão nunca desloque o dia. A chegada ao streaming não precisa disto: ela
 * já exige oferta licenciada no Brasil, que é um dos ramos do portão.
 */
async function relevantEpisodeEvents(
  prisma: PrismaClient,
  from: Date,
  to: Date,
): Promise<EpisodeEventRow[]> {
  const params: unknown[] = [toDateIso(from), toDateIso(to)];
  const relevance = relevanceSql("tv", "t", params);
  params.push(EVENT_FETCH_LIMIT);
  const rows = await prisma.$queryRawUnsafe<
    {
      tv_show_id: bigint;
      episode_number: number;
      name: string | null;
      air_date: Date | null;
      season_number: number;
      name_original: string;
    }[]
  >(
    `SELECT e.tv_show_id, e.episode_number, e.name, e.air_date, s.season_number, t.name_original
       FROM episodes e
       JOIN seasons s ON s.id = e.season_id
       JOIN tv_shows t ON t.id = e.tv_show_id
      WHERE e.air_date >= $1::date AND e.air_date < $2::date
        AND ${relevance}
      ORDER BY e.air_date ASC, e.tv_show_id ASC, e.episode_number ASC
      LIMIT $${params.length}`,
    ...params,
  );
  return rows.map((row) => ({
    tvShowId: row.tv_show_id,
    episodeNumber: row.episode_number,
    name: row.name,
    airDate: row.air_date,
    season: { seasonNumber: row.season_number, tvShow: { nameOriginal: row.name_original } },
  }));
}

async function relevantMovieEvents(
  prisma: PrismaClient,
  from: Date,
  to: Date,
): Promise<MovieEventRow[]> {
  const params: unknown[] = [toDateIso(from), toDateIso(to)];
  const relevance = relevanceSql("movie", "m", params);
  params.push(EVENT_FETCH_LIMIT);
  const rows = await prisma.$queryRawUnsafe<
    { id: bigint; title_original: string; release_date: Date | null }[]
  >(
    `SELECT m.id, m.title_original, m.release_date
       FROM movies m
      WHERE m.release_date >= $1::date AND m.release_date < $2::date
        AND ${relevance}
      ORDER BY m.release_date ASC, m.id ASC
      LIMIT $${params.length}`,
    ...params,
  );
  return rows.map((row) => ({
    id: row.id,
    titleOriginal: row.title_original,
    releaseDate: row.release_date,
  }));
}

async function relevantSeasonEvents(
  prisma: PrismaClient,
  from: Date,
  to: Date,
): Promise<SeasonEventRow[]> {
  const params: unknown[] = [toDateIso(from), toDateIso(to)];
  const relevance = relevanceSql("tv", "t", params);
  params.push(EVENT_FETCH_LIMIT);
  const rows = await prisma.$queryRawUnsafe<
    { tv_show_id: bigint; season_number: number; air_date: Date | null; name_original: string }[]
  >(
    // `season_number = 0` é "especiais" no TMDB: não é estreia de temporada.
    `SELECT s.tv_show_id, s.season_number, s.air_date, t.name_original
       FROM seasons s
       JOIN tv_shows t ON t.id = s.tv_show_id
      WHERE s.air_date >= $1::date AND s.air_date < $2::date
        AND s.season_number > 0
        AND ${relevance}
      ORDER BY s.air_date ASC, s.tv_show_id ASC, s.season_number ASC
      LIMIT $${params.length}`,
    ...params,
  );
  return rows.map((row) => ({
    tvShowId: row.tv_show_id,
    seasonNumber: row.season_number,
    airDate: row.air_date,
    tvShow: { nameOriginal: row.name_original },
  }));
}

const WATCH_OFFER_SELECT = {
  entityType: true,
  entityId: true,
  providerName: true,
  providerKey: true,
  // Mesmos dois campos que o painel de detalhe passou a ler: o slug canonico
  // (identidade da plataforma entre fornecedores) e o destino do agregador
  // (unico que a origem TMDB tem). Sem eles a faixa da home aplicaria uma regra
  // de precedencia diferente da do painel — duas verdades para o mesmo dado.
  watchProvider: { select: { slug: true } },
  offerType: true,
  deepLink: true,
  webUrl: true,
  quality: true,
  price: true,
  currency: true,
  displayAllowed: true,
  fetchedAt: true,
  requiresAttribution: true,
  requiresLinkback: true,
  attributionText: true,
  attributionUrl: true,
} as const;

type WatchOfferRow = {
  entityType: string;
  entityId: bigint;
  providerName: string;
  providerKey: string | null;
  watchProvider: { slug: string } | null;
  offerType: unknown;
  deepLink: string | null;
  webUrl: string | null;
  quality: string | null;
  price: { toString: () => string } | null;
  currency: string | null;
  displayAllowed: boolean;
  fetchedAt: Date | null;
  requiresAttribution: boolean;
  requiresLinkback: boolean;
  attributionText: string | null;
  attributionUrl: string | null;
};

function toWatchRow(row: WatchOfferRow): WatchAvailabilityRow {
  return {
    providerName: row.providerName,
    providerKey: row.providerKey,
    providerSlug: row.watchProvider?.slug ?? null,
    offerType: row.offerType === null ? null : String(row.offerType),
    deepLink: row.deepLink,
    webUrl: row.webUrl,
    quality: row.quality,
    priceAmount: row.price === null ? null : row.price.toString(),
    currency: row.currency,
    displayAllowed: row.displayAllowed,
    fetchedAtIso: row.fetchedAt === null ? null : row.fetchedAt.toISOString(),
    requiresAttribution: row.requiresAttribution,
    requiresLinkback: row.requiresLinkback,
    attributionText: row.attributionText,
    attributionUrl: row.attributionUrl,
  };
}

/**
 * Provedor legal por entidade, em UMA query para TODAS as entidades candidatas
 * (filmes e séries juntos) — nunca uma consulta de streaming por item.
 *
 * O gate é o compartilhado `licensedWatchWhere(now)`, o MESMO do painel de
 * detalhe e do hub /pt/onde-assistir; a escolha final é do presenter puro
 * `selectTickerWatchOffer`, que reaplica os gates (display_allowed, modalidade
 * legal, deep link http/https, atribuição/linkback exigidos) e ordena de forma
 * determinística. Não existe segunda regra de autorização neste caminho.
 */
async function resolveProviders(
  prisma: PrismaClient,
  movieIds: readonly bigint[],
  tvIds: readonly bigint[],
  now: Date,
): Promise<Map<string, TickerProvider>> {
  const out = new Map<string, TickerProvider>();
  if (movieIds.length === 0 && tvIds.length === 0) return out;

  const scope = [
    ...(movieIds.length > 0
      ? [{ entityType: "movie" as const, entityId: { in: [...movieIds] } }]
      : []),
    ...(tvIds.length > 0 ? [{ entityType: "tv" as const, entityId: { in: [...tvIds] } }] : []),
  ];

  const rows = (await prisma.watchAvailability.findMany({
    where: { AND: [{ OR: scope }, licensedWatchWhere(now)] },
    take: PROVIDER_FETCH_LIMIT,
    select: WATCH_OFFER_SELECT,
  })) as unknown as WatchOfferRow[];

  const grouped = new Map<string, WatchAvailabilityRow[]>();
  for (const row of rows) {
    const key = entityKey(row.entityType as HomeTickerEntityType, row.entityId);
    const bucket = grouped.get(key) ?? [];
    bucket.push(toWatchRow(row));
    grouped.set(key, bucket);
  }

  for (const [key, candidates] of grouped) {
    const offer = selectTickerWatchOffer(candidates, {
      // Descarte NUNCA silencioso: um `offer_type` que a tela nao sabe nomear
      // vira linha de log com o valor cru, nunca rotulo inventado.
      onUnsupportedOfferType: (message) => console.warn(message),
    });
    if (offer === null) continue;
    out.set(key, {
      name: offer.providerName,
      key: offer.providerKey,
      // Logo pela LICENCA do provedor (slug canonico), nunca por nome.
      logo: publicWatchProviderLogo(offer.providerSlug, offer.providerName),
      // MODALIDADE em texto visivel (ver TickerProvider): nomear a loja sem
      // dizer "Aluguel" afirma que o titulo esta incluso numa assinatura.
      // (Sem citar marca nem em comentario: o guard varre o TEXTO do arquivo.)
      modalityLabel: watchModalityLabel(offer.offerType),
      attributionText: offer.attribution?.text ?? null,
      attributionUrl: offer.attribution?.url ?? null,
    });
  }
  return out;
}

interface EntityIdentity {
  title: string;
  href: string;
}

/**
 * Título pt-BR (com fallback para o nome original) e rota canônica de todas as
 * entidades candidatas — DUAS queries em lote (slugs e traduções), nunca uma
 * por item. Entidade sem slug canônico ou sem título fica de fora: a faixa
 * nunca produz link quebrado.
 */
async function resolveIdentities(
  prisma: PrismaClient,
  movieIds: readonly bigint[],
  tvIds: readonly bigint[],
  originalNames: ReadonlyMap<string, string>,
): Promise<Map<string, EntityIdentity>> {
  const out = new Map<string, EntityIdentity>();
  if (movieIds.length === 0 && tvIds.length === 0) return out;

  const scope = [
    ...(movieIds.length > 0
      ? [{ entityType: "movie" as const, entityId: { in: [...movieIds] } }]
      : []),
    ...(tvIds.length > 0 ? [{ entityType: "tv" as const, entityId: { in: [...tvIds] } }] : []),
  ];

  const [slugs, translations] = await Promise.all([
    prisma.slug.findMany({
      where: { OR: scope, languageCode: LANGUAGE_CODE, isCanonical: true },
      select: { entityType: true, entityId: true, slug: true },
    }),
    prisma.entityTranslation.findMany({
      where: { OR: scope, languageCode: LANGUAGE_CODE },
      select: { entityType: true, entityId: true, title: true },
    }),
  ]);

  const titleByKey = new Map<string, string>();
  for (const row of translations) {
    const title = row.title?.trim();
    if (title) titleByKey.set(entityKey(row.entityType as HomeTickerEntityType, row.entityId), title);
  }

  for (const row of slugs) {
    const type = row.entityType as HomeTickerEntityType;
    const key = entityKey(type, row.entityId);
    const title = titleByKey.get(key) ?? originalNames.get(key)?.trim() ?? "";
    if (title === "") continue;
    const base = type === "movie" ? MOVIES_INDEX_PATH : SERIES_INDEX_PATH;
    out.set(key, { title, href: `${base}${row.slug}/` });
  }
  return out;
}

/**
 * Itens da faixa amarela: novidades REAIS agregadas das quatro fontes, já
 * ordenadas (hoje -> futuro por data -> chegada ao streaming) e deduplicadas
 * (uma novidade por entidade). Lista vazia = faixa em estado neutro.
 */
export const getHomeTickerItems = cache(async (
  scope: TickerScope = "home",
): Promise<HomeTickerItem[]> => {
  const prisma = getPrismaClient();
  const now = new Date();
  const dayStart = startOfUtcDay(now);
  const dayEnd = new Date(dayStart.getTime() + MS_PER_DAY);
  const futureEnd = new Date(dayEnd.getTime() + HOME_TICKER_FUTURE_WINDOW_DAYS * MS_PER_DAY);
  const arrivalStart = new Date(dayStart.getTime() - HOME_TICKER_ARRIVAL_WINDOW_DAYS * MS_PER_DAY);

  // ------------------------------------------------------------ descoberta
  // Quatro queries de EVENTO, cada uma com janela e teto próprios. Nenhuma
  // depende do resultado das outras: rodam em paralelo.
  const wantsSeries = scopeIncludesSeries(scope);
  const wantsMovies = scopeIncludesMovies(scope);

  // Escopo territorial da chegada ao streaming: a home aceita as duas, cada
  // vertical aceita so a sua. Sem nenhum tipo aceito a query nem acontece.
  const arrivalTypes = [
    ...(wantsMovies ? [{ entityType: "movie" as const }] : []),
    ...(wantsSeries ? [{ entityType: "tv" as const }] : []),
  ];

  // Só a HOME passa pelo portão de relevância (ver `relevantEpisodeEvents`);
  // as verticais seguem nas consultas Prisma abaixo.
  const relevantOnly = scope === "home";

  const discoverEpisodes = (): Promise<EpisodeEventRow[]> =>
    relevantOnly
      ? relevantEpisodeEvents(prisma, dayStart, futureEnd)
      : prisma.episode.findMany({
          where: { airDate: { gte: dayStart, lt: futureEnd } },
          take: EVENT_FETCH_LIMIT,
          orderBy: [{ airDate: "asc" }, { tvShowId: "asc" }, { episodeNumber: "asc" }],
          select: {
            tvShowId: true,
            episodeNumber: true,
            name: true,
            airDate: true,
            // `season_number` é DERIVADO de seasons (o episódio não o armazena).
            season: { select: { seasonNumber: true, tvShow: { select: { nameOriginal: true } } } },
          },
        });

  const discoverMovies = (): Promise<MovieEventRow[]> =>
    relevantOnly
      ? relevantMovieEvents(prisma, dayStart, futureEnd)
      : prisma.movie.findMany({
          where: { releaseDate: { gte: dayStart, lt: futureEnd } },
          take: EVENT_FETCH_LIMIT,
          orderBy: [{ releaseDate: "asc" }, { id: "asc" }],
          select: { id: true, titleOriginal: true, releaseDate: true },
        });

  const discoverSeasons = (): Promise<SeasonEventRow[]> =>
    relevantOnly
      ? relevantSeasonEvents(prisma, dayStart, futureEnd)
      : prisma.season.findMany({
          // `season_number = 0` é "especiais" no TMDB: não é estreia de temporada.
          where: { airDate: { gte: dayStart, lt: futureEnd }, seasonNumber: { gt: 0 } },
          take: EVENT_FETCH_LIMIT,
          orderBy: [{ airDate: "asc" }, { tvShowId: "asc" }, { seasonNumber: "asc" }],
          select: {
            tvShowId: true,
            seasonNumber: true,
            airDate: true,
            tvShow: { select: { nameOriginal: true } },
          },
        });

  const [episodes, movies, seasons, arrivals] = await Promise.all([
    wantsSeries ? discoverEpisodes() : Promise.resolve([]),
    wantsMovies ? discoverMovies() : Promise.resolve([]),
    wantsSeries ? discoverSeasons() : Promise.resolve([]),
    arrivalTypes.length === 0 ? Promise.resolve([]) : prisma.watchAvailability.findMany({
      where: {
        AND: [
          { OR: arrivalTypes },
          { availableFrom: { gte: arrivalStart, lte: now } },
          licensedWatchWhere(now),
        ],
      },
      take: ARRIVAL_FETCH_LIMIT,
      orderBy: [{ availableFrom: "desc" }, { id: "asc" }],
      select: { entityType: true, entityId: true, availableFrom: true },
    }),
  ]);

  // ------------------------------------------- candidatos e nomes originais
  const movieIdSet = new Map<string, bigint>();
  const tvIdSet = new Map<string, bigint>();
  const originalNames = new Map<string, string>();

  for (const episode of episodes) {
    tvIdSet.set(episode.tvShowId.toString(), episode.tvShowId);
    originalNames.set(entityKey("tv", episode.tvShowId), episode.season.tvShow.nameOriginal);
  }
  for (const movie of movies) {
    movieIdSet.set(movie.id.toString(), movie.id);
    originalNames.set(entityKey("movie", movie.id), movie.titleOriginal);
  }
  for (const season of seasons) {
    tvIdSet.set(season.tvShowId.toString(), season.tvShowId);
    originalNames.set(entityKey("tv", season.tvShowId), season.tvShow.nameOriginal);
  }
  for (const arrival of arrivals) {
    if (arrival.entityType === "movie") movieIdSet.set(arrival.entityId.toString(), arrival.entityId);
    else if (arrival.entityType === "tv") tvIdSet.set(arrival.entityId.toString(), arrival.entityId);
  }

  const movieIds = [...movieIdSet.values()];
  const tvIds = [...tvIdSet.values()];
  if (movieIds.length === 0 && tvIds.length === 0) return [];

  // ------------------------------------------------- backfill de nome (0–2)
  // A query de chegadas ao streaming traz só id e data. Quem apareceu SÓ por
  // ela ainda não tem nome original — as outras três já trouxeram o seu. Só
  // essas entidades são consultadas; sem nenhuma, nenhuma query acontece.
  const movieIdsMissingName = movieIds.filter((id) => !originalNames.has(entityKey("movie", id)));
  const tvIdsMissingName = tvIds.filter((id) => !originalNames.has(entityKey("tv", id)));
  const [missingMovieNames, missingTvNames] = await Promise.all([
    movieIdsMissingName.length > 0
      ? prisma.movie.findMany({
          where: { id: { in: movieIdsMissingName } },
          select: { id: true, titleOriginal: true },
        })
      : Promise.resolve([]),
    tvIdsMissingName.length > 0
      ? prisma.tvShow.findMany({
          where: { id: { in: tvIdsMissingName } },
          select: { id: true, nameOriginal: true },
        })
      : Promise.resolve([]),
  ]);
  for (const row of missingMovieNames) {
    originalNames.set(entityKey("movie", row.id), row.titleOriginal);
  }
  for (const row of missingTvNames) {
    originalNames.set(entityKey("tv", row.id), row.nameOriginal);
  }

  const [identities, providers] = await Promise.all([
    resolveIdentities(prisma, movieIds, tvIds, originalNames),
    resolveProviders(prisma, movieIds, tvIds, now),
  ]);

  // ---------------------------------------------------------- montagem
  const items: HomeTickerItem[] = [];
  const todayMs = dayStart.getTime();
  const isToday = (date: Date): boolean =>
    date.getTime() >= todayMs && date.getTime() < todayMs + MS_PER_DAY;

  for (const episode of episodes) {
    if (episode.airDate === null) continue;
    const key = entityKey("tv", episode.tvShowId);
    const identity = identities.get(key);
    if (identity === undefined) continue;
    const today = isToday(episode.airDate);
    const eventAtIso = toDateIso(episode.airDate);
    const episodeTitle = episode.name?.trim() || null;
    const seasonEp = `T${episode.season.seasonNumber} · E${episode.episodeNumber}`;
    items.push({
      kind: today ? "episode_today" : "episode_upcoming",
      id: tickerItemId(today ? "episode_today" : "episode_upcoming", "tv", key, eventAtIso),
      badge: today ? "NOVO" : "EM BREVE",
      title: identity.title,
      detail: [
        seasonEp,
        episodeTitle,
        today ? "novo episódio hoje" : `estreia em ${formatEventDate(episode.airDate)}`,
      ]
        .filter((part): part is string => part !== null)
        .join(" · "),
      href: identity.href,
      provider: providers.get(key) ?? null,
      eventAtIso,
      entityType: "tv",
      entityId: episode.tvShowId.toString(),
      seasonEp,
      episodeTitle,
    });
  }

  for (const movie of movies) {
    if (movie.releaseDate === null) continue;
    const key = entityKey("movie", movie.id);
    const identity = identities.get(key);
    if (identity === undefined) continue;
    const today = isToday(movie.releaseDate);
    const eventAtIso = toDateIso(movie.releaseDate);
    items.push({
      kind: "movie_release",
      id: tickerItemId("movie_release", "movie", movie.id.toString(), eventAtIso),
      badge: today ? "NOVO" : "EM BREVE",
      title: identity.title,
      // "estreia hoje" é o que `release_date` afirma. "Em cartaz" seria outro
      // fato (sessão numa sala), que o sistema NÃO tem persistido.
      detail: today ? "estreia hoje" : `estreia em ${formatEventDate(movie.releaseDate)}`,
      href: identity.href,
      provider: providers.get(key) ?? null,
      eventAtIso,
      entityType: "movie",
      entityId: movie.id.toString(),
    });
  }

  for (const season of seasons) {
    if (season.airDate === null) continue;
    const key = entityKey("tv", season.tvShowId);
    const identity = identities.get(key);
    if (identity === undefined) continue;
    const today = isToday(season.airDate);
    const eventAtIso = toDateIso(season.airDate);
    items.push({
      kind: "series_release",
      id: tickerItemId("series_release", "tv", season.tvShowId.toString(), eventAtIso),
      badge: today ? "NOVO" : "EM BREVE",
      title: identity.title,
      detail: today
        ? `temporada ${season.seasonNumber} disponível hoje`
        : `temporada ${season.seasonNumber} estreia em ${formatEventDate(season.airDate)}`,
      href: identity.href,
      provider: providers.get(key) ?? null,
      eventAtIso,
      entityType: "tv",
      entityId: season.tvShowId.toString(),
      seasonNumber: season.seasonNumber,
    });
  }

  for (const arrival of arrivals) {
    const type = arrival.entityType === "movie" ? "movie" : "tv";
    const key = entityKey(type, arrival.entityId);
    const identity = identities.get(key);
    const provider = providers.get(key);
    // Chegada ao streaming SÓ existe com provedor aprovado pelo gate: sem ele o
    // item não é "recém-chegou a lugar nenhum" — simplesmente não existe.
    if (identity === undefined || provider === undefined) continue;
    const eventAtIso = arrival.availableFrom === null ? null : arrival.availableFrom.toISOString();
    items.push({
      kind: "streaming_arrival",
      id: tickerItemId("streaming_arrival", type, arrival.entityId.toString(), eventAtIso),
      badge: "NOVO",
      title: identity.title,
      detail: "chegou ao streaming",
      href: identity.href,
      provider,
      eventAtIso,
      entityType: type,
      entityId: arrival.entityId.toString(),
    });
  }

  return orderAndDedupeTickerItems(items, now, HOME_TICKER_MAX_ITEMS);
});
