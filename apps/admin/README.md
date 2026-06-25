# @screena/admin

Painel interno da Screena (operacao editorial e de dados). Diferente do app
publico `@screena/web`, o **admin pode chamar endpoints internos** (sync,
ratings, geracao offline de `content_blocks`, jobs do entity writer, decisoes
de indexabilidade etc.).

## Fronteira de seguranca (INEGOCIAVEL)

- O **admin** pode acionar endpoints internos e processos offline.
- A **pagina publica indexavel** (`@screena/web`) **nunca** pode chamar API
  externa nem Gemini no render — essa regra vale so para o app publico e
  continua intocada.
- API keys e segredos vivem apenas em variaveis de ambiente do servidor,
  nunca no frontend.
- Todo sync externo gera log (`api_sync_logs`).

> Fase 0: este pacote e um **stub**. Sem app final, sem dependencias
> instaladas.

## Rotas `/admin/*` planejadas

```
/admin/entities         -> visao geral de entidades (filmes, series, pessoas...)
/admin/movies           -> gestao de filmes
/admin/tv               -> gestao de series, temporadas e episodios
/admin/people           -> gestao de pessoas
/admin/sync             -> execucao e auditoria de sync externo (api_sync_logs)
/admin/ratings          -> external_ratings, fontes e licencas (rating_sources, source_licenses)
/admin/watch            -> watch_availability / onde assistir
/admin/content-blocks   -> revisao e publicacao de content_blocks
/admin/entity-writer    -> fila e logs do entity writer (entity_writer_jobs, entity_writer_logs)
/admin/indexability     -> page_indexability_decisions (index/noindex/draft/stale/blocked)
/admin/api-logs         -> api_sync_logs e api_cache
/admin/news-clusters    -> news_clusters e ligacoes entity_news_links
```
