# Runbook — Dead-letter da fila de catalogo

> Operacional (pt-BR). Como inspecionar e reprocessar jobs que esgotaram as
> tentativas (`dead_letter`). Worker-only.

## Quando um job vira dead-letter

Um `CatalogJob` vai para `dead_letter` quando `attempts >= max_attempts` apos uma
falha (ou apos um reclaim de orfao que esgota a ultima tentativa). Ele para de ser
reivindicado — e um item "poison" aguardando decisao operacional/humana.

`planFailure(attempts, maxAttempts)` decide `retry_wait` (ainda ha tentativa) vs
`dead_letter` (esgotou). `reclaimOrphans` reusa a mesma logica.

## Inspecionar

Via SQL:
```sql
SELECT id, job_type, entity_type, external_id, attempts, last_error_code, last_error_safe
FROM catalog_jobs
WHERE status = 'dead_letter'
ORDER BY id;
```

Via adapter (`CatalogJobStorePort.listDeadLetter(limit)`) — retorna
`DeadLetterEntry[]` (id, jobType, entityType, externalId, attempts, erro seguro).
O contrato serializavel para superficies operacionais e
`CatalogJobView` / `CatalogStatusPayload` (`@screena/public-contracts`).

`last_error_code`/`last_error_safe` sao **seguros** (sem PII/segredo) — o erro cru
nunca e persistido no job.

## Diagnosticar antes de reprocessar

- `last_error_code = worker_heartbeat_timeout`: o worker morreu no meio (reclaim);
  provavelmente transitorio — replay seguro.
- `last_error_code` de 4xx permanente (ex.: `tmdb_404`): a entidade sumiu upstream;
  NAO reprocesse cegamente — investigue (remocao upstream nao apaga o registro
  automaticamente).
- Picos de `tmdb_5xx`/`rate_limit`: upstream degradado; espere o circuit breaker
  fechar antes do replay em massa.

## Reprocessar (replay)

`replayDeadLetter(ids?)` traz de volta a `pending` (attempts=0, erro/claim
limpos), imediatamente reivindicavel:

```ts
const jobs = createPrismaCatalogJobStore(prisma)
// todos os dead-letters:
const n = await jobs.replayDeadLetter()
// ou um subconjunto especifico (recomendado apos diagnostico):
await jobs.replayDeadLetter(['42', '43'])
```

Regra: **replay em massa so apos entender a causa**. Reprocessar poison sem
corrigir a origem so recria dead-letters.

## Metricas de saude

- `catalog_dead_letter_total` crescente e sinal de degradacao de upstream ou bug
  de normalizacao — investigar, nao so dar replay.
- Alerta operacional sugerido: `dead_letter` acima de um limiar por janela.
