-- Prompt 10 - Plataforma editorial: fontes, itens recebidos, proveniencia,
-- deduplicacao, correcao e projecao publica de artigo.
--
-- ADITIVA. Nao remodela `articles`/`article_translations`/`entity_news_links`
-- (que ja existiam); acrescenta a CADEIA DE ENTRADA que faltava e habilita
-- artigo nas tabelas publicas que ja existem (`search_documents`,
-- `page_indexability_decisions`) em vez de criar tabelas paralelas.
--
-- ATENCAO: este arquivo e 100% ASCII de proposito. Um byte WIN1252 aqui quebra
-- `prisma migrate deploy` no container de producao.
--
-- Blocos:
--   1) Enums novos
--   2) editorial_sources
--   3) source_items
--   4) article_source_links
--   5) article_translations: correcao material
--   6) search_documents: artigo na MESMA projecao de busca
--   7) page_indexability_decisions: artigo na MESMA tabela de decisao

-- ============================================================
-- 1) Enums
-- ============================================================

CREATE TYPE "EditorialSourceKind" AS ENUM (
  'rss_feed', 'api_feed', 'press_release', 'official_site', 'wire', 'partner', 'manual'
);

CREATE TYPE "EditorialSourceStatus" AS ENUM ('active', 'paused', 'retired');

CREATE TYPE "EditorialSourceUseRights" AS ENUM (
  'unknown', 'headline_and_link_only', 'excerpt_with_attribution', 'full_syndication'
);

CREATE TYPE "SourceItemStatus" AS ENUM (
  'received', 'deduplicated', 'linked', 'discarded', 'failed'
);

CREATE TYPE "SourceItemDedupVerdict" AS ENUM (
  'unique', 'duplicate', 'related', 'superseded'
);

CREATE TYPE "ArticleSourceRole" AS ENUM (
  'primary', 'secondary', 'press_release', 'catalog'
);

CREATE TYPE "PublicDocKind" AS ENUM ('entity', 'article');

-- ============================================================
-- 2) editorial_sources - fonte editorial registrada
--
-- Registrar uma fonte NAO autoriza reproduzir o conteudo dela. O direito
-- mora em `use_rights` (decisao humana) e continua subordinado a
-- `source_licenses` (invariante 6). Defaults sao os mais restritivos:
-- status='paused' (nao ingere sozinha) e use_rights='unknown'.
-- ============================================================

CREATE TABLE "editorial_sources" (
    "id" BIGSERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "homepage_url" TEXT,
    "kind" "EditorialSourceKind" NOT NULL DEFAULT 'rss_feed',
    "status" "EditorialSourceStatus" NOT NULL DEFAULT 'paused',
    "use_rights" "EditorialSourceUseRights" NOT NULL DEFAULT 'unknown',
    "requires_attribution" BOOLEAN NOT NULL DEFAULT true,
    "requires_linkback" BOOLEAN NOT NULL DEFAULT true,
    "attribution_text" TEXT,
    "ingest_policy" JSONB NOT NULL DEFAULT '{}',
    "last_ingested_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "editorial_sources_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "editorial_sources_slug_key" ON "editorial_sources"("slug");
CREATE UNIQUE INDEX "editorial_sources_domain_key" ON "editorial_sources"("domain");
CREATE INDEX "editorial_sources_status_idx" ON "editorial_sources"("status");
CREATE INDEX "editorial_sources_kind_idx" ON "editorial_sources"("kind");

-- Identidade nao vazia e normalizada: o dominio e a chave de deduplicacao por
-- host, entao precisa estar minusculo, sem esquema, sem barra e sem "www.".
ALTER TABLE "editorial_sources"
  ADD CONSTRAINT "editorial_sources_slug_not_empty" CHECK (btrim("slug") <> ''),
  ADD CONSTRAINT "editorial_sources_name_not_empty" CHECK (btrim("name") <> ''),
  ADD CONSTRAINT "editorial_sources_domain_normalized" CHECK (
    "domain" = lower("domain")
    AND btrim("domain") = "domain"
    AND "domain" <> ''
    AND "domain" NOT LIKE 'http%'
    AND "domain" NOT LIKE 'www.%'
    AND "domain" NOT LIKE '%/%'
  );

-- ============================================================
-- 3) source_items - item recebido (auditoria + identidade)
--
-- NAO e artigo e nunca vira pagina publica por si so.
--
-- Retencao minima de conteudo de terceiro: guardamos identidade, URL,
-- metadados e FINGERPRINTS. O corpo integral NAO e persistido - o CHECK de
-- tamanho do excerpt trava isso no proprio banco, para que nenhum ingestor
-- futuro consiga transformar esta tabela num espelho de conteudo alheio.
-- ============================================================

