# Runbook — Sync incremental do catalogo

> Operacional (pt-BR). Worker-only, offline; gera log em `api_sync_logs`. Mantem o
> catalogo fresco sem revarrer o universo inteiro.

## Objetivo

Refrescar apenas o que mudou/expirou, respeitando as periodicidades-alvo
(`.claude/rules/ingestion.md`): detalhe 7–14 dias, lancamentos/onde-assistir
diario, ratings 12–24h, trending 6–12h, trailers/imagens 7 dias.

## Sinais de frescor

- `last_synced_at` / `stale_after` nas tabelas de entidade decidem o que esta
  stale (`now > last_synced_at + stale_after` → prioriza refresh).
- Checkpoints de paginacao em `tmdb_sync_checkpoint` (job + params_hash) permitem
  retomar listas/discover de onde pararam.

## Fila `CatalogJob` no incremental

Enfileire jobs de refresh com idempotencia e prioridade (menor `priority` =
reivindicado antes):

```ts
await jobs.enqueue({
  jobType: 'sync_details',
  entityType: 'movie',
  externalId: String(tmdbId),
  priority: isRecentRelease ? 10 : 100,
  idempotencyKey: buildIdempotencyKey({
    jobType: 'sync_details', entityType: 'movie', externalId: String(tmdbId),
    discriminator: staleBucket, // ex.: 'daily-2026-07-16'
  }),
})
```

O `discriminator` (janela/bucket) evita que dois ciclos do mesmo dia colidam num
noop indevido, mas mantem idempotencia dentro do ciclo.

## Retry, backoff e degradacao

- Falha transitoria → `retry_wait` com backoff exponencial + jitter
  (`computeJobBackoffMs`), reivindicavel de novo quando `available_at` chega.
- Circuit breaker vive no client TMDB (`api-clients/tmdb`): em aberto, o worker
  degrada graciosamente (serve do `api_cache`/tabelas finais) e loga — nunca cai
  para chamada no render.
- Hash de payload: sem mudanca, nao reescreve nem bumpa `updated_at` — so
  atualiza o carimbo de verificacao.

## `/changes` — incremental EXECUTANDO

A execucao e real (`runChangesSync` + handler `sync_changes`), com checkpoint
transacional em `tmdb_sync_checkpoint` (job `changes:{kind}`):

```
# janela explicita, retomavel (maximo 14 dias — teto do provider)
pnpm catalog changes --entity movie,tv,person --from 2026-07-15 --to 2026-07-16 --resume --apply
```

Garantias (ver [ADR 0012 §7](../adr/0012-complete-catalog-platform.md)):
- **checkpoint so avanca no COMMIT** (jobs do lote + checkpoint na MESMA
  transacao; falha = rollback sem avanco; a retomada reprocessa a pagina e o
  enqueue idempotente nao duplica);
- janela ja concluida e **noop**; pagina vazia sem `total_pages` encerra;
- teto duro de 500 paginas/kind (provider sem `total_pages` nao vira loop);
- item `adult: true` e descartado fail-closed;
- cada id alterado enfileira `sync_details` com prioridade 50 (mudanca upstream
  fura a fila do backfill, que usa 100).

## Verificacao

- `SELECT count(*) FROM catalog_jobs WHERE status='retry_wait';` — deve drenar
  com o tempo (backoff), nao crescer sem limite.
- Reclaim de orfaos: o `pnpm catalog worker` roda `reclaimOrphans` no start e
  periodicamente — worker morto por SIGKILL/OOM nao deixa jobs presos em
  `running`.
- `SELECT job, last_page, total_pages, done FROM tmdb_sync_checkpoint WHERE job LIKE 'changes:%';`
