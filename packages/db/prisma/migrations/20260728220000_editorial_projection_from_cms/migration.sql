-- Projecao editorial: do CMS (Payload) para o banco publico.
--
-- ADITIVA. Nenhuma coluna existente muda de tipo, ganha NOT NULL ou some.
-- Nenhuma linha existente e reescrita. Um deploy que aplique esta migration e
-- pare aqui deixa o site publico exatamente como estava — o corpo em texto
-- (`article_translations.body`) continua sendo a fonte de todas as superficies.
--
-- 100% ASCII de proposito: caractere acentuado gravado em WIN1252 ja quebrou
-- deploy neste repositorio.

-- 1) Ancora do artigo publico no documento do CMS.
--
-- UNIQUE e o ponto central: dois artigos publicos nunca podem apontar para o
-- mesmo documento de origem, senao uma reprojecao criaria duplicata em vez de
-- atualizar. NULL nao colide em UNIQUE do PostgreSQL, entao os artigos legados
-- (nenhum veio do Payload) convivem sem conflito.
ALTER TABLE "articles" ADD COLUMN "payload_document_id" TEXT;
ALTER TABLE "articles" ADD COLUMN "projected_sequence" INTEGER;

CREATE UNIQUE INDEX "articles_payload_document_id_key"
  ON "articles"("payload_document_id");

-- `payload_document_id` vazio seria um "documento" inexistente que ainda assim
-- ocuparia o unico slot da chave unica. Proibido explicitamente.
ALTER TABLE "articles" ADD CONSTRAINT "articles_payload_document_id_not_empty"
  CHECK ("payload_document_id" IS NULL OR "payload_document_id" <> '');

-- Sequencia de emissao e o id serial da linha na outbox do CMS: comeca em 1.
--
-- NAO confundir com o `aggregate_version` da outbox, que guarda um HASH do
-- conteudo publicado e portanto nao ordena nada.
ALTER TABLE "articles" ADD CONSTRAINT "articles_projected_sequence_positive"
  CHECK ("projected_sequence" IS NULL OR "projected_sequence" > 0);

-- 2) Corpo ESTRUTURADO por traducao (blocos do contrato editorial).
ALTER TABLE "article_translations" ADD COLUMN "body_blocks" JSONB;
ALTER TABLE "article_translations" ADD COLUMN "body_blocks_version" TEXT;

-- Blocos precisam ser uma LISTA. Um objeto solto ou uma string aqui quebraria
-- todo consumidor que iterar a coluna; melhor recusar na escrita.
ALTER TABLE "article_translations"
  ADD CONSTRAINT "article_translations_body_blocks_is_array"
  CHECK ("body_blocks" IS NULL OR jsonb_typeof("body_blocks") = 'array');

-- Versao sem blocos (ou blocos sem versao) e um estado que ninguem sabe
-- interpretar: ou o par existe inteiro, ou nao existe.
ALTER TABLE "article_translations"
  ADD CONSTRAINT "article_translations_body_blocks_version_paired"
  CHECK (
    ("body_blocks" IS NULL AND "body_blocks_version" IS NULL)
    OR ("body_blocks" IS NOT NULL AND "body_blocks_version" IS NOT NULL)
  );

-- 3) Recibo de projecao: a trava de idempotencia do consumidor da outbox.
CREATE TYPE "EditorialProjectionOutcome" AS ENUM (
  'applied',
  'skipped_duplicate',
  'skipped_stale',
  'skipped_unlicensed'
);

CREATE TABLE "editorial_projection_receipts" (
  "id" BIGSERIAL NOT NULL,
  "event_id" TEXT NOT NULL,
  "idempotency_key" TEXT,
  "event_type" TEXT NOT NULL,
  "aggregate_id" TEXT NOT NULL,
  "emission_sequence" INTEGER NOT NULL,
  "article_id" BIGINT,
  "content_version" TEXT,
  "outcome" "EditorialProjectionOutcome" NOT NULL,
  "worker_id" TEXT NOT NULL,
  "projected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "editorial_projection_receipts_pkey" PRIMARY KEY ("id")
);

-- A trava de replay. O worker grava o recibo na MESMA transacao da projecao:
-- um evento reentregue colide aqui e a transacao inteira e descartada, em vez
-- de aplicar a projecao duas vezes.
CREATE UNIQUE INDEX "editorial_projection_receipts_event_id_key"
  ON "editorial_projection_receipts"("event_id");

CREATE INDEX "editorial_projection_receipts_aggregate_id_emission_sequence_idx"
  ON "editorial_projection_receipts"("aggregate_id", "emission_sequence");

CREATE INDEX "editorial_projection_receipts_projected_at_idx"
  ON "editorial_projection_receipts"("projected_at");

CREATE INDEX "editorial_projection_receipts_article_id_idx"
  ON "editorial_projection_receipts"("article_id");

-- ON DELETE SET NULL: apagar um artigo nao pode apagar a prova de que ele foi
-- publicado um dia. O recibo e trilha de auditoria.
ALTER TABLE "editorial_projection_receipts"
  ADD CONSTRAINT "editorial_projection_receipts_article_id_fkey"
  FOREIGN KEY ("article_id") REFERENCES "articles"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "editorial_projection_receipts"
  ADD CONSTRAINT "editorial_projection_receipts_event_id_not_empty"
  CHECK ("event_id" <> '');

ALTER TABLE "editorial_projection_receipts"
  ADD CONSTRAINT "editorial_projection_receipts_emission_sequence_positive"
  CHECK ("emission_sequence" > 0);
