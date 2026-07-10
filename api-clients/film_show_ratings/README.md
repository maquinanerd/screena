# api-clients/film_show_ratings

Cliente do agregador tecnico **Film/Show Ratings** (ex.: via RapidAPI). E um
**fornecedor tecnico** (`provider_api`) que entrega notas de multiplas fontes editoriais
em uma unica chamada. **NAO** e, ele proprio, uma fonte editorial.

## Papel
- Canal tecnico consumido por `services/ratings` para coletar notas de varias fontes.
- Cada nota retornada deve ser **reatribuida a sua fonte editorial real**
  (`rating_source` = imdb, rotten_tomatoes, metacritic, letterboxd, filmaffinity), com a
  **escala correta** (imdb=10, rotten_tomatoes=100, metacritic=100, letterboxd=5,
  filmaffinity=10).
- Preenche `provider_api` e `provider_payload_hash` em `external_ratings`.

## Estado atual
- Implementado em **TypeScript/Node** (`@screena/film-show-ratings-client`), offline.
  Python 3.12 segue como roadmap/shim, nao como implementacao atual (CLAUDE.md secao 4).
- Consumido por [`services/ratings`](../../services/ratings).

## Endpoints
- `GET /item/?id=<IMDb_ID>` — payload de UM titulo (ex.: `id=tt9603208`).
  **Liberado no plano Pro**; e o endpoint usado pelo worker de enriquecimento
  (`buildItemRequest`/`getItem`).
- `GET /popular/?type=film` · `GET /popular/?type=show` · `GET /popular/` —
  **NAO liberado no plano contratado** (403). Mantido no client apenas por
  retrocompatibilidade (`buildPopularRequest`/`getPopular`); o fluxo novo nao o chama.

Base URL: `https://film-show-ratings.p.rapidapi.com` · host: `film-show-ratings.p.rapidapi.com`.

O id do `/item/` e validado como IMDb id (`tt<digitos>`) via `isImdbId`. TMDB id no request
fica como TODO (nao chutamos um formato nao validado).

O client devolve o payload **cru** (`unknown`): esta API **nao publica schema de
resposta**, entao o client nao inventa tipos. Quem interpreta e `services/ratings`, com
um reconhecedor **estrito** que recusa todo dado ambiguo.

## Worker-only
- **Somente workers offline.** Agendamento por systemd timers e roadmap.
- **NUNCA chamado no render publico.**

## Requisitos tecnicos obrigatorios
- **cache**, **retry**, **rate-limit**, **backoff**, **circuit-breaker** e **logs** em
  `api_sync_logs` — todos vindos de [`api-clients/rapidapi-core`](../rapidapi-core).
- **API key so em env var**: `RAPIDAPI_FILM_SHOW_RATINGS_KEY`. A chave viaja **so em
  header** (`x-rapidapi-key`), nunca em URL, log, erro, sample ou relatorio.

## Variaveis de ambiente
| Variavel | Obrigatoria | Default |
| --- | --- | --- |
| `RAPIDAPI_FILM_SHOW_RATINGS_KEY` | sim | — (falha explicita) |
| `RAPIDAPI_FILM_SHOW_RATINGS_HOST` | nao | `film-show-ratings.p.rapidapi.com` |
| `RAPIDAPI_FILM_SHOW_RATINGS_BASE_URL` | nao | `https://film-show-ratings.p.rapidapi.com` |
| `RAPIDAPI_FILM_SHOW_RATINGS_CACHE_TTL_MS` | nao | `86400000` (24h) |

## Atribuicao / licenca
- **provider_api != rating_source** — este fornecedor **nunca** aparece como fonte da nota.
- A nota so e exibida se a `source_licenses` da fonte editorial permitir
  (`display_allowed`, `score_allowed`), com `attribution_text`/`attribution_url` quando
  exigido.

## Invariantes aplicaveis (criticas)
- **provider_api != rating_source** — este e o fornecedor tecnico, NAO a fonte editorial.
- **IMDb != Rotten Tomatoes** — nunca misturar fontes/escalas; **nota IMDb (10) nunca vira
  Tomatometer**.
- **Nada de AggregateRating fingindo nota propria.**
- **Sem licenca clara, nao exibe.**
- **Zero API externa no render.**
