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

## Decisoes adicionadas na continuacao (mesma PR)

> A secao "escopo NAO coberto" original desta ADR listava `/changes`, CLI,
> modelos de referencia, snapshots, rota de busca e metricas como deferidos.
> A continuacao da PR os ENTREGOU — o texto abaixo substitui aquela lista.

### 5. Handlers reais + registry de producao
Os 11 tipos de `CatalogJobType` tem handler REAL em
`services/ingestion/src/catalog-jobs/handlers/` (validacao de payload
fail-loud, `AbortSignal`, heartbeat, metricas de baixa cardinalidade,
classificacao transitorio/permanente) e a composicao central
`createCatalogHandlerRegistry(deps)` + `assertCompleteRegistry` — tipo sem
handler falha no BOOT, nao vira dead-letter na fila. Decisoes de fluxo:
- `sync_details` NAO enfileira `sync_credits`/`sync_external_ids`: o detalhe ja
  vem com `append_to_response=external_ids,credits` e os upserta na mesma
  resposta — enfileirar seria refetch puro. Esses dois tipos existem como
  caminho de REPARO explicito (via CLI). Sobram `sync_media` (+`sync_seasons`
  para tv, que enfileira `sync_episodes`).
- `sync_media` NAO aceita season/episode: a chave de midia e
  `(entityType, tmdbId)` e o tmdbId de temporada e o da SERIE — o cache
  `/season/{id}/images` colidiria entre temporadas. Stills de episodio entram
  por `sync_episodes`, com a chave natural correta.
- `reprocess_raw` NUNCA chama o TMDB (reprocessa `tmdb_raw` ja capturado) e
  recusa filtro por tmdbId (a promocao opera por lote).

### 6. CLI unificada `pnpm catalog`
Nucleo PURO testavel em `services/ingestion/src/cli/` (parser fail-loud que
rejeita flag desconhecida/valor faltante/data impossivel/combinacao invalida;
ajuda com exemplo copiavel por comando; exit codes estaveis 0/1/2/3/4; gate de
producao — escrita exige `--force`, leitura exige `--confirm-production-read`;
`redactSecrets` em toda saida) + entrypoint `bin/catalog.ts`. Propriedades:
- comandos diretos executam OS MESMOS handlers do worker (`runHandlerInline`) —
  sem caminho paralelo que possa divergir de producao;
- dry-run NAO monta o runtime (zero Prisma, zero TMDB, zero cota) por construcao;
- comandos so-de-banco (status/search-status/audit-database/dead-letter/enqueue)
  nao exigem token TMDB;
- `enqueue` valida o payload com o MESMO validador do worker ANTES de gravar;
- o worker faz reclaim periodico de orfaos (worker morto por SIGKILL/OOM nao
  deixa jobs presos em `running`).

### 7. `/changes` e discovery EXECUTANDO
`runChangesSync` roda o incremental de verdade: COMMIT ATOMICO (jobs do lote +
checkpoint na MESMA transacao; rollback nao avanca; janela concluida e noop);
pagina vazia sem `total_pages` encerra; teto duro de 500 paginas/kind (provider
que omite `total_pages` nao vira loop infinito); `AbortSignal` propagado (o
timeout do job nao deixa um ciclo zumbi regredindo o checkpoint do run novo);
o payload enfileirado carrega `entityType`/`tmdbId`/`locale` (o handler valida
o PAYLOAD, nao as colunas). `sync_lists` captura as listas, persiste
`DiscoverySnapshot` com hash-noop (lista inalterada nao duplica) e itens apenas
de entidades promovidas.

### 8. Typecheck do wiring operacional
`persistence/**`, `bin/**` e `composition.ts` ficam fora do tsconfig principal
(dependem do Prisma Client gerado) — exatamente onde a revisao adversarial
achou erros de assinatura reais. Gate novo `pnpm typecheck:catalog-runtime`
(`tsconfig.runtime.json`) + step no CI apos o `db:generate`. De 195 erros para
0; o gate comprovadamente reprova os bugs que antes passavam.

### 9. Fonte unica do host de imagem + contratos PRODUZIDOS
`buildTmdbImageUrl` canonico em `@screena/public-contracts` (`media-url.ts`) —
o UNICO arquivo de producao do repositorio autorizado a conter
`image.tmdb.org`; o audit de render virou repo-wide e ha teste de governanca
(`tests/governance/image-host-single-source.test.ts`). O helper de `apps/web` e
so reexport. Os 10 getters (`createPublicPayloadReader`) produzem os payloads a
partir do PostgreSQL: mappers PUROS em `src/public-payloads/` que terminam no
validador do proprio contrato + reader Prisma coberto pelo typecheck do
runtime. Fail-closed provado em banco real: midia/oferta `display_allowed=false`
e rating de licenca bloqueada nunca chegam; ids/datas serializados; slug
inexistente devolve `null` (404 tecnico). GOVERNANCA respeitada:
`services/ingestion` nao referencia ratings (invariantes 1/2, travado por
teste) — o reader recebe `ApprovedRatingsSource` INJETADA (default vazio); o
adapter pertence ao dominio de ratings.

## Consequencias e limitacoes REAIS (estado atual)
- Validador `validate:catalog-platform-complete`: **66 checks** em PostgreSQL 16
  efemero — fila, busca, pipeline dos 11 handlers, bootstrap idempotente/resume,
  changes commit/rollback/noop, snapshots hash-noop, metricas sem alta
  cardinalidade, audit read-only e os contratos fail-closed. Step proprio no CI.
- `genres` nos payloads e `[]`: o schema nao vincula entidade<->genero (existe
  so o dicionario `genres`); vinculo e trabalho futuro — nunca taxonomia
  inventada.
- Colecao nao tem pagina publica: `EntityRef` de colecao sai com
  `canonicalUrl: null` ate existir rota.
- Ratings/streaming atravessam o contrato APENAS pelos gates de licenca, e os
  produtos seguem inativos (nenhuma chamada real a provider; ver ADR 0009-0011).
- Midia de TEMPORADA nao e sincronizada por `sync_media` (ver §5); o poster da
  temporada vem de `seasons.poster_path`.
- Nada aqui chama API externa no render, roda Gemini, decide licenca, indexa em
  massa ou publica — a PR e draft e a revisao/merge sao humanos.
