# PHASE 2 — TMDB Ingestion Plan (Screena)

> Plano aprovado para a Fase 2 (Ingestao TMDB). Branch: `feat/fase-2-tmdb`.
> Escopo: client TMDB **worker-only** + normalizacao + persistencia idempotente
> em PostgreSQL via **Prisma**, com `api_cache`, `api_sync_logs`, retry/backoff,
> rate limit, circuit breaker e testes de contrato sem rede.
>
> **Fora de escopo:** nenhuma chamada TMDB no render; nenhuma pagina publica;
> nenhum slug; nenhum Entity Writer; nenhum Gemini; nenhum rating editorial
> (IMDb/Rotten/Metacritic); nenhum streaming availability; nenhuma indexacao;
> nenhuma publicacao; nenhum discovery (popular/trending/changes); **nenhuma
> alteracao de `schema.prisma` ou migration**.
>
> Em conflito com este documento, vence `CLAUDE.md` (as 13 invariantes).

---

## 1. Decisoes aprovadas (D2.1–D2.4)

| # | Decisao |
| --- | --- |
| **D2.1** | **Runtime TypeScript/Node + Prisma.** A ingestao TMDB e implementada em TS, persistindo via Prisma (`@screena/db`). Reusa o pipeline existente (Vitest, `tsc`, ESLint). Justificativa: a Fase 1 consolidou o banco em Prisma; o escopo exige persistencia via Prisma; evita duplicar regras de persistencia em Python/psycopg e divergencia schema↔SQL manual. |
| **D2.2** | **Entrada por TMDB ID + lista curada de dev.** `importMovie`/`importTvShow`/`importPerson` por id explicito, com uma pequena lista curada (`services/ingestion/src/seed-ids.ts`) para validar o fluxo. **Sem** discovery (popular/trending/changes), sem paginacao de listas publicas, sem import em massa. |
| **D2.3** | **Arquitetura ports/adapters.** Logica pura (normalizers, http, cache-key, hash, orquestracao via interfaces) e tipada e testada; o codigo que toca Prisma fica isolado em adapters (`persistence/`, `bin/`, `@screena/db/server`) **excluidos do typecheck** (mesmo padrao do `prisma/seed.ts` da Fase 1). |
| **D2.4** | **Workers Python viram legado/scaffold.** Os `workers/*.py` permanecem como esqueleto/futuros shims de systemd. A ingestao TMDB NAO e implementada em Python nesta fase. Desvio em relacao a "Workers: Python 3.12" do `CLAUDE.md` registrado aqui e no `workers/README.md`. |

## 2. Invariantes preservadas

- **TMDB e `provider_api` (`kind=data`), nunca `rating_source`.** Disjuncao ja
  travada por `tests/governance/seed-disjoint.test.ts`; reforcada por
  `tests/governance/tmdb-provider-separation.test.ts` (nova).
- **`vote_average_tmdb`/`vote_count_tmdb` sao dados tecnicos** do provider,
  gravados em colunas proprias de `movies`/`tv_shows`; **nunca** viram nota
  editorial nem `external_ratings`. A ingestao TMDB nunca escreve em
  `external_ratings`.
- **Zero API externa no render / zero Gemini no render** (inv. 3/4): client
  worker-only, nao importavel por `apps/web`.
- **API keys so em env vars** (nunca no frontend/bundle/versionadas).
- **Todo sync gera `api_sync_logs`** (inv. ingestao); idempotente e auditavel.
- **Sem pirataria**; **pt-BR primeiro**; **sem licenca clara nao aparece** —
  nao tocadas nesta fase (sem exibicao), mas o pipeline ja respeita os defaults
  seguros do schema.

## 3. Fluxo canonico

```
seed-ids / fila stale
      │
 importMovie/importTvShow/importPerson  (orquestracao, ports)
      │  api-clients/tmdb  ──►  api_cache (payload BRUTO + payload_hash)
      ▼
 normalizers (PUROS)  ──►  persistence (Prisma, em transacao)
      │                         │  upsert idempotente + hash short-circuit
      │                         ▼
      └────────────────►  api_sync_logs (1 linha por ciclo: status/contagens/duracao/quota/hash)
```

- O **bruto** vai para `api_cache`; o **normalizado** vai para as tabelas finais.
- Cache hit dentro do TTL ⇒ nao vai a rede. `payload_hash` igual ⇒ nao reescreve
  tabela final nem bumpa `updated_at` (so atualiza `last_synced_at`).

