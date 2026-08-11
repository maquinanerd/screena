import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * `entityReferences.verificationSource` — PROVENIENCIA da marcacao de verificado.
 *
 * Coluna nova (e o enum de um valor so) nas duas tabelas do array: a corrente e
 * a de versoes. Nada e reescrito: as linhas existentes ficam com `NULL`, e
 * `NULL` com `verified = true` significa exatamente o que significava antes do
 * ADR 0019 — marcacao HUMANA, a unica que existia. Nao ha backfill a fazer.
 *
 * ESTE ARQUIVO FOI APARADO A MAO, e o `.json` ao lado tambem. O `migrate:create`
 * gerou junto um desvio PRE-EXISTENTE, alheio a esta mudanca:
 * `articles.language` (e `_articles_v.version_language`) de `varchar` para enum,
 * mais o default de `articles_blocks_heading.level`. Medido com um controle: com
 * a mudanca desta PR revertida, `migrate:create` produz aquele desvio SOZINHO.
 *
 * As duas partes foram removidas daqui — do SQL **e** do snapshot. Manter o
 * snapshot gerado enquanto se apara so o SQL e o pior dos mundos: a proxima
 * pessoa a rodar `migrate:create` nao veria mais o desvio, porque o snapshot ja
 * o declararia aplicado. Ele continua visivel, e continua sendo trabalho de
 * outra PR — que precisa decidir o que fazer com uma linha cujo `language`
 * esteja fora de ('pt-BR','en','es') antes de castar a coluna.
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_articles_entity_references_verification_source" AS ENUM('automation_confidence');
  CREATE TYPE "public"."enum__articles_v_version_entity_references_verification_source" AS ENUM('automation_confidence');
  ALTER TABLE "articles_entity_references" ADD COLUMN "verification_source" "enum_articles_entity_references_verification_source";
  ALTER TABLE "_articles_v_version_entity_references" ADD COLUMN "verification_source" "enum__articles_v_version_entity_references_verification_source";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "articles_entity_references" DROP COLUMN "verification_source";
  ALTER TABLE "_articles_v_version_entity_references" DROP COLUMN "verification_source";
  DROP TYPE "public"."enum_articles_entity_references_verification_source";
  DROP TYPE "public"."enum__articles_v_version_entity_references_verification_source";`)
}
