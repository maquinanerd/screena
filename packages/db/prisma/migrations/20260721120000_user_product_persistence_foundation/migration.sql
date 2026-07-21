-- Fundacao de PERSISTENCIA da user platform (Backend C — unidade C7A).
--
-- ESTRITAMENTE ADITIVA. Nao apaga tabela/coluna, nao renomeia, nao recria
-- tabela, nao altera migration antiga, nao roda logica de aplicacao e nao
-- insere dado ficticio. Decisoes e riscos em
-- docs/product/user-product-persistence-decisions.md.
--
-- Fecha os SCHEMA_GAPs registrados em C6B (e o G4 descoberto em C7A):
--   G1 policy_version | G2 fingerprint | G3 expires_at | G4 context (+escopo do
--   indice vigente) | G5 tabela de feedback.

-- ---------------------------------------------------------------------------
-- 1) Enums de recomendacao. Espelham VALOR A VALOR, e na MESMA ORDEM, as unions
--    fechadas do dominio puro (RECOMMENDATION_CONTEXTS,
--    RECOMMENDATION_FEEDBACK_TYPES, FEEDBACK_SOURCES). Nenhum enum duplicado:
--    entity_type reutiliza o "EntityType" ja existente.
-- ---------------------------------------------------------------------------
CREATE TYPE "RecommendationContext" AS ENUM ('discovery', 'continue_watching', 'rewatch', 'similar');

CREATE TYPE "RecommendationFeedbackType" AS ENUM ('not_interested', 'hide', 'already_seen', 'dismiss', 'not_relevant', 'like', 'save');

CREATE TYPE "RecommendationFeedbackSource" AS ENUM ('app', 'system');

-- ---------------------------------------------------------------------------
-- 2) Snapshot de recomendacao: os campos que o dominio usa como PRE-CONDICAO
--    operacional deixam de viver so dentro do JSON `items` e viram COLUNAS.
--
--    Backfill: a tabela e provadamente vazia (nenhum codigo escreve nela; os
--    adapters sao C7B), mas a migration e segura mesmo com dados: os DEFAULTs
--    temporarios usam valores REAIS do dominio ('discovery' e 'reco-v1'),
--    nunca placeholder invalido, e sao REMOVIDOS logo em seguida para que o
--    adapter seja obrigado a escrever explicitamente.
--
--    `fingerprint` fica NULL-avel de proposito: nao ha como recomputar o hash
--    em SQL para linhas legadas, e inventar um valor seria PERIGOSO (um
--    fingerprint falso poderia casar com o desejado e produzir `noop`, servindo
--    recomendacao velha para sempre). NULL = "sem fingerprint"; o adapter DEVE
--    trata-lo como NAO-equivalente (forca replace).
-- ---------------------------------------------------------------------------
ALTER TABLE "user_recommendation_snapshots"
  ADD COLUMN "context"        "RecommendationContext" NOT NULL DEFAULT 'discovery'::"RecommendationContext",
  ADD COLUMN "policy_version" TEXT NOT NULL DEFAULT 'reco-v1',
  ADD COLUMN "fingerprint"    TEXT,
  ADD COLUMN "expires_at"     TIMESTAMP(3);

ALTER TABLE "user_recommendation_snapshots" ALTER COLUMN "context" DROP DEFAULT;
ALTER TABLE "user_recommendation_snapshots" ALTER COLUMN "policy_version" DROP DEFAULT;

ALTER TABLE "user_recommendation_snapshots"
  ADD CONSTRAINT "user_recommendation_snapshots_policy_version_not_blank" CHECK (btrim("policy_version") <> ''),
  ADD CONSTRAINT "user_recommendation_snapshots_fingerprint_not_blank" CHECK ("fingerprint" IS NULL OR btrim("fingerprint") <> ''),
  ADD CONSTRAINT "user_recommendation_snapshots_expires_after_generated" CHECK ("expires_at" IS NULL OR "expires_at" >= "generated_at");

-- ---------------------------------------------------------------------------
-- 3) O snapshot VIGENTE passa a ser por (usuario, CONTEXTO).
--
--    Antes: UNIQUE (user_id) WHERE is_current — so permitia UM vigente por
--    usuario no total, o que INVALIDARIA o snapshot de `discovery` ao publicar
--    o de `continue_watching`. O dominio mantem os 4 contextos independentes.
--
--    A substituicao e ESTRITAMENTE MAIS PERMISSIVA: todo estado que satisfazia
--    o indice antigo satisfaz o novo, logo a troca nao pode falhar nem violar
--    dado existente. Nao e "remocao de indice sem substituicao" — o indice e
--    recriado com o mesmo nome, com escopo corrigido, na mesma migration.
-- ---------------------------------------------------------------------------
DROP INDEX "user_recommendation_snapshots_current_unique";

