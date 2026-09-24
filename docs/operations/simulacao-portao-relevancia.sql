SET default_transaction_read_only = on;
SET statement_timeout = '10min';

-- ============================================================================
-- simulacao-portao-relevancia.sql — SO LEITURA. Devolve UMA celula JSON.
-- ============================================================================
-- Rode em producao ANTES do merge da PR do portao de relevancia. A primeira
-- linha poe a sessao em somente-leitura: qualquer escrita acidental falha.
--
-- A REGRA (decisao do dono, assinada em 24/09/2026 —
-- docs/seo/DECISOES-DO-DONO-2026-09-24.md). Um filme ou serie FICA no indice se
-- valer qualquer uma destas condicoes:
--   - algum pais de origem e EUA;           (movie_production_countries, qualquer
--   - algum pais de origem e Brasil;         posicao; tv_show_origin_countries)
--   - vote_count_tmdb >= 500;
--   - tem oferta de streaming no Brasil     (QUALQUER linha de watch_availability
--                                            com country_code = 'BR').
-- Qualquer outro sai (noindex, follow + fora do sitemap), inclusive o SEM PAIS.
-- E o MESMO predicado de evaluateRelevanceGate (pagina) e do SQL do sitemap
-- (apps/web/src/server/seo/sitemap-index.ts), com os numeros de
-- packages/config/src/relevance-gate.ts. Se um dia mudarem la, mude aqui.
--
-- "NO INDICE HOJE" e o predicado ATUAL do sitemap de filmes e series: slug
-- canonico pt-BR, titulo original nao vazio, portao de localizacao D3 e decisao
-- efetiva 'index' (com o armamento de 1.000 decisoes de decision-coverage.ts).
-- Temporadas e episodios que saem junto sao os que estao no sitemap HOJE (portao
-- de conteudo de 22/09/2026 + decisao propria) e cuja serie sai.
--
-- O que a sessao local confere antes de seguir (condicoes de PARADA na PR):
--   titulos_que_saem.com_oferta_br deve ser 0;
--   titulos_que_saem.pct_do_catalogo deve ser <= 70.
--
-- INFORMATIVO, NAO MUDA NESTA PR: `pessoas_se_a_filmografia_contasse_o_portao`
-- mede quantas pessoas sairiam do sitemap se o portao de pessoa (D2) passasse a
-- contar so obra relevante. A PR NAO faz isso — e decisao pendente do dono.
--
-- Custo: materializa uma linha por titulo (~110 mil) e, para pessoas, os
-- creditos distintos. Rode fora do pico; o statement_timeout acima e o freio.
-- ============================================================================

