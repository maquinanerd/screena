# ADR 0012 — Plataforma de catalogo em escala: fila duravel + busca (Backend A)

- Status: aceito (implementacao em PR draft para revisao humana).
- Data: 2026-07-16.
- Contexto: apos [[0009-0011-external-data-intelligence-platform]] (Fases 9–11), a
  `main` ja continha a maior parte da plataforma de catalogo (Fases 6–8: catalogo,
  midia, discovery/changes **planejados**, checkpoints; Fases 9–11: streaming,
  ratings, Gemini offline). O reconhecimento dirigido mostrou que os primitivos
  do "catalogo em escala" ainda **ausentes** eram: uma **fila duravel de jobs**
  generica (o `EntityWriterJob` e writer-scoped), uma **busca PostgreSQL** e um
  pacote de **contratos publicos** serializaveis. Este ADR cobre esses tres.

## Decisao

### 1. Fila duravel de jobs (`CatalogJob`)
- Novos enums `CatalogJobType` (bootstrap, discover_ids, sync_details,
  sync_credits, sync_external_ids, sync_media, sync_seasons, sync_episodes,
  sync_lists, sync_changes, reprocess_raw) e `CatalogJobStatus` (pending,
  claimed, running, retry_wait, succeeded, failed, dead_letter, cancelled).
  **Distintos** de `JobType`/`JobStatus` (writer-scoped) — nao reusar o dominio
  editorial para ingestao.
- Model `CatalogJob` (`catalog_jobs`): `idempotencyKey` unico (enfileirar duas
  vezes = noop), `attempts`/`maxAttempts` + `retry_wait`/`dead_letter` para
  retry-com-backoff e dead-letter, `heartbeatAt` para reclaim de orfaos,
  `entityType` = `TmdbEntityKind` (superset — jobs cobrem collection/network/etc,
  nao so o renderavel). **Autocontido**: sem FK composta para `entities` (mantem
  a migration aditiva segura no cenario de upgrade, como `genres`/`tmdb_images`).
- O claim reusa **o padrao provado** do `EntityWriterJob`: `FOR UPDATE SKIP
  LOCKED` (dois workers nunca pegam o mesmo job), `ORDER BY priority ASC,
  available_at ASC`. Planejadores PUROS (retry vs dead-letter, reclaim, replay,
  backoff+jitter) vivem em `services/ingestion/src/catalog-jobs/` (typecheck +
  testes); o adapter Prisma em `services/ingestion/src/persistence/catalog-job-store.ts`
  (excluido do typecheck) so aplica os planos.

### 2. Busca PostgreSQL (`SearchDocument`)
- Model `SearchDocument` (`search_documents`): projecao denormalizada, 1 linha por
  `(entity_type, entity_id, locale)`, so entidades **renderaveis** (movie/tv/person).
- Extensoes `unaccent` + `pg_trgm` e wrapper **IMMUTABLE** `immutable_unaccent`
  (a `unaccent(text)` da extensao e apenas STABLE; fixar o `regdictionary` a torna
  IMMUTABLE e utilizavel em indice funcional). Indices: GIN trgm sobre
  `normalized_text` + GIN trgm funcional `immutable_unaccent(lower(primary_text))`.
- **Casamento deterministico**: `normalized_text` guarda a "dobra" (sem acento,
  minusculo) de `primary_text` + aliases; o termo de busca e dobrado **do mesmo
  jeito em JS**. Os dois lados casam sem depender de o `unaccent` do Postgres
  coincidir byte a byte com o JS. O wrapper serve ao indice funcional e ao refino
  de ranking titulo-vs-alias.
- Ranking (invariante de busca): titulo exato > alias exato > prefixo > fuzzy
  (trgm); desempate por similaridade -> popularidade -> ano -> id. A consulta e
  **parametrizada** ($1..$5): nenhum literal do usuario e concatenado no SQL;
  limite (<= 50) e offset com clamp.

### 3. Contratos publicos (`@screena/public-contracts`)
- Novo pacote com tipos + **validadores PUROS** (sem zod — o repo nao usa zod;
  sem Prisma) para os payloads publicos: primitivos (EntityRef, PublicMediaAsset,
  PublicVideo, MediaPayload, Credit, SeoPayload), detalhe (Movie/Tv/Season/
  Episode/Person), home/descoberta (EntityCard, HomePayload, DiscoveryPayload),
  busca (SearchResult, SearchPayload — sempre noindex) e fila (CatalogJobView,
  CatalogStatusPayload). Ids como string, datas ISO string; `displayAllowed`
  obrigatorio na midia (invariante 6); literais reexportados de `@screena/config`.

### 4. Validador dedicado + gate de CI
- `validate:catalog-platform-complete` (`@screena/ingestion`, `embedded-postgres`
  16 efemero) prova, em PostgreSQL real: migration do zero; extensoes/funcao;
  enqueue idempotente; claim SKIP LOCKED + prioridade; heartbeat; retry ->
  retry_wait com backoff; dead-letter; reclaim de orfao; replay; busca
  exact/alias/acento/prefixo/fuzzy + zero-results. Adicionado como **step proprio**
  em `.github/workflows/ci.yml` (o CI enumera cada validador; script so na raiz
  nao roda no CI).

## Alternativas consideradas
- **Reusar `JobType`/`JobStatus`** para o catalogo: rejeitado — sao writer-scoped
  e acoplam ingestao a redacao editorial.
- **zod nos contratos** (como o prompt ilustrava): rejeitado — o repo nao tem zod
  (0 no lockfile); introduzir quebraria `--frozen-lockfile` e a convencao de
  validadores puros de `@screena/schemas`.
- **`unaccent` direto no indice**: impossivel (nao-IMMUTABLE); daí o wrapper.
- **FK composta de `catalog_jobs`/`search_documents` para `entities`**: rejeitado
  — quebraria `db:validate:upgrade` (a migration de hardening e removida no estado
  "anterior"); as tabelas sao derivadas/transientes e nao precisam da FK.

## Consequencias e escopo NAO coberto (honesto)
Esta PR entrega os primitivos ausentes e os prova em Postgres real, mas
**deliberadamente NAO** faz (para manter escopo revisavel e gates verdes):
- **Metodos novos de client TMDB** (`getCollection/getCompany/getNetwork/
  getKeyword`): disparariam reverse-drift em `api:coverage` (exige registro em
  `docs/api-coverage/`); ficam para uma PR focada.
- **Execucao de `/changes`** (hoje so `planChangesRequests`), **CLI unificada
  `catalog` bootstrap/status**, **modelos novos** (Collection/Company/Network/
  Keyword/AlternativeTitle) e **persistencia de DiscoverySnapshot**: sao trabalho
  seguinte, agora com a fila `CatalogJob` como fundacao.
- **Rota publica de busca** e **sink de metricas**: a biblioteca de busca e os
  nomes de metrica sao contrato; a superficie de rota/exportador fica adiante.
- Nada aqui chama API externa, roda Gemini, decide licenca, indexa em massa ou
  publica — a PR e draft e a revisao/merge sao humanos.
