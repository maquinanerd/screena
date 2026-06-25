# services/ingestion

Servico de **ingestao de entidades** da Screena. Responsavel por trazer dados brutos de
catalogos externos (filmes, series, temporadas, episodios, pessoas) para dentro do
PostgreSQL canonico, normalizando-os para as tabelas `movies`, `tv_shows`, `seasons`,
`episodes`, `people`, `cast_members`, `crew_members` e a tabela de mapeamento
`entity_external_ids`.

> Escopo da Fase 2 (`docs/PHASE_2_TMDB_PLAN.md`): NAO grava `slugs`/`redirects`,
> `entity_translations` nem `images`/`trailers`/`franchises`/`genres` (sem tabela alvo no
> schema da Fase 1). Posters/backdrops/stills/profiles ficam apenas como caminhos
> (`*_path`) nas proprias entidades.

## O que faz
- Orquestra o api-client `tmdb` (por ID) para baixar metadados de entidades.
- Normaliza e deduplica entidades, resolvendo IDs externos via `entity_external_ids` com
  `source` namespaceado por tipo (`tmdb_movie`/`tmdb_tv`/`tmdb_person`, alem de `imdb`).
- Faz upsert idempotente; creditos (`cast_members`/`crew_members`) por "replace-set" em
  transacao.
- Grava o bruto em `api_cache` (com short-circuit por `payload_hash`) e 1 log por ciclo em
  `api_sync_logs`.
- Carimba `last_synced_at`/`stale_after` para reprocessamento downstream via `services/sync`.

## Como roda
- **TypeScript/Node + Prisma, sempre offline** (Fase 2, `docs/PHASE_2_TMDB_PLAN.md`).
  CLI `bin/import.ts` (por ID ou `--seed`), disparado por **systemd timers** na VPS via
  `services/sync`. Arquitetura ports/adapters: normalizers puros (tipados/testados) +
  adapters Prisma isolados (`src/persistence/*`, fora do typecheck).
- **NUNCA e chamado no render publico.** Paginas indexaveis leem apenas PostgreSQL/cache
  local — nenhuma chamada a este servico ou a APIs externas acontece durante o render.

## Estrutura (Fase 2)
- `src/normalizers/*` — TMDB -> input canonico (PUROS, testados).
- `src/import/*` — orquestracao por ID via ports (testada com fakes).
- `src/persistence/*` — adapters Prisma (api_cache, api_sync_logs, upsert idempotente).
- `src/ports.ts` / `src/types.ts` — contratos; `src/seed-ids.ts` — lista curada de dev.
- `bin/import.ts` / `src/composition.ts` — wiring runtime (worker-only).

## Resiliencia obrigatoria
- **Cache** local de respostas (`api_cache`) para evitar refetch desnecessario.
- **Retry** com **backoff** exponencial em falhas transitorias.
- **Rate-limit** respeitando os limites do fornecedor tecnico.
- **Circuit-breaker** para suspender chamadas quando o upstream esta degradado.
- **Logs** estruturados de todo sync em `api_sync_logs` (sucesso, falha, contagem,
  duracao, provedor).

## Invariantes aplicaveis
- **Zero API externa no render** — toda chamada externa acontece aqui, offline.
- **provider_api != rating_source** — o fornecedor tecnico (ex.: RapidAPI/TMDB) nunca e
  tratado como fonte editorial.
- **API keys so em env vars** — nunca expostas no frontend.
- **Dados sem licenca clara nao aparecem** — campos com `license_status` em
  `unknown`/`blocked` ou `display_allowed=false` ficam fora de pagina indexavel.
- **pt-BR primeiro** — traducoes en/es nascem em `draft`/`noindex` ate revisao humana.
- A ingestao **nao inventa fatos**: apenas persiste o que o upstream retorna, com origem
  rastreavel.
