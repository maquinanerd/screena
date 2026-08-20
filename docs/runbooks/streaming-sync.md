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

#### As duas travas contra alias inventado (2026-08-19)

"Não se inventa" deixou de ser prosa e virou duas checagens **independentes**:

1. **Evidência declarada.** Todo alias carrega `evidence`, de um conjunto
   fechado (`ALIAS_EVIDENCE_SOURCES`): `rapidapi-fixture`,
   `tmdb-harvest-2026-08-13` ou `br-offer-census-2026-08-19`. Valor ausente ou
   fora do conjunto derruba `validateProviderRegistry` → `plan.ok = false` →
   nada é escrito. Roda na CI, sem banco.
2. **Evidência medida.** Antes de aplicar, o comando lê os pares
   `(provider_api, provider_key)` **realmente presentes** em
   `watch_availability` e confronta com os aliases a CRIAR:
   - chave que o corpus **nunca publicou** → **RECUSA** (`plan` inválido). É a
     única trava que pega um id digitado errado (`1852` em vez de `1853`): esse
     passa pela trava 1 e creditaria outra plataforma;
   - chave presente **sob outro nome** → **AVISO**, não recusa. O TMDB renomeia
     provedor sem trocar o `provider_id`, e o nome é auditoria, nunca
     identidade. Se a divergência for real (o id virou outra plataforma),
     corrija o registro antes de aplicar.

A saída lista, por alias novo, quantas ofertas o banco já tem para aquele par —
é a confirmação de que o cadastro tem para quem servir.

**Depois do registro, rode `pnpm legal sources apply ... --confirm`** — é ele
que gera a licença `watch_availability` + a decisão `watch_offer_display` por
provedor registrado. Sem esse passo, oferta continua sem display.

### 2b. Reprocessar o `watch/providers` já arquivado (origem `tmdb`)

Materializa ofertas a partir do **depósito do bruto**. **Não faz uma única
chamada ao TMDB e não gasta cota.**

#### Onde o bruto mora, e quem o escreve (leia antes de rodar)

Duas coisas que já custaram um ciclo inteiro de produção:

1. **`catalog sync` NÃO alimenta este comando.** Ele usa o `append_to_response`
   mínimo (`'external_ids,credits'`, `services/ingestion/src/import/import-movie.ts`),
   grava em `api_cache` + tabelas tipadas e **nunca escreve no depósito do
   bruto**. Rodar `catalog sync --ids-file ... --force` para "preencher o bruto"
   de um título não preenche nada — e o comando responde `sync: N ok`, porque do
   ponto de vista dele deu certo.
   Quem arquiva o bruto é **`bin/sync-tmdb-raw.ts`**, que consome a fila NDJSON
   da descoberta e usa o append rico
   (`api-clients/tmdb/src/append-to-response.ts`, onde `watch/providers` está).
   Ele é um **piloto com teto padrão de 100 por tipo**
   (`DEFAULT_PILOT_LIMITS`, `src/raw-sync/queue.ts`) — é daí que vem um
   `tmdb_raw` parado em exatamente 100/100/100.

2. **O depósito é endereçável por `TMDB_RAW_STORE_DRIVER`**: `postgres`
   (`tmdb_raw`; recusado em produção) ou `r2` (objetos num bucket). O
   reprocessamento agora **lê pelo mesmo config que decide a escrita**. Até
   2026-08-19 ele lia `prisma.tmdbRaw` literalmente: com o driver em `r2` isso o
   deixava cego, sem erro nenhum, e o relatório afirmava cobertura total sobre um
   universo que ele não enxergava.

#### Cobertura: o denominador é o CATÁLOGO

O universo do reprocessamento são `movies`/`tv_shows`, e o bruto é buscado por
identidade (`tmdb/{tipo}/{id}.json`). Consequências práticas:

- entidade do catálogo **sem bruto** é o desfecho nomeado `sem bruto`
  (`missingRaw`) — antes ela simplesmente não voltava na consulta e não podia
  ser contada;