CREATE TABLE "source_items" (
    "id" BIGSERIAL NOT NULL,
    "source_id" BIGINT NOT NULL,
    "external_id" TEXT NOT NULL,
    "canonical_url" TEXT,
    "normalized_url" TEXT,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "language" TEXT,
    "excerpt" TEXT,
    "content_fingerprint" TEXT,
    "payload_fingerprint" TEXT,
    "published_at" TIMESTAMP(3),
    "source_updated_at" TIMESTAMP(3),
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "SourceItemStatus" NOT NULL DEFAULT 'received',
    "dedup_verdict" "SourceItemDedupVerdict" NOT NULL DEFAULT 'unique',
    "duplicate_of_id" BIGINT,
    "discard_reason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_items_pkey" PRIMARY KEY ("id")
);

-- Idempotencia primaria de ingestao: reingerir o mesmo (fonte, id externo)
-- atualiza a linha, nunca cria uma segunda.
CREATE UNIQUE INDEX "source_items_source_id_external_id_key"
  ON "source_items"("source_id", "external_id");

-- Segundo eixo de dedup: a mesma URL normalizada nao entra duas vezes na MESMA
-- fonte. Parcial porque `normalized_url` e opcional e NULL nunca colide.
-- Deliberadamente NAO e global: duas fontes distintas cobrindo a mesma URL sao
-- proveniencia legitima, nao erro de ingestao.
CREATE UNIQUE INDEX "source_items_source_normalized_url_unique"
  ON "source_items"("source_id", "normalized_url")
  WHERE "normalized_url" IS NOT NULL;

CREATE INDEX "source_items_normalized_url_idx" ON "source_items"("normalized_url");
CREATE INDEX "source_items_content_fingerprint_idx" ON "source_items"("content_fingerprint");
CREATE INDEX "source_items_status_idx" ON "source_items"("status");
CREATE INDEX "source_items_source_id_published_at_idx" ON "source_items"("source_id", "published_at");

ALTER TABLE "source_items" ADD CONSTRAINT "source_items_source_id_fkey"
  FOREIGN KEY ("source_id") REFERENCES "editorial_sources"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "source_items" ADD CONSTRAINT "source_items_duplicate_of_id_fkey"
  FOREIGN KEY ("duplicate_of_id") REFERENCES "source_items"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "source_items"
  ADD CONSTRAINT "source_items_external_id_not_empty" CHECK (btrim("external_id") <> ''),
  ADD CONSTRAINT "source_items_title_not_empty" CHECK (btrim("title") <> ''),
  -- Retencao minima: excerpt e TRECHO, nao corpo. 1000 chars e o teto duro.
  ADD CONSTRAINT "source_items_excerpt_is_excerpt" CHECK (
    "excerpt" IS NULL OR char_length("excerpt") <= 1000
  ),
  -- Fingerprints sao sha-256 hex minusculo de 64 chars, ou NULL.
  ADD CONSTRAINT "source_items_content_fingerprint_sha256" CHECK (
    "content_fingerprint" IS NULL OR "content_fingerprint" ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT "source_items_payload_fingerprint_sha256" CHECK (
    "payload_fingerprint" IS NULL OR "payload_fingerprint" ~ '^[0-9a-f]{64}$'
  ),
  -- URL normalizada e minuscula no host e nunca traz fragmento.
  ADD CONSTRAINT "source_items_normalized_url_shape" CHECK (
    "normalized_url" IS NULL OR ("normalized_url" NOT LIKE '%#%' AND btrim("normalized_url") = "normalized_url")
  ),
  -- Um item nunca e duplicata de si mesmo.
  ADD CONSTRAINT "source_items_not_self_duplicate" CHECK (
    "duplicate_of_id" IS NULL OR "duplicate_of_id" <> "id"
  ),
  -- Fail-closed: os vereditos que ADMITEM fusao exigem o item primario
  -- apontado. `related` e sinal fraco e NUNCA aponta duplicata.
  ADD CONSTRAINT "source_items_dedup_verdict_shape" CHECK (
    ("dedup_verdict" IN ('duplicate', 'superseded') AND "duplicate_of_id" IS NOT NULL)
    OR ("dedup_verdict" IN ('unique', 'related') AND "duplicate_of_id" IS NULL)
  );

-- ============================================================
-- 4) article_source_links - proveniencia (artigo <- N fontes)
--
-- A evidencia sobrevive a inativacao da fonte: a FK para editorial_sources e
-- RESTRICT, entao apagar uma fonte que sustenta artigo publicado e impossivel.
-- "Parar de ingerir" (status='retired') e uma operacao DIFERENTE de "apagar
-- evidencia" - e so a primeira e permitida.
-- ============================================================

