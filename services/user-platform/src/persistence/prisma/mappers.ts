/**
 * mappers.ts — conversao LINHA DO BANCO -> DTO de dominio (Backend C, C7B1).
 *
 * Regra unica deste modulo: nada sai daqui que o contrato nao tenha declarado.
 * Nenhum model do Prisma atravessa a fronteira e nenhum spread constroi DTO — os
 * campos sao escritos UM A UM, para que acrescentar uma coluna no schema jamais
 * vaze automaticamente para o dominio (e para a resposta HTTP, um dia).
 *
 * Ha exatamente UM cast no arquivo (`toUserStatus`), e ele nao converte model em
 * DTO: alarga o tipo do lookup para admitir `undefined` e permitir a checagem
 * fail-closed contra um banco a frente do client gerado. Registrado aqui porque
 * "nenhum cast" seria uma afirmacao falsa.
 */

import type { $Enums } from "@prisma/client";
import {
  AUTH_TOKEN_PURPOSES,
  USER_STATUSES,
  type AuthTokenPurpose,
  type ConsentKind,
  type DataRequestKind,
  type DataRequestStatus,
  type ImportJobStatus,
  type ImportSource,
  type ProfileVisibility,
  type RatableEntityType,
  type SystemListKey,
  type UserListKind,
  type UserRole,
  type UserStatus,
  type ViewingEventType,
  type Visibility,
  type WatchableEntityType,
  type WatchState,
} from "../../core/types.js";
import type {
  AuthenticatedUserRecord,
  AuthThrottleState,
  ConsentRecordRow,
  CredentialVerificationMaterial,
  DataRequestRecord,
  EmailVerificationState,
  EpisodeProgressRecord,
  IdentityRecord,
  ImportJobRecord,
  ProfileRecord,
  SessionAccessRecord,
  UserListItemRecord,
  UserListRecord,
  UserRatingRecord,
  ViewingEventRecord,
  WatchStateRecord,
} from "../types.js";

/**
 * Traducao EXPLICITA do enum do banco para o enum do dominio.
 *
 * O `Record<$Enums.UserStatus, UserStatus>` e a trava: acrescentar um valor ao
 * enum `UserStatus` do Prisma passa a QUEBRAR O TYPECHECK aqui, em vez de cair
 * num `default` silencioso que mapearia um estado desconhecido para algo
 * plausivel. Os dois conjuntos sao hoje identicos (`active`, `disabled`,
 * `pending_deletion`, `deleted`), mas identidade acidental nao e contrato: sem
 * este mapa, um `as UserStatus` esconderia a divergencia no dia em que ela
 * aparecesse.
 */
const USER_STATUS_BY_DB: Record<$Enums.UserStatus, UserStatus> = {
  active: "active",
  disabled: "disabled",
  pending_deletion: "pending_deletion",
  deleted: "deleted",
};

/**
 * Erro de mapeamento. Carrega SO o nome do campo — nunca o valor, nunca a linha,
 * nunca o e-mail, nunca o hash. Um estado desconhecido normalmente chega junto
 * de uma linha inteira nas maos do chamador; deixar o valor entrar na mensagem
 * transformaria o log de erro num canal de vazamento.
 */
export class UnmappableRowError extends Error {
  constructor(field: string) {
    super(`valor fora do dominio na coluna ${field}`);
    this.name = "UnmappableRowError";
  }
}

/**
 * Converte o status vindo do banco. Fail-closed: valor fora do dominio LANCA em
 * vez de virar `active` por conveniencia — um status desconhecido tratado como
 * ativo daria sessao a uma conta que o produto talvez tenha desativado
 * (`accountCanHoldSession` so aceita `active`).
 *
 * O `Record` acima ja cobre o enum GERADO; esta checagem cobre o caso em que o
 * banco devolve algo que o client gerado nao conhece (schema a frente do
 * client), que o typecheck nao consegue ver.
 */