## 4. Arquivos criados/alterados

**Criados**
- `docs/PHASE_2_TMDB_PLAN.md` (este doc).
- `.env.example` (raiz) — `TMDB_*` + `DATABASE_URL`.
- `api-clients/tmdb/` — `package.json`, `tsconfig.json`, `src/{index,config,http,endpoints,types,provider}.ts`, testes `src/__tests__/*`.
- `services/ingestion/` — `package.json`, `tsconfig.json`, `src/{index,types,ports,seed-ids}.ts`, `src/utils/{hash,cache-key,normalize}.ts`, `src/normalizers/{movie,tv,season,episode,person,credits,external-ids}.ts`, `src/import/{import-movie,import-tv,import-person}.ts`, adapters `src/persistence/*` (excluidos), `bin/import.ts` (excluido), testes `src/__tests__/*`.
- `services/sync/` — `package.json`, `tsconfig.json`, `src/{index,stale-policy}.ts`, `bin/run.ts` (excluido), `systemd/*.{service,timer}` (documentacao).
- `packages/db/src/server.ts` — acessor Prisma server-only (excluido do typecheck).
- `tests/governance/tmdb-provider-separation.test.ts`.

**Alterados**
- `pnpm-workspace.yaml` — incluir `api-clients/*` e `services/*`.
- `tsconfig.json` — `include` de `api-clients/**` e `services/**`; `exclude` dos arquivos que tocam Prisma.
- `vitest.config.ts` — `include` de testes em `api-clients/**` e `services/**`.
- `packages/db/package.json` — `exports["./server"]`.
- `scripts/audit/check-render-purity.mjs` — proibir import de `services/ingestion`/`services/sync` em paginas de `apps/web`.
- `scripts/audit/check-invariants.mjs` — incluir `api-clients` na varredura de padroes proibidos.
- `api-clients/tmdb/README.md`, `services/ingestion/README.md`, `services/sync/README.md`, `workers/README.md`, `CLAUDE.md` (registro do runtime TS).

## 5. Arquitetura do client TMDB (`api-clients/tmdb`)

Worker-only; nao importavel pelo bundle de pagina. Componentes:

- **config** — carrega/valida env (`TMDB_READ_ACCESS_TOKEN` v4 **ou** `TMDB_API_KEY` v3, base URL, tunables). Falha explicita se faltar auth.
- **http** — executor com **throttle** (token-bucket), **retry** exponencial + jitter (so transitorios: 429 c/ `Retry-After`, 5xx, timeout/rede; nunca 401/403/404/422), **circuit breaker** por fonte `tmdb`. Transporte **injetavel** (`HttpTransport`) para testes sem rede.
- **endpoints** — `getMovie`, `getTvShow`, `getTvSeason`, `getPerson` (com `append_to_response=external_ids,credits`). Retornam payloads tipados (subset).
- **types** — subset tipado das respostas TMDB usadas.

## 6. Mapeamento campo a campo (TMDB → Prisma)

`movies` (`GET /movie/{id}?append_to_response=external_ids,credits`):

| Prisma | TMDB | Obs |
| --- | --- | --- |
| `tmdbId` | `id` | chave de upsert (`@unique`) |
| `imdbId` | `external_ids.imdb_id` | `""`/ausente → `null` (CHECK `imdb_id <> ''`) |
| `titleOriginal` | `original_title` | so original; titulo pt-BR e i18n (fora de escopo) |
| `originalLanguage` | `original_language` | so se existir em `languages`; senao `null` (R1) |
| `releaseDate` | `release_date` | `""` → `null` |
| `runtimeMinutes` | `runtime` | |
| `status` | `status` | |
| `popularity` | `popularity` | tecnico |
| `voteAverageTmdb` | `vote_average` | tecnico — NUNCA rating editorial |
| `voteCountTmdb` | `vote_count` | tecnico |
| `posterPath`/`backdropPath` | `poster_path`/`backdrop_path` | |
| `lastSyncedAt`/`staleAfter` | — | carimbados no sync |

`tv_shows` (`GET /tv/{id}?append_to_response=external_ids,credits`): analogo —
`nameOriginal`←`original_name`, `firstAirDate`/`lastAirDate`,
`numberOfSeasons`/`numberOfEpisodes`, demais iguais a `movies`.

