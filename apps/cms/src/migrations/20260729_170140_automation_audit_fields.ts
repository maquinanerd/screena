import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "articles" ADD COLUMN "automation_actor_label" varchar;
  ALTER TABLE "articles" ADD COLUMN "automation_received_at" timestamp(3) with time zone;
  ALTER TABLE "_articles_v" ADD COLUMN "version_automation_actor_label" varchar;
  ALTER TABLE "_articles_v" ADD COLUMN "version_automation_received_at" timestamp(3) with time zone;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "articles" DROP COLUMN "automation_actor_label";
  ALTER TABLE "articles" DROP COLUMN "automation_received_at";
  ALTER TABLE "_articles_v" DROP COLUMN "version_automation_actor_label";
  ALTER TABLE "_articles_v" DROP COLUMN "version_automation_received_at";`)
}