- a linha `cobertura N/M do catalogo` só diz **`(corpus INTEIRO)`** quando as
  duas lacunas são zero (nada cortado pelo `--limit`, nada faltando no
  depósito). Qualquer lacuna vira `(INCOMPLETA: ...)` **e exit code 4** — para
  que "falhas 0" nunca seja lido como "nada a fazer";
- no driver `r2` cada id é um GET. Use `--read-concurrency=N` (default 8).

```
# forma do dado real + cobertura contra o catálogo
pnpm --filter @screena/ingestion reprocess-watch-providers --sample --kind=movie

# COLHEITA: lista os provider_id REAIS vistos no dado (insumo dos aliases)
pnpm --filter @screena/ingestion reprocess-watch-providers --kind=movie --limit=500

# grava (as linhas nascem display_allowed=false)
pnpm --filter @screena/ingestion reprocess-watch-providers --kind=movie --apply

# em produção: acrescente --confirm-production a qualquer um deles
```

A colheita imprime a lista **inteira** de provedores vistos, com a quebra por
**modalidade** (`subscription`/`rent`/`buy`/`free`/`ads`) e em quantos países
cada um apareceu. Essa quebra é o que distingue serviço por assinatura de loja
de compra avulsa — o TMDB registra a mesma marca sob ids diferentes conforme o
papel comercial (`9`/`119` "Amazon Prime Video" vs `10` "Amazon Video"), e
decidir o alias pelo nome é adivinhação. Se você passar `--print-limit=N`, ela
diz quantos ficaram de fora — truncar em silêncio é como alguém acaba
inventando um alias.

#### Escopo territorial (`--countries`)

O payload real traz **138 países** por título, e `watch_availability.country_code`
é FK para `countries.code` — um dicionário com 13 códigos. Em 2026-08-13 o
reprocessamento gravava tudo e falhou em **100 de 100 títulos** com `23503` /
`watch_availability_country_code_fkey`.

O comando agora ingere apenas territórios **declarados**. Default: `BR`, o único
que o render lê (`apps/web/src/server/entity-watch.ts`). Todo país descartado
por escopo aparece no relatório com a contagem de ofertas — descarte por escopo
é decisão, não silêncio.

```
# ingere BR (default)
pnpm --filter @screena/ingestion reprocess-watch-providers --kind=movie --apply

# amplia o escopo (exige que os códigos existam em `countries`)
pnpm --filter @screena/ingestion reprocess-watch-providers --kind=movie --countries=BR,US,PT --apply
```

Um território fora de `countries` é recusado no **preflight**, antes do primeiro
INSERT, com o código nomeado — em vez de virar `23503` no meio do lote com
snapshot já parcialmente gravado. **A FK não deve ser afrouxada**: ela é o que
impede código de país inventado. Ampliar o conjunto de países válidos é uma
decisão de dados (inserir em `countries`, com revisão humana), nunca remover a
verificação.

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

### O painel agrupa pela MARCA (2026-08-19)

Com 24 provedores novos, o mesmo título passou a listar "HBO Max" e "HBO Max
Amazon Channel" lado a lado, e três linhas de Paramount+. Decisão do dono
(opção A): o leitor vê **"Paramount+" uma vez**, com as rotas clicáveis embaixo
— `direto`, `plano Premium`, `canal no Prime Video`, `canal no Apple TV`.

Três limites que nenhum ajuste visual pode afrouxar:

1. **Nenhuma oferta some.** Toda rota é um `<a>` com o próprio destino, preço e
   qualidade. Agrupar é apresentação.
2. **Nenhuma linha mente.** O rótulo nomeia o hospedeiro (`canal no Prime
   Video`) porque assinar o canal exige assinar o Prime **também**. Esconder
   isso atrás do nome da marca omitiria um custo.
3. **Agrupar é opt-in.** Provedor sem `brand` declarada aparece sozinho, como
   sempre apareceu. Não existe ramo que adivinhe a marca a partir do nome.