`seasons` (de `GET /tv/{id}/season/{n}`): `tvShowId`←id interno; `tmdbId`←`id`;
`seasonNumber`←`season_number` (upsert por `(tvShowId, seasonNumber)`); `name`;
`overview` (cru); `airDate`←`air_date`; `episodeCount`←`episode_count`;
`posterPath`.

`episodes` (de `GET /tv/{id}/season/{n}` → `episodes[]`): `seasonId`/`tvShowId`←ids
internos; `tmdbId`←`id`; `episodeNumber`←`episode_number` (upsert por
`(seasonId, episodeNumber)`); `name`; `overview` (cru); `airDate`;
`runtimeMinutes`←`runtime`; `stillPath`←`still_path`.

`people` (`GET /person/{id}?append_to_response=external_ids`): `tmdbId`,
`imdbId` (`""`→`null`), `name`, `knownForDepartment`←`known_for_department`,
`gender`, `birthday`, `deathday`, `placeOfBirth`←`place_of_birth`,
`profilePath`←`profile_path`. `biographySourceStatus` permanece `unknown`
(nao ha coluna de biografia; o texto da bio nao e persistido).

`cast_members`/`crew_members` (de `credits`): `personId`←interno;
`entityType`∈{`movie`,`tv`}; `entityId`←interno; cast: `character`,
`billingOrder`←`order`; crew: `department`, `job`; `creditId`←`credit_id`.
Idempotencia por **replace-set por entidade** (secao 8).

`entity_external_ids`: por entidade, `source` namespaceado por tipo
(`tmdb_movie`/`tmdb_tv`/`tmdb_person`, +url canonica TMDB) e `source='imdb'` quando houver
`imdb_id`. Upsert por `(entityType, entityId, source)`. O TMDB reusa o espaco numerico de
ids entre tipos, logo um unico `tmdb` colidiria no unique `(source, external_id)`.
(`provider_api='tmdb'` em `api_cache`/`api_sync_logs` permanece sem namespace.)

## 7. `api_cache` e `api_sync_logs`

**`api_cache`** — grava resposta crua por chamada: `providerApi='tmdb'`,
`endpoint`, `requestKey` (deterministica: endpoint + params ordenados),
`paramsHash` (sha256), `payload` (JSON), `payloadHash` (sha256 canonico),
`fetchedAt`, `expiresAt=now+TTL`. Unique `(providerApi, requestKey, paramsHash)`
→ upsert. Cache hit dentro do TTL evita a rede.

**`api_sync_logs`** — **1 linha por ciclo/endpoint, sempre** (success / empty /
partial / failed / aborted): `providerApi='tmdb'`, `endpoint`, `status`,
`errorCode`, `itemsProcessed/Created/Updated`, `durationMs`, `quotaCost`
(nº de requests TMDB do ciclo), `payloadHash`. Falha e logada e nao derruba o
pipeline.

## 8. Idempotencia / upsert

- `movies`/`tv_shows`/`people`: upsert por `tmdbId`.
- `seasons`: `(tvShowId, seasonNumber)`; `episodes`: `(seasonId, episodeNumber)`.
- `entity_external_ids`: `(entityType, entityId, source)`; **sem `skipDuplicates`** —
  conflito no unique `(source, external_id)` (outra entidade ja com o id) FALHA e e
  surfaçado (reverte a transacao), nunca mascarado.
- **cast/crew**: em transacao, **apaga os creditos da entidade e reinsere** do
  payload fresco (remove creditos retirados upstream, evita duplicata, nao
  depende de `credit_id` presente). `credit_id @unique` fica como guarda extra.
- **Hash short-circuit**: `payload_hash` igual ao ultimo ⇒ nao reescreve tabela
  final nem bumpa `updated_at`; so atualiza `last_synced_at`.
- Reimportar a mesma entidade ⇒ zero duplicata; sem mudanca ⇒ zero rewrite.

## 9. Rate limit / retry / circuit breaker

- Throttle local (token-bucket, `TMDB_MAX_RPS`) antes de cada request.
- Backoff exponencial + jitter, teto `TMDB_MAX_RETRIES`; respeita `Retry-After`.
- Breaker por `tmdb` (`TMDB_BREAKER_THRESHOLD` falhas → cooldown
  `TMDB_BREAKER_COOLDOWN_MS` → half-open). Aberto ⇒ aborta o ciclo, loga
  `status=aborted`, degrada para cache.
- Provado por testes com **transporte mockado** (sem rede).

## 10. Variaveis de ambiente

