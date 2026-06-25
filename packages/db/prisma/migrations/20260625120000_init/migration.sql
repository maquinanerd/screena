-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('movie', 'tv', 'season', 'episode', 'person');

-- CreateEnum
CREATE TYPE "ContentBlockType" AS ENUM ('editorial_intro', 'summary_without_spoilers', 'ratings_explanation', 'where_to_watch_text', 'cast_intro', 'similar_titles_intro', 'franchise_context', 'season_guide', 'episode_context', 'faq', 'news_context', 'review_summary');

-- CreateEnum
CREATE TYPE "ContentSource" AS ENUM ('ai', 'human', 'hybrid');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('draft', 'ai_generated', 'needs_review', 'human_reviewed', 'published', 'needs_update', 'blocked', 'archived');

-- CreateEnum
CREATE TYPE "TranslationStatus" AS ENUM ('draft', 'generated', 'reviewed', 'published', 'noindex', 'archived');

-- CreateEnum
CREATE TYPE "IndexDecision" AS ENUM ('index', 'noindex', 'draft', 'stale', 'blocked');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('generate_block', 'regenerate_block', 'translate_block');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('queued', 'claimed', 'running', 'completed', 'failed', 'blocked', 'cancelled');

-- CreateEnum
CREATE TYPE "LicenseStatus" AS ENUM ('official', 'licensed', 'third_party', 'unknown', 'blocked');

-- CreateEnum
CREATE TYPE "OfferType" AS ENUM ('subscription', 'rent', 'buy', 'free', 'ads', 'cinema');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('success', 'partial', 'failed', 'empty', 'aborted');

-- CreateEnum
CREATE TYPE "ValidationStatus" AS ENUM ('passed', 'warnings', 'failed');

-- CreateEnum
CREATE TYPE "ProviderKind" AS ENUM ('data', 'ratings', 'streaming', 'ai', 'news');

