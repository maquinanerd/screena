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

-- HISTORICO imutavel — CADEIA supersedes: por (source_key, content_type,
-- provider, territorio) ordena cronologicamente e liga CADA licenca a
-- IMEDIATAMENTE anterior (a mais antiga fica NULL). Constroi a cadeia de verdade
-- (nao so escolhe a corrente). Idempotente. Nenhuma linha apagada.
WITH ordered AS (
  SELECT "id",
         LAG("id") OVER (
           PARTITION BY "source_key", "content_type",
                        COALESCE("provider_key", ''), COALESCE("territory_code", '')
           ORDER BY COALESCE("decided_at", "updated_at", "created_at") ASC, "id" ASC
         ) AS prev_id
  FROM "source_licenses"
)
UPDATE "source_licenses" sl
SET "supersedes_id" = ordered.prev_id
FROM ordered
WHERE ordered."id" = sl."id" AND sl."supersedes_id" IS DISTINCT FROM ordered.prev_id;

-- is_current: so a mais recente por grupo fica vigente; as demais historico.
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

-- Guarda ESTRUTURAL: supersedes_id so aponta para licenca do MESMO grupo
-- (source_key, content_type, provider_key, territory_code); proibe
-- autorreferencia e ciclo direto (A->B->A). Espelha o guard de
-- PageIndexabilityDecision.
CREATE OR REPLACE FUNCTION source_license_supersedes_same_group() RETURNS trigger AS $$
DECLARE
  parent "source_licenses"%ROWTYPE;
BEGIN
  IF NEW."supersedes_id" IS NOT NULL THEN
    IF NEW."supersedes_id" = NEW."id" THEN
      RAISE EXCEPTION 'source_licenses: supersedes_id nao pode ser autorreferencia';
    END IF;
    SELECT * INTO parent FROM "source_licenses" WHERE "id" = NEW."supersedes_id";
    IF NOT FOUND
       OR parent."source_key" <> NEW."source_key"
       OR parent."content_type" <> NEW."content_type"
       OR parent."provider_key" IS DISTINCT FROM NEW."provider_key"
       OR parent."territory_code" IS DISTINCT FROM NEW."territory_code"
    THEN
      RAISE EXCEPTION 'source_licenses: supersedes_id % deve referenciar licenca do mesmo (source_key, content_type, provider_key, territory_code)', NEW."supersedes_id";
    END IF;
    IF parent."supersedes_id" = NEW."id" THEN
      RAISE EXCEPTION 'source_licenses: ciclo direto de supersedes_id proibido';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "source_licenses_supersedes_guard"
  BEFORE INSERT OR UPDATE ON "source_licenses"
  FOR EACH ROW EXECUTE FUNCTION source_license_supersedes_same_group();

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

-- SHA-256 (pgcrypto) e a base dos fingerprints — nao MD5 (perda-zero exige
-- resistencia a colisao forte). Extensao criada de forma segura e idempotente.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- IDENTIDADE ESTAVEL da oferta (`wai:v1`), IMMUTABLE, para o indice unico e a
-- deduplicacao. Contem SO o que identifica a oferta como o MESMO objeto ao longo
-- do tempo: entidade, pais, MODALIDADE, provider_api (escopa o external id),
-- e — em ordem de prioridade — external_offer_id (autoritativo por provider_api)
-- OU o provider TECNICO (provider_key; SO como fallback o provider_name
-- normalizado quando provider_key e NULL) + package/plano. NAO inclui preco,
-- moeda, URLs nem validade (esses sao payload MUTAVEL — ver payload fingerprint).
-- Assim: mesmo external id em provider_api diferentes nao colide; modalidades
-- diferentes nao colidem; rebranding com provider_key estavel nao muda a
-- identidade; mudanca de preco NAO cria nova identidade (invalida a aprovacao do
-- MESMO objeto). Serializacao: campos por chr(31); nulls via COALESCE(...,'');
-- texto lower(btrim(...)); enums ::text; sem timezone (nao ha data na identidade).
CREATE OR REPLACE FUNCTION watch_offer_identity_key_v1(
  p_provider_api TEXT,
  p_external_offer_id TEXT,
  p_entity_type "EntityType",
  p_entity_id BIGINT,
  p_country_code TEXT,
  p_offer_type "OfferType",
  p_provider_key TEXT,
  p_provider_name TEXT,
  p_package TEXT
) RETURNS TEXT AS $$
  SELECT encode(public.digest(
    'wai:v1' || chr(31) ||
    p_entity_type::text || chr(31) || p_entity_id::text || chr(31) ||
    lower(btrim(p_country_code)) || chr(31) ||
    p_offer_type::text || chr(31) ||
    COALESCE(lower(btrim(p_provider_api)), '') || chr(31) ||
    CASE
      WHEN p_external_offer_id IS NOT NULL AND btrim(p_external_offer_id) <> ''
        THEN 'xid' || chr(31) || btrim(p_external_offer_id)
      ELSE 'prv' || chr(31) ||
        COALESCE(p_provider_key, 'nm:' || lower(btrim(p_provider_name)), '') || chr(31) ||
        COALESCE(lower(btrim(p_package)), '')
    END
  , 'sha256'::text), 'hex');
