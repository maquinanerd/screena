# ADR 0006 — Cobertura do catálogo TMDB (Fase 6)

- Status: aceito (implementação em PR **draft** para revisão; incremento de F6).
- Data: 2026-07-15.
- Contexto: após [[0005-api-coverage-registry]] (Fase 5, registro de cobertura), a
  superfície TMDB implementada era detalhe-cêntrica (movie/tv/season/episode/person
  detail + `/movie/upcoming`). Muitos endpoints de catálogo (configuração,
  taxonomias, listas, discover, busca, changes) estavam registrados como
  `not_applicable`/roadmap. A Fase 6 amplia o **client tipado** para todo o catálogo,
  entrega o primeiro **worker de taxonomia** end-to-end (raw capture + normalização
  de `/configuration`) e mantém o registro F5 fiel ao código, com `api:coverage` verde.

## Fonte externa (contrato TMDB)

Os endpoints seguem a **API TMDB v3 REST** (developer.themoviedb.org/reference),
estáveis e canônicos: `/configuration`, `/configuration/{countries,languages,jobs}`,
`/genre/{movie,tv}/list`, `/certification/{movie,tv}/list`, `/discover/{movie,tv}`,
`/search/{movie,tv,person,multi}`, `/{movie,tv}/{popular,top_rated,...}`,
`/{movie,tv,person}/changes`. Auth v4 Bearer (preferida) / v3 `api_key`; GET-only;
paginação `page`/`total_pages`/`total_results`.

> Nota de honestidade (revisão): os DTOs são **subsets defensivos** de transporte
> (todos os campos opcionais), não o schema completo do TMDB. Uma auditoria de
> completude campo-a-campo contra a documentação oficial atual — e a ativação dos
> workers de execução de discover/busca/listas/changes — é **follow-up de F6/F8**
> (por isso a PR é draft). Nenhuma chamada real ao TMDB foi feita nesta fase.

## Decisão

### Client de catálogo (`api-clients/tmdb/src/catalog.ts`)
- `createTmdbCatalogEndpoints(client, config)` com 24 métodos tipados, todos GET via
  o `TmdbHttpClient` existente (throttle/retry/breaker/`Retry-After`, token só no
  header/`api_key`; nunca em log). DTOs em `catalog-types.ts`.
- **Discover**: filtros validados contra allowlist (`DISCOVER_MOVIE_KEYS`/`_TV_KEYS`),
  serialização **determinista** (chaves ordenadas) e **rejeição de filtro desconhecido**
  (`TmdbCatalogError`). **Busca** exige query não-vazia.
- Validadores de envelope puros (`validateTmdbPage`/`Configuration`/`GenreList`/
  `CertificationList`) — separados dos DTOs; usados pelo worker e testados.
- `catalog.ts` entra em `ENUMERATION_SOURCES` do `api:coverage`: todo `async get<X>(`
  ali TEM entrada no registro (drift reverso).

### Worker de taxonomia (`services/ingestion/src/config-sync`)
- Núcleo **puro** (typechecked + testado): `normalize.ts` (`/configuration` →
  `ImageConfigRow`, `null` se inválido) e `run.ts` (orquestração port-based).
- `runTaxonomySync` captura o payload **bruto integral** de 8 endpoints em
  `api_cache` (via `CachePort`), loga cada ciclo em `api_sync_logs` (via `SyncLogPort`)
  e **normaliza** `/configuration` em `tmdb_image_config` (via `ImageConfigStorePort`).
- Adapter Prisma `image-config-store.ts` (fora do typecheck): **idempotente** — não
  reescreve quando o conteúdo é igual (não bumpa `updated_at`).
- CLI `bin/sync-tmdb-config.ts`: worker-only, dry-run por padrão, `--apply` exige
  token + `DATABASE_URL` e aborta em produção (fail-closed).

### Registro F5 (mantido fiel ao código)
- Endpoints TMDB: 8 → 29. `tmdb.configuration` → `normalized`; 7 taxonomias →
  `raw_captured`; listas/discover/busca/changes → `not_applicable` (client testado,
  execução roadmap F8). Campos: `tmdb.config.image_sizes` (`normalized`) +
  `tmdb.taxonomy.{genres,certifications,reference}_raw` (`raw_captured`).
- `api:coverage` verde (59 endpoints, 31 campos). Regra respeitada: `normalized` só
  com store real; `raw_captured` só com persistência real; `not_applicable` para
  client-only; certificação é advisory, nunca rating (invariantes 1/2).

### Validação (`validate:tmdb-catalog`)
- `services/ingestion/scripts/validate-tmdb-catalog-real-postgres.ts` (PostgreSQL 16
  efêmero): client REAL + transporte FALSO local + adapters Prisma reais. 10 checks:
  raw capture dos 8 endpoints, log por ciclo (24 em 3 ciclos), normalização de
  `/configuration`, **idempotência** (no-op, `updated_at` intacto) e **determinismo de
  mudança**. Adicionado à CI Linux.

## Consequências e follow-ups
- Sem alteração de schema/migrations (usa `tmdb_image_config` existente). Zero API
  externa e zero Gemini no render (`audit:render` verde; worker-only).
- Tabelas normalizadas próprias (genres, videos, images) e ativação dos workers de
  discover/busca/listas/changes/certificação são **F6-continuação/F8** — cada uma com
  sua migration + validador quando escopada.
- **Fase 7 (mídia) não foi iniciada.** Este ADR cobre metadados de catálogo/taxonomia;
  a política completa de imagens/vídeos é da Fase 7.