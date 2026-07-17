/**
 * Tipos de dominio da user platform — espelho TS (string literal unions)
 * dos enums Postgres criados em 20260717150000_user_product_platform.
 *
 * PURO. Fonte executavel do banco: packages/db/prisma/schema.prisma.
 * Divergencia entre este modulo e o schema e bug — alinhe pelo schema.
 * O espelhamento e travado por teste (enums-schema-mirror) como no admin.
 */

export const USER_STATUSES = ["active", "disabled", "pending_deletion", "deleted"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const USER_ROLES = ["user", "moderator", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const PROFILE_VISIBILITIES = ["private", "public"] as const;
export type ProfileVisibility = (typeof PROFILE_VISIBILITIES)[number];

export const VISIBILITIES = ["private", "unlisted", "public"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const WATCH_STATES = [
  "planned",
  "watching",
  "watched",
  "paused",
  "dropped",
  "rewatching",
  "not_interested",
] as const;
export type WatchState = (typeof WATCH_STATES)[number];

export const VIEWING_EVENT_TYPES = [
  "watch_started",
  "watch_completed",
  "episode_watched",
  "episode_unwatched",
  "progress_updated",
  "state_changed",
  "rewatch_started",
  "rating_set",
  "rating_removed",
  "review_created",
  "undo",
  "import_applied",
] as const;
export type ViewingEventType = (typeof VIEWING_EVENT_TYPES)[number];

export const REVIEW_MODERATION_STATUSES = ["pending", "approved", "rejected", "removed"] as const;
export type ReviewModerationStatus = (typeof REVIEW_MODERATION_STATUSES)[number];

export const AUTH_TOKEN_PURPOSES = ["email_verification", "password_reset"] as const;
export type AuthTokenPurpose = (typeof AUTH_TOKEN_PURPOSES)[number];

export const THROTTLE_SCOPES = ["email", "ip"] as const;
export type ThrottleScope = (typeof THROTTLE_SCOPES)[number];

export const AUTH_AUDIT_ACTIONS = [
  "signup",
  "login_succeeded",
  "login_failed",
  "logout",
  "session_rotated",
  "session_revoked",
  "all_sessions_revoked",
  "email_verification_sent",
  "email_verified",
  "password_reset_requested",
  "password_reset_completed",
  "password_changed",
  "lockout_triggered",
  "account_disabled",
  "account_reactivated",
  "deletion_requested",
  "deletion_cancelled",
  "account_anonymized",
  "data_export_requested",
  "data_export_completed",
  "import_applied",
] as const;
export type AuthAuditAction = (typeof AUTH_AUDIT_ACTIONS)[number];

export const USER_LIST_KINDS = ["system", "custom"] as const;
export type UserListKind = (typeof USER_LIST_KINDS)[number];

export const SYSTEM_LIST_KEYS = ["watchlist", "favorites", "watching", "watched"] as const;
export type SystemListKey = (typeof SYSTEM_LIST_KEYS)[number];

export const CONSENT_KINDS = [
  "terms_of_service",
  "privacy_policy",
  "marketing_email",
  "analytics",
] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

export const DATA_REQUEST_KINDS = ["export", "deletion"] as const;
export type DataRequestKind = (typeof DATA_REQUEST_KINDS)[number];

export const DATA_REQUEST_STATUSES = [
  "pending",
  "processing",
  "completed",
  "rejected",
  "cancelled",
] as const;
export type DataRequestStatus = (typeof DATA_REQUEST_STATUSES)[number];

export const IMPORT_SOURCES = [
  "letterboxd_csv",
  "trakt_export",
  "cinerie_json",
  "cinerie_csv",
] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

export const IMPORT_JOB_STATUSES = [
  "uploaded",
  "parsed",
  "preview_ready",
  "resolving",
  "conflicts_pending",
  "applying",
  "applied",
  "failed",
  "cancelled",
] as const;
export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];

export const REPORT_REASONS = [
  "spam",
  "spoiler_unflagged",
  "harassment",
  "illegal_content",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_STATUSES = ["open", "reviewed", "dismissed", "actioned"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** Tipos de entidade rastreaveis (CHECK do banco: watch state so movie|tv). */
export const WATCHABLE_ENTITY_TYPES = ["movie", "tv"] as const;
export type WatchableEntityType = (typeof WATCHABLE_ENTITY_TYPES)[number];

/** Tipos de entidade avaliaveis (CHECK do banco: rating/review <> person). */
export const RATABLE_ENTITY_TYPES = ["movie", "tv", "season", "episode"] as const;
export type RatableEntityType = (typeof RATABLE_ENTITY_TYPES)[number];

/** Referencia polimorfica a uma entidade do catalogo (registry `entities`). */
export interface EntityRef {
  readonly entityType: RatableEntityType;
  readonly entityId: bigint;
}
