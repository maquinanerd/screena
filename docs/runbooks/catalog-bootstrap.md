# Runbook — Bootstrap do catalogo

> Operacional (pt-BR). Pre-requisitos: `DATABASE_URL` do Postgres do worker (nunca
> o do render) e, para sync real, `TMDB_READ_ACCESS_TOKEN`. Tudo roda **offline**,
> fora do render, e gera log em `api_sync_logs`. Nunca em producao sem `--apply`.

## Objetivo

Popular o catalogo do zero: taxonomias/config, descoberta de IDs e enfileiramento
dos jobs de detalhe. A ordem de enriquecimento e orquestrada pela fila duravel
`CatalogJob` (ver [catalog-platform](../backend/catalog-platform.md)).

## Caminho principal: CLI unificada

O bootstrap orquestrado roda pela CLI `pnpm catalog` (ver
[catalog-cli](../backend/catalog-cli.md)). Ele NAO baixa tudo de forma sincrona:
ENFILEIRA as etapas e a fila cascateia (`discover_ids` -> `sync_details` ->
`sync_media`/`sync_seasons` -> `sync_episodes`, + snapshots de lista):

```
# planejar (nao toca nada — sem Prisma, sem TMDB, sem cota)
pnpm catalog bootstrap --strategy daily-exports --entity movie,tv,person --limit 1000 --dry-run

# enfileirar de verdade
pnpm catalog bootstrap --strategy daily-exports --entity movie,tv,person --limit 1000 --apply

# processar a fila (shutdown gracioso: SIGINT/SIGTERM drenam o que esta em voo)
pnpm catalog worker --concurrency 4 --max-jobs 0

# acompanhar
pnpm catalog status --json
```

Retomada: reusar o MESMO `--request-id` retoma a execucao sem duplicar (as
chaves de idempotencia carregam o id); omitido, cada run ganha um id novo.
**Jobs enfileirados != catalogo preenchido** — o relatorio do bootstrap conta
enqueues; quem preenche e o worker.

## Passos legados (CLIs separadas, continuam validos)

1. **Config + taxonomias** (imagens, generos, certificacoes):
   ```
   corepack pnpm --filter @screena/ingestion exec tsx bin/sync-tmdb-config.ts --apply
   corepack pnpm --filter @screena/ingestion exec tsx bin/sync-tmdb.ts genres --apply
   ```
2. **Descoberta de IDs** (Daily ID Exports → fila NDJSON, sem custo de cota):
   ```
   corepack pnpm --filter @screena/ingestion exec tsx bin/discover-ids.ts --apply
   ```
3. **Raw sync** (detalhe bruto → `tmdb_raw`, idempotente por hash):
   ```
   corepack pnpm --filter @screena/ingestion exec tsx bin/sync-tmdb-raw.ts --apply
   ```
4. **Promocao** (`tmdb_raw` → tabelas tipadas + slug + traducao):
   ```
   corepack pnpm --filter @screena/ingestion exec tsx bin/promote-tmdb-raw.ts --apply --kind=movie
   ```
5. **Projecao de busca**: apos promover, projete as entidades renderaveis em
   `search_documents` via `buildSearchDocument` + `createPrismaSearchStore`
   (a CLI de projecao de busca e trabalho seguinte; o contrato/adapter ja existem).

## Enfileirando via `CatalogJob`

A fila e a forma canonica de orquestrar em escala (idempotente, com retry e
dead-letter). Exemplo conceitual (worker):

```ts
const jobs = createPrismaCatalogJobStore(prisma)
await jobs.enqueue({
  jobType: 'sync_details',
  entityType: 'movie',
  externalId: '603',
  idempotencyKey: buildIdempotencyKey({ jobType: 'sync_details', entityType: 'movie', externalId: '603' }),
})
```

Enfileirar a mesma chave de novo e **noop** (seguro reexecutar o bootstrap).

## Verificacao

- `SELECT status, count(*) FROM catalog_jobs GROUP BY status;` — nenhum
  `dead_letter` inesperado.
- `SELECT count(*) FROM search_documents;` — cresce conforme a promocao.
- Todo ciclo tem 1 linha em `api_sync_logs` (regra de ingestao).

## Seguranca / governanca

- `--apply` aborta em producao (fail-closed); dry-run e o default.
- Nenhuma chamada externa no render. Chaves so em env var.
- Dado sem licenca clara nunca vira pagina indexavel (invariante 6).
