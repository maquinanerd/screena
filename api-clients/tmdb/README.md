# api-clients/tmdb

Cliente do **TMDB (The Movie Database)** — fornecedor tecnico primario de metadados de
entidades (filmes, series, temporadas, episodios, pessoas, imagens, trailers) e da base de
mapeamento de IDs externos.

## Papel
- Fonte tecnica de metadados consumida por `services/ingestion`.
- Resolve `tmdb_id` <-> IDs canonicos e fornece `imdb_id` de referencia quando disponivel.
- Abastece `images` e `trailers` com material de catalogo.

## Worker-only
- Usado **somente por workers offline (Python 3.12)**, agendados por systemd timers.
- **NUNCA chamado no render publico** — paginas indexaveis leem apenas PostgreSQL/cache.

## Requisitos tecnicos obrigatorios
- **cache** (`api_cache`), **retry**, **rate-limit**, **backoff**, **circuit-breaker** e
  **logs** de cada chamada em `api_sync_logs`.
- **API key so em env var** — nunca no frontend.

## Atribuicao / licenca
- TMDB e **provider_api** (fornecedor tecnico), **nao** uma `rating_source` editorial.
- Respeitar termos de uso e atribuicao do TMDB conforme `source_licenses`
  (`requires_attribution`, `logo_allowed`).
- Dados com `license_status` em `unknown`/`blocked` ou `display_allowed=false` **nao**
  vao para pagina indexavel.

## Invariantes aplicaveis
- **provider_api != rating_source.**
- **Zero API externa no render.**
- **Sem pirataria** — somente metadados e links oficiais.