So server/worker, nunca no front. `TMDB_READ_ACCESS_TOKEN` (v4, preferido) **ou**
`TMDB_API_KEY` (v3) · `TMDB_API_BASE_URL` · `TMDB_DEFAULT_LANGUAGE` ·
`TMDB_MAX_RPS` · `TMDB_MAX_RETRIES` · `TMDB_BREAKER_THRESHOLD` ·
`TMDB_BREAKER_COOLDOWN_MS` · `TMDB_CACHE_TTL_MS` · `DATABASE_URL` (ja existente).
Documentadas em `.env.example`; validacao falha na partida se faltar auth.

## 11. Riscos tecnicos

- **R1 — FK `original_language` → `languages.code`.** `languages` so tem
  `pt-BR/en/es`; TMDB devolve `ja`, `ko`, `fr` e tambem `pt` (nao `pt-BR`).
  **Decisao Fase 2:** gravar `originalLanguage` so quando o codigo existir em
  `languages`; senao `null`. Reter o idioma original de todos os titulos exige
  decisao de schema/seed (expandir `languages` ou tabela de "idioma de conteudo")
  — **fora desta fase**, requer aprovacao humana.
- **R2 — Sem tabelas para genres/collections(franchises)/galerias de
  images/trailers.** O schema da Fase 1 nao as tem. Persistimos so `*_path`.
  Esses dados ficam **fora da Fase 2** e exigem schema novo (aprovado) depois.
- **R3 — `overview` e dado cru.** Guardado em `seasons`/`episodes.overview` como
  referencia estrutural; nao conta como bloco de valor, nao e editorial e
  respeita licenca antes de exibir. Filme/serie nao tem coluna `overview` no
  schema ⇒ a sinopse de filme/serie nao e persistida nesta fase.
- **R4 — Workspace globs.** `api-clients/*` e `services/*` entram no
  `pnpm-workspace.yaml` (config).
- **R5 — Desvio do CLAUDE.md (workers Python).** Registrado em D2.4 e no
  `workers/README.md`/`CLAUDE.md`.

## 12. Testes (sem rede)

- **Contrato/mapeamento** por entidade: fixture TMDB → input Prisma esperado
  (normalizers puros).
- Normalizacao: `imdb_id` (`""`→`null`), datas vazias → `null`, gating de
  `original_language` (R1).
- **Governanca**: importador TMDB nunca escreve `external_ratings`/`rating_source`;
  `vote_average_tmdb` so em coluna tecnica.
- **Cache**: determinismo de `requestKey`/`paramsHash`; estabilidade do
  `payloadHash`; short-circuit.
- **Resiliencia**: retry/backoff/breaker com transporte fake (429/5xx retentam,
  4xx nao, breaker abre).
- **Idempotencia (integracao, opcional/manual)**: persistir 2× → mesmas
  contagens; usa `embedded-postgres` (devDep de `@screena/db`); NAO roda no CI
  por padrao. Qualquer validacao real com TMDB e manual e nunca no CI.

## 13. Checklist de aceite

- [ ] Zero chamada TMDB no render (`audit:render` verde; client nao importavel por `apps/web`).
- [ ] Import idempotente (reimport sem duplicar) + hash short-circuit.
- [ ] `api_sync_logs` com 1 linha por ciclo; falha logada sem derrubar pipeline.
- [ ] Rate-limit + retry + breaker provados por teste mockado.
- [ ] Chaves so de env; falha explicita se ausentes; nada no front.
- [ ] `tmdb` separado de `rating_sources`; importador nunca toca `external_ratings`; `vote_average_tmdb` tecnico.
- [ ] Sem paginas, slugs, editorial, ratings, streaming, discovery, indexacao, publicacao.
- [ ] **Nenhuma alteracao de schema/migration** (R1/R2 ficam como decisao humana).
- [ ] `pnpm typecheck/lint/test/audit:invariants/audit:render` verdes.
- [ ] Trabalho em `feat/fase-2-tmdb`; merge so via PR + revisao humana.

## 14. Fora de escopo (Fase 3+)

Slugs/`redirects` (nascem com a pagina pt-BR, Fase 4/5) · `entity_translations`
(titulos/sinopses localizados, i18n) · `content_blocks`/Entity Writer (Fase 3) ·
`external_ratings` IMDb/RT/Metacritic (Fase 6) · `watch_availability`/streaming
(Fase 7) · indexacao/publicacao (Fase 8) · discovery popular/trending/changes ·
genres/franchises/images/trailers (exigem schema novo).
