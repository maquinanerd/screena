# Handlers da fila de catalogo

> pt-BR. Codigo em `services/ingestion/src/catalog-jobs/handlers/` (lado TIPADO;
> typecheck principal) + wiring real em `persistence/catalog-services.ts`
> (coberto por `typecheck:catalog-runtime`). Decisoes: [ADR 0012 §5](../adr/0012-complete-catalog-platform.md).

## Contrato

Todo handler implementa `CatalogJobHandler<I, O>`: `validateInput(unknown): I`
(fail-loud, ANTES de qualquer IO — payload invalido e falha PERMANENTE, vai
direto a dead-letter sem gastar retry) e `execute(context, input): Promise<O>`
(respeita `AbortSignal`, emite heartbeat e metricas, retorna resultado
serializavel). `createCatalogHandlerRegistry(deps)` monta os 11 e
`assertCompleteRegistry` garante cobertura no boot.

## Os 11 tipos

| Tipo | Faz | Enfileira |
| --- | --- | --- |
| `bootstrap` | orquestra (nunca transacao longa): enfileira etapas com chaves por `requestId` (resume = mesmo id) | `discover_ids`, `sync_lists` |
| `discover_ids` | Daily ID Exports (gunzip + `filterAdult` fail-closed) / listas / ids explicitos | `sync_details` (prio 100) |
| `sync_details` | detalhe + upsert (o append ja traz external_ids/credits) | `sync_media` (+`sync_seasons` p/ tv) |
| `sync_credits` | caminho de REPARO de elenco/equipe (nao e dependencia automatica) | — |
| `sync_external_ids` | caminho de REPARO de ids externos (id externo NUNCA e rating) | — |
| `sync_media` | imagens/videos de movie\|tv\|person; `display_allowed=false` sempre | — |
| `sync_seasons` | enumera temporadas REPORTADAS (inclui 0; nunca 1..N adivinhado) | `sync_episodes` |
| `sync_episodes` | detalhe+creditos+guest stars+ids+stills por temporada; episodio sem tmdbId = skip contado | — |
| `sync_lists` | lista -> `DiscoverySnapshot` (hash-noop; so entidades promovidas) | — |
| `sync_changes` | incremental `/changes` (commit atomico; ver runbook) | `sync_details` (prio 50) |
| `reprocess_raw` | `tmdb_raw` ja capturado -> tabelas tipadas; NUNCA chama TMDB | — |

## Decisoes nao-obvias (e por que)

- **`sync_details` nao enfileira credits/external_ids**: o detalhe vem com
  `append_to_response=external_ids,credits` e os upserta na MESMA resposta;
  enfileirar seria refetch puro (mesma cota, mesmo dado).
- **`sync_media` recusa season/episode**: a chave de midia e
  `(entityType, tmdbId)` e o tmdbId de temporada e o da SERIE — o cache
  colidiria entre temporadas e as linhas ficariam indistinguiveis. Stills de
  episodio entram por `sync_episodes` (chave natural serie+temporada+numero).
- **Servicos pipeline-safe viram throw no adapter**: `import/*` e `runMediaSync`
  NAO lancam (falha vira `status: 'failed'`) — certo para lote, errado para
  fila (o job seria `succeeded` e o erro sumiria). O wiring converte
  failed/aborted em excecao; 404 vira `PermanentJobError`.
- **Erros classificados num conjunto FECHADO** (`ERROR_CLASSES`) e labels de
  metrica restritas a `ALLOWED_METRIC_LABELS` — `entity_id`/`tmdb_id`/query
  como label explodiriam a cardinalidade do coletor.
- **Payload x colunas**: `entityType`/`externalId` sao colunas do job
  (indice/consulta); o handler valida o PAYLOAD. Quem enfileira precisa repetir
  os campos no payload (bug real do `/changes`, corrigido e travado por teste).
