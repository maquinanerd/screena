-- ficha_tecnica_detail_facts (20/08/2026)
--
-- A ficha tecnica do canonico pedia fatos que o DETALHE do TMDB ja entregava e
-- o pipeline descartava (mesma familia de watch/providers #181, biografia
-- #190 e recommendations #191):
--   * budget (inteiro; dolar por convencao documentada da API; 0 = nao
--     informado e vira NULL na normalizacao)
--   * production_countries (filme) / origin_country (serie)
--   * release_dates/content_ratings (appends JA BAIXADOS e adiados): recorte
--     BR de classificacao indicativa + estreia regional BR
--
-- ASCII puro (WIN1252 quebra deploy); criada e NAO executada — deploy e do
-- proprietario (prisma migrate deploy).

-- 1. Filme: orcamento + estreia regional BR
ALTER TABLE "movies" ADD COLUMN "budget" BIGINT;
ALTER TABLE "movies" ADD COLUMN "release_date_br" DATE;

-- Orcamento nunca e zero nem negativo: 0 do upstream significa "nao informado"
-- e a normalizacao grava NULL. O CHECK torna o contrato inviolavel por
-- qualquer caminho de escrita futuro.
ALTER TABLE "movies" ADD CONSTRAINT "movies_budget_positive"
  CHECK ("budget" IS NULL OR "budget" > 0);

-- 2. Pais de origem do titulo. SEM FK para "countries" DE PROPOSITO: aquela
-- tabela e o ESCOPO de exibicao de ofertas (~13 codigos), nao um dicionario
-- ISO — uma FK recusaria "NZ" de um titulo neozelandes. A GRAFIA e travada por
-- CHECK; o render resolve o nome pt quando o codigo existir em "countries".
CREATE TABLE "movie_production_countries" (
  "movie_id"     BIGINT NOT NULL,
  "country_code" TEXT   NOT NULL,
  "position"     INTEGER NOT NULL,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "movie_production_countries_pkey" PRIMARY KEY ("movie_id", "country_code"),
  CONSTRAINT "movie_production_countries_movie_id_fkey"
    FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "movie_production_countries_code_shape"
    CHECK ("country_code" ~ '^[A-Z]{2}$'),
  CONSTRAINT "movie_production_countries_position_nonnegative"
    CHECK ("position" >= 0)
);

CREATE INDEX "movie_production_countries_country_code_idx"
  ON "movie_production_countries"("country_code");

CREATE TABLE "tv_show_origin_countries" (
  "tv_show_id"   BIGINT NOT NULL,
  "country_code" TEXT   NOT NULL,
  "position"     INTEGER NOT NULL,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "tv_show_origin_countries_pkey" PRIMARY KEY ("tv_show_id", "country_code"),
  CONSTRAINT "tv_show_origin_countries_tv_show_id_fkey"
    FOREIGN KEY ("tv_show_id") REFERENCES "tv_shows"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "tv_show_origin_countries_code_shape"
    CHECK ("country_code" ~ '^[A-Z]{2}$'),
  CONSTRAINT "tv_show_origin_countries_position_nonnegative"
    CHECK ("position" >= 0)
);

CREATE INDEX "tv_show_origin_countries_country_code_idx"
  ON "tv_show_origin_countries"("country_code");