function toUserStatus(dbStatus: $Enums.UserStatus): UserStatus {
  const mapped = USER_STATUS_BY_DB[dbStatus] as UserStatus | undefined;
  if (mapped === undefined || !USER_STATUSES.includes(mapped)) {
    throw new UnmappableRowError("status");
  }
  return mapped;
}

/**
 * Linha MINIMA de identidade que o adapter le. Declarada aqui (e nao inferida do
 * Prisma) para que o `select` do adapter tenha um alvo fixo: se alguem ampliar o
 * select, o excedente nao tem para onde ir.
 */
export interface IdentityRow {
  readonly id: bigint;
  readonly status: $Enums.UserStatus;
}

/**
 * `IdentityRecord` = `{ id, status }` e MAIS NADA. Sem hash, sem algoritmo, sem
 * e-mail (nem o normalizado: quem consultou ja o tem — devolve-lo seria PII sem
 * leitor), sem `handle`, `role`, `displayName` nem timestamps.
 */
export function toIdentityRecord(row: IdentityRow): IdentityRecord {
  return {
    id: row.id,
    status: toUserStatus(row.status),
  };
}

/** Linha MINIMA de credencial: so o hash, e so para a verificacao. */
export interface CredentialRow {
  readonly passwordHash: string;
}

/**
 * UNICO mapper autorizado a carregar segredo. O valor sai opaco, exatamente como
 * entrou: este modulo nao interpreta PHC, nao extrai parametros de scrypt, nao
 * deriva `algorithm` e nao compara nada.
 *
 * `algorithm` NAO e transportado de proposito: `authenticatePassword` recebe so
 * `storedHash`, e ate um futuro rehash-on-login le os parametros de dentro do
 * proprio PHC. Levar o rotulo junto ampliaria a superficie do unico struct que
 * carrega segredo, sem nenhum leitor.
 */
export function toCredentialVerificationMaterial(
  row: CredentialRow,
): CredentialVerificationMaterial {
  return { passwordHash: row.passwordHash };
}

/**
 * Traducao EXPLICITA do enum de proposito. Mesmo motivo do mapa de status: um
 * valor novo no enum do Prisma passa a quebrar o typecheck aqui, em vez de
 * atravessar como se fosse conhecido. Um proposito mal traduzido deixaria um
 * token de verificacao redefinir senha.
 */
const AUTH_TOKEN_PURPOSE_BY_DB: Record<$Enums.AuthTokenPurpose, AuthTokenPurpose> = {
  email_verification: "email_verification",
  password_reset: "password_reset",
};

/** Fail-closed: proposito fora do dominio LANCA, nunca assume um valor plausivel. */
export function toAuthTokenPurpose(dbPurpose: $Enums.AuthTokenPurpose): AuthTokenPurpose {
  const mapped = AUTH_TOKEN_PURPOSE_BY_DB[dbPurpose] as AuthTokenPurpose | undefined;
  if (mapped === undefined || !AUTH_TOKEN_PURPOSES.includes(mapped)) {
    throw new UnmappableRowError("purpose");
  }
  return mapped;
}

/** Linha MINIMA de sessao que o adapter le. */
export interface SessionAccessRow {
  readonly id: bigint;
  readonly userId: bigint;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly csrfTokenHash: string;
}

/**
 * `SessionAccessRecord` = `{ id, userId, expiresAt, revokedAt, csrfTokenHash }`
 * e MAIS NADA. Sem `tokenHash`, sem `ipHash`, sem `userAgent`: campo a campo,
 * para que ampliar o select nunca vaze sozinho para o dominio.
 *
 * `csrfTokenHash` entrou em C7D com consumidor real (`requireCsrf` na borda de
 * mutacao autenticada) — e o HASH, nunca o token cru, que so existe no cookie
 * do cliente.
 */
