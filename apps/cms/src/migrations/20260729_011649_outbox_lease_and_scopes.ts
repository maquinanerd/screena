import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_service_accounts_scopes" AS ENUM('draft_ingest', 'publication_projection');
  CREATE TABLE "service_accounts_scopes" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum_service_accounts_scopes",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  ALTER TABLE "publication_outbox" ADD COLUMN "lease_token" varchar;
  ALTER TABLE "publication_outbox" ADD COLUMN "locked_by" varchar;
  ALTER TABLE "publication_outbox" ADD COLUMN "lease_expires_at" timestamp(3) with time zone;
  ALTER TABLE "publication_outbox" ADD COLUMN "error_code" varchar;
  ALTER TABLE "service_accounts_scopes" ADD CONSTRAINT "service_accounts_scopes_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."service_accounts"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "service_accounts_scopes_order_idx" ON "service_accounts_scopes" USING btree ("order");
  CREATE INDEX "service_accounts_scopes_parent_idx" ON "service_accounts_scopes" USING btree ("parent_id");
  CREATE INDEX "publication_outbox_lease_token_idx" ON "publication_outbox" USING btree ("lease_token");
  CREATE INDEX "publication_outbox_lease_expires_at_idx" ON "publication_outbox" USING btree ("lease_expires_at");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "service_accounts_scopes" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "service_accounts_scopes" CASCADE;
  DROP INDEX "publication_outbox_lease_token_idx";
  DROP INDEX "publication_outbox_lease_expires_at_idx";
  ALTER TABLE "publication_outbox" DROP COLUMN "lease_token";
  ALTER TABLE "publication_outbox" DROP COLUMN "locked_by";
  ALTER TABLE "publication_outbox" DROP COLUMN "lease_expires_at";
  ALTER TABLE "publication_outbox" DROP COLUMN "error_code";
  DROP TYPE "public"."enum_service_accounts_scopes";`)
}
