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

O ESCOPO editorial (quais titulos, com que frequencia, e a regra de pessoa) e
normativo e vive em [catalog-editorial-scope](../backend/catalog-editorial-scope.md).
Nao amplie o escopo sem atualizar aquele documento na mesma PR.

### Slug e traducao saem do proprio `sync_details`

Desde a entrega do Prompt 03, o job `sync_details` FINALIZA a entidade: alem do
upsert tipado, grava o **slug canonico pt-BR** (com 301 quando o canonico muda) e
a **traducao**. Antes disso so a promocao de `tmdb_raw` finalizava, e um
bootstrap pela fila enchia `movies`/`tv_shows`/`people` sem gerar **nenhuma URL
publica** — sem slug nao ha rota, nao ha entrada de busca (o backfill pagina por
slug) e nao ha linha de sitemap.

Limite conhecido: a finalizacao acontece quando houve upsert. No short-circuit de
cache (payload sem mudanca) nao ha id para finalizar. Uma entidade importada
ANTES desta mudanca, cujo payload nao mudou desde entao, continua sem slug — para
essas, use `catalog enqueue reprocess_raw` ou force um re-sync.

### Evidencia reproduzivel do bootstrap

```
corepack pnpm --filter @screena/ingestion exec tsx \
  scripts/bootstrap-evidence-real-postgres.ts --env-file=<path/.env> --out=<path/report.json>
```

Sobe um PostgreSQL 16 EFEMERO (embedded-postgres), migra do zero, roda
dry-run -> bootstrap -> worker, e emite censo ANTES/DEPOIS + amostras reais +
uma segunda passada para provar IDEMPOTENCIA. Nunca toca producao: forca
`DATABASE_URL` e `NODE_ENV=development` no ambiente dos filhos, que TEM
precedencia sobre `--env-file` no Node. O `--env-file` serve so para o processo
filho ler a credencial TMDB — a chave nunca e impressa nem persistida.

### PRE-REQUISITOS obrigatorios (falham feio se pulados)

Contra um banco recem-migrado, `catalog bootstrap` **nao funciona sozinho**. Ele
nao enfileira nem o seed de referencia nem as taxonomias, e varias FKs dependem
deles. A ordem correta e:

```
# 1. tabelas de referencia (api_providers, languages, countries, rating sources)
#    Seguro a qualquer momento: desde 2026-08-12 o seed CRIA licenca de fonte
#    quando falta e PULA quando ja existe (voce vera "PULADA" no log). Antes
#    disso ele sobrescrevia a licenca vigente e rebaixava a autorizacao do
#    proprietario para `unknown` — ver docs/legal/2026-08-12-remediacao-decisoes-legadas.md
corepack pnpm --filter @screena/db db:seed

# 2. taxonomias + configuracao de imagens do TMDB
corepack pnpm --filter @screena/ingestion exec tsx bin/sync-tmdb.ts taxonomies --apply
corepack pnpm --filter @screena/ingestion exec tsx bin/sync-tmdb-config.ts --apply

# 3. so entao o bootstrap
pnpm catalog bootstrap ... --apply && pnpm catalog worker ...
```

Sintomas de ter pulado cada passo:

| Pulou | Erro |
| --- | --- |
| `db:seed` | `api_sync_logs_provider_api_fkey` — morre na PRIMEIRA escrita de log, antes de tocar catalogo |
| taxonomias | `P2003` em `movies.original_language` / `tv_shows.original_language` -> `languages` |

Nos dois casos o worker reporta `retry_wait` e **nenhuma entidade persiste**,
com a fila parecendo saudavel. Se o censo mostrar jobs rodando e entidades em
zero, suspeite daqui primeiro.

### Encoding do banco: UTF8, nao o default do SO

Payload real do TMDB tem turco (`İ`), tailandes, cirilico e grego. Um cluster
criado com o locale do Windows nasce **WIN1252** e a gravacao em `api_cache`
morre com `character with byte sequence 0x.. has no equivalent in encoding
WIN1252`, derrubando todo `sync_details`. Crie o cluster com
`--encoding=UTF8 --locale=C`. Os validadores PG16 do repo nao pegam isso porque
usam dados sinteticos ASCII — so dado real expoe.

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
   Para uma amostra de dev, a flag é `--max-per-type=N` (não `--limit`, que é
   do `pnpm catalog bootstrap`): ela seleciona o **top-N por popularidade** de
   cada export — lê o arquivo inteiro e nunca corta prefixo, então a amostra
   contém os títulos que o público procura, não os ids mais antigos do TMDB.
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