**Os três campos são DECLARADOS**, em
[`packages/public-contracts/src/watch-brand.ts`](../../packages/public-contracts/src/watch-brand.ts):
`brand`, `variant`, `soldVia`. Nunca derivados da string do nome — o nome vem
verbatim do payload de terceiro e muda quando a TMDB quiser. Uma derivação por
prefixo fundiria "Claro video" (loja) com "Claro tv+" (streaming da operadora) e
"Amazon Video" (compra) com "Amazon Prime Video" (assinatura), e ainda assim
**separaria** "MGM Plus Amazon Channel" de "MGM+ Apple TV Channel", que são a
mesma marca. Nenhuma regra sobre a string acerta os dois casos.

A decomposição não pôde morar no registro de provedores porque aquele arquivo
pertence a um **worker**, e o render não depende de worker (invariante 3). Os
dois lados são amarrados por
[`tests/governance/watch-brand-registry-sync.test.ts`](../../tests/governance/watch-brand-registry-sync.test.ts),
que reprova se um slug existir num e não no outro — duas listas são uma só
quando não podem divergir.


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

### Por que uma oferta continua apagada — motivo por motivo

Rode a revisão (`review-watch-availability --report` ou `--json`) e leia a coluna
`decisao`. O relatório traz **contagem por motivo**, e a coluna `slug canonico`
diz se o elo do provedor foi resolvido. Cada motivo tem uma ação diferente:

| motivo | o que significa | ação |
| --- | --- | --- |
| `wrong-provider` | fornecedor técnico fora do conjunto governado | nenhuma: dado não governado nunca é promovido |
| `wrong-country` | a oferta não é do Brasil | nenhuma: **só BR acende** (ver "Territorialidade") |
| `already-display-allowed` | já está exibível | nada a fazer |
| `withheld-by-decision` | a origem passaria em tudo, e há decisão humana registrada retendo-a | **nenhuma.** Ver "Origens retidas" abaixo. Reverter é remover a linha de `WITHHELD_OFFER_SOURCES` numa PR — nunca promover por id |
| `invalid-offer-type` | modalidade fora de `subscription/free/ads/rent/buy` | `cinema` nunca entra (não é disponibilidade doméstica). `ads` **entrou em 2026-08-19** por decisão do dono |
| `missing-provider` | linha sem `provider_key`/`provider_name` | dado do upstream incompleto; nada a promover |
| `no-canonical-provider` | `(provider_api, provider_key)` sem alias | acrescente a chave a `WATCH_PROVIDER_REGISTRY` **com evidência**, rode `register-watch-providers --apply` e depois `legal sources apply` |
| `missing-link` | sem `deep_link` **e** sem `web_url` | o país não trouxe `link` no payload; ressincronize |
| `unsafe-link` | destino não-http(s) ou marcador de pirataria | nunca promover (invariante 8) |
| `missing-attribution` | crédito/linkback não hidratados na linha | falta `legal sources apply` para **aquela origem**, ou ressync que re-hidrate |
| `expired` | `available_until` no passado | oferta acabou |

### Origens retidas por decisão (`withheld-by-decision`)

Algumas ofertas passam em **todos** os guardrails e mesmo assim não devem
acender. Elas estão declaradas em `WITHHELD_OFFER_SOURCES`
(`services/streaming/src/promotion/guardrails.ts`), com data, autor e motivo — e
a revisão as recusa com `withheld-by-decision`.

**Hoje são as 5 ofertas BR que chegam pela RapidAPI** (`prime`, `apple`, `hbo`).
Motivo, decidido por Pablo Eduardo em 2026-08-19: são as **mesmas plataformas
que já acendem pela TMDB**. Promovê-las duplicaria a linha do leitor — "Prime
Video" apareceria duas vezes na mesma página, com créditos de origem diferentes
("Movie of the Night" e "JustWatch"), o que faria a página parecer afirmar duas
disponibilidades independentes onde há uma.

Por que isso virou dado e não ficou só no relatório: até esta leva, o
vocabulário não tinha como dizer *"elegível e deliberadamente não promovido"*.
As cinco apareciam como **ELEGÍVEL**, e a única coisa que as mantinha apagadas
era ninguém ter rodado `promote --ids` com elas. Ausência de ação não é
registro — bastava uma revisão de rotina daqui a três meses.

