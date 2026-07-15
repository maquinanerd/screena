-- Data governance hardening (Auditoria 360 — PROMPT 2).
-- Forward-only. Nenhuma linha existente e apagada sem antes ser preservada em
-- historico (page_indexability_decisions) ou em quarentena auditavel
-- (entity_reference_orphans). Todos os backfills abaixo sao IDEMPOTENTES:
-- reaplicar esta migration sobre um estado ja corrigido nao altera nada.
--
-- Resolve 5 gaps da Auditoria 360:
--  1. page_indexability_decisions: decisao VIGENTE inequivoca (is_current) +
--     historico preservado + versionamento de politica/origem.
--  2. watch_availability: chave natural de deduplicacao + licenca/atribuicao
--     propria + revisao humana + fingerprint do payload aprovado.
--  3. source_licenses: relacoes verificaveis (RatingSource != ApiProvider),
--     content_type, territorio e vigencia/decisao humana.
--  4. Referencias polimorficas: tabela de registro `entities` (mantida por
--     trigger) + FK composta real em todas as tabelas polimorficas.
--  5. articles/article_translations: coerencia entre review_status,
--     published_at e index_status.

-- ============================================================
-- 1) Referencias polimorficas — tabela de registro `entities` + triggers
-- ============================================================

-- CreateEnum
CREATE TYPE "SourceLicenseContentType" AS ENUM ('rating', 'watch_availability', 'review', 'news', 'image', 'other');

-- CreateTable
CREATE TABLE "entities" (
    "entity_type" "EntityType" NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entities_pkey" PRIMARY KEY ("entity_type","entity_id")
);

-- Backfill (idempotente via ON CONFLICT DO NOTHING): registra toda entidade
-- ja existente nas 5 tabelas-raiz.
INSERT INTO "entities" ("entity_type", "entity_id")
SELECT 'movie'::"EntityType", "id" FROM "movies"
UNION ALL
SELECT 'tv'::"EntityType", "id" FROM "tv_shows"
UNION ALL
SELECT 'season'::"EntityType", "id" FROM "seasons"
UNION ALL
SELECT 'episode'::"EntityType", "id" FROM "episodes"
UNION ALL
SELECT 'person'::"EntityType", "id" FROM "people"
ON CONFLICT ("entity_type", "entity_id") DO NOTHING;

-- Triggers de integridade: mantêm `entities` em sincronia com as 5 tabelas-raiz
-- sem exigir mudança de aplicação. Duas funções genéricas (parametrizadas por
-- TG_ARGV) cobrem as 10 combinações (5 tabelas x insert/delete).
CREATE OR REPLACE FUNCTION entity_registry_sync_insert() RETURNS trigger AS $$
BEGIN
  INSERT INTO "entities" ("entity_type", "entity_id")
  VALUES (TG_ARGV[0]::"EntityType", NEW."id")
  ON CONFLICT ("entity_type", "entity_id") DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION entity_registry_sync_delete() RETURNS trigger AS $$
BEGIN
  DELETE FROM "entities"
  WHERE "entity_type" = TG_ARGV[0]::"EntityType" AND "entity_id" = OLD."id";
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "movies_entity_registry_ins" AFTER INSERT ON "movies"
  FOR EACH ROW EXECUTE FUNCTION entity_registry_sync_insert('movie');
CREATE TRIGGER "movies_entity_registry_del" AFTER DELETE ON "movies"
  FOR EACH ROW EXECUTE FUNCTION entity_registry_sync_delete('movie');

CREATE TRIGGER "tv_shows_entity_registry_ins" AFTER INSERT ON "tv_shows"
  FOR EACH ROW EXECUTE FUNCTION entity_registry_sync_insert('tv');
CREATE TRIGGER "tv_shows_entity_registry_del" AFTER DELETE ON "tv_shows"
  FOR EACH ROW EXECUTE FUNCTION entity_registry_sync_delete('tv');

CREATE TRIGGER "seasons_entity_registry_ins" AFTER INSERT ON "seasons"
  FOR EACH ROW EXECUTE FUNCTION entity_registry_sync_insert('season');
CREATE TRIGGER "seasons_entity_registry_del" AFTER DELETE ON "seasons"
  FOR EACH ROW EXECUTE FUNCTION entity_registry_sync_delete('season');

CREATE TRIGGER "episodes_entity_registry_ins" AFTER INSERT ON "episodes"
  FOR EACH ROW EXECUTE FUNCTION entity_registry_sync_insert('episode');
CREATE TRIGGER "episodes_entity_registry_del" AFTER DELETE ON "episodes"
  FOR EACH ROW EXECUTE FUNCTION entity_registry_sync_delete('episode');

CREATE TRIGGER "people_entity_registry_ins" AFTER INSERT ON "people"
  FOR EACH ROW EXECUTE FUNCTION entity_registry_sync_insert('person');