-- CreateTable
CREATE TABLE "languages" (
    "code" TEXT NOT NULL,
    "name_pt" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "index_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "languages_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "countries" (
    "code" TEXT NOT NULL,
    "name_pt" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "rating_sources" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "scale" INTEGER NOT NULL,
    "homepage_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rating_sources_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "api_providers" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ProviderKind" NOT NULL,
    "homepage_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_providers_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "source_licenses" (
    "id" BIGSERIAL NOT NULL,
    "source_key" TEXT NOT NULL,
    "provider_key" TEXT,
    "license_status" "LicenseStatus" NOT NULL DEFAULT 'unknown',
    "display_allowed" BOOLEAN NOT NULL DEFAULT false,
    "logo_allowed" BOOLEAN NOT NULL DEFAULT false,
    "score_allowed" BOOLEAN NOT NULL DEFAULT false,
    "review_quote_allowed" BOOLEAN NOT NULL DEFAULT false,
    "requires_attribution" BOOLEAN NOT NULL DEFAULT true,
    "requires_linkback" BOOLEAN NOT NULL DEFAULT true,
    "attribution_text" TEXT,
    "terms_url" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movies" (
    "id" BIGSERIAL NOT NULL,
    "tmdb_id" INTEGER NOT NULL,
    "imdb_id" TEXT,
    "title_original" TEXT NOT NULL,
    "original_language" TEXT,
    "release_date" DATE,
    "runtime_minutes" INTEGER,
    "status" TEXT,
    "popularity" DECIMAL(65,30),
    "vote_average_tmdb" DECIMAL(65,30),
    "vote_count_tmdb" INTEGER,
    "poster_path" TEXT,
    "backdrop_path" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_synced_at" TIMESTAMP(3),
    "stale_after" TIMESTAMP(3),

    CONSTRAINT "movies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tv_shows" (
    "id" BIGSERIAL NOT NULL,
    "tmdb_id" INTEGER NOT NULL,
    "imdb_id" TEXT,
    "name_original" TEXT NOT NULL,
    "original_language" TEXT,
    "first_air_date" DATE,
    "last_air_date" DATE,
    "status" TEXT,
    "number_of_seasons" INTEGER,
    "number_of_episodes" INTEGER,
    "popularity" DECIMAL(65,30),
    "vote_average_tmdb" DECIMAL(65,30),
    "vote_count_tmdb" INTEGER,
    "poster_path" TEXT,
    "backdrop_path" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_synced_at" TIMESTAMP(3),
    "stale_after" TIMESTAMP(3),

    CONSTRAINT "tv_shows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seasons" (
    "id" BIGSERIAL NOT NULL,
    "tv_show_id" BIGINT NOT NULL,
    "tmdb_id" INTEGER,
    "season_number" INTEGER NOT NULL,
    "name" TEXT,
    "overview" TEXT,
    "air_date" DATE,
    "episode_count" INTEGER,
    "poster_path" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_synced_at" TIMESTAMP(3),

    CONSTRAINT "seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "episodes" (
    "id" BIGSERIAL NOT NULL,
    "season_id" BIGINT NOT NULL,
    "tv_show_id" BIGINT NOT NULL,
    "tmdb_id" INTEGER,
    "season_number" INTEGER NOT NULL,
    "episode_number" INTEGER NOT NULL,
    "name" TEXT,
    "overview" TEXT,
    "air_date" DATE,
    "runtime_minutes" INTEGER,
    "still_path" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_synced_at" TIMESTAMP(3),

    CONSTRAINT "episodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people" (
    "id" BIGSERIAL NOT NULL,
    "tmdb_id" INTEGER NOT NULL,
    "imdb_id" TEXT,
    "name" TEXT NOT NULL,
    "known_for_department" TEXT,
    "gender" INTEGER,
    "birthday" DATE,
    "deathday" DATE,
    "place_of_birth" TEXT,
    "profile_path" TEXT,
    "biography_source_status" "LicenseStatus" NOT NULL DEFAULT 'unknown',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_synced_at" TIMESTAMP(3),

    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cast_members" (
    "id" BIGSERIAL NOT NULL,
    "person_id" BIGINT NOT NULL,
    "entity_type" "EntityType" NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "character" TEXT,
    "billing_order" INTEGER,
    "credit_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cast_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crew_members" (
    "id" BIGSERIAL NOT NULL,
    "person_id" BIGINT NOT NULL,
    "entity_type" "EntityType" NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "department" TEXT,
    "job" TEXT,
    "credit_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crew_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_external_ids" (
    "id" BIGSERIAL NOT NULL,
    "entity_type" "EntityType" NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_external_ids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slugs" (
    "id" BIGSERIAL NOT NULL,
    "entity_type" "EntityType" NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "language_code" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "is_canonical" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slugs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "redirects" (
    "id" BIGSERIAL NOT NULL,
    "from_path" TEXT NOT NULL,
    "to_path" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL DEFAULT 301,
    "language_code" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "redirects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_translations" (
    "id" BIGSERIAL NOT NULL,
    "entity_type" "EntityType" NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "language_code" TEXT NOT NULL,
    "title" TEXT,
    "meta_title" TEXT,
    "meta_description" TEXT,
    "summary" TEXT,
    "editorial_intro" TEXT,
    "faq_json" JSONB,
    "status" "TranslationStatus" NOT NULL DEFAULT 'draft',
    "index_status" "IndexDecision" NOT NULL DEFAULT 'noindex',
    "reviewed_by" TEXT,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entity_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_blocks" (
    "id" BIGSERIAL NOT NULL,
    "entity_type" "EntityType" NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "language_code" TEXT NOT NULL,
    "block_type" "ContentBlockType" NOT NULL,
    "content" TEXT NOT NULL,
    "source_type" "ContentSource" NOT NULL DEFAULT 'ai',
    "model_provider" TEXT,
    "model_name" TEXT,
    "prompt_version" TEXT NOT NULL,
    "input_hash" TEXT NOT NULL,
    "output_hash" TEXT NOT NULL,
    "review_status" "ReviewStatus" NOT NULL DEFAULT 'draft',
    "warnings_json" JSONB,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_writer_jobs" (
    "id" BIGSERIAL NOT NULL,
    "entity_type" "EntityType" NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "language_code" TEXT NOT NULL,
    "job_type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "payload_hash" TEXT,
    "prompt_version" TEXT,
    "model_provider" TEXT,
    "model_name" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "result_block_id" BIGINT,
    "claimed_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entity_writer_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_writer_logs" (
    "id" BIGSERIAL NOT NULL,
    "job_id" BIGINT NOT NULL,
    "entity_type" "EntityType" NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "language_code" TEXT NOT NULL,
    "model_provider" TEXT,
    "model_name" TEXT,
    "prompt_version" TEXT,
    "input_hash" TEXT,
    "output_hash" TEXT,
    "token_input" INTEGER,
    "token_output" INTEGER,
    "validation_status" "ValidationStatus",
    "warnings_json" JSONB,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_writer_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_ratings" (
    "id" BIGSERIAL NOT NULL,
    "entity_type" "EntityType" NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "rating_source" TEXT NOT NULL,
    "rating_label" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "rating_value" DECIMAL(65,30) NOT NULL,
    "rating_scale" INTEGER NOT NULL,
    "rating_count" INTEGER,
    "rating_url" TEXT,
    "provider_api" TEXT NOT NULL,
    "provider_payload_hash" TEXT,
    "fetched_at" TIMESTAMP(3),
    "attribution_text" TEXT,
    "attribution_url" TEXT,
    "license_status" "LicenseStatus" NOT NULL DEFAULT 'unknown',
    "display_allowed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watch_availability" (
    "id" BIGSERIAL NOT NULL,
    "entity_type" "EntityType" NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "country_code" TEXT NOT NULL,
    "provider_key" TEXT,
    "provider_name" TEXT NOT NULL,
    "offer_type" "OfferType" NOT NULL,
    "deep_link" TEXT,
    "price" DECIMAL(65,30),
    "currency" CHAR(3),
    "quality" TEXT,
    "available_from" TIMESTAMP(3),
    "available_until" TIMESTAMP(3),
    "fetched_at" TIMESTAMP(3),
    "stale_after" TIMESTAMP(3),
    "provider_api" TEXT,
    "display_allowed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "watch_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_indexability_decisions" (
    "id" BIGSERIAL NOT NULL,
    "entity_type" "EntityType" NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "language_code" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "decision" "IndexDecision" NOT NULL DEFAULT 'noindex',
    "reason" TEXT,
    "value_blocks_count" INTEGER NOT NULL DEFAULT 0,
    "has_unique_intro" BOOLEAN NOT NULL DEFAULT false,
    "has_watch_data" BOOLEAN NOT NULL DEFAULT false,
    "has_ratings" BOOLEAN NOT NULL DEFAULT false,
    "has_news" BOOLEAN NOT NULL DEFAULT false,
    "has_review" BOOLEAN NOT NULL DEFAULT false,
    "has_faq" BOOLEAN NOT NULL DEFAULT false,
    "has_trailer" BOOLEAN NOT NULL DEFAULT false,
    "thin_content_score" DOUBLE PRECISION,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_indexability_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_cache" (
    "id" BIGSERIAL NOT NULL,
    "provider_api" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "request_key" TEXT NOT NULL,
    "params_hash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_sync_logs" (
    "id" BIGSERIAL NOT NULL,
    "provider_api" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "status" "SyncStatus" NOT NULL,
    "error_code" TEXT,
    "items_processed" INTEGER NOT NULL DEFAULT 0,
    "items_created" INTEGER NOT NULL DEFAULT 0,
    "items_updated" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER,
    "quota_cost" INTEGER,
    "payload_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "source_licenses_source_key_idx" ON "source_licenses"("source_key");

-- CreateIndex
CREATE UNIQUE INDEX "movies_tmdb_id_key" ON "movies"("tmdb_id");

-- CreateIndex
CREATE UNIQUE INDEX "movies_imdb_id_key" ON "movies"("imdb_id");

-- CreateIndex
CREATE INDEX "movies_status_idx" ON "movies"("status");

-- CreateIndex
CREATE INDEX "movies_updated_at_idx" ON "movies"("updated_at");

-- CreateIndex
CREATE INDEX "movies_release_date_idx" ON "movies"("release_date");

-- CreateIndex
CREATE INDEX "movies_popularity_idx" ON "movies"("popularity");

-- CreateIndex
CREATE INDEX "movies_stale_after_idx" ON "movies"("stale_after");

-- CreateIndex
CREATE INDEX "movies_original_language_idx" ON "movies"("original_language");

-- CreateIndex
CREATE UNIQUE INDEX "tv_shows_tmdb_id_key" ON "tv_shows"("tmdb_id");

-- CreateIndex
CREATE UNIQUE INDEX "tv_shows_imdb_id_key" ON "tv_shows"("imdb_id");

-- CreateIndex
CREATE INDEX "tv_shows_status_idx" ON "tv_shows"("status");

-- CreateIndex
CREATE INDEX "tv_shows_updated_at_idx" ON "tv_shows"("updated_at");

-- CreateIndex
CREATE INDEX "tv_shows_first_air_date_idx" ON "tv_shows"("first_air_date");

-- CreateIndex
CREATE INDEX "tv_shows_last_air_date_idx" ON "tv_shows"("last_air_date");

-- CreateIndex
CREATE INDEX "tv_shows_popularity_idx" ON "tv_shows"("popularity");

-- CreateIndex
CREATE INDEX "tv_shows_stale_after_idx" ON "tv_shows"("stale_after");

-- CreateIndex
CREATE INDEX "tv_shows_original_language_idx" ON "tv_shows"("original_language");

-- CreateIndex
CREATE INDEX "seasons_tv_show_id_idx" ON "seasons"("tv_show_id");

-- CreateIndex
CREATE UNIQUE INDEX "seasons_id_tv_show_id_key" ON "seasons"("id", "tv_show_id");

-- CreateIndex
CREATE UNIQUE INDEX "seasons_tv_show_id_season_number_key" ON "seasons"("tv_show_id", "season_number");

-- CreateIndex
CREATE INDEX "episodes_tv_show_id_idx" ON "episodes"("tv_show_id");

-- CreateIndex
CREATE UNIQUE INDEX "episodes_season_id_episode_number_key" ON "episodes"("season_id", "episode_number");

-- CreateIndex
CREATE UNIQUE INDEX "people_tmdb_id_key" ON "people"("tmdb_id");

-- CreateIndex
CREATE UNIQUE INDEX "people_imdb_id_key" ON "people"("imdb_id");

-- CreateIndex
CREATE INDEX "people_updated_at_idx" ON "people"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "cast_members_credit_id_key" ON "cast_members"("credit_id");

-- CreateIndex
CREATE INDEX "cast_members_entity_type_entity_id_idx" ON "cast_members"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "cast_members_person_id_idx" ON "cast_members"("person_id");

-- CreateIndex
CREATE UNIQUE INDEX "crew_members_credit_id_key" ON "crew_members"("credit_id");

-- CreateIndex
CREATE INDEX "crew_members_entity_type_entity_id_idx" ON "crew_members"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "crew_members_person_id_idx" ON "crew_members"("person_id");

-- CreateIndex
CREATE INDEX "entity_external_ids_entity_type_entity_id_idx" ON "entity_external_ids"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "entity_external_ids_entity_type_entity_id_source_key" ON "entity_external_ids"("entity_type", "entity_id", "source");

-- CreateIndex
CREATE UNIQUE INDEX "entity_external_ids_source_external_id_key" ON "entity_external_ids"("source", "external_id");

-- CreateIndex
CREATE INDEX "slugs_entity_type_entity_id_language_code_idx" ON "slugs"("entity_type", "entity_id", "language_code");

-- CreateIndex
CREATE INDEX "slugs_language_code_idx" ON "slugs"("language_code");

-- CreateIndex
CREATE UNIQUE INDEX "slugs_entity_type_language_code_slug_key" ON "slugs"("entity_type", "language_code", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "redirects_from_path_key" ON "redirects"("from_path");

-- CreateIndex
CREATE INDEX "redirects_to_path_idx" ON "redirects"("to_path");

-- CreateIndex
CREATE INDEX "entity_translations_entity_type_entity_id_idx" ON "entity_translations"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "entity_translations_language_code_idx" ON "entity_translations"("language_code");

-- CreateIndex
CREATE UNIQUE INDEX "entity_translations_entity_type_entity_id_language_code_key" ON "entity_translations"("entity_type", "entity_id", "language_code");

-- CreateIndex
CREATE INDEX "content_blocks_entity_type_entity_id_language_code_idx" ON "content_blocks"("entity_type", "entity_id", "language_code");

-- CreateIndex
CREATE INDEX "content_blocks_review_status_idx" ON "content_blocks"("review_status");

-- CreateIndex
CREATE INDEX "entity_writer_jobs_entity_type_entity_id_language_code_idx" ON "entity_writer_jobs"("entity_type", "entity_id", "language_code");

-- CreateIndex
CREATE INDEX "entity_writer_jobs_status_idx" ON "entity_writer_jobs"("status");

-- CreateIndex
CREATE INDEX "entity_writer_logs_job_id_idx" ON "entity_writer_logs"("job_id");

-- CreateIndex
CREATE INDEX "entity_writer_logs_entity_type_entity_id_idx" ON "entity_writer_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "external_ratings_entity_type_entity_id_idx" ON "external_ratings"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "external_ratings_rating_source_idx" ON "external_ratings"("rating_source");

-- CreateIndex
CREATE INDEX "external_ratings_provider_api_idx" ON "external_ratings"("provider_api");

-- CreateIndex
CREATE UNIQUE INDEX "external_ratings_entity_type_entity_id_rating_source_metric_key" ON "external_ratings"("entity_type", "entity_id", "rating_source", "metric");

-- CreateIndex
CREATE INDEX "watch_availability_entity_type_entity_id_country_code_idx" ON "watch_availability"("entity_type", "entity_id", "country_code");

-- CreateIndex
CREATE INDEX "watch_availability_country_code_idx" ON "watch_availability"("country_code");

-- CreateIndex
CREATE INDEX "page_indexability_decisions_entity_type_entity_id_language__idx" ON "page_indexability_decisions"("entity_type", "entity_id", "language_code");

-- CreateIndex
CREATE INDEX "page_indexability_decisions_decision_idx" ON "page_indexability_decisions"("decision");

-- CreateIndex
CREATE INDEX "page_indexability_decisions_language_code_idx" ON "page_indexability_decisions"("language_code");

-- CreateIndex
CREATE INDEX "api_cache_expires_at_idx" ON "api_cache"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "api_cache_provider_api_request_key_params_hash_key" ON "api_cache"("provider_api", "request_key", "params_hash");

-- CreateIndex
CREATE INDEX "api_sync_logs_provider_api_idx" ON "api_sync_logs"("provider_api");

-- CreateIndex
CREATE INDEX "api_sync_logs_created_at_idx" ON "api_sync_logs"("created_at");

-- AddForeignKey
ALTER TABLE "movies" ADD CONSTRAINT "movies_original_language_fkey" FOREIGN KEY ("original_language") REFERENCES "languages"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tv_shows" ADD CONSTRAINT "tv_shows_original_language_fkey" FOREIGN KEY ("original_language") REFERENCES "languages"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_tv_show_id_fkey" FOREIGN KEY ("tv_show_id") REFERENCES "tv_shows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_season_id_tv_show_id_fkey" FOREIGN KEY ("season_id", "tv_show_id") REFERENCES "seasons"("id", "tv_show_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cast_members" ADD CONSTRAINT "cast_members_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slugs" ADD CONSTRAINT "slugs_language_code_fkey" FOREIGN KEY ("language_code") REFERENCES "languages"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redirects" ADD CONSTRAINT "redirects_language_code_fkey" FOREIGN KEY ("language_code") REFERENCES "languages"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_translations" ADD CONSTRAINT "entity_translations_language_code_fkey" FOREIGN KEY ("language_code") REFERENCES "languages"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_blocks" ADD CONSTRAINT "content_blocks_language_code_fkey" FOREIGN KEY ("language_code") REFERENCES "languages"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_writer_jobs" ADD CONSTRAINT "entity_writer_jobs_language_code_fkey" FOREIGN KEY ("language_code") REFERENCES "languages"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_writer_jobs" ADD CONSTRAINT "entity_writer_jobs_result_block_id_fkey" FOREIGN KEY ("result_block_id") REFERENCES "content_blocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_writer_logs" ADD CONSTRAINT "entity_writer_logs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "entity_writer_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_ratings" ADD CONSTRAINT "external_ratings_rating_source_fkey" FOREIGN KEY ("rating_source") REFERENCES "rating_sources"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_ratings" ADD CONSTRAINT "external_ratings_provider_api_fkey" FOREIGN KEY ("provider_api") REFERENCES "api_providers"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watch_availability" ADD CONSTRAINT "watch_availability_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_indexability_decisions" ADD CONSTRAINT "page_indexability_decisions_language_code_fkey" FOREIGN KEY ("language_code") REFERENCES "languages"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_cache" ADD CONSTRAINT "api_cache_provider_api_fkey" FOREIGN KEY ("provider_api") REFERENCES "api_providers"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_sync_logs" ADD CONSTRAINT "api_sync_logs_provider_api_fkey" FOREIGN KEY ("provider_api") REFERENCES "api_providers"("key") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================
-- Hardening de governanca (SQL bruto; Prisma nao expressa nativamente).
-- Ver docs/PHASE_1_DATABASE_PLAN.md, secao 6 (D5).
-- ============================================================

-- Indices unicos PARCIAIS (Prisma @@unique nao expressa WHERE) --------------

-- 1 slug canonico por (entity_type, entity_id, language_code)
CREATE UNIQUE INDEX "slugs_canonical_unique"
  ON "slugs" ("entity_type", "entity_id", "language_code")
  WHERE "is_canonical" = true;

-- 1 job ativo do Entity Writer por alvo
CREATE UNIQUE INDEX "entity_writer_jobs_active_unique"
  ON "entity_writer_jobs" ("entity_type", "entity_id", "language_code", "job_type")
  WHERE "status" IN ('queued', 'claimed', 'running');

-- 1 politica de licenca default por fonte (provider_key nulo)
CREATE UNIQUE INDEX "source_licenses_default_unique"
  ON "source_licenses" ("source_key")
  WHERE "provider_key" IS NULL;

-- CHECKs condicionais (Prisma nao expressa CHECK nativamente) ---------------

-- Bloco de IA exige modelo (invariante 8/13)
ALTER TABLE "content_blocks"
  ADD CONSTRAINT "content_blocks_ai_requires_model"
  CHECK ("source_type" = 'human' OR ("model_provider" IS NOT NULL AND "model_name" IS NOT NULL));

-- Preco exige moeda
ALTER TABLE "watch_availability"
  ADD CONSTRAINT "watch_availability_price_requires_currency"
  CHECK ("price" IS NULL OR "currency" IS NOT NULL);

-- Preco apenas em compra/aluguel
ALTER TABLE "watch_availability"
  ADD CONSTRAINT "watch_availability_price_only_transactional"
  CHECK ("offer_type" IN ('rent', 'buy') OR "price" IS NULL);

-- Sem auto-redirect (from_path != to_path)
ALTER TABLE "redirects"
  ADD CONSTRAINT "redirects_no_self_redirect"
  CHECK ("from_path" <> "to_path");

-- imdb_id nunca string vazia (nao ocupa o slot @unique nem mascara ausencia)
ALTER TABLE "movies"   ADD CONSTRAINT "movies_imdb_id_not_empty"   CHECK ("imdb_id" IS NULL OR "imdb_id" <> '');
ALTER TABLE "tv_shows" ADD CONSTRAINT "tv_shows_imdb_id_not_empty" CHECK ("imdb_id" IS NULL OR "imdb_id" <> '');
ALTER TABLE "people"   ADD CONSTRAINT "people_imdb_id_not_empty"   CHECK ("imdb_id" IS NULL OR "imdb_id" <> '');
