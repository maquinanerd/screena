import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_authors_allowed_automation_content_types" AS ENUM('news', 'feature', 'guide', 'list', 'interview', 'evergreen');
  CREATE TYPE "public"."enum_authors_automation_attribution_modes" AS ENUM('byline', 'newsroom', 'assisted');
  CREATE TYPE "public"."enum__authors_v_version_allowed_automation_content_types" AS ENUM('news', 'feature', 'guide', 'list', 'interview', 'evergreen');
  CREATE TYPE "public"."enum__authors_v_version_automation_attribution_modes" AS ENUM('byline', 'newsroom', 'assisted');
  ALTER TYPE "public"."enum_service_accounts_scopes" ADD VALUE 'editorial_auto_publish';
  CREATE TABLE "authors_allowed_automation_content_types" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum_authors_allowed_automation_content_types",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "authors_automation_attribution_modes" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum_authors_automation_attribution_modes",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "_authors_v_version_allowed_automation_content_types" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum__authors_v_version_allowed_automation_content_types",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "_authors_v_version_automation_attribution_modes" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum__authors_v_version_automation_attribution_modes",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  ALTER TABLE "authors" ADD COLUMN "automation_publishing_allowed" boolean DEFAULT false;
  ALTER TABLE "authors" ADD COLUMN "automation_daily_limit" numeric;
  ALTER TABLE "_authors_v" ADD COLUMN "version_automation_publishing_allowed" boolean DEFAULT false;
  ALTER TABLE "_authors_v" ADD COLUMN "version_automation_daily_limit" numeric;
  ALTER TABLE "authors_allowed_automation_content_types" ADD CONSTRAINT "authors_allowed_automation_content_types_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."authors"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "authors_automation_attribution_modes" ADD CONSTRAINT "authors_automation_attribution_modes_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."authors"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_authors_v_version_allowed_automation_content_types" ADD CONSTRAINT "_authors_v_version_allowed_automation_content_types_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_authors_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_authors_v_version_automation_attribution_modes" ADD CONSTRAINT "_authors_v_version_automation_attribution_modes_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_authors_v"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "authors_allowed_automation_content_types_order_idx" ON "authors_allowed_automation_content_types" USING btree ("order");
  CREATE INDEX "authors_allowed_automation_content_types_parent_idx" ON "authors_allowed_automation_content_types" USING btree ("parent_id");
  CREATE INDEX "authors_automation_attribution_modes_order_idx" ON "authors_automation_attribution_modes" USING btree ("order");
  CREATE INDEX "authors_automation_attribution_modes_parent_idx" ON "authors_automation_attribution_modes" USING btree ("parent_id");
  CREATE INDEX "_authors_v_version_allowed_automation_content_types_order_idx" ON "_authors_v_version_allowed_automation_content_types" USING btree ("order");
  CREATE INDEX "_authors_v_version_allowed_automation_content_types_parent_idx" ON "_authors_v_version_allowed_automation_content_types" USING btree ("parent_id");
  CREATE INDEX "_authors_v_version_automation_attribution_modes_order_idx" ON "_authors_v_version_automation_attribution_modes" USING btree ("order");
  CREATE INDEX "_authors_v_version_automation_attribution_modes_parent_idx" ON "_authors_v_version_automation_attribution_modes" USING btree ("parent_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "authors_allowed_automation_content_types" CASCADE;
  DROP TABLE "authors_automation_attribution_modes" CASCADE;
  DROP TABLE "_authors_v_version_allowed_automation_content_types" CASCADE;
  DROP TABLE "_authors_v_version_automation_attribution_modes" CASCADE;
  ALTER TABLE "service_accounts_scopes" ALTER COLUMN "value" SET DATA TYPE text;
  DROP TYPE "public"."enum_service_accounts_scopes";
  CREATE TYPE "public"."enum_service_accounts_scopes" AS ENUM('draft_ingest', 'publication_projection');
  ALTER TABLE "service_accounts_scopes" ALTER COLUMN "value" SET DATA TYPE "public"."enum_service_accounts_scopes" USING "value"::"public"."enum_service_accounts_scopes";
  ALTER TABLE "authors" DROP COLUMN "automation_publishing_allowed";
  ALTER TABLE "authors" DROP COLUMN "automation_daily_limit";
  ALTER TABLE "_authors_v" DROP COLUMN "version_automation_publishing_allowed";
  ALTER TABLE "_authors_v" DROP COLUMN "version_automation_daily_limit";
  DROP TYPE "public"."enum_authors_allowed_automation_content_types";
  DROP TYPE "public"."enum_authors_automation_attribution_modes";
  DROP TYPE "public"."enum__authors_v_version_allowed_automation_content_types";
  DROP TYPE "public"."enum__authors_v_version_automation_attribution_modes";`)
}