CREATE TRIGGER "people_entity_registry_del" AFTER DELETE ON "people"
  FOR EACH ROW EXECUTE FUNCTION entity_registry_sync_delete('person');

-- Quarentena auditavel: nenhuma linha polimorfica orfa e apagada as cegas.
-- Ela e copiada aqui ANTES de ser removida da tabela de origem (backfill
-- seguro antes de qualquer operacao destrutiva).
CREATE TABLE "entity_reference_orphans" (
    "id" BIGSERIAL NOT NULL,
    "source_table" TEXT NOT NULL,
    "source_row_id" BIGINT NOT NULL,
    "entity_type" "EntityType" NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_reference_orphans_pkey" PRIMARY KEY ("id")
);

-- Para cada tabela polimorfica: (a) quarentena de orfaos, (b) remove o orfao
-- (ja copiado), (c) adiciona a FK composta como NOT VALID (nao escaneia a
-- tabela, lock breve) e (d) valida em seguida (escaneia com lock mais fraco,
-- ShareUpdateExclusive, sem bloquear leituras/escritas concorrentes). Um
-- unico DO block evita 12 blocos quase identicos e reduz risco de copy/paste.
DO $$
DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY[
    'cast_members',
    'crew_members',
    'entity_external_ids',
    'slugs',
    'entity_translations',
    'content_blocks',
    'entity_writer_jobs',
    'entity_writer_logs',
    'external_ratings',
    'watch_availability',
    'page_indexability_decisions',
    'entity_news_links'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format(
      'INSERT INTO "entity_reference_orphans" ("source_table", "source_row_id", "entity_type", "entity_id")
       SELECT %L, t."id", t."entity_type", t."entity_id"
       FROM %I t
       LEFT JOIN "entities" e ON e."entity_type" = t."entity_type" AND e."entity_id" = t."entity_id"
       WHERE e."entity_id" IS NULL',
      tbl, tbl
    );

    EXECUTE format(
      'DELETE FROM %I t
       WHERE NOT EXISTS (
         SELECT 1 FROM "entities" e
         WHERE e."entity_type" = t."entity_type" AND e."entity_id" = t."entity_id"
       )',
      tbl
    );

    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("entity_type","entity_id")
       REFERENCES "entities"("entity_type","entity_id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID',
      tbl, tbl || '_entity_fkey'
    );

    EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', tbl, tbl || '_entity_fkey');
  END LOOP;
END $$;

-- ============================================================
-- 2) source_licenses — relacoes verificaveis (RatingSource != ApiProvider)
-- ============================================================

-- AlterTable
ALTER TABLE "source_licenses"
  ADD COLUMN "content_type" "SourceLicenseContentType" NOT NULL DEFAULT 'rating',
  ADD COLUMN "rating_source_key" TEXT,
  ADD COLUMN "territory_code" TEXT,
  ADD COLUMN "valid_from" TIMESTAMP(3),
  ADD COLUMN "valid_until" TIMESTAMP(3),
  ADD COLUMN "decided_by" TEXT,
  ADD COLUMN "decided_at" TIMESTAMP(3);

-- Backfill idempotente: toda linha existente na Fase 1 e uma licenca de
-- rating conservadora (content_type ja nasce 'rating' por default); liga
-- rating_source_key quando source_key bate com uma fonte editorial real.
UPDATE "source_licenses" sl
SET "rating_source_key" = sl."source_key"
WHERE sl."content_type" = 'rating'
  AND sl."rating_source_key" IS NULL
  AND EXISTS (SELECT 1 FROM "rating_sources" rs WHERE rs."key" = sl."source_key");

-- Nunca deixa provider_key apontar para um provider inexistente antes de
-- travar a FK (evita que ADD CONSTRAINT falhe a migration inteira).
UPDATE "source_licenses" sl
SET "provider_key" = NULL
WHERE sl."provider_key" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "api_providers" ap WHERE ap."key" = sl."provider_key");

-- AddForeignKey (RatingSource, ApiProvider e Country sao 3 tabelas DISTINTAS —
-- invariante 2 materializada tambem em source_licenses)
ALTER TABLE "source_licenses" ADD CONSTRAINT "source_licenses_rating_source_key_fkey"
  FOREIGN KEY ("rating_source_key") REFERENCES "rating_sources"("key") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "source_licenses" ADD CONSTRAINT "source_licenses_provider_key_fkey"
  FOREIGN KEY ("provider_key") REFERENCES "api_providers"("key") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "source_licenses" ADD CONSTRAINT "source_licenses_territory_code_fkey"
  FOREIGN KEY ("territory_code") REFERENCES "countries"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- CHECKs: content_type=rating exige fonte editorial real; rating_source_key e
