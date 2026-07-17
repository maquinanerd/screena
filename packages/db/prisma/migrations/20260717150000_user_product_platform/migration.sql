-- ============================================================================
-- USER PRODUCT PLATFORM (Backend C) — usuarios, auth, tracking, listas,
-- ratings, reviews, historico, recomendacoes, LGPD e importacao.
--
-- Migration 100% ADITIVA: nenhuma tabela/coluna existente e alterada.
-- Pre-requisito registrado: docs/product/user-product-decisions.md
-- ADR: docs/adr/0014-user-product-platform.md
--
-- Governanca desta migration:
--   * Default seguro em tudo: visibility nasce 'private', review de usuario
--     nasce 'pending', snapshot de recomendacao nasce is_current=false.
--   * Segredo NUNCA em claro: sessoes e tokens guardam apenas hash sha256
--     (CHECK de formato hex); IP bruto nunca e persistido (apenas ip_hash).
--   * user_ratings NAO referencia rating_sources/external_ratings: nota de
--     usuario nunca vira nota de fonte externa (invariantes 1/2).
--   * Refs polimorficas ganham FK composta real para entities(entity_type,
--     entity_id), como no hardening de governanca de dados (D1 evoluido).
--   * Historico (diario), audit de auth e consentimento sao APPEND-ONLY:
--     trigger fail-closed proibe UPDATE (correcao = nova linha).
--   * Passo de 0.5 do rating e LEI DO BANCO: CHECK value*2 = floor(value*2).
-- ============================================================================

-- ============================================================
-- 1. ENUMS
-- ============================================================

-- Ciclo de vida da conta; 'deleted' = anonimizada (tumba sem dado pessoal).
CREATE TYPE "UserStatus" AS ENUM ('active', 'disabled', 'pending_deletion', 'deleted');

-- RBAC minimo do v1.
CREATE TYPE "UserRole" AS ENUM ('user', 'moderator', 'admin');

-- Perfil nasce privado (default seguro).
CREATE TYPE "ProfileVisibility" AS ENUM ('private', 'public');

-- Visibilidade de conteudo gerado por usuario (listas, reviews, diario).
CREATE TYPE "Visibility" AS ENUM ('private', 'unlisted', 'public');

-- Estados de acompanhamento; not_interested alimenta exclusao de recomendacao.
CREATE TYPE "WatchState" AS ENUM ('planned', 'watching', 'watched', 'paused', 'dropped', 'rewatching', 'not_interested');

-- Tipos de evento do diario/historico (append-only).
CREATE TYPE "ViewingEventType" AS ENUM ('watch_started', 'watch_completed', 'episode_watched', 'episode_unwatched', 'progress_updated', 'state_changed', 'rewatch_started', 'rating_set', 'rating_removed', 'review_created', 'undo', 'import_applied');

-- Moderacao de review de USUARIO (enum proprio; sem relacao com o
-- ReviewStatus editorial de content_blocks).
CREATE TYPE "ReviewModerationStatus" AS ENUM ('pending', 'approved', 'rejected', 'removed');

-- Tokens single-use de verificacao/reset.
CREATE TYPE "AuthTokenPurpose" AS ENUM ('email_verification', 'password_reset');

-- Escopos de brute-force throttle.
CREATE TYPE "ThrottleScope" AS ENUM ('email', 'ip');

-- Acoes auditadas de autenticacao (append-only).
CREATE TYPE "AuthAuditAction" AS ENUM ('signup', 'login_succeeded', 'login_failed', 'logout', 'session_rotated', 'session_revoked', 'all_sessions_revoked', 'email_verification_sent', 'email_verified', 'password_reset_requested', 'password_reset_completed', 'password_changed', 'lockout_triggered', 'account_disabled', 'account_reactivated', 'deletion_requested', 'deletion_cancelled', 'account_anonymized', 'data_export_requested', 'data_export_completed', 'import_applied');

-- Listas de sistema vs. customizadas.
CREATE TYPE "UserListKind" AS ENUM ('system', 'custom');

-- Chaves das listas de sistema (uma de cada por usuario; indice parcial).
CREATE TYPE "SystemListKey" AS ENUM ('watchlist', 'favorites', 'watching', 'watched');

-- Consentimento LGPD por finalidade.
CREATE TYPE "ConsentKind" AS ENUM ('terms_of_service', 'privacy_policy', 'marketing_email', 'analytics');

