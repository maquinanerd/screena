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

## Worker-only
- **Somente workers offline (Python 3.12)**, agendados por systemd timers.
- **NUNCA chamado no render publico.**

## Requisitos tecnicos obrigatorios
- **cache**, **retry**, **rate-limit**, **backoff**, **circuit-breaker** e **logs** em
  `api_sync_logs`.
- **API key so em env var.**

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