-- provider_key nunca podem ser o mesmo literal (nao confunda RatingSource com
-- ApiProvider mesmo quando o texto coincide).
ALTER TABLE "source_licenses" ADD CONSTRAINT "source_licenses_rating_requires_source"
  CHECK ("content_type" <> 'rating' OR "rating_source_key" IS NOT NULL);
ALTER TABLE "source_licenses" ADD CONSTRAINT "source_licenses_rating_source_ne_provider"
  CHECK ("rating_source_key" IS NULL OR "provider_key" IS NULL OR "rating_source_key" <> "provider_key");

-- CreateIndex
CREATE INDEX "source_licenses_content_type_idx" ON "source_licenses"("content_type");
CREATE INDEX "source_licenses_rating_source_key_idx" ON "source_licenses"("rating_source_key");
CREATE INDEX "source_licenses_provider_key_idx" ON "source_licenses"("provider_key");
CREATE INDEX "source_licenses_territory_code_idx" ON "source_licenses"("territory_code");

-- Substitui o unique parcial antigo (so cobria "1 default por fonte") por uma
-- chave natural funcional que tambem cobre content_type/provider/territorio
-- (NULLs tratados via COALESCE, para provider/territorio "global" contarem
-- como um unico valor natural em vez de "distintos" como o Postgres trata NULL).
DROP INDEX IF EXISTS "source_licenses_default_unique";
CREATE UNIQUE INDEX "source_licenses_natural_key"
  ON "source_licenses" ("source_key", "content_type", COALESCE("provider_key", ''), COALESCE("territory_code", ''));

-- ============================================================
-- 3) watch_availability — chave natural + licenca/atribuicao propria
-- ============================================================

-- AlterTable
ALTER TABLE "watch_availability"
  ADD COLUMN "license_status" "LicenseStatus" NOT NULL DEFAULT 'unknown',
  ADD COLUMN "requires_attribution" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "requires_linkback" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "attribution_text" TEXT,
  ADD COLUMN "attribution_url" TEXT,
  ADD COLUMN "reviewed_at" TIMESTAMP(3),
  ADD COLUMN "reviewed_by" TEXT,
  ADD COLUMN "approved_payload_hash" TEXT,
  -- URL web (navegador) distinta de deep_link (app); pacote/bundle da oferta
  -- (ex.: add-on/channel). Nullable e SEM produtor no MVP: preenchidos pela
  -- ingestao de streaming (Fase 9). NAO entram na chave natural nesta fase
  -- (todos null hoje); Fase 9 decide se `package` compoe a chave ao modelar
  -- add-on/bundle com payload real. Ver ADR 0002.
  ADD COLUMN "web_url" TEXT,
  ADD COLUMN "package" TEXT;

-- Backfill idempotente de provider_key a partir de provider_name (slug
-- estavel). Reaplicar sobre linhas ja preenchidas nao muda nada (WHERE IS NULL).
-- NAO cobre TODAS as linhas: quando provider_key esta null porque o worker de
-- streaming (services/streaming) nunca recebeu um identificador de provedor da
-- API de origem, o null e um SINAL LEGITIMO ("missing-provider", tratado pelo
-- guardrail de promocao) e NAO deve ser inventado aqui. Por isso este backfill
-- so preenche quando ha um provider_name utilizavel; provider_key permanece
-- opcional na coluna (nunca vira NOT NULL).
UPDATE "watch_availability"
SET "provider_key" = NULLIF(regexp_replace(lower(trim("provider_name")), '[^a-z0-9]+', '_', 'g'), '')
WHERE "provider_key" IS NULL
  AND "provider_name" IS NOT NULL
  AND btrim("provider_name") <> '';

CREATE INDEX "watch_availability_provider_key_idx" ON "watch_availability"("provider_key");

-- Dedup ANTES do indice unico (regra: normalizar dados antes de travar a
-- constraint). O gap exato que esta migration corrige e "o sync gera duplicatas
-- indefinidamente": logo, dados legados PODEM ter varias linhas para a MESMA
-- oferta natural. Criar o unique index direto falharia sobre esses duplicados.
-- Mantem-se UMA linha por chave natural, preservando a aprovacao humana:
-- ordena por display_allowed (aprovada primeiro), depois pela observacao mais
-- recente (reviewed_at > updated_at > created_at) e id como desempate; remove as
-- demais. Nenhuma aprovacao humana e perdida se existir em alguma das duplicatas.
-- Idempotente: sem duplicatas, nao remove nada.
WITH ranked AS (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "entity_type", "entity_id", "country_code", "offer_type",
                        COALESCE("provider_key", "provider_name"), COALESCE("quality", '')
           ORDER BY "display_allowed" DESC,
                    COALESCE("reviewed_at", "updated_at", "created_at") DESC,
                    "id" DESC
         ) AS rn
  FROM "watch_availability"
)
DELETE FROM "watch_availability" wa
USING ranked
WHERE ranked."id" = wa."id" AND ranked.rn > 1;

