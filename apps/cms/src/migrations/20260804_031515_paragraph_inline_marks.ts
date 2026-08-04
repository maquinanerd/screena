import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Formatacao inline do paragrafo: `marks`.
 *
 * ADITIVA E SO ISSO. Duas colunas `jsonb` NULLABLE — a da tabela viva e a gemea
 * da tabela de versoes. Sem backfill, sem reescrita de linha, sem default: todo
 * paragrafo ja gravado fica com `NULL` e continua renderizando exatamente como
 * antes. O `down` derruba as duas colunas e nada mais.
 *
 * O TEXTO NAO MUDA DE TIPO. `text` continua `varchar` com o texto LIMPO; a
 * formatacao viaja ao lado, como intervalo. E o que permite ter negrito,
 * italico e link sem violar a recusa de markup do contrato editorial
 * (`packages/editorial-contracts/src/common.ts:58`).
 *
 * ---------------------------------------------------------------------------
 * O GERADOR PROPOS MAIS COISA. Foi removida DE PROPOSITO.
 *
 * `payload migrate:create` tambem emitiu, nesta mesma passada:
 *   - `CREATE TYPE enum_articles_language` + `articles.language` de `varchar`
 *     para esse enum (e o par em `_articles_v.version_language`);
 *   - `articles_blocks_heading.level` ganhando `DEFAULT '2'` (e o par em `_v`).
 *
 * NADA disso vem desta mudanca: e desvio ja existente entre a configuracao das
 * collections e o historico de migrations, herdado da branch base. Converter o
 * tipo de uma coluna POVOADA em producao e uma operacao com risco proprio
 * (falha se alguma linha estiver fora do enum) e merece a sua propria migration,
 * decidida por gente — nao carona numa mudanca de editor de texto.
 * ---------------------------------------------------------------------------
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "articles_blocks_paragraph" ADD COLUMN "marks" jsonb;
  ALTER TABLE "_articles_v_blocks_paragraph" ADD COLUMN "marks" jsonb;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "articles_blocks_paragraph" DROP COLUMN "marks";
  ALTER TABLE "_articles_v_blocks_paragraph" DROP COLUMN "marks";`)
}