export function toSessionAccessRecord(row: SessionAccessRow): SessionAccessRecord {
  return {
    id: row.id,
    userId: row.userId,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    csrfTokenHash: row.csrfTokenHash,
  };
}

/** Linha MINIMA do estado de verificacao (C7B2.2). */
export interface EmailVerificationStateRow {
  readonly id: bigint;
  readonly emailVerifiedAt: Date | null;
  readonly status: $Enums.UserStatus;
}

/**
 * Devolve o FATO (`emailVerifiedAt`), nunca a decisao. Converter para
 * `alreadyVerified: boolean` aqui faria o mapper decidir politica no lugar do
 * dominio e descartaria o QUANDO — que `markEmailVerified` preserva de
 * proposito. `null` permanece `null`, nunca vira string vazia nem `false`.
 */
export function toEmailVerificationState(row: EmailVerificationStateRow): EmailVerificationState {
  return {
    userId: row.id,
    emailVerifiedAt: row.emailVerifiedAt,
    // Fail-closed no mapa explicito: status desconhecido LANCA em vez de
    // atravessar como se fosse elegivel.
    status: toUserStatus(row.status),
  };
}

/** Linha MINIMA de contagem de throttle (C7C). */
export interface AuthThrottleRow {
  readonly failureCount: number;
  readonly windowStartedAt: Date;
  readonly lockedUntil: Date | null;
}

/**
 * `AuthThrottleState` = as tres colunas de estado, campo a campo.
 *
 * NAO carrega `scope`/`key` (quem consultou ja os tem, e `key` pode ser o
 * e-mail normalizado — PII sem leitor do outro lado) nem `id`/timestamps.
 * `lockedUntil` permanece `null` quando e null: converte-lo para uma data no
 * passado faria o adapter decidir vigencia, que e trabalho de `evaluateThrottle`.
 */
export function toAuthThrottleState(row: AuthThrottleRow): AuthThrottleState {
  return {
    failureCount: row.failureCount,
    windowStartedAt: row.windowStartedAt,
    lockedUntil: row.lockedUntil,
  };
}

// ---------------------------------------------------------------------------
// C7D — PERFIL, CONSENTIMENTO E PEDIDOS LGPD
// ---------------------------------------------------------------------------

/** Mesma trava do `USER_STATUS_BY_DB`: novo valor no enum do Prisma quebra o build. */
const PROFILE_VISIBILITY_BY_DB: Record<$Enums.ProfileVisibility, ProfileVisibility> = {
  private: "private",
  public: "public",
};

const CONSENT_KIND_BY_DB: Record<$Enums.ConsentKind, ConsentKind> = {
  terms_of_service: "terms_of_service",
  privacy_policy: "privacy_policy",
  marketing_email: "marketing_email",
  analytics: "analytics",
};

const DATA_REQUEST_KIND_BY_DB: Record<$Enums.DataRequestKind, DataRequestKind> = {
  export: "export",
  deletion: "deletion",
};

const DATA_REQUEST_STATUS_BY_DB: Record<$Enums.DataRequestStatus, DataRequestStatus> = {
  pending: "pending",
  processing: "processing",
  completed: "completed",
  rejected: "rejected",
  cancelled: "cancelled",
};

/**
 * DEFAULT SEGURO da visibilidade quando a conta ainda nao tem linha de perfil.
 *
 * Espelha o default da COLUNA (`@default(private)`). Fail-closed em dobro: se
 * um dia a coluna mudar de default, a divergencia aparece aqui como um perfil
 * privado demais — nunca publico demais.
 */
const VISIBILITY_FALLBACK: ProfileVisibility = "private";

/** Espelha o default da coluna `user_profiles.locale`. */
const LOCALE_FALLBACK = "pt-BR";

function toProfileVisibility(dbVisibility: $Enums.ProfileVisibility): ProfileVisibility {
  const mapped = PROFILE_VISIBILITY_BY_DB[dbVisibility] as ProfileVisibility | undefined;
  if (mapped === undefined) {
    throw new UnmappableRowError("visibility");
  }
  return mapped;
}

