SET default_transaction_read_only = on;

-- ============================================================================
-- verificacao-entrada-e-pais.sql — SO LEITURA. Devolve UMA celula JSON.
-- ============================================================================
-- Acompanha a PR `fix: fecha a entrada do catalogo pelo /changes, recusa de
-- idioma sem dead_letter e pais no payload inalterado` (2026-09-24).
--
-- Rode ANTES do deploy (linha de base) e 24 h DEPOIS. A primeira linha poe a
-- sessao em somente-leitura: qualquer escrita acidental falha em vez de gravar.
--
-- O que cada chave mede, e o que se espera depois do deploy:
--
--   titulos_criados_por_dia
--     Filmes, series e pessoas criados por dia nos ultimos 7 dias (UTC).
--     Antes: ~2.090 titulos/dia, quase todos vindos de `/changes` (todo id
--     alterado no TMDB virava `sync_details`, que CRIAVA o titulo). Depois: a
--     ordem da descoberta diaria (top 2.000 por popularidade, e so os que
--     passam no recorte de idioma) mais os pedidos de leitor.
--
--   sync_details_dead_letter_empty_24h
--     `sync_details` que foram para dead_letter com `last_error_code = 'empty'`
--     nas ultimas 24 h. Era a recusa de idioma virando erro: 5 tentativas e
--     dead_letter (12.993 em 7 dias). Depois: ~0 — a recusa conclui o job como
--     pulado na primeira tentativa. Os dead_letters ANTIGOS continuam la (esta
--     PR nao apaga nada); por isso a janela e de 24 h.
--
--   recusas_de_idioma_24h
--     Linhas `empty` + `language_*` em `api_sync_logs` nas ultimas 24 h. A
--     recusa continua contavel, agora UMA linha por titulo recusado (antes eram
--     ate 5, uma por tentativa).
--
--   changes_ultimas_24h
--     O ciclo de `/changes` por endpoint: ids que vieram do TMDB
--     (`items_processed`), quantos ja estavam no catalogo (`items_updated`),
--     jobs criados (`items_created`) e descartados por nao estarem no catalogo
--     (`items_processed - items_updated`). Antes do deploy estas linhas NAO
--     existem (o `/changes` nao gravava log).
--
--   titulos_com_pais_no_payload_e_sem_pais_gravado
--     Titulos sem NENHUM pais gravado cujo payload mais recente em `api_cache`
--     traz pelo menos um codigo de pais valido. Medido em 24/09: 24 (19 filmes,
--     5 series). Depois de `catalog backfill-countries --apply`: 0.
--
--   titulos_sem_pais
--     Todo titulo sem pais gravado, separado em "payload com pais" (defeito
--     nosso), "payload sem pais" (lista vazia ou sem o campo — dado do TMDB) e
--     "sem payload em api_cache". Contexto para o numero acima.
--
-- CUSTO: `api_cache` nao tem indice em `endpoint`. Os dois blocos de pais
-- fazem UMA varredura de `api_cache` cada (hash join contra os titulos sem
-- pais), nao uma por titulo.
-- ============================================================================

