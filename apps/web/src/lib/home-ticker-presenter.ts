/**
 * home-ticker-presenter.ts — Presenter PURO da faixa amarela da home. Sem rede,
 * sem DB, sem IO.
 *
 * A faixa é um CARROSSEL INDEPENDENTE de novidades reais: quatro a cinco itens,
 * um visível por vez, dots representando todos. Ela não é "o episódio de hoje
 * ou um fallback" — agrega quatro fontes distintas do PostgreSQL:
 *
 *   episódio (hoje / próximo)  ·  estreia de filme  ·  estreia de temporada
 *   ·  chegada ao streaming (oferta licenciada)
 *
 * Nada é inferido. Cada item nasce de um campo persistido (`episodes.air_date`,
 * `movies.release_date`, `seasons.air_date` + `season_number`,
 * `watch_availability.available_from` já aprovado pelo gate de licença). O
 * presenter apenas classifica, deduplica, ordena e corta.
 *
 * O que este módulo NUNCA produz (o sistema não tem esses dados persistidos):
 * sessão de cinema, formato de exibição (70mm), idioma da sessão, rede/cinema,
 * horário, cidade — e nunca "em cartaz" inferido de `release_date`. Um filme com
 * data de estreia estreia; estar em cartaz numa sala é outro fato, que não
 * existe no banco.
 */

/** Tipos de novidade que a faixa sabe representar. */
export type HomeTickerKind =
  | "episode_today"
  | "episode_upcoming"
  | "movie_release"
  | "series_release"
  | "streaming_arrival";

/** Selo exibido à esquerda da faixa. */
export type HomeTickerBadge = "NOVO" | "EM BREVE" | "AGENDA";

/** Entidades que a faixa pode apontar (as que têm rota pública de ficha). */
export type HomeTickerEntityType = "movie" | "tv";

/**
 * Provedor legal de UM item — já aprovado pelo MESMO gate de licença do painel
 * de detalhe (`licensedWatchWhere` + presenter puro). Nunca plataforma
 * inventada, nunca logo (a licença do agregador não autoriza logo).
 *
 * O NOME deste tipo é contrato de governança: `tests/governance/
 * no-fake-streaming-in-ui.test.ts` só permite que um componente cite streaming
 * quando o arquivo referencia um identificador do contrato real, e
 * `TickerProvider` é um deles.
 */
export interface TickerProvider {
  /** Nome do provedor como licenciado (texto; nunca logo). */
  name: string;
  /** `watch_availability.provider_key` — chave estável. */
  key: string;
  /** Crédito exigido pela licença, quando exigido; senão null. */
  attributionText: string | null;
  /** Linkback exigido pela licença, quando exigido; senão null. */
  attributionUrl: string | null;
}

interface HomeTickerBase {
  /** Identidade estável do item (`{kind}:{entityType}:{entityId}:{eventAt}`). */
  id: string;
  kind: HomeTickerKind;
  badge: HomeTickerBadge;
  /** Nome da entidade (renderizado em destaque). */
  title: string;
  /** Complemento factual já formatado (nunca inventado). */
  detail: string;
  /** Rota real da ficha (`/pt/filmes/{slug}/` ou `/pt/series/{slug}/`). */
  href: string;
  provider: TickerProvider | null;
  /** Data do evento em ISO (`YYYY-MM-DD` ou instante), ou null. */
  eventAtIso: string | null;
  entityType: HomeTickerEntityType;
  /** `movies.id` / `tv_shows.id` como string (BigInt não atravessa o boundary). */
  entityId: string;
}

/** Episódio: o único item que carrega código de temporada/episódio. */
export interface HomeTickerEpisodeItem extends HomeTickerBase {
  kind: "episode_today" | "episode_upcoming";
  entityType: "tv";
  /** "T2 · E5" — ambos os números vêm do banco. */
  seasonEp: string;
  episodeTitle: string | null;
}

export interface HomeTickerMovieReleaseItem extends HomeTickerBase {
  kind: "movie_release";
  entityType: "movie";
}

export interface HomeTickerSeriesReleaseItem extends HomeTickerBase {
  kind: "series_release";
  entityType: "tv";
  /** Número da temporada PERSISTIDO; nunca deduzido. */
  seasonNumber: number;
}

export interface HomeTickerStreamingItem extends HomeTickerBase {
  kind: "streaming_arrival";
  /** Chegada ao streaming só existe com oferta licenciada — provedor obrigatório. */
  provider: TickerProvider;
}

export type HomeTickerItem =
  | HomeTickerEpisodeItem
  | HomeTickerMovieReleaseItem
  | HomeTickerSeriesReleaseItem
  | HomeTickerStreamingItem;