Onde a decisão aparece, sem depender de sorte:

- no **console** de `review-watch-availability`, sempre que alguma candidata
  bater nesse motivo (com o texto inteiro do porquê);
- no **relatório** `--report`, numa seção própria, **mesmo quando nenhuma
  candidata do filtro está retida** — quem lê precisa achar a decisão sem ter
  tido a sorte de a oferta cair no recorte daquele dia.

**Reverter é remover a linha de `WITHHELD_OFFER_SOURCES` numa PR** — nunca
promover por id. Promover por id contorna o registro e não deixa rastro.

`hbo` está na lista por completude, embora hoje pare antes, em
`no-canonical-provider`: não existe alias `streaming_availability:hbo` (a chave
da RapidAPI para essa marca é `max`). Se o alias for criado um dia, a decisão já
está escrita e não vira promoção acidental.

### `ads` é promovível desde 2026-08-19

O site **exibe oferta grátis com anúncio** (decisão de Pablo Eduardo). Pluto TV,
Mercado Play e NetMovies tinham o título de graça e ficavam de fora.

`free` e `ads` **não são a mesma coisa** e nunca colapsam num rótulo só: a tela
escreve "Grátis" e "Grátis com anúncios", e são grupos separados no painel, na
ordem canônica (`free` antes de `ads`). `cinema` continua fora — não é
disponibilidade doméstica.

### Territorialidade: só BR acende, e há quatro barreiras

1. `evaluatePromotionEligibility` recusa com `wrong-country`;
2. `listCandidates` filtra `country_code` no banco;
3. o `UPDATE` de `promote()` reafirma `AND country_code = 'BR'`;
4. o trigger `watch_availability_display_guard` recusa decisão cujo `territory`
   não cobre o país da oferta — **é a única que sobrevive a SQL bruto**.

Provado por `services/streaming/src/__tests__/promotion-territory.test.ts` (1–3,
na CI) e por `scripts/validate-stores-real-postgres.ts`, checks 17–19 (4, com
Postgres real; o 19 é o controle positivo — o mesmo SQL acende a oferta BR).

O **único** caminho que abriria essa porta seria uma decisão
`watch_offer_display` com `territory = NULL` (global): o trigger a aceitaria
para qualquer país. Nada no repositório emite uma, e
`tests/governance/watch-territory-br-only.test.ts` trava isso na origem.

- Oferta não sobe e o motivo é provedor: falta o alias
  (`watch_provider_aliases`) — ver [streaming-platform](../backend/streaming-platform.md).
- Sync abortou com exceção de `display guard`: uma oferta exibível teve payload
  mudado de forma que o hash não bate mais — investigar a reconciliação (o bug do
  `web_url` já foi corrigido; ver a doc de plataforma).
- Link recusado: só HTTPS legal entra; nunca torrent/IPTV/player pirata
  (invariante 8).
- `23503` / `watch_availability_country_code_fkey`: o território pedido não está
  em `countries`. Hoje o preflight recusa antes de escrever, nomeando o código —
  ver "Escopo territorial" no passo 2b. Não afrouxe a FK.
- `aplicados 0` mas o relatório fala em ofertas gravadas: procure a linha
  `ATENCAO: +N oferta(s) ficaram GRAVADAS por entidades que falharam depois`.
  `replaceSnapshot` é uma transação **por país**; com mais de um território no
  escopo, os países anteriores ao erro ficam commitados e a revogação dos
  restantes não roda. Esses títulos estão com snapshot incompleto — rode de novo
  depois de corrigir a causa.
- Oferta antiga de origem `streaming_availability` presa em
  `missing-attribution`: o reprocessamento do `tmdb` **não** a alcança (todo
  `WHERE` dele é escopado em `provider_api='tmdb'`). Quem re-hidrata o crédito
  dela é o passo 1 (`sync-streaming-availability --apply`), que grava
  licença/atribuição/decisão pelo `watch-store`. Isso consome cota da RapidAPI;
  nenhuma linha precisa ser apagada.
