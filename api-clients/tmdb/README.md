# api-clients/tmdb

Cliente do **TMDB (The Movie Database)** — fornecedor tecnico primario de metadados
estruturais de entidades (filmes, series, temporadas, episodios, pessoas) e da base de
mapeamento de IDs externos.

## Papel
- Fonte tecnica de metadados consumida por `services/ingestion`.
- Resolve `tmdb_id` <-> IDs canonicos e fornece `imdb_id` de referencia quando disponivel.
- Fornece caminhos de imagem (`poster_path`/`backdrop_path`/`still_path`/`profile_path`),
  guardados como caminho na propria entidade. Galerias de `images`/`trailers` ficam fora da
  Fase 2 (sem tabela alvo no schema).

## Worker-only
- Usado **somente por workers/CLIs offline (TypeScript/Node)**, agendados por systemd timers.
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

## Configuracao (env vars)

Chaves vivem SO em env vars — nunca no frontend/bundle/versionadas. Use UM modo
de auth (v4 preferido). Estas variaveis tambem constam no `.env.example` da raiz.

| Variavel | Obrigatorio | Default | Papel |
| --- | --- | --- | --- |
| `TMDB_READ_ACCESS_TOKEN` | auth (v4)* | — | Token Bearer v4 (preferido). |
| `TMDB_API_KEY` | auth (v3)* | — | api_key v3 (alternativa). |
| `TMDB_API_BASE_URL` | nao | `https://api.themoviedb.org/3` | Base da API. |
| `TMDB_DEFAULT_LANGUAGE` | nao | `pt-BR` | Idioma de campos localizados. |
| `TMDB_MAX_RPS` | nao | `20` | Throttle local (req/s). |
| `TMDB_MAX_RETRIES` | nao | `4` | Tentativas em erro transitorio. |
| `TMDB_BREAKER_THRESHOLD` | nao | `5` | Falhas consecutivas p/ abrir o circuito. |
| `TMDB_BREAKER_COOLDOWN_MS` | nao | `30000` | Cooldown do circuito (ms). |
| `TMDB_CACHE_TTL_MS` | nao | `86400000` | TTL do `api_cache` (ms). |

\* Pelo menos um entre `TMDB_READ_ACCESS_TOKEN` e `TMDB_API_KEY`. Sem auth,
`loadTmdbConfig` lanca `TmdbConfigError` — nunca chama a rede sem chave.

## Uso (worker-only)

```ts
import { createTmdbClient } from '@screena/tmdb-client'

const { endpoints } = createTmdbClient() // usa process.env + fetch global
const movie = await endpoints.getMovie(27205)
```

Em teste, injete um transporte fake (sem rede):

```ts
createTmdbClient({ env, deps: { transport: fakeTransport } })
```

Resiliencia embutida: throttle por `maxRps`, retry com backoff + jitter (so
429/5xx/rede; 4xx nunca), circuit breaker por fonte. O transporte, o relogio, o
`sleep` e o `random` sao injetaveis para testes deterministas.

## `append_to_response` por tipo (raw sync)

Os metodos de detalhe buscam o `append_to_response` **maximo** por tipo, para
trazer sub-recursos + **todas as traducoes** (`translations`) num unico request.
As constantes vivem em [`src/append-to-response.ts`](./src/append-to-response.ts)
e sao a unica fonte usada pelos endpoints.

- **Fonte de verdade:** derivado da doc oficial do TMDB
  (`developer.themoviedb.org`), verificando a existencia de cada endpoint de
  sub-recurso em `/reference/*` — **nunca de memoria**.
- **Somente 5 tipos suportam append.** O guia oficial declara textualmente que
  apenas os metodos de detalhe de *movie, TV show, TV season, TV episode e
  person* suportam `append_to_response`. Por isso **collection/network/company/
  keyword nao tem constante de append** aqui.
- **`translations` e obrigatorio** em todos os 5 tipos (captura pt/en/es/todos os
  idiomas num request).
- **Excluidos de proposito:** `account_states` (exige sessao de usuario) e
  `lists` (curadoria de usuario, paginada) — nao sao metadado de entidade.
- **Teto de sub-requests:** `TMDB_APPEND_LIMIT = 20`. `partitionAppend()`
  particiona qualquer conjunto que exceda o teto em multiplos blocos; o endpoint
  faz uma chamada por bloco e mescla os sub-recursos na resposta base. Hoje todos
  os conjuntos cabem em 1 bloco (o maior, serie, tem 16 valores).

| Tipo | Metodo | nº de sub-recursos |
| --- | --- | --- |
| movie | `getMovie` | 13 |
| tv (serie) | `getTvShow` | 16 |
| temporada | `getTvSeason` | 7 |
| episodio | `getTvEpisode` | 5 |
| pessoa | `getPerson` | 8 |
