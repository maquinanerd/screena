-- title_recommendations - o `recommendations`/`similar` do TMDB, que chegava no
-- append e era descartado.
--
-- 100% ASCII de proposito: migration com byte fora de ASCII ja quebrou deploy
-- neste repositorio (o cluster de producao nao sobe em WIN1252).
--
-- TERCEIRO CASO DO MESMO PADRAO. Antes: `watch/providers` (PR #181, o payload
-- chegava e o normalizador o descartava) e a `biography` de pessoa (o campo
-- chegava e nao havia coluna). `recommendations` e `similar` estao em
-- MOVIE_APPEND e TV_APPEND desde sempre - vinham em toda requisicao de detalhe,
-- ja pagos em cota, e nunca foram lidos.
--
-- POR TMDB_ID, NAO POR FK LOCAL. Uma recomendacao aponta para o universo do
-- TMDB, nao para o nosso catalogo: a maioria dos alvos ainda nao foi ingerida.
-- Guardar FK local obrigaria a descartar na ESCRITA o que ainda nao temos, e a
-- perder o vinculo para sempre quando o titulo entrasse depois. A leitura
-- resolve por tmdb_id e ignora quem nao existe.
--
-- SEM FK, ENTAO, e isso e a decisao e nao um esquecimento. O preco e que a
-- tabela pode conter alvos que nunca serao ingeridos (linhas inertes, baratas);
-- o beneficio e que o vinculo sobrevive a ordem de ingestao.
CREATE TABLE "title_recommendations" (
  "source_media_type" TEXT NOT NULL,
  "source_tmdb_id"    INTEGER NOT NULL,
  "kind"              TEXT NOT NULL,
  "target_media_type" TEXT NOT NULL,
  "target_tmdb_id"    INTEGER NOT NULL,
  "position"          INTEGER NOT NULL,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "title_recommendations_pkey"
    PRIMARY KEY ("source_media_type", "source_tmdb_id", "kind", "target_tmdb_id"),
  CONSTRAINT "title_recommendations_source_media_type_check"
    CHECK ("source_media_type" IN ('movie', 'tv')),
  CONSTRAINT "title_recommendations_target_media_type_check"
    CHECK ("target_media_type" IN ('movie', 'tv')),
  -- `recommendation` e comportamental (quem viu isto viu aquilo); `similar` e
  -- por metadado. Vocabulario FECHADO: um valor novo entra por migration, nunca
  -- por string solta no normalizador.
  CONSTRAINT "title_recommendations_kind_check"
    CHECK ("kind" IN ('recommendation', 'similar')),
  CONSTRAINT "title_recommendations_position_check"
    CHECK ("position" >= 0),
  -- Um titulo nao se recomenda. Sem isto, a propria pagina apareceria no
  -- proprio trilho quando o TMDB devolvesse o id de origem por engano.
  CONSTRAINT "title_recommendations_no_self_reference_check"
    CHECK (NOT ("source_media_type" = "target_media_type" AND "source_tmdb_id" = "target_tmdb_id"))
);

CREATE INDEX "title_recommendations_source_lookup_idx"
  ON "title_recommendations"("source_media_type", "source_tmdb_id", "kind", "position");

CREATE INDEX "title_recommendations_target_idx"
  ON "title_recommendations"("target_media_type", "target_tmdb_id");
