-- CreateEnum
CREATE TYPE "TmdbEntityKind" AS ENUM ('movie', 'tv', 'season', 'episode', 'person', 'collection', 'network', 'company', 'keyword');

-- CreateTable
CREATE TABLE "tmdb_raw" (
    "id" BIGSERIAL NOT NULL,
    "entity_type" "TmdbEntityKind" NOT NULL,
    "tmdb_id" INTEGER NOT NULL,
    "base_language" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "etag" TEXT,
    "last_modified" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tmdb_raw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tmdb_image_config" (
    "provider_api" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "secure_base_url" TEXT NOT NULL,
    "poster_sizes" JSONB NOT NULL,
    "backdrop_sizes" JSONB NOT NULL,
    "still_sizes" JSONB NOT NULL,
    "profile_sizes" JSONB NOT NULL,
    "logo_sizes" JSONB NOT NULL,
    "change_keys" JSONB,
    "etag" TEXT,
    "last_modified" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tmdb_image_config_pkey" PRIMARY KEY ("provider_api")
);

-- CreateIndex
CREATE INDEX "tmdb_raw_payload_hash_idx" ON "tmdb_raw"("payload_hash");

-- CreateIndex
CREATE INDEX "tmdb_raw_fetched_at_idx" ON "tmdb_raw"("fetched_at");

-- CreateIndex
CREATE UNIQUE INDEX "tmdb_raw_entity_type_tmdb_id_base_language_key" ON "tmdb_raw"("entity_type", "tmdb_id", "base_language");
