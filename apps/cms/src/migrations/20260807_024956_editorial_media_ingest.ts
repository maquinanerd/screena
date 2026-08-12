import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Ingestao de midia editorial por maquina.
 *
 * DUAS mudancas, e so elas:
 *  1. escopo `editorial_media_ingest` no enum de service account;
 *  2. `media.ingested_for_article_id` — metade da chave de idempotencia
 *     (a outra metade e `media.source_url`, que ja existia).
 *
 * O `ON DELETE set null` e deliberado: apagar a materia nao pode apagar a foto
 * do acervo, que pode estar em uso em outra parte. O que se perde e a chave de
 * idempotencia daquela entrada — e sem materia nao ha reenvio para casar.
 *
 * DESVIO DE CARONA REMOVIDO A MAO (leia antes de mexer). O
 * `payload migrate:create` gerou, junto, tres mudancas que NAO sao desta fase:
 *
 *   CREATE TYPE "enum_articles_language" / "enum__articles_v_version_language"
 *   ALTER TABLE "articles" ALTER COLUMN "language" ... USING ...::enum
 *   ALTER TABLE "articles_blocks_heading" ALTER COLUMN "level" SET DEFAULT '2'
 *
 * Sao desvio PRE-EXISTENTE entre a config do Payload e a cadeia de migrations:
 * `articles.language` e `varchar` no banco e `select` na config. Converter tipo
 * de coluna em producao de carona numa PR de midia seria mudanca de schema fora
 * de tarefa aprovada para banco — e a conversao FALHA se alguma linha tiver
 * valor fora de ('pt-BR','en','es').
 *
 * O SQL foi cortado E o `.json` foi refeito a partir do snapshot anterior,
 * recebendo SO as duas mudancas acima. Isso importa: trimar o SQL deixando o
 * `.json` afirmar que o desvio foi aplicado o esconderia PARA SEMPRE — o
 * proximo `migrate:create` compararia com um snapshot mentiroso e nunca mais
 * emitiria aquelas linhas. Do jeito que ficou, o proximo `migrate:create`
 * REEMITE o desvio, que e como ele deve continuar aparecendo ate alguem trata-lo
 * numa migration propria, com decisao humana e verificacao dos dados.
 *
 * FECHADO em `20260811_221529_articles_language_enum` — a migration propria que
 * este paragrafo pedia, gerada inteira pelo tool (`.ts` + `.json` da MESMA
 * geracao, zero corte a mao) com uma guarda de dados por cima. Nao ha mais
 * desvio a reemitir: `migrate:create` numa arvore limpa responde "No schema
 * changes detected" e nao cria arquivo. O corte a mao descrito acima continua
 * valendo como registro do que foi feito AQUI.
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_service_accounts_scopes" ADD VALUE 'editorial_media_ingest';
  ALTER TABLE "media" ADD COLUMN "ingested_for_article_id" integer;
  ALTER TABLE "media" ADD CONSTRAINT "media_ingested_for_article_id_articles_id_fk" FOREIGN KEY ("ingested_for_article_id") REFERENCES "public"."articles"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "media_ingested_for_article_idx" ON "media" USING btree ("ingested_for_article_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "media" DROP CONSTRAINT "media_ingested_for_article_id_articles_id_fk";
  DROP INDEX "media_ingested_for_article_idx";
  ALTER TABLE "media" DROP COLUMN "ingested_for_article_id";
  ALTER TABLE "service_accounts_scopes" ALTER COLUMN "value" SET DATA TYPE text;
  DROP TYPE "public"."enum_service_accounts_scopes";
  CREATE TYPE "public"."enum_service_accounts_scopes" AS ENUM('draft_ingest', 'publication_projection', 'editorial_auto_publish');
  ALTER TABLE "service_accounts_scopes" ALTER COLUMN "value" SET DATA TYPE "public"."enum_service_accounts_scopes" USING "value"::"public"."enum_service_accounts_scopes";`)
}
