-- entity_awards - o FATO DE PREMIACAO de um titulo, promovido de api_cache.
--
-- 100% ASCII de proposito: migration com byte fora de ASCII ja quebrou deploy
-- neste repositorio (o cluster de producao nao sobe em WIN1252).
--
-- O QUE ESTA MIGRATION CRIA
--   1. a tabela `entity_awards` (bruto + parseado + governanca);
--   2. `entity_award_payload_fingerprint_v1(...)` - o hash aprovado, computado
--      NO BANCO e nunca reimplementado em TypeScript;
--   3. `entity_awards_display_guard_trg` - a trava fail-closed de exibicao.
--
-- POR QUE UM GUARD PROPRIO, E NAO REUSO DO DE RATINGS: premio nao e nota. O
-- guard de `external_ratings` exige score_type classificado e score_allowed na
-- licenca - duas condicoes que nao querem dizer nada sobre premiacao, e que
-- fariam a faixa depender de permissao para exibir NUMERO DE NOTA. Este guard
-- exige o que de fato governa um fato editorial: fonte nomeada, licenca vigente
-- que permita exibir, credito presente e decisao `awards_display` viva.
--
-- ESTADO NO DIA DESTA MIGRATION: nao existe licenca de premiacao registrada
-- (a fonte editorial do campo `Awards` da OMDb nao foi determinada - ver
-- docs/legal/omdb-awards-source-provenance.md). Logo toda linha nasce com
-- display_allowed=false e o guard nunca chega a ser exercitado em producao ate
-- que a decisao exista. Isso e o comportamento correto, nao um bug.