/**
 * Linha MINIMA do perfil publico: os dois nomes que moram em `users` mais a
 * linha 1-1 de `user_profiles`, que pode NAO EXISTIR para conta recem-criada.
 */
export interface ProfileRow {
  readonly displayName: string | null;
  readonly handle: string | null;
  readonly profile: {
    readonly bio: string | null;
    readonly avatarPath: string | null;
    readonly locale: string;
    readonly countryCode: string | null;
    readonly timezone: string | null;
    readonly visibility: $Enums.ProfileVisibility;
    readonly theme: string;
    readonly density: string;
    readonly posterSize: string;
  } | null;
}

/**
 * `ProfileRecord` campo a campo. Perfil AUSENTE nao e erro: vira o estado
 * default da coluna (privado, pt-BR, sem bio/avatar/pais/fuso) — que e
 * exatamente o que o banco gravaria no primeiro `upsert`.
 */
export function toProfileRecord(row: ProfileRow): ProfileRecord {
  return {
    displayName: row.displayName,
    handle: row.handle,
    bio: row.profile?.bio ?? null,
    avatarPath: row.profile?.avatarPath ?? null,
    locale: row.profile?.locale ?? LOCALE_FALLBACK,
    countryCode: row.profile?.countryCode ?? null,
    timezone: row.profile?.timezone ?? null,
    visibility:
      row.profile === null ? VISIBILITY_FALLBACK : toProfileVisibility(row.profile.visibility),
    // Mesmos defaults da COLUNA. Conta sem linha em `user_profiles` le o que o
    // banco gravaria no primeiro upsert — nao um valor inventado aqui que
    // divergiria do que ela veria depois de salvar pela primeira vez.
    theme: row.profile?.theme ?? "system",
    density: row.profile?.density ?? "comfortable",
    posterSize: row.profile?.posterSize ?? "medium",
  };
}

/** Mesma trava dos demais enums do banco. */
const USER_ROLE_BY_DB: Record<$Enums.UserRole, UserRole> = {
  user: "user",
  moderator: "moderator",
  admin: "admin",
};

/** Linha do usuario autenticado: `users` + a parte de `user_profiles` que o DTO le. */
export interface AuthenticatedUserRow {
  readonly id: bigint;
  readonly handle: string | null;
  readonly displayName: string | null;
  readonly email: string;
  readonly emailNormalized: string;
  readonly emailVerifiedAt: Date | null;
  readonly role: $Enums.UserRole;
  readonly status: $Enums.UserStatus;
  readonly createdAt: Date;
  readonly deletedAt: Date | null;
  readonly profile: {
    readonly locale: string;
    readonly visibility: $Enums.ProfileVisibility;
  } | null;
}

/**
 * `AuthenticatedUserRecord` campo a campo. Perfil ausente (conta recem-criada)
 * cai nos MESMOS defaults de coluna que `toProfileRecord` usa — inclusive a
 * visibilidade PRIVADA, que e o default seguro.
 */
export function toAuthenticatedUserRecord(row: AuthenticatedUserRow): AuthenticatedUserRecord {
  const role = USER_ROLE_BY_DB[row.role] as UserRole | undefined;
  if (role === undefined) {
    throw new UnmappableRowError("role");
  }
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.displayName,
    email: row.email,
    emailNormalized: row.emailNormalized,
    emailVerifiedAt: row.emailVerifiedAt,
    role,
    status: toUserStatus(row.status),
    locale: row.profile?.locale ?? LOCALE_FALLBACK,
    profileVisibility:
      row.profile === null ? VISIBILITY_FALLBACK : toProfileVisibility(row.profile.visibility),
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
  };
}

