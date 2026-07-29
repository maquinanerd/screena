-- Midia editorial governada: do CMS para o armazenamento publico.
--
-- ADITIVA. Nada existente muda de tipo, ganha NOT NULL ou some. Em particular
-- `articles.hero_image_path` continua exatamente como esta, e continua sendo o
-- campo que o render le -- a coluna nova ao lado guarda a PROVENIENCIA (credito,
-- licenca, dimensoes, hash) que um caminho de string sozinho perderia.
--
-- 100% ASCII de proposito: acento gravado em WIN1252 ja quebrou deploy aqui.

CREATE TYPE "EditorialMediaLicenseStatus" AS ENUM (
  'unknown',
  'pending',
  'approved',
  'restricted',
  'expired',
  'prohibited'
);

CREATE TABLE "editorial_media_assets" (
  "id" BIGSERIAL NOT NULL,
  "payload_media_id" TEXT NOT NULL,
  "content_hash" TEXT NOT NULL,
  "storage_key" TEXT NOT NULL,
  "public_path" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "byte_size" INTEGER NOT NULL,
  "alt" TEXT NOT NULL,
  "caption" TEXT,
  "credit" TEXT,
  "source_name" TEXT,
  "source_url" TEXT,
  "rights_holder" TEXT,
  "license_status" "EditorialMediaLicenseStatus" NOT NULL DEFAULT 'unknown',
  "license_reference" TEXT,
  "license_expires_at" TIMESTAMP(3),
  "requires_attribution" BOOLEAN NOT NULL DEFAULT true,
  "allowed_for_editorial" BOOLEAN NOT NULL DEFAULT false,
  "allowed_for_hero" BOOLEAN NOT NULL DEFAULT false,
  "allowed_for_social" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "editorial_media_assets_pkey" PRIMARY KEY ("id")
);

-- Um documento do CMS tem UM asset publico corrente: trocar o arquivo la
-- atualiza esta linha em vez de criar uma segunda.
CREATE UNIQUE INDEX "editorial_media_assets_payload_media_id_key"
  ON "editorial_media_assets"("payload_media_id");

-- Chave e caminho publico sao derivados do CONTEUDO. Duas linhas nunca podem
-- reivindicar o mesmo arquivo no storage, senao apagar uma corromperia a outra.
CREATE UNIQUE INDEX "editorial_media_assets_storage_key_key"
  ON "editorial_media_assets"("storage_key");
CREATE UNIQUE INDEX "editorial_media_assets_public_path_key"
  ON "editorial_media_assets"("public_path");

-- NAO e unique: a mesma foto pode chegar por dois documentos diferentes do CMS
-- e compartilhar bytes. E indexado porque a deduplicacao consulta por aqui.
CREATE INDEX "editorial_media_assets_content_hash_idx"
  ON "editorial_media_assets"("content_hash");
CREATE INDEX "editorial_media_assets_license_status_idx"
  ON "editorial_media_assets"("license_status");

-- O hash tem formato fixo (`sha256:` + 64 hex). Um valor fora disso significa
-- que alguem gravou o nome do upload ou uma URL nesta coluna.
ALTER TABLE "editorial_media_assets"
  ADD CONSTRAINT "editorial_media_assets_content_hash_shape"
  CHECK ("content_hash" ~ '^sha256:[0-9a-f]{64}$');

-- A REGRA CENTRAL DESTA FASE, gravada no banco: caminho publico e caminho de
-- site, nunca URL. `normalizeNewsLocalImagePath` no apps/web recusa http(s) por
-- design; uma URL aqui viraria materia sem imagem em silencio.
ALTER TABLE "editorial_media_assets"
  ADD CONSTRAINT "editorial_media_assets_public_path_is_local"
  CHECK ("public_path" LIKE '/%' AND "public_path" !~* '^https?://');

-- A chave do storage nunca sobe de diretorio nem vira caminho absoluto.
--
-- Expresso com regex, nao com LIKE. Em LIKE a barra invertida e o escape do
-- proprio padrao: '%\%' significa "termina com um sinal de porcentagem", e nao
-- "contem barra invertida": a checagem pareceria certa e nao barraria nada.
ALTER TABLE "editorial_media_assets"
  ADD CONSTRAINT "editorial_media_assets_storage_key_safe"
  CHECK ("storage_key" ~ '^[a-z0-9][a-z0-9/._-]*$' AND "storage_key" !~ '\.\.');

ALTER TABLE "editorial_media_assets"
  ADD CONSTRAINT "editorial_media_assets_byte_size_positive"
  CHECK ("byte_size" > 0);

ALTER TABLE "editorial_media_assets"
  ADD CONSTRAINT "editorial_media_assets_dimensions_positive"
  CHECK (
    ("width" IS NULL OR "width" > 0) AND ("height" IS NULL OR "height" > 0)
  );

-- Vinculo do artigo com o asset de capa.
ALTER TABLE "articles" ADD COLUMN "hero_media_asset_id" BIGINT;

CREATE INDEX "articles_hero_media_asset_id_idx" ON "articles"("hero_media_asset_id");

-- ON DELETE SET NULL: remover um asset compartilhado nao pode apagar artigos.
-- A materia perde a capa, nao a existencia.
ALTER TABLE "articles"
  ADD CONSTRAINT "articles_hero_media_asset_id_fkey"
  FOREIGN KEY ("hero_media_asset_id") REFERENCES "editorial_media_assets"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
