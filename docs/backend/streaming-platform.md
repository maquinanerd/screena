# Plataforma de streaming (Backend B)

Governança de **onde assistir** — ofertas legais de streaming no Brasil, do byte
do fornecedor técnico (`streaming_availability` via RapidAPI) até o painel
"Disponibilidade no Brasil". Marca pública: **Cinerie** (`https://cinerie.com`).

Esta doc cobre o que o **Backend B acrescentou** ao slice de streaming que já
existia (PRs #57/#58/#59 + Fase 2). O núcleo — `watch_availability`, os
fingerprints `watch_offer_*_v1`, a reconciliação por identidade, a promoção
governada — permanece; o Backend B fecha dois buracos.

## Buraco 1: provedor era string crua

Antes, `watch_availability.provider_key`/`provider_name` vinham direto do
upstream. "Netflix", "netflix", "NetflixBR" e "Netflix Brasil" seriam quatro
plataformas diferentes na vitrine. `api_providers` **não** serve para isto
(invariante 2): ele descreve o fornecedor **técnico** da API, não a plataforma.

Solução — duas tabelas canônicas:

- **`watch_providers`**: identidade canônica (slug único, nome, logo, homepage).
  `slug` segue `^[a-z0-9]+(-[a-z0-9]+)*$`; `homepage_url` é HTTPS (CHECK).
- **`watch_provider_aliases`**: como cada fornecedor técnico chama esse provedor.
  Unique `(provider_api, external_key)` — impede dois provedores canônicos
  reivindicarem a mesma chave upstream. `provider_api` é FK real para
  `api_providers` (o alias pertence a um transporte, não a uma fonte editorial).

`watch_availability.watch_provider_id` liga a oferta ao provedor canônico. É
**nullable**: uma oferta sem alias mapeado continua sendo ingerida e auditada —
só não pode ser exibida.

### Resolução do provedor: por ALIAS, nunca por nome

O sync (`watch-store`) e a promoção (`watch-review-store`) resolvem
`watch_provider_id` **da tabela de aliases**, no próprio SQL, a partir de
`(provider_api, provider_key)`. **Não há fallback por nome exibido** — adivinhar
o provedor pelo `provider_name` é exatamente o erro que a tabela de aliases
existe para impedir. Sem alias, o campo fica `NULL` e o trigger recusa a
exibição.

## Buraco 2: exibir não checava provedor nem uso

O `watch_availability_display_guard` da Fase 2 já exigia hash + revisor +
licença + atribuição. O Backend B o torna **estritamente mais restritivo** (nunca
afrouxa) e acrescenta:

- **provedor canônico coerente**: `watch_provider_id` não-nulo **e** igual ao
  `provider_id` do alias `(provider_api, provider_key)` — reconferido a cada
  escrita. Remapear o alias e reescrever a oferta faz a exibição cair;
- **decisão de uso vigente**: `data_usage_decision_id` de uma decisão vigente de
  `watch_offer_display`, no estágio `approved_for_display`, cujo território cobre
  o país da oferta, e **cuja licença pertence àquele provedor** —
  `source_licenses.source_key = watch_providers.slug` para
  `content_type = 'watch_availability'`. Sem esse elo, uma decisão da Netflix
  autorizaria uma oferta da Max.

### Convenção `source_key = slug`

Para `content_type = 'watch_availability'`, o `source_licenses.source_key` **é**
o slug do `watch_providers`. É o que dá a uma licença de streaming uma chave
natural estável (já que `source_key` é texto livre) e o que o guard reconfere.

## Entregáveis do modelo de oferta

Uma oferta exibível carrega (contrato `PublicWatchOffer` em
[`@screena/public-contracts`](../../packages/public-contracts/src/external-intelligence.ts)):
provedor canônico, modalidade legal, preço/moeda (só em `rent`/`buy`, com CHECK),
qualidade, package, link/deeplink (HTTPS — magnet:/http:/ftp: não passam nem por
acidente), validade e atribuição. Nunca pirataria (invariante 8).

## Um bug corrigido no caminho

No `watch-store`, o cálculo de revogação de exibição durante o sync usava o
`web_url` **antigo** enquanto o `SET` gravava o novo. Consequência: mudar só o
`web_url` fazia o fingerprint bater com o hash aprovado, `display_allowed` ficava
`true`, e o trigger — que recomputa com os valores novos — **abortava o sync
inteiro com exceção** em vez de revogar aquela oferta. Corrigido para `EXCLUDED`
(valor novo); provado nos dois sentidos no `validate:stores` (reintroduzir o bug
faz o check 11 falhar com `threw=true`).

## Runbook

Ver [runbook de streaming-sync](../runbooks/streaming-sync.md).
