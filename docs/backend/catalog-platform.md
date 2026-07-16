# Plataforma de catalogo em escala (Backend A)

> Documento operacional. Idioma pt-BR; codigo/identificadores em ingles. Fonte de
> governanca: `CLAUDE.md` (13 invariantes). Decisao de arquitetura:
> [ADR 0012](../adr/0012-complete-catalog-platform.md).

Este documento descreve os **primitivos novos** do catalogo em escala entregues no
Backend A: a **fila duravel de jobs** (`CatalogJob`) e a **busca PostgreSQL**
(`SearchDocument`), alem do pacote de **contratos publicos**
(`@screena/public-contracts`). Nao repete o que ja existia (Fases 6–11: catalogo
TMDB, midia, discovery/changes planejados, streaming, ratings, Gemini offline).

## Fluxo mental

```
API externa → worker offline (com log em api_sync_logs) → PostgreSQL
   → [CatalogJob: fila duravel orquestra a ingestao/normalizacao]
   → [SearchDocument: projecao denormalizada da busca]
   → Next le PostgreSQL/cache → render (zero API externa, zero Gemini)
```

Tudo aqui e **worker/infra-only**. Nenhuma destas tabelas e lida no caminho de
render de pagina indexavel.

## 1. Fila duravel de jobs (`CatalogJob`)

Generaliza o padrao provado do `EntityWriterJob` para a ingestao. Uma unica fila
`catalog_jobs` com claim concorrente-seguro.

- **Enum `CatalogJobType`**: `bootstrap`, `discover_ids`, `sync_details`,
  `sync_credits`, `sync_external_ids`, `sync_media`, `sync_seasons`,
  `sync_episodes`, `sync_lists`, `sync_changes`, `reprocess_raw`.
- **Enum `CatalogJobStatus`**: `pending` → `claimed`/`running` → `succeeded` |
  `retry_wait` (backoff) → `dead_letter` (esgotou) | `cancelled`.
- **Idempotencia**: `idempotency_key` unico. Enfileirar a mesma chave duas vezes
  e **noop** (`created=false`). Deriva de `buildIdempotencyKey({ jobType,
  entityType, externalId, discriminator })`.
- **Claim** (`FOR UPDATE SKIP LOCKED`, `ORDER BY priority ASC, available_at ASC`):
  dois workers nunca pegam o mesmo job; `attempts` incrementa no claim.
- **Heartbeat**: worker atualiza `heartbeat_at` enquanto processa; habilita
  reclaim de orfaos (worker morto).
- **Retry + dead-letter**: ao falhar, `planFailure(attempts, maxAttempts)` decide
  `retry_wait` (com `available_at = now + backoff exponencial+jitter`) ou
  `dead_letter` quando esgota as tentativas.
- **Reclaim**: `reclaimOrphans(timeoutMs)` recupera jobs em voo cujo heartbeat
  expirou (trata como falha → retry ou dead-letter).
- **Replay**: `replayDeadLetter(ids?)` traz dead-letters de volta a `pending`
  (attempts=0), decisao operacional/humana.

### Onde mora o codigo

| Camada | Local | Typecheck |
| --- | --- | --- |
| Planejadores puros (retry/reclaim/replay/backoff/idempotency) | `services/ingestion/src/catalog-jobs/` | sim (+ testes) |
| Porta da persistencia | `services/ingestion/src/catalog-jobs/store-port.ts` | sim |
| Adapter Prisma (claim SKIP LOCKED, heartbeat, ...) | `services/ingestion/src/persistence/catalog-job-store.ts` | excluido |

## 2. Busca PostgreSQL (`SearchDocument`)

Projecao denormalizada, 1 linha por `(entity_type, entity_id, locale)`, so
entidades **renderaveis** (movie/tv/person).

- Extensoes `unaccent` + `pg_trgm`; wrapper **IMMUTABLE** `immutable_unaccent`.
- `normalized_text` = dobra (sem acento, minusculo) de `primary_text` + aliases.
  O termo de busca e dobrado do mesmo jeito em JS → casamento deterministico.
