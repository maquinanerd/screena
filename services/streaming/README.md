# services/streaming

Servico de **disponibilidade de streaming** (onde assistir). Mantem `watch_availability`,
`platforms` e `providers`, mapeando em quais plataformas, paises e modalidades (assinatura,
aluguel, compra, gratis com anuncios) cada entidade esta disponivel.

## O que faz
- Consulta os **api-clients** de disponibilidade (`streaming_availability` como primario;
  `kaso` apenas como fallback) para obter ofertas por pais.
- Normaliza plataformas e fornecedores em `platforms`/`providers` e grava cada oferta em
  `watch_availability` (entidade, plataforma, pais, modalidade, link oficial, atualizado em).
- Mantem a oferta por **pais**, base do bloco de valor "onde assistir por pais".

## Como roda
- **Worker Python 3.12, sempre offline.** Agendado por **systemd timers**.
- **NUNCA e chamado no render publico.** A pagina `/pt/.../onde-assistir/` le apenas o que
  foi persistido no PostgreSQL.

## Resiliencia obrigatoria
- **Cache** (`api_cache`), **retry** com **backoff**, **rate-limit**, **circuit-breaker**
  e **logs** de sync em `api_sync_logs`.

## Invariantes aplicaveis
- **Sem pirataria** — somente plataformas legais e links oficiais. Nada de torrent, IPTV,
  player ilegal, link de download ou embed pirata.
- **Zero API externa no render** — disponibilidade vem do banco, nunca de chamada ao vivo.
- **kaso e apenas fallback** — nao usar no MVP se `streaming_availability` ja resolver.
- **Dados sem licenca clara nao aparecem** em pagina indexavel.
- **provider_api != rating_source** — disponibilidade nao se confunde com nota editorial.
- **API keys so em env vars.**
