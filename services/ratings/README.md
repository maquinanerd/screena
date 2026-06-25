# services/ratings

Servico de **ingestao e atribuicao de ratings externos**. Popula e mantem a tabela
`external_ratings`, sempre preservando a separacao entre **fonte editorial**
(`rating_source`) e **fornecedor tecnico** (`provider_api`), alem do estado de licenca
em `source_licenses`.

## O que faz
- Coleta notas de fontes editoriais distintas (IMDb, Rotten Tomatoes, Metacritic,
  Letterboxd, FilmAffinity) via os **api-clients** apropriados.
- Preenche `external_ratings` com: `rating_source`, `rating_label`, `metric`,
  `rating_value`, `rating_scale`, `rating_count`, `rating_url`, `provider_api`,
  `provider_payload_hash`, `fetched_at`, `attribution_text`, `attribution_url`,
  `license_status`, `display_allowed`.
- Aplica a escala correta por fonte: **imdb=10, rotten_tomatoes=100, metacritic=100,
  letterboxd=5, filmaffinity=10**.
- Cruza cada rating com `source_licenses` para definir `display_allowed`,
  `score_allowed`, `requires_attribution`, `requires_linkback`.

## Como roda
- **Worker Python 3.12, sempre offline.** Agendado por **systemd timers**.
- **NUNCA e chamado no render publico.** A pagina le notas ja persistidas e atribuidas
  no PostgreSQL.

## Resiliencia obrigatoria
- **Cache** (`api_cache`), **retry** com **backoff**, **rate-limit** por fornecedor,
  **circuit-breaker** e **logs** completos em `api_sync_logs`.

## Invariantes aplicaveis (criticas)
- **IMDb != Rotten Tomatoes** — nunca misturar fontes, escalas, icones ou linguagem.
- **Nota IMDb (escala 10) NUNCA vira Tomatometer.** Tomatometer/Popcornmeter pertencem
  exclusivamente ao Rotten Tomatoes (escala 100).
- **provider_api != rating_source** — RapidAPI e similares sao apenas o canal tecnico,
  nunca a fonte editorial.
- **Nada de AggregateRating fingindo nota propria** — so se emite `AggregateRating`
  quando permitido e corretamente atribuido a fonte.
- **Sem licenca clara, nao exibe** — `license_status` em `unknown`/`blocked` ou
  `display_allowed=false` nunca aparece em pagina indexavel.
- **Atribuicao obrigatoria** quando a licenca exige (`requires_attribution`,
  `requires_linkback`).
- **Zero API externa no render** — toda coleta ocorre aqui, offline.