- Indices: GIN trgm em `normalized_text` + GIN trgm funcional
  `immutable_unaccent(lower(primary_text))`.
- **Ranking**: titulo exato > alias exato > prefixo > fuzzy (trgm); desempate por
  similaridade → popularidade → ano → id.
- **Seguranca**: consulta parametrizada ($1..$5), sem concatenacao do termo;
  limite (≤ 50) e offset com clamp; paginas de resultado sempre **noindex**.

| Camada | Local | Typecheck |
| --- | --- | --- |
| Dobra + projecao + construtor de consulta (puros) | `services/ingestion/src/search/` | sim (+ testes) |
| Adapter Prisma (upsert + execucao da consulta) | `services/ingestion/src/persistence/search-store.ts` | excluido |

## 3. Contratos publicos (`@screena/public-contracts`)

Tipos + validadores PUROS (sem zod, sem Prisma) da fronteira getters↔render —
e agora tambem a PRODUCAO deles: os 10 getters (`createPublicPayloadReader`)
leem o PostgreSQL e devolvem payloads validados pelo proprio contrato. Ver
[docs/contracts/public-catalog-contracts.md](../contracts/public-catalog-contracts.md).
O helper canonico `buildTmdbImageUrl` vive neste pacote (`media-url.ts`) — o
UNICO arquivo de producao do repo com o host do CDN (audit repo-wide + teste).

## 4. Handlers, CLI e execucao

- Handlers reais dos 11 job types + registry:
  [catalog-job-handlers](catalog-job-handlers.md).
- CLI unificada `pnpm catalog` (14 comandos; dry-run estrutural; gate de
  producao; exit codes): [catalog-cli](catalog-cli.md).
- Projecao de busca (backfill/incremental/status):
  [search-projection](search-projection.md).
- Snapshots de descoberta (hash-noop, TTL, identidade):
  [discovery-snapshots](discovery-snapshots.md).

## 5. Validacao

`pnpm validate:catalog-platform-complete` sobe um PostgreSQL 16 efemero
(`embedded-postgres`) e prova, no banco real, **78 checks**: migration do zero,
extensoes/funcao, fila completa (enqueue idempotente, claim SKIP LOCKED +
prioridade, heartbeat, retry→retry_wait, dead-letter, reclaim, replay), busca
exact/alias/acento/prefixo/fuzzy, o PIPELINE dos 11 handlers (bootstrap
idempotente/resume, cascata drenando sem dead-letter, changes com
commit/rollback/noop, snapshot hash-noop, metricas sem alta cardinalidade,
audit read-only) e os CONTRATOS fail-closed (midia/rating/oferta bloqueados
nunca chegam; JSON-safe; 404 tecnico = null). Step proprio no CI, mais o gate
`pnpm typecheck:catalog-runtime` (o wiring operacional compila).

## Metricas

Emitidas nos fluxos reais (worker + handlers), com labels restritas a
`ALLOWED_METRIC_LABELS` (nunca entity_id/tmdb_id/query/request_id):
`catalog_jobs_total`, `catalog_jobs_failed_total`,
`catalog_jobs_dead_letter_total`, `catalog_entities_synced_total`,
`catalog_sync_duration_seconds`, `catalog_checkpoint_lag_seconds`,
`tmdb_requests_total`, `tmdb_rate_limit_total`,
`search_query_duration_seconds`, `search_zero_results_total`,
`search_documents_total`, `discovery_snapshot_age_seconds`,
`media_coverage_ratio`, `trailer_coverage_ratio`.

## Runbooks

- [Bootstrap](../runbooks/catalog-bootstrap.md)
- [Sync incremental](../runbooks/catalog-incremental-sync.md)
- [Dead-letter](../runbooks/catalog-dead-letter.md)
- [Auditoria em producao](../runbooks/catalog-production-audit.md)
