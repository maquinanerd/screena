-- Backend A: fila duravel de jobs do catalogo (catalog_jobs) + projecao de
-- busca PostgreSQL (search_documents) com unaccent + pg_trgm.
--
-- Forward-only e ADITIVA: apenas CREATE de tipos/tabelas/indices/funcao NOVOS;
-- nenhuma tabela existente e alterada, nenhuma linha e apagada. Reaplicar e
-- seguro. AUTOCONTIDA: nenhuma FK para `entities` (segura no cenario de upgrade,
-- onde a migration de hardening ainda nao rodou — mesmo padrao de genres/tmdb_*).
--
-- Governanca: worker/infra-only. Nenhuma destas tabelas e lida no caminho de
-- render de pagina indexavel. search_documents so indexa entidades RENDERAVEIS
-- (movie/tv/person) e nunca dado sem licenca/slug (a promocao para search e
-- decidida fora do render).

-- Extensoes de busca (contrib padrao do PostgreSQL). Idempotentes.
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Wrapper IMMUTABLE de unaccent: a funcao unaccent(text) da extensao e apenas
-- STABLE (depende do dicionario), o que a proibe de indices/generated columns.
-- Fixar o regdictionary a torna IMMUTABLE e utilizavel em indice funcional.
CREATE OR REPLACE FUNCTION immutable_unaccent(text)
    RETURNS text
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
    STRICT
AS $$
    SELECT public.unaccent('public.unaccent'::regdictionary, $1)
$$;

-- CreateEnum: tipo de job de catalogo (distinto do JobType writer-scoped)
CREATE TYPE "CatalogJobType" AS ENUM (
    'bootstrap',
    'discover_ids',
    'sync_details',
    'sync_credits',
    'sync_external_ids',
    'sync_media',
    'sync_seasons',
    'sync_episodes',
    'sync_lists',
    'sync_changes',
    'reprocess_raw'
);

-- CreateEnum: estado de job de catalogo (distinto do JobStatus writer-scoped)
CREATE TYPE "CatalogJobStatus" AS ENUM (
    'pending',
    'claimed',
    'running',
    'retry_wait',
    'succeeded',
    'failed',
    'dead_letter',
    'cancelled'
);

-- CreateTable: fila duravel de jobs do catalogo
CREATE TABLE "catalog_jobs" (
    "id" BIGSERIAL NOT NULL,
    "job_type" "CatalogJobType" NOT NULL,
    "status" "CatalogJobStatus" NOT NULL DEFAULT 'pending',
    "entity_type" "TmdbEntityKind",
    "external_id" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "idempotency_key" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMP(3),
    "heartbeat_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "last_error_safe" TEXT,
    "run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable: projecao denormalizada para busca PostgreSQL
CREATE TABLE "search_documents" (
    "id" BIGSERIAL NOT NULL,
    "entity_type" "EntityType" NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "locale" TEXT NOT NULL,
    "primary_text" TEXT NOT NULL,
    "alternative_text" TEXT NOT NULL DEFAULT '',
    "normalized_text" TEXT NOT NULL,
    "normalized_aliases" TEXT NOT NULL DEFAULT '',
    "subtitle" TEXT,
    "year" INTEGER,
    "popularity" DECIMAL(65,30),
    "image_path" TEXT,
    "canonical_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "search_documents_pkey" PRIMARY KEY ("id")
);

-- Indexes: catalog_jobs
CREATE UNIQUE INDEX "catalog_jobs_idempotency_key_key" ON "catalog_jobs"("idempotency_key");
CREATE INDEX "catalog_jobs_status_priority_available_at_idx" ON "catalog_jobs"("status", "priority", "available_at");
CREATE INDEX "catalog_jobs_entity_type_external_id_idx" ON "catalog_jobs"("entity_type", "external_id");
CREATE INDEX "catalog_jobs_heartbeat_at_idx" ON "catalog_jobs"("heartbeat_at");

-- Indexes: search_documents
CREATE UNIQUE INDEX "search_documents_entity_type_entity_id_locale_key" ON "search_documents"("entity_type", "entity_id", "locale");
CREATE INDEX "search_documents_locale_idx" ON "search_documents"("locale");
-- Trigram GIN sobre o texto ja dobrado (busca fuzzy acento-insensivel).
CREATE INDEX "search_documents_normalized_text_trgm" ON "search_documents" USING gin ("normalized_text" gin_trgm_ops);
-- Indice funcional acento-insensivel sobre o titulo cru, provando o wrapper
-- IMMUTABLE em uso (fold no proprio banco, alem do fold deterministico do worker).
CREATE INDEX "search_documents_primary_text_unaccent_trgm" ON "search_documents" USING gin (immutable_unaccent(lower("primary_text")) gin_trgm_ops);
