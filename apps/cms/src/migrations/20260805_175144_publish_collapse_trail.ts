import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Rastro do COLAPSO: as quatro colunas que impedem o trilho de mentir.
 *
 * O QUE ESTAVA ERRADO. O botao "Publicar" de um clique sobe os cinco degraus de
 * verdade (`draft -> needs_review -> in_review -> human_reviewed ->
 * ready_to_publish -> published`), cada um passando pelos hooks. Isso preserva a
 * governanca, mas cria um problema proprio: quem le o rastro depois ve cinco
 * transicoes e pode entender que houve revisao de terceiro. Nao houve — houve UMA
 * pessoa apertando UM botao.
 *
 * As quatro colunas dizem isso explicitamente, gravadas IDENTICAS nas cinco linhas:
 *
 *   - `collapse_id`     — uuid gerado UMA vez por operacao. E a chave de
 *                         agrupamento. `collapsed_at` sozinho seria fragil: a
 *                         mesma materia pode ser colapsada duas vezes (publicar,
 *                         retratar, publicar de novo) e dois relogios iguais ao
 *                         milissegundo agrupariam operacoes diferentes.
 *   - `collapsed_at`    — instante UNICO da operacao, capturado antes do primeiro
 *                         degrau.
 *   - `collapsed_from`  — de onde a escada partiu.
 *   - `collapse_reason` — por que (`publicacao_direta`).
 *
 * POR QUE `updated_at` NAO E TOCADO. Ele e campo de sistema do Payload e continua
 * honesto sobre quando cada linha foi escrita. Sobrescreve-lo exigiria brigar com
 * o ORM, e uma versao futura que ignorasse o override devolveria o trilho ao
 * estado que estas colunas existem para evitar — em silencio. O agrupamento e
 * feito por `collapse_id`, que e nosso.
 *
 * AS DUAS TABELAS. `articles` guarda o estado atual; `_articles_v` guarda as
 * versoes — e sao as LINHAS DE VERSAO que formam o rastro das cinco transicoes.
 * Colocar as colunas so na tabela viva deixaria exatamente o rastro sem a marca.
 *
 * ADITIVA E SO ISSO: quatro colunas NULLABLE em cada tabela, sem default, sem
 * backfill, sem reescrita de linha. Toda materia ja gravada fica com `NULL`, que
 * aqui significa "nao veio de colapso" — a verdade para tudo que existe hoje.
 *
 * ---------------------------------------------------------------------------
 * O GERADOR PROPOS MAIS COISA. Foi removida DE PROPOSITO, pela segunda vez.
 *
 * `payload migrate:create` emitiu junto, nesta passada:
 *   - `CREATE TYPE enum_articles_language` + conversao de `articles.language` de
 *     `varchar` para esse enum (e o par em `_articles_v.version_language`);
 *   - `articles_blocks_heading.level` ganhando `DEFAULT '2'` (e o par em `_v`).
 *
 * Nada disso vem desta mudanca: e o MESMO desvio que
 * `20260804_031515_paragraph_inline_marks` ja havia recusado carregar de carona.
 * Converter o tipo de uma coluna POVOADA falha se alguma linha estiver fora do
 * enum, e o `Dockerfile.cms` roda `cms:migrations:deploy` na subida — uma falha
 * ali derruba o container. Merece migration propria, decidida por gente.
 *
 * O SNAPSHOT `.json` FOI CORRIGIDO A MAO para descrever o banco REAL: `language`
 * volta a `varchar`, o `level` perde o `default`, e os dois enums de idioma saem.
 * Sem essa correcao o snapshot afirmaria que a conversao aconteceu e o gerador
 * NUNCA MAIS a proporia — o desvio ficaria escondido para sempre. (Na #106 isso
 * nao chegou a acontecer: o snapshot daquela vez nao registrou o enum. Aqui
 * registrou, e por isso a correcao foi necessaria.)
 *
 * CONTROLE, para quem revisar: depois desta migration, `payload migrate:create`
 * deve CONTINUAR propondo o enum de idioma. Se parar de propor, o desvio foi
 * escondido e esta correcao falhou.
 * ---------------------------------------------------------------------------
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "articles" ADD COLUMN "collapse_id" varchar;
  ALTER TABLE "articles" ADD COLUMN "collapsed_at" timestamp(3) with time zone;
  ALTER TABLE "articles" ADD COLUMN "collapsed_from" varchar;
  ALTER TABLE "articles" ADD COLUMN "collapse_reason" varchar;
  ALTER TABLE "_articles_v" ADD COLUMN "version_collapse_id" varchar;
  ALTER TABLE "_articles_v" ADD COLUMN "version_collapsed_at" timestamp(3) with time zone;
  ALTER TABLE "_articles_v" ADD COLUMN "version_collapsed_from" varchar;
  ALTER TABLE "_articles_v" ADD COLUMN "version_collapse_reason" varchar;
  CREATE INDEX "articles_collapse_id_idx" ON "articles" USING btree ("collapse_id");
  CREATE INDEX "_articles_v_version_version_collapse_id_idx" ON "_articles_v" USING btree ("version_collapse_id");`)
}

/**
 * ROLLBACK: derruba as oito colunas e os dois indices.
 *
 * Nenhum dado pre-existente e tocado no `up`, entao voltar nao perde conteudo de
 * materia nenhuma — perde apenas a marca de colapso das operacoes feitas na
 * vigencia da coluna. O trilho de transicoes em si (as linhas de `_articles_v`)
 * continua intacto: ele nunca dependeu destas colunas para existir.
 */
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  DROP INDEX IF EXISTS "articles_collapse_id_idx";
  DROP INDEX IF EXISTS "_articles_v_version_version_collapse_id_idx";
  ALTER TABLE "articles" DROP COLUMN IF EXISTS "collapse_id";
  ALTER TABLE "articles" DROP COLUMN IF EXISTS "collapsed_at";
  ALTER TABLE "articles" DROP COLUMN IF EXISTS "collapsed_from";
  ALTER TABLE "articles" DROP COLUMN IF EXISTS "collapse_reason";
  ALTER TABLE "_articles_v" DROP COLUMN IF EXISTS "version_collapse_id";
  ALTER TABLE "_articles_v" DROP COLUMN IF EXISTS "version_collapsed_at";
  ALTER TABLE "_articles_v" DROP COLUMN IF EXISTS "version_collapsed_from";
  ALTER TABLE "_articles_v" DROP COLUMN IF EXISTS "version_collapse_reason";`)
}