WITH
params AS MATERIALIZED (
  SELECT 500::int                  AS votos_min,
         ARRAY['US', 'BR']::text[] AS ancoras,
         'BR'::text                AS pais_oferta,
         'pt-BR'::text             AS idioma,
         ARRAY['pt-BR', 'pt']::text[] AS locales_publicados,
         1000::int                 AS piso_armamento,
         60::int                   AS sinopse_min,
         3::int                    AS guia_min
),
-- Decisao AUSENTE por tipo: com 1.000+ decisoes vigentes o gate arma e a
-- ausencia vale noindex (decision-coverage.ts).
ausencia AS MATERIALIZED (
  SELECT t.tipo,
         CASE WHEN (SELECT count(*) FROM (
                      SELECT 1 FROM page_indexability_decisions d, params p
                       WHERE d.entity_type = t.tipo::"EntityType"
                         AND d.language_code = p.idioma AND d.is_current
                       LIMIT 1000) a) >= (SELECT piso_armamento FROM params)
              THEN 'noindex' ELSE 'index' END AS decisao_ausente
    FROM (VALUES ('movie'), ('tv'), ('season'), ('episode'), ('person')) AS t(tipo)
),
titulos AS MATERIALIZED (
  SELECT 'movie'::text AS tipo, m.id, m.tmdb_id, m.title_original AS titulo,
         COALESCE(m.vote_count_tmdb, 0) AS votos,
         (SELECT array_agg(c.country_code ORDER BY c.position)
            FROM movie_production_countries c WHERE c.movie_id = m.id) AS paises,
         EXISTS (SELECT 1 FROM watch_availability w, params p
                  WHERE w.entity_type = 'movie' AND w.entity_id = m.id
                    AND w.country_code = p.pais_oferta) AS oferta_br
    FROM movies m
  UNION ALL
  SELECT 'tv'::text, t.id, t.tmdb_id, t.name_original,
         COALESCE(t.vote_count_tmdb, 0),
         (SELECT array_agg(c.country_code ORDER BY c.position)
            FROM tv_show_origin_countries c WHERE c.tv_show_id = t.id),
         EXISTS (SELECT 1 FROM watch_availability w, params p
                  WHERE w.entity_type = 'tv' AND w.entity_id = t.id
                    AND w.country_code = p.pais_oferta)
    FROM tv_shows t
),
-- Uma linha por URL de titulo que esta no sitemap HOJE (o predicado atual).
paginas_hoje AS MATERIALIZED (
  SELECT x.tipo, x.id, s.slug
    FROM titulos x
    JOIN params p ON true
    JOIN slugs s ON s.entity_type = x.tipo::"EntityType" AND s.entity_id = x.id
                AND s.language_code = p.idioma AND s.is_canonical = true
    JOIN ausencia au ON au.tipo = x.tipo
   WHERE BTRIM(COALESCE(x.titulo, '')) <> ''
     AND NOT (
       s.slug ~ '^tmdb-[0-9]+$'
       AND NOT EXISTS (
         SELECT 1 FROM entity_translations et
          WHERE et.entity_type = x.tipo::"EntityType" AND et.entity_id = x.id
            AND et.language_code = ANY (p.locales_publicados)
            AND ((BTRIM(COALESCE(et.title, '')) <> ''
                  AND BTRIM(COALESCE(et.title, '')) <> BTRIM(COALESCE(x.titulo, '')))
              OR BTRIM(COALESCE(et.summary, '')) <> ''
              OR BTRIM(COALESCE(et.meta_description, '')) <> '')
       )
     )
     AND COALESCE((SELECT d.decision::text FROM page_indexability_decisions d
                    WHERE d.entity_type = x.tipo::"EntityType" AND d.entity_id = x.id
                      AND d.language_code = p.idioma AND d.is_current = true
                    LIMIT 1), au.decisao_ausente) = 'index'
),
classificado AS MATERIALIZED (
  SELECT x.*,
         COALESCE(x.paises && p.ancoras, false) AS pais_ancora,
         x.votos >= p.votos_min                 AS votos_ok,
         (COALESCE(x.paises && p.ancoras, false) OR x.votos >= p.votos_min OR x.oferta_br) AS fica,
         CASE WHEN x.paises IS NULL THEN '(sem pais)' ELSE x.paises[1] END AS primeiro_pais,
         EXISTS (SELECT 1 FROM paginas_hoje ph WHERE ph.tipo = x.tipo AND ph.id = x.id) AS no_indice_hoje
    FROM titulos x, params p
),
saem AS MATERIALIZED (
  SELECT * FROM classificado WHERE NOT fica
),
-- Series que estao no indice hoje e saem: levam temporadas e episodios junto.
series_saem AS MATERIALIZED (
  SELECT DISTINCT ph.id FROM paginas_hoje ph JOIN saem s ON s.tipo = 'tv' AND s.id = ph.id
   WHERE ph.tipo = 'tv'
),
temporadas_saem AS (
  SELECT count(*) AS n
    FROM seasons se
    JOIN series_saem ss ON ss.id = se.tv_show_id
    JOIN params p ON true
    JOIN ausencia au ON au.tipo = 'season'
   WHERE se.season_number >= 1
     AND (
       char_length(BTRIM(COALESCE(se.overview, ''), E' \t\r\n')) >= p.sinopse_min
       OR (SELECT count(*) FROM (
             SELECT 1 FROM episodes ep
              WHERE ep.season_id = se.id
                AND char_length(BTRIM(COALESCE(ep.overview, ''), E' \t\r\n')) >= p.sinopse_min
              LIMIT 3) g) >= p.guia_min
     )
     AND COALESCE((SELECT d.decision::text FROM page_indexability_decisions d
                    WHERE d.entity_type = 'season' AND d.entity_id = se.id
                      AND d.language_code = p.idioma AND d.is_current = true
                    LIMIT 1), au.decisao_ausente) = 'index'
),
episodios_saem AS (
  SELECT count(*) AS n
    FROM episodes e
    JOIN series_saem ss ON ss.id = e.tv_show_id
    JOIN seasons se ON se.id = e.season_id
    JOIN params p ON true
    JOIN ausencia au ON au.tipo = 'episode'
   WHERE se.season_number >= 1 AND e.episode_number >= 1
     AND char_length(BTRIM(COALESCE(e.overview, ''), E' \t\r\n')) >= p.sinopse_min
     AND BTRIM(COALESCE(e.still_path, '')) <> ''
     AND COALESCE((SELECT d.decision::text FROM page_indexability_decisions d
                    WHERE d.entity_type = 'episode' AND d.entity_id = e.id
                      AND d.language_code = p.idioma AND d.is_current = true
                    LIMIT 1), au.decisao_ausente) = 'index'
),
-- Sem pais que SAEM, mas com pais no payload mais recente do api_cache: sao os
-- que o backfill de pais (PR fix/ingestion-entrada-e-pais) devolve ao indice.
sem_pais_saem AS MATERIALIZED (
  SELECT s.tipo, s.tmdb_id,
         CASE WHEN s.tipo = 'movie' THEN '/movie/' ELSE '/tv/' END || s.tmdb_id::text AS endpoint
    FROM saem s WHERE s.paises IS NULL
),
payload_pais AS MATERIALIZED (
  SELECT DISTINCT ON (c.endpoint)
         c.endpoint,
         CASE WHEN c.endpoint LIKE '/movie/%'
              THEN c.payload -> 'production_countries'
              ELSE c.payload -> 'origin_country' END AS paises
    FROM api_cache c
    JOIN sem_pais_saem sp ON sp.endpoint = c.endpoint
   WHERE c.provider_api = 'tmdb'
   ORDER BY c.endpoint, c.fetched_at DESC
),
sem_pais_com_pais_no_payload AS (
  SELECT sp.tipo, sp.tmdb_id
    FROM sem_pais_saem sp
    JOIN payload_pais pp ON pp.endpoint = sp.endpoint
   WHERE jsonb_typeof(pp.paises) = 'array'
     AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(pp.paises) e
        WHERE upper(btrim(CASE WHEN jsonb_typeof(e) = 'object'
                               THEN e ->> 'iso_3166_1'
                               ELSE e #>> '{}' END)) ~ '^[A-Z]{2}$')
),
-- INFORMATIVO: pessoas. O portao de pessoa conta obra no indice; aqui se mede o
-- que aconteceria se ele contasse so obra que tambem passa na relevancia.
creditos AS MATERIALIZED (
  SELECT person_id, entity_type::text AS tipo, entity_id FROM cast_members
   WHERE entity_type IN ('movie', 'tv')
  UNION
  SELECT person_id, entity_type::text, entity_id FROM crew_members
   WHERE entity_type IN ('movie', 'tv')
),
obras_por_pessoa AS MATERIALIZED (
  SELECT cr.person_id,
         count(*) AS obras_no_indice,
         count(*) FILTER (WHERE c.fica) AS obras_relevantes
    FROM creditos cr
    JOIN (SELECT DISTINCT tipo, id FROM paginas_hoje) ph ON ph.tipo = cr.tipo AND ph.id = cr.entity_id
    JOIN classificado c ON c.tipo = cr.tipo AND c.id = cr.entity_id
   GROUP BY cr.person_id
),
pessoas AS MATERIALIZED (
  SELECT pe.id,
         CASE WHEN BTRIM(COALESCE(pe.biography, '')) <> ''
                AND pe.biography_source_status::text IN ('official', 'licensed', 'third_party')
              THEN 1 ELSE 5 END AS obras_exigidas,
         COALESCE(op.obras_no_indice, 0) AS obras_no_indice,
         COALESCE(op.obras_relevantes, 0) AS obras_relevantes
    FROM people pe
    JOIN params p ON true
    JOIN ausencia au ON au.tipo = 'person'
    JOIN slugs s ON s.entity_type = 'person' AND s.entity_id = pe.id
                AND s.language_code = p.idioma AND s.is_canonical = true
    LEFT JOIN obras_por_pessoa op ON op.person_id = pe.id
   WHERE BTRIM(pe.name) <> ''
     AND BTRIM(COALESCE(pe.profile_path, '')) <> ''
     AND COALESCE((SELECT d.decision::text FROM page_indexability_decisions d
                    WHERE d.entity_type = 'person' AND d.entity_id = pe.id
                      AND d.language_code = p.idioma AND d.is_current = true
                    LIMIT 1), au.decisao_ausente) = 'index'
)
SELECT json_build_object(
  'gerado_em', now(),
  'regra', json_build_object(
    'votos_min', (SELECT votos_min FROM params),
    'paises_ancora', (SELECT ancoras FROM params),
    'oferta', 'qualquer linha de watch_availability com country_code BR'
  ),
  'catalogo', json_build_object(
    'filmes', (SELECT count(*) FROM classificado WHERE tipo = 'movie'),
    'series', (SELECT count(*) FROM classificado WHERE tipo = 'tv'),
    'total',  (SELECT count(*) FROM classificado)
  ),
  'titulos_que_saem', json_build_object(
    'total',  (SELECT count(*) FROM saem),
    'filmes', (SELECT count(*) FROM saem WHERE tipo = 'movie'),
    'series', (SELECT count(*) FROM saem WHERE tipo = 'tv'),
    'pct_do_catalogo', (SELECT round(100.0 * (SELECT count(*) FROM saem) / NULLIF(count(*), 0), 2) FROM classificado),
    'pct_dos_filmes', (SELECT round(100.0 * count(*) FILTER (WHERE NOT fica) / NULLIF(count(*), 0), 2) FROM classificado WHERE tipo = 'movie'),
    'pct_das_series', (SELECT round(100.0 * count(*) FILTER (WHERE NOT fica) / NULLIF(count(*), 0), 2) FROM classificado WHERE tipo = 'tv'),
    'com_oferta_br', (SELECT count(*) FROM saem WHERE oferta_br),
    'sem_pais', json_build_object(
      'filmes', (SELECT count(*) FROM saem WHERE paises IS NULL AND tipo = 'movie'),
      'series', (SELECT count(*) FROM saem WHERE paises IS NULL AND tipo = 'tv')
    ),
    'com_pais_fora_de_eua_br', json_build_object(
      'filmes', (SELECT count(*) FROM saem WHERE paises IS NOT NULL AND tipo = 'movie'),
      'series', (SELECT count(*) FROM saem WHERE paises IS NOT NULL AND tipo = 'tv')
    ),
    'por_primeiro_pais_top40', (
      SELECT json_agg(json_build_object('pais', primeiro_pais, 'filmes', filmes, 'series', series, 'total', total)
                      ORDER BY total DESC, primeiro_pais)
        FROM (SELECT primeiro_pais,
                     count(*) FILTER (WHERE tipo = 'movie') AS filmes,
                     count(*) FILTER (WHERE tipo = 'tv') AS series,
                     count(*) AS total
                FROM saem GROUP BY primeiro_pais
               ORDER BY count(*) DESC, primeiro_pais LIMIT 40) g
    )
  ),
  'titulos_que_ficam_por_motivo', json_build_object(
    'pais_eua_ou_brasil', (SELECT count(*) FROM classificado WHERE pais_ancora),
    'so_pelos_votos', (SELECT count(*) FROM classificado WHERE NOT pais_ancora AND votos_ok),
    'so_pela_oferta_br', (SELECT count(*) FROM classificado WHERE NOT pais_ancora AND NOT votos_ok AND oferta_br)
  ),
  'paginas_de_titulo_indexadas', json_build_object(
    'hoje_filmes', (SELECT count(*) FROM paginas_hoje WHERE tipo = 'movie'),
    'hoje_series', (SELECT count(*) FROM paginas_hoje WHERE tipo = 'tv'),
    'saem_filmes', (SELECT count(*) FROM paginas_hoje ph JOIN saem s ON s.tipo = ph.tipo AND s.id = ph.id WHERE ph.tipo = 'movie'),
    'saem_series', (SELECT count(*) FROM paginas_hoje ph JOIN saem s ON s.tipo = ph.tipo AND s.id = ph.id WHERE ph.tipo = 'tv'),
    'saem_total',  (SELECT count(*) FROM paginas_hoje ph JOIN saem s ON s.tipo = ph.tipo AND s.id = ph.id),
    'ficam_total', (SELECT count(*) FROM paginas_hoje ph JOIN classificado c ON c.tipo = ph.tipo AND c.id = ph.id WHERE c.fica)
  ),
  'urls_que_saem_junto_com_a_serie', json_build_object(
    'series_no_indice_que_saem', (SELECT count(*) FROM series_saem),
    'temporadas', (SELECT n FROM temporadas_saem),
    'episodios', (SELECT n FROM episodios_saem)
  ),
  'top50_mais_votados_que_saem', (
    SELECT json_agg(json_build_object(
             'tipo', tipo, 'tmdb_id', tmdb_id, 'titulo', titulo, 'votos', votos,
             'paises', paises, 'no_indice_hoje', no_indice_hoje)
             ORDER BY votos DESC, tipo, tmdb_id)
      FROM (SELECT * FROM saem ORDER BY votos DESC, tipo, tmdb_id LIMIT 50) t
  ),
  'sem_pais_que_saem_e_tem_pais_no_payload_api_cache', json_build_object(
    'total', (SELECT count(*) FROM sem_pais_com_pais_no_payload),
    'amostra', (SELECT json_agg(tipo || ':' || tmdb_id ORDER BY tipo, tmdb_id)
                  FROM (SELECT * FROM sem_pais_com_pais_no_payload ORDER BY tipo, tmdb_id LIMIT 40) a)
  ),
  'pessoas_se_a_filmografia_contasse_o_portao', json_build_object(
    'nota', 'INFORMATIVO. Nesta PR o portao de pessoa NAO muda; decisao pendente do dono.',
    'pessoas_no_sitemap_hoje', (SELECT count(*) FROM pessoas WHERE obras_no_indice >= obras_exigidas),
    'sairiam', (SELECT count(*) FROM pessoas
                 WHERE obras_no_indice >= obras_exigidas AND obras_relevantes < obras_exigidas)
  )
) AS simulacao;
