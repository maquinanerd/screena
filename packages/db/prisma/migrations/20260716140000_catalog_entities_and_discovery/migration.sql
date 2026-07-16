-- Backend A (continuacao): entidades de referencia do catalogo (colecoes,
-- produtoras, redes, keywords, titulos alternativos), snapshots de descoberta e
-- guest stars de episodio.
--
-- Forward-only e ADITIVA: apenas CREATE de tabelas novas + 1 ALTER ADD COLUMN
-- com default (nao reescreve linha existente no PG11+). Nenhuma linha apagada.
--
-- Governanca: worker-only na escrita. Relacoes centrais viram TABELAS (nunca JSON
-- solto). As refs polimorficas (entity_keywords, entity_alternative_titles) ganham
-- FK composta para `entities` num DO-block CONDICIONAL: em producao/deploy do zero
-- a `entities` ja existe (migration de hardening) e a FK e criada; no cenario
-- SINTETICO de `db:validate:upgrade` (que remove o hardening para simular o estado
-- anterior) a FK e pulada em vez de quebrar o deploy. Ver ADR 0012.

-- Guest star de episodio (TMDB separa guest_stars de credits.cast).
ALTER TABLE "cast_members" ADD COLUMN IF NOT EXISTS "is_guest" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: colecoes (franquias TMDB)
CREATE TABLE "collections" (
    "id" BIGSERIAL NOT NULL,
    "tmdb_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "overview" TEXT,
    "poster_path" TEXT,
    "backdrop_path" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_synced_at" TIMESTAMP(3),

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "movie_collection_memberships" (
    "id" BIGSERIAL NOT NULL,
    "collection_id" BIGINT NOT NULL,
    "movie_id" BIGINT NOT NULL,
    "position" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movie_collection_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable: produtoras
CREATE TABLE "production_companies" (
    "id" BIGSERIAL NOT NULL,
    "tmdb_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "logo_path" TEXT,
    "origin_country" TEXT,
    "headquarters" TEXT,
    "homepage" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_synced_at" TIMESTAMP(3),

    CONSTRAINT "production_companies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "movie_production_companies" (
    "movie_id" BIGINT NOT NULL,
    "company_id" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movie_production_companies_pkey" PRIMARY KEY ("movie_id","company_id")
);

CREATE TABLE "tv_production_companies" (
    "tv_show_id" BIGINT NOT NULL,
    "company_id" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tv_production_companies_pkey" PRIMARY KEY ("tv_show_id","company_id")
);

-- CreateTable: redes (TV networks)
CREATE TABLE "networks" (
    "id" BIGSERIAL NOT NULL,
    "tmdb_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "logo_path" TEXT,
    "origin_country" TEXT,
    "headquarters" TEXT,
    "homepage" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_synced_at" TIMESTAMP(3),

    CONSTRAINT "networks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tv_networks" (
    "tv_show_id" BIGINT NOT NULL,
    "network_id" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tv_networks_pkey" PRIMARY KEY ("tv_show_id","network_id")
);

-- CreateTable: keywords
CREATE TABLE "keywords" (
    "id" BIGSERIAL NOT NULL,
    "tmdb_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "keywords_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "entity_keywords" (
    "id" BIGSERIAL NOT NULL,
    "keyword_id" BIGINT NOT NULL,
    "entity_type" "EntityType" NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_keywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable: titulos alternativos por pais
CREATE TABLE "entity_alternative_titles" (
    "id" BIGSERIAL NOT NULL,
    "entity_type" "EntityType" NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "country_code" TEXT,
    "title" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "type" TEXT,
    "source" TEXT NOT NULL DEFAULT 'tmdb',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entity_alternative_titles_pkey" PRIMARY KEY ("id")
);

-- CreateTable: snapshots de descoberta (o render le o ultimo VALIDO; nunca TMDB)
CREATE TABLE "discovery_snapshots" (
    "id" BIGSERIAL NOT NULL,
    "list_type" TEXT NOT NULL,
    "entity_type" "EntityType" NOT NULL,
    "locale" TEXT NOT NULL,
    "country" TEXT,
    "window" TEXT,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'tmdb',
    "payload_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discovery_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "discovery_snapshot_items" (
    "id" BIGSERIAL NOT NULL,
    "snapshot_id" BIGINT NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "position" INTEGER NOT NULL,
    "provider_score" DECIMAL(65,30),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discovery_snapshot_items_pkey" PRIMARY KEY ("id")
);

-- Indexes / uniques
CREATE UNIQUE INDEX "collections_tmdb_id_key" ON "collections"("tmdb_id");
CREATE UNIQUE INDEX "movie_collection_memberships_collection_id_movie_id_key" ON "movie_collection_memberships"("collection_id", "movie_id");
CREATE INDEX "movie_collection_memberships_movie_id_idx" ON "movie_collection_memberships"("movie_id");
CREATE UNIQUE INDEX "production_companies_tmdb_id_key" ON "production_companies"("tmdb_id");
CREATE INDEX "movie_production_companies_company_id_idx" ON "movie_production_companies"("company_id");
CREATE INDEX "tv_production_companies_company_id_idx" ON "tv_production_companies"("company_id");
CREATE UNIQUE INDEX "networks_tmdb_id_key" ON "networks"("tmdb_id");
CREATE INDEX "tv_networks_network_id_idx" ON "tv_networks"("network_id");
CREATE UNIQUE INDEX "keywords_tmdb_id_key" ON "keywords"("tmdb_id");
CREATE UNIQUE INDEX "entity_keywords_keyword_id_entity_type_entity_id_key" ON "entity_keywords"("keyword_id", "entity_type", "entity_id");
CREATE INDEX "entity_keywords_entity_type_entity_id_idx" ON "entity_keywords"("entity_type", "entity_id");
CREATE UNIQUE INDEX "entity_alternative_titles_entity_type_entity_id_title_countr_key" ON "entity_alternative_titles"("entity_type", "entity_id", "title", "country_code");
CREATE INDEX "entity_alternative_titles_entity_type_entity_id_idx" ON "entity_alternative_titles"("entity_type", "entity_id");
CREATE INDEX "entity_alternative_titles_normalized_idx" ON "entity_alternative_titles"("normalized");
CREATE INDEX "discovery_snapshots_list_type_entity_type_locale_captured_at_idx" ON "discovery_snapshots"("list_type", "entity_type", "locale", "captured_at");
CREATE INDEX "discovery_snapshots_expires_at_idx" ON "discovery_snapshots"("expires_at");
CREATE UNIQUE INDEX "discovery_snapshot_items_snapshot_id_entity_id_key" ON "discovery_snapshot_items"("snapshot_id", "entity_id");
CREATE UNIQUE INDEX "discovery_snapshot_items_snapshot_id_position_key" ON "discovery_snapshot_items"("snapshot_id", "position");
CREATE INDEX "discovery_snapshot_items_entity_id_idx" ON "discovery_snapshot_items"("entity_id");

-- Foreign keys (tabelas-alvo existem desde a init)
ALTER TABLE "movie_collection_memberships" ADD CONSTRAINT "movie_collection_memberships_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "movie_collection_memberships" ADD CONSTRAINT "movie_collection_memberships_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "movie_production_companies" ADD CONSTRAINT "movie_production_companies_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "movie_production_companies" ADD CONSTRAINT "movie_production_companies_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "production_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tv_production_companies" ADD CONSTRAINT "tv_production_companies_tv_show_id_fkey" FOREIGN KEY ("tv_show_id") REFERENCES "tv_shows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tv_production_companies" ADD CONSTRAINT "tv_production_companies_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "production_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tv_networks" ADD CONSTRAINT "tv_networks_tv_show_id_fkey" FOREIGN KEY ("tv_show_id") REFERENCES "tv_shows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tv_networks" ADD CONSTRAINT "tv_networks_network_id_fkey" FOREIGN KEY ("network_id") REFERENCES "networks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entity_keywords" ADD CONSTRAINT "entity_keywords_keyword_id_fkey" FOREIGN KEY ("keyword_id") REFERENCES "keywords"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "discovery_snapshot_items" ADD CONSTRAINT "discovery_snapshot_items_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "discovery_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- FK composta polimorfica -> entities, CONDICIONAL (ver cabecalho): mantem a
-- integridade da invariante D1 em producao sem quebrar o cenario sintetico de
-- upgrade (onde `entities` ainda nao existe).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'entities'
  ) THEN
    ALTER TABLE "entity_keywords"
      ADD CONSTRAINT "entity_keywords_entity_fkey"
      FOREIGN KEY ("entity_type", "entity_id")
      REFERENCES "entities"("entity_type", "entity_id")
      ON DELETE RESTRICT ON UPDATE CASCADE;

    ALTER TABLE "entity_alternative_titles"
      ADD CONSTRAINT "entity_alternative_titles_entity_fkey"
      FOREIGN KEY ("entity_type", "entity_id")
      REFERENCES "entities"("entity_type", "entity_id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