WITH
dias AS (
  SELECT generate_series(
           date_trunc('day', now() AT TIME ZONE 'UTC') - interval '6 days',
           date_trunc('day', now() AT TIME ZONE 'UTC'),
           interval '1 day'
         ) AS dia
),
criados AS (
  SELECT d.dia,
         (SELECT count(*) FROM movies m
           WHERE m.created_at >= d.dia AND m.created_at < d.dia + interval '1 day') AS filmes,
         (SELECT count(*) FROM tv_shows t
           WHERE t.created_at >= d.dia AND t.created_at < d.dia + interval '1 day') AS series,
         (SELECT count(*) FROM people p
           WHERE p.created_at >= d.dia AND p.created_at < d.dia + interval '1 day') AS pessoas
    FROM dias d
),
dead_empty AS (
  SELECT count(*) AS n
    FROM catalog_jobs j
   WHERE j.job_type = 'sync_details'
     AND j.status = 'dead_letter'
     AND j.last_error_code = 'empty'
     AND j.updated_at >= now() - interval '24 hours'
),
recusas AS (
  SELECT count(*) AS n
    FROM api_sync_logs l
   WHERE l.status = 'empty'
     AND l.error_code LIKE 'language\_%'
     AND l.created_at >= now() - interval '24 hours'
),
changes_24h AS (
  SELECT l.endpoint,
         count(*)                                   AS ciclos,
         sum(l.items_processed)                     AS ids_vieram,
         sum(l.items_updated)                       AS ids_no_catalogo,
         sum(l.items_created)                       AS jobs_criados,
         sum(l.items_processed - l.items_updated)   AS ids_descartados_fora_do_catalogo,
         count(*) FILTER (WHERE l.status IN ('failed', 'aborted')) AS ciclos_com_falha
    FROM api_sync_logs l
   WHERE l.provider_api = 'tmdb'
     AND l.endpoint IN ('/movie/changes', '/tv/changes', '/person/changes')
     AND l.created_at >= now() - interval '24 hours'
   GROUP BY l.endpoint
),
-- Titulos SEM nenhum pais gravado, com o endpoint de `api_cache` que os descreve.
sem_pais AS (
  SELECT 'movie'::text AS tipo, m.tmdb_id, '/movie/' || m.tmdb_id::text AS endpoint
    FROM movies m
   WHERE NOT EXISTS (SELECT 1 FROM movie_production_countries x WHERE x.movie_id = m.id)
  UNION ALL
  SELECT 'tv'::text, t.tmdb_id, '/tv/' || t.tmdb_id::text
    FROM tv_shows t
   WHERE NOT EXISTS (SELECT 1 FROM tv_show_origin_countries x WHERE x.tv_show_id = t.id)
),
-- O payload MAIS RECENTE de cada um desses endpoints, reduzido ao campo de pais.
payload_pais AS (
  SELECT DISTINCT ON (c.endpoint)
         c.endpoint,
         CASE WHEN c.endpoint LIKE '/movie/%'
              THEN c.payload -> 'production_countries'
              ELSE c.payload -> 'origin_country' END AS paises
    FROM api_cache c
    JOIN sem_pais s ON s.endpoint = c.endpoint
   WHERE c.provider_api = 'tmdb'
   ORDER BY c.endpoint, c.fetched_at DESC
),
-- Quantos codigos VALIDOS (ISO alfa-2) o payload traz — o mesmo criterio do
-- normalizador da ingestao: filme `[{iso_3166_1}]`, serie `["BR"]`.
classificado AS (
  SELECT s.tipo,
         s.tmdb_id,
         p.endpoint IS NOT NULL AS tem_payload,
         CASE
           WHEN p.endpoint IS NULL OR jsonb_typeof(p.paises) IS DISTINCT FROM 'array' THEN 0
           ELSE (SELECT count(*)
                   FROM jsonb_array_elements(p.paises) e
                  WHERE upper(btrim(CASE WHEN jsonb_typeof(e) = 'object'
                                         THEN e ->> 'iso_3166_1'
                                         ELSE e #>> '{}' END)) ~ '^[A-Z]{2}$')
         END AS codigos_validos
    FROM sem_pais s
    LEFT JOIN payload_pais p ON p.endpoint = s.endpoint
)
SELECT json_build_object(
  'gerado_em', now(),
  'titulos_criados_por_dia', (
    SELECT json_agg(json_build_object(
             'dia', to_char(c.dia, 'YYYY-MM-DD'),
             'filmes', c.filmes,
             'series', c.series,
             'titulos', c.filmes + c.series,
             'pessoas', c.pessoas) ORDER BY c.dia)
      FROM criados c
  ),
  'sync_details_dead_letter_empty_24h', (SELECT n FROM dead_empty),
  'recusas_de_idioma_24h', (SELECT n FROM recusas),
  'changes_ultimas_24h', COALESCE(
    (SELECT json_agg(row_to_json(ch) ORDER BY ch.endpoint) FROM changes_24h ch),
    '[]'::json
  ),
  'titulos_com_pais_no_payload_e_sem_pais_gravado', json_build_object(
    'total',  (SELECT count(*) FROM classificado WHERE codigos_validos > 0),
    'filmes', (SELECT count(*) FROM classificado WHERE codigos_validos > 0 AND tipo = 'movie'),
    'series', (SELECT count(*) FROM classificado WHERE codigos_validos > 0 AND tipo = 'tv'),
    'amostra_tmdb_ids', (
      SELECT json_agg(tipo || ':' || tmdb_id ORDER BY tipo, tmdb_id)
        FROM (SELECT tipo, tmdb_id FROM classificado
               WHERE codigos_validos > 0 ORDER BY tipo, tmdb_id LIMIT 40) a
    )
  ),
  'titulos_sem_pais', json_build_object(
    'total',                    (SELECT count(*) FROM classificado),
    'payload_com_pais',         (SELECT count(*) FROM classificado WHERE codigos_validos > 0),
    'payload_sem_pais',         (SELECT count(*) FROM classificado WHERE tem_payload AND codigos_validos = 0),
    'sem_payload_em_api_cache', (SELECT count(*) FROM classificado WHERE NOT tem_payload)
  )
) AS verificacao;
