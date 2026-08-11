import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Fecha o DESVIO PRE-EXISTENTE entre a config do Payload e a cadeia de
 * migrations. E a "migration propria" que o cabecalho de
 * `20260807_024956_editorial_media_ingest.ts` deixou pendente.
 *
 * Origem do desvio: `dcf98dd` (#105, 2026-08-04) trocou `articles.language` de
 * caixa de texto livre para `select` e deu `defaultValue: '2'` ao `level` do
 * bloco `heading` — sem gerar a migration. Desde entao a config afirma um enum
 * e o banco guarda `varchar`. Duas PRs seguintes apararam esse desvio a mao, de
 * proposito, para ele continuar visivel. Aqui ele e APLICADO.
 *
 * O SQL gerado abaixo e exatamente o que `payload migrate:create` emitiu, sem
 * corte. O `.json` ao lado saiu da MESMA geracao — nunca aparar o SQL sem
 * refazer o snapshot, senao a proxima geracao compara com um snapshot mentiroso
 * e o desvio some para sempre.
 *
 * ---------------------------------------------------------------------------
 * A GUARDA DE DADOS (primeiro `db.execute` do `up`) — decisao humana, 2026-08-11
 * ---------------------------------------------------------------------------
 *
 * `ALTER ... USING "language"::enum` ABORTA se alguma linha tiver valor fora de
 * ('pt-BR','en','es'). NULL passa (o cast de NULL e NULL); `''`, `'pt'`,
 * `'pt_BR'` e `'PT-BR'` NAO passam — medido em PostgreSQL 16 real.
 *
 * O problema nao e a falha: e o FORMATO dela. O erro nativo do cast (SQLSTATE
 * 22P02) nomeia **um** valor ofensor por vez. Com N valores ruins seriam N
 * deploys falhos ate descobrir todos, cada um custando um ciclo inteiro.
 *
 * A guarda troca isso por uma unica falha que nomeia TODOS os ofensores das
 * DUAS colunas de uma vez (`P0001`). Ela NAO altera schema — e um bloco `DO`
 * puro —, entao o snapshot `.json` continua sendo o da geracao do tool.
 *
 * Por que nao verificar em producao antes: o banco do CMS
 * (`cinerie-cms-db:5432`) e rede interna do EasyPanel e nao e alcancavel de
 * fora. Trocar um deploy que falha em silencio confuso por um que falha
 * nomeando tudo e o negocio certo enquanto essa verificacao nao existir.
 *
 * Contexto que reduz o risco, ja medido: desde `dcf98dd` a ingestao roda com
 * validacao de campo ligada e `select` recusa valor fora das opcoes. Linha
 * ruim, se existir, e ANTERIOR a 2026-08-04. O contrato de entrada
 * (`languageCode`, `packages/editorial-contracts/src/common.ts`) e regex BCP-47
 * generica e aceitava `pt`, `en-US`, `pt-PT` — que entravam direto na coluna de
 * texto livre antes do #105.
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  // Guarda de dados. Roda ANTES do SQL gerado, em statement propria, para que o
  // bloco gerado permaneca byte a byte o que o tool emitiu.
  await db.execute(sql`
    DO $guard$
    DECLARE
      bad_articles text;
      bad_versions text;
    BEGIN
      SELECT string_agg(quote_literal(v), ', ' ORDER BY v) INTO bad_articles
        FROM (
          SELECT DISTINCT "language" AS v
            FROM "articles"
           WHERE "language" IS NOT NULL
             AND "language" NOT IN ('pt-BR', 'en', 'es')
        ) s;

      SELECT string_agg(quote_literal(v), ', ' ORDER BY v) INTO bad_versions
        FROM (
          SELECT DISTINCT "version_language" AS v
            FROM "_articles_v"
           WHERE "version_language" IS NOT NULL
             AND "version_language" NOT IN ('pt-BR', 'en', 'es')
        ) s;

      IF bad_articles IS NOT NULL OR bad_versions IS NOT NULL THEN
        RAISE EXCEPTION
          'migration abortada: idioma fora de (pt-BR, en, es). articles.language: %; _articles_v.version_language: %',
          COALESCE(bad_articles, '<nenhum>'), COALESCE(bad_versions, '<nenhum>');
      END IF;
    END
    $guard$;`)

  await db.execute(sql`
   CREATE TYPE "public"."enum_articles_language" AS ENUM('pt-BR', 'en', 'es');
  CREATE TYPE "public"."enum__articles_v_version_language" AS ENUM('pt-BR', 'en', 'es');
  ALTER TABLE "articles_blocks_heading" ALTER COLUMN "level" SET DEFAULT '2';
  ALTER TABLE "articles" ALTER COLUMN "language" SET DEFAULT 'pt-BR'::"public"."enum_articles_language";
  ALTER TABLE "articles" ALTER COLUMN "language" SET DATA TYPE "public"."enum_articles_language" USING "language"::"public"."enum_articles_language";
  ALTER TABLE "_articles_v_blocks_heading" ALTER COLUMN "level" SET DEFAULT '2';
  ALTER TABLE "_articles_v" ALTER COLUMN "version_language" SET DEFAULT 'pt-BR'::"public"."enum__articles_v_version_language";
  ALTER TABLE "_articles_v" ALTER COLUMN "version_language" SET DATA TYPE "public"."enum__articles_v_version_language" USING "version_language"::"public"."enum__articles_v_version_language";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "articles_blocks_heading" ALTER COLUMN "level" DROP DEFAULT;
  ALTER TABLE "articles" ALTER COLUMN "language" SET DATA TYPE varchar;
  ALTER TABLE "articles" ALTER COLUMN "language" SET DEFAULT 'pt-BR';
  ALTER TABLE "_articles_v_blocks_heading" ALTER COLUMN "level" DROP DEFAULT;
  ALTER TABLE "_articles_v" ALTER COLUMN "version_language" SET DATA TYPE varchar;
  ALTER TABLE "_articles_v" ALTER COLUMN "version_language" SET DEFAULT 'pt-BR';
  DROP TYPE "public"."enum_articles_language";
  DROP TYPE "public"."enum__articles_v_version_language";`)
}
