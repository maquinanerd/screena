-- ============================================================
-- Backend B — External Intelligence Product
-- Ratings + Streaming + Cinerie Score + Licencas (forward-only)
--
-- Principio: NADA nasce exibivel. Toda exibicao de dado de terceiro passa a
-- exigir, NO BANCO (nao so no runtime), uma cadeia completa e verificavel:
--
--   SourceLicense (o que a fonte permite)
--     -> DataUsageDecision (para QUE USO, em que territorio, ate quando)
--       -> linha de dado (fingerprint aprovado + revisor humano)
--         -> display_allowed = true
--
-- Espelha o padrao ja provado na Fase 2 (`watch_availability_display_guard`):
-- fail-closed permanente por trigger. O que muda aqui:
--   1. `external_ratings` ganha a MESMA governanca que `watch_availability` ja
--      tinha (ate hoje o fail-closed de ratings era so aplicacao — o banco
--      aceitava display_allowed=true sem revisor, sem hash e sem licenca).
--   2. Nasce o eixo USE CASE (`data_usage_decisions`): `source_licenses` sabe o
--      que a fonte permite por content_type, mas nao para QUE USO. "Guardar
--      para auditoria" != "exibir em pagina indexavel" != "derivar um score".
--   3. Provedores de streaming ganham identidade canonica + aliases, para que
--      uma oferta exibida SEMPRE nomeie um provedor conhecido (e nao a string
--      crua do upstream).
--   4. O Cinerie Score nasce BLOQUEADO: sem decisao aprovada, o banco impede
--      marcar a nota como exibivel. A formula NAO esta decidida (ver
--      docs/product/cinerie-score-decision.md) e este arquivo nao a inventa.
--
-- Invariantes tocadas: 1 (IMDb != Rotten Tomatoes), 2 (provider_api !=
-- rating_source), 6 (sem licenca clara nao aparece), 8 (sem pirataria).
-- ============================================================

