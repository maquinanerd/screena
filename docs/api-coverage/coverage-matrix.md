# Matriz de cobertura de API — Cinerie (Fase 5)

> Visão humana do registro. A **fonte de verdade** é o par
> [`endpoints.json`](./endpoints.json) + [`fields.json`](./fields.json), validado
> contra o código por `pnpm api:coverage` (quebra em drift). Esta matriz é um
> resumo derivado — se divergir dos JSON, os JSON vencem. Semântica dos estados e
> decisões em [`decisions.md`](./decisions.md).

## Os 8 estados de cobertura

Exatamente **1 por endpoint e 1 por campo**:

| Estado | Significado |
| --- | --- |
| `raw_captured` | Resposta bruta capturada (`tmdb_raw`/`api_cache`); ainda não normalizada. |
| `normalized` | Persistido em tabela tipada; pode ou não ser exibido. |
| `public_ready` | Elegível a exibir em página indexável (licença + idioma + técnico OK). |
| `blocked_license` | Capturado/disponível, exibição bloqueada por licença/atribuição (invariante 6). |
| `blocked_privacy` | Bloqueado por privacidade/segurança de conteúdo (ex.: exclusão de conteúdo adulto). |
| `blocked_plan` | Bloqueado pelo plano contratado da API (ex.: `/popular/` 403 no Pro). |
| `not_applicable` | Legitimamente não se aplica **ou** exigido pelo plano mas ainda não implementado (sempre com `justification`). |
| `deprecated` | Legado/substituído (sempre com `superseded_by`). |

## Providers técnicos (nunca fontes editoriais — invariante 2)

| Provider (`provider_api`) | kind | status | Papel |
| --- | --- | --- | --- |
| `tmdb` | data | active | Catálogo (filmes/séries/temporadas/episódios/pessoas) + descoberta. |
| `gemini` | ai | active | Entity Writer offline (só `:generateContent`). Nunca no render. |
| `rapidapi_film_show_ratings` | ratings | roadmap | Agregador técnico de notas (reatribui à fonte editorial real). |
| `imdb236` | ratings | seeded | Transporte legado de notas IMDb (seed `api_providers`, sem client). |
| `streaming_availability` | streaming | roadmap | Onde assistir (Movie of the Night), BR-only. |
| `kaso` | streaming | inactive | Fallback de disponibilidade (stub README). |
| `rssprime` | news | roadmap | Upstream de feeds de notícias (pipeline roadmap). |

> Fontes editoriais de rating (`rating_source`, em `@screena/config`): `imdb`,
> `rotten_tomatoes`, `metacritic`, `letterboxd`, `filmaffinity`. **Nunca**
> aparecem como `provider_api`.

## Endpoints por provider × estado

### TMDB (`tmdb`)

| Endpoint | Impl. | Estado |
| --- | --- | --- |
| `tmdb.movie.details` — GET /movie/{id} | ✅ | `public_ready` |
| `tmdb.tv.details` — GET /tv/{id} | ✅ | `public_ready` |
| `tmdb.tv.season.details` — GET /tv/{id}/season/{n} | ✅ | `public_ready` |
| `tmdb.person.details` — GET /person/{id} | ✅ | `public_ready` |
| `tmdb.movie.upcoming` — GET /movie/upcoming | ✅ | `public_ready` |
| `tmdb.tv.episode.details` — GET .../episode/{e} | ✅ | `not_applicable` (método definido, não chamado) |
| `tmdb.discovery.daily_id_exports` — files.tmdb.org | ✅ | `raw_captured` |
| `tmdb.discovery.changes` — /{kind}/changes | ✅ (contrato) | `not_applicable` (planner, não executado) |
| `tmdb.search` / `tmdb.discover` / `tmdb.trending` / `tmdb.lists` | ❌ | `not_applicable` (roadmap F8) |
| `tmdb.recommendations.standalone` / `tmdb.similar.standalone` | ❌ | `not_applicable` (roadmap F8) |
| `tmdb.watch_providers.standalone` | ❌ | `not_applicable` (onde-assistir vem do streaming_availability) |
| `tmdb.configuration` | ❌ | `not_applicable` (CDN hardcoded; roadmap F7) |
| `tmdb.collection.details` — GET /collection/{id} | ✅ | `normalized` (collections + movie_collection_memberships) |
| `tmdb.taxonomy.details` — GET /network,/company,/keyword {id} | ✅ | `normalized` (networks/production_companies/keywords + joins) |
| `tmdb.auth_account` | ❌ | `not_applicable` (read-only por design) |

### Gemini (`gemini`)

| Endpoint | Impl. | Estado |
| --- | --- | --- |
| `gemini.generateContent` — POST :generateContent | ✅ | `normalized` (gated por review_status) |
| `gemini.streamGenerateContent` / `structured_output` / `generationConfig` | ❌ | `not_applicable` (roadmap F11) |
| `gemini.batchGenerateContent` / `cachedContents` / `files` | ❌ | `not_applicable` (roadmap F11) |
| `gemini.countTokens` (passivo hoje) / `embedContent` | ❌ | `not_applicable` (roadmap F11) |
| `gemini.safetySettings` / `models.list` / `deprecations` | ❌ | `not_applicable` (roadmap F11) |

