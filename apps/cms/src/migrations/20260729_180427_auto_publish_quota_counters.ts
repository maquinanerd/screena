import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_autopublish_quota_counters_dimension_type" AS ENUM('global', 'content_type', 'section', 'author', 'article_update');
  CREATE TYPE "public"."enum_autopublish_quota_usage_publication_intent" AS ENUM('publish', 'update');
  CREATE TABLE "autopublish_quota_counters" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"time_zone" varchar NOT NULL,
  	"local_date" varchar NOT NULL,
  	"dimension_type" "enum_autopublish_quota_counters_dimension_type" NOT NULL,
  	"dimension_key" varchar NOT NULL,
  	"current_count" numeric DEFAULT 0 NOT NULL,
  	"limit_snapshot" numeric NOT NULL,
  	"window_start_utc" timestamp(3) with time zone NOT NULL,
  	"window_end_utc" timestamp(3) with time zone NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "autopublish_quota_usage" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"request_id" varchar NOT NULL,
  	"idempotency_key" varchar NOT NULL,
  	"source_cluster_id" varchar NOT NULL,
  	"source_revision" numeric NOT NULL,
  	"article_id" varchar,
  	"public_author_id" varchar NOT NULL,
  	"publication_intent" "enum_autopublish_quota_usage_publication_intent" NOT NULL,
  	"local_date" varchar NOT NULL,
  	"time_zone" varchar NOT NULL,
  	"consumed_at" timestamp(3) with time zone NOT NULL,
  	"service_account_id" varchar NOT NULL,
  	"pipeline_version" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "autopublish_quota_usage_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  ALTER TABLE "articles" ADD COLUMN "automation_contract_name" varchar;
  ALTER TABLE "articles" ADD COLUMN "automation_schema_hash" varchar;
  ALTER TABLE "_articles_v" ADD COLUMN "version_automation_contract_name" varchar;
  ALTER TABLE "_articles_v" ADD COLUMN "version_automation_schema_hash" varchar;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "autopublish_quota_counters_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "autopublish_quota_usage_id" integer;
  ALTER TABLE "autopublish_quota_usage_texts" ADD CONSTRAINT "autopublish_quota_usage_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."autopublish_quota_usage"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "autopublish_quota_counters_updated_at_idx" ON "autopublish_quota_counters" USING btree ("updated_at");
  CREATE INDEX "autopublish_quota_counters_created_at_idx" ON "autopublish_quota_counters" USING btree ("created_at");
  CREATE UNIQUE INDEX "timeZone_localDate_dimensionType_dimensionKey_idx" ON "autopublish_quota_counters" USING btree ("time_zone","local_date","dimension_type","dimension_key");
  CREATE UNIQUE INDEX "autopublish_quota_usage_request_id_idx" ON "autopublish_quota_usage" USING btree ("request_id");
  CREATE INDEX "autopublish_quota_usage_idempotency_key_idx" ON "autopublish_quota_usage" USING btree ("idempotency_key");
  CREATE INDEX "autopublish_quota_usage_article_id_idx" ON "autopublish_quota_usage" USING btree ("article_id");
  CREATE INDEX "autopublish_quota_usage_updated_at_idx" ON "autopublish_quota_usage" USING btree ("updated_at");
  CREATE INDEX "autopublish_quota_usage_created_at_idx" ON "autopublish_quota_usage" USING btree ("created_at");
  CREATE INDEX "autopublish_quota_usage_texts_order_parent" ON "autopublish_quota_usage_texts" USING btree ("order","parent_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_autopublish_quota_counters_fk" FOREIGN KEY ("autopublish_quota_counters_id") REFERENCES "public"."autopublish_quota_counters"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_autopublish_quota_usage_fk" FOREIGN KEY ("autopublish_quota_usage_id") REFERENCES "public"."autopublish_quota_usage"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_autopublish_quota_counters_idx" ON "payload_locked_documents_rels" USING btree ("autopublish_quota_counters_id");
  CREATE INDEX "payload_locked_documents_rels_autopublish_quota_usage_id_idx" ON "payload_locked_documents_rels" USING btree ("autopublish_quota_usage_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "autopublish_quota_counters" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "autopublish_quota_usage" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "autopublish_quota_usage_texts" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "autopublish_quota_counters" CASCADE;
  DROP TABLE "autopublish_quota_usage" CASCADE;
  DROP TABLE "autopublish_quota_usage_texts" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_autopublish_quota_counters_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_autopublish_quota_usage_fk";
  
  DROP INDEX "payload_locked_documents_rels_autopublish_quota_counters_idx";
  DROP INDEX "payload_locked_documents_rels_autopublish_quota_usage_id_idx";
  ALTER TABLE "articles" DROP COLUMN "automation_contract_name";
  ALTER TABLE "articles" DROP COLUMN "automation_schema_hash";
  ALTER TABLE "_articles_v" DROP COLUMN "version_automation_contract_name";
  ALTER TABLE "_articles_v" DROP COLUMN "version_automation_schema_hash";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "autopublish_quota_counters_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "autopublish_quota_usage_id";
  DROP TYPE "public"."enum_autopublish_quota_counters_dimension_type";
  DROP TYPE "public"."enum_autopublish_quota_usage_publication_intent";`)
}