/** Teto duro de itens exibidos na faixa. */
export const HOME_TICKER_MAX_ITEMS = 5;

/** Quantidade desejada; abaixo dela a faixa mostra só o que é real. */
export const HOME_TICKER_TARGET_ITEMS = 4;

/** Janela de "próximos dias" priorizada depois dos eventos de hoje. */
export const HOME_TICKER_NEAR_WINDOW_DAYS = 7;

/** Janela máxima de lançamento futuro considerado. */
export const HOME_TICKER_FUTURE_WINDOW_DAYS = 30;

/** Janela retroativa de "recém-chegou ao streaming". */
export const HOME_TICKER_ARRIVAL_WINDOW_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Início do dia UTC (mesma janela usada pelas queries do loader). */
export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** "30 de julho" — data curta pt-BR em UTC (sem alegar hora). */
export function formatEventDate(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(date);
}

/**
 * Balde de ordenação (contrato de ordenação da faixa):
 *  0 — acontece HOJE;
 *  1 — acontece no FUTURO (ordenado por data crescente);
 *  2 — chegada ao streaming já vigente (ordenada da mais recente para a antiga).
 */
function bucketOf(item: HomeTickerItem, dayStartMs: number): 0 | 1 | 2 {
  const eventMs = item.eventAtIso === null ? null : Date.parse(item.eventAtIso);
  if (item.kind === "streaming_arrival") {
    // Uma oferta que passa a valer HOJE é acontecimento de hoje.
    if (eventMs !== null && eventMs >= dayStartMs && eventMs < dayStartMs + MS_PER_DAY) {
      return 0;
    }
    return 2;
  }
  if (eventMs === null) return 1;
  if (eventMs < dayStartMs + MS_PER_DAY) return 0;
  return 1;
}

/** Desempate por tipo, para que a ordem seja total e reprodutível. */
const KIND_RANK: Readonly<Record<HomeTickerKind, number>> = {
  episode_today: 0,
  series_release: 1,
  movie_release: 2,
  streaming_arrival: 3,
  episode_upcoming: 4,
};

function compareItems(
  a: HomeTickerItem,
  b: HomeTickerItem,
  dayStartMs: number,
): number {
  const bucketA = bucketOf(a, dayStartMs);
  const bucketB = bucketOf(b, dayStartMs);
  if (bucketA !== bucketB) return bucketA - bucketB;

  const msA = a.eventAtIso === null ? null : Date.parse(a.eventAtIso);
  const msB = b.eventAtIso === null ? null : Date.parse(b.eventAtIso);
  if (msA !== null && msB !== null && msA !== msB) {
    // Futuro: o mais próximo primeiro. Chegada ao streaming: a mais recente.
    return bucketA === 2 ? msB - msA : msA - msB;
  }
  if (KIND_RANK[a.kind] !== KIND_RANK[b.kind]) {
    return KIND_RANK[a.kind] - KIND_RANK[b.kind];
  }
  return a.id.localeCompare(b.id);
}

/**
 * Deduplica e corta. DUAS camadas, nesta ordem:
 *
 *  1. identidade exata do item (`kind` + entidade + data) — a mesma novidade
 *     nunca aparece duas vezes;
 *  2. UMA novidade por ENTIDADE — a mesma série não ocupa dois slots só para
 *     alcançar cinco itens, e um filme não aparece como `movie_release` E
 *     `streaming_arrival` quando os dois comunicam o mesmo fato. Vence o item
 *     que já ficou em primeiro na ordenação (o mais relevante).
 */
export function orderAndDedupeTickerItems(
  items: readonly HomeTickerItem[],
  now: Date,
  max: number = HOME_TICKER_MAX_ITEMS,
): HomeTickerItem[] {
  const dayStartMs = startOfUtcDay(now).getTime();
  const sorted = [...items].sort((a, b) => compareItems(a, b, dayStartMs));

  const cap = Number.isInteger(max) && max > 0 ? max : HOME_TICKER_MAX_ITEMS;
  const seenIds = new Set<string>();
  const seenEntities = new Set<string>();
  const out: HomeTickerItem[] = [];

  for (const item of sorted) {
    if (seenIds.has(item.id)) continue;
    const entityKey = `${item.entityType}:${item.entityId}`;
    if (seenEntities.has(entityKey)) continue;
    seenIds.add(item.id);
    seenEntities.add(entityKey);
    out.push(item);
    if (out.length >= cap) break;
  }
  return out;
}

/** Identidade estável de um item (também é a chave de dedupe exata). */
export function tickerItemId(
  kind: HomeTickerKind,
  entityType: HomeTickerEntityType,
  entityId: string,
  eventAtIso: string | null,
): string {
  return `${kind}:${entityType}:${entityId}:${eventAtIso ?? "-"}`;
}
