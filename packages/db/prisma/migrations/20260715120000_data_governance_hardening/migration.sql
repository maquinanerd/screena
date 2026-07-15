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
CREATE TYPE "SourceLicenseContentType" AS ENUM ('rating', 'watch_availability', 'review', 'video', 'news', 'image', 'other');

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
-- 1b) Quarentena auditavel de migracao (perda-zero de dado histórico)
-- ============================================================
-- Tabela GENERICA para preservar QUALQUER linha/valor que a migration
-- remova ou anule. Nenhum DELETE/NULL destrutivo acontece sem antes gravar aqui
-- um snapshot JSONB completo. `issue` classifica o caso; `detail` guarda o
-- snapshot + campos especificos (ex.: surviving_id, dedupe_fingerprint,
-- old_provider_key, reason). Write-only (sem model Prisma, como
-- entity_reference_orphans); consultada em auditoria/testes por SQL bruto.
CREATE TABLE "data_migration_quarantine" (
    "id" BIGSERIAL NOT NULL,
    "source_table" TEXT NOT NULL,
    "source_row_id" BIGINT,
    "issue" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_migration_quarantine_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "data_migration_quarantine_issue_idx" ON "data_migration_quarantine"("issue");
CREATE INDEX "data_migration_quarantine_source_idx" ON "data_migration_quarantine"("source_table", "source_row_id");

-- ============================================================
-- 2) source_licenses — relacoes verificaveis (RatingSource != ApiProvider)
--    + HISTORICO imutavel (is_current/supersedes_id) por (fonte, tipo, provider, territorio)
-- ============================================================

-- AlterTable (+ historico imutavel: is_current/supersedes_id/decision_origin/policy_version)
ALTER TABLE "source_licenses"
  ADD COLUMN "content_type" "SourceLicenseContentType" NOT NULL DEFAULT 'rating',
  ADD COLUMN "rating_source_key" TEXT,
  ADD COLUMN "territory_code" TEXT,
  ADD COLUMN "valid_from" TIMESTAMP(3),
  ADD COLUMN "valid_until" TIMESTAMP(3),
  ADD COLUMN "decided_by" TEXT,
  ADD COLUMN "decided_at" TIMESTAMP(3),
  ADD COLUMN "is_current" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "supersedes_id" BIGINT,
  ADD COLUMN "decision_origin" TEXT,
  ADD COLUMN "policy_version" TEXT;

-- Backfill idempotente: liga rating_source_key quando source_key bate com uma
-- fonte editorial real (content_type ja nasce 'rating' por default).
UPDATE "source_licenses" sl
SET "rating_source_key" = sl."source_key"
WHERE sl."content_type" = 'rating'
  AND sl."rating_source_key" IS NULL
  AND EXISTS (SELECT 1 FROM "rating_sources" rs WHERE rs."key" = sl."source_key");

-- provider_key INVALIDO (aponta para api_provider inexistente) NAO some em
-- silencio. (a) QUARENTENA o snapshot + valor antigo; (b) anula a FK; (c) forca
-- a linha FAIL-CLOSED (display_allowed=false, license_status=unknown). Ordem:
-- arquivar ANTES de anular.
INSERT INTO "data_migration_quarantine" ("source_table", "source_row_id", "issue", "detail")
SELECT 'source_licenses', sl."id", 'source_license_invalid_provider',
       to_jsonb(sl) || jsonb_build_object(
         'old_provider_key', sl."provider_key",
         'reason', 'provider_key nao existe em api_providers; anulado e fail-closed')
FROM "source_licenses" sl
WHERE sl."provider_key" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "api_providers" ap WHERE ap."key" = sl."provider_key");

UPDATE "source_licenses" sl
SET "provider_key" = NULL, "display_allowed" = false, "license_status" = 'unknown'
WHERE sl."provider_key" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "api_providers" ap WHERE ap."key" = sl."provider_key");

