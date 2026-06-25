# api-clients/imdb

Cliente para dados de **IMDb**. O IMDb e uma **fonte editorial** (`rating_source = imdb`)
cuja nota usa **escala 10**.

## Papel
- Fornece a nota e contagem de votos do IMDb para `services/ratings`, gravadas em
  `external_ratings` com `rating_source = imdb`, `rating_scale = 10`.
- Pode fornecer `imdb_id` de referencia para mapeamento em `entity_external_ids`.

## Worker-only
- **Somente workers offline (Python 3.12)**, agendados por systemd timers.
- **NUNCA chamado no render publico.**

## Requisitos tecnicos obrigatorios
- **cache**, **retry**, **rate-limit**, **backoff**, **circuit-breaker** e **logs** em
  `api_sync_logs`.
- **API key / acesso so em env var.**

## Atribuicao / licenca
- Exibicao condicionada a `source_licenses` do IMDb (`display_allowed`, `score_allowed`,
  `requires_attribution`, `requires_linkback`).
- O **fornecedor tecnico** que entrega o dado (`provider_api`) e distinto da fonte
  editorial IMDb (`rating_source`).

## Invariantes aplicaveis (criticas)
- **IMDb usa escala 10 e a nota IMDb NUNCA vira Tomatometer.**
- **IMDb != Rotten Tomatoes** — fontes, escalas, icones e linguagem separados.
- **provider_api != rating_source.**
- **Sem licenca clara, nao exibe.**
- **Zero API externa no render.**
