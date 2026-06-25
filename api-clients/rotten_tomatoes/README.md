# api-clients/rotten_tomatoes

Cliente para dados de **Rotten Tomatoes**. E uma **fonte editorial**
(`rating_source = rotten_tomatoes`) e a unica dona do **Tomatometer** (critica) e do
**Popcornmeter** (audiencia), ambos em **escala 100**.

## Papel
- Fornece Tomatometer e Popcornmeter para `services/ratings`, gravados em
  `external_ratings` com `rating_source = rotten_tomatoes`, `rating_scale = 100`,
  `rating_label`/`metric` corretos (critica vs audiencia).
- Base do bloco de valor "comparacao critica vs audiencia".

## Worker-only
- **Somente workers offline (Python 3.12)**, agendados por systemd timers.
- **NUNCA chamado no render publico.**

## Requisitos tecnicos obrigatorios
- **cache**, **retry**, **rate-limit**, **backoff**, **circuit-breaker** e **logs** em
  `api_sync_logs`.
- **API key so em env var.**

## Atribuicao / licenca
- Exibicao condicionada a `source_licenses` do Rotten Tomatoes (`display_allowed`,
  `score_allowed`, `logo_allowed`, `requires_attribution`, `requires_linkback`).
- `provider_api` (fornecedor tecnico) e sempre distinto de `rating_source`.

## Invariantes aplicaveis (criticas)
- **Tomatometer/Popcornmeter pertencem SO ao Rotten Tomatoes** (escala 100).
- **IMDb != Rotten Tomatoes** — nunca misturar; **nota IMDb (10) nunca vira Tomatometer**.
- **Nada de AggregateRating fingindo nota propria.**
- **provider_api != rating_source.**
- **Sem licenca clara, nao exibe.**
- **Zero API externa no render.**