/** Linha MINIMA de consentimento — exatamente `StoredConsentRecord`. */
export interface ConsentRow {
  readonly kind: $Enums.ConsentKind;
  readonly granted: boolean;
  readonly policyVersion: string;
  readonly occurredAt: Date;
}

/**
 * `ConsentRecordRow` campo a campo. NAO carrega `userId` (quem consultou ja o
 * tem) nem `id`/`createdAt` — `occurredAt` e o unico instante que
 * `currentConsent` consulta.
 */
export function toConsentRecordRow(row: ConsentRow): ConsentRecordRow {
  const kind = CONSENT_KIND_BY_DB[row.kind] as ConsentKind | undefined;
  if (kind === undefined) {
    throw new UnmappableRowError("kind");
  }
  return {
    kind,
    granted: row.granted,
    policyVersion: row.policyVersion,
    occurredAt: row.occurredAt,
  };
}

/** Linha MINIMA de pedido LGPD. */
export interface DataRequestRow {
  readonly id: bigint;
  readonly kind: $Enums.DataRequestKind;
  readonly status: $Enums.DataRequestStatus;
  readonly requestedAt: Date;
  readonly processedAt: Date | null;
}

/**
 * `DataRequestRecord` campo a campo. NAO carrega `detail` nem `processedBy`:
 * `detail` e caixa livre (Json) e `processedBy` e identidade de um OPERADOR —
 * nenhum dos dois tem leitor no caminho do titular, e ambos sairiam direto para
 * a exportacao se entrassem aqui.
 */
export function toDataRequestRecord(row: DataRequestRow): DataRequestRecord {
  const kind = DATA_REQUEST_KIND_BY_DB[row.kind] as DataRequestKind | undefined;
  const status = DATA_REQUEST_STATUS_BY_DB[row.status] as DataRequestStatus | undefined;
  if (kind === undefined) {
    throw new UnmappableRowError("kind");
  }
  if (status === undefined) {
    throw new UnmappableRowError("status");
  }
  return {
    id: row.id,
    kind,
    status,
    requestedAt: row.requestedAt,
    processedAt: row.processedAt,
  };
}

// ---------------------------------------------------------------------------
// C8 — BIBLIOTECA PESSOAL
//
// Mesma trava dos demais enums: um `Record<$Enums.X, X>` faz de um valor novo
// no enum do Prisma um erro de TYPECHECK aqui, em vez de um `default`
// silencioso mapeando estado desconhecido para algo plausivel.
// ---------------------------------------------------------------------------

const WATCH_STATE_BY_DB: Record<$Enums.WatchState, WatchState> = {
  planned: "planned",
  watching: "watching",
  watched: "watched",
  paused: "paused",
  dropped: "dropped",
  rewatching: "rewatching",
  not_interested: "not_interested",
};

const VISIBILITY_BY_DB: Record<$Enums.Visibility, Visibility> = {
  private: "private",
  unlisted: "unlisted",
  public: "public",
};

const USER_LIST_KIND_BY_DB: Record<$Enums.UserListKind, UserListKind> = {
  system: "system",
  custom: "custom",
};

const SYSTEM_LIST_KEY_BY_DB: Record<$Enums.SystemListKey, SystemListKey> = {
  watchlist: "watchlist",
  favorites: "favorites",
  watching: "watching",
  watched: "watched",
};

const VIEWING_EVENT_TYPE_BY_DB: Record<$Enums.ViewingEventType, ViewingEventType> = {
  watch_started: "watch_started",
  watch_completed: "watch_completed",
  episode_watched: "episode_watched",
  episode_unwatched: "episode_unwatched",
  progress_updated: "progress_updated",
  state_changed: "state_changed",
  rewatch_started: "rewatch_started",
  rating_set: "rating_set",
  rating_removed: "rating_removed",
  review_created: "review_created",
  undo: "undo",
  import_applied: "import_applied",
};