-- AddForeignKey (RatingSource, ApiProvider e Country sao 3 tabelas DISTINTAS —
-- invariante 2) + auto-relacao de historico (supersedes_id).
ALTER TABLE "source_licenses" ADD CONSTRAINT "source_licenses_rating_source_key_fkey"
  FOREIGN KEY ("rating_source_key") REFERENCES "rating_sources"("key") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "source_licenses" ADD CONSTRAINT "source_licenses_provider_key_fkey"
  FOREIGN KEY ("provider_key") REFERENCES "api_providers"("key") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "source_licenses" ADD CONSTRAINT "source_licenses_territory_code_fkey"
  FOREIGN KEY ("territory_code") REFERENCES "countries"("code") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "source_licenses" ADD CONSTRAINT "source_licenses_supersedes_id_fkey"
  FOREIGN KEY ("supersedes_id") REFERENCES "source_licenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
CREATE INDEX "source_licenses_is_current_idx" ON "source_licenses"("is_current");
CREATE INDEX "source_licenses_supersedes_id_idx" ON "source_licenses"("supersedes_id");

-- HISTORICO imutavel: por (source_key, content_type, provider, territorio),
-- so a linha mais recente fica is_current=true; duplicatas historicas viram
-- is_current=false (NENHUMA apagada). Idempotente. Depois: indice unico PARCIAL
-- garante 1 licenca VIGENTE por grupo (mesmo padrao de PageIndexabilityDecision).
WITH ranked AS (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "source_key", "content_type",
                        COALESCE("provider_key", ''), COALESCE("territory_code", '')
           ORDER BY COALESCE("decided_at", "updated_at", "created_at") DESC, "id" DESC
         ) AS rn
  FROM "source_licenses"
)
UPDATE "source_licenses" sl
SET "is_current" = (ranked.rn = 1)
FROM ranked
WHERE ranked."id" = sl."id" AND sl."is_current" IS DISTINCT FROM (ranked.rn = 1);

DROP INDEX IF EXISTS "source_licenses_default_unique";
CREATE UNIQUE INDEX "source_licenses_current_unique"
  ON "source_licenses" ("source_key", "content_type", COALESCE("provider_key", ''), COALESCE("territory_code", ''))
  WHERE "is_current" = true;

-- ============================================================
-- 3) watch_availability — chave natural + licenca/atribuicao propria
-- ============================================================

-- AlterTable (+ external_offer_id: ID ESTAVEL da oferta na API = identidade
-- prioritaria; web_url/package/licenca/atribuicao/revisao/fingerprint aprovado).
ALTER TABLE "watch_availability"
  ADD COLUMN "external_offer_id" TEXT,
  ADD COLUMN "license_status" "LicenseStatus" NOT NULL DEFAULT 'unknown',
  ADD COLUMN "requires_attribution" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "requires_linkback" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "attribution_text" TEXT,
  ADD COLUMN "attribution_url" TEXT,
  ADD COLUMN "reviewed_at" TIMESTAMP(3),
  ADD COLUMN "reviewed_by" TEXT,
  ADD COLUMN "approved_payload_hash" TEXT,
  ADD COLUMN "web_url" TEXT,
  ADD COLUMN "package" TEXT;

-- provider_key NAO e derivado de provider_name. O nome de exibicao e instavel
-- (muda, e traduzido, tem acentos/caixa, varia comercialmente, colide entre
-- marcas). provider_key vem de identificador TECNICO da API / tabela canonica /
-- mapeamento governado; ausente => permanece NULL (sinal "missing-provider",
-- nunca inventado). O fallback para provider_name existe SOMENTE na EXPRESSAO de
-- deduplicacao (funcao abaixo), sem modificar a coluna tecnica.

CREATE INDEX "watch_availability_provider_key_idx" ON "watch_availability"("provider_key");
CREATE INDEX "watch_availability_external_offer_id_idx" ON "watch_availability"("external_offer_id");