$$ LANGUAGE sql IMMUTABLE;

-- FINGERPRINT DO PAYLOAD (`wap:v1`), IMMUTABLE. Cobre TUDO que, ao mudar, exige
-- NOVA revisao humana: a identidade + provider_name exibido + package +
-- qualidade + preco + moeda + deep_link + web_url + validade inicial/final +
-- license_status + requires_attribution/linkback + attribution_text/url.
-- `approved_payload_hash` guarda ESTE fingerprint (nao a chave de identidade):
-- se o payload muda, o hash aprovado deixa de valer e a exibicao cai fail-closed.
-- Casas decimais: preco pelo ::text do numeric armazenado; datas ::text de
-- TIMESTAMP sem timezone (determinista). O fingerprint e computado SEMPRE no
-- banco (funcao), nunca reimplementado em TypeScript — sem risco de divergencia.
CREATE OR REPLACE FUNCTION watch_offer_payload_fingerprint_v1(
  p_provider_api TEXT,
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
  p_available_until TIMESTAMP,
  p_license_status "LicenseStatus",
  p_requires_attribution BOOLEAN,
  p_requires_linkback BOOLEAN,
  p_attribution_text TEXT,
  p_attribution_url TEXT
) RETURNS TEXT AS $$
  SELECT encode(public.digest(
    'wap:v1' || chr(31) ||
    watch_offer_identity_key_v1(p_provider_api, p_external_offer_id, p_entity_type,
      p_entity_id, p_country_code, p_offer_type, p_provider_key, p_provider_name, p_package) || chr(31) ||
    COALESCE(lower(btrim(p_provider_name)), '') || chr(31) ||
    COALESCE(lower(btrim(p_package)), '') || chr(31) ||
    COALESCE(lower(btrim(p_quality)), '') || chr(31) ||
    COALESCE(p_price::text, '') || chr(31) ||
    COALESCE(lower(btrim(p_currency)), '') || chr(31) ||
    COALESCE(btrim(p_deep_link), '') || chr(31) ||
    COALESCE(btrim(p_web_url), '') || chr(31) ||
    COALESCE(p_available_from::text, '') || chr(31) ||
    COALESCE(p_available_until::text, '') || chr(31) ||
    p_license_status::text || chr(31) ||
    p_requires_attribution::text || chr(31) ||
    p_requires_linkback::text || chr(31) ||
    COALESCE(p_attribution_text, '') || chr(31) ||
    COALESCE(p_attribution_url, '')
  , 'sha256'::text), 'hex');
$$ LANGUAGE sql IMMUTABLE;

-- Dedup ANTES do indice unico, por IDENTIDADE, com PRESERVACAO INTEGRAL. So
-- colapsa linhas com a MESMA identidade (mesmo objeto de oferta); duas
-- observacoes do mesmo objeto com preco/URL diferentes sao a MESMA identidade —
-- fica a mais recente e as demais vao para data_migration_quarantine com
-- snapshot JSONB completo + surviving_id + identity_key (statement unico:
-- arquiva-antes-de-apagar, atomico).
WITH idk AS (
  SELECT wa."id", wa."display_allowed", wa."reviewed_at", wa."updated_at", wa."created_at",
         watch_offer_identity_key_v1(wa."provider_api", wa."external_offer_id", wa."entity_type",
           wa."entity_id", wa."country_code", wa."offer_type", wa."provider_key",
           wa."provider_name", wa."package") AS identity_key
  FROM "watch_availability" wa
),
ranked AS (
  SELECT "id", identity_key,
         ROW_NUMBER() OVER (PARTITION BY identity_key
           ORDER BY "display_allowed" DESC, COALESCE("reviewed_at", "updated_at", "created_at") DESC, "id" DESC) AS rn,
         first_value("id") OVER (PARTITION BY identity_key
           ORDER BY "display_allowed" DESC, COALESCE("reviewed_at", "updated_at", "created_at") DESC, "id" DESC) AS survivor_id
  FROM idk
),
dupes AS (SELECT "id", identity_key, survivor_id FROM ranked WHERE rn > 1),
archived AS (
  INSERT INTO "data_migration_quarantine" ("source_table", "source_row_id", "issue", "detail")
  SELECT 'watch_availability', wa."id", 'watch_dedup_removed',
         to_jsonb(wa) || jsonb_build_object(
           'surviving_id', d.survivor_id,
           'dedupe_fingerprint', d.identity_key,
           'reason', 'oferta com identidade identica a survivor')
  FROM "watch_availability" wa JOIN dupes d ON d."id" = wa."id"
  RETURNING 1
)
DELETE FROM "watch_availability" wa USING dupes d WHERE wa."id" = d."id";