const IMPORT_SOURCE_BY_DB: Record<$Enums.ImportSource, ImportSource> = {
  letterboxd_csv: "letterboxd_csv",
  trakt_export: "trakt_export",
  cinerie_json: "cinerie_json",
  cinerie_csv: "cinerie_csv",
};

const IMPORT_JOB_STATUS_BY_DB: Record<$Enums.ImportJobStatus, ImportJobStatus> = {
  uploaded: "uploaded",
  parsed: "parsed",
  preview_ready: "preview_ready",
  resolving: "resolving",
  conflicts_pending: "conflicts_pending",
  applying: "applying",
  applied: "applied",
  failed: "failed",
  cancelled: "cancelled",
};

/**
 * Estreita `EntityType` (5 valores) para `WatchableEntityType` (movie|tv).
 *
 * Fail-closed: o CHECK do banco ja garante que `user_watch_states` so guarda
 * movie/tv, mas se o banco estiver a frente do client gerado o valor inesperado
 * LANCA em vez de virar "movie" por conveniencia — um estado desconhecido
 * tratado como filme apareceria na biblioteca do usuario como outra coisa.
 */
function toWatchableEntityType(dbType: $Enums.EntityType): WatchableEntityType {
  if (dbType === "movie" || dbType === "tv") {
    return dbType;
  }
  throw new UnmappableRowError("entity_type");
}

/** Estreita `EntityType` para os tipos avaliaveis (movie|tv|season|episode). */
function toRatableEntityType(dbType: $Enums.EntityType): RatableEntityType {
  if (dbType === "movie" || dbType === "tv" || dbType === "season" || dbType === "episode") {
    return dbType;
  }
  throw new UnmappableRowError("entity_type");
}

export interface WatchStateRow {
  readonly entityType: $Enums.EntityType;
  readonly entityId: bigint;
  readonly status: $Enums.WatchState;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly lastActivityAt: Date;
  readonly rewatchCount: number;
  readonly visibility: $Enums.Visibility;
  readonly version: number;
  readonly updatedAt: Date;
}

