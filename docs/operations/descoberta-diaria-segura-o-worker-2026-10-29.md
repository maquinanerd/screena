# A descoberta diária segurava o worker de catálogo — 29/10/2026

> **RECEBI** é número de produção medido por outra sessão (DbGate, só leitura).
> **MEDI** é laboratório local com os exports REAIS de 28/10/2026. **LI** é código
> em `main` (`e46e3ed`). A seção "O que não está provado" diz o que falta medir em
> produção, e com que consulta.

## O sintoma (RECEBI)

- De 18/10 a 29/10, quase todo dia os 3 `discover_ids` do agendador
  (`scheduler/discovery`, ~03:40 UTC) terminam `dead_letter` depois de 5 tentativas,
  com `worker_heartbeat_timeout`. Três sucessos em 12 dias.
- Na mesma janela, `service_heartbeats` mostra o `screen-catalog-worker` renascendo
  ~5 vezes, um container a cada ~5 min (29/10: 03:45, 03:50, 03:55, 04:00, 04:06 UTC).
  Depois, estável o dia todo.
- Fora da janela, RSS de ~190 MB. O serviço não tem limite de memória no painel.

Como a descoberta é a porta de entrada de título novo desde 24/09, com ela morrendo
todo dia só entra título por pedido de leitor.

## O mecanismo

**LI.** O caminho de `discover_ids` com `strategy: 'daily-exports'` era inteiro em
memória e síncrono depois do download:

1. `bin/catalog-worker-service.ts` (e uma cópia em `bin/catalog.ts`): `fetch` →
   `arrayBuffer` → `gunzipSync` → `toString('utf8')`;
2. `discovery/export-discovery.ts`: `text.split('\n')` → `JSON.parse` de TODAS as
   linhas → `filterAdult` → `buildSyncQueue` (Map com chave string de cada id e
   `sort` do universo) → `slice(0, 2000)`.

Nada disso devolve a thread. Enquanto roda, o `/healthz` não responde, o heartbeat do
job (`setInterval` de 15 s em `catalog-jobs/worker.ts`) não dispara, e o reclaim
também não. O HEALTHCHECK do `Dockerfile.catalog-worker` é
`--interval=30s --timeout=5s --retries=3`: com o processo já de pé, três checagens
seguidas sem resposta levam de 75 a 105 s, conforme a fase, e o Swarm troca a task.

**MEDI.** Laboratório (Node 24, máquina de mesa): o `fetchExportText` copiado do bin,
o `discoverIdsFromExportText` do `HEAD`, o `/healthz` real
(`startCatalogHealthServer`), o heartbeat de 15 s e um simulador do HEALTHCHECK em
processo separado. Os três exports de 28/10/2026, ao mesmo tempo, como os laços do
worker os pegam (os três nascem na prioridade 20):

| export                     | gz    | linhas    | caracteres  |
| -------------------------- | ----- | --------- | ----------- |
| `person_ids_10_28_2026`    | 78 MB | 5.016.908 | 362.777.514 |
| `movie_ids_10_28_2026`     | 28 MB | 1.265.870 | 127.398.593 |
| `tv_series_ids_10_28_2026` | 5 MB  | 235.240   | 15.905.887  |

| `limit: 2000`                      | antes (`HEAD`) | depois          |
| ---------------------------------- | -------------- | --------------- |
| maior trecho sem devolver a thread | **14,9 s**     | **0,2 s**       |
| `/healthz` sem resposta            | 13,1 a 16,5 s  | nunca           |
| intervalo do heartbeat do job      | 23 a 27 s      | 15 s (o normal) |
| pico de RSS                        | **3,0 GB**     | 455 MB          |
| heap no fim                        | 2,1 GB         | 0,2 GB          |
| CPU                                | 25 a 26 s      | 11 a 12 s       |
| os 2.000 ids de cada tipo          | —              | sha256 idêntico |

Quatro rodadas com os três exports e uma só com o de pessoas: de 13,1 a 16,5 s de
`/healthz` mudo em todas. O maior trecho foi medido numa rodada de cada lado.

## O que não está provado

O laboratório reproduz o trecho único, o `/healthz` mudo e os 3 GB. Ele **não**
reproduz a troca do container: numa máquina de mesa o trecho é de ~15 s, e o
HEALTHCHECK precisa de 75 a 105 s. Para o Swarm trocar a task, o host de produção
teria de ser 5 a 7× mais lento nesse trecho. É plausível — 12 núcleos com load 17 e o
`screen-db` a 308% de CPU em 16/09 —, mas não foi medido. A outra explicação
compatível com o ciclo de ~5 min é o processo morrer pela memória.

