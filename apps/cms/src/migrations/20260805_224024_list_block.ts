import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Bloco `list`: lista com marcador ou numerada.
 *
 * ADITIVA. Quatro tabelas NOVAS (`articles_blocks_list`, `_items`, e as gemeas
 * de versao) e nada mais — nenhuma coluna existente muda de tipo, nenhuma linha
 * e reescrita. Materia ja gravada nao tem bloco `list`, entao continua
 * renderizando exatamente como antes. O `down` derruba so as quatro tabelas.
 *
 * O DESVIO HERDADO FOI REMOVIDO A MAO, pela terceira vez: o gerador propos junto
 * a conversao de `articles.language` para enum e o `DEFAULT '2'` no heading.
 * Nao vem desta mudanca (ver `20260805_175144_publish_collapse_trail`), e
 * converter tipo de coluna povoada derruba o container na subida se alguma linha
 * estiver fora do enum. O `.json` tambem foi corrigido para descrever o banco
 * REAL — sem isso o gerador nunca mais proporia a conversao.
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  CREATE TABLE "articles_blocks_list_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "articles_blocks_list" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"block_id" varchar,
  	"ordered" boolean DEFAULT false,
  	"block_name" varchar
  );
  
  CREATE TABLE "_articles_v_blocks_list_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"text" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_articles_v_blocks_list" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"block_id" varchar,
  	"ordered" boolean DEFAULT false,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  ALTER TABLE "articles_blocks_list_items" ADD CONSTRAINT "articles_blocks_list_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."articles_blocks_list"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "articles_blocks_list" ADD CONSTRAINT "articles_blocks_list_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_articles_v_blocks_list_items" ADD CONSTRAINT "_articles_v_blocks_list_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_articles_v_blocks_list"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_articles_v_blocks_list" ADD CONSTRAINT "_articles_v_blocks_list_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_articles_v"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "articles_blocks_list_items_order_idx" ON "articles_blocks_list_items" USING btree ("_order");
  CREATE INDEX "articles_blocks_list_items_parent_id_idx" ON "articles_blocks_list_items" USING btree ("_parent_id");
  CREATE INDEX "articles_blocks_list_order_idx" ON "articles_blocks_list" USING btree ("_order");
  CREATE INDEX "articles_blocks_list_parent_id_idx" ON "articles_blocks_list" USING btree ("_parent_id");
  CREATE INDEX "articles_blocks_list_path_idx" ON "articles_blocks_list" USING btree ("_path");
  CREATE INDEX "_articles_v_blocks_list_items_order_idx" ON "_articles_v_blocks_list_items" USING btree ("_order");
  CREATE INDEX "_articles_v_blocks_list_items_parent_id_idx" ON "_articles_v_blocks_list_items" USING btree ("_parent_id");
  CREATE INDEX "_articles_v_blocks_list_order_idx" ON "_articles_v_blocks_list" USING btree ("_order");
  CREATE INDEX "_articles_v_blocks_list_parent_id_idx" ON "_articles_v_blocks_list" USING btree ("_parent_id");
  CREATE INDEX "_articles_v_blocks_list_path_idx" ON "_articles_v_blocks_list" USING btree ("_path");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "articles_blocks_list_items" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "articles_blocks_list" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_articles_v_blocks_list_items" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_articles_v_blocks_list" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "articles_blocks_list_items" CASCADE;
  DROP TABLE "articles_blocks_list" CASCADE;
  DROP TABLE "_articles_v_blocks_list_items" CASCADE;
  DROP TABLE "_articles_v_blocks_list" CASCADE;`)
}
