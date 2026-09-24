-- ============================================================================
-- DIAGNOSTICO DE ORIGEM E RELEVANCIA DO CATALOGO — SOMENTE LEITURA
-- ============================================================================
-- Pergunta do dono (24/09/2026): o que do catalogo nao e americano nem
-- realmente popular (ex.: tailandes), e quanto disso esta publicado?
-- Este arquivo MEDE. Nao decide e nao apaga nada.
--
-- Como rodar: psql (ou DbGate) no banco `screena`. Devolve UMA celula com um
-- JSON. A primeira linha poe a sessao em somente leitura: qualquer escrita
-- acidental falha.
--
-- Definicoes (todas conferidas contra o codigo em 24/09/2026):
--   origem   : pais do titulo. Filme = production_countries (inclui
--              coproducao); serie = origin_country. 'US' se os EUA aparecem em
--              QUALQUER posicao; senao 'BR' se o Brasil aparece; senao o
--              primeiro pais; '(sem pais)' se nada foi gravado (a tabela nasceu
--              em 20/08/2026 — titulo nao reprocessado desde entao fica sem).
--   no_indice: o MESMO predicado do sitemap de filmes/series
--              (apps/web/src/server/seo/sitemap-index.ts): slug canonico pt-BR,
--              titulo original, portao D3 e decisao 'index' (com o mesmo
--              "armamento" de 1.000 decisoes de decision-coverage.ts).
--   popular  : vote_count_tmdb >= votos_popular (parametro abaixo).
--   cauda    : vote_count_tmdb <  votos_cauda.
--   '(sem pais)' NUNCA conta como "sai" nas simulacoes: e indeterminado, a
--   mesma licao do recorte de idioma (nulo nao e alvo).
--
-- Regras simuladas (fica = true):
--   A so EUA
--   B EUA + Brasil
--   C EUA + Brasil + popular
--   D C + quem tem oferta de streaming no Brasil
--   E D, e a cauda EUA/Brasil sem oferta tambem sai
-- ============================================================================

SET default_transaction_read_only = on;
SET statement_timeout = '10min';