-- FAIL-CLOSED (backfill): uma oferta so aparece publicamente se
-- approved_payload_hash corresponder ao FINGERPRINT DO PAYLOAD atual. Legado:
-- hash null + display false => nada muda. Enforcement PERMANENTE pelo trigger
-- abaixo (nao adiado).
UPDATE "watch_availability" wa
SET "display_allowed" = false
WHERE wa."display_allowed" = true
  AND (wa."approved_payload_hash" IS NULL
       OR wa."approved_payload_hash" IS DISTINCT FROM watch_offer_payload_fingerprint_v1(
         wa."provider_api", wa."external_offer_id", wa."entity_type", wa."entity_id",
         wa."country_code", wa."offer_type", wa."provider_key", wa."provider_name",
         wa."package", wa."quality", wa."price", wa."currency", wa."deep_link",
         wa."web_url", wa."available_from", wa."available_until", wa."license_status",
         wa."requires_attribution", wa."requires_linkback", wa."attribution_text", wa."attribution_url"));

-- Indice unico sobre a IDENTIDADE. Ofertas distintas nao colidem; verdadeiras
-- duplicatas (mesma identidade) sim.
CREATE UNIQUE INDEX "watch_availability_offer_identity"
  ON "watch_availability" (watch_offer_identity_key_v1(
    "provider_api", "external_offer_id", "entity_type", "entity_id", "country_code",
    "offer_type", "provider_key", "provider_name", "package"));

-- TRIGGER PERMANENTE (fail-closed no BANCO, nao so no runtime): apos o merge, e
-- IMPOSSIVEL ter display_allowed=true sem governanca completa. Toda
-- INSERT/UPDATE que ligue display_allowed exige: approved_payload_hash =
-- fingerprint atual do payload; reviewed_at e reviewed_by presentes;
-- license_status que permita exibicao; atribuicao/linkback presentes quando
-- exigidos. Falha => a linha nao pode ficar publica.
CREATE OR REPLACE FUNCTION watch_availability_display_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."display_allowed" THEN
    IF NEW."approved_payload_hash" IS NULL
       OR NEW."approved_payload_hash" <> watch_offer_payload_fingerprint_v1(
            NEW."provider_api", NEW."external_offer_id", NEW."entity_type", NEW."entity_id",
            NEW."country_code", NEW."offer_type", NEW."provider_key", NEW."provider_name",
            NEW."package", NEW."quality", NEW."price", NEW."currency", NEW."deep_link",
            NEW."web_url", NEW."available_from", NEW."available_until", NEW."license_status",
            NEW."requires_attribution", NEW."requires_linkback", NEW."attribution_text", NEW."attribution_url")
    THEN RAISE EXCEPTION 'watch_availability fail-closed: approved_payload_hash ausente ou != fingerprint do payload atual';
    END IF;
    IF NEW."reviewed_at" IS NULL OR NEW."reviewed_by" IS NULL OR btrim(NEW."reviewed_by") = '' THEN
      RAISE EXCEPTION 'watch_availability fail-closed: reviewed_at/reviewed_by obrigatorios para display_allowed';
    END IF;
    IF NEW."license_status" NOT IN ('official', 'licensed', 'third_party') THEN
      RAISE EXCEPTION 'watch_availability fail-closed: license_status % nao permite exibicao', NEW."license_status";
    END IF;
    IF NEW."requires_attribution" AND (NEW."attribution_text" IS NULL OR btrim(NEW."attribution_text") = '') THEN
      RAISE EXCEPTION 'watch_availability fail-closed: attribution_text exigido ausente';
    END IF;
    IF NEW."requires_linkback" AND (NEW."attribution_url" IS NULL OR btrim(NEW."attribution_url") = '') THEN
      RAISE EXCEPTION 'watch_availability fail-closed: attribution_url (linkback) exigido ausente';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "watch_availability_display_guard_trg"
  BEFORE INSERT OR UPDATE ON "watch_availability"
  FOR EACH ROW EXECUTE FUNCTION watch_availability_display_guard();

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
