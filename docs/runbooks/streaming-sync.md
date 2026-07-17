# Runbook — sync e promoção de streaming (onde assistir)

Operação do slice de streaming. **Worker-only, offline — nunca no render.**
País do MVP: **Brasil**. Fornecedor técnico: `streaming_availability` (RapidAPI).
Marca: Cinerie.

> Nenhuma oferta nasce exibível (`display_allowed = false`). Exibir exige provedor
> canônico mapeado + decisão de uso vigente + revisor humano — o trigger
> `watch_availability_display_guard` recusa qualquer atalho.

## Pré-requisitos

- `DATABASE_URL`.
- Para o sync real: `RAPIDAPI_STREAMING_AVAILABILITY_KEY`. Promoção/revisão são
  só banco.

## Fluxo

### 1. Sync (ingestão de ofertas)

```
node --import tsx services/streaming/bin/sync-streaming-availability.ts --kind=movie --country=BR --limit=20 --sample
# depois:
node --import tsx services/streaming/bin/sync-streaming-availability.ts --kind=movie --country=BR --limit=20 --apply
```

Reconciliação por **identidade estável** (`watch_offer_identity_key_v1`): ofertas
distintas nunca colapsam; duplicatas verdadeiras sim. Ofertas que sumiram do
snapshot são **revogadas + marcadas stale**, nunca apagadas (histórico
preservado). O sync resolve `watch_provider_id` pelo **alias** — sem alias, a
oferta é ingerida e auditável, mas não exibível.

### 2. Mapear o provedor canônico (pré-requisito de exibição)

Uma oferta só pode ser exibida se o par `(provider_api, provider_key)` do upstream
tiver um alias apontando para um `watch_providers`. Sem isso, `watch_provider_id`
fica `NULL` e a promoção recusa.

Cadastro (decisão humana): inserir a linha canônica em `watch_providers` (slug
minúsculo, homepage HTTPS) e o alias em `watch_provider_aliases`
(`provider_api = streaming_availability`, `external_key = <provider_key upstream>`).

### 3. Revisão

```
node --import tsx services/streaming/bin/review-watch-availability.ts --kind=movie --country=BR --limit=50 --json
```

Read-only. Lista candidatas e o veredito dos guardrails.

### 4. Promoção

```
# dry-run (default)
node --import tsx services/streaming/bin/promote-watch-availability.ts --ids=1,2,3
# executa:
node --import tsx services/streaming/bin/promote-watch-availability.ts --ids=1,2,3 --confirm --reviewer=ana@cinerie
```

Pré-condição: alias mapeado **e** `DataUsageDecision` vigente de
`watch_offer_display` cuja licença tenha `source_key = slug` do provedor e cujo
território cubra BR. A promoção grava o fingerprint + a decisão + o revisor no
UPDATE; o trigger valida tudo.

### 5. Revogação

```
node --import tsx services/streaming/bin/promote-watch-availability.ts --ids=1 --revoke --confirm
```

## Exibição pública

O painel "Disponibilidade no Brasil"
([`apps/web/app/_components/watch-availability-panel.tsx`](../../apps/web/app/_components/watch-availability-panel.tsx))
lê via [`entity-watch.ts`](../../apps/web/src/server/entity-watch.ts), que filtra
`display_allowed = true`, BR, `streaming_availability` e validade. Sem oferta
permitida, o painel é omitido. Zero chamada externa no render (invariante 3).

## Diagnóstico

- Oferta não sobe e o motivo é provedor: falta o alias
  (`watch_provider_aliases`) — ver [streaming-platform](../backend/streaming-platform.md).
- Sync abortou com exceção de `display guard`: uma oferta exibível teve payload
  mudado de forma que o hash não bate mais — investigar a reconciliação (o bug do
  `web_url` já foi corrigido; ver a doc de plataforma).
- Link recusado: só HTTPS legal entra; nunca torrent/IPTV/player pirata
  (invariante 8).
