-- person_biography_and_title_genres - dois dados que o TMDB ja entregava e que
-- eram jogados fora por falta de coluna.
--
-- 100% ASCII de proposito: migration com byte fora de ASCII ja quebrou deploy
-- neste repositorio (o cluster de producao nao sobe em WIN1252).
--
-- ------------------------------------------------------------------
-- O QUE ESTA MIGRATION CRIA
--   1. `people.biography` - a coluna de TEXTO que faltava;
--   2. `movie_genres` e `tv_show_genres` - o vinculo entre titulo e genero.
--
-- O PADRAO EM COMUM. Nos dois casos o dado CHEGA no payload do TMDB e e
-- descartado no normalizador, porque nao ha onde grava-lo. Mesmo defeito de
-- `watch/providers` (PR #181) e de `recommendations`/`similar`. Nao e "ninguem
-- coletou" - e "coletamos e jogamos fora".
--
-- ------------------------------------------------------------------
-- 1. people.biography
-- ------------------------------------------------------------------
-- `people` ja tinha `biography_source_status` (a coluna de GOVERNANCA de
-- exibicao, invariante 6) e NAO tinha a coluna de texto. `normalizePerson` nem
-- tentava persistir; o cabecalho dele dizia isso por extenso, e um teste fixava
-- o descarte como esperado.
--
-- NULL por default, e permanece NULL para as linhas ja existentes: esta
-- migration nao inventa biografia para ninguem. O texto so aparece quando o
-- proximo sync daquela pessoa rodar.
--
-- A EXIBICAO NAO MUDA AQUI. `biography_source_status` continua no default
-- `unknown`, e o gate de licenca (invariante 6) continua bloqueando. Ter o texto
-- no banco e condicao NECESSARIA e nao suficiente para ele ir a tela.
ALTER TABLE "people" ADD COLUMN "biography" TEXT;

-- ------------------------------------------------------------------
-- 2. Vinculo titulo <-> genero
-- ------------------------------------------------------------------
-- `genres` existe como DICIONARIO desde a Fase 6 (normalizado de
-- /genre/{movie,tv}/list) e nunca teve ligacao com titulo nenhum. O `genres[]`
-- do detalhe do TMDB chegava e era descartado.
--
-- `position` PRESERVA A ORDEM do TMDB, que e editorial (o primeiro genero e o
-- mais representativo). Ordenar por id ou por nome na leitura trocaria
-- "Ficcao cientifica" por "Acao" no chip do hero sem decisao de ninguem.
--
-- `genre_media_type` e coluna propria porque a PK de `genres` e composta
-- (media_type, tmdb_id). O CHECK prende o valor, para que um filme nunca possa
-- apontar para um genero de serie - a FK sozinha nao impediria isso.
CREATE TABLE "movie_genres" (
  "movie_id"         BIGINT NOT NULL,
  "genre_media_type" TEXT NOT NULL DEFAULT 'movie',
  "genre_tmdb_id"    INTEGER NOT NULL,
  "position"         INTEGER NOT NULL,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "movie_genres_pkey" PRIMARY KEY ("movie_id", "genre_tmdb_id"),
  CONSTRAINT "movie_genres_media_type_check" CHECK ("genre_media_type" = 'movie'),
  CONSTRAINT "movie_genres_position_check" CHECK ("position" >= 0)
);

CREATE TABLE "tv_show_genres" (
  "tv_show_id"       BIGINT NOT NULL,
  "genre_media_type" TEXT NOT NULL DEFAULT 'tv',
  "genre_tmdb_id"    INTEGER NOT NULL,
  "position"         INTEGER NOT NULL,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "tv_show_genres_pkey" PRIMARY KEY ("tv_show_id", "genre_tmdb_id"),
  CONSTRAINT "tv_show_genres_media_type_check" CHECK ("genre_media_type" = 'tv'),
  CONSTRAINT "tv_show_genres_position_check" CHECK ("position" >= 0)
);

CREATE INDEX "movie_genres_genre_media_type_genre_tmdb_id_idx"
  ON "movie_genres"("genre_media_type", "genre_tmdb_id");
CREATE INDEX "tv_show_genres_genre_media_type_genre_tmdb_id_idx"
  ON "tv_show_genres"("genre_media_type", "genre_tmdb_id");

ALTER TABLE "movie_genres"
  ADD CONSTRAINT "movie_genres_movie_id_fkey"
  FOREIGN KEY ("movie_id") REFERENCES "movies"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "movie_genres"
  ADD CONSTRAINT "movie_genres_genre_media_type_genre_tmdb_id_fkey"
  FOREIGN KEY ("genre_media_type", "genre_tmdb_id") REFERENCES "genres"("media_type", "tmdb_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tv_show_genres"
  ADD CONSTRAINT "tv_show_genres_tv_show_id_fkey"
  FOREIGN KEY ("tv_show_id") REFERENCES "tv_shows"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tv_show_genres"
  ADD CONSTRAINT "tv_show_genres_genre_media_type_genre_tmdb_id_fkey"
  FOREIGN KEY ("genre_media_type", "genre_tmdb_id") REFERENCES "genres"("media_type", "tmdb_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
