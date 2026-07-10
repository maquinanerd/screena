# api-clients/streaming_availability

Cliente **primario** de disponibilidade de streaming. Fornece, por pais, em quais
plataformas legais e modalidades (assinatura, aluguel, compra, gratis com anuncios) uma
entidade esta disponivel.

## Papel
- Fonte tecnica consumida por `services/streaming` para popular `watch_availability`,
  `platforms` e `providers`.
- Base do bloco de valor "onde assistir por pais".

## Estado atual
- Implementado em **TypeScript/Node** (`@screena/streaming-availability-client`), offline.
  Python 3.12 segue como roadmap/shim, nao como implementacao atual (CLAUDE.md secao 4).
- Consumido por [`services/streaming`](../../services/streaming).

## Endpoint
- `GET /shows/{id}?country=BR`

`id` aceita IMDb (`tt0111161`) ou TMDB (`movie/278`, `tv/1396`). Base URL:
`https://streaming-availability.p.rapidapi.com` · host:
`streaming-availability.p.rapidapi.com`. Docs: <https://docs.movieofthenight.com/guide/shows>.

`streamingOptions` vem indexado por pais; cada oferta tem `type` em
`free|subscription|buy|rent|addon`. **`addon` nao tem equivalente no enum `OfferType`**
e e **descartado** (contado como `unmapped-offer-type`), nunca coagido a `subscription`
— seria afirmar uma modalidade comercial falsa ao usuario.

## Worker-only
- **Somente workers offline.** Agendamento por systemd timers e roadmap.
- **NUNCA chamado no render publico.**

## Requisitos tecnicos obrigatorios
- **cache**, **retry**, **rate-limit**, **backoff**, **circuit-breaker** e **logs** em
  `api_sync_logs` — todos vindos de [`api-clients/rapidapi-core`](../rapidapi-core).
- **API key so em env var**: `RAPIDAPI_STREAMING_AVAILABILITY_KEY`. A chave viaja **so em
  header** (`x-rapidapi-key`), nunca em URL, log, erro, sample ou relatorio.

## Variaveis de ambiente
| Variavel | Obrigatoria | Default |
| --- | --- | --- |
| `RAPIDAPI_STREAMING_AVAILABILITY_KEY` | sim | — (falha explicita) |
| `RAPIDAPI_STREAMING_AVAILABILITY_HOST` | nao | `streaming-availability.p.rapidapi.com` |
| `RAPIDAPI_STREAMING_AVAILABILITY_BASE_URL` | nao | `https://streaming-availability.p.rapidapi.com` |
| `RAPIDAPI_STREAMING_AVAILABILITY_CACHE_TTL_MS` | nao | `86400000` (24h, atualizacao diaria) |

## Atribuicao / licenca
- Fornecedor tecnico (`provider_api`), nunca fonte editorial.
- Apenas plataformas legais e links oficiais; respeitar `source_licenses` quando aplicavel.
- Os **termos exigem atribuicao visivel** ("Streaming Availability API by Movie of the
  Night" + link para <https://www.movieofthenight.com/about/api>) sempre que o dado for
  exibido. Enquanto essa atribuicao nao existir na UI, toda linha nasce
  `display_allowed = false` e **nada aparece publicamente**.

## Invariantes aplicaveis
- **Cliente primario de disponibilidade** — preferencial sobre `kaso`.
- **Sem pirataria** — nada de torrent, IPTV, player ilegal, link de download ou embed
  pirata; somente ofertas legais.
- **provider_api != rating_source.**
- **Sem licenca clara, nao exibe.**
- **Zero API externa no render.**
