import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Blocos `embed` e `gallery`.
 *
 * ADITIVA: tabelas NOVAS e nada mais. Nenhuma coluna existente muda de tipo,
 * nenhuma linha e reescrita, e materia ja gravada nao tem nenhum dos dois — logo
 * renderiza exatamente como antes. O `down` derruba so as tabelas novas.
 *
 * O DESVIO HERDADO foi removido a mao pela QUARTA vez (enum de idioma + default
 * do heading), e o `.json` corrigido para descrever o banco REAL. Sem essa
 * correcao o snapshot afirmaria que a conversao aconteceu e o gerador nunca mais
 * a proporia — o desvio ficaria escondido para sempre.
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_articles_blocks_embed_provider" AS ENUM('youtube', 'instagram', 'x');
  CREATE TYPE "public"."enum__articles_v_blocks_embed_provider" AS ENUM('youtube', 'instagram', 'x');
  CREATE TABLE "articles_blocks_embed" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"block_id" varchar,
  	"provider" "enum_articles_blocks_embed_provider",
  	"external_id" varchar,
  	"canonical_url" varchar,
  	"original_url" varchar,
  	"caption" varchar,
  	"author_name" varchar,
  	"excerpt" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "articles_blocks_gallery_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"media_id" integer,
  	"alt" varchar,
  	"caption" varchar,
  	"credit" varchar
  );
  
  CREATE TABLE "articles_blocks_gallery" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"block_id" varchar,
  	"initial_index" numeric,
  	"block_name" varchar
  );
  
  CREATE TABLE "_articles_v_blocks_embed" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"block_id" varchar,
  	"provider" "enum__articles_v_blocks_embed_provider",
  	"external_id" varchar,
  	"canonical_url" varchar,
  	"original_url" varchar,
  	"caption" varchar,
  	"author_name" varchar,
  	"excerpt" varchar,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "_articles_v_blocks_gallery_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"media_id" integer,
  	"alt" varchar,
  	"caption" varchar,
  	"credit" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_articles_v_blocks_gallery" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"block_id" varchar,
  	"initial_index" numeric,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  ALTER TABLE "articles_blocks_embed" ADD CONSTRAINT "articles_blocks_embed_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "articles_blocks_gallery_items" ADD CONSTRAINT "articles_blocks_gallery_items_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "articles_blocks_gallery_items" ADD CONSTRAINT "articles_blocks_gallery_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."articles_blocks_gallery"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "articles_blocks_gallery" ADD CONSTRAINT "articles_blocks_gallery_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_articles_v_blocks_embed" ADD CONSTRAINT "_articles_v_blocks_embed_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_articles_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_articles_v_blocks_gallery_items" ADD CONSTRAINT "_articles_v_blocks_gallery_items_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_articles_v_blocks_gallery_items" ADD CONSTRAINT "_articles_v_blocks_gallery_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_articles_v_blocks_gallery"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_articles_v_blocks_gallery" ADD CONSTRAINT "_articles_v_blocks_gallery_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_articles_v"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "articles_blocks_embed_order_idx" ON "articles_blocks_embed" USING btree ("_order");
  CREATE INDEX "articles_blocks_embed_parent_id_idx" ON "articles_blocks_embed" USING btree ("_parent_id");
  CREATE INDEX "articles_blocks_embed_path_idx" ON "articles_blocks_embed" USING btree ("_path");
  CREATE INDEX "articles_blocks_gallery_items_order_idx" ON "articles_blocks_gallery_items" USING btree ("_order");
  CREATE INDEX "articles_blocks_gallery_items_parent_id_idx" ON "articles_blocks_gallery_items" USING btree ("_parent_id");
  CREATE INDEX "articles_blocks_gallery_items_media_idx" ON "articles_blocks_gallery_items" USING btree ("media_id");
  CREATE INDEX "articles_blocks_gallery_order_idx" ON "articles_blocks_gallery" USING btree ("_order");
  CREATE INDEX "articles_blocks_gallery_parent_id_idx" ON "articles_blocks_gallery" USING btree ("_parent_id");
  CREATE INDEX "articles_blocks_gallery_path_idx" ON "articles_blocks_gallery" USING btree ("_path");
  CREATE INDEX "_articles_v_blocks_embed_order_idx" ON "_articles_v_blocks_embed" USING btree ("_order");
  CREATE INDEX "_articles_v_blocks_embed_parent_id_idx" ON "_articles_v_blocks_embed" USING btree ("_parent_id");
  CREATE INDEX "_articles_v_blocks_embed_path_idx" ON "_articles_v_blocks_embed" USING btree ("_path");
  CREATE INDEX "_articles_v_blocks_gallery_items_order_idx" ON "_articles_v_blocks_gallery_items" USING btree ("_order");
  CREATE INDEX "_articles_v_blocks_gallery_items_parent_id_idx" ON "_articles_v_blocks_gallery_items" USING btree ("_parent_id");
  CREATE INDEX "_articles_v_blocks_gallery_items_media_idx" ON "_articles_v_blocks_gallery_items" USING btree ("media_id");
  CREATE INDEX "_articles_v_blocks_gallery_order_idx" ON "_articles_v_blocks_gallery" USING btree ("_order");
  CREATE INDEX "_articles_v_blocks_gallery_parent_id_idx" ON "_articles_v_blocks_gallery" USING btree ("_parent_id");
  CREATE INDEX "_articles_v_blocks_gallery_path_idx" ON "_articles_v_blocks_gallery" USING btree ("_path");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "articles_blocks_embed" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "articles_blocks_gallery_items" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "articles_blocks_gallery" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_articles_v_blocks_embed" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_articles_v_blocks_gallery_items" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_articles_v_blocks_gallery" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "articles_blocks_embed" CASCADE;
  DROP TABLE "articles_blocks_gallery_items" CASCADE;
  DROP TABLE "articles_blocks_gallery" CASCADE;
  DROP TABLE "_articles_v_blocks_embed" CASCADE;
  DROP TABLE "_articles_v_blocks_gallery_items" CASCADE;
  DROP TABLE "_articles_v_blocks_gallery" CASCADE;
  ALTER TABLE "articles" ALTER COLUMN "language" SET DATA TYPE varchar;
  ALTER TABLE "articles" ALTER COLUMN "language" SET DEFAULT 'pt-BR';
  ALTER TABLE "_articles_v" ALTER COLUMN "version_language" SET DATA TYPE varchar;
  ALTER TABLE "_articles_v" ALTER COLUMN "version_language" SET DEFAULT 'pt-BR';
  DROP TYPE "public"."enum_articles_blocks_embed_provider";
  DROP TYPE "public"."enum__articles_v_blocks_embed_provider";`)
}