CREATE UNIQUE INDEX "user_recommendation_snapshots_current_unique"
  ON "user_recommendation_snapshots"("user_id", "context")
  WHERE "is_current" = true;

-- Renovacao: varre os VIGENTES por expiracao (parcial = indice pequeno).
CREATE INDEX "user_recommendation_snapshots_current_expires_at_idx"
  ON "user_recommendation_snapshots"("expires_at")
  WHERE "is_current" = true;

-- Historico/observabilidade por fingerprint. NAO e unico de proposito:
-- snapshots equivalentes ao longo do tempo sao legitimos e devem coexistir.
CREATE INDEX "user_recommendation_snapshots_user_id_context_fingerprint_idx"
  ON "user_recommendation_snapshots"("user_id", "context", "fingerprint");

-- ---------------------------------------------------------------------------
-- 4) Feedback explicito de recomendacao (G5).
--
--    Guarda o MINIMO para o dominio decidir exclusoes derivadas e idempotencia.
--    PROIBIDO por decisao (e travado por teste de governanca): texto livre,
--    corpo de review, PII, nota/rating e estado de moderacao.
--
--    Idempotencia por (user_id, idempotency_key) — MESMO padrao ja usado em
--    user_viewing_events. Usuarios diferentes podem reutilizar a mesma chave.
--    NAO ha coluna de assinatura de conteudo: as proprias colunas
--    (user, entidade, tipo, contexto) reconstroem a pre-imagem e permitem ao
--    adapter detectar `conflict`. `occurred_at` NAO faz parte da identidade
--    idempotente (o dominio o exclui da assinatura de proposito).
-- ---------------------------------------------------------------------------
CREATE TABLE "user_recommendation_feedback" (
  "id"              BIGSERIAL PRIMARY KEY,
  "user_id"         BIGINT NOT NULL,
  "entity_type"     "EntityType" NOT NULL,
  "entity_id"       BIGINT NOT NULL,
  -- NULL = o feedback vale para TODOS os contextos.
  "context"         "RecommendationContext",
  "feedback_type"   "RecommendationFeedbackType" NOT NULL,
  "source"          "RecommendationFeedbackSource" NOT NULL,
  "occurred_at"     TIMESTAMP(3) NOT NULL,
  -- NULL = permanente; timestamp = exclusao TEMPORARIA (dismiss/not_relevant).
  "expires_at"      TIMESTAMP(3),
  "idempotency_key" TEXT NOT NULL,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- O dominio so aceita movie|tv|season|episode (EntityType tem 5 valores).
  CONSTRAINT "user_recommendation_feedback_entity_type_allowed" CHECK ("entity_type" <> 'person'),
  CONSTRAINT "user_recommendation_feedback_idempotency_key_not_blank" CHECK (btrim("idempotency_key") <> ''),
  CONSTRAINT "user_recommendation_feedback_expires_after_occurred" CHECK ("expires_at" IS NULL OR "expires_at" > "occurred_at")
);

CREATE UNIQUE INDEX "user_recommendation_feedback_user_id_idempotency_key_key"
  ON "user_recommendation_feedback"("user_id", "idempotency_key");

CREATE INDEX "user_recommendation_feedback_user_id_entity_type_entity_id_idx"
  ON "user_recommendation_feedback"("user_id", "entity_type", "entity_id");

-- Filtrar/limpar feedback TEMPORARIO ja expirado (parcial: permanentes ficam
-- fora do indice).
CREATE INDEX "user_recommendation_feedback_expires_at_idx"
  ON "user_recommendation_feedback"("expires_at")
  WHERE "expires_at" IS NOT NULL;

-- Feedback e dado pessoal comportamental: some com o usuario (LGPD), igual ao
-- snapshot. A entidade do catalogo e RESTRICT (padrao das tabelas user_*).
ALTER TABLE "user_recommendation_feedback"
  ADD CONSTRAINT "user_recommendation_feedback_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_recommendation_feedback"
  ADD CONSTRAINT "user_recommendation_feedback_entity_fkey"
  FOREIGN KEY ("entity_type", "entity_id") REFERENCES "entities"("entity_type", "entity_id") ON DELETE RESTRICT ON UPDATE CASCADE;
