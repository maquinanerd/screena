# 05 — Jobs, workers e fluxos offline

> Toda execução que roda **fora do caminho de render**. SHA `73c58e9`.

---

## 1. Princípio

Nenhum job roda no render. Todos são CLIs offline (`bin/*.ts`) invocados manualmente ou por
agendador do sistema operacional. Não há fila em memória, broker externo, nem cron dentro do
aplicativo Next — o agendamento é responsabilidade do host (systemd/cron), fora do repositório.

---

## 2. Entrypoints de CLI (20 verificados)

### `services/ingestion` — catálogo TMDB

| CLI | Papel |
| --- | --- |
| `bin/discover-ids.ts` | Baixa os Daily ID Exports do TMDB; enfileira o universo de IDs |
| `bin/sync-tmdb-raw.ts` | Sync bruto → `api_cache` |
| `bin/promote-tmdb-raw.ts` | Promove bruto → tabelas finais normalizadas |
| `bin/sync-tmdb.ts` | Sync de detalhe de entidade |
| `bin/sync-tmdb-config.ts` | Configuração de imagem TMDB |
| `bin/catalog.ts` | Orquestrador da fila `catalog_jobs` |
| `bin/import.ts` · `bin/ingest-public-catalog.ts` | Importação/carga |

### `services/entity-writer` — editorial offline

| CLI | Papel |
| --- | --- |
| `bin/enqueue.ts` | Enfileira entidade para redação |
| `bin/run.ts` · `bin/run-offline.ts` | Executa o writer (Gemini offline) |
| `bin/inspect.ts` | Inspeciona blocos gerados |
| `bin/smoke-gemini.ts` | Smoke do adapter (manual) |

### Inteligência externa

| CLI | Papel |
| --- | --- |
| `services/ratings/bin/sync-film-show-ratings.ts` | Ratings via RapidAPI |
| `services/ratings/bin/ratings.ts` | Orquestrador de ratings |
| `services/streaming/bin/sync-streaming-availability.ts` | Disponibilidade de streaming |
| `services/streaming/bin/review-watch-availability.ts` | Revisão humana de ofertas |
| `services/streaming/bin/promote-watch-availability.ts` | **Promoção humana** por IDs explícitos |
| `services/legal/bin/legal.ts` | Registro de autorização de fontes |
| `services/sync/bin/run.ts` | Política de frescor/stale |

> Note o par `review-` / `promote-`: exibição de "onde assistir" exige **ação humana explícita**,
> nunca promoção automática.

---

## 3. Fila de jobs de catálogo

`CatalogJob` (+ enums `CatalogJobType`, `CatalogJobStatus`) implementa a fila **no PostgreSQL**,
com claim atômico via SQL. Testes dedicados:
`services/ingestion/src/catalog-jobs/__tests__/catalog-job-claim-sql.test.ts` e
`services/entity-writer/src/__tests__/job-claim-sql.test.ts`.

Validada por `validate:catalog-platform-complete` (**78/78**), que exercita fila, busca,
locale e indexabilidade em PostgreSQL real.

---

## 4. Resiliência exigida pelas regras de ingestão

As regras exigem cinco mecanismos em todo client externo. Estado no baseline:

| Mecanismo | Estado | Evidência |
| --- | --- | --- |
| Retry com backoff exponencial | implementado | `TMDB_MAX_RETRIES`, `RAPIDAPI_*_MAX_RETRIES` (`api-clients/*/src/config.ts`) |
| Rate limit por provider | implementado | `TMDB_MAX_RPS`, `RAPIDAPI_*_MAX_RPS` |
| Circuit breaker por API | implementado | `*_BREAKER_THRESHOLD`, `*_BREAKER_COOLDOWN_MS` |
| Cache local (`api_cache`) | implementado | modelo `ApiCache`; `validate:tmdb-platform` check 12 |
| Hash de payload (evita update sem mudança) | implementado | `validate:external-intelligence-product` check 51: *"sync identico renova fetched_at SEM bumpar updated_at"* |

Cada mecanismo tem variável de configuração própria por provider, isolando cota entre fontes.

