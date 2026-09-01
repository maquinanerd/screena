# Medições no PostgreSQL de produção (screen-db) — 2026-09-01

Via DbGate (`rss-prime-screen-db-dbgate.nult1k.easypanel.host`), conexão `screena@screena`.
PostgreSQL 17.11. Todas as consultas são SOMENTE LEITURA.

## Cluster

- BANCOS: `postgres=7510 kB` ; **`screena=10 GB`** ; `template1=7582 kB`
- CONEXÕES no momento da medição: `postgres/screena=1` ; `screena/screena=31`
- ÍNDICES: **total=330, nunca usados (idx_scan=0)=143 (43,3%), 122,3 MB desperdiçados**
- EXTENSÕES: `plpgsql`, `pgcrypto`, `unaccent`, `pg_trgm` — **`pg_stat_statements` NÃO instalado**
- 90 tabelas em `public`

## Tabelas por tamanho (reltuples estimado / tamanho total)

| # | tabela | linhas (est.) | tamanho |
| --- | --- | --- | --- |
| 1 | api_cache | 543.936 | **5.075 MB** |
| 2 | episodes | 3.728.290 | 926 MB |
| 3 | tmdb_images | 2.175.848 | 806 MB |
| 4 | cast_members | 2.798.041 | 745 MB |
| 5 | title_recommendations | 2.569.085 | 577 MB |
| 6 | entities | 5.346.761 | 449 MB |
| 7 | crew_members | 1.615.670 | 436 MB |
| 8 | people | 1.288.664 | 380 MB |
| 9 | catalog_jobs | 513.549 | 302 MB |
| 10 | api_sync_logs | 471.163 | 103 MB |
| 11 | search_documents | 140.523 | 74 MB |
| 12 | tmdb_videos | 103.688 | 73 MB |
| 13 | entity_external_ids | 214.716 | 67 MB |
| 14 | entity_translations | 138.609 | 55 MB |
| 15 | slugs | 144.045 | 44 MB |
| 16 | watch_availability | 70.268 | 40 MB |
| 17 | seasons | 139.492 | 32 MB |
| 18 | cinerie_score_calculations | 52.833 | 27 MB |
| 19 | tmdb_raw | 300 | 26 MB |
| 20 | movies | 47.518 | 23 MB |
| 21 | tv_shows | 33.822 | 18 MB |

`api_cache` sozinho é ~50% do banco.

## Contagens EXATAS (count(*)) das tabelas com reltuples < 100.000

movie_genres=91367 ; watch_availability=70869 ; tv_show_genres=60603 ;
cinerie_score_calculations=52833 ; movie_production_countries=52327 ;
**movies=48613** ; tv_show_origin_countries=35567 ; **tv_shows=34701** ;
discovery_snapshot_items=1994 ; **external_ratings=1507** ; entity_news_links=634 ;
redirects=479 ; **tmdb_raw=300** ; editorial_projection_receipts=297 ;
entity_awards=182 ; data_usage_decisions=172 ; article_translations=164 ;
**articles=164** ; **page_indexability_decisions=164** ; source_licenses=163 ;
editorial_media_assets=134 ; discovery_snapshots=105 ; watch_provider_aliases=44 ;
**genres=35** ; **watch_providers=33** ; _prisma_migrations=28 ;
tmdb_sync_checkpoint=21 ; user_auth_throttles=15 ; countries=13 ; user_lists=9 ;
user_consent_records=8 ; api_providers=7 ; user_viewing_events=7 ;
user_auth_audit_logs=6 ; rating_sources=5 ; **languages=3** ; user_sessions=3 ;
user_password_credentials=2 ; user_verification_tokens=2 ; user_watch_states=2 ;
**users=2** ; tmdb_image_config=1

## Tabelas com EXATAMENTE ZERO linhas (29)

article_source_links, collections, **content_blocks**, data_migration_quarantine,
editorial_sources, entity_alternative_titles, entity_keywords,
entity_reference_orphans, **entity_writer_jobs**, **entity_writer_logs**,
hero_curation_decisions, keywords, movie_collection_memberships,
movie_production_companies, networks, production_companies, source_items,
tv_networks, tv_production_companies, user_accounts, user_blocks,
user_data_requests, user_episode_progress, user_import_jobs, user_list_items,
user_profiles, user_ratings, user_recommendation_feedback,
user_recommendation_snapshots, user_review_reports, user_reviews,
user_stats_snapshots

## Leituras diretas destes números

1. **`content_blocks = 0`.** A camada editorial de IA — o "diferencial competitivo"
   declarado no `CLAUDE.md` (invariantes 12 e 13, seção 9) — **não tem uma única
   linha em produção**. `entity_writer_jobs=0` e `entity_writer_logs=0` confirmam:
   o Entity Writer nunca rodou em produção.
2. **`languages = 3`.** O recorte de cinco idiomas (pt, en, es, ja, ko) do PR #260
   não chegou ao dado de produção. A guarda de FK continua com 3 linhas.
3. **`external_ratings = 1.507` para 48.613 filmes + 34.701 séries** = 1,8% das
   obras têm alguma nota externa persistida.
4. **`page_indexability_decisions = 164`** para 5,3 M de `entities`.
5. **`tmdb_raw = 300`** — o espelho bruto está praticamente vazio.
6. **Dicionários de catálogo vazios**: `genres=35` existe, mas `keywords`,
   `collections`, `networks`, `production_companies`, `tv_networks` estão em ZERO,
   e as tabelas de ligação (`movie_production_companies`, `tv_production_companies`,
   `entity_keywords`, `movie_collection_memberships`) também.
7. **`users = 2`** — a plataforma de usuário existe em código e não em uso.
8. **143 de 330 índices nunca foram usados** (43,3%), custando 122 MB.
9. `api_cache` com 5 GB é metade do banco.
