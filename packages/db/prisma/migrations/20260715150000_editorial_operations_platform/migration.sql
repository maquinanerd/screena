-- Fases 12–13: identidade editorial, auditoria e pipeline RSSPRIME.
-- Forward-only. Todos os defaults de exibicao permanecem fail-closed.

CREATE TYPE "AdminRole" AS ENUM ('viewer', 'reviewer', 'editor', 'administrator');
CREATE TYPE "NewsClusterStatus" AS ENUM ('captured', 'normalized', 'gated', 'needs_review', 'blocked', 'processed', 'dead_letter');
CREATE TYPE "NewsEditorialDecisionKind" AS ENUM ('accepted', 'rejected', 'needs_review', 'blocked_license', 'blocked_source', 'duplicate', 'insufficient_evidence');
CREATE TYPE "NewsEntityCandidateDecision" AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE "admin_users" (
  "id" BIGSERIAL PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "display_name" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "role" "AdminRole" NOT NULL DEFAULT 'viewer',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "failed_login_count" INTEGER NOT NULL DEFAULT 0,
  "locked_until" TIMESTAMP(3),
  "password_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "disabled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "admin_sessions" (
  "id" BIGSERIAL PRIMARY KEY,
  "user_id" BIGINT NOT NULL REFERENCES "admin_users"("id") ON DELETE CASCADE,
  "token_hash" TEXT NOT NULL UNIQUE,
  "csrf_secret" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "admin_sessions_user_id_idx" ON "admin_sessions"("user_id");
CREATE INDEX "admin_sessions_expires_at_idx" ON "admin_sessions"("expires_at");

CREATE TABLE "admin_audit_logs" (
  "id" BIGSERIAL PRIMARY KEY,
  "actor_id" BIGINT REFERENCES "admin_users"("id") ON DELETE SET NULL,
  "actor_role" "AdminRole",
  "action" TEXT NOT NULL,
  "resource" TEXT NOT NULL,
  "entity_type" TEXT,
  "entity_id" TEXT,
  "before_json" JSONB,
  "after_json" JSONB,
  "reason" TEXT,
  "request_id" TEXT,
  "idempotency_key" TEXT,
  "outcome" TEXT NOT NULL,
  "error_code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "admin_audit_logs_actor_id_idx" ON "admin_audit_logs"("actor_id");
CREATE INDEX "admin_audit_logs_resource_entity_id_idx" ON "admin_audit_logs"("resource", "entity_id");
CREATE INDEX "admin_audit_logs_created_at_idx" ON "admin_audit_logs"("created_at");

CREATE TABLE "admin_idempotency_records" (
  "id" BIGSERIAL PRIMARY KEY,
  "actor_id" BIGINT NOT NULL,
  "key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "response_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "admin_idempotency_records_actor_id_key_key" UNIQUE ("actor_id", "key")
);
CREATE INDEX "admin_idempotency_records_expires_at_idx" ON "admin_idempotency_records"("expires_at");

CREATE TABLE "news_clusters" (
  "id" BIGSERIAL PRIMARY KEY,
  "external_cluster_id" TEXT UNIQUE,
  "event_key" TEXT UNIQUE,
  "fingerprint" TEXT NOT NULL UNIQUE,
  "topic" TEXT,
  "title" TEXT NOT NULL,
  "summary" TEXT,
  "language_code" TEXT,
  "country_code" TEXT,
  "source_count" INTEGER NOT NULL DEFAULT 0,
  "confidence" DOUBLE PRECISION,
  "primary_source" TEXT,
  "payload" JSONB NOT NULL,
  "payload_hash" TEXT NOT NULL,
  "status" "NewsClusterStatus" NOT NULL DEFAULT 'captured',
  "first_seen" TIMESTAMP(3),
  "last_seen" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "news_clusters_status_idx" ON "news_clusters"("status");
CREATE INDEX "news_clusters_topic_idx" ON "news_clusters"("topic");

CREATE TABLE "news_cluster_sources" (
  "id" BIGSERIAL PRIMARY KEY,
  "cluster_id" BIGINT NOT NULL REFERENCES "news_clusters"("id") ON DELETE CASCADE,
  "source_name" TEXT NOT NULL,
  "source_url" TEXT,
  "source_license_id" BIGINT REFERENCES "source_licenses"("id") ON DELETE SET NULL,
  "blocked" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "news_cluster_sources_cluster_id_source_name_key" UNIQUE ("cluster_id", "source_name")
);

CREATE TABLE "news_cluster_urls" (
  "id" BIGSERIAL PRIMARY KEY,
  "cluster_id" BIGINT NOT NULL REFERENCES "news_clusters"("id") ON DELETE CASCADE,
  "url" TEXT NOT NULL,
  "canonical_url" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "news_cluster_urls_cluster_id_url_key" UNIQUE ("cluster_id", "url")
);
CREATE INDEX "news_cluster_urls_canonical_url_idx" ON "news_cluster_urls"("canonical_url");

CREATE TABLE "news_editorial_decisions" (
  "id" BIGSERIAL PRIMARY KEY,
  "cluster_id" BIGINT NOT NULL REFERENCES "news_clusters"("id") ON DELETE CASCADE,
  "decision" "NewsEditorialDecisionKind" NOT NULL,
  "score" DOUBLE PRECISION NOT NULL,
  "policy_version" TEXT NOT NULL,
  "reasons_json" JSONB NOT NULL,
  "signals_json" JSONB NOT NULL,
  "warnings_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "news_editorial_decisions_cluster_id_created_at_idx" ON "news_editorial_decisions"("cluster_id", "created_at");

CREATE TABLE "news_facts" (
  "id" BIGSERIAL PRIMARY KEY,
  "cluster_id" BIGINT NOT NULL REFERENCES "news_clusters"("id") ON DELETE CASCADE,
  "fact_type" TEXT NOT NULL,
  "value_json" JSONB NOT NULL,
  "source_url" TEXT,
  "source_license_id" BIGINT REFERENCES "source_licenses"("id") ON DELETE SET NULL,
  "confidence" DOUBLE PRECISION,
  "fingerprint" TEXT NOT NULL,
  "conflict_key" TEXT,
  "extracted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "news_facts_cluster_id_fingerprint_key" UNIQUE ("cluster_id", "fingerprint")
);
CREATE INDEX "news_facts_cluster_id_conflict_key_idx" ON "news_facts"("cluster_id", "conflict_key");

CREATE TABLE "news_entity_candidates" (
  "id" BIGSERIAL PRIMARY KEY,
  "cluster_id" BIGINT NOT NULL REFERENCES "news_clusters"("id") ON DELETE CASCADE,
  "entity_type" "EntityType" NOT NULL,
  "entity_id" BIGINT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "evidence" JSONB NOT NULL,
  "decision" "NewsEntityCandidateDecision" NOT NULL DEFAULT 'pending',
  "decided_by" TEXT,
  "decided_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "news_entity_candidates_cluster_id_entity_type_entity_id_key" UNIQUE ("cluster_id", "entity_type", "entity_id")
);

CREATE TABLE "news_pipeline_checkpoints" (
  "id" BIGSERIAL PRIMARY KEY,
  "pipeline" TEXT NOT NULL,
  "topic" TEXT,
  "cursor" TEXT,
  "etag" TEXT,
  "last_modified" TEXT,
  "cluster_id" BIGINT REFERENCES "news_clusters"("id") ON DELETE SET NULL,
  "heartbeat_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "done" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "news_pipeline_checkpoints_pipeline_topic_key" UNIQUE ("pipeline", "topic")
);

CREATE TABLE "news_dead_letters" (
  "id" BIGSERIAL PRIMARY KEY,
  "cluster_id" BIGINT REFERENCES "news_clusters"("id") ON DELETE SET NULL,
  "stage" TEXT NOT NULL,
  "error_code" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 1,
  "payload_json" JSONB,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "news_dead_letters_resolved_at_idx" ON "news_dead_letters"("resolved_at");

ALTER TABLE "articles" ADD COLUMN "cluster_id" BIGINT UNIQUE;
ALTER TABLE "articles" ADD CONSTRAINT "articles_cluster_id_fkey" FOREIGN KEY ("cluster_id") REFERENCES "news_clusters"("id") ON DELETE SET NULL;
ALTER TABLE "article_translations" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- Registro tecnico do upstream. Nao expressa licenca editorial nem habilita exibicao.
INSERT INTO "api_providers" ("key", "name", "kind", "homepage_url")
VALUES ('rssprime', 'RSSPRIME', 'news', NULL)
ON CONFLICT ("key") DO NOTHING;
