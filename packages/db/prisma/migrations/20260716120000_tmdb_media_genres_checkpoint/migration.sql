-- Fases 6-8: generos normalizados, biblioteca de midia (imagens/videos) e
-- checkpoint de sync incremental. Forward-only e ADITIVA: nenhuma tabela existente
-- e alterada; nenhuma linha e apagada. Reaplicar e seguro (CREATE de tabelas novas).
--
-- Governanca: midia nasce display_allowed=false + license_status=unknown
-- (invariante 6) — so METADADOS, nenhum binario baixado. Worker-only.

-- CreateTable: generos normalizados (media_type = movie|tv)
CREATE TABLE "genres" (
    "tmdb_id" INTEGER NOT NULL,
    "media_type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "genres_pkey" PRIMARY KEY ("media_type","tmdb_id")
);

-- CreateTable: metadados de imagens (poster|backdrop|logo|profile|still)
CREATE TABLE "tmdb_images" (
    "id" BIGSERIAL NOT NULL,
    "provider_api" TEXT NOT NULL DEFAULT 'tmdb',
    "entity_type" "TmdbEntityKind" NOT NULL,
    "tmdb_id" INTEGER NOT NULL,
    "image_type" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "language_code" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "aspect_ratio" DOUBLE PRECISION,
    "vote_average" DOUBLE PRECISION,
    "vote_count" INTEGER,
    "payload_hash" TEXT NOT NULL,
    "license_status" "LicenseStatus" NOT NULL DEFAULT 'unknown',
    "display_allowed" BOOLEAN NOT NULL DEFAULT false,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stale_after" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tmdb_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable: metadados de videos (Trailer|Teaser|Clip|...)
CREATE TABLE "tmdb_videos" (
    "id" BIGSERIAL NOT NULL,
    "provider_api" TEXT NOT NULL DEFAULT 'tmdb',
    "entity_type" "TmdbEntityKind" NOT NULL,
    "tmdb_id" INTEGER NOT NULL,
    "tmdb_video_id" TEXT NOT NULL,
    "site" TEXT NOT NULL,
    "video_key" TEXT NOT NULL,
    "name" TEXT,
    "video_type" TEXT,
    "official" BOOLEAN,
    "language_code" TEXT,
    "country_code" TEXT,
    "size" INTEGER,
    "published_at" TIMESTAMP(3),
    "payload_hash" TEXT NOT NULL,
    "license_status" "LicenseStatus" NOT NULL DEFAULT 'unknown',
    "display_allowed" BOOLEAN NOT NULL DEFAULT false,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stale_after" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tmdb_videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable: checkpoint/resume de paginacao por job
CREATE TABLE "tmdb_sync_checkpoint" (
    "id" BIGSERIAL NOT NULL,
    "provider_api" TEXT NOT NULL DEFAULT 'tmdb',
    "job" TEXT NOT NULL,
    "params_hash" TEXT NOT NULL,
    "last_page" INTEGER NOT NULL DEFAULT 0,
    "total_pages" INTEGER,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "cursor" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tmdb_sync_checkpoint_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "tmdb_images_entity_type_tmdb_id_image_type_file_path_key" ON "tmdb_images"("entity_type", "tmdb_id", "image_type", "file_path");
CREATE INDEX "tmdb_images_entity_type_tmdb_id_idx" ON "tmdb_images"("entity_type", "tmdb_id");
CREATE UNIQUE INDEX "tmdb_videos_entity_type_tmdb_id_tmdb_video_id_key" ON "tmdb_videos"("entity_type", "tmdb_id", "tmdb_video_id");
CREATE INDEX "tmdb_videos_entity_type_tmdb_id_idx" ON "tmdb_videos"("entity_type", "tmdb_id");
CREATE UNIQUE INDEX "tmdb_sync_checkpoint_job_params_hash_key" ON "tmdb_sync_checkpoint"("job", "params_hash");