O conserto vale para as duas: tira o trecho único e tira os 3 GB. Para saber qual
foi, sem escrever nada em produção:

```sql
SET default_transaction_read_only = on;

-- 1. Cada container: quanto viveu e quanto silencio ate o proximo subir.
--    HEALTHCHECK: nenhum silencio abaixo de ~80 s na janela das 03:40
--    (75 s de checagens no minimo, mais a parada e a subida).
--    Morte rapida (memoria, excecao): aparecem silencios abaixo de 60 s.
SELECT json_agg(x ORDER BY x->>'subiu') FROM (
  SELECT json_build_object(
    'subiu', to_char(started_at, 'MM-DD HH24:MI:SS'),
    'vida_s', round(extract(epoch FROM last_seen_at - started_at)),
    'silencio_s', round(extract(epoch FROM
      lead(started_at) OVER (ORDER BY started_at) - last_seen_at)),
    'rss_mb', rss_bytes / 1048576
  ) AS x
  FROM service_heartbeats
  WHERE service_key = 'screen-catalog-worker'
    AND started_at >= TIMESTAMP '2026-10-18'
) t;

-- 2. Os discover_ids: qual TIPO venceu nos 3 sucessos e em quanto tempo.
--    Se um `person` venceu, nao e falta de memoria deterministica.
SELECT json_agg(json_build_object(
  'tipo', entity_type, 'status', status, 'tent', attempts,
  'claim', to_char(claimed_at, 'MM-DD HH24:MI:SS'),
  'hb', to_char(heartbeat_at, 'MM-DD HH24:MI:SS'),
  'fim', to_char(completed_at, 'MM-DD HH24:MI:SS'),
  'dur_s', round(extract(epoch FROM completed_at - claimed_at)),
  'erro', last_error_code,
  'limit', payload->>'limit'
) ORDER BY created_at, entity_type)
FROM catalog_jobs
WHERE job_type = 'discover_ids' AND created_at >= TIMESTAMP '2026-10-18';
```

No host (o dono roda; o Swarm guarda as últimas tasks), a coluna de erro diz a causa
da troca. `unhealthy container` é o HEALTHCHECK; `exit (134)` é o V8 sem heap.
Confirme o nome com `docker service ls`:

```bash
docker service ps rss_prime_screen-catalog-worker --no-trunc --format '{{.CreatedAt}} {{.CurrentState}} {{.Error}}'
```

## O conserto

1. **Download em streaming** (`discovery/export-stream.ts`, usado pelos dois bins):
   `Readable.fromWeb` → `createGunzip` assíncrono → linhas em lotes, um lote por
   pedaço descomprimido. O gzip continua decidido pelo número mágico, porque o export
   chega sem `content-encoding`. Erro de rede ou gzip corrompido rejeita, e não
   termina com "0 ids" e sucesso.
2. **Top-N incremental** (`discoverIdsFromExportBatches`): cada linha vai direto ao
   sampler de `export-sample.ts`, o mesmo da CLI `discover-ids`, com memória O(N)
   mais o conjunto de ids vistos. A thread é devolvida a cada 10.000 linhas, mesmo
   que a fonte nunca espere IO. O `signal` do job (shutdown, timeout) interrompe
   entre dois lotes e cancela o download.
3. **O sampler passou a ter o contrato da fila**: id repetido mantém a MAIOR
   popularidade, como `buildSyncQueue` (antes mantinha a primeira ocorrência), e o
   descarte segue a ordem de `filterAdult`. Um teste compara o caminho novo com o
   pipeline antigo literal em 400 exports aleatórios, com empates, repetidos, adulto,
   valor malformado e id inválido.

As duas camadas anti-adulto continuam: `adult_*` nunca é baixado, e cada linha passa
por `classifyAdult` fail-closed antes de concorrer a um lugar na fila. A descoberta
continua offline, num worker, e não toca o render (invariante 3).

## O que sobra

- **`limit: null`** (o universo inteiro, só por escolha explícita): o `finish` do
  sampler ainda ordena os 5 milhões de uma vez. **MEDI:** um trecho de 5,2 s e 1,3 GB
  de pico. Não é o caminho diário (`limit` 2000).
- O caminho da fila não grava `api_sync_logs` para o download do export (a CLI
  `discover-ids --apply` grava). Já era assim antes desta mudança.
- Os `discover_ids` de 18/10 a 29/10 estão em `dead_letter`. Replay só depois do
  deploy, e é decisão do dono. Cada um baixa o export de ONTEM a partir de quando
  roda, então o replay não recupera os dias perdidos, só o de hoje.
