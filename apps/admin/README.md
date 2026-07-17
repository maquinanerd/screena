# @screena/admin

Painel interno da Cinerie (operacao editorial e de dados). Diferente do app
publico `@screena/web`, o admin e uma superficie privada; em fases futuras ele
podera acionar endpoints internos (sync, ratings, geracao offline de
`content_blocks`, jobs do entity writer, decisoes de indexabilidade etc.).
**Na fatia atual, porem, ele e estritamente somente leitura.**

`@screena/admin` e namespace tecnico legado; a marca publica atual e **Cinerie**.

## Fronteira de seguranca (INEGOCIAVEL)

- O **admin futuro** podera acionar endpoints internos e processos offline.
  A fatia atual **nao** aciona endpoints internos, nao publica, nao edita e nao
  escreve.
- A **pagina publica indexavel** (`@screena/web`) **nunca** pode chamar API
  externa nem Gemini no render — essa regra vale so para o app publico e
  continua intocada.
- API keys e segredos vivem apenas em variaveis de ambiente do servidor,
  nunca no frontend.
- Todo sync externo gera log (`api_sync_logs`).

> Estado atual (Fase 6A): existe um **admin editorial minimo em modo SOMENTE
> LEITURA**. Ele apenas visualiza o estado de revisao; nao publica, nao edita,
> nao escreve no banco. O admin editorial completo (escrita, revisao, decisoes)
> ainda nao esta funcional.

## Fase 6A — Admin editorial read-only

App Next.js (App Router) que le o PostgreSQL local **server-side** via
`@screena/db/server` e renderiza contagens/listagens do estado editorial. Nesta
fase, tudo e **somente leitura**:

- Sem escrita Prisma (`create`/`update`/`delete`/`upsert`/`*Many` sao proibidos
  e travados por `tests/admin/readonly-guard.test.ts`).
- Sem UI de escrita: nenhum `<form>`, botao de publicar/salvar/excluir ou editor
  (travado por `tests/admin/pages-no-write.test.ts`).
- Sem API externa/TMDB/Gemini: a unica fonte e o PostgreSQL local.
- Contagens sao numeros reais (`count`/`groupBy`); banco vazio -> zeros, sem
  dado ficticio.

Telas: `/` (dashboard), `/articles`, `/content-blocks`, `/health`. A logica de
classificacao/agregacao vive pura em `src/lib/editorial-status.ts` (testada) e
espelha os helpers confiaveis do app publico (trava em
`tests/admin/editorial-status-mirror.test.ts`). A camada de dados server-only
vive em `src/server/*`.

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
