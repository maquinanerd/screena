# api-clients/kaso

Cliente **Kaso** de disponibilidade de streaming. E **apenas fallback**: usado somente
quando `streaming_availability` nao resolve uma entidade/pais.

## Papel
- Fonte tecnica secundaria consumida por `services/streaming` para complementar
  `watch_availability` em casos nao cobertos pelo cliente primario.

## Worker-only
- **Somente workers offline (Python 3.12)**, agendados por systemd timers.
- **NUNCA chamado no render publico.**

## Requisitos tecnicos obrigatorios
- **cache**, **retry**, **rate-limit**, **backoff**, **circuit-breaker** e **logs** em
  `api_sync_logs`.
- **API key so em env var.**

## Atribuicao / licenca
- Fornecedor tecnico (`provider_api`), nunca fonte editorial.
- Apenas plataformas legais e links oficiais; respeitar `source_licenses`.

## Invariantes aplicaveis
- **Apenas fallback** — NAO usar no MVP se `streaming_availability` ja resolver.
- **Sem pirataria** — somente ofertas legais; nada de torrent, IPTV, player ilegal, link
  de download ou embed pirata.
- **provider_api != rating_source.**
- **Sem licenca clara, nao exibe.**
- **Zero API externa no render.**