---

## 5. Log de sync — `api_sync_logs`

A regra é "todo sync externo gera log, sem exceção".

✅ **Confirmado no caminho TMDB:** `validate:tmdb-platform` check 14 —
*"todo sync gera log (nenhuma ingestao silenciosa) — logs=22"*.

⚠️ **Achado não verificado (R-19):** o agente `services-ingestion-sync` reporta que a **fila de
jobs de catálogo** — o caminho de ingestão mais novo e mais wired — **não** escreveria em
`api_sync_logs`, o que violaria a regra. Confirmar antes de agir.

---

## 6. Filtragem de conteúdo adulto

Duas camadas exigidas pelas regras:

1. Arquivos `adult_*` do TMDB nunca são baixados (só os 7 exports padrão).
2. Campo `adult` classificado **fail-closed** por linha e por tipo: `false` é seguro; `true`
   descarta; valor malformado descarta como *unsafe*; ausência é insegura nos exports que
   deveriam trazê-lo (movie/person).

⚠️ **Achado não verificado (R-20):** a filtragem seria fail-closed no caminho de Daily ID Exports
mas **não** no caminho `/changes` (incremental). Como conteúdo adulto entrando no catálogo é uma
falha grave, este é o lead ⚠️ de maior prioridade para confirmar.

---

## 7. Entity Writer — pipeline editorial

Fluxo (regra canônica, implementada):

1. Montar `EntityPayload` controlado a partir do PostgreSQL.
2. Selecionar prompt versionado de `prompts/` (8 arquivos) e registrar `prompt_version`.
3. Gerar saída com Gemini **offline** — a IA redige, não decide verdade.
4. `validateEntityWriterOutput` (forma) + `validateAgainstPayload` (anti-alucinação).
5. Persistir em `content_blocks` com `prompt_version`, `input_hash`, `output_hash`,
   `model_provider`, `model_name`, `review_status`, `warnings_json`.
6. **Nunca publicar automaticamente.**

Testes: `services/entity-writer/src/__tests__/hash.test.ts`, `select-prompt.test.ts`,
`content-block-store-sql.test.ts` (22 arquivos de teste no serviço).

**Estado real:** o pipeline está pronto e testado, mas **nenhum bloco foi gerado** — o catálogo
está vazio, então não há entidade sobre a qual escrever.

---

## 8. Frescor e agendamento

- `last_synced_at` (último sync confiável) e `stale_after` (janela de obsolescência) por registro.
- `services/sync` decide o que é stale (`stale-policy.test.ts`).
- Periodicidades-alvo (detalhe/lançamentos/ratings/streaming/trending/mídia) estão definidas nas
  regras de ingestão; **o agendamento em si é externo ao repositório** (systemd/cron no host).

> Não existe agendador dentro do aplicativo. Um ambiente novo não sincroniza nada sozinho:
> é preciso configurar o agendamento no host. Isso não está automatizado nem versionado.

---

## 9. Idempotência

| Fluxo | Mecanismo |
| --- | --- |
| `migrate deploy` | idempotente — comprovado no smoke (`No pending migrations to apply`) |
| Sync TMDB | hash de payload: sem mudança, não reescreve nem bumpa `updated_at` |
| Mídia TMDB | `validate:tmdb-platform` check 8: *"2o ciclo nao duplica — created=0, unchanged=2"* |
| Paginação de lista | checkpoint persistido; resume continua da página seguinte (checks 9–11) |
| Eventos de tracking | unique parcial `(user_id, idempotency_key, event_type)` — migration C7A.1 |
| Dedup de ofertas | identidade versionada + arquivamento da removida (perda zero, check 23) |

---

## 10. Workers Python — legado

`workers/` contém 379 linhas de esqueleto Python (`tmdb_worker.py`, `ratings_worker.py`,
`streaming_worker.py`, `rssprime_worker.py`, `entity_writer_worker.py`, `scheduler.py`).

**Classificação: legado.** A implementação real é TypeScript/Node + Prisma. Estes arquivos não são
invocados por nada no repositório e não devem receber trabalho novo.