/** `WatchStateRecord` campo a campo. Sem `user_id` (quem consultou ja o tem). */
export function toWatchStateRecord(row: WatchStateRow): WatchStateRecord {
  const status = WATCH_STATE_BY_DB[row.status] as WatchState | undefined;
  const visibility = VISIBILITY_BY_DB[row.visibility] as Visibility | undefined;
  if (status === undefined) throw new UnmappableRowError("status");
  if (visibility === undefined) throw new UnmappableRowError("visibility");
  return {
    entityType: toWatchableEntityType(row.entityType),
    entityId: row.entityId,
    status,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    lastActivityAt: row.lastActivityAt,
    rewatchCount: row.rewatchCount,
    visibility,
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

export interface EpisodeProgressRow {
  readonly episodeId: bigint;
  readonly watched: boolean;
  readonly watchedAt: Date | null;
  readonly progressSeconds: number | null;
  readonly durationSeconds: number | null;
  readonly version: number;
  readonly updatedAt: Date;
}

export function toEpisodeProgressRecord(row: EpisodeProgressRow): EpisodeProgressRecord {
  return {
    episodeId: row.episodeId,
    watched: row.watched,
    watchedAt: row.watchedAt,
    progressSeconds: row.progressSeconds,
    durationSeconds: row.durationSeconds,
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

export interface ViewingEventRow {
  readonly id: bigint;
  readonly entityType: $Enums.EntityType;
  readonly entityId: bigint;
  readonly eventType: $Enums.ViewingEventType;
  readonly occurredAt: Date;
  readonly source: string;
}

export function toViewingEventRecord(row: ViewingEventRow): ViewingEventRecord {
  const eventType = VIEWING_EVENT_TYPE_BY_DB[row.eventType] as ViewingEventType | undefined;
  if (eventType === undefined) throw new UnmappableRowError("event_type");
  return {
    id: row.id,
    entityType: toRatableEntityType(row.entityType),
    entityId: row.entityId,
    eventType,
    occurredAt: row.occurredAt,
    source: row.source,
  };
}

export interface UserListRow {
  readonly id: bigint;
  readonly ownerId: bigint;
  readonly kind: $Enums.UserListKind;
  readonly systemKey: $Enums.SystemListKey | null;
  readonly title: string;
  readonly slug: string;
  readonly description: string | null;
  readonly visibility: $Enums.Visibility;
  readonly ordered: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly _count?: { readonly items: number };
}

export function toUserListRecord(row: UserListRow): UserListRecord {
  const kind = USER_LIST_KIND_BY_DB[row.kind] as UserListKind | undefined;
  const visibility = VISIBILITY_BY_DB[row.visibility] as Visibility | undefined;
  if (kind === undefined) throw new UnmappableRowError("kind");
  if (visibility === undefined) throw new UnmappableRowError("visibility");
  const systemKey =
    row.systemKey === null
      ? null
      : ((SYSTEM_LIST_KEY_BY_DB[row.systemKey] ?? null) as SystemListKey | null);
  if (row.systemKey !== null && systemKey === null) {
    throw new UnmappableRowError("system_key");
  }
  return {
    id: row.id,
    ownerId: row.ownerId,
    kind,
    systemKey,
    title: row.title,
    slug: row.slug,
    description: row.description,
    visibility,
    ordered: row.ordered,
    itemCount: row._count?.items ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface UserListItemRow {
  readonly id: bigint;
  readonly entityType: $Enums.EntityType;
  readonly entityId: bigint;
  readonly position: number | null;
  readonly note: string | null;
  readonly addedAt: Date;
}

export function toUserListItemRecord(row: UserListItemRow): UserListItemRecord {
  return {
    id: row.id,
    entityType: toRatableEntityType(row.entityType),
    entityId: row.entityId,
    position: row.position,
    note: row.note,
    addedAt: row.addedAt,
  };
}

export interface UserRatingRow {
  readonly entityType: $Enums.EntityType;
  readonly entityId: bigint;
  readonly value: { toString(): string };
  readonly scale: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * `UserRatingRecord` campo a campo.
 *
 * `value` e `Decimal(2,1)` no banco e chega como Decimal do driver. A conversao
 * passa por `toString()` (texto exato para uma casa decimal) em vez de um
 * metodo especifico do runtime do Decimal — assim o mapeador nao depende de
 * qual implementacao o driver escolheu.
 */
export function toUserRatingRecord(row: UserRatingRow): UserRatingRecord {
  const value = Number(row.value.toString());
  if (!Number.isFinite(value)) {
    throw new UnmappableRowError("value");
  }
  return {
    entityType: toRatableEntityType(row.entityType),
    entityId: row.entityId,
    value,
    scale: row.scale,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface ImportJobRow {
  readonly id: bigint;
  readonly userId: bigint;
  readonly source: $Enums.ImportSource;
  readonly status: $Enums.ImportJobStatus;
  readonly fileName: string | null;
  readonly itemCount: number;
  readonly conflictCount: number;
  readonly appliedCount: number;
  readonly error: string | null;
  readonly appliedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function toImportJobRecord(row: ImportJobRow): ImportJobRecord {
  const source = IMPORT_SOURCE_BY_DB[row.source] as ImportSource | undefined;
  const status = IMPORT_JOB_STATUS_BY_DB[row.status] as ImportJobStatus | undefined;
  if (source === undefined) throw new UnmappableRowError("source");
  if (status === undefined) throw new UnmappableRowError("status");
  return {
    id: row.id,
    userId: row.userId,
    source,
    status,
    fileName: row.fileName,
    itemCount: row.itemCount,
    conflictCount: row.conflictCount,
    appliedCount: row.appliedCount,
    error: row.error,
    appliedAt: row.appliedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
