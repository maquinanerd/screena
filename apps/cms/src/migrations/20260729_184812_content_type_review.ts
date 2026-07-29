import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_articles_content_type" ADD VALUE 'review' BEFORE 'guide';
  ALTER TYPE "public"."enum__articles_v_version_content_type" ADD VALUE 'review' BEFORE 'guide';`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "articles" ALTER COLUMN "content_type" SET DATA TYPE text;
  ALTER TABLE "articles" ALTER COLUMN "content_type" SET DEFAULT 'news'::text;
  DROP TYPE "public"."enum_articles_content_type";
  CREATE TYPE "public"."enum_articles_content_type" AS ENUM('news', 'feature', 'guide', 'list', 'interview', 'evergreen');
  ALTER TABLE "articles" ALTER COLUMN "content_type" SET DEFAULT 'news'::"public"."enum_articles_content_type";
  ALTER TABLE "articles" ALTER COLUMN "content_type" SET DATA TYPE "public"."enum_articles_content_type" USING "content_type"::"public"."enum_articles_content_type";
  ALTER TABLE "_articles_v" ALTER COLUMN "version_content_type" SET DATA TYPE text;
  ALTER TABLE "_articles_v" ALTER COLUMN "version_content_type" SET DEFAULT 'news'::text;
  DROP TYPE "public"."enum__articles_v_version_content_type";
  CREATE TYPE "public"."enum__articles_v_version_content_type" AS ENUM('news', 'feature', 'guide', 'list', 'interview', 'evergreen');
  ALTER TABLE "_articles_v" ALTER COLUMN "version_content_type" SET DEFAULT 'news'::"public"."enum__articles_v_version_content_type";
  ALTER TABLE "_articles_v" ALTER COLUMN "version_content_type" SET DATA TYPE "public"."enum__articles_v_version_content_type" USING "version_content_type"::"public"."enum__articles_v_version_content_type";`)
}