CREATE TABLE "article_source_links" (
    "id" BIGSERIAL NOT NULL,
    "article_id" BIGINT NOT NULL,
    "source_id" BIGINT NOT NULL,
    "source_item_id" BIGINT,
    "role" "ArticleSourceRole" NOT NULL DEFAULT 'secondary',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "article_source_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "article_source_links_article_source_item_key"
  ON "article_source_links"("article_id", "source_id", "source_item_id");

-- NULL nunca colide em unique composto do PostgreSQL: sem este unique parcial,
-- o mesmo (artigo, fonte) sem item poderia ser gravado infinitas vezes.
CREATE UNIQUE INDEX "article_source_links_article_source_no_item_unique"
  ON "article_source_links"("article_id", "source_id")
  WHERE "source_item_id" IS NULL;

-- No maximo UMA fonte primaria por artigo.
CREATE UNIQUE INDEX "article_source_links_single_primary_unique"
  ON "article_source_links"("article_id")
  WHERE "role" = 'primary';

CREATE INDEX "article_source_links_article_id_idx" ON "article_source_links"("article_id");
CREATE INDEX "article_source_links_source_id_idx" ON "article_source_links"("source_id");

ALTER TABLE "article_source_links" ADD CONSTRAINT "article_source_links_article_id_fkey"
  FOREIGN KEY ("article_id") REFERENCES "articles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "article_source_links" ADD CONSTRAINT "article_source_links_source_id_fkey"
  FOREIGN KEY ("source_id") REFERENCES "editorial_sources"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "article_source_links" ADD CONSTRAINT "article_source_links_source_item_id_fkey"
  FOREIGN KEY ("source_item_id") REFERENCES "source_items"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- 5) article_translations - correcao material
--
-- Atualizacao editorial normal != correcao material. A correcao registra
-- QUANDO e O QUE mudou e nunca apaga a evidencia. Os dois campos andam juntos.
-- ============================================================

ALTER TABLE "article_translations"
  ADD COLUMN "corrected_at" TIMESTAMP(3),
  ADD COLUMN "correction_note" TEXT;

ALTER TABLE "article_translations"
  ADD CONSTRAINT "article_translations_correction_pair" CHECK (
    ("corrected_at" IS NULL AND "correction_note" IS NULL)
    OR ("corrected_at" IS NOT NULL AND "correction_note" IS NOT NULL AND btrim("correction_note") <> '')
  );