### Ratings (`rapidapi_film_show_ratings`, `imdb236`)

| Endpoint | Impl. | Estado |
| --- | --- | --- |
| `film_show_ratings.item` — GET /item/?id=<IMDb> | ✅ | `blocked_license` (display_allowed=false) |
| `film_show_ratings.popular` — GET /popular/ | ✅ | `blocked_plan` (403 Pro; superseded por `.item`) |
| `imdb236.item` — legado | ❌ | `deprecated` (superseded por `film_show_ratings.item`) |

### Streaming (`streaming_availability`, `kaso`)

| Endpoint | Impl. | Estado |
| --- | --- | --- |
| `streaming_availability.show` — GET /shows/{imdbId} | ✅ | `blocked_license` (atribuição obrigatória) |
| `streaming_availability.person_season_episode` | ❌ | `not_applicable` (kinds movie\|tv) |
| `streaming.kaso.fallback` | ❌ | `not_applicable` (stub, não usar no MVP) |

### Notícias (`rssprime`)

| Endpoint | Impl. | Estado |
| --- | --- | --- |
| `news.rssprime.ingest` — feeds RSSPRIME | ❌ | `not_applicable` (roadmap F13) |

## Campos por estado (resumo)

| Estado | Grupos de campo (exemplos) |
| --- | --- |
| `public_ready` | `movies.core`, `tv_shows.core`, `seasons.core`, `episodes.core`, `people.core`, `cast_members`, `crew_members` |
| `normalized` | `movies.tmdb_vote_signal` (sinal técnico, nunca rating), `entity_external_ids`, `content_blocks.editorial` (gated por review_status) |
| `raw_captured` | `tmdb.append.media`, `tmdb.append.relations`, `tmdb.append.reviews`, `tmdb.append.translations`, `tmdb.append.watch_providers`, `tmdb.append.dates_ratings`, `tmdb.append.changes` |
| `blocked_license` | `people.biography`, `external_ratings.{imdb,rotten_tomatoes,metacritic,letterboxd,filmaffinity}`, `watch_availability.offers` |
| `blocked_privacy` | `discovery.adult_content` |
| `not_applicable` | `content_blocks.roadmap_types`, `articles.core` (roadmap F13) |

## Lacunas exigidas pelo plano (roadmap, `not_applicable`)

Nada é descartado silenciosamente. Áreas exigidas pela cobertura total, ainda não
implementadas, ficam registradas com `not_applicable` + `justification` citando a fase:

- **TMDB** (F7/F8): trending, listas de usuário (v3 `/list`), recomendações/similares standalone, watch providers standalone, coleções, network/company/keyword detalhe. Busca/discover/listas curadas/changes têm **client tipado + testado** (F6) mas ainda sem worker de execução (F8).
- **Gemini** (F11): streaming, structured output, generationConfig, batch, caching, Files, countTokens ativo, embeddings, safety, models list, deprecações.
- **Streaming** (F9): disponibilidade de pessoa/temporada/episódio; modelagem platforms/providers; fallback KASO.
- **Notícias** (F13): pipeline RSSPRIME/MN26 completo.
- **Ratings** (F10): clients diretos IMDb/Rotten Tomatoes (hoje só o agregador).

## Fase 6 (delta) — cobertura do catálogo TMDB

Client de catálogo tipado (`api-clients/tmdb/src/catalog.ts`, drift-guardado) + worker de
taxonomia (`services/ingestion/src/config-sync`) + validador `validate:tmdb-catalog`.
Endpoints TMDB subiram de 8 → 29. Estados reais alcançados:

| Endpoint(s) | Estado F6 | Como |
| --- | --- | --- |
| `tmdb.configuration` | `normalized` | Worker de taxonomia normaliza `/configuration` → `tmdb_image_config` (idempotente). |
| `tmdb.configuration.{countries,languages,jobs}`, `tmdb.genres.{movie,tv}`, `tmdb.certifications.{movie,tv}` | `raw_captured` | Worker de taxonomia captura raw em `api_cache` + log em `api_sync_logs` (8 endpoints/ciclo). Sem tabela normalizada dedicada nesta fase (§11). |
| `tmdb.movie.{popular,top_rated,now_playing}`, `tmdb.tv.{popular,top_rated,airing_today,on_the_air}` | `not_applicable` | Client tipado + testado; worker de execução roadmap F8. |
| `tmdb.discover.{movie,tv}`, `tmdb.search.{movie,tv,person,multi}`, `tmdb.changes.{movie,tv,person}` | `not_applicable` | Client tipado + testado (discover valida filtros + serialização determinista); execução roadmap F8. |

Campos novos: `tmdb.config.image_sizes` (`normalized`), `tmdb.taxonomy.{genres,certifications,reference}_raw`
(`raw_captured`). Certificação = classificação **indicativa** (advisory), nunca rating editorial.

## Como manter

1. Alterou um endpoint/campo de provider? Atualize `endpoints.json`/`fields.json`.
2. Rode `pnpm api:coverage` — ele quebra se uma âncora sumir ou um método-endpoint novo não estiver registrado.
3. Promoção de estado sensível (`blocked_license` → `public_ready`) **exige decisão humana de licença** (invariante 6) — nunca é automática.
