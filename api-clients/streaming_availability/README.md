# api-clients/streaming_availability

Cliente **primario** de disponibilidade de streaming. Fornece, por pais, em quais
plataformas legais e modalidades (assinatura, aluguel, compra, gratis com anuncios) uma
entidade esta disponivel.

## Papel
- Fonte tecnica consumida por `services/streaming` para popular `watch_availability`,
  `platforms` e `providers`.
- Base do bloco de valor "onde assistir por pais".

## Worker-only
- **Somente workers offline (Python 3.12)**, agendados por systemd timers.
- **NUNCA chamado no render publico.**

## Requisitos tecnicos obrigatorios
- **cache**, **retry**, **rate-limit**, **backoff**, **circuit-breaker** e **logs** em
  `api_sync_logs`.
- **API key so em env var.**

## Atribuicao / licenca
- Fornecedor tecnico (`provider_api`), nunca fonte editorial.
- Apenas plataformas legais e links oficiais; respeitar `source_licenses` quando aplicavel.

## Invariantes aplicaveis
- **Cliente primario de disponibilidade** — preferencial sobre `kaso`.
- **Sem pirataria** — nada de torrent, IPTV, player ilegal, link de download ou embed
  pirata; somente ofertas legais.
- **provider_api != rating_source.**
- **Sem licenca clara, nao exibe.**
- **Zero API externa no render.**