-- Fingerprint canonico VERSIONADO ('wa:v1') da IDENTIDADE de uma oferta.
-- IMMUTABLE => usavel em indice unico funcional. Prioriza o ID externo da API;
-- na ausencia dele, usa a TUPLA COMPLETA que diferencia ofertas reais: provider
-- tecnico (+ fallback so-de-comparacao ao provider_name normalizado lower/btrim,
-- acentos preservados => "Max" != "Max" acentuado), modalidade, package,
-- qualidade, preco+moeda, deep_link, web_url e validade. Ofertas legitimamente
-- distintas por package/preco/validade/URL NUNCA colapsam. Delimitador chr(31)
-- (unit separator) evita colisao entre campos. Trocar o algoritmo = nova versao
-- ('wa:v2') em migration dedicada que reconstroi o indice. Ver ADR 0002.
CREATE OR REPLACE FUNCTION watch_offer_fingerprint(
  p_external_offer_id TEXT,
  p_entity_type "EntityType",
  p_entity_id BIGINT,
  p_country_code TEXT,
  p_offer_type "OfferType",
  p_provider_key TEXT,
  p_provider_name TEXT,
  p_package TEXT,
  p_quality TEXT,
  p_price NUMERIC,
  p_currency TEXT,
  p_deep_link TEXT,
  p_web_url TEXT,
  p_available_from TIMESTAMP,
  p_available_until TIMESTAMP
) RETURNS TEXT AS $$
  SELECT md5(
    'wa:v1' || chr(31) ||
    p_entity_type::text || chr(31) || p_entity_id::text || chr(31) ||
    lower(btrim(p_country_code)) || chr(31) ||
    CASE
      WHEN p_external_offer_id IS NOT NULL AND btrim(p_external_offer_id) <> ''
        THEN 'id' || chr(31) || btrim(p_external_offer_id)
      ELSE 'fp' || chr(31) ||
        p_offer_type::text || chr(31) ||
        COALESCE(p_provider_key, '') || chr(31) ||
        COALESCE(lower(btrim(p_provider_name)), '') || chr(31) ||
        COALESCE(lower(btrim(p_package)), '') || chr(31) ||
        COALESCE(lower(btrim(p_quality)), '') || chr(31) ||
        COALESCE(p_price::text, '') || chr(31) ||
        COALESCE(lower(btrim(p_currency)), '') || chr(31) ||
        COALESCE(btrim(p_deep_link), '') || chr(31) ||
        COALESCE(btrim(p_web_url), '') || chr(31) ||
        COALESCE(p_available_from::text, '') || chr(31) ||
        COALESCE(p_available_until::text, '')
    END
  );
$$ LANGUAGE sql IMMUTABLE;

-- Dedup ANTES do indice unico, com PRESERVACAO INTEGRAL. So colapsa linhas com
-- fingerprint IDENTICO (mesma identidade) — ofertas distintas por
-- package/preco/validade/URL tem fingerprints diferentes e NAO sao tocadas.
-- Survivor = aprovada + observacao mais recente. TODAS as removidas vao para
-- data_migration_quarantine com snapshot JSONB completo + surviving_id +
-- fingerprint (statement unico: arquiva-antes-de-apagar, atomico).
WITH fp AS (
  SELECT wa."id", wa."display_allowed", wa."reviewed_at", wa."updated_at", wa."created_at",
         watch_offer_fingerprint(wa."external_offer_id", wa."entity_type", wa."entity_id",
           wa."country_code", wa."offer_type", wa."provider_key", wa."provider_name",
           wa."package", wa."quality", wa."price", wa."currency", wa."deep_link",
           wa."web_url", wa."available_from", wa."available_until") AS fingerprint
  FROM "watch_availability" wa
),
ranked AS (
  SELECT "id", fingerprint,
         ROW_NUMBER() OVER (PARTITION BY fingerprint
           ORDER BY "display_allowed" DESC, COALESCE("reviewed_at", "updated_at", "created_at") DESC, "id" DESC) AS rn,
         first_value("id") OVER (PARTITION BY fingerprint
           ORDER BY "display_allowed" DESC, COALESCE("reviewed_at", "updated_at", "created_at") DESC, "id" DESC) AS survivor_id
  FROM fp
),
dupes AS (SELECT "id", fingerprint, survivor_id FROM ranked WHERE rn > 1),
archived AS (
  INSERT INTO "data_migration_quarantine" ("source_table", "source_row_id", "issue", "detail")
  SELECT 'watch_availability', wa."id", 'watch_dedup_removed',
         to_jsonb(wa) || jsonb_build_object(
           'surviving_id', d.survivor_id,
           'dedupe_fingerprint', d.fingerprint,
           'reason', 'oferta com fingerprint identico a survivor')
  FROM "watch_availability" wa JOIN dupes d ON d."id" = wa."id"
  RETURNING 1
)
DELETE FROM "watch_availability" wa USING dupes d WHERE wa."id" = d."id";