-- ------------------------------------------------------------------
-- 1. Tabela
-- ------------------------------------------------------------------
CREATE TABLE "entity_awards" (
  "id"                       BIGSERIAL NOT NULL,
  "entity_type"              "EntityType" NOT NULL,
  "entity_id"                BIGINT NOT NULL,

  -- O literal integral da fonte. O parseado pode ser refeito a partir dele sem
  -- gastar uma chamada nova quando o formato do upstream mudar.
  "awards_raw"               TEXT NOT NULL,
  "outcome"                  TEXT,
  "highlight_count"          INT,
  "award_name"               TEXT,
  "wins"                     INT,
  "nominations"              INT,

  -- Fornecedor TECNICO (invariante 2): nunca a fonte editorial.
  "provider_api"             TEXT NOT NULL,
  "provider_payload_hash"    TEXT,
  "fetched_at"               TIMESTAMP(3),

  -- Governanca de exibicao.
  "source_key"               TEXT,
  "attribution_text"         TEXT,
  "attribution_url"          TEXT,
  "requires_attribution"     BOOLEAN NOT NULL DEFAULT true,
  "requires_linkback"        BOOLEAN NOT NULL DEFAULT true,
  "license_status"           "LicenseStatus" NOT NULL DEFAULT 'unknown',
  "display_allowed"          BOOLEAN NOT NULL DEFAULT false,
  "approved_payload_hash"    TEXT,
  "data_usage_decision_id"   BIGINT,

  "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMP(3) NOT NULL,

  CONSTRAINT "entity_awards_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "entity_awards"
  ADD CONSTRAINT "entity_awards_provider_api_fkey"
    FOREIGN KEY ("provider_api") REFERENCES "api_providers"("key")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "entity_awards_data_usage_decision_id_fkey"
    FOREIGN KEY ("data_usage_decision_id") REFERENCES "data_usage_decisions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Titulo sem premio NAO vira linha. Uma linha com frase vazia afirmaria
-- "premiacao conhecida e vazia", que nao e o que a fonte disse.
ALTER TABLE "entity_awards"
  ADD CONSTRAINT "entity_awards_raw_not_blank" CHECK (btrim("awards_raw") <> ''),
  -- Vocabulario fechado do desfecho. Um terceiro valor seria uma frase que o
  -- reconhecedor nao sabe escrever na tela.
  ADD CONSTRAINT "entity_awards_outcome_vocabulary"
    CHECK ("outcome" IS NULL OR "outcome" IN ('won', 'nominated')),
  -- Destaque e tudo-ou-nada: desfecho sem contagem/nome (ou o contrario) e meia
  -- frase, e meia frase vira texto quebrado na faixa.
  ADD CONSTRAINT "entity_awards_highlight_complete"
    CHECK (
      ("outcome" IS NULL AND "highlight_count" IS NULL AND "award_name" IS NULL)
      OR ("outcome" IS NOT NULL AND "highlight_count" IS NOT NULL AND "award_name" IS NOT NULL
          AND btrim("award_name") <> '')
    ),
  -- Contagem negativa nao existe; ZERO tambem nao e escrito pela fonte (ela
  -- omite o trecho). Aceitar zero abriria caminho para "0 vitorias" na tela,
  -- que e uma afirmacao sobre o mundo que ninguem fez.
  ADD CONSTRAINT "entity_awards_counts_positive"
    CHECK (
      ("highlight_count" IS NULL OR "highlight_count" > 0)
      AND ("wins" IS NULL OR "wins" > 0)
      AND ("nominations" IS NULL OR "nominations" > 0)
    ),
  -- Uma linha sem destaque E sem contagem nao diz nada.
  ADD CONSTRAINT "entity_awards_has_content"
    CHECK ("outcome" IS NOT NULL OR "wins" IS NOT NULL OR "nominations" IS NOT NULL);

-- Um titulo tem UMA frase de premiacao por fornecedor tecnico. Sem este unique,
-- cada execucao do worker empilharia uma linha nova e a tela escolheria uma
-- delas por acaso.
-- Nomes na convencao do Prisma (`<tabela>_<colunas>_key` / `_idx`): um nome
-- proprio aqui vira drift permanente em `prisma migrate diff`.
CREATE UNIQUE INDEX "entity_awards_entity_type_entity_id_provider_api_key"
  ON "entity_awards"("entity_type", "entity_id", "provider_api");
CREATE INDEX "entity_awards_entity_type_entity_id_idx"
  ON "entity_awards"("entity_type", "entity_id");
CREATE INDEX "entity_awards_provider_api_idx" ON "entity_awards"("provider_api");
CREATE INDEX "entity_awards_source_key_idx" ON "entity_awards"("source_key");
CREATE INDEX "entity_awards_display_allowed_idx" ON "entity_awards"("display_allowed");
CREATE INDEX "entity_awards_data_usage_decision_id_idx"
  ON "entity_awards"("data_usage_decision_id");

-- ------------------------------------------------------------------
-- 2. Fingerprint do payload aprovado
-- ------------------------------------------------------------------
-- Mesmo contrato do fingerprint de ratings: cobre o FATO e o CREDITO. Se a
-- frase mudar, ou se a atribuicao sumir, o hash aprovado deixa de bater e o
-- guard derruba a exibicao. "Mudanca revoga" - nao existe caminho em que uma
-- frase nova herde a aprovacao da frase velha.
--
-- chr(31) e o separador de unidade (US). Escrito como chamada de funcao e nao
-- como byte cru: byte de controle literal em fonte ja quebrou guard neste repo.
CREATE OR REPLACE FUNCTION entity_award_payload_fingerprint_v1(
  p_entity_type "EntityType",
  p_entity_id BIGINT,
  p_provider_api TEXT,
  p_awards_raw TEXT,
  p_outcome TEXT,
  p_highlight_count INT,
  p_award_name TEXT,
  p_wins INT,
  p_nominations INT,
  p_source_key TEXT,
  p_license_status "LicenseStatus",
  p_requires_attribution BOOLEAN,
  p_requires_linkback BOOLEAN,
  p_attribution_text TEXT,
  p_attribution_url TEXT
) RETURNS TEXT AS $$
  SELECT encode(public.digest(
    'eap:v1' || chr(31) ||
    p_entity_type::text || chr(31) ||
    p_entity_id::text || chr(31) ||
    lower(btrim(p_provider_api)) || chr(31) ||
    btrim(p_awards_raw) || chr(31) ||
    COALESCE(p_outcome, '') || chr(31) ||
    COALESCE(p_highlight_count::text, '') || chr(31) ||
    -- O nome do premio entra COM a caixa original: "Oscars" e "oscars" nao sao
    -- a mesma escrita, e a faixa exibe a da fonte.
    COALESCE(btrim(p_award_name), '') || chr(31) ||
    COALESCE(p_wins::text, '') || chr(31) ||
    COALESCE(p_nominations::text, '') || chr(31) ||
    COALESCE(lower(btrim(p_source_key)), '') || chr(31) ||
    p_license_status::text || chr(31) ||
    p_requires_attribution::text || chr(31) ||
    p_requires_linkback::text || chr(31) ||
    COALESCE(p_attribution_text, '') || chr(31) ||
    COALESCE(p_attribution_url, '')
  , 'sha256'::text), 'hex');
$$ LANGUAGE sql IMMUTABLE;

-- ------------------------------------------------------------------
-- 3. Guard de EXIBICAO (fail-closed permanente)
-- ------------------------------------------------------------------
-- Depois desta migration e IMPOSSIVEL - por qualquer caminho, inclusive psql e
-- seed - ter uma faixa de premios publica sem: fonte editorial NOMEADA, hash do
-- payload aprovado batendo com o payload atual, licenca vigente que permita
-- exibir, credito exigido presente e decisao `awards_display` viva sob AQUELA
-- licenca.
CREATE OR REPLACE FUNCTION entity_awards_display_guard() RETURNS trigger AS $$
DECLARE
  decision "data_usage_decisions"%ROWTYPE;
  license  "source_licenses"%ROWTYPE;
BEGIN
  IF NEW."display_allowed" THEN
    -- A fonte do fato. Este e o gate da decisao pendente: enquanto ninguem
    -- decidir de quem e o credito, source_key e NULL e a faixa nao acende.
    IF NEW."source_key" IS NULL OR btrim(NEW."source_key") = '' THEN
      RAISE EXCEPTION 'entity_awards fail-closed: source_key obrigatorio para display_allowed (a fonte editorial do fato de premiacao nao foi decidida - ver docs/legal/omdb-awards-source-provenance.md)';
    END IF;

    -- POR QUE NAO HA CHECK `source_key <> provider_api` AQUI.
    --
    -- A invariante 2 (`provider_api` nunca e `rating_source`) existe porque uma
    -- NOTA e uma opiniao: 8,5/10 pertence a quem julgou, e colapsar o
    -- transportador com o autor do juizo seria mentira. Por isso IMDb, Rotten
    -- Tomatoes e Metacritic sao creditados separadamente mesmo chegando todos
    -- pela OMDb, e por isso o guard de `external_ratings` recusa a igualdade -
    -- ele continua exatamente como estava.
    --
    -- Um PREMIO nao e opiniao: e fato publico. "Venceu 4 Oscars" e verdade
    -- independentemente de quem conta, e quem premiou foi a Academia. Nao ha
    -- autoria editorial a proteger, entao a pergunta "de quem e esse juizo?" nao
    -- se aplica; sobra "quem entregou o dado?", que tem resposta unica e
    -- verificavel. Creditar o transportador aqui descreve o que aconteceu - o
    -- verbo do credito e "fornecidos por", nao "apurados por".
    --
    -- A trava real continua sendo a de baixo: `source_key` tem de casar com uma
    -- LICENCA vigente que carregue uma decisao `awards_display`. Escrever
    -- `source_key` a mao sem licenca nao passa.
    -- Decisao do proprietario, 2026-08-13: docs/legal/omdb-awards-source-provenance.md.

    IF NEW."approved_payload_hash" IS NULL
       OR NEW."approved_payload_hash" <> entity_award_payload_fingerprint_v1(
            NEW."entity_type", NEW."entity_id", NEW."provider_api", NEW."awards_raw",
            NEW."outcome", NEW."highlight_count", NEW."award_name",
            NEW."wins", NEW."nominations", NEW."source_key", NEW."license_status",
            NEW."requires_attribution", NEW."requires_linkback",
            NEW."attribution_text", NEW."attribution_url")
    THEN
      RAISE EXCEPTION 'entity_awards fail-closed: approved_payload_hash ausente ou != fingerprint do payload atual (a frase ou o credito mudaram apos a aprovacao?)';
    END IF;

    IF NEW."license_status" NOT IN ('official', 'licensed', 'third_party') THEN
      RAISE EXCEPTION 'entity_awards fail-closed: license_status % nao permite exibicao', NEW."license_status";
    END IF;

    IF NEW."requires_attribution" AND (NEW."attribution_text" IS NULL OR btrim(NEW."attribution_text") = '') THEN
      RAISE EXCEPTION 'entity_awards fail-closed: attribution_text exigido ausente';
    END IF;

    IF NEW."requires_linkback" AND (NEW."attribution_url" IS NULL OR btrim(NEW."attribution_url") = '') THEN
      RAISE EXCEPTION 'entity_awards fail-closed: attribution_url (linkback) exigido ausente';
    END IF;

    -- Decisao de uso vigente e valida.
    IF NEW."data_usage_decision_id" IS NULL THEN
      RAISE EXCEPTION 'entity_awards fail-closed: data_usage_decision_id obrigatorio para display_allowed';
    END IF;
    SELECT * INTO decision FROM "data_usage_decisions" WHERE "id" = NEW."data_usage_decision_id";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'entity_awards fail-closed: data_usage_decision_id % inexistente', NEW."data_usage_decision_id";
    END IF;
    -- O use_case e checado AQUI (o guard de ratings confia no adapter). Sem
    -- isto, uma decisao de rating_display autorizaria exibir premiacao de
    -- carona - o eixo use_case existe justamente para impedir isso.
    IF decision."use_case" <> 'awards_display' THEN
      RAISE EXCEPTION 'entity_awards fail-closed: decisao % e de use_case % - so awards_display autoriza a faixa de premios', decision."id", decision."use_case";
    END IF;
    IF NOT decision."is_current" THEN
      RAISE EXCEPTION 'entity_awards fail-closed: decisao % nao e a vigente', decision."id";
    END IF;
    IF decision."stage" <> 'approved_for_display' OR NOT decision."display_allowed" THEN
      RAISE EXCEPTION 'entity_awards fail-closed: decisao % (stage=%) nao autoriza exibicao', decision."id", decision."stage";
    END IF;
    IF decision."valid_from" > CURRENT_TIMESTAMP
       OR (decision."valid_until" IS NOT NULL AND decision."valid_until" <= CURRENT_TIMESTAMP) THEN
      RAISE EXCEPTION 'entity_awards fail-closed: decisao % fora da vigencia', decision."id";
    END IF;

    -- A decisao tem de pertencer a licenca DESTA fonte. Sem isto, uma decisao
    -- de premiacao de uma fonte autorizaria exibir credito de outra.
    SELECT * INTO license FROM "source_licenses" WHERE "id" = decision."source_license_id";
    IF NOT FOUND
       OR lower(btrim(license."source_key")) IS DISTINCT FROM lower(btrim(NEW."source_key")) THEN
      RAISE EXCEPTION 'entity_awards fail-closed: decisao % nao pertence a licenca da fonte %', decision."id", NEW."source_key";
    END IF;

    -- A LICENCA-MAE continua sendo a autoridade: supersedi-la derruba a faixa,
    -- mesmo sem nenhum write na linha de premiacao.
    IF NOT license."is_current" THEN
      RAISE EXCEPTION 'entity_awards fail-closed: licenca % da decisao foi supersedida (is_current=false)', license."id";
    END IF;
    IF license."license_status" NOT IN ('official', 'licensed', 'third_party') THEN
      RAISE EXCEPTION 'entity_awards fail-closed: licenca % com license_status % nao permite exibicao', license."id", license."license_status";
    END IF;
    IF NOT license."display_allowed" THEN
      RAISE EXCEPTION 'entity_awards fail-closed: licenca % nao permite exibicao (display_allowed=false)', license."id";
    END IF;
    -- score_allowed NAO e checado aqui, de proposito: ele governa o NUMERO DA
    -- NOTA (regra de ratings secao 5). Premio nao tem nota, e exigi-lo faria a
    -- faixa depender de uma permissao que nao diz respeito a ela.
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "entity_awards_display_guard_trg"
  BEFORE INSERT OR UPDATE ON "entity_awards"
  FOR EACH ROW EXECUTE FUNCTION entity_awards_display_guard();
