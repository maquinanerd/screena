import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Miniatura da midia: colunas de `sizes.thumbnail`.
 *
 * ADITIVA. Colunas NOVAS e NULLABLE na tabela de midia — o Payload as preenche
 * ao gerar a derivada. Midia ja enviada fica com `NULL` e continua sendo servida
 * pelo arquivo original; o que muda e a lista passar a mostrar miniatura em vez
 * de so o nome do arquivo.
 *
 * NAO ha regeneracao retroativa aqui: gerar derivada de todo o acervo dentro de
 * uma migration seria trabalho pesado no caminho de subida do container, e o
 * `Dockerfile.cms` derruba o processo se a migration falhar. As imagens antigas
 * ganham miniatura quando forem reenviadas ou reprocessadas.
 *
 * Desvio herdado removido a mao pela QUINTA vez; `.json` corrigido para o banco
 * real.
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "media" ADD COLUMN "sizes_thumbnail_url" varchar;
  ALTER TABLE "media" ADD COLUMN "sizes_thumbnail_width" numeric;
  ALTER TABLE "media" ADD COLUMN "sizes_thumbnail_height" numeric;
  ALTER TABLE "media" ADD COLUMN "sizes_thumbnail_mime_type" varchar;
  ALTER TABLE "media" ADD COLUMN "sizes_thumbnail_filesize" numeric;
  ALTER TABLE "media" ADD COLUMN "sizes_thumbnail_filename" varchar;
  CREATE INDEX "media_sizes_thumbnail_sizes_thumbnail_filename_idx" ON "media" USING btree ("sizes_thumbnail_filename");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "media_sizes_thumbnail_sizes_thumbnail_filename_idx";
  ALTER TABLE "articles" ALTER COLUMN "language" SET DATA TYPE varchar;
  ALTER TABLE "articles" ALTER COLUMN "language" SET DEFAULT 'pt-BR';
  ALTER TABLE "_articles_v" ALTER COLUMN "version_language" SET DATA TYPE varchar;
  ALTER TABLE "_articles_v" ALTER COLUMN "version_language" SET DEFAULT 'pt-BR';
  ALTER TABLE "media" DROP COLUMN "sizes_thumbnail_url";
  ALTER TABLE "media" DROP COLUMN "sizes_thumbnail_width";
  ALTER TABLE "media" DROP COLUMN "sizes_thumbnail_height";
  ALTER TABLE "media" DROP COLUMN "sizes_thumbnail_mime_type";
  ALTER TABLE "media" DROP COLUMN "sizes_thumbnail_filesize";
  ALTER TABLE "media" DROP COLUMN "sizes_thumbnail_filename";`)
}