-- ============================================================
-- 6) search_documents - artigo na MESMA projecao de busca
--
-- Proibido criar um segundo search engine. Como `EntityType` nao pode ganhar
-- `article` (artigos nao vivem em `entities`/`slugs`), o discriminador
-- `doc_kind` + `article_id` convive com (entity_type, entity_id).
--
-- Relaxar entity_type/entity_id para anulavel e SEGURO para o unique que ja
-- existe: NULL nunca colide em unique no PostgreSQL, entao ele segue travando
-- entidades e ignora artigos. O que falta e um unique so para artigos.
-- ============================================================

ALTER TABLE "search_documents"
  ADD COLUMN "doc_kind" "PublicDocKind" NOT NULL DEFAULT 'entity',
  ADD COLUMN "article_id" BIGINT,
  ALTER COLUMN "entity_type" DROP NOT NULL,
  ALTER COLUMN "entity_id" DROP NOT NULL;

-- O unique de ENTIDADE (`search_documents_entity_type_entity_id_locale_key`) e
-- MANTIDO como esta. Com as colunas agora anulaveis ele continua travando
-- entidades e simplesmente ignora as linhas de artigo, que tem
-- (NULL, NULL, locale) - e NULL nunca colide em unique no PostgreSQL.
-- Justamente por ignora-las, ele nao serve para travar artigo: dai o unique
-- PARCIAL abaixo. Sem ele o mesmo artigo ganharia N documentos por locale.
CREATE UNIQUE INDEX "search_documents_article_unique"
  ON "search_documents"("article_id", "locale")
  WHERE "doc_kind" = 'article';

CREATE INDEX "search_documents_article_id_idx" ON "search_documents"("article_id");

ALTER TABLE "search_documents" ADD CONSTRAINT "search_documents_article_id_fkey"
  FOREIGN KEY ("article_id") REFERENCES "articles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Forma exclusiva por kind: um documento e OU de entidade OU de artigo, nunca
-- os dois nem nenhum dos dois.
ALTER TABLE "search_documents"
  ADD CONSTRAINT "search_documents_kind_shape" CHECK (
    ("doc_kind" = 'entity'
      AND "entity_type" IS NOT NULL AND "entity_id" IS NOT NULL AND "article_id" IS NULL)
    OR ("doc_kind" = 'article'
      AND "article_id" IS NOT NULL AND "entity_type" IS NULL AND "entity_id" IS NULL)
  );

-- ============================================================
-- 7) page_indexability_decisions - artigo na MESMA tabela de decisao
--
-- Mesmo padrao do bloco 6: o unique de entidade permanece, e o artigo ganha
-- o seu proprio unique parcial de decisao vigente.
-- ============================================================

ALTER TABLE "page_indexability_decisions"
  ADD COLUMN "doc_kind" "PublicDocKind" NOT NULL DEFAULT 'entity',
  ADD COLUMN "article_id" BIGINT,
  ALTER COLUMN "entity_type" DROP NOT NULL,
  ALTER COLUMN "entity_id" DROP NOT NULL;

-- Mesma logica do bloco 6: o unique parcial de decisao VIGENTE de entidade
-- (`page_indexability_decisions_current_unique`, de
-- 20260715120000_data_governance_hardening) e MANTIDO - ele ignora as linhas
-- de artigo (entity_type NULL) e por isso precisa do par abaixo para elas.
CREATE UNIQUE INDEX "page_indexability_decisions_article_current_unique"
  ON "page_indexability_decisions" ("article_id", "language_code")
  WHERE "is_current" AND "doc_kind" = 'article';

CREATE INDEX "page_indexability_decisions_article_id_language_code_idx"
  ON "page_indexability_decisions"("article_id", "language_code");

ALTER TABLE "page_indexability_decisions" ADD CONSTRAINT "page_indexability_decisions_article_id_fkey"
  FOREIGN KEY ("article_id") REFERENCES "articles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "page_indexability_decisions"
  ADD CONSTRAINT "page_indexability_decisions_kind_shape" CHECK (
    ("doc_kind" = 'entity'
      AND "entity_type" IS NOT NULL AND "entity_id" IS NOT NULL AND "article_id" IS NULL)
    OR ("doc_kind" = 'article'
      AND "article_id" IS NOT NULL AND "entity_type" IS NULL AND "entity_id" IS NULL)
  );
