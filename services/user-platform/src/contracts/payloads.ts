/**
 * Payload contracts da user platform (missao secao 12) — as formas de SAIDA
 * que a futura borda HTTP serializa para o cliente.
 *
 * PURO: nao faz rede, DB nem IO. Regras de serializacao:
 *  - Ids internos sao BigInt no banco (decisao D6); em payload viram STRING
 *    decimal (BigInt nao sobrevive a JSON.stringify) — use serializeEntityId
 *    e parseEntityId nas fronteiras.
 *  - Datas viram string ISO 8601 UTC (ex.: "2026-07-17T12:00:00.000Z").
 *  - Nada privado ou unlisted entra em payload PUBLICO (decisao secao 2);
 *    estes contratos servem primeiro a superficie autenticada do dono.
 *  - Nota de usuario NUNCA se mistura com fontes externas (invariantes 1/2):
 *    UserRatingPayload nao tem rating_source/provider_api de proposito.
 */

import { type DomainResult, err, ok } from "../core/result.js";
import type {
  ProfileVisibility,
  RatableEntityType,
  ReviewModerationStatus,
  SystemListKey,
  UserListKind,
  ViewingEventType,
  Visibility,
  WatchableEntityType,
  WatchState,
} from "../core/types.js";

// ---------------------------------------------------------------------------
// Aliases de serializacao (documentacao de intencao)
// ---------------------------------------------------------------------------

/** Data/hora serializada como ISO 8601 UTC (ex.: "2026-07-17T12:00:00.000Z"). */
export type IsoDateTimeString = string;

/** Id interno (BigInt do banco) serializado como string decimal. */
export type EntityIdString = string;

// ---------------------------------------------------------------------------
// Helpers puros de id (bigint <-> string)
// ---------------------------------------------------------------------------

/**
 * Padrao canonico de id serializado: inteiro decimal positivo, sem zeros a
 * esquerda (garante round-trip byte a byte com serializeEntityId) e com no
 * maximo 19 digitos (teto do int8 do Postgres).
 */
const ENTITY_ID_PATTERN = /^[1-9][0-9]{0,18}$/;

/** Maior valor de bigint (int8) aceito pelo Postgres. */
const INT8_MAX = 9223372036854775807n;

/** Serializa uma PK BigInt do banco como string decimal para payload/JSON. */
export function serializeEntityId(id: bigint): string {
  return id.toString(10);
}

/**
 * Faz o parse de um id serializado de volta para BigInt.
 *
 * Fail-closed: rejeita vazio, nao-decimal, zero, zeros a esquerda, sinal e
 * valores acima do int8 — a mensagem nunca ecoa conteudo sensivel.
 */
export function parseEntityId(raw: string): DomainResult<bigint> {
  if (!ENTITY_ID_PATTERN.test(raw)) {
    return err("validation_failed", "id de entidade invalido.", [
      "id deve ser um inteiro decimal positivo sem zeros a esquerda",
    ]);
  }
  const value = BigInt(raw);
  if (value > INT8_MAX) {
    return err("validation_failed", "id de entidade invalido.", [
      "id excede o intervalo de bigint (int8) do banco",
    ]);
  }
  return ok(value);
}

// ---------------------------------------------------------------------------
// 1. Perfil
// ---------------------------------------------------------------------------

/** Perfil de usuario. Privado por padrao (decisao secao 2). */
export interface UserProfilePayload {
  readonly userId: EntityIdString;
  readonly displayName: string;
  /** Caminho local do avatar (nunca URL externa no render) ou null. */
  readonly avatarPath: string | null;
  readonly bio: string | null;
  readonly visibility: ProfileVisibility;
  readonly emailVerified: boolean;
  readonly createdAt: IsoDateTimeString;
}

// ---------------------------------------------------------------------------
// 2. Dashboard (snapshot assincrono — nunca calculado no request)
// ---------------------------------------------------------------------------

/** Estatisticas materializadas por snapshot (decisao secao 10). */
export interface UserDashboardStats {
  readonly moviesWatched: number;
  readonly episodesWatched: number;
  readonly minutesWatched: number;
  readonly ratingsCount: number;
  readonly reviewsCount: number;
  readonly listsCount: number;
  readonly currentStreakDays: number;
}

/**
 * Dashboard do dono da conta: perfil + snapshot de estatisticas + atividade
 * recente. generatedAt e a data do SNAPSHOT (o render le pronto, zero
 * trabalho pesado no request — invariante 3 em espirito).
 */
export interface UserDashboardPayload {
  readonly profile: UserProfilePayload;
  readonly stats: UserDashboardStats;
  readonly recentEvents: readonly DiaryEventPayload[];
  readonly generatedAt: IsoDateTimeString;
}

// ---------------------------------------------------------------------------
// 3. Watch state (projecao atual; historico vive no diario)
// ---------------------------------------------------------------------------

/** Estado de acompanhamento por (usuario, entidade). Um por entidade. */
export interface WatchStatePayload {
  readonly userId: EntityIdString;
  readonly entityType: WatchableEntityType;
  readonly entityId: EntityIdString;
  readonly status: WatchState;
  readonly visibility: Visibility;
  /** Versao para optimistic locking (header Expected-Version na escrita). */
  readonly version: number;
  readonly startedAt: IsoDateTimeString | null;
  readonly finishedAt: IsoDateTimeString | null;
  readonly updatedAt: IsoDateTimeString;
}

// ---------------------------------------------------------------------------
// 4. Progresso de episodio
// ---------------------------------------------------------------------------

