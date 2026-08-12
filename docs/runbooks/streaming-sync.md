# Runbook — sync e promoção de streaming (onde assistir)

Operação do slice de streaming. **Worker-only, offline — nunca no render.**
País do MVP: **Brasil**. Marca: Cinerie.

**Duas origens de oferta, com créditos DIFERENTES — nunca as misture:**

| Origem (`provider_api`) | De onde vem | Destino da oferta | Crédito obrigatório |
| --- | --- | --- | --- |
| `streaming_availability` | Streaming Availability API (Movie of the Night, via RapidAPI). Consome cota. | `deep_link` **por oferta** (leva ao serviço) | Movie of the Night |
| `tmdb` | bloco `watch/providers` já arquivado em `tmdb_raw`. **Zero rede, zero cota.** | `web_url` — o `link` **por país** (leva ao agregador) | **JustWatch** |

O TMDB **revende** dado do JustWatch, e seus termos exigem creditar o JustWatch
nominalmente, sob pena de **revogação do acesso à API** — a mesma API que sustenta
fichas, elenco e imagens do catálogo inteiro. Cada origem tem sua própria licença
em `source_licenses` (mesma `source_key`, `provider_key` diferente); creditar uma
com o texto da outra é proveniência falsa, não detalhe de copy.

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

> ### ⚠️ NUNCA use `--` para separar argumentos
>
> Com o pnpm **9.15.4** deste repo, `--` **não é consumido**: ele chega ao script
> como argumento literal. Medido nos dois níveis de encaminhamento:
>
> | Comando | `process.argv.slice(2)` |
> | --- | --- |
> | `pnpm --filter p s --apply` | `["--apply"]` ✅ |
> | `pnpm --filter p s -- --apply` | `["--","--apply"]` ❌ |
> | `pnpm <script-raiz> sources apply --confirm` | `["sources","apply","--confirm"]` ✅ |
> | `pnpm <script-raiz> sources apply -- --confirm` | `["sources","apply","--","--confirm"]` ❌ |
>
> Isso já custou duas rodadas de produção — e este runbook era uma das fontes do
> erro. Passe as flags direto, sempre. Travado por
> [`tests/governance/no-double-dash-in-docs.test.ts`](../../tests/governance/no-double-dash-in-docs.test.ts).

### 2. Mapear o provedor canônico (pré-requisito de exibição)

Uma oferta só pode ser exibida se o par `(provider_api, provider_key)` do upstream
tiver um alias apontando para um `watch_providers`. Sem isso, `watch_provider_id`
fica `NULL` e a promoção recusa.

Cadastro **versionado e idempotente** (nunca script solto):

```
pnpm --filter @screena/streaming register-watch-providers            # dry-run
pnpm --filter @screena/streaming register-watch-providers --apply
# em produção: --apply --confirm-production
```

O dado canônico vive em `services/streaming/src/provider-registry.ts` (slug +
nome + aliases dos DOIS fornecedores: `streaming_availability` por `service.id`,
`tmdb` por `String(provider_id)`). Regras do comando: nunca apaga, nunca
retargeteia alias de outro provedor (conflito aborta, alto), alias do banco
desconhecido do registro é reportado e intocado. Alias **não se inventa**: para
descobrir chaves que faltam, rode a colheita
`services/ingestion/bin/reprocess-watch-providers.ts` (lista os provedores TMDB
VISTOS no dado real) e estenda o registro numa PR.

**Depois do registro, rode `pnpm legal sources apply ... --confirm`** — é ele
que gera a licença `watch_availability` + a decisão `watch_offer_display` por
provedor registrado. Sem esse passo, oferta continua sem display.

### 2b. Reprocessar o `watch/providers` já arquivado (origem `tmdb`)

Materializa ofertas a partir de `tmdb_raw`. **Não faz uma única chamada de rede e
não gasta cota** — o bloco já foi baixado a cada sync de detalhe.

```
# forma do dado real (quantas linhas NÃO têm o bloco arquivado)
pnpm --filter @screena/ingestion reprocess-watch-providers --sample --kind=movie

# COLHEITA: lista os provider_id REAIS vistos no dado (insumo dos aliases)
pnpm --filter @screena/ingestion reprocess-watch-providers --kind=movie --limit=500

# grava (as linhas nascem display_allowed=false)
pnpm --filter @screena/ingestion reprocess-watch-providers --kind=movie --apply

# em produção: acrescente --confirm-production a qualquer um deles
```

A colheita imprime a lista **inteira** de provedores vistos. Se você passar
`--print-limit=N`, ela diz quantos ficaram de fora — truncar em silêncio é como
alguém acaba inventando um alias.

O reprocessamento hidrata o **crédito** (licença + atribuição + decisão de uso)
junto com a oferta, derivado da licença vigente daquela origem. Ele **nunca**
liga `display_allowed`: acender continua sendo o passo 4.

### 3. Revisão

```
pnpm --filter @screena/streaming review-watch-availability --kind=movie --country=BR --limit=50 --json
```

Read-only. Lista candidatas das **duas** origens governadas e o veredito dos
guardrails. Motivos de recusa incluem `missing-attribution` (a origem daquela
oferta ainda não tem licença/decisão — rode o passo 2 do `legal`).

### 4. Promoção

```
# dry-run (default)
pnpm --filter @screena/streaming promote-watch-availability --ids=1,2,3
# executa:
pnpm --filter @screena/streaming promote-watch-availability --ids=1,2,3 --confirm --reviewer=ana@cinerie
```

Recusa do banco NÃO é silenciosa: o comando imprime o id e a causa, e **sai com
erro**. `missing-attribution` significa que a origem daquela oferta ainda não tem
licença — volte ao passo 2.

Pré-condição: alias mapeado **e** `DataUsageDecision` vigente de
`watch_offer_display` cuja licença tenha `source_key = slug` do provedor e cujo
território cubra BR. A promoção grava o fingerprint + a decisão + o revisor no
UPDATE; o trigger valida tudo.

### 5. Revogação

```
pnpm --filter @screena/streaming promote-watch-availability --ids=1 --revoke --confirm
```

## Exibição pública

O painel "Disponibilidade no Brasil"
([`apps/web/app/_components/watch-availability-panel.tsx`](../../apps/web/app/_components/watch-availability-panel.tsx))
lê via [`entity-watch.ts`](../../apps/web/src/server/entity-watch.ts), que filtra
`display_allowed = true`, BR e validade — **não** por fornecedor técnico. Quem
autoriza exibir é a cadeia de licença (decisão vigente + licença-mãe vigente e
exibível), nunca o nome de quem transportou o dado.

**Precedência entre origens:** para a mesma plataforma canônica e a mesma
modalidade, a oferta com destino **no provedor** (`deep_link`) vence a com destino
**no agregador** (`web_url`) — o deep link leva ao título no serviço; a página do
agregador leva a mais uma escolha. Variantes reais (aluguel HD vs 4K) não são
colapsadas. A oferta carrega `destinationKind` para que o painel não prometa
"abrir na Netflix" num link que vai para o agregador.

Sem oferta permitida, o painel é omitido. Zero chamada externa no render
(invariante 3).

## Diagnóstico

- Oferta não sobe e o motivo é provedor: falta o alias
  (`watch_provider_aliases`) — ver [streaming-platform](../backend/streaming-platform.md).
- Sync abortou com exceção de `display guard`: uma oferta exibível teve payload
  mudado de forma que o hash não bate mais — investigar a reconciliação (o bug do
  `web_url` já foi corrigido; ver a doc de plataforma).
- Link recusado: só HTTPS legal entra; nunca torrent/IPTV/player pirata
  (invariante 8).
