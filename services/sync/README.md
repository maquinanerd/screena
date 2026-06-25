# services/sync

Servico de **orquestracao de sincronizacao**.

> **Escopo da Fase 2** (`docs/PHASE_2_TMDB_PLAN.md`): nesta fase o `services/sync`
> coordena **apenas o sync estrutural do TMDB** — entidades importadas **por ID
> explicito / lista curada de dev** e o **refresh por politica de frescor
> (stale)**. Orquestracao de `ratings`, `streaming`, `news-ingestion` e
> `entity-writer` sao **fases futuras** (roadmap em `docs/BUILD_PLAN.md`), ainda
> nao implementadas aqui.
>
> Nesta fase **nao ha** discovery (popular/trending/changes), **nao ha**
> indexacao, publicacao nem geracao de paginas.

## O que faz (Fase 2)
- Seleciona entidades **stale** (`stale_after` nulo ou vencido) e as **reimporta
  por ID** via `@screena/ingestion` (reusando cache, log e upsert idempotente).
- Define a **politica de frescor** pura em `src/stale-policy.ts`
  (`staleAfterFrom` / `isStale`), testada sem rede/DB.
- Mantem a observabilidade: cada reimport gera log em `api_sync_logs` (feito pela
  ingestao).

## Fora do escopo nesta fase (fases futuras)
- Orquestrar `ratings` / `streaming` / `news-ingestion` / `entity-writer`.
- Discovery TMDB (popular / trending / changes) e import em massa.
- Qualquer decisao de indexacao, publicacao ou render de pagina.

## Como roda
- **TypeScript/Node, sempre offline** (Fase 2). `src/stale-policy.ts` e a politica
  PURA (testada); `bin/run.ts` e o runner que seleciona entidades stale e
  reimporta via `@screena/ingestion`. Disparado por **systemd timers**
  (`systemd/*.service` + `*.timer`) na VPS.
- **NUNCA e chamado no render publico.** Nenhuma pagina indexavel aciona sync.

## Resiliencia
- Cache, retry/backoff, rate-limit e circuit-breaker vivem no client TMDB
  (`api-clients/tmdb`) e na ingestao; o sync apenas dispara e respeita a stale
  policy. Janela-alvo do catalogo: 7-14 dias.

## Invariantes aplicaveis
- **Zero API externa no render** — toda coordenacao de fetch ocorre offline.
- **Todo sync externo gera log** (`api_sync_logs`) — sem excecao.
- **API keys so em env vars** — nunca no frontend.
- **provider_api != rating_source** — orquestracao tecnica nao define fonte
  editorial (e nesta fase nao toca ratings).