-- SHA-256 via pgcrypto (mesma base dos fingerprints da Fase 2). `public.digest`
-- qualificado: a hotfix de producao (PR #73) provou que sem o schema explicito
-- a funcao some quando o search_path do runtime nao inclui public.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 1. ENUMS
-- ============================================================

-- Ciclo de vida de um dado externo, do byte cru ate a exibicao. Os quatro
-- primeiros estagios sao do DADO (ainda nao ha decisao); os tres ultimos sao
-- DECISOES humanas registradas. `revoked` e terminal para aquela linha: a
-- reavaliacao INSERE nova decisao (historico imutavel), nunca reabre a antiga.
CREATE TYPE "DataUsageStage" AS ENUM (
  'raw',
  'recognized',
  'normalized',
  'license_pending',
  'approved_for_internal_use',
  'approved_for_display',
  'revoked'
);

-- Natureza editorial da nota. Separar critics de audience e invariante 1 em
-- outra roupa: Tomatometer (critics) e Popcornmeter (audience) sao metricas
-- DIFERENTES da MESMA fonte e nunca podem ser fundidas nem trocadas de rotulo.
CREATE TYPE "RatingScoreType" AS ENUM (
  'critics',
  'audience',
  'editorial'
);

-- Resultado de um calculo de Cinerie Score. `blocked_by_decision` e um
-- resultado de PRIMEIRA CLASSE, nao um erro: e o estado esperado enquanto a
-- decisao de produto nao existir.
CREATE TYPE "CinerieScoreStatus" AS ENUM (
  'calculated',
  'blocked_by_decision'
);

-- ============================================================
-- 2. data_usage_decisions — o eixo USE CASE
-- ============================================================
--
-- Por que nao reaproveitar `source_licenses` puro (a missao pede "nao duplicar
-- SourceLicense se suficiente"): `source_licenses` responde "o que esta fonte
-- permite para este content_type neste territorio" e ja tem historico
-- (is_current/supersedes_id), policy_version, decided_by e territorio. NAO
-- responde: "para QUE USO", "pode ARMAZENAR?", "pode DERIVAR obra nova?".
-- Esses tres eixos sao o que separa auditoria de exibicao de Cinerie Score.
-- Portanto: `data_usage_decisions` e FILHA de `source_licenses` (FK real), nao
-- uma copia — e NUNCA pode conceder mais do que a licenca-mae permite (guard
-- abaixo).
CREATE TABLE "data_usage_decisions" (
  "id"                   BIGSERIAL PRIMARY KEY,
  "source_license_id"    BIGINT NOT NULL,
  "use_case"             TEXT NOT NULL,
  "territory"            TEXT,
  "stage"                "DataUsageStage" NOT NULL DEFAULT 'license_pending',
  "display_allowed"      BOOLEAN NOT NULL DEFAULT false,
  "storage_allowed"      BOOLEAN NOT NULL DEFAULT false,
  "derivative_allowed"   BOOLEAN NOT NULL DEFAULT false,
  "attribution_required" BOOLEAN NOT NULL DEFAULT true,
  "linkback_required"    BOOLEAN NOT NULL DEFAULT true,
  "valid_from"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "valid_until"          TIMESTAMP(3),
  "policy_version"       TEXT NOT NULL,
  "decided_by"           TEXT NOT NULL,
  "reason"               TEXT NOT NULL,
  "supersedes_id"        BIGINT,
  "is_current"           BOOLEAN NOT NULL DEFAULT true,
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "data_usage_decisions"
  ADD CONSTRAINT "data_usage_decisions_source_license_fkey"
    FOREIGN KEY ("source_license_id") REFERENCES "source_licenses"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "data_usage_decisions_territory_fkey"
    FOREIGN KEY ("territory") REFERENCES "countries"("code")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "data_usage_decisions_supersedes_fkey"
    FOREIGN KEY ("supersedes_id") REFERENCES "data_usage_decisions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Escada de permissao: cada nivel exige o anterior. Exibir exige o estagio de
-- exibicao; derivar (Cinerie Score) exige poder armazenar; revogado nao permite
-- nada. Sao CHECKs, nao convencao: um UPDATE que ligue display sem subir o
-- estagio e rejeitado pelo banco.
ALTER TABLE "data_usage_decisions"
  ADD CONSTRAINT "data_usage_decisions_use_case_not_blank"
    CHECK (btrim("use_case") <> ''),
  ADD CONSTRAINT "data_usage_decisions_policy_version_not_blank"
    CHECK (btrim("policy_version") <> ''),
  ADD CONSTRAINT "data_usage_decisions_decided_by_not_blank"
    CHECK (btrim("decided_by") <> ''),
  ADD CONSTRAINT "data_usage_decisions_reason_not_blank"
    CHECK (btrim("reason") <> ''),
  ADD CONSTRAINT "data_usage_decisions_validity_range"
    CHECK ("valid_until" IS NULL OR "valid_until" > "valid_from"),
  ADD CONSTRAINT "data_usage_decisions_display_requires_stage"
    CHECK ("display_allowed" = false OR "stage" = 'approved_for_display'),
  ADD CONSTRAINT "data_usage_decisions_storage_requires_stage"
    CHECK ("storage_allowed" = false OR "stage" IN ('approved_for_internal_use', 'approved_for_display')),
  ADD CONSTRAINT "data_usage_decisions_display_requires_storage"
    CHECK ("display_allowed" = false OR "storage_allowed" = true),
  ADD CONSTRAINT "data_usage_decisions_derivative_requires_storage"
    CHECK ("derivative_allowed" = false OR "storage_allowed" = true),
  ADD CONSTRAINT "data_usage_decisions_revoked_allows_nothing"
    CHECK ("stage" <> 'revoked'
           OR ("display_allowed" = false AND "storage_allowed" = false AND "derivative_allowed" = false));

CREATE INDEX "data_usage_decisions_source_license_id_idx" ON "data_usage_decisions"("source_license_id");
CREATE INDEX "data_usage_decisions_use_case_idx" ON "data_usage_decisions"("use_case");
CREATE INDEX "data_usage_decisions_territory_idx" ON "data_usage_decisions"("territory");
CREATE INDEX "data_usage_decisions_stage_idx" ON "data_usage_decisions"("stage");
CREATE INDEX "data_usage_decisions_is_current_idx" ON "data_usage_decisions"("is_current");
CREATE INDEX "data_usage_decisions_supersedes_id_idx" ON "data_usage_decisions"("supersedes_id");

-- Uma decisao VIGENTE por (licenca, uso, territorio). Historico livre.
-- Espelha `source_licenses_current_unique`.
CREATE UNIQUE INDEX "data_usage_decisions_current_unique"
  ON "data_usage_decisions" ("source_license_id", "use_case", COALESCE("territory", ''))
  WHERE "is_current" = true;

-- Guard estrutural. Duas responsabilidades:
--
--  (a) Historico coerente — supersedes_id so aponta para decisao do MESMO grupo
--      (licenca, uso, territorio); sem autorreferencia; sem ciclo direto.
--      Espelha `source_license_supersedes_same_group`.
--
--  (b) TETO DA LICENCA-MAE — a decisao NUNCA concede mais do que a
--      `source_licenses` vigente permite. Sem isto, o eixo use_case viraria uma
--      porta dos fundos para lavar dado sem licenca: bastaria criar uma decisao
--      "approved_for_display" sobre uma licenca `unknown`. A missao diz "nao
--      inventar licencas" — este bloco e essa frase em SQL.
CREATE OR REPLACE FUNCTION data_usage_decision_guard() RETURNS trigger AS $$
DECLARE
  parent  "data_usage_decisions"%ROWTYPE;
  license "source_licenses"%ROWTYPE;
BEGIN
  IF NEW."supersedes_id" IS NOT NULL THEN
    IF NEW."supersedes_id" = NEW."id" THEN
      RAISE EXCEPTION 'data_usage_decisions: supersedes_id nao pode ser autorreferencia';
    END IF;
    SELECT * INTO parent FROM "data_usage_decisions" WHERE "id" = NEW."supersedes_id";
    IF NOT FOUND
       OR parent."source_license_id" <> NEW."source_license_id"
       OR parent."use_case" <> NEW."use_case"
       OR parent."territory" IS DISTINCT FROM NEW."territory"
    THEN
      RAISE EXCEPTION 'data_usage_decisions: supersedes_id % deve referenciar decisao do mesmo (source_license_id, use_case, territory)', NEW."supersedes_id";
    END IF;
    IF parent."supersedes_id" = NEW."id" THEN
      RAISE EXCEPTION 'data_usage_decisions: ciclo direto de supersedes_id proibido';
    END IF;
  END IF;

  -- Teto da licenca-mae: so checado quando a decisao concede algo.
  IF NEW."display_allowed" OR NEW."storage_allowed" OR NEW."derivative_allowed" THEN
    SELECT * INTO license FROM "source_licenses" WHERE "id" = NEW."source_license_id";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'data_usage_decisions fail-closed: source_license_id % inexistente', NEW."source_license_id";
    END IF;
    IF NOT license."is_current" THEN
      RAISE EXCEPTION 'data_usage_decisions fail-closed: licenca % nao e a vigente (is_current=false)', license."id";
    END IF;
    IF license."license_status" NOT IN ('official', 'licensed', 'third_party') THEN
      RAISE EXCEPTION 'data_usage_decisions fail-closed: licenca % com license_status % nao permite uso concedido', license."id", license."license_status";
    END IF;
    IF NEW."display_allowed" AND NOT license."display_allowed" THEN
      RAISE EXCEPTION 'data_usage_decisions fail-closed: decisao nao pode conceder display_allowed alem da licenca % (display_allowed=false)', license."id";
    END IF;
    -- Territorio: a decisao nao pode extrapolar o territorio da licenca. Licenca
    -- global (territory_code NULL) cobre qualquer territorio; licenca territorial
    -- so cobre o proprio territorio.
    IF license."territory_code" IS NOT NULL
       AND NEW."territory" IS DISTINCT FROM license."territory_code" THEN
      RAISE EXCEPTION 'data_usage_decisions fail-closed: decisao no territorio % excede a licenca % (territorio %)',
        COALESCE(NEW."territory", '<global>'), license."id", license."territory_code";
    END IF;
    -- Atribuicao/linkback: a decisao pode ENDURECER, nunca afrouxar o que a
    -- licenca exige.
    IF license."requires_attribution" AND NOT NEW."attribution_required" THEN
      RAISE EXCEPTION 'data_usage_decisions fail-closed: licenca % exige atribuicao; decisao nao pode dispensar', license."id";
    END IF;
    IF license."requires_linkback" AND NOT NEW."linkback_required" THEN
      RAISE EXCEPTION 'data_usage_decisions fail-closed: licenca % exige linkback; decisao nao pode dispensar', license."id";
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "data_usage_decisions_guard"
  BEFORE INSERT OR UPDATE ON "data_usage_decisions"
  FOR EACH ROW EXECUTE FUNCTION data_usage_decision_guard();

-- ============================================================
-- 3. Provedores canonicos de streaming + aliases
-- ============================================================
--
-- Hoje `watch_availability.provider_key`/`provider_name` sao strings cruas do
-- upstream, sem tabela canonica: "Netflix", "netflix", "NetflixBR" e
-- "Netflix Brasil" seriam quatro provedores diferentes na UI. `api_providers` NAO
-- serve para isto — ele descreve o FORNECEDOR TECNICO da API (invariante 2), nao
-- a plataforma de streaming.
CREATE TABLE "watch_providers" (
  "id"             BIGSERIAL PRIMARY KEY,
  "canonical_name" TEXT NOT NULL,
  "slug"           TEXT NOT NULL,
  "logo_asset_id"  TEXT,
  "homepage_url"   TEXT,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "watch_providers"
  ADD CONSTRAINT "watch_providers_slug_not_blank" CHECK (btrim("slug") <> ''),
  ADD CONSTRAINT "watch_providers_canonical_name_not_blank" CHECK (btrim("canonical_name") <> ''),
  -- Slug canonico: minusculo, sem acento/espaco. Mesma disciplina dos slugs de
  -- entidade.
  ADD CONSTRAINT "watch_providers_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  -- Homepage de provedor e link publico: HTTPS obrigatorio (nunca http/ftp/magnet).
  ADD CONSTRAINT "watch_providers_homepage_https"
    CHECK ("homepage_url" IS NULL OR "homepage_url" LIKE 'https://%');

CREATE UNIQUE INDEX "watch_providers_slug_key" ON "watch_providers"("slug");

-- Aliases: como CADA fornecedor tecnico chama esse provedor. A unicidade
-- (provider_api, external_key) e o que impede dois provedores canonicos
-- reivindicarem a mesma chave upstream.
CREATE TABLE "watch_provider_aliases" (
  "id"           BIGSERIAL PRIMARY KEY,
  "provider_id"  BIGINT NOT NULL,
  "provider_api" TEXT NOT NULL,
  "external_key" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "watch_provider_aliases"
  ADD CONSTRAINT "watch_provider_aliases_provider_fkey"
    FOREIGN KEY ("provider_id") REFERENCES "watch_providers"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  -- provider_api e FK real para o fornecedor TECNICO (invariante 2): o alias
  -- pertence a um transporte, nao a uma fonte editorial.
  ADD CONSTRAINT "watch_provider_aliases_provider_api_fkey"
    FOREIGN KEY ("provider_api") REFERENCES "api_providers"("key")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "watch_provider_aliases_external_key_not_blank"
    CHECK (btrim("external_key") <> ''),
  ADD CONSTRAINT "watch_provider_aliases_display_name_not_blank"
    CHECK (btrim("display_name") <> '');

CREATE UNIQUE INDEX "watch_provider_aliases_provider_api_external_key_key"
  ON "watch_provider_aliases"("provider_api", "external_key");
CREATE INDEX "watch_provider_aliases_provider_id_idx" ON "watch_provider_aliases"("provider_id");

-- Ligacao da oferta ao provedor canonico. Nullable: uma oferta cujo alias ainda
-- nao foi mapeado continua sendo ingerida e auditada — so nao pode ser exibida
-- (ver guard). Nao entra no fingerprint de payload v1 de proposito: e um campo
-- DERIVADO da nossa tabela de aliases, nao do payload do upstream. A coerencia
-- e garantida pelo guard, que reconfere o alias a cada escrita.
ALTER TABLE "watch_availability"
  ADD COLUMN "watch_provider_id" BIGINT,
  ADD CONSTRAINT "watch_availability_watch_provider_fkey"
    FOREIGN KEY ("watch_provider_id") REFERENCES "watch_providers"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "watch_availability_watch_provider_id_idx" ON "watch_availability"("watch_provider_id");

-- ============================================================
-- 4. external_ratings — governanca no mesmo nivel de watch_availability
-- ============================================================
--
-- Ate aqui `external_ratings` tinha display_allowed com DEFAULT false e nada
-- mais: o banco aceitava `UPDATE external_ratings SET display_allowed = true`
-- sem revisor, sem hash, sem licenca e sem decisao. O default protegia o
-- caminho feliz, nao o caminho errado. Estas colunas + os dois triggers abaixo
-- fecham isso.
ALTER TABLE "external_ratings"
  ADD COLUMN "score_type"             "RatingScoreType",
  ADD COLUMN "requires_attribution"   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "requires_linkback"      BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "reviewed_at"            TIMESTAMP(3),
  ADD COLUMN "reviewed_by"            TEXT,
  ADD COLUMN "approved_payload_hash"  TEXT,
  ADD COLUMN "stale_after"            TIMESTAMP(3),
  ADD COLUMN "data_usage_decision_id" BIGINT;

ALTER TABLE "external_ratings"
  ADD CONSTRAINT "external_ratings_data_usage_decision_fkey"
    FOREIGN KEY ("data_usage_decision_id") REFERENCES "data_usage_decisions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "external_ratings_score_type_idx" ON "external_ratings"("score_type");
CREATE INDEX "external_ratings_stale_after_idx" ON "external_ratings"("stale_after");
CREATE INDEX "external_ratings_data_usage_decision_id_idx" ON "external_ratings"("data_usage_decision_id");

-- Backfill de score_type a partir de `metric`, deterministico e conservador.
-- Notas cuja metrica nao permite classificar ficam NULL — e o guard abaixo
-- PROIBE exibir nota sem score_type. Ou seja: o que nao soubermos classificar
-- nao vaza; some da vitrine, nao do banco.
UPDATE "external_ratings"
   SET "score_type" = 'critics'
 WHERE "score_type" IS NULL
   AND (lower("metric") LIKE '%critic%' OR lower("metric") IN ('tomatometer', 'metascore'));

UPDATE "external_ratings"
   SET "score_type" = 'audience'
 WHERE "score_type" IS NULL
   AND (lower("metric") LIKE '%audience%'
        OR lower("metric") LIKE '%user%'
        OR lower("metric") IN ('popcornmeter', 'userscore'));

-- Qualquer nota que ja estivesse marcada como exibivel sem a cadeia completa
-- perde a exibicao AGORA (backfill fail-closed). Mesma politica do backfill de
-- watch_availability na Fase 2: revogar e barato, vazar nao tem volta.
UPDATE "external_ratings"
   SET "display_allowed" = false
 WHERE "display_allowed" = true;

-- ---------- 4.1 Identidade e fingerprint da nota ----------

-- IDENTIDADE (`eri:v1`), IMMUTABLE. O que faz duas observacoes serem a MESMA
-- nota: entidade + fonte editorial + metrica. `provider_api` NAO entra: quem
-- transportou o byte nao muda QUAL e o fato editorial (invariante 2). Isto
-- espelha o @@unique (entity_type, entity_id, rating_source, metric) que ja
-- existia — a funcao existe para o fingerprint construir em cima e para o
-- validator/auditoria terem um identificador estavel.
CREATE OR REPLACE FUNCTION external_rating_identity_key_v1(
  p_entity_type "EntityType",
  p_entity_id BIGINT,
  p_rating_source TEXT,
  p_metric TEXT
) RETURNS TEXT AS $$
  SELECT encode(public.digest(
    'eri:v1' || chr(31) ||
    p_entity_type::text || chr(31) ||
    p_entity_id::text || chr(31) ||
    lower(btrim(p_rating_source)) || chr(31) ||
    lower(btrim(p_metric))
  , 'sha256'::text), 'hex');
$$ LANGUAGE sql IMMUTABLE;

-- FINGERPRINT DO PAYLOAD (`erp:v1`), IMMUTABLE. Cobre TUDO que, ao mudar, exige
-- NOVA revisao humana: a identidade + tipo de score + rotulo + valor + escala +
-- contagem de votos + URL + fornecedor tecnico + licenca + atribuicao/linkback.
--
-- Consequencia direta (a missao pede "mudanca revoga"): `approved_payload_hash`
-- guarda ESTE valor. Se a nota sobe de 8.4 para 8.5, ou se o numero de votos
-- muda, ou se a atribuicao some, o hash aprovado deixa de bater e o trigger
-- derruba a exibicao. Nao existe caminho em que um numero novo herde a
-- aprovacao do numero velho.
--
-- `p_rating_value NUMERIC` serializado por ::text a partir do numeric ARMAZENADO
-- (determinista); calculado SEMPRE no banco, nunca reimplementado em TypeScript.
CREATE OR REPLACE FUNCTION external_rating_payload_fingerprint_v1(
  p_entity_type "EntityType",
  p_entity_id BIGINT,
  p_rating_source TEXT,
  p_metric TEXT,
  p_score_type "RatingScoreType",
  p_rating_label TEXT,
  p_rating_value NUMERIC,
  p_rating_scale INT,
  p_rating_count INT,
  p_rating_url TEXT,
  p_provider_api TEXT,
  p_license_status "LicenseStatus",
  p_requires_attribution BOOLEAN,
  p_requires_linkback BOOLEAN,
  p_attribution_text TEXT,
  p_attribution_url TEXT
) RETURNS TEXT AS $$
  SELECT encode(public.digest(
    'erp:v1' || chr(31) ||
    external_rating_identity_key_v1(p_entity_type, p_entity_id, p_rating_source, p_metric) || chr(31) ||
    COALESCE(p_score_type::text, '') || chr(31) ||
    COALESCE(lower(btrim(p_rating_label)), '') || chr(31) ||
    COALESCE(p_rating_value::text, '') || chr(31) ||
    COALESCE(p_rating_scale::text, '') || chr(31) ||
    COALESCE(p_rating_count::text, '') || chr(31) ||
    COALESCE(btrim(p_rating_url), '') || chr(31) ||
    COALESCE(lower(btrim(p_provider_api)), '') || chr(31) ||
    p_license_status::text || chr(31) ||
    p_requires_attribution::text || chr(31) ||
    p_requires_linkback::text || chr(31) ||
    COALESCE(p_attribution_text, '') || chr(31) ||
    COALESCE(p_attribution_url, '')
  , 'sha256'::text), 'hex');
$$ LANGUAGE sql IMMUTABLE;

-- ---------- 4.2 Guard de INTEGRIDADE (vale para toda linha, exibida ou nao) ----------
--
-- `validateRating` (packages/schemas/src/ratings.ts) ja aplica estas regras na
-- fronteira pura. O problema: a fronteira pura so protege quem passa por ela.
-- Um script, um seed, um `$executeRawUnsafe` ou um psql aberto nao passam.
-- Aqui as invariantes 1 e 2 viram lei do BANCO — errado nao entra, nem para
-- auditoria.
CREATE OR REPLACE FUNCTION external_ratings_integrity_guard() RETURNS trigger AS $$
DECLARE
  source_scale INT;
BEGIN
  -- Invariante 2: o fornecedor tecnico NUNCA e a fonte editorial. Duas checagens
  -- distintas — nao basta serem diferentes entre si, `provider_api` nao pode
  -- sequer ser o identificador de ALGUMA fonte editorial (RapidAPI transportando
  -- IMDb nao vira "imdb").
  IF NEW."provider_api" = NEW."rating_source" THEN
    RAISE EXCEPTION 'external_ratings: provider_api nao pode ser igual a rating_source (%) — invariante 2', NEW."rating_source";
  END IF;
  IF EXISTS (SELECT 1 FROM "rating_sources" WHERE "key" = NEW."provider_api") THEN
    RAISE EXCEPTION 'external_ratings: provider_api % e uma fonte editorial — fornecedor tecnico nao usa identificador de rating_source (invariante 2)', NEW."provider_api";
  END IF;

  -- Invariante 3 (escalas): a escala e propriedade da FONTE, nao do consumidor.
  -- imdb=10 e imdb=100 nao sao "duas convencoes" — a segunda e um dado errado.
  SELECT "scale" INTO source_scale FROM "rating_sources" WHERE "key" = NEW."rating_source";
  IF source_scale IS NULL THEN
    RAISE EXCEPTION 'external_ratings: rating_source % nao existe em rating_sources', NEW."rating_source";
  END IF;
  IF NEW."rating_scale" <> source_scale THEN
    RAISE EXCEPTION 'external_ratings: rating_scale % nao corresponde a escala % da fonte % — invariante 1', NEW."rating_scale", source_scale, NEW."rating_source";
  END IF;

  -- Valor dentro da escala. Uma nota 9.9 numa escala 5 e ruido, nao dado.
  IF NEW."rating_value" < 0 OR NEW."rating_value" > NEW."rating_scale" THEN
    RAISE EXCEPTION 'external_ratings: rating_value % fora da escala 0..%', NEW."rating_value", NEW."rating_scale";
  END IF;

  -- Votos negativos nao existem. (NULL = desconhecido e legitimo: a missao
  -- proibe INVENTAR votos, e null e como se diz "nao sei" sem mentir.)
  IF NEW."rating_count" IS NOT NULL AND NEW."rating_count" < 0 THEN
    RAISE EXCEPTION 'external_ratings: rating_count nao pode ser negativo';
  END IF;

  -- Invariante 1 (cross-label): um rotulo que cita a marca de uma fonte FORCA
  -- aquela fonte. "Tomatometer" atribuido ao IMDb e o caso classico e esta
  -- linha e a que o impede.
  IF NEW."rating_label" ~* '(tomatometer|tomate|popcornmeter)' AND NEW."rating_source" <> 'rotten_tomatoes' THEN
    RAISE EXCEPTION 'external_ratings: rating_label "%" pertence ao Rotten Tomatoes, nao a % — invariante 1', NEW."rating_label", NEW."rating_source";
  END IF;
  IF NEW."rating_label" ~* 'imdb' AND NEW."rating_source" <> 'imdb' THEN
    RAISE EXCEPTION 'external_ratings: rating_label "%" pertence ao IMDb, nao a % — invariante 1', NEW."rating_label", NEW."rating_source";
  END IF;
  IF NEW."rating_label" ~* '(metacritic|metascore)' AND NEW."rating_source" <> 'metacritic' THEN
    RAISE EXCEPTION 'external_ratings: rating_label "%" pertence ao Metacritic, nao a % — invariante 1', NEW."rating_label", NEW."rating_source";
  END IF;

  -- Critics != audience. Tomatometer e Popcornmeter sao a MESMA fonte e metricas
  -- OPOSTAS; trocar o score_type funde publico com critica.
  IF NEW."score_type" IS NOT NULL THEN
    IF NEW."rating_label" ~* 'tomatometer' AND NEW."score_type" <> 'critics' THEN
      RAISE EXCEPTION 'external_ratings: Tomatometer e nota de CRITICA; score_type % e incoerente', NEW."score_type";
    END IF;
    IF NEW."rating_label" ~* 'popcornmeter' AND NEW."score_type" <> 'audience' THEN
      RAISE EXCEPTION 'external_ratings: Popcornmeter e nota de PUBLICO; score_type % e incoerente', NEW."score_type";
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "external_ratings_integrity_guard_trg"
  BEFORE INSERT OR UPDATE ON "external_ratings"
  FOR EACH ROW EXECUTE FUNCTION external_ratings_integrity_guard();

-- ---------- 4.3 Guard de EXIBICAO (fail-closed permanente) ----------
--
-- Espelha `watch_availability_display_guard` e acrescenta o elo novo: a decisao
-- de uso. Depois desta migration e IMPOSSIVEL — por qualquer caminho, inclusive
-- SQL bruto — ter uma nota publica sem: hash do payload aprovado batendo com o
-- payload atual, revisor humano nomeado, licenca que permita, atribuicao/linkback
-- exigidos presentes, tipo de score classificado e uma DataUsageDecision vigente
-- que autorize exibir aquela fonte.
CREATE OR REPLACE FUNCTION external_ratings_display_guard() RETURNS trigger AS $$
DECLARE
  decision "data_usage_decisions"%ROWTYPE;
  license  "source_licenses"%ROWTYPE;
BEGIN
  IF NEW."display_allowed" THEN
    IF NEW."approved_payload_hash" IS NULL
       OR NEW."approved_payload_hash" <> external_rating_payload_fingerprint_v1(
            NEW."entity_type", NEW."entity_id", NEW."rating_source", NEW."metric",
            NEW."score_type", NEW."rating_label", NEW."rating_value", NEW."rating_scale",
            NEW."rating_count", NEW."rating_url", NEW."provider_api", NEW."license_status",
            NEW."requires_attribution", NEW."requires_linkback",
            NEW."attribution_text", NEW."attribution_url")
    THEN
      RAISE EXCEPTION 'external_ratings fail-closed: approved_payload_hash ausente ou != fingerprint do payload atual (nota mudou apos a aprovacao?)';
    END IF;

    IF NEW."reviewed_at" IS NULL OR NEW."reviewed_by" IS NULL OR btrim(NEW."reviewed_by") = '' THEN
      RAISE EXCEPTION 'external_ratings fail-closed: reviewed_at/reviewed_by obrigatorios para display_allowed';
    END IF;

    IF NEW."score_type" IS NULL THEN
      RAISE EXCEPTION 'external_ratings fail-closed: score_type obrigatorio para display_allowed (critics/audience nunca se misturam)';
    END IF;

    IF NEW."license_status" NOT IN ('official', 'licensed', 'third_party') THEN
      RAISE EXCEPTION 'external_ratings fail-closed: license_status % nao permite exibicao', NEW."license_status";
    END IF;

    IF NEW."requires_attribution" AND (NEW."attribution_text" IS NULL OR btrim(NEW."attribution_text") = '') THEN
      RAISE EXCEPTION 'external_ratings fail-closed: attribution_text exigido ausente';
    END IF;

    IF NEW."requires_linkback" AND (NEW."attribution_url" IS NULL OR btrim(NEW."attribution_url") = '') THEN
      RAISE EXCEPTION 'external_ratings fail-closed: attribution_url (linkback) exigido ausente';
    END IF;

    -- O elo novo: decisao de uso vigente e valida.
    IF NEW."data_usage_decision_id" IS NULL THEN
      RAISE EXCEPTION 'external_ratings fail-closed: data_usage_decision_id obrigatorio para display_allowed';
    END IF;
    SELECT * INTO decision FROM "data_usage_decisions" WHERE "id" = NEW."data_usage_decision_id";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'external_ratings fail-closed: data_usage_decision_id % inexistente', NEW."data_usage_decision_id";
    END IF;
    IF NOT decision."is_current" THEN
      RAISE EXCEPTION 'external_ratings fail-closed: decisao % nao e a vigente', decision."id";
    END IF;
    IF decision."stage" <> 'approved_for_display' OR NOT decision."display_allowed" THEN
      RAISE EXCEPTION 'external_ratings fail-closed: decisao % (stage=%) nao autoriza exibicao', decision."id", decision."stage";
    END IF;
    IF decision."valid_from" > CURRENT_TIMESTAMP
       OR (decision."valid_until" IS NOT NULL AND decision."valid_until" <= CURRENT_TIMESTAMP) THEN
      RAISE EXCEPTION 'external_ratings fail-closed: decisao % fora da vigencia', decision."id";
    END IF;

    -- A decisao tem de pertencer a licenca DESTA fonte editorial. Sem isto,
    -- uma decisao aprovada para o Metacritic autorizaria exibir IMDb.
    SELECT * INTO license FROM "source_licenses" WHERE "id" = decision."source_license_id";
    IF NOT FOUND
       OR license."content_type" <> 'rating'
       OR license."rating_source_key" IS DISTINCT FROM NEW."rating_source" THEN
      RAISE EXCEPTION 'external_ratings fail-closed: decisao % nao pertence a licenca de rating da fonte %', decision."id", NEW."rating_source";
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "external_ratings_display_guard_trg"
  BEFORE INSERT OR UPDATE ON "external_ratings"
  FOR EACH ROW EXECUTE FUNCTION external_ratings_display_guard();

-- ============================================================
-- 5. watch_availability — provedor canonico obrigatorio para exibir
-- ============================================================
--
-- CREATE OR REPLACE do guard da Fase 2. A mudanca e ESTRITAMENTE mais
-- restritiva (nunca afrouxa): mantem tudo que ja exigia e acrescenta o provedor
-- canonico + a decisao de uso. Uma oferta so aparece se nomear um provedor
-- que conhecemos, e o alias e RECONFERIDO a cada escrita — remapear o alias e
-- reescrever a oferta faz a exibicao cair.
--
-- Nota honesta de limite (vale para os dois guards): um trigger so dispara em
-- escrita. Uma decisao que EXPIRA pelo tempo, ou um alias remapeado sem tocar a
-- oferta, nao derrubam a linha retroativamente. Por isso o caminho de LEITURA
-- refiltra vigencia (ver read ports) — o trigger e a trava de escrita, nao um
-- relogio.
CREATE OR REPLACE FUNCTION watch_availability_display_guard() RETURNS trigger AS $$
DECLARE
  alias_provider BIGINT;
  provider_slug  TEXT;
  decision "data_usage_decisions"%ROWTYPE;
  license  "source_licenses"%ROWTYPE;
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

    -- NOVO: provedor canonico resolvido e coerente com o alias.
    IF NEW."watch_provider_id" IS NULL THEN
      RAISE EXCEPTION 'watch_availability fail-closed: watch_provider_id obrigatorio para display_allowed (provedor canonico nao mapeado para provider_key=%)', COALESCE(NEW."provider_key", '<null>');
    END IF;
    SELECT "provider_id" INTO alias_provider
      FROM "watch_provider_aliases"
     WHERE "provider_api" = NEW."provider_api"
       AND "external_key" = NEW."provider_key";
    IF alias_provider IS NULL THEN
      RAISE EXCEPTION 'watch_availability fail-closed: nao ha alias para (provider_api=%, provider_key=%)', COALESCE(NEW."provider_api", '<null>'), COALESCE(NEW."provider_key", '<null>');
    END IF;
    IF alias_provider <> NEW."watch_provider_id" THEN
      RAISE EXCEPTION 'watch_availability fail-closed: watch_provider_id % diverge do alias (esperado %)', NEW."watch_provider_id", alias_provider;
    END IF;

    -- NOVO: decisao de uso vigente para exibir oferta neste territorio.
    IF NEW."data_usage_decision_id" IS NULL THEN
      RAISE EXCEPTION 'watch_availability fail-closed: data_usage_decision_id obrigatorio para display_allowed';
    END IF;
    SELECT * INTO decision FROM "data_usage_decisions" WHERE "id" = NEW."data_usage_decision_id";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'watch_availability fail-closed: data_usage_decision_id % inexistente', NEW."data_usage_decision_id";
    END IF;
    IF NOT decision."is_current" OR decision."stage" <> 'approved_for_display' OR NOT decision."display_allowed" THEN
      RAISE EXCEPTION 'watch_availability fail-closed: decisao % nao autoriza exibicao', decision."id";
    END IF;
    IF decision."valid_from" > CURRENT_TIMESTAMP
       OR (decision."valid_until" IS NOT NULL AND decision."valid_until" <= CURRENT_TIMESTAMP) THEN
      RAISE EXCEPTION 'watch_availability fail-closed: decisao % fora da vigencia', decision."id";
    END IF;
    -- Territorio da decisao tem de cobrir o pais da oferta (null = global).
    IF decision."territory" IS NOT NULL AND decision."territory" <> NEW."country_code" THEN
      RAISE EXCEPTION 'watch_availability fail-closed: decisao % (territorio %) nao cobre a oferta em %', decision."id", decision."territory", NEW."country_code";
    END IF;

    -- A decisao tem de pertencer a licenca DESTE provedor canonico. Sem isto,
    -- uma decisao aprovada para a Netflix autorizaria exibir uma oferta da Max.
    -- Convencao (documentada em docs/backend/streaming-platform.md): para
    -- content_type='watch_availability', `source_licenses.source_key` E o slug do
    -- `watch_providers` — e o que da a uma licenca de streaming uma chave natural
    -- estavel, ja que `source_key` e texto livre.
    SELECT * INTO license FROM "source_licenses" WHERE "id" = decision."source_license_id";
    IF NOT FOUND OR license."content_type" <> 'watch_availability' THEN
      RAISE EXCEPTION 'watch_availability fail-closed: decisao % nao pertence a uma licenca de watch_availability', decision."id";
    END IF;
    SELECT "slug" INTO provider_slug FROM "watch_providers" WHERE "id" = NEW."watch_provider_id";
    IF license."source_key" IS DISTINCT FROM provider_slug THEN
      RAISE EXCEPTION 'watch_availability fail-closed: decisao % pertence a licenca de "%" mas a oferta e do provedor "%"', decision."id", license."source_key", COALESCE(provider_slug, '<desconhecido>');
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Coluna da decisao na oferta (o guard acima ja a exige).
ALTER TABLE "watch_availability"
  ADD COLUMN "data_usage_decision_id" BIGINT,
  ADD CONSTRAINT "watch_availability_data_usage_decision_fkey"
    FOREIGN KEY ("data_usage_decision_id") REFERENCES "data_usage_decisions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "watch_availability_data_usage_decision_id_idx" ON "watch_availability"("data_usage_decision_id");

-- Backfill fail-closed: qualquer oferta que estivesse exibida antes deste
-- endurecimento perde a exibicao ate ser repromovida pelo caminho novo (alias +
-- decisao). Mesma politica da Fase 2.
UPDATE "watch_availability"
   SET "display_allowed" = false
 WHERE "display_allowed" = true
   AND ("watch_provider_id" IS NULL OR "data_usage_decision_id" IS NULL);

-- Link tecnico que faltava: provider_api de uma oferta tem de ser um fornecedor
-- conhecido. Era string livre — e uma oferta de fornecedor fantasma nunca
-- poderia ser auditada.
UPDATE "watch_availability"
   SET "provider_api" = NULL
 WHERE "provider_api" IS NOT NULL
   AND "provider_api" NOT IN (SELECT "key" FROM "api_providers");

ALTER TABLE "watch_availability"
  ADD CONSTRAINT "watch_availability_provider_api_fkey"
    FOREIGN KEY ("provider_api") REFERENCES "api_providers"("key")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- 6. Cinerie Score — historico versionado, nascendo BLOQUEADO
-- ============================================================
--
-- ATENCAO (a parte mais importante deste arquivo): NAO ha formula aqui. A
-- decisao de produto — escala, fontes, pesos, votos minimos, arredondamento —
-- e HUMANA e esta pendente em docs/product/cinerie-score-decision.md. Este
-- bloco entrega o ESQUELETO auditavel (historico, versionamento, hash de
-- entrada) e a TRAVA que impede alguem preencher producao antes da decisao.
CREATE TABLE "cinerie_score_calculations" (
  "id"             BIGSERIAL PRIMARY KEY,
  "entity_type"    "EntityType" NOT NULL,
  "entity_id"      BIGINT NOT NULL,
  "status"         "CinerieScoreStatus" NOT NULL,
  "value"          DECIMAL(6,3),
  "scale"          INT,
  "version"        TEXT NOT NULL,
  "inputs_hash"    TEXT NOT NULL,
  "explanation"    JSONB,
  "blocked_reason" TEXT,
  "calculated_at"  TIMESTAMP(3) NOT NULL,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "cinerie_score_calculations"
  ADD CONSTRAINT "cinerie_score_calculations_version_not_blank"
    CHECK (btrim("version") <> ''),
  ADD CONSTRAINT "cinerie_score_calculations_inputs_hash_not_blank"
    CHECK (btrim("inputs_hash") <> ''),
  -- Um calculo ou produziu numero, ou explicou por que nao produziu. Nunca as
  -- duas coisas, nunca nenhuma.
  ADD CONSTRAINT "cinerie_score_calculations_status_shape"
    CHECK (
      ("status" = 'calculated'
        AND "value" IS NOT NULL AND "scale" IS NOT NULL AND "explanation" IS NOT NULL
        AND "blocked_reason" IS NULL)
      OR
      ("status" = 'blocked_by_decision'
        AND "value" IS NULL AND "scale" IS NULL
        AND "blocked_reason" IS NOT NULL AND btrim("blocked_reason") <> '')
    ),
  ADD CONSTRAINT "cinerie_score_calculations_value_in_scale"
    CHECK ("value" IS NULL OR ("scale" IS NOT NULL AND "value" >= 0 AND "value" <= "scale"));

CREATE INDEX "cinerie_score_calculations_entity_idx"
  ON "cinerie_score_calculations"("entity_type", "entity_id");
CREATE INDEX "cinerie_score_calculations_version_idx" ON "cinerie_score_calculations"("version");
CREATE INDEX "cinerie_score_calculations_status_idx" ON "cinerie_score_calculations"("status");
CREATE INDEX "cinerie_score_calculations_calculated_at_idx" ON "cinerie_score_calculations"("calculated_at");

-- Historico: um calculo por (entidade, versao, inputs_hash). Recalcular com a
-- MESMA versao e as MESMAS entradas nao polui o historico; mudar a versao ou as
-- entradas cria linha nova. Assim "por que a nota mudou?" tem resposta.
CREATE UNIQUE INDEX "cinerie_score_calculations_entity_version_inputs_key"
  ON "cinerie_score_calculations"("entity_type", "entity_id", "version", "inputs_hash");

-- ---------- 6.1 A trava: sem decisao aprovada, a nota nao e exibivel ----------
--
-- `movies.screen_score_display` / `tv_shows.screen_score_display` sao as colunas
-- tecnicas legadas (o nome permanece por compatibilidade; o nome PUBLICO e
-- Cinerie Score e "Screen Score" nunca aparece ao usuario).
--
-- A trava reusa `data_usage_decisions` em vez de inventar tabela nova, e o eixo
-- correto: o Cinerie Score e uma OBRA DERIVADA de notas de terceiros, logo
-- depende de `derivative_allowed`. Sem uma decisao vigente para o use case
-- `cinerie_score_display`, o banco recusa marcar a nota como exibivel.
CREATE OR REPLACE FUNCTION cinerie_score_display_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."screen_score_display" THEN
    IF NEW."screen_score" IS NULL OR NEW."screen_score_scale" IS NULL THEN
      RAISE EXCEPTION 'cinerie score fail-closed: screen_score/screen_score_scale obrigatorios para screen_score_display';
    END IF;
    IF NEW."screen_score" < 0 OR NEW."screen_score" > NEW."screen_score_scale" THEN
      RAISE EXCEPTION 'cinerie score fail-closed: screen_score % fora da escala 0..%', NEW."screen_score", NEW."screen_score_scale";
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "data_usage_decisions" d
       WHERE d."use_case" = 'cinerie_score_display'
         AND d."is_current"
         AND d."stage" = 'approved_for_display'
         AND d."display_allowed"
         AND d."derivative_allowed"
         AND d."valid_from" <= CURRENT_TIMESTAMP
         AND (d."valid_until" IS NULL OR d."valid_until" > CURRENT_TIMESTAMP)
    ) THEN
      RAISE EXCEPTION 'cinerie score BLOCKED_BY_DECISION: nao ha DataUsageDecision vigente para use_case=cinerie_score_display (ver docs/product/cinerie-score-decision.md)';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "movies_cinerie_score_display_guard"
  BEFORE INSERT OR UPDATE ON "movies"
  FOR EACH ROW EXECUTE FUNCTION cinerie_score_display_guard();

CREATE TRIGGER "tv_shows_cinerie_score_display_guard"
  BEFORE INSERT OR UPDATE ON "tv_shows"
  FOR EACH ROW EXECUTE FUNCTION cinerie_score_display_guard();

-- Backfill fail-closed. Hoje nao ha nota preenchida em producao (o gate de
-- render nunca deixou a nota aparecer: `screenScoreSource` nunca e populado por
-- nenhum loader). Ainda assim revogamos: e barato e torna o estado explicito em
-- vez de presumido.
UPDATE "movies" SET "screen_score_display" = false WHERE "screen_score_display" = true;
UPDATE "tv_shows" SET "screen_score_display" = false WHERE "screen_score_display" = true;
