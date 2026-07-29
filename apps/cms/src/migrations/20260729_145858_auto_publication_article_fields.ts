import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_articles_automation_attribution_mode" AS ENUM('byline', 'newsroom', 'assisted');
  CREATE TYPE "public"."enum_articles_schema_type_recommendation" AS ENUM('NewsArticle', 'Article', 'Review', 'ItemList', 'HowTo');
  CREATE TYPE "public"."enum__articles_v_version_automation_attribution_mode" AS ENUM('byline', 'newsroom', 'assisted');
  CREATE TYPE "public"."enum__articles_v_version_schema_type_recommendation" AS ENUM('NewsArticle', 'Article', 'Review', 'ItemList', 'HowTo');
  ALTER TABLE "articles" ADD COLUMN "auto_published" boolean DEFAULT false;
  ALTER TABLE "articles" ADD COLUMN "automation_actor_id" varchar;
  ALTER TABLE "articles" ADD COLUMN "automation_idempotency_key" varchar;
  ALTER TABLE "articles" ADD COLUMN "automation_source_revision" numeric;
  ALTER TABLE "articles" ADD COLUMN "automation_payload_hash" varchar;
  ALTER TABLE "articles" ADD COLUMN "automation_pipeline_version" varchar;
  ALTER TABLE "articles" ADD COLUMN "automation_contract_version" varchar;
  ALTER TABLE "articles" ADD COLUMN "automation_contract_hash" varchar;
  ALTER TABLE "articles" ADD COLUMN "automation_attribution_mode" "enum_articles_automation_attribution_mode";
  ALTER TABLE "articles" ADD COLUMN "focus_keyphrase" varchar;
  ALTER TABLE "articles" ADD COLUMN "schema_type_recommendation" "enum_articles_schema_type_recommendation";
  ALTER TABLE "articles" ADD COLUMN "article_section" varchar;
  ALTER TABLE "_articles_v" ADD COLUMN "version_auto_published" boolean DEFAULT false;
  ALTER TABLE "_articles_v" ADD COLUMN "version_automation_actor_id" varchar;
  ALTER TABLE "_articles_v" ADD COLUMN "version_automation_idempotency_key" varchar;
  ALTER TABLE "_articles_v" ADD COLUMN "version_automation_source_revision" numeric;
  ALTER TABLE "_articles_v" ADD COLUMN "version_automation_payload_hash" varchar;
  ALTER TABLE "_articles_v" ADD COLUMN "version_automation_pipeline_version" varchar;
  ALTER TABLE "_articles_v" ADD COLUMN "version_automation_contract_version" varchar;
  ALTER TABLE "_articles_v" ADD COLUMN "version_automation_contract_hash" varchar;
  ALTER TABLE "_articles_v" ADD COLUMN "version_automation_attribution_mode" "enum__articles_v_version_automation_attribution_mode";
  ALTER TABLE "_articles_v" ADD COLUMN "version_focus_keyphrase" varchar;
  ALTER TABLE "_articles_v" ADD COLUMN "version_schema_type_recommendation" "enum__articles_v_version_schema_type_recommendation";
  ALTER TABLE "_articles_v" ADD COLUMN "version_article_section" varchar;
  CREATE INDEX "articles_automation_idempotency_key_idx" ON "articles" USING btree ("automation_idempotency_key");
  CREATE INDEX "_articles_v_version_version_automation_idempotency_key_idx" ON "_articles_v" USING btree ("version_automation_idempotency_key");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "articles_automation_idempotency_key_idx";
  DROP INDEX "_articles_v_version_version_automation_idempotency_key_idx";
  ALTER TABLE "articles" DROP COLUMN "auto_published";
  ALTER TABLE "articles" DROP COLUMN "automation_actor_id";
  ALTER TABLE "articles" DROP COLUMN "automation_idempotency_key";
  ALTER TABLE "articles" DROP COLUMN "automation_source_revision";
  ALTER TABLE "articles" DROP COLUMN "automation_payload_hash";
  ALTER TABLE "articles" DROP COLUMN "automation_pipeline_version";
  ALTER TABLE "articles" DROP COLUMN "automation_contract_version";
  ALTER TABLE "articles" DROP COLUMN "automation_contract_hash";
  ALTER TABLE "articles" DROP COLUMN "automation_attribution_mode";
  ALTER TABLE "articles" DROP COLUMN "focus_keyphrase";
  ALTER TABLE "articles" DROP COLUMN "schema_type_recommendation";
  ALTER TABLE "articles" DROP COLUMN "article_section";
  ALTER TABLE "_articles_v" DROP COLUMN "version_auto_published";
  ALTER TABLE "_articles_v" DROP COLUMN "version_automation_actor_id";
  ALTER TABLE "_articles_v" DROP COLUMN "version_automation_idempotency_key";
  ALTER TABLE "_articles_v" DROP COLUMN "version_automation_source_revision";
  ALTER TABLE "_articles_v" DROP COLUMN "version_automation_payload_hash";
  ALTER TABLE "_articles_v" DROP COLUMN "version_automation_pipeline_version";
  ALTER TABLE "_articles_v" DROP COLUMN "version_automation_contract_version";
  ALTER TABLE "_articles_v" DROP COLUMN "version_automation_contract_hash";
  ALTER TABLE "_articles_v" DROP COLUMN "version_automation_attribution_mode";
  ALTER TABLE "_articles_v" DROP COLUMN "version_focus_keyphrase";
  ALTER TABLE "_articles_v" DROP COLUMN "version_schema_type_recommendation";
  ALTER TABLE "_articles_v" DROP COLUMN "version_article_section";
  DROP TYPE "public"."enum_articles_automation_attribution_mode";
  DROP TYPE "public"."enum_articles_schema_type_recommendation";
  DROP TYPE "public"."enum__articles_v_version_automation_attribution_mode";
  DROP TYPE "public"."enum__articles_v_version_schema_type_recommendation";`)
}
