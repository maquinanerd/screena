import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "articles" DROP COLUMN "automation_contract_hash";
  ALTER TABLE "_articles_v" DROP COLUMN "version_automation_contract_hash";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "articles" ADD COLUMN "automation_contract_hash" varchar;
  ALTER TABLE "_articles_v" ADD COLUMN "version_automation_contract_hash" varchar;`)
}
