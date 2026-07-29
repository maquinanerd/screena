-- SEO APROVADO pelo CMS, projetado no banco publico.
--
-- ADITIVA por construcao: so acrescenta colunas anulaveis (ou com DEFAULT), sem
-- tocar em coluna, indice ou constraint existente. Nenhuma superficie publica
-- muda de fonte por causa desta migration - quem le `meta_title` continua lendo
-- `meta_title`.
--
-- O que NAO entra aqui, de proposito: `canonical`, `robots` e o JSON-LD final.
-- Esses sao DERIVADOS no lado publico (de `slugs`/`redirects` e da decisao de
-- indexabilidade). Projeta-los do CMS criaria duas fontes discordando sobre a
-- mesma URL, e a divergencia so apareceria no indice do buscador.
--
-- 100% ASCII: caractere fora de ASCII em migration quebra o deploy quando o
-- runner le o arquivo em WIN1252.

ALTER TABLE "article_translations" ADD COLUMN "social_title" TEXT;
ALTER TABLE "article_translations" ADD COLUMN "social_description" TEXT;

-- Excecao EDITORIAL explicita (sindicacao, conteudo espelhado). Nao substitui a
-- canonical de uso normal, que continua derivada de `slugs`.
ALTER TABLE "article_translations" ADD COLUMN "canonical_override" TEXT;

ALTER TABLE "article_translations" ADD COLUMN "focus_keyphrase" TEXT;
ALTER TABLE "article_translations" ADD COLUMN "related_keyphrases" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "article_translations" ADD COLUMN "editorial_keywords" TEXT[] NOT NULL DEFAULT '{}';

-- RECOMENDACAO de tipo de JSON-LD, nao decisao. O render pode recusa-la:
-- emitir `Review` sem review propria seria schema falso.
ALTER TABLE "article_translations" ADD COLUMN "schema_type_recommendation" TEXT;

ALTER TABLE "article_translations" ADD COLUMN "article_section" TEXT;

-- `alt` aprovado por midia e links internos aprovados. JSONB porque sao listas
-- pequenas, lidas inteiras e nunca consultadas por campo.
ALTER TABLE "article_translations" ADD COLUMN "approved_image_alt" JSONB;
ALTER TABLE "article_translations" ADD COLUMN "approved_internal_links" JSONB;
