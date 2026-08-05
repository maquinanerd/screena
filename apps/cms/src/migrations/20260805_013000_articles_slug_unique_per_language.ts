import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Unicidade de slug POR IDIOMA em `articles`.
 *
 * O QUE FALTAVA. `authors.slug` e `unique` desde a migration inicial
 * (`20260728_224559_initial.ts:761`, `CREATE UNIQUE INDEX`), mas
 * `articles.slug` ganhou so um indice comum (`:826`). Resultado: duas materias
 * podiam segurar a mesma slug no mesmo idioma, e a colisao so aparecia LA NA
 * FRENTE, quando o worker tentava projetar e o banco publico recusava pelo
 * `@@unique([languageCode, slug])` de `article_translations`
 * (`packages/db/prisma/schema.prisma:1690`). Ou seja: o redator salvava, via
 * "salvo", e a materia morria na publicacao, com erro de outro sistema.
 *
 * POR QUE COMPOSTO, E NAO `unique: true` NO CAMPO.
 *
 * O `unique` de campo do Payload e de UMA coluna. Aplicado em `slug`, ele
 * proibiria a mesma slug em `pt-BR` e em `en` — que e exatamente o arranjo
 * correto para a mesma materia traduzida, e e o que o banco publico permite. O
 * espelho fiel e o par `(language, slug)`, e ele nao e exprimivel na
 * configuracao da collection: por isso a migration e escrita a mao e o campo
 * continua sem `unique`.
 *
 * POR QUE PARCIAL, E COM DUAS CONDICOES.
 *
 * `slug` e NULLABLE e nao e `required` — rascunho recem-criado nao tem slug. Em
 * PostgreSQL varios `NULL` nunca colidem num indice unico, entao `NULL` ja
 * estaria coberto. Mas o campo tambem aceita STRING VAZIA, e `''` colide com
 * `''`: sem o `<> ''`, dois rascunhos sem slug se recusariam mutuamente e o
 * redator levaria um erro de unicidade por ainda nao ter escrito o titulo. As
 * duas condicoes juntas dizem a regra real: "toda slug PREENCHIDA e unica
 * dentro do seu idioma".
 *
 * A TABELA DE VERSOES FICA DE FORA, de proposito. `_articles_v` guarda uma
 * linha por autosave; dezenas delas compartilham a mesma slug da mesma materia,
 * legitimamente. Indice unico ali quebraria o autosave no segundo salvamento.
 *
 * ---------------------------------------------------------------------------
 * ABORTA EM VEZ DE ADIVINHAR.
 *
 * Se ja houver duplicata no banco, `CREATE UNIQUE INDEX` falha sozinho — com uma
 * mensagem do PostgreSQL que nomeia o indice e nao a materia. E o
 * `Dockerfile.cms` roda `cms:migrations:deploy` na subida e derruba o container
 * quando a migration falha: o CMS sairia do ar com um erro que nao diz o que
 * fazer.
 *
 * Por isso o bloco abaixo checa ANTES e levanta uma excecao em portugues
 * dizendo QUAIS slugs colidem e em que idioma. Nao mexe em dado nenhum:
 * renomear materia e decisao editorial, nao de migration — uma delas vai mudar
 * de URL, e quem escolhe qual e a redacao.
 * ---------------------------------------------------------------------------
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  DO $$
  DECLARE colisoes TEXT;
  BEGIN
    SELECT string_agg(format('"%s" no idioma %s (%s materias)', d.slug, d.language, d.n), '; ')
      INTO colisoes
      FROM (
        SELECT "slug" AS slug, "language" AS language, count(*) AS n
          FROM "articles"
         WHERE "slug" IS NOT NULL AND "slug" <> ''
         GROUP BY "slug", "language"
        HAVING count(*) > 1
      ) d;

    IF colisoes IS NOT NULL THEN
      RAISE EXCEPTION
        'Migration abortada: existem materias com a mesma slug no mesmo idioma. Renomeie uma de cada par no painel e rode de novo. Colisoes: %',
        colisoes;
    END IF;
  END $$;

  CREATE UNIQUE INDEX "articles_language_slug_unique_idx"
      ON "articles" ("language", "slug")
   WHERE "slug" IS NOT NULL AND "slug" <> '';`)
}

/**
 * ROLLBACK: derruba so o indice.
 *
 * Nao ha coluna nova, nao ha dado reescrito, nao ha default aplicado — entao o
 * `down` devolve o banco exatamente ao estado anterior, e nenhuma materia perde
 * conteudo. O unico efeito de voltar e que a colisao volta a ser possivel.
 */
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  DROP INDEX IF EXISTS "articles_language_slug_unique_idx";`)
}