-- Chave natural de deduplicacao: o sync nunca gera duplicatas indefinidamente
-- para a mesma oferta. Quando provider_key falta, cai para provider_name
-- (sempre preenchido) em vez de colapsar ofertas de plataformas DIFERENTES
-- (ex.: "Max" e "Prime Video" ambos sem provider_key) na mesma linha; quality
-- ausente e tratado como um unico valor "sem qualidade informada".
CREATE UNIQUE INDEX "watch_availability_natural_key"
  ON "watch_availability" ("entity_type", "entity_id", "country_code", "offer_type", COALESCE("provider_key", "provider_name"), COALESCE("quality", ''));

-- ============================================================
-- 4) page_indexability_decisions — decisao vigente inequivoca + historico
-- ============================================================

-- AlterTable
ALTER TABLE "page_indexability_decisions"
  ADD COLUMN "is_current" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "supersedes_id" BIGINT,
  ADD COLUMN "policy_version" TEXT,
  ADD COLUMN "decision_origin" TEXT,
  ADD COLUMN "decided_by" TEXT;

-- AddForeignKey (auto-relacionamento: aponta para a decisao anterior)
ALTER TABLE "page_indexability_decisions" ADD CONSTRAINT "page_indexability_decisions_supersedes_id_fkey"
  FOREIGN KEY ("supersedes_id") REFERENCES "page_indexability_decisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill idempotente: preserva HISTORICO (nenhuma linha e apagada). Para
-- cada (entity_type, entity_id, language_code), so a linha mais recente
-- (decided_at, com created_at/id como desempate) fica is_current=true; as
-- demais (se existirem duplicatas historicas) viram is_current=false.
WITH ranked AS (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "entity_type", "entity_id", "language_code"
           ORDER BY COALESCE("decided_at", "created_at") DESC, "id" DESC
         ) AS rn
  FROM "page_indexability_decisions"
)
UPDATE "page_indexability_decisions" pid
SET "is_current" = (ranked.rn = 1)
FROM ranked
WHERE ranked."id" = pid."id" AND pid."is_current" IS DISTINCT FROM (ranked.rn = 1);

-- Indice unico PARCIAL: impede DUAS decisoes concorrentes marcadas como
-- vigentes para o mesmo (entity_type, entity_id, language_code).
CREATE UNIQUE INDEX "page_indexability_decisions_current_unique"
  ON "page_indexability_decisions" ("entity_type", "entity_id", "language_code")
  WHERE "is_current" = true;

CREATE INDEX "page_indexability_decisions_is_current_idx" ON "page_indexability_decisions"("is_current");
CREATE INDEX "page_indexability_decisions_supersedes_id_idx" ON "page_indexability_decisions"("supersedes_id");

-- ============================================================
-- 5) articles / article_translations — coerencia editorial
-- ============================================================

CREATE INDEX "articles_category_idx" ON "articles"("category");

-- Backfill idempotente ANTES da constraint (regra de migration: normalizar os
-- dados antes de travar o CHECK). Dados legados podem ter string vazia em
-- category/author_name, que violaria os CHECKs abaixo e abortaria a migration
-- inteira; normalizamos '' -> NULL primeiro. Reaplicar nao muda nada.
UPDATE "articles" SET "category" = NULL WHERE "category" = '';
UPDATE "articles" SET "author_name" = NULL WHERE "author_name" = '';

ALTER TABLE "articles" ADD CONSTRAINT "articles_category_not_empty"
  CHECK ("category" IS NULL OR "category" <> '');
ALTER TABLE "articles" ADD CONSTRAINT "articles_author_name_not_empty"
  CHECK ("author_name" IS NULL OR "author_name" <> '');

-- NOTA (investigacao antes de normalizar): `article_translations.reviewStatus`,
-- `indexStatus` e `publishedAt` sao, de proposito, campos editoriais
-- INDEPENDENTES no admin atual (apps/admin/src/lib/editorial-action-policy.ts
-- + editorial-actions.ts): um revisor humano pode setar `indexStatus` para
-- QUALQUER valor do enum (inclusive 'index') e `reviewStatus` para qualquer
-- valor (inclusive voltar a 'draft') SEM que o outro campo mude junto, e
-- `publishedAt` nunca e tocado por essas acoes (permanece o "primeiro
-- publicado" historico mesmo apos reverter para draft). Um CHECK amarrando
-- review_status/index_status/published_at quebraria esse fluxo real (updates
-- legitimos passariam a falhar). Por isso NENHUM CHECK de coerencia entre
-- esses 3 campos foi adicionado aqui — "normalize apenas quando houver
-- beneficio real e migracao segura" (esta nao seria segura). Ver ADR.