WITH
params AS MATERIALIZED (
  SELECT 1000::int AS votos_popular,
         100::int  AS votos_cauda,
         ARRAY['pt', 'en', 'es', 'ja', 'ko']::text[] AS recorte_idioma
),
titulos AS MATERIALIZED (
  SELECT 'movie'::text AS tipo, m.id, m.tmdb_id, m.title_original AS titulo,
         LOWER(SPLIT_PART(m.original_language, '-', 1)) AS idioma,
         COALESCE(m.popularity, 0)::float8 AS popularidade,
         COALESCE(m.vote_count_tmdb, 0) AS votos,
         EXTRACT(YEAR FROM m.release_date)::int AS ano,
         m.created_at AS criado_em
    FROM movies m
  UNION ALL
  SELECT 'tv', t.id, t.tmdb_id, t.name_original,
         LOWER(SPLIT_PART(t.original_language, '-', 1)),
         COALESCE(t.popularity, 0)::float8,
         COALESCE(t.vote_count_tmdb, 0),
         EXTRACT(YEAR FROM t.first_air_date)::int,
         t.created_at
    FROM tv_shows t
),
paises AS MATERIALIZED (
  SELECT 'movie'::text AS tipo, movie_id AS id,
         array_agg(country_code ORDER BY position) AS paises
    FROM movie_production_countries GROUP BY movie_id
  UNION ALL
  SELECT 'tv', tv_show_id, array_agg(country_code ORDER BY position)
    FROM tv_show_origin_countries GROUP BY tv_show_id
),
slug_pt AS MATERIALIZED (
  SELECT entity_type::text AS tipo, entity_id AS id,
         bool_or(is_canonical)                                  AS tem_canonico,
         bool_and(NOT is_canonical OR slug ~ '^tmdb-[0-9]+$')   AS slug_fallback
    FROM slugs
   WHERE language_code = 'pt-BR' AND entity_type IN ('movie', 'tv')
   GROUP BY 1, 2
),
traducao_pt AS MATERIALIZED (
  SELECT et.entity_type::text AS tipo, et.entity_id AS id,
         max(NULLIF(BTRIM(et.title), '')) FILTER (WHERE et.language_code = 'pt-BR') AS titulo_pt,
         bool_or(BTRIM(COALESCE(et.summary, '')) <> '') AS tem_sinopse,
         bool_or((BTRIM(COALESCE(et.title, '')) <> ''
                  AND BTRIM(COALESCE(et.title, '')) <> BTRIM(COALESCE(x.titulo, '')))
                 OR BTRIM(COALESCE(et.summary, '')) <> ''
                 OR BTRIM(COALESCE(et.meta_description, '')) <> '') AS localizada
    FROM entity_translations et
    JOIN titulos x ON x.tipo = et.entity_type::text AND x.id = et.entity_id
   WHERE et.language_code IN ('pt-BR', 'pt') AND et.entity_type IN ('movie', 'tv')
   GROUP BY 1, 2
),
decisao AS MATERIALIZED (
  SELECT DISTINCT ON (entity_type, entity_id)
         entity_type::text AS tipo, entity_id AS id, decision::text AS decisao
    FROM page_indexability_decisions
   WHERE language_code = 'pt-BR' AND is_current AND entity_type IN ('movie', 'tv')
   ORDER BY entity_type, entity_id
),
-- Mesmo "armamento" do sitemap: com 1.000+ decisoes vigentes no tipo, a
-- AUSENCIA de decisao passa a valer noindex (decision-coverage.ts).
ausencia AS MATERIALIZED (
  SELECT t.tipo,
         CASE WHEN (SELECT count(*) FROM (
                      SELECT 1 FROM page_indexability_decisions d
                       WHERE d.entity_type = t.tipo::"EntityType"
                         AND d.language_code = 'pt-BR' AND d.is_current
                       LIMIT 1000) a) >= 1000
              THEN 'noindex' ELSE 'index' END AS decisao_ausente
    FROM (VALUES ('movie'), ('tv')) AS t(tipo)
),
oferta_br AS MATERIALIZED (
  SELECT DISTINCT entity_type::text AS tipo, entity_id AS id
    FROM watch_availability
   WHERE country_code = 'BR' AND entity_type IN ('movie', 'tv')
),
temporadas AS MATERIALIZED (
  SELECT tv_show_id AS id, count(*) AS n FROM seasons GROUP BY 1
),
episodios AS MATERIALIZED (
  SELECT tv_show_id AS id, count(*) AS n FROM episodes GROUP BY 1
),
base AS MATERIALIZED (
  SELECT x.*,
         p.paises,
         CASE WHEN p.paises IS NULL      THEN '(sem pais)'
              WHEN 'US' = ANY (p.paises) THEN 'US'
              WHEN 'BR' = ANY (p.paises) THEN 'BR'
              ELSE p.paises[1] END       AS origem,
         CASE WHEN p.paises IS NULL      THEN 'sem pais'
              WHEN 'US' = ANY (p.paises) THEN 'EUA'
              WHEN 'BR' = ANY (p.paises) THEN 'Brasil'
              ELSE 'outros' END          AS grupo,
         s.id IS NOT NULL                AS com_slug,
         -- MESMO predicado do sitemap de filmes/series (sitemap-index.ts):
         -- slug canonico pt-BR + titulo original + portao D3 + decisao 'index'
         (COALESCE(s.tem_canonico, false)
          AND BTRIM(x.titulo) <> ''
          AND (NOT s.slug_fallback OR COALESCE(tr.localizada, false))
          AND COALESCE(d.decisao, au.decisao_ausente) = 'index') AS no_indice,
         tr.titulo_pt,
         COALESCE(tr.tem_sinopse, false) AS sinopse_pt,
         o.id IS NOT NULL                AS oferta_br,
         COALESCE(se.n, 0)               AS temporadas,
         COALESCE(ep.n, 0)               AS episodios,
         (x.idioma IS NOT NULL AND x.idioma <> ALL (pr.recorte_idioma)) AS fora_recorte_idioma,
         x.votos >= pr.votos_popular     AS popular,
         x.votos >= pr.votos_cauda       AS acima_cauda
    FROM titulos x
    CROSS JOIN params pr
    LEFT JOIN paises p       ON p.tipo = x.tipo AND p.id = x.id
    LEFT JOIN slug_pt s      ON s.tipo = x.tipo AND s.id = x.id
    LEFT JOIN traducao_pt tr ON tr.tipo = x.tipo AND tr.id = x.id
    LEFT JOIN decisao d      ON d.tipo = x.tipo AND d.id = x.id
    JOIN ausencia au         ON au.tipo = x.tipo
    LEFT JOIN oferta_br o    ON o.tipo = x.tipo AND o.id = x.id
    LEFT JOIN temporadas se  ON x.tipo = 'tv' AND se.id = x.id
    LEFT JOIN episodios ep   ON x.tipo = 'tv' AND ep.id = x.id
),
regras AS MATERIALIZED (
  -- fica = true / false; NULL = indeterminado (sem pais: nunca e alvo)
  SELECT b.*,
         CASE WHEN b.grupo = 'sem pais' THEN NULL ELSE b.grupo = 'EUA' END AS r_a,
         CASE WHEN b.grupo = 'sem pais' THEN NULL ELSE b.grupo IN ('EUA', 'Brasil') END AS r_b,
         CASE WHEN b.grupo = 'sem pais' THEN NULL
              ELSE b.grupo IN ('EUA', 'Brasil') OR b.popular END AS r_c,
         CASE WHEN b.grupo = 'sem pais' THEN NULL
              ELSE b.grupo IN ('EUA', 'Brasil') OR b.popular OR b.oferta_br END AS r_d,
         CASE WHEN b.grupo = 'sem pais' THEN NULL
              ELSE (b.grupo IN ('EUA', 'Brasil') AND b.acima_cauda) OR b.popular OR b.oferta_br END AS r_e
    FROM base b
),
simulacao AS (
  SELECT r.regra, r.descricao,
         count(*) FILTER (WHERE r.fica)                                   AS titulos_ficam,
         count(*) FILTER (WHERE NOT r.fica)                               AS titulos_saem,
         count(*) FILTER (WHERE r.fica IS NULL)                           AS titulos_indeterminados,
         count(*) FILTER (WHERE NOT r.fica AND r.tipo = 'movie')          AS filmes_saem,
         count(*) FILTER (WHERE NOT r.fica AND r.tipo = 'tv')             AS series_saem,
         COALESCE(sum(r.temporadas) FILTER (WHERE NOT r.fica), 0)         AS temporadas_saem,
         COALESCE(sum(r.episodios) FILTER (WHERE NOT r.fica), 0)          AS episodios_saem,
         count(*) FILTER (WHERE NOT r.fica AND r.no_indice)               AS urls_indexadas_saem,
         count(*) FILTER (WHERE r.fica AND r.no_indice)                   AS urls_indexadas_ficam,
         count(*) FILTER (WHERE NOT r.fica AND r.oferta_br)               AS saem_com_oferta_br,
         count(*) FILTER (WHERE NOT r.fica AND r.sinopse_pt)              AS saem_com_sinopse_pt
    FROM (
      SELECT 'A' AS regra, 'so EUA' AS descricao, tipo, r_a AS fica, temporadas, episodios, no_indice, oferta_br, sinopse_pt FROM regras
      UNION ALL SELECT 'B', 'EUA + Brasil', tipo, r_b, temporadas, episodios, no_indice, oferta_br, sinopse_pt FROM regras
      UNION ALL SELECT 'C', 'EUA + Brasil + popular (votos >= votos_popular)', tipo, r_c, temporadas, episodios, no_indice, oferta_br, sinopse_pt FROM regras
      UNION ALL SELECT 'D', 'C + quem tem oferta no Brasil', tipo, r_d, temporadas, episodios, no_indice, oferta_br, sinopse_pt FROM regras
      UNION ALL SELECT 'E', 'D, e a cauda EUA/Brasil (votos < votos_cauda, sem oferta) sai', tipo, r_e, temporadas, episodios, no_indice, oferta_br, sinopse_pt FROM regras
    ) r
   GROUP BY r.regra, r.descricao
)
SELECT jsonb_pretty(jsonb_build_object(
  'medido_em', now(),
  'parametros', (SELECT to_jsonb(p) FROM params p),

  '1_totais', (SELECT jsonb_build_object(
      'filmes',              count(*) FILTER (WHERE tipo = 'movie'),
      'series',              count(*) FILTER (WHERE tipo = 'tv'),
      'temporadas',          sum(temporadas),
      'episodios',           sum(episodios),
      'com_slug_pt',         count(*) FILTER (WHERE com_slug),
      'no_indice_aprox',     count(*) FILTER (WHERE no_indice),
      'sem_pais_gravado',    count(*) FILTER (WHERE grupo = 'sem pais'),
      'idioma_nulo',         count(*) FILTER (WHERE idioma IS NULL),
      'fora_recorte_idioma', count(*) FILTER (WHERE fora_recorte_idioma),
      'com_oferta_br',       count(*) FILTER (WHERE oferta_br),
      'com_sinopse_pt',      count(*) FILTER (WHERE sinopse_pt)
    ) FROM base),

  '2_por_grupo', (SELECT jsonb_agg(g ORDER BY g.titulos DESC) FROM (
      SELECT grupo,
             count(*)                                   AS titulos,
             count(*) FILTER (WHERE tipo = 'movie')     AS filmes,
             count(*) FILTER (WHERE tipo = 'tv')        AS series,
             sum(episodios)                             AS episodios,
             count(*) FILTER (WHERE no_indice)          AS no_indice,
             count(*) FILTER (WHERE popular)            AS populares,
             count(*) FILTER (WHERE NOT acima_cauda)    AS cauda,
             count(*) FILTER (WHERE oferta_br)          AS oferta_br,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY votos) AS votos_mediana
        FROM base GROUP BY grupo) g),

  '3_por_pais', (SELECT jsonb_agg(g ORDER BY g.titulos DESC) FROM (
      SELECT origem,
             count(*)                                   AS titulos,
             count(*) FILTER (WHERE tipo = 'movie')     AS filmes,
             count(*) FILTER (WHERE tipo = 'tv')        AS series,
             sum(episodios)                             AS episodios,
             count(*) FILTER (WHERE no_indice)          AS no_indice,
             count(*) FILTER (WHERE popular)            AS populares,
             count(*) FILTER (WHERE oferta_br)          AS oferta_br,
             count(*) FILTER (WHERE sinopse_pt)         AS sinopse_pt,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY votos)        AS votos_mediana,
             round(percentile_cont(0.5) WITHIN GROUP (ORDER BY popularidade)::numeric, 2) AS popularidade_mediana
        FROM base GROUP BY origem
       ORDER BY count(*) DESC LIMIT 40) g),

  '4_por_idioma', (SELECT jsonb_agg(g ORDER BY g.titulos DESC) FROM (
      SELECT COALESCE(idioma, '(nulo)')                 AS idioma,
             bool_or(fora_recorte_idioma)               AS fora_do_recorte,
             count(*)                                   AS titulos,
             count(*) FILTER (WHERE grupo = 'EUA')      AS dos_eua,
             count(*) FILTER (WHERE no_indice)          AS no_indice,
             count(*) FILTER (WHERE popular)            AS populares,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY votos) AS votos_mediana
        FROM base GROUP BY idioma
       ORDER BY count(*) DESC LIMIT 30) g),

  '5_relevancia', (SELECT jsonb_agg(g ORDER BY g.grupo, g.ordem) FROM (
      SELECT grupo,
             CASE WHEN votos = 0 THEN 0 WHEN votos < 10 THEN 1 WHEN votos < 50 THEN 2
                  WHEN votos < 100 THEN 3 WHEN votos < 500 THEN 4 WHEN votos < 1000 THEN 5
                  WHEN votos < 5000 THEN 6 ELSE 7 END AS ordem,
             CASE WHEN votos = 0 THEN '0' WHEN votos < 10 THEN '1-9' WHEN votos < 50 THEN '10-49'
                  WHEN votos < 100 THEN '50-99' WHEN votos < 500 THEN '100-499'
                  WHEN votos < 1000 THEN '500-999' WHEN votos < 5000 THEN '1000-4999'
                  ELSE '5000+' END AS faixa_votos,
             count(*) FILTER (WHERE tipo = 'movie') AS filmes,
             count(*) FILTER (WHERE tipo = 'tv')    AS series,
             count(*) FILTER (WHERE no_indice)      AS no_indice
        FROM base GROUP BY 1, 2, 3) g),

  '6_simulacao', (SELECT jsonb_agg(s ORDER BY s.regra) FROM simulacao s),

  '7_tailandes', (SELECT jsonb_build_object(
      'titulos',   count(*),
      'filmes',    count(*) FILTER (WHERE tipo = 'movie'),
      'series',    count(*) FILTER (WHERE tipo = 'tv'),
      'episodios', sum(episodios),
      'no_indice', count(*) FILTER (WHERE no_indice),
      'populares', count(*) FILTER (WHERE popular),
      'oferta_br', count(*) FILTER (WHERE oferta_br),
      'top30',     (SELECT jsonb_agg(t) FROM (
          SELECT tipo, tmdb_id, titulo, titulo_pt, ano, votos, round(popularidade::numeric, 1) AS popularidade,
                 no_indice, oferta_br, sinopse_pt
            FROM base WHERE 'TH' = ANY (paises) OR idioma = 'th'
           ORDER BY popularidade DESC LIMIT 30) t)
    ) FROM base WHERE 'TH' = ANY (paises) OR idioma = 'th'),

  '8_saem_na_regra_C_mais_populares', (SELECT jsonb_agg(t) FROM (
      SELECT tipo, tmdb_id, titulo, titulo_pt, origem, idioma, ano, votos,
             round(popularidade::numeric, 1) AS popularidade, no_indice, oferta_br
        FROM regras WHERE r_c = false
       ORDER BY popularidade DESC LIMIT 40) t),

  '9_entrada_14_dias', (SELECT jsonb_agg(d ORDER BY d.dia DESC) FROM (
      SELECT to_char(date_trunc('day', criado_em), 'YYYY-MM-DD') AS dia,
             count(*) FILTER (WHERE tipo = 'movie')               AS filmes,
             count(*) FILTER (WHERE tipo = 'tv')                  AS series,
             count(*) FILTER (WHERE grupo = 'EUA')                AS eua,
             count(*) FILTER (WHERE grupo = 'Brasil')             AS brasil,
             count(*) FILTER (WHERE grupo = 'outros')             AS outros,
             count(*) FILTER (WHERE grupo = 'sem pais')           AS sem_pais,
             count(*) FILTER (WHERE NOT acima_cauda)              AS cauda,
             count(*) FILTER (WHERE popular)                      AS populares
        FROM base
       WHERE criado_em >= now() - interval '14 days'
       GROUP BY 1) d),

  '10_portao_idioma_14_dias', (SELECT jsonb_agg(l ORDER BY l.n DESC) FROM (
      SELECT error_code, count(*) AS n
        FROM api_sync_logs
       WHERE created_at >= now() - interval '14 days'
         AND status = 'empty' AND starts_with(error_code, 'language_')
       GROUP BY error_code
       ORDER BY count(*) DESC LIMIT 25) l),

  '11_fila_sync_details_7_dias', (SELECT jsonb_agg(j ORDER BY j.n DESC) FROM (
      SELECT payload ->> 'reason'        AS motivo,
             entity_type::text           AS tipo,
             status::text                AS status,
             COALESCE(last_error_code, '') AS ultimo_erro,
             count(*)                    AS n
        FROM catalog_jobs
       WHERE job_type = 'sync_details'
         AND created_at >= now() - interval '7 days'
       GROUP BY 1, 2, 3, 4
       ORDER BY count(*) DESC LIMIT 40) j)
)) AS relatorio;