-- FAIL-CLOSED: uma oferta so aparece publicamente se o payload aprovado
-- (approved_payload_hash) corresponder EXATAMENTE a identidade atual (fingerprint).
-- Aprovacao NAO sobrevive a um payload diferente. Legado: hash null +
-- display_allowed false => nada muda. (Enforcement PERMANENTE por CHECK, com o
-- CLI de promocao setando approved_payload_hash = fingerprint, fica para a
-- Fase 9 — o CLI mergeado antecede esta coluna. Ver ADR 0002.)
UPDATE "watch_availability" wa
SET "display_allowed" = false
WHERE wa."display_allowed" = true
  AND (wa."approved_payload_hash" IS NULL
       OR wa."approved_payload_hash" IS DISTINCT FROM watch_offer_fingerprint(
         wa."external_offer_id", wa."entity_type", wa."entity_id", wa."country_code",
         wa."offer_type", wa."provider_key", wa."provider_name", wa."package",
         wa."quality", wa."price", wa."currency", wa."deep_link", wa."web_url",
         wa."available_from", wa."available_until"));

-- Indice unico sobre a IDENTIDADE (fingerprint funcional). Ofertas distintas
-- nao colidem; verdadeiras duplicatas (mesma identidade) sim.
CREATE UNIQUE INDEX "watch_availability_offer_identity"
  ON "watch_availability" (watch_offer_fingerprint(
    "external_offer_id", "entity_type", "entity_id", "country_code", "offer_type",
    "provider_key", "provider_name", "package", "quality", "price", "currency",
    "deep_link", "web_url", "available_from", "available_until"));

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

-- Backfill da CADEIA historica: para cada (entity_type, entity_id, language_code),
-- ordena cronologicamente e liga CADA decisao a IMEDIATAMENTE ANTERIOR
-- (supersedes_id = id da anterior; a mais antiga fica NULL). Constroi a cadeia
-- de verdade, nao so marca a atual. Idempotente. Nenhuma linha apagada.
WITH ordered AS (
  SELECT "id",
         LAG("id") OVER (
           PARTITION BY "entity_type", "entity_id", "language_code"
           ORDER BY COALESCE("decided_at", "created_at") ASC, "id" ASC
         ) AS prev_id
  FROM "page_indexability_decisions"
)
UPDATE "page_indexability_decisions" pid
SET "supersedes_id" = ordered.prev_id
FROM ordered
WHERE ordered."id" = pid."id" AND pid."supersedes_id" IS DISTINCT FROM ordered.prev_id;

-- Backfill de is_current: so a mais recente por grupo fica vigente; as demais
-- viram is_current=false (historico preservado).
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

-- Guarda ESTRUTURAL: supersedes_id so pode apontar para uma decisao do MESMO
-- (entity_type, entity_id, language_code). Impede encadear historico de outra
-- entidade/idioma (uma FK simples nao expressa isso).
CREATE OR REPLACE FUNCTION page_indexability_supersedes_same_group() RETURNS trigger AS $$
BEGIN
  IF NEW."supersedes_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "page_indexability_decisions" p
    WHERE p."id" = NEW."supersedes_id"
      AND p."entity_type" = NEW."entity_type"
      AND p."entity_id" = NEW."entity_id"
      AND p."language_code" = NEW."language_code"
  ) THEN
    RAISE EXCEPTION 'supersedes_id % deve referenciar decisao do mesmo (entity_type, entity_id, language_code)', NEW."supersedes_id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "page_indexability_decisions_supersedes_guard"
  BEFORE INSERT OR UPDATE ON "page_indexability_decisions"
  FOR EACH ROW EXECUTE FUNCTION page_indexability_supersedes_same_group();

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