-- Solicitacoes LGPD.
CREATE TYPE "DataRequestKind" AS ENUM ('export', 'deletion');
CREATE TYPE "DataRequestStatus" AS ENUM ('pending', 'processing', 'completed', 'rejected', 'cancelled');

-- Importacao de dados do usuario (nunca aplica sem preview).
CREATE TYPE "ImportSource" AS ENUM ('letterboxd_csv', 'trakt_export', 'cinerie_json', 'cinerie_csv');
CREATE TYPE "ImportJobStatus" AS ENUM ('uploaded', 'parsed', 'preview_ready', 'resolving', 'conflicts_pending', 'applying', 'applied', 'failed', 'cancelled');

-- Denuncia/moderacao de review de usuario.
CREATE TYPE "ReportReason" AS ENUM ('spam', 'spoiler_unflagged', 'harassment', 'illegal_content', 'other');
CREATE TYPE "ReportStatus" AS ENUM ('open', 'reviewed', 'dismissed', 'actioned');

-- ============================================================
-- 2. TABELAS
-- ============================================================

CREATE TABLE "users" (
  "id"                BIGSERIAL PRIMARY KEY,
  "email"             TEXT NOT NULL,
  "email_normalized"  TEXT NOT NULL,
  "handle"            TEXT,
  "display_name"      TEXT,
  "role"              "UserRole" NOT NULL DEFAULT 'user',
  "status"            "UserStatus" NOT NULL DEFAULT 'active',
  "email_verified_at" TIMESTAMP(3),
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL,
  "deleted_at"        TIMESTAMP(3),

  -- Anti-enumeracao: toda comparacao de login usa email_normalized.
  CONSTRAINT "users_email_has_at" CHECK (position('@' in "email") > 1),
  CONSTRAINT "users_email_normalized_shape" CHECK ("email_normalized" = lower(btrim("email_normalized")) AND position('@' in "email_normalized") > 1),
  CONSTRAINT "users_handle_format" CHECK ("handle" IS NULL OR "handle" ~ '^[a-z0-9](?:[a-z0-9_]{1,28}[a-z0-9])?$'),
  CONSTRAINT "users_display_name_not_blank" CHECK ("display_name" IS NULL OR btrim("display_name") <> ''),
  -- Coerencia da exclusao LGPD: deleted exige carimbo; carimbo exige estado.
  CONSTRAINT "users_deleted_requires_timestamp" CHECK ("status" <> 'deleted' OR "deleted_at" IS NOT NULL),
  CONSTRAINT "users_deleted_at_requires_status" CHECK ("deleted_at" IS NULL OR "status" IN ('pending_deletion', 'deleted'))
);

