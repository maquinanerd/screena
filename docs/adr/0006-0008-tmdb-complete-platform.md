# ADR 0006-0008 — Plataforma TMDB completa (Fases 6-8)

- Status: aceito (implementação em PR **#69 draft** para revisão; macrofase F6-F8).
- Data: 2026-07-15 (contrato TMDB v3/v4 consultado nesta data; developer.themoviedb.org/reference).
- Contexto: após [[0005-api-coverage-registry]] (Fase 5), a superfície TMDB era
  detalhe-cêntrica. A PR #69 consolida **uma única macrofase** — catálogo/relações
  (F6), imagens/vídeos (F7) e busca/discovery/tendências/listas/changes (F8) — sobre
  o registro de cobertura, com validador integrado e `api:coverage` verde. O ADR 0006
  original (catálogo/taxonomia) foi renomeado (git mv) e ampliado para cobrir F6-F8.

## Checkpoint F6 — catálogo e relações

- **Client tipado de catálogo** (`api-clients/tmdb/src/catalog.ts`, 34 métodos):
  configuration, taxonomias, listas movie/tv, discover, busca, changes, trending e
  mídia (imagens/vídeos). Discover valida filtros (allowlist) + serialização
  determinista + rejeita filtro desconhecido; busca exige query não-vazia; trending
  valida media_type/time_window. Auth v4 no header. Adicionado a `ENUMERATION_SOURCES`
  (drift reverso: todo `async get<X>(` registrado).
- **Taxonomia**: worker `config-sync` captura raw de 8 endpoints em `api_cache` + log;
  **`/configuration` → `tmdb_image_config`** (normalizado, idempotente) e
  **`/genre/{movie,tv}/list` → `genres`** (normalizado; nova tabela).

## Checkpoint F7 — imagens e vídeos

- Endpoints de imagens (movie/tv/season/episode/person) e vídeos (movie/tv/season/
  episode) no client.
- Worker `catalog-sync/media-sync` (puro, port-based) + normalizadores
  (`media-normalize`) + adapter Prisma `media-store` (idempotente por identidade
  natural). Normaliza **metadados** em novas tabelas **`tmdb_images`** e
  **`tmdb_videos`**.
- Governança: só metadados (nenhum binário baixado); linhas nascem
  **`display_allowed=false` + `license_status=unknown`** (invariante 6). **Nunca
  `public_ready`** só porque o metadado foi normalizado — exibição é decisão humana.

## Checkpoint F8 — busca, discovery, tendências, listas e changes

- Worker `catalog-sync/list-sync` (puro, port-based): execução **paginada** com
  **captura raw por página** em `api_cache` (chave inclui a página), log por ciclo,
  extração/dedup de ids e **checkpoint/resume** persistido em nova tabela
  **`tmdb_sync_checkpoint`**. Respeita `total_pages` e um teto `maxPages` (nunca
  carrega tudo em memória).
- Listas curadas (7), discover (2) e trending → `raw_captured` (executados via
  list-sync; mecanismo validado). Busca e changes permanecem client+executor prontos,
  registrados honestamente.

## Schema / migrations

- **Uma migration nova, forward-only e aditiva** (`20260716120000_tmdb_media_genres_checkpoint`):
  `genres`, `tmdb_images`, `tmdb_videos`, `tmdb_sync_checkpoint`. Nenhuma tabela
  existente alterada; nenhuma linha apagada. `db:validate:real` (36 tabelas) e
  `db:validate:upgrade` verdes.

## CLI / validador / registro

- **CLI unificada** `bin/sync-tmdb.ts` (subcomandos configuration|taxonomies|genres|
  media|lists|discover|trending; args --apply/--dry-run/--id/--language/--region/
  --page/--max-pages/--resume/...). `sync-tmdb-config` preservado como wrapper.
- **Validador integrado** `validate:tmdb-platform` (PostgreSQL 16 efêmero, client real
  + transporte fake): 15 checks — taxonomia raw, config normalizado, genres
  normalizados, mídia imagens/vídeos normalizados + `display_allowed=false`,
  idempotência, execução paginada + checkpoint/resume, determinismo de mudança, logs.
  A CI roda **só** este (o antigo `validate:tmdb-catalog` é alias leve).
- **Registro** (`docs/api-coverage/*`) fiel ao código: 68 endpoints, 34 campos.
  configuration/genres → `normalized`; taxonomias/listas/discover/trending →
  `raw_captured`; mídia → `normalized` (campo `blocked_license` por display gated);
  `api:coverage` verde.

## Contrato TMDB (nota de honestidade)

Os DTOs são **subsets defensivos** de transporte (campos opcionais), não o schema
completo do TMDB. As tabelas normalizadas cobrem o subset com destino real; o resto
fica `raw_captured` (§11, sem forçar coluna inadequada). Nenhuma chamada real ao TMDB
foi feita — tudo validado offline com transporte fake.

## Escopo deixado para F9-F11

- Ingestão de entidade a partir de search/discover/changes por **job explícito**
  (não normaliza resultados efêmeros de busca automaticamente).
- Normalização de relações de detalhe mais profundas (collections/companies/networks/
  keywords em tabelas próprias) e changes incremental com janela from/to dedicada.
- Política completa de exibição/licença de mídia (promoção display_allowed) — humana.
- Fases 9-11 (streaming, ratings, Entity Writer/Gemini) permanecem fora desta PR.