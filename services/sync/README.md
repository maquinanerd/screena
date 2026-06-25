# services/sync

Servico de **orquestracao de sincronizacao**. Coordena a execucao periodica dos demais
servicos worker (`ingestion`, `ratings`, `streaming`, `news-ingestion`, `entity-writer`),
controla agendamento, ordem de dependencia e observabilidade central de todo sync externo.

## O que faz
- Agenda e dispara os ciclos de cada worker na ordem correta de dependencia
  (entidades -> ratings/streaming/noticias -> entity-writer).
- Centraliza politicas de **cache**, **retry/backoff**, **rate-limit** e
  **circuit-breaker** compartilhadas pelos api-clients.
- Consolida observabilidade: garante que **todo sync externo gera log** em
  `api_sync_logs` (provedor, entidade, status, contagem, duracao).
- Aplica decisoes de reprocessamento (entidades `updated_at`, jobs pendentes,
  `page_indexability_decisions` em estado `stale`).

## Como roda
- **TypeScript/Node, sempre offline** (Fase 2, `docs/PHASE_2_TMDB_PLAN.md`).
  `src/stale-policy.ts` e a politica de frescor PURA (testada); `bin/run.ts` e o runner
  que seleciona entidades stale e reimporta via `@screena/ingestion`. Disparado por
  **systemd timers** (`systemd/*.service` + `*.timer`) na VPS.
- **NUNCA e chamado no render publico.** Nenhuma pagina indexavel aciona sync.

## Resiliencia obrigatoria
- **Cache**, **retry** com **backoff**, **rate-limit**, **circuit-breaker** e **logs**
  sao requisitos transversais aplicados aqui de forma consistente a todos os clientes.

## Invariantes aplicaveis
- **Todo sync externo gera log** — sem excecao.
- **Zero API externa no render** — toda coordenacao de fetch ocorre offline.
- **API keys so em env vars** — nunca no frontend.
- **provider_api != rating_source** — orquestracao tecnica nao define fonte editorial.
- **Dados sem licenca clara nao aparecem** em pagina indexavel.
- **pt-BR primeiro** — pipelines de traducao en/es geram `draft`/`noindex`.