CREATE TABLE "user_profiles" (
  "id"           BIGSERIAL PRIMARY KEY,
  "user_id"      BIGINT NOT NULL,
  "bio"          TEXT,
  "avatar_path"  TEXT,
  "locale"       TEXT NOT NULL DEFAULT 'pt-BR',
  "country_code" TEXT,
  "timezone"     TEXT,
  "visibility"   "ProfileVisibility" NOT NULL DEFAULT 'private',
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "user_profiles_locale_format" CHECK ("locale" ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  CONSTRAINT "user_profiles_country_format" CHECK ("country_code" IS NULL OR "country_code" ~ '^[A-Z]{2}$'),
  CONSTRAINT "user_profiles_bio_length" CHECK ("bio" IS NULL OR char_length("bio") <= 1000)
);

CREATE TABLE "user_password_credentials" (
  "id"            BIGSERIAL PRIMARY KEY,
  "user_id"       BIGINT NOT NULL,
  -- Formato PHC-like versionado (ex.: scrypt$N=32768,r=8,p=1$<salt>$<hash>).
  -- NUNCA em log; NUNCA senha em claro.
  "password_hash" TEXT NOT NULL,
  "algorithm"     TEXT NOT NULL DEFAULT 'scrypt',
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "user_password_credentials_hash_not_blank" CHECK (btrim("password_hash") <> ''),
  CONSTRAINT "user_password_credentials_hash_versioned" CHECK (position('$' in "password_hash") > 1),
  CONSTRAINT "user_password_credentials_algorithm_not_blank" CHECK (btrim("algorithm") <> '')
);

-- Preparo para OAuth (adapter): NENHUM provedor ativo sem decisao humana.
-- De proposito NAO guarda access/refresh tokens de provedor.
CREATE TABLE "user_accounts" (
  "id"                  BIGSERIAL PRIMARY KEY,
  "user_id"             BIGINT NOT NULL,
  "provider"            TEXT NOT NULL,
  "provider_account_id" TEXT NOT NULL,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_accounts_provider_not_blank" CHECK (btrim("provider") <> ''),
  CONSTRAINT "user_accounts_provider_account_id_not_blank" CHECK (btrim("provider_account_id") <> '')
);

CREATE TABLE "user_sessions" (
  "id"              BIGSERIAL PRIMARY KEY,
  "user_id"         BIGINT NOT NULL,
  -- Hash sha256 (hex) do token opaco de 256 bits; o token cru NUNCA persiste.
  "token_hash"      TEXT NOT NULL,
  -- Double-submit CSRF vinculado a sessao; tambem so o hash persiste.
  "csrf_token_hash" TEXT NOT NULL,
  "expires_at"      TIMESTAMP(3) NOT NULL,
  "last_used_at"    TIMESTAMP(3),
  "revoked_at"      TIMESTAMP(3),
  "revoked_reason"  TEXT,
  "rotated_from_id" BIGINT,
  -- Hash com sal de servidor; IP bruto NUNCA persiste (LGPD).
  "ip_hash"         TEXT,
  "user_agent"      TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "user_sessions_token_hash_shape" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "user_sessions_csrf_hash_shape" CHECK ("csrf_token_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "user_sessions_expiry_after_creation" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "user_sessions_revocation_after_creation" CHECK ("revoked_at" IS NULL OR "revoked_at" >= "created_at")
);

CREATE TABLE "user_verification_tokens" (
  "id"          BIGSERIAL PRIMARY KEY,
  "user_id"     BIGINT NOT NULL,
  "purpose"     "AuthTokenPurpose" NOT NULL,
  -- Hash sha256 (hex); token cru so trafega uma vez e nunca persiste.
  -- Consumo atomico (UPDATE ... WHERE consumed_at IS NULL) = replay-safe.
  "token_hash"  TEXT NOT NULL,
  "expires_at"  TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_verification_tokens_token_hash_shape" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "user_verification_tokens_expiry_after_creation" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "user_verification_tokens_consumed_after_creation" CHECK ("consumed_at" IS NULL OR "consumed_at" >= "created_at")
);

-- Brute force: janela deslizante por chave (email normalizado OU ip_hash).
-- SEM FK para users de proposito: cobre e-mail inexistente sem enumeracao.
CREATE TABLE "user_auth_throttles" (
  "id"                BIGSERIAL PRIMARY KEY,
  "scope"             "ThrottleScope" NOT NULL,
  "key"               TEXT NOT NULL,
  "failure_count"     INTEGER NOT NULL DEFAULT 0,
  "window_started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_until"      TIMESTAMP(3),
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "user_auth_throttles_key_not_blank" CHECK (btrim("key") <> ''),
  CONSTRAINT "user_auth_throttles_failure_count_nonnegative" CHECK ("failure_count" >= 0)
);

-- Audit de autenticacao APPEND-ONLY: senha/token NUNCA aparecem aqui.
CREATE TABLE "user_auth_audit_logs" (
  "id"         BIGSERIAL PRIMARY KEY,
  "user_id"    BIGINT,
  "session_id" BIGINT,
  "action"     "AuthAuditAction" NOT NULL,
  "ip_hash"    TEXT,
  "user_agent" TEXT,
  "detail"     JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Estado ATUAL de acompanhamento (projecao mutavel); historico no diario.
CREATE TABLE "user_watch_states" (
  "id"               BIGSERIAL PRIMARY KEY,
  "user_id"          BIGINT NOT NULL,
  "entity_type"      "EntityType" NOT NULL,
  "entity_id"        BIGINT NOT NULL,
  "status"           "WatchState" NOT NULL,
  "started_at"       TIMESTAMP(3),
  "completed_at"     TIMESTAMP(3),
  "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rewatch_count"    INTEGER NOT NULL DEFAULT 0,
  "visibility"       "Visibility" NOT NULL DEFAULT 'private',
  "version"          INTEGER NOT NULL DEFAULT 1,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,

  -- Watch state e por filme/serie; temporada/episodio usam
  -- user_episode_progress (derivacao nunca destrutiva no servico).
  CONSTRAINT "user_watch_states_entity_type_allowed" CHECK ("entity_type" IN ('movie', 'tv')),
  CONSTRAINT "user_watch_states_rewatch_nonnegative" CHECK ("rewatch_count" >= 0),
  CONSTRAINT "user_watch_states_version_positive" CHECK ("version" >= 1),
  CONSTRAINT "user_watch_states_completion_order" CHECK ("started_at" IS NULL OR "completed_at" IS NULL OR "completed_at" >= "started_at")
);

CREATE TABLE "user_episode_progress" (
  "id"               BIGSERIAL PRIMARY KEY,
  "user_id"          BIGINT NOT NULL,
  "episode_id"       BIGINT NOT NULL,
  "watched"          BOOLEAN NOT NULL DEFAULT false,
  "watched_at"       TIMESTAMP(3),
  "progress_seconds" INTEGER,
  "duration_seconds" INTEGER,
  "version"          INTEGER NOT NULL DEFAULT 1,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "user_episode_progress_progress_nonnegative" CHECK ("progress_seconds" IS NULL OR "progress_seconds" >= 0),
  CONSTRAINT "user_episode_progress_duration_positive" CHECK ("duration_seconds" IS NULL OR "duration_seconds" > 0),
  CONSTRAINT "user_episode_progress_progress_within_duration" CHECK ("progress_seconds" IS NULL OR "duration_seconds" IS NULL OR "progress_seconds" <= "duration_seconds"),
  CONSTRAINT "user_episode_progress_version_positive" CHECK ("version" >= 1)
);

-- Diario/historico APPEND-ONLY com idempotencia por (user_id, idempotency_key).
CREATE TABLE "user_viewing_events" (
  "id"              BIGSERIAL PRIMARY KEY,
  "user_id"         BIGINT NOT NULL,
  "entity_type"     "EntityType" NOT NULL,
  "entity_id"       BIGINT NOT NULL,
  "event_type"      "ViewingEventType" NOT NULL,
  "occurred_at"     TIMESTAMP(3) NOT NULL,
  "source"          TEXT NOT NULL DEFAULT 'app',
  "idempotency_key" TEXT NOT NULL,
  "metadata"        JSONB,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_viewing_events_idempotency_key_not_blank" CHECK (btrim("idempotency_key") <> ''),
  CONSTRAINT "user_viewing_events_source_not_blank" CHECK (btrim("source") <> '')
);

CREATE TABLE "user_lists" (
  "id"          BIGSERIAL PRIMARY KEY,
  "owner_id"    BIGINT NOT NULL,
  "kind"        "UserListKind" NOT NULL DEFAULT 'custom',
  "system_key"  "SystemListKey",
  "title"       TEXT NOT NULL,
  "slug"        TEXT NOT NULL,
  "description" TEXT,
  "visibility"  "Visibility" NOT NULL DEFAULT 'private',
  "ordered"     BOOLEAN NOT NULL DEFAULT false,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL,
  "deleted_at"  TIMESTAMP(3),

  CONSTRAINT "user_lists_title_not_blank" CHECK (btrim("title") <> ''),
  CONSTRAINT "user_lists_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  -- Lista de sistema <=> system_key preenchida (bidirecional).
  CONSTRAINT "user_lists_system_key_coherent" CHECK (("kind" = 'system') = ("system_key" IS NOT NULL)),
  CONSTRAINT "user_lists_description_length" CHECK ("description" IS NULL OR char_length("description") <= 2000)
);

CREATE TABLE "user_list_items" (
  "id"          BIGSERIAL PRIMARY KEY,
  "list_id"     BIGINT NOT NULL,
  "entity_type" "EntityType" NOT NULL,
  "entity_id"   BIGINT NOT NULL,
  "position"    INTEGER,
  "note"        TEXT,
  "added_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL,

  CONSTRAINT "user_list_items_position_nonnegative" CHECK ("position" IS NULL OR "position" >= 0),
  CONSTRAINT "user_list_items_note_length" CHECK ("note" IS NULL OR char_length("note") <= 1000)
);

-- Nota PESSOAL (0.5..5.0, passo 0.5). Sem relacao com external_ratings:
-- nota de usuario nunca vira nota de fonte externa (invariantes 1/2).
CREATE TABLE "user_ratings" (
  "id"               BIGSERIAL PRIMARY KEY,
  "user_id"          BIGINT NOT NULL,
  "entity_type"      "EntityType" NOT NULL,
  "entity_id"        BIGINT NOT NULL,
  "value"            DECIMAL(2,1) NOT NULL,
  "scale"            INTEGER NOT NULL DEFAULT 5,
  "contains_spoiler" BOOLEAN NOT NULL DEFAULT false,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,

  -- O passo de 0.5 e lei do banco, nao so da UI.
  CONSTRAINT "user_ratings_value_range" CHECK ("value" >= 0.5 AND "value" <= 5),
  CONSTRAINT "user_ratings_value_half_step" CHECK (("value" * 2) = floor("value" * 2)),
  CONSTRAINT "user_ratings_scale_fixed" CHECK ("scale" = 5),
  CONSTRAINT "user_ratings_entity_type_allowed" CHECK ("entity_type" <> 'person')
);

-- Review de USUARIO: nasce pending + private (fail-closed); soft delete.
CREATE TABLE "user_reviews" (
  "id"               BIGSERIAL PRIMARY KEY,
  "user_id"          BIGINT NOT NULL,
  "entity_type"      "EntityType" NOT NULL,
  "entity_id"        BIGINT NOT NULL,
  "title"            TEXT,
  "body"             TEXT NOT NULL,
  "contains_spoiler" BOOLEAN NOT NULL DEFAULT false,
  "status"           "ReviewModerationStatus" NOT NULL DEFAULT 'pending',
  "visibility"       "Visibility" NOT NULL DEFAULT 'private',
  "published_at"     TIMESTAMP(3),
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,
  "deleted_at"       TIMESTAMP(3),

  CONSTRAINT "user_reviews_body_not_blank" CHECK (btrim("body") <> ''),
  CONSTRAINT "user_reviews_body_length" CHECK (char_length("body") <= 20000),
  CONSTRAINT "user_reviews_title_length" CHECK ("title" IS NULL OR char_length("title") <= 200),
  CONSTRAINT "user_reviews_entity_type_allowed" CHECK ("entity_type" <> 'person'),
  -- Fail-closed: so review aprovada pode carregar published_at.
  CONSTRAINT "user_reviews_published_requires_approval" CHECK ("published_at" IS NULL OR "status" = 'approved')
);

CREATE TABLE "user_review_reports" (
  "id"          BIGSERIAL PRIMARY KEY,
  "review_id"   BIGINT NOT NULL,
  "reporter_id" BIGINT NOT NULL,
  "reason"      "ReportReason" NOT NULL,
  "detail"      TEXT,
  "status"      "ReportStatus" NOT NULL DEFAULT 'open',
  "resolved_at" TIMESTAMP(3),
  -- Identidade humana do moderador; nunca "agent"/"system".
  "resolved_by" TEXT,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL,

  CONSTRAINT "user_review_reports_detail_length" CHECK ("detail" IS NULL OR char_length("detail") <= 2000),
  CONSTRAINT "user_review_reports_resolved_by_not_blank" CHECK ("resolved_by" IS NULL OR btrim("resolved_by") <> '')
);

CREATE TABLE "user_blocks" (
  "id"         BIGSERIAL PRIMARY KEY,
  "blocker_id" BIGINT NOT NULL,
  "blocked_id" BIGINT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_blocks_no_self_block" CHECK ("blocker_id" <> "blocked_id")
);

-- Projecao ASSINCRONA de estatisticas: cache reconstruivel; nunca calculada
-- no request (zero trabalho pesado no render).
CREATE TABLE "user_stats_snapshots" (
  "id"                BIGSERIAL PRIMARY KEY,
  "user_id"           BIGINT NOT NULL,
  "algorithm_version" TEXT NOT NULL,
  "computed_at"       TIMESTAMP(3) NOT NULL,
  "stats"             JSONB NOT NULL,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "user_stats_snapshots_algorithm_version_not_blank" CHECK (btrim("algorithm_version") <> '')
);

-- Snapshot PERSISTIDO de recomendacoes com explicacao por item e versao de
-- algoritmo. is_current nasce false (default seguro); o servico promove
-- transacionalmente (indice unico parcial garante no maximo 1 atual).
CREATE TABLE "user_recommendation_snapshots" (
  "id"                BIGSERIAL PRIMARY KEY,
  "user_id"           BIGINT NOT NULL,
  "algorithm_version" TEXT NOT NULL,
  "generated_at"      TIMESTAMP(3) NOT NULL,
  "items"             JSONB NOT NULL,
  "is_current"        BOOLEAN NOT NULL DEFAULT false,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_recommendation_snapshots_algorithm_version_not_blank" CHECK (btrim("algorithm_version") <> '')
);

-- Consentimento LGPD APPEND-ONLY: cada mudanca e uma NOVA linha.
CREATE TABLE "user_consent_records" (
  "id"             BIGSERIAL PRIMARY KEY,
  "user_id"        BIGINT NOT NULL,
  "kind"           "ConsentKind" NOT NULL,
  "granted"        BOOLEAN NOT NULL,
  "policy_version" TEXT NOT NULL,
  "occurred_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_consent_records_policy_version_not_blank" CHECK (btrim("policy_version") <> '')
);

-- Solicitacoes LGPD (export/exclusao); processed_by = identidade humana.
CREATE TABLE "user_data_requests" (
  "id"           BIGSERIAL PRIMARY KEY,
  "user_id"      BIGINT NOT NULL,
  "kind"         "DataRequestKind" NOT NULL,
  "status"       "DataRequestStatus" NOT NULL DEFAULT 'pending',
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMP(3),
  "processed_by" TEXT,
  "detail"       JSONB,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "user_data_requests_processed_by_not_blank" CHECK ("processed_by" IS NULL OR btrim("processed_by") <> '')
);

-- Importacao: uploaded -> parsed -> preview_ready -> resolving ->
-- conflicts_pending -> applying -> applied. NUNCA aplica sem preview.
CREATE TABLE "user_import_jobs" (
  "id"             BIGSERIAL PRIMARY KEY,
  "user_id"        BIGINT NOT NULL,
  "source"         "ImportSource" NOT NULL,
  "status"         "ImportJobStatus" NOT NULL DEFAULT 'uploaded',
  "file_name"      TEXT,
  "item_count"     INTEGER NOT NULL DEFAULT 0,
  "conflict_count" INTEGER NOT NULL DEFAULT 0,
  "applied_count"  INTEGER NOT NULL DEFAULT 0,
  "preview"        JSONB,
  "conflicts"      JSONB,
  "error"          TEXT,
  "applied_at"     TIMESTAMP(3),
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL,

  CONSTRAINT "user_import_jobs_counts_nonnegative" CHECK ("item_count" >= 0 AND "conflict_count" >= 0 AND "applied_count" >= 0),
  CONSTRAINT "user_import_jobs_applied_requires_timestamp" CHECK ("status" <> 'applied' OR "applied_at" IS NOT NULL)
);

-- ============================================================
-- 3. INDICES (unicos e de consulta, convencao Prisma)
-- ============================================================

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "users_email_normalized_key" ON "users"("email_normalized");
CREATE UNIQUE INDEX "users_handle_key" ON "users"("handle");
CREATE INDEX "users_status_idx" ON "users"("status");

CREATE UNIQUE INDEX "user_profiles_user_id_key" ON "user_profiles"("user_id");

CREATE UNIQUE INDEX "user_password_credentials_user_id_key" ON "user_password_credentials"("user_id");

CREATE UNIQUE INDEX "user_accounts_provider_provider_account_id_key" ON "user_accounts"("provider", "provider_account_id");
CREATE INDEX "user_accounts_user_id_idx" ON "user_accounts"("user_id");

CREATE UNIQUE INDEX "user_sessions_token_hash_key" ON "user_sessions"("token_hash");
CREATE UNIQUE INDEX "user_sessions_rotated_from_id_key" ON "user_sessions"("rotated_from_id");
CREATE INDEX "user_sessions_user_id_expires_at_idx" ON "user_sessions"("user_id", "expires_at");

CREATE UNIQUE INDEX "user_verification_tokens_token_hash_key" ON "user_verification_tokens"("token_hash");
CREATE INDEX "user_verification_tokens_user_id_purpose_idx" ON "user_verification_tokens"("user_id", "purpose");

CREATE UNIQUE INDEX "user_auth_throttles_scope_key_key" ON "user_auth_throttles"("scope", "key");

CREATE INDEX "user_auth_audit_logs_user_id_created_at_idx" ON "user_auth_audit_logs"("user_id", "created_at");
CREATE INDEX "user_auth_audit_logs_action_created_at_idx" ON "user_auth_audit_logs"("action", "created_at");

CREATE UNIQUE INDEX "user_watch_states_user_id_entity_type_entity_id_key" ON "user_watch_states"("user_id", "entity_type", "entity_id");
CREATE INDEX "user_watch_states_entity_type_entity_id_idx" ON "user_watch_states"("entity_type", "entity_id");
CREATE INDEX "user_watch_states_user_id_status_idx" ON "user_watch_states"("user_id", "status");

CREATE UNIQUE INDEX "user_episode_progress_user_id_episode_id_key" ON "user_episode_progress"("user_id", "episode_id");
CREATE INDEX "user_episode_progress_episode_id_idx" ON "user_episode_progress"("episode_id");

CREATE UNIQUE INDEX "user_viewing_events_user_id_idempotency_key_key" ON "user_viewing_events"("user_id", "idempotency_key");
CREATE INDEX "user_viewing_events_user_id_occurred_at_idx" ON "user_viewing_events"("user_id", "occurred_at");
CREATE INDEX "user_viewing_events_entity_type_entity_id_idx" ON "user_viewing_events"("entity_type", "entity_id");

CREATE UNIQUE INDEX "user_lists_owner_id_slug_key" ON "user_lists"("owner_id", "slug");
CREATE INDEX "user_lists_owner_id_kind_idx" ON "user_lists"("owner_id", "kind");
-- Uma lista de sistema de cada tipo por usuario (indice unico PARCIAL).
CREATE UNIQUE INDEX "user_lists_owner_system_key_unique" ON "user_lists"("owner_id", "system_key") WHERE "system_key" IS NOT NULL;

CREATE UNIQUE INDEX "user_list_items_list_id_entity_type_entity_id_key" ON "user_list_items"("list_id", "entity_type", "entity_id");
CREATE INDEX "user_list_items_entity_type_entity_id_idx" ON "user_list_items"("entity_type", "entity_id");

CREATE UNIQUE INDEX "user_ratings_user_id_entity_type_entity_id_key" ON "user_ratings"("user_id", "entity_type", "entity_id");
CREATE INDEX "user_ratings_entity_type_entity_id_idx" ON "user_ratings"("entity_type", "entity_id");

CREATE INDEX "user_reviews_user_id_idx" ON "user_reviews"("user_id");
CREATE INDEX "user_reviews_entity_type_entity_id_status_idx" ON "user_reviews"("entity_type", "entity_id", "status");

CREATE UNIQUE INDEX "user_review_reports_review_id_reporter_id_key" ON "user_review_reports"("review_id", "reporter_id");
CREATE INDEX "user_review_reports_status_idx" ON "user_review_reports"("status");

CREATE UNIQUE INDEX "user_blocks_blocker_id_blocked_id_key" ON "user_blocks"("blocker_id", "blocked_id");

CREATE UNIQUE INDEX "user_stats_snapshots_user_id_key" ON "user_stats_snapshots"("user_id");

CREATE INDEX "user_recommendation_snapshots_user_id_is_current_idx" ON "user_recommendation_snapshots"("user_id", "is_current");
-- No maximo UM snapshot atual por usuario (indice unico PARCIAL).
CREATE UNIQUE INDEX "user_recommendation_snapshots_current_unique" ON "user_recommendation_snapshots"("user_id") WHERE "is_current" = true;

CREATE INDEX "user_consent_records_user_id_kind_occurred_at_idx" ON "user_consent_records"("user_id", "kind", "occurred_at");

CREATE INDEX "user_data_requests_user_id_kind_idx" ON "user_data_requests"("user_id", "kind");
CREATE INDEX "user_data_requests_status_idx" ON "user_data_requests"("status");

CREATE INDEX "user_import_jobs_user_id_status_idx" ON "user_import_jobs"("user_id", "status");

-- ============================================================
-- 4. FOREIGN KEYS
--    CASCADE: artefatos de auth (morrem com o usuario).
--    RESTRICT: UGC/LGPD (exclusao passa pelo fluxo governado de
--    anonimizacao, nunca por cascade acidental).
--    SET NULL: audit (sobrevive a hard-delete eventual, sem PII).
-- ============================================================

ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_password_credentials" ADD CONSTRAINT "user_password_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_accounts" ADD CONSTRAINT "user_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_rotated_from_id_fkey" FOREIGN KEY ("rotated_from_id") REFERENCES "user_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "user_verification_tokens" ADD CONSTRAINT "user_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- RESTRICT (nao SET NULL): a exclusao LGPD anonimiza a linha de users (tumba),
-- nunca faz hard-delete; e SET NULL seria um UPDATE bloqueado pelo trigger
-- append-only abaixo. Hard-delete futuro exige tratar o audit conscientemente.
ALTER TABLE "user_auth_audit_logs" ADD CONSTRAINT "user_auth_audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "user_watch_states" ADD CONSTRAINT "user_watch_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_episode_progress" ADD CONSTRAINT "user_episode_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_viewing_events" ADD CONSTRAINT "user_viewing_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_lists" ADD CONSTRAINT "user_lists_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_list_items" ADD CONSTRAINT "user_list_items_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "user_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_ratings" ADD CONSTRAINT "user_ratings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_reviews" ADD CONSTRAINT "user_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_review_reports" ADD CONSTRAINT "user_review_reports_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "user_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_review_reports" ADD CONSTRAINT "user_review_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_stats_snapshots" ADD CONSTRAINT "user_stats_snapshots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_recommendation_snapshots" ADD CONSTRAINT "user_recommendation_snapshots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_consent_records" ADD CONSTRAINT "user_consent_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_data_requests" ADD CONSTRAINT "user_data_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_import_jobs" ADD CONSTRAINT "user_import_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- FK composta real para o registry de entidades (D1 evoluido): impede
-- watch state/rating/review/lista/evento apontando para entidade inexistente.
ALTER TABLE "user_watch_states" ADD CONSTRAINT "user_watch_states_entity_fkey" FOREIGN KEY ("entity_type", "entity_id") REFERENCES "entities"("entity_type", "entity_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_viewing_events" ADD CONSTRAINT "user_viewing_events_entity_fkey" FOREIGN KEY ("entity_type", "entity_id") REFERENCES "entities"("entity_type", "entity_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_list_items" ADD CONSTRAINT "user_list_items_entity_fkey" FOREIGN KEY ("entity_type", "entity_id") REFERENCES "entities"("entity_type", "entity_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_ratings" ADD CONSTRAINT "user_ratings_entity_fkey" FOREIGN KEY ("entity_type", "entity_id") REFERENCES "entities"("entity_type", "entity_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_reviews" ADD CONSTRAINT "user_reviews_entity_fkey" FOREIGN KEY ("entity_type", "entity_id") REFERENCES "entities"("entity_type", "entity_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- FK real para episodios (nao expressa no Prisma, como as FKs de entities):
-- RESTRICT fail-closed — remover episodio do catalogo exige tratar
-- conscientemente o progresso de usuarios, nunca destruir por cascade.
ALTER TABLE "user_episode_progress" ADD CONSTRAINT "user_episode_progress_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- 5. TRIGGERS APPEND-ONLY (fail-closed)
--    Diario, audit de auth e consentimento nunca sao reescritos:
--    correcao = nova linha (undo preserva o evento original).
--    DELETE permanece possivel SO para o fluxo governado de
--    exclusao/retencao LGPD.
-- ============================================================

CREATE OR REPLACE FUNCTION user_platform_append_only_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'governanca fail-closed: a tabela % e append-only (UPDATE proibido); corrija criando uma nova linha', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER "user_viewing_events_append_only"
  BEFORE UPDATE ON "user_viewing_events"
  FOR EACH ROW EXECUTE FUNCTION user_platform_append_only_guard();

CREATE TRIGGER "user_auth_audit_logs_append_only"
  BEFORE UPDATE ON "user_auth_audit_logs"
  FOR EACH ROW EXECUTE FUNCTION user_platform_append_only_guard();

CREATE TRIGGER "user_consent_records_append_only"
  BEFORE UPDATE ON "user_consent_records"
  FOR EACH ROW EXECUTE FUNCTION user_platform_append_only_guard();