/** Progresso por episodio (temporada/episodio nao usam watch state). */
export interface EpisodeProgressPayload {
  readonly userId: EntityIdString;
  readonly tvShowId: EntityIdString;
  readonly episodeId: EntityIdString;
  readonly watched: boolean;
  readonly progressSeconds: number | null;
  readonly durationSeconds: number | null;
  readonly watchedAt: IsoDateTimeString | null;
  readonly updatedAt: IsoDateTimeString;
}

// ---------------------------------------------------------------------------
// 5. Watchlist (lista de sistema)
// ---------------------------------------------------------------------------

/** Item da watchlist: so filme/serie (CHECK do banco). */
export interface WatchlistItemPayload {
  readonly entityType: WatchableEntityType;
  readonly entityId: EntityIdString;
  readonly addedAt: IsoDateTimeString;
}

/** Watchlist do usuario (lista de sistema "watchlist"). */
export interface WatchlistPayload {
  readonly userId: EntityIdString;
  readonly visibility: Visibility;
  readonly totalItems: number;
  readonly items: readonly WatchlistItemPayload[];
  readonly updatedAt: IsoDateTimeString;
}

// ---------------------------------------------------------------------------
// 6. Listas custom (com items)
// ---------------------------------------------------------------------------

/** Item de lista custom; position define a ordem quando ordered=true. */
export interface UserListItemPayload {
  readonly itemId: EntityIdString;
  readonly entityType: RatableEntityType;
  readonly entityId: EntityIdString;
  readonly position: number;
  readonly note: string | null;
  readonly addedAt: IsoDateTimeString;
}

/** Lista de usuario (system ou custom), sempre com os items embutidos. */
export interface UserListPayload {
  readonly listId: EntityIdString;
  readonly ownerUserId: EntityIdString;
  readonly kind: UserListKind;
  /** Preenchido apenas quando kind = "system". */
  readonly systemKey: SystemListKey | null;
  readonly title: string;
  readonly description: string | null;
  readonly visibility: Visibility;
  readonly ordered: boolean;
  readonly itemCount: number;
  readonly items: readonly UserListItemPayload[];
  readonly createdAt: IsoDateTimeString;
  readonly updatedAt: IsoDateTimeString;
}

// ---------------------------------------------------------------------------
// 7. Rating de usuario (NUNCA se mistura com fonte externa)
// ---------------------------------------------------------------------------

/**
 * Nota do usuario: 0.5..5.0 em passo 0.5, escala FIXA 5 (decisao secao 1).
 * Sem rating_source/provider_api de proposito: nota de usuario nao e rating
 * externo (invariantes 1 e 2) e nunca vira AggregateRating.
 */
export interface UserRatingPayload {
  readonly userId: EntityIdString;
  readonly entityType: RatableEntityType;
  readonly entityId: EntityIdString;
  readonly value: number;
  readonly scale: 5;
  readonly ratedAt: IsoDateTimeString;
  readonly updatedAt: IsoDateTimeString;
}

// ---------------------------------------------------------------------------
// 8. Review de usuario
// ---------------------------------------------------------------------------

/** Review de usuario: nasce pending e privada; spoiler e flag obrigatoria. */
export interface UserReviewPayload {
  readonly reviewId: EntityIdString;
  readonly authorUserId: EntityIdString;
  readonly entityType: RatableEntityType;
  readonly entityId: EntityIdString;
  readonly title: string | null;
  readonly body: string;
  readonly containsSpoiler: boolean;
  readonly moderationStatus: ReviewModerationStatus;
  readonly visibility: Visibility;
  readonly createdAt: IsoDateTimeString;
  readonly updatedAt: IsoDateTimeString;
}

// ---------------------------------------------------------------------------
// 9. Diario (eventos paginados; historico append-only)
// ---------------------------------------------------------------------------

/** Evento do diario. O diario e append-only; isto e leitura, nunca edicao. */
export interface DiaryEventPayload {
  readonly eventId: EntityIdString;
  readonly eventType: ViewingEventType;
  readonly entityType: RatableEntityType;
  readonly entityId: EntityIdString;
  readonly occurredAt: IsoDateTimeString;
}

/**
 * Pagina do diario com cursor opaco (append-only combina com cursor, nao com
 * offset). nextCursor null = fim do historico.
 */
export interface DiaryPayload {
  readonly userId: EntityIdString;
  readonly events: readonly DiaryEventPayload[];
  readonly pageSize: number;
  readonly nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// 10. Recomendacoes (snapshot persistido com explicacao — missao secao 9)
// ---------------------------------------------------------------------------

/** Explicacao de por que uma recomendacao apareceu (forma canonica da missao). */
export type RecommendationReason =
  | { type: 'because_you_rated'; entityId: string }
  | { type: 'because_you_watched'; entityId: string }
  | { type: 'genre_affinity'; genreId: string }
  | { type: 'trending_in_country'; countryCode: string };

/** Item recomendado com score do snapshot e as razoes que o geraram. */
export interface RecommendationItemPayload {
  readonly entityType: WatchableEntityType;
  readonly entityId: EntityIdString;
  /** Score relativo do snapshot (maior = mais relevante). */
  readonly score: number;
  readonly reasons: readonly RecommendationReason[];
}

/**
 * Snapshot de recomendacoes: gravado offline com algorithm_version, nunca
 * recalculado no request de render (invariante 3).
 */
export interface RecommendationPayload {
  readonly userId: EntityIdString;
  readonly algorithmVersion: string;
  readonly generatedAt: IsoDateTimeString;
  readonly items: readonly RecommendationItemPayload[];
}
