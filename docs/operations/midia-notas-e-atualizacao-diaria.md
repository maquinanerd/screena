# Mídia, notas e atualização diária — o que impede, e quanto custa

> Auditoria de 2026-08-28. **Documento de medição, não de conserto.** Nenhuma linha de
> comportamento foi alterada nesta leva. Números de produção vieram do censo do dono
> (mesma data); números de código foram medidos neste checkout, com arquivo e linha.
>
> A decisão do dono que este documento serve: *"Vídeos, notas, imagens, pôster, trailer,
> tudo é pra ter em todos os filmes, séries, episódios, temporadas e etc. Isso é pra ficar
> atualizado, diariamente."*

---

## 0. O resumo em sete linhas

1. **A varredura completa DIÁRIA do TMDB é impossível — e é a mídia que a torna
   impossível.** O TMDB não tem cota diária; o limite é ritmo (~40 req/s). Mas uma
   passagem completa pelo acervo inteiro custa **~13,66 milhões de requisições ≈ 4 dias a
   40 req/s** — só a mídia são **8,26 milhões**. Um dia não cabe em quatro dias: a
   varredura diária por força bruta **não é cara, é aritmeticamente impossível**. Logo, o
   gatilho (`/changes`) deixa de ser economia e passa a ser **a única forma**. O
   impedimento imediato continua sendo a chave de idempotência sem escopo, que torna
   `sync_media`/`sync_seasons`/`sync_episodes` *write-once* — agora com um segundo,
   estrutural, atrás dele.
   > **ERRATA (2026-08-31).** A versão que circulou desta linha dizia *"~874 mil
   > requisições ≈ 6 h/dia. Sobra dia"* e concluía *"não é custo"*. Estava errada por
   > **15,6×**. Ver §5.2.
2. **A OMDb não cabe, e não é por pouco.** Uma volta completa custa 70.537 requisições
   contra 850 utilizáveis por dia: **83 dias por volta**. Para a janela de 7 dias que a
   própria tabela de ritmos declara, seriam **10,1× a cota gratuita**.
3. **A OMDb parou por ritmo, não por cota.** A fila existe, está agendada e tem executor —
   mas a cadência é de **200 títulos a cada 7 dias**, não 850/dia. No ritmo atual, uma
   volta pelo catálogo leva **6,8 anos**.
4. **Os 95.701 vídeos bloqueados são assinatura, não defeito.** A licença-mãe existe desde
   13/08. O que falta é a promoção linha a linha, e o freio de 500/execução explica os
   2.395 acesos.
5. **Liberar licença de vídeo BASTA.** O apresentador **não filtra por idioma** — a
   premissa de que os vídeos `en` do Deadpool 2 seriam descartados está **refutada**.
6. **A nota calculada não aparece por dois motivos diferentes, em dois lugares
   diferentes.** Na ficha, é um portão de licença que se resolve com uma decisão no banco.
   Na listagem, o caminho está **estruturalmente morto** — e essa parte é conserto de
   código, não decisão do dono.
7. **O inventário do TMDB está completo e o registro está honesto.** As 4 entradas que
   mentiam foram corrigidas em 27/08. O que falta pedir ao TMDB são **dois endpoints de
   dicionário**, não appends.

---

## 1. Item 0 — O inventário do TMDB

### 1.1 O que pedimos (`append-to-response.ts`)

47 pares `(tipo, valor)`, distribuídos em 19 valores únicos:

| Tipo de detalhe | Appends pedidos | Total |
| --- | --- | --- |
| `movie` | credits, external_ids, images, videos, keywords, recommendations, similar, reviews, release_dates, translations, alternative_titles, watch/providers, changes | 13 |
| `tv` | os 13 acima (menos `release_dates`) + aggregate_credits, content_ratings, episode_groups, screened_theatrically | 16 |
| `tv_season` | credits, aggregate_credits, external_ids, images, videos, translations, watch/providers | 7 |
| `tv_episode` | credits, external_ids, images, videos, translations | 5 |
| `person` | external_ids, combined_credits, images, tagged_images, translations, changes | 6 |

O teto do TMDB é **20 sub-requests por chamada** (confirmado na documentação: *"comma
separated list of endpoints within this namespace, 20 items max"*). Nenhuma lista encosta
no teto, então **cada entidade custa 1 requisição de detalhe**, não várias.

### 1.2 O que é consumido — e a coluna que interessa

Medido entrada por entrada: para cada par classificado como consumido, conferi que o
módulo citado **existe** e que a string do campo **aparece nele**, e depois que a função
extratora **é chamada** por alguém fora de teste.

| Bloco | Tipos | Consumido por | De qual cópia | Pousa em |
| --- | --- | --- | --- | --- |
| `credits` | movie, tv | `normalizers/credits.ts` | append do detalhe | `cast_members`, `crew_members` |
| `credits` | tv_episode | `episodes/normalize.ts` | append do detalhe | idem (escopo episódio) |
| `credits` | **tv_season** | — | — | **NÃO CONSUMIDO** (adiado, com razão declarada) |
| `external_ids` | movie, tv, person | `normalizers/external-ids.ts` | append do detalhe | `entity_external_ids` + coluna `imdb_id` |
| `external_ids` | tv_episode | `episodes/normalize.ts` | append do detalhe | `entity_external_ids` |
| `external_ids` | **tv_season** | — | — | **NÃO CONSUMIDO** (adiado) |
| `images` | movie, tv, person, tv_season | `catalog-sync/media-normalize.ts` | **endpoint próprio** | `tmdb_images` |
| `images` | tv_episode | `episodes/normalize.ts` | append do detalhe | `tmdb_images` |
| `videos` | movie, tv, tv_season, tv_episode | `catalog-sync/media-normalize.ts` | **endpoint próprio** | `tmdb_videos` |
| `watch/providers` | movie, tv | `normalizers/watch-providers.ts` | append do detalhe | `watch_availability` |
| `watch/providers` | **tv_season** | — | — | **NÃO CONSUMIDO** (recusa deliberada) |
| `recommendations` / `similar` | movie, tv | `normalizers/recommendations.ts` | append do detalhe | tabela de relacionados |
| `release_dates` | movie | `normalizers/detail-facts.ts` | append do detalhe | fatos de estreia BR + classificação |
| `content_ratings` | tv | `normalizers/detail-facts.ts` | append do detalhe | classificação indicativa BR |
| `keywords` | movie, tv | `catalog-entities/normalize.ts` | append do detalhe | dicionário de keywords |
| `alternative_titles` | movie, tv | `catalog-entities/normalize.ts` | append do detalhe | títulos alternativos |
| `reviews` | movie, tv | — | — | **NÃO CONSUMIDO** — proibido exibir (`review_quote_allowed=false`) |
| `translations` | os 5 tipos | — | — | **NÃO CONSUMIDO** — porta de en/es, depende de `PUBLISHED_LOCALES` |
| `changes` | movie, tv, person | — | — | **NÃO CONSUMIDO** — usamos os `/changes` globais |
| `aggregate_credits` | tv, tv_season | — | — | **NÃO CONSUMIDO** — schema não tem contagem de episódios por crédito |
| `combined_credits` | person | — | — | **NÃO CONSUMIDO** — filmografia é montada pelo caminho inverso |
| `episode_groups` | tv | — | — | **NÃO CONSUMIDO** — ordem cronológica, sem escopo |
| `screened_theatrically` | tv | — | — | **NÃO CONSUMIDO** — fato raro, sem tela |
| `tagged_images` | person | — | — | **NÃO CONSUMIDO** — procedência de usuário |

**Verificação do lado negativo:** `episode_groups`, `screened_theatrically`,
`tagged_images` e `aggregate_credits` têm **zero ocorrências** em `services/**` fora de
teste; `combined_credits` aparece apenas num comentário. Ou seja, as entradas "adiadas"
não escondem consumidor — o erro oposto (declarar dívida onde há consumo, que já
aconteceu com `keywords`) não está presente hoje.

**A trava passa:** `tests/governance/tmdb-append-consumption.test.ts` — 13 testes, todos
verdes. Ela garante **cobertura** (nenhum par sem classificação, nenhum par nas duas
listas, nenhuma entrada morta), não veracidade; a veracidade acima foi conferida à mão.

### 1.3 Quais entradas de `append-consumption.ts` mentem hoje

**Nenhuma.** Esta é uma correção ao enunciado da auditoria.

O enunciado afirma que "4 das 19 entradas mentem". Isso descreve o estado **anterior** ao
commit `150c079` (2026-08-27 11:34), que corrigiu exatamente quatro valores — e o próprio
cabeçalho do arquivo documenta cada um:

| Valor | Estava classificado como | Verdade | Corrigido em |
| --- | --- | --- | --- |
| `keywords` | adiado ("não há superfície") | **consumido** (`catalog-services.ts:314`) | 2026-08-27 |
| `alternative_titles` | adiado | **consumido** (`catalog-services.ts:315`) | 2026-08-27 |
| `aggregate_credits` | consumido (apontava `normalizers/credits.ts`) | **não consumido** — a string nunca esteve lá | 2026-08-27 |
| `combined_credits` | consumido (apontava `normalizers/credits.ts`) | **não consumido** | 2026-08-27 |

Na mesma leva a chave do registro deixou de ser o valor sozinho e passou a ser o par
`(tipo, valor)` — que é o que tornou visíveis os sete appends de temporada.

**Conclusão:** trate o arquivo como fonte a partir de 27/08. A desconfiança do enunciado
era correta na data em que foi escrita e deixou de ser antes desta auditoria começar.

### 1.4 O que o TMDB oferece e nem pedimos

No nível de **append**, praticamente nada: comparando nossas listas com o namespace de
sub-recursos de cada tipo, as únicas ausências são `account_states` (exige sessão de
usuário) e `lists` (curadoria de usuário) — as duas excluídas de propósito e documentadas.
As listas de append estão **completas**.

O buraco real está no nível de **endpoint de dicionário**. O cliente implementa 25 rotas
fixas (`/configuration*`, `/genre/*`, `/certification/*`, `/discover/*`, `/search/*`,
`/trending/*`, `/movie/changes`, `/tv/changes`, `/person/changes`, listas de popularidade)
e as rotas por entidade. **Não implementa:**

| Endpoint ausente | O que traz | Lacuna que preencheria |
| --- | --- | --- |
| `/watch/providers/movie`<br>`/watch/providers/tv`<br>`/watch/providers/regions` | **O dicionário oficial de provedores de streaming**: id, nome, logo, países onde opera | Hoje `services/streaming/src/provider-registry.ts` é um registro **mantido à mão** (24 provedores BR). Um provedor novo no TMDB não existe para nós até alguém editar código. Este é o endpoint mais acionável da lista. |
| `/find/{external_id}` | Resolve TMDB id a partir de IMDb/TVDB id | Caminho de volta do OMDb para o catálogo; hoje só temos o sentido TMDB → IMDb |
| `/configuration/primary_translations` | Idiomas com tradução de primeira classe | Entrada para decidir `PUBLISHED_LOCALES` com dado, não com palpite |
| `/tv/episode_group/{id}` | Conteúdo de uma ordem alternativa | Bloco de valor 11 (ordem cronológica) — hoje pedimos `episode_groups` no append e não temos como abrir o grupo |
| `/movie/{id}/lists`, `/review/{id}` | Curadoria e críticas de usuário | Nenhuma — procedência de usuário, fora da política editorial |

### 1.5 O limite do TMDB (0.7)

Confirmado **na documentação**, não de memória
(`developer.themoviedb.org/docs/rate-limiting`):

- **Não há cota diária.** A documentação só discute limite por segundo.
- O limite antigo (40 req/10 s) foi desativado em **16/12/2019**.
- O limite atual, textualmente: *"somewhere in the 40 requests per second range"*, com o
  aviso de que pode mudar a qualquer momento. Estouro devolve **429**.

O que o projeto já faz: `TMDB_QUOTA` em `packages/config/src/provider-quotas.ts` declara
`perDay: null` e `perSecond: 40`.

> **Divergência medida.** O comentário daquela constante diz que a orientação vigente é
> "~50 req/s" e que 40 seria um "piso 20% abaixo". A documentação diz **40**. Nosso teto
> está **no** número documentado, não abaixo dele. É uma diferença pequena e favorável a
> corrigir no texto — não muda nenhuma conta deste documento, que já usa 40.

### 1.6 O que ainda falta medir do Item 0 (e por quê)

Os subitens **0.2** (chaves de topo que efetivamente chegam nos payloads guardados) e
**0.4** (tamanho médio do que é descartado) exigem ler `tmdb_raw.payload` e
`api_cache.payload` — **4,3 GB em produção**. O banco não é alcançável desta máquina
(`DATABASE_URL` aponta para `rss_prime_screen-db:5432`, hostname interno do Docker). O SQL
está pronto na seção 8; ele foi escrito para rodar sobre **amostra declarada**, não sobre
a tabela inteira.

Sem esses dois números, a coluna "chega?" da tabela 1.2 é o que o TMDB **documenta**
entregar, não o que foi contado nos nossos bytes. É a única parte do inventário que está
apoiada em documentação em vez de medição.

---

## 2. Item B — Por que 95.701 vídeos estão bloqueados

### 2.1 Quem escreve as duas colunas

`tmdb_videos` nasce com `license_status = unknown` e `display_allowed = false` — são os
**DEFAULT do DDL** (`schema.prisma:1485-1486`), e `catalog-sync/media-sync.ts` não os toca.
Toda linha entra escura.

São **duas** colunas, e o consumidor filtra o par:

```
display_allowed = true  AND  license_status NOT IN ('unknown','blocked')
```

Ligar só uma não acende nada.

O único caminho que as escreve é `services/ingestion/src/media-promotion/` — a CLI
`promote:media`. E `tmdb_videos` **não tem trigger**: diferente de `watch_availability` e
`external_ratings`, aqui um `UPDATE` cru passa sem barreira no banco. O gate de licença em
`media-promotion/license.ts` é a única coisa entre uma linha escura e uma linha pública.

### 2.2 O comando (não executado)

Existe, e é análogo ao das imagens. A invocação para vídeo:

```bash
corepack pnpm --filter @screena/ingestion promote:media --target=video --reviewer="Pablo Eduardo" --confirm
```

O que ela faria: lê `source_licenses` para `(source_key='tmdb', content_type='video')`,
exige licença vigente e `display_allowed`, e grava nas linhas o `license_status`
**derivado da licença vigente** — nunca um literal. Sem `--confirm` é dry-run e lê
exatamente a mesma coisa.

**Não há flag que pule o gate de licença.** Não existe `--license-ok`, e `--force` não
existe para este comando.

### 2.3 Por que só 2.395 acenderam

O freio de mudança em massa (`media-promotion/brake.ts`): **500 linhas por execução OU 5%
do total do alvo**, o que vier primeiro. Com 98.096 linhas, 5% = 4.904 — logo o teto que
morde é o absoluto, **500**. Passar dele exige `--confirm-mass-change`.

2.395 ÷ 500 ≈ 5 execuções. **Esta é inferência, não medição** — a confirmação está no SQL
da seção 8 (`reviewed_by` / `updated_at` das linhas acesas).

### 2.4 O apresentador filtra por idioma? **NÃO** — premissa refutada

Esta era a dúvida que decidia se liberar licença bastaria. **Basta.**

Em `apps/web/src/lib/trailer-presenter.ts`, a função `languageRank` **não é filtro** — é o
**terceiro critério de desempate** da ordenação:

1. `Trailer` antes de `Teaser`
2. oficial antes de não-oficial
3. pt-BR → inglês → resto ← *aqui*
4. publicado mais recente
5. `videoKey` alfabético

O gate real (`isDisplayableTrailerRow`) tem cinco condições e **nenhuma delas é idioma**:
`displayAllowed`, `licenseStatus`, `site === "YouTube"`, `videoType ∈ {Trailer, Teaser}`,
e `videoKey` válido.

**Consequência para o Deadpool 2:** os 8 vídeos são `en`, `site=YouTube`. Assim que a
promoção acender as linhas, o `Trailer` oficial em `en` é escolhido e a ficha passa a
mostrar o player. Idioma só decidiria qual vídeo ganha se houvesse um pt-BR concorrendo.

### 2.5 Os comentários de `entity-trailer.ts` e `trailer-presenter.ts` estão **velhos**

Os dois arquivos afirmam, em letra grande, coisas que deixaram de ser verdade:

| Arquivo | Afirma | Estado real |
| --- | --- | --- |
| `apps/web/src/server/entity-trailer.ts` | *"HOJE DEVOLVE `null` PARA TODO MUNDO"* e *"NADA no repositório as promove"* | **Falso**. `services/ingestion/src/media-promotion/` promove, e 2.395 linhas estão acesas — para elas a função devolve trailer. |
| `apps/web/src/lib/trailer-presenter.ts` | *"hoje isto ainda devolve `null` para todo mundo"* | **Falso**, mesma razão. |

É documentação atrás do código, do tipo que este repositório já catalogou antes. Corrigir
os dois comentários é conserto de código de risco zero — **não foi feito nesta leva**, que
é de medição.

### 2.6 O que falta medir (B.4)

A distribuição dos 2.395 acesos por `language_code` e `video_type` exige o banco. SQL na
seção 8. É o número que separa "acendemos uma amostra representativa" de "acendemos os 500
primeiros por id".

---

## 3. Item C — 32.762 notas calculadas que não aparecem

Há **dois caminhos independentes** para a nota, com **fontes e portões diferentes**. Essa
separação é a resposta do item, e ela não estava documentada em lugar nenhum.

### 3.1 Caminho da FICHA (hero) — fiado, gateado por licença

```
cinerie_score_calculations
  └─> entity-hero.ts :: getCinerieScoreForEntity   ← PORTÃO 1: decisão de licença
      └─> movie-page.ts:362 / series-page.ts
          └─> app/pt/filmes/[slug]/page.tsx:158 :: decideCinerieScore  ← PORTÃO 2: ≥ 2 fontes
              └─> <CinerieScoreCard>
```

**A fiação está completa.** (Uma leitura de 2026-08-21 registrou que "`decideCinerieScore`
não é chamado por nenhuma página" — isso deixou de valer; hoje as duas fichas o chamam.)

**Portão 1 — a decisão de licença.** `getCinerieScoreForEntity` roda um `SELECT` em
`data_usage_decisions` exigindo, tudo junto: `use_case = 'cinerie_score_display'`,
`d.is_current`, `l.is_current`, `stage = 'approved_for_display'`, `display_allowed`,
`derivative_allowed`, e `valid_from`/`valid_until` cobrindo agora. **Sem essa linha,
`authorized = false` e a função devolve sem sequer ler o cálculo** — os 32.762 registros
ficam invisíveis independentemente do valor.

**Portão 2 — o piso de duas fontes.** `decideCinerieScore` reconstrói as fontes contadas a
partir de `explanation` e exige `≥ 2` **com rótulo declarado** (`MINIMUM_COUNTED_SOURCES = 2`).
Fonte sem rótulo é descartada silenciosamente.

**Escala:** `CINERIE_SCORE_DISPLAY_SCALE = 100`, e o `deadpool-2` tem `scale=100`. **Aqui
não há conflito de escala.**

**Qual dos dois portões fecha em produção, eu não sei** — os dois dependem de dados que só
existem no banco. O SQL da seção 8 separa os dois casos com uma consulta. É a única
pergunta em aberto deste item, e ela é de **uma linha de SQL**, não de investigação.

### 3.2 Caminho da LISTAGEM (card) — **estruturalmente morto**

Este é o achado do item, e é conserto de código, não decisão do dono.

O card da listagem **não lê `cinerie_score_calculations` como fonte do número**. Ele lê as
colunas `movies.screen_score` / `screen_score_scale` / `screen_score_display`, e usa
`cinerie_score_calculations` apenas como **procedência** (`editorial-score.ts`): só libera
se existir um cálculo `calculated` cujo `value`/`scale` **batam** com as colunas.

Três coisas quebram esse caminho, e cada uma bastaria sozinha:

1. **Nada no repositório escreve `movies.screen_score`.** Varri `services/`, `apps/`,
   `packages/` e `scripts/`: **zero** escritas. Os dois workers de rating dizem isso em
   voz alta nos próprios relatórios — *"`screen_score` (nota editorial propria) NAO e
   tocado por este worker"*. Sem a coluna, `resolveEditorialScoreSources` filtra a
   entidade fora logo na primeira linha (`candidates` fica vazio).
2. **`screen_score_display` foi zerado por migration e nunca mais ligado.** A migration
   `20260717120000_external_intelligence_product` executa
   `UPDATE "movies" SET "screen_score_display" = false` (e o mesmo em `tv_shows`), e a
   coluna tem `@default(false)`. Nada a liga de volta.
3. **As duas escalas são incompatíveis.** `resolveCardScreenScore` exige
   `scale === SCREEN_SCORE_SCALE`, e `SCREEN_SCORE_SCALE = 5`
   (`home-hero-presenter.ts:23`). Os cálculos são gravados em **escala 100**
   (`CINERIE_SCORE_SCALE` na fórmula, e o `deadpool-2` confirma: `scale=100`). Mesmo que
   alguém preenchesse a coluna e ligasse a flag, **um cálculo em escala 100 nunca passa
   num gate que exige 5**.

**Resposta ao C.3:** a nota **não aparece em nenhuma listagem, card ou busca**. Não é
"aparece num lugar e não em outro" — é um caminho inteiro que foi construído e nunca
ligado, com três interrupções em série. Do ponto de vista do dono, a ficha é o único lugar
onde a nota pode aparecer hoje.

### 3.3 O `schema.org` declara a nota? **Não** — e está certo

Varri `apps/web` e `packages/seo`: **nenhum JSON-LD emite `aggregateRating`**. As únicas
ocorrências do termo são comentários explicando por que não se emite, e testes que
**reprovam** se ele aparecer (`article-technical-seo.test.ts`:
`expect(jsonLd.aggregateRating).toBeUndefined()`; o canário editorial verifica o mesmo no
HTML servido).

Não há violação: a ficha não declara o que não exibe. E como o Cinerie Score é nota
**própria**, ele nunca poderia virar `AggregateRating` de terceiro de qualquer forma.

### 3.4 O que ficou por fazer (C.2)

A prova por renderização não foi executada. A razão é de método, não de tempo: um
Postgres local semeado provaria *"dada uma decisão vigente e duas fontes, o card
renderiza"* — que é exatamente o que os testes já afirmam. **O fato decisivo mora nos
dados de produção**, e é ele que o SQL da seção 8 recupera. Semear localmente responderia
uma pergunta que não é a que está aberta.

---

## 4. Item A — A coleta de nota externa

### 4.1 O código existe, está agendado, e tem executor

| Camada | Onde | Estado |
| --- | --- | --- |
| Cliente HTTP | `api-clients/omdb/` | real |
| Worker | `services/ratings/src/omdb/` + `bin/sync-omdb-ratings.ts` | real |
| Fila do agendador | `rhythms.ts:177` — fila `ratings_omdb`, `providerApi: 'omdb'`, **7 dias** | declarada |
| Executor | `scheduler/runtime/runners.ts:610` — `runRatingsOmdb` | **existe e chama o worker** |
| Cota | `packages/config/src/omdb-budget.ts` + `provider-quotas.ts` | 1.000/dia, 150 reservados ao leitor |

Ou seja: **está agendado, não é manual.** Isso responde a pergunta central do item A.1 —
e refuta a hipótese natural de "alguém rodou na mão uma vez".

### 4.2 Por que parou em 226 — a explicação do enunciado está **incompleta**

O enunciado propõe: *"em 19/08 o catálogo tinha 239 títulos; a OMDb cobriu 226 e terminou
o serviço; depois o catálogo foi para 67.288 e nada re-executou."*

A primeira metade é consistente. **A segunda não se sustenta**, e a razão é mais simples e
mais grave: **a fila re-executa, só que devagar demais para ser percebida.**

A seleção de candidatos (`stale-entity-candidates.ts`) usa `NOT EXISTS`, que cobre os dois
casos de propósito: entidade **nunca coletada** e entidade coletada há tempo suficiente. A
ordenação é `popularity DESC NULLS LAST, id ASC`. Ou seja, os 67 mil títulos novos **são
candidatos válidos** e entrariam pelos mais populares. Não há lista de entrada fixa.

O gargalo é a **cadência**, e ela tem duas travas em série:

1. `runRatingsOmdb` pede `backgroundOmdbSlots(spentToday, batchLimit)`, que devolve
   `min(batchLimit, 1000 − gasto − 150)`. Com `CINERIE_SCHEDULER_BATCH_LIMIT` no default
   **200**, o teto por execução é **200**, não 850.
2. Essas 200 são divididas em **100 filmes + 100 séries** (`perType = slots/2`), e a fila
   só fica devida **a cada 7 dias**.

**Resultado: 200 títulos por semana ≈ 28,6 por dia.** Uma volta pelo catálogo leva
**2.355 dias — 6,5 anos**.

Isso contradiz a justificativa escrita na própria tabela de ritmos, que diz: *"O limite
real é a COTA (1.000/dia), não o relógio."* No código, **o relógio é que manda**, e por
uma margem de 30×. É a divergência mais cara deste documento.

**Duas condições ainda não medidas** (SQL na seção 8): se a fila **de fato executou** desde
19/08 (`api_sync_logs` com `provider_api='omdb'`), e se o agendador está com
`CINERIE_SCHEDULER_APPLY=true`. Sem ele em produção, o `/readyz` bloqueia — então um
serviço verde já é evidência forte de que está ligado, mas evidência não é medição.

### 4.3 O limite da chave em produção — **não determinado**

Sendo honesto: **não consegui determinar qual plano a chave de produção usa.**

O que sei: o código assume **1.000/dia** (`OMDB_QUOTA.perDay`), com `basis: "published"`
citando `omdbapi.com/apikey.aspx` — *"FREE! (1,000 daily limit)"*. Mas essa é uma
afirmação sobre **o plano gratuito**, não sobre **a chave que está configurada**. As duas
coisas foram colapsadas na constante.

Não fiz a chamada de teste que leria o cabeçalho de cota, por duas razões: não tenho a
credencial nesta máquina (`printenv` não traz nenhuma variável OMDb), e o item 6 das
regras desta leva proíbe coleta contra provedor externo — uma chamada de sonda é
defensável, mas não sem a credencial.

**Como determinar, em um passo:** o painel do OMDb (Patreon) mostra o plano da conta. Em
alternativa, uma única chamada autenticada devolve o consumo no corpo/cabeçalho. Se o
plano for pago, `OMDB_QUOTA.perDay` está subestimado e **toda a conta da seção 6 melhora
proporcionalmente**.

### 4.4 Uma chamada cobre três fontes — e duas ficam descobertas

`services/ratings/src/omdb/sources.ts` mapeia o array `Ratings[]` de **um** payload em até
**três linhas** de `external_ratings`, cada uma com sua fonte editorial, escala e crédito
próprios (o `omdb` é `provider_api`, nunca `rating_source` — invariante 2):

| Fonte OMDb | `rating_source` | `metric` | Natureza |
| --- | --- | --- | --- |
| Internet Movie Database | `imdb` | `audience` | média de votos de usuários |
| Rotten Tomatoes | `rotten_tomatoes` | `critics` | **Tomatometer** (o Popcornmeter não vem neste payload) |
| Metacritic | `metacritic` | `critics` | Metascore |

Isso explica os números do censo: 226 / 115 / 113 são os títulos que **têm** cada nota, não
três coletas diferentes.

**As duas que sobram — `letterboxd` e `filmaffinity` — vêm SÓ do RapidAPI.** São as 5+5
linhas de 10/07 que nunca mais se moveram. Não há segundo caminho no repositório.

> **Consequência da decisão do dono:** ao desligar o RapidAPI, `letterboxd` e
> `filmaffinity` ficam **permanentemente descobertas**. As 10 linhas existentes envelhecem
> e nada as renova. As opções são: aceitar duas fontes a menos, ou abrir escopo para outro
> fornecedor. Não há terceira.

### 4.5 Onde o RapidAPI ainda está

Mapeado, **não removido**. Três naturezas diferentes, e misturá-las levaria a arrancar
código que não é RapidAPI:

| Ponto | O que alimenta | Chama a rede do RapidAPI? |
| --- | --- | --- |
| `api-clients/rapidapi-core/` | Utilitários — `hashPayload`, `sanitize`, `env`. **Importado pelo caminho da OMDb** (`services/ratings/src/omdb/run.ts:27`) | **Não.** É biblioteca compartilhada. Arrancar quebra a OMDb. |
| `api-clients/film_show_ratings/` + `services/ratings/bin/sync-film-show-ratings.ts` | **Único caminho** de `letterboxd` e `filmaffinity` (+ um `rotten_tomatoes` redundante) | **Sim.** CLI manual — **não há fila no agendador**. |
| `api-clients/streaming_availability/` + `services/streaming/` | Disponibilidade de streaming | **Sim.** CLI manual — **superado**: a fila `watch_offers` do agendador usa `providerApi: 'tmdb'`. |
| `PROVIDER_QUOTAS.rapidapi` | Teto declarado (16/dia, `assumed_floor`) | Não — é dado. |

**Nenhuma fila do agendador tem `providerApi: 'rapidapi'`.** As quatro que consomem
fornecedor usam `tmdb`, `tmdb-exports` ou `omdb`. Em regime automático, o RapidAPI **já
não é chamado**. O que sobrevive é código alcançável só por CLI manual — e a dependência
de utilitário, que é RapidAPI só no nome.

### 4.6 O teto real da cobertura — **não medido**

A seleção exige `imdb_id IS NOT NULL` na tabela da entidade
(`stale-entity-candidates.ts:66,93`). Sem ele não há como consultar a OMDb, que é chaveada
por IMDb id.

`movies.imdb_id` é preenchido por `normalizers/movie.ts:79`
(`detail.imdb_id ?? detail.external_ids.imdb_id`) e `tv_shows.imdb_id` por
`normalizers/tv.ts:72` (só `external_ids.imdb_id` — o detalhe de série não tem o campo no
topo). **Os dois exigem que o sync de DETALHE tenha rodado** para aquele título; um título
que só passou pela descoberta de ids não tem `imdb_id`.

Quantos dos 70.537 têm — SQL na seção 8. **Esse número é o teto da cobertura possível, e
sem ele a conta da seção 6 usa 70.537, que é o limite superior otimista.**

---

## 5. Item D — O que impede a diária

### 5.1 A chave sem escopo (confirmada, com arquivo e linha)

| Job | Chave de idempotência | Arquivo:linha | Re-sincroniza? |
| --- | --- | --- | --- |
| `sync_details` (agendador) | `<fila>:<AAAA-MM-DD>` | `runtime/selection.ts` ← `scope.ts` | **Sim** — chave nova por dia |
| `sync_media` | `discriminator: input.locale` | `catalog-jobs/handlers/sync-details-handler.ts:217` | **Não — write-once** |
| `sync_seasons` | idem | `sync-details-handler.ts:217` (mesmo `base`) | **Não — write-once** |
| `sync_episodes` | `s<n>:<locale>` | `catalog-jobs/handlers/sync-seasons-handler.ts:106` | **Não — write-once** |

`sync_media:pt-BR` de um título já processado colide consigo mesma **para sempre**:
`catalog_jobs` não é podado em produção, então cada linha `succeeded` segura a chave
indefinidamente. O próprio código admite, em comentário logo abaixo
(`sync-details-handler.ts:230`): *"A CHAVE DO FILHO NAO TEM ESCOPO, a do pai tem […] o noop
e o caminho normal, nao a excecao."*

**Não existe fila de mídia em `rhythms.ts`.** A única reexecução é `catalog media`, que
roda o handler **inline**, fora da fila. A janela de 7 dias para mídia que
`.claude/rules/ingestion.md` declara **não tem executor**.

**Quantos títulos estão congelados por isso:** todos que já tiveram `sync_media` bem
sucedido — o censo anterior registrou 97.898 `sync_media` `succeeded`. Confirmação no SQL
da seção 8.

### 5.2 Os números reais do catálogo — **medidos** *(corrigido em 2026-08-31)*

> ### ERRATA — a versão anterior desta seção circulou com a coluna deslocada
>
> A tabela original usava **proxies** e estava **mecanicamente errada**: a contagem de
> séries foi escrita na linha de temporadas, a de temporadas na linha de episódios, e
> **episódio nunca foi contado**. Resultado: temporadas erradas por 4,2× e episódios
> errados por **28,8×**.
>
> Os valores errados que circularam — 34.802 / 32.486 / 32.483 / 135.926 / 100.000, e as
> contas derivadas 335.697 · **471.394** · **874.379** · **6,07 h** — **foram citados como
> verdade em outro documento**: [`gatilho-ou-varredura.md`](./gatilho-ou-varredura.md)
> (#254), que os declara explicitamente como *"proxies declarados de #248"*. Aquele
> documento recebeu a correção correspondente no mesmo PR desta errata.
>
> **A correção FORTALECE a conclusão do #254 em vez de enfraquecê-la** — ver §5.3.

Medido em produção por `psql` no `screen-db` em **2026-08-28**. Não há mais proxy nesta
tabela: os cinco números são contagem direta.

| Entidade | Valor | Origem | Valor errado que circulou |
| --- | ---: | --- | ---: |
| Filmes | **37.554** | `count(*) from movies` | 34.802 |
| Séries | **32.983** | `count(*) from tv_shows` | 32.486 |
| Temporadas | **136.650** | `count(*) from seasons` | 32.483 (**4,2× menor**) |
| Episódios | **3.921.368** | `count(*) from episodes` | 135.926 (**28,8× menor**) |
| Pessoas | **1.200.796** | `count(*) from people` | 100.000 (era o teto do censo) |
| **Total de entidades** | **5.329.351** | | 335.697 |

**Títulos = 37.554 + 32.983 = 70.537.**

O valor de 100.000 para pessoas não era estimativa: era **o próprio teto do censo**
reportado como total — o mesmo defeito que a #249 corrigiu. Número redondo é teto, não
medição.

### 5.3 A conta de viabilidade *(recalculada em 2026-08-31)*

**TMDB — a varredura completa NÃO cabe num dia. Erra por 4×.**

| Trabalho | Requisições | Base |
| --- | ---: | --- |
| Detalhe (1 req/entidade, appends inclusos) | **5.329.351** | 70.537 títulos + 136.650 temporadas + 3.921.368 episódios + 1.200.796 pessoas |
| Mídia (`/images` + `/videos` dedicados, 2 req/entidade) | **8.257.110** | (70.537 + 136.650 + 3.921.368) × 2 |
| Ofertas (`/watch/providers` dedicado) | 70.537 | títulos |
| **Total de uma passagem completa** | **13.656.998** | |

| Ritmo | Duração de UMA passagem | Teto diário daquele ritmo |
| --- | --- | ---: |
| 40 req/s (nosso teto) | **3,95 dias** (94,8 h) | 3.456.000 |
| 20 req/s (metade, margem) | 7,90 dias (189,7 h) | 1.728.000 |
| 10 req/s (um quarto) | 15,81 dias (379,4 h) | 864.000 |

> **A varredura completa diária não é cara — é impossível.** No nosso próprio teto de
> ritmo ela leva **quase 4 dias**; um dia não cabe em quatro. Não existe folga a comprar:
> mesmo a 40 req/s **contínuos, 24 h por dia**, o acervo só fecha uma volta a cada quatro
> dias.
>
> A mídia sozinha é **8.257.110 requisições — 60,5% do custo** — e **95% dessa mídia é
> episódio** (3.921.368 × 2 = 7.842.736). Episódio é exatamente a entidade que a versão
> errada contava por 135.926 em vez de 3,92 milhões: era ela que escondia a
> impossibilidade.

**O que isso faz com a conclusão anterior.** A versão errada dizia *"o TMDB não é o
obstáculo, nunca foi custo"*. Metade continua verdadeira e metade inverte:

- **Continua verdadeiro:** o TMDB não tem cota diária, e o impedimento IMEDIATO da mídia
  continua sendo a chave de idempotência sem escopo (§5.1) — consertá-la é pré-requisito
  de qualquer desenho.
- **Inverte:** o volume **passa a ser um obstáculo estrutural**. Varrer tudo todo dia
  deixou de ser uma opção cara para virar uma opção inexistente.

**Consequência direta para o #254 — a recomendação de lá fica MAIS forte, não menos.**
[`gatilho-ou-varredura.md`](./gatilho-ou-varredura.md) recomendou o Desenho 3 (gatilho
`/changes` + exports + reconciliação mensal) argumentando **economia de 84,5%**. Com o
número correto, o argumento deixa de ser economia e vira **viabilidade**: o Desenho 1
(varredura completa) não é o caro, é o **impossível**, e o gatilho passa a ser o único
desenho que executa. As 195 requisições/dia que enumeram o `/changes` inteiro agora valem
**0,0014%** da varredura, não 0,02%.

**A ressalva que a correção AGRAVA.** O #254 mediu que `/changes` **não nomeia episódio**.
Com os proxies errados, episódio era 58% do custo de mídia; com o número real, **episódio
é 95% da mídia e 57% do custo total da varredura**. A lacuna que o #254 classificou como
"vale medir antes de desenhar" passa a ser **a questão central do desenho**.

**OMDb — não cabe, e a distância é grande.**

| Cenário | Req/dia | Volta completa (70.537 títulos) |
| --- | ---: | --- |
| Cota utilizável (1.000 − 150 de reserva) | 850 | **83 dias** |
| **Ritmo real do agendador hoje** (200 a cada 7 d) | 28,6 | **2.469 dias ≈ 6,8 anos** |
| Para fechar a janela de 7 dias declarada | 10.077 | **10,1× a cota gratuita** |

### 5.4 Proposta de ritmo escalonado

Como a diária completa da OMDb é impossível no plano gratuito, o critério tem de ser
**popularidade** — que é o sinal que o banco já tem, já indexa (`@@index([popularity])`) e
que a seleção **já usa** para ordenar. Nenhum agendador novo; só números.

| Faixa | Critério | Volume | Cadência | Req/dia |
| --- | --- | ---: | --- | ---: |
| **A — cabeça** | 2.000 mais populares | 2.000 | semanal | 286 |
| **B — corpo** | próximos 10.000 | 10.000 | mensal | 333 |
| **C — cauda longa** | os **58.537** restantes | 58.537 | a cada **260 dias** | 225 |
| | | | **Total** | **844/dia** ✓ |

Cabe na cota utilizável (850). Um título recém-ingerido não espera a faixa: o caminho sob
demanda tem 150 reservados só para ele.

> **Recalculado em 2026-08-31.** A versão anterior dizia *"os 55.288 restantes, a cada 240
> dias, 849/dia"* — derivava de 67.288 títulos. Com 70.537 títulos a cauda cresce para
> 58.537, e a cadência de 240 dias **estouraria a cota** (863/dia contra 850). Alongando a
> cauda para 260 dias o total volta a caber: **844/dia**. As faixas A e B não mudam.

**Se a chave for de plano pago, tudo isso encolhe proporcionalmente** — daí a seção 4.3 ser
pré-requisito desta decisão, e não um detalhe.

Para o **TMDB**, a proposta é o oposto: não escalonar por custo, e sim **ligar o que já
existe**. A tabela de ritmos atual já é escalonada por volatilidade (ofertas 1 d, trending
6 h, detalhe ativo 7 d, detalhe encerrado 30 d) e é defensável. O que falta é mídia, que
não tem fila nenhuma.

### 5.5 Onde isso se encaixa no que já existe

Nenhum agendador novo. Três ajustes na máquina existente:

| Mudança | Onde | Natureza |
| --- | --- | --- |
| Dar escopo à chave de `sync_media`/`sync_seasons`/`sync_episodes` (ex.: `<locale>:<AAAA-MM-DD>`, como o pai já faz) | `sync-details-handler.ts:217`, `sync-seasons-handler.ts:106` | conserto de código |
| Criar a fila `media` em `RHYTHMS` (7 dias, `providerApi: 'tmdb'`) + runner | `scheduler/rhythms.ts`, `runtime/runners.ts` | código novo, no padrão existente |
| Trocar a cadência da OMDb de "7 dias × 200" para "diária × fatia da faixa" | `rhythms.ts:177` + `runRatingsOmdb` | conserto de código — alinha o código à justificativa que já está escrita lá |

### 5.6 Os 2.122 `dead_letter` — **não medidos**

Não foi possível caracterizar. SQL na seção 8 (tipo de job, motivo, quantos voltariam).

Uma armadilha já catalogada e que vale para quem for rodar: **a causa do job morto é
descartada pelo formatador** da CLI — use `--json` para ver a mensagem real.

---

## 6. As três causas, separadas por natureza

O pedido de não misturar é o ponto mais importante deste documento. **Cada linha abaixo
tem um dono diferente.**

### 6.1 Decisão de LICENÇA (assinatura do dono — nenhum agente decide)

| # | O quê | Efeito |
| --- | --- | --- |
| L1 | Promover as ~95.701 linhas de `tmdb_videos` (`promote:media --target=video --confirm`, com `--confirm-mass-change` acima de 500) | **Acende o trailer em todo o catálogo.** A licença-mãe já existe desde 13/08; falta o ato por linha. |
| L2 | Aplicar/confirmar a decisão vigente de `cinerie_score_display` em `data_usage_decisions` | Destrava o portão 1 da nota na ficha |
| L3 | Aceitar perder `letterboxd` e `filmaffinity`, ou abrir escopo para outro fornecedor | Consequência direta de desligar o RapidAPI |

### 6.2 Decisão de CUSTO (do dono — envolve dinheiro ou tempo de espera)

| # | O quê | Efeito |
| --- | --- | --- |
| K1 | Plano da OMDb: continuar gratuito (volta de 79 dias no melhor caso) ou pagar | Define se a faixa C é de 240 dias ou de 30 |
| K2 | Ritmo do TMDB: 40 req/s (6 h/dia) ou 20 req/s (12 h/dia, mais gentil) | Não há custo em dinheiro — só janela de execução |
| K3 | Aceitar o escalonamento da OMDb por popularidade (seção 5.4) | Título impopular fica com nota velha, declaradamente |

### 6.3 Conserto de CÓDIGO (não precisa do dono — precisa de PR)

| # | O quê | Onde |
| --- | --- | --- |
| C1 | Chave de idempotência sem escopo torna mídia/temporada/episódio *write-once* | `sync-details-handler.ts:217`, `sync-seasons-handler.ts:106` |
| C2 | Não há fila de mídia no agendador | `scheduler/rhythms.ts` |
| C3 | Cadência da OMDb (200/7 d) contradiz a própria justificativa (cota/dia) | `rhythms.ts:177`, `runners.ts:610` |
| C4 | Nada escreve `movies.screen_score` / `tv_shows.screen_score` | — (escritor inexistente) |
| C5 | `screen_score_display` zerado por migration e nunca religado | `20260717120000_external_intelligence_product` |
| C6 | Escalas incompatíveis: cálculo em 100, card exige 5 | `home-hero-presenter.ts:23` vs. fórmula |
| C7 | Comentários de `entity-trailer.ts` e `trailer-presenter.ts` afirmam algo falso | os dois arquivos |
| C8 | Comentário de `TMDB_QUOTA` diz "~50 req/s"; a doc diz 40 | `provider-quotas.ts` |

---

## 7. A ordem que eu faria, e por quê

Ordenado por **retorno sobre esforço**, não por gravidade.

| # | Ação | Esforço | Retorno | Por que nesta posição |
| --- | --- | --- | --- | --- |
| **1** | **L1 — promover os vídeos** | Um comando, uma assinatura | **Enorme** | Muda 95.701 linhas e acende o trailer em ~67 mil fichas. O dado **já está no banco, pago e coletado**. É o único item onde o produto muda hoje sem escrever uma linha de código. E B.4 provou que idioma não atrapalha. |
| **2** | **L2 — a decisão do Score** | Um comando | **Alto** | 32.762 notas calculadas esperando um `SELECT` retornar linha. Mesmo perfil do item 1: o trabalho caro já foi feito. |
| **3** | **C1 — dar escopo à chave** | PR pequeno, cirúrgico | **Alto** | Sem isso, *nada* de mídia se atualiza — nem hoje, nem nunca. É a trava única entre "mídia congelada" e "mídia diária", e o TMDB já provou que cabe. Vem depois de 1 e 2 só porque eles são de minutos. |
| **4** | **C3 — cadência da OMDb** | PR pequeno | **Alto** | 30× mais notas por semana mudando dois números. Sem isso, mesmo com cota sobrando, a volta leva 6,5 anos. |
| **5** | **C2 — fila de mídia** | PR médio | Alto | Torna o item 3 recorrente em vez de manual. Depende do 3 para fazer sentido. |
| **6** | **K1 — decidir o plano da OMDb** | Uma consulta ao painel | Médio | Barato de descobrir, e **define** a faixa C da seção 5.4. Não bloqueia 1–5. |
| **7** | **C4/C5/C6 — o caminho da listagem** | PR médio, 3 defeitos em série | Médio | O maior conserto de código, mas a ficha (itens 1–2) já entrega a nota ao leitor. Consertar a listagem é ampliação de alcance, não desbloqueio. |
| **8** | **C7/C8 — comentários velhos** | Trivial | Baixo/composto | Risco zero. Vale junto de qualquer PR que encoste nos arquivos. Documentação que mente já custou tempo a esta auditoria. |

**O que eu faria primeiro, e por quê:** o **item 1**. É o único da lista em que o produto
melhora visivelmente **hoje**, sem PR, sem deploy e sem risco de regressão — o dado está
pago, coletado, guardado e provadamente exibível assim que a coluna virar. Todo o resto
exige escrever ou decidir alguma coisa. E ele tem uma propriedade rara: se der errado, a
reversão é o mesmo comando com `--revoke`.

---

## 8. O que falta medir — SQL para o console do painel

O banco não é alcançável desta máquina. O caminho é: **painel → projeto `rss_prime` →
serviço `screen-db` → ícone `>_` → aba Bash** (a aba "Postgres Client" não serve).

Tudo abaixo é **leitura pura**. Nenhum `UPDATE`, `DELETE`, `DROP` ou `--apply`. As
consultas sobre `tmdb_raw`/`api_cache` usam **amostra declarada** (`TABLESAMPLE` /
`LIMIT`), porque são milhões de linhas e 4,3 GB.

> **`api_providers` pode conter credencial — nenhuma consulta abaixo faz `SELECT *` nela.**

```bash
psql -U screena -d screena <<'SQL'
\echo '=== 1. C — QUAL PORTAO FECHA A NOTA (a pergunta mais barata do relatorio) ==='
SELECT count(*) AS decisoes_vigentes_do_score
  FROM data_usage_decisions d
  JOIN source_licenses l ON l.id = d.source_license_id
 WHERE d.use_case = 'cinerie_score_display' AND d.is_current AND l.is_current
   AND d.stage = 'approved_for_display' AND d.display_allowed AND d.derivative_allowed
   AND d.valid_from <= now() AND (d.valid_until IS NULL OR d.valid_until > now());
-- 0  => portao 1 (licenca). 1 => portao 2 (piso de 2 fontes); rode a proxima.

SELECT jsonb_array_length(explanation) AS fontes_no_calculo, count(*) AS titulos
  FROM cinerie_score_calculations
 WHERE status = 'calculated' AND jsonb_typeof(explanation) = 'array'
 GROUP BY 1 ORDER BY 1;

\echo '=== 2. A.6 — O TETO REAL DA COBERTURA OMDb ==='
SELECT 'movies' AS tabela, count(*) AS total,
       count(imdb_id) AS com_imdb_id,
       round(100.0 * count(imdb_id) / NULLIF(count(*),0), 1) AS pct
  FROM movies
UNION ALL
SELECT 'tv_shows', count(*), count(imdb_id),
       round(100.0 * count(imdb_id) / NULLIF(count(*),0), 1)
  FROM tv_shows;

\echo '=== 3. A.2 — A FILA DA OMDb EXECUTOU DESDE 19/08? ==='
SELECT date_trunc('day', created_at) AS dia, status,
       count(*) AS execucoes, sum(quota_cost) AS cota
  FROM api_sync_logs
 WHERE provider_api = 'omdb' AND created_at > now() - interval '30 days'
 GROUP BY 1,2 ORDER BY 1 DESC;

\echo '=== 4. D.1 — O CATALOGO JA SE RE-SINCRONIZOU ALGUMA VEZ? ==='
SELECT job_type,
       COALESCE(split_part(run_id, ':', 1), '(sem run_id)') AS origem,
       count(*) AS jobs
  FROM catalog_jobs
 WHERE job_type IN ('sync_details','sync_media','sync_seasons','sync_episodes')
 GROUP BY 1,2 ORDER BY 1, 3 DESC;
-- zero linhas com origem 'scheduler' => o caminho de re-sync nunca rodou.

\echo '=== 5. D.2 — OS NUMEROS REAIS, SEM O TETO DE 100.000 ==='
SELECT 'movies' t, count(*) n FROM movies
UNION ALL SELECT 'tv_shows', count(*) FROM tv_shows
UNION ALL SELECT 'seasons',  count(*) FROM seasons
UNION ALL SELECT 'episodes', count(*) FROM episodes
UNION ALL SELECT 'people',   count(*) FROM people;

\echo '=== 6. B.4 — DISTRIBUICAO DOS VIDEOS ACESOS ==='
SELECT license_status, display_allowed, language_code, video_type, count(*) AS n
  FROM tmdb_videos
 WHERE display_allowed = true
 GROUP BY 1,2,3,4 ORDER BY n DESC LIMIT 40;

\echo '=== 6b. B.3 — TEM VIDEO ACESO SEM NENHUM pt-BR? (idioma nao filtra, mas confirma) ==='
SELECT language_code, count(*) AS n
  FROM tmdb_videos
 WHERE video_type IN ('Trailer','Teaser') AND site = 'YouTube'
 GROUP BY 1 ORDER BY n DESC LIMIT 15;

\echo '=== 6c. B.3 — QUANDO E POR QUEM OS 2.395 FORAM ACESOS ==='
SELECT date_trunc('hour', updated_at) AS hora, count(*) AS linhas
  FROM tmdb_videos WHERE display_allowed = true
 GROUP BY 1 ORDER BY 1;

\echo '=== 7. D.6 — OS DEAD LETTER ==='
SELECT job_type, count(*) AS n,
       min(created_at) AS primeiro, max(created_at) AS ultimo
  FROM catalog_jobs WHERE status = 'dead_letter'
 GROUP BY 1 ORDER BY n DESC;

\echo '=== 8. C.3 — A COLUNA screen_score FOI ESCRITA ALGUMA VEZ? (espero 0) ==='
SELECT count(*) FILTER (WHERE screen_score IS NOT NULL)        AS com_nota,
       count(*) FILTER (WHERE screen_score_display)            AS com_display,
       count(*)                                                AS total
  FROM movies;

\echo '=== 9. ITEM 0.2 — CHAVES DE TOPO QUE CHEGAM (AMOSTRA DECLARADA) ==='
\echo '--- tmdb_raw: amostra de 5.000 linhas ---'
WITH amostra AS (SELECT payload, entity_type FROM tmdb_raw LIMIT 5000)
SELECT entity_type, k AS chave, count(*) AS ocorrencias
  FROM amostra, LATERAL jsonb_object_keys(amostra.payload) k
 GROUP BY 1,2 ORDER BY 1, 3 DESC;

\echo '--- ITEM 0.4 — TAMANHO MEDIO POR BLOCO (amostra de 2.000) ---'
WITH amostra AS (SELECT payload, entity_type FROM tmdb_raw LIMIT 2000)
SELECT entity_type, k AS bloco,
       count(*) AS linhas,
       pg_size_pretty(avg(pg_column_size(payload -> k))::bigint) AS tamanho_medio,
       pg_size_pretty(sum(pg_column_size(payload -> k))::bigint) AS total_na_amostra
  FROM amostra, LATERAL jsonb_object_keys(amostra.payload) k
 GROUP BY 1,2 ORDER BY sum(pg_column_size(payload -> k)) DESC LIMIT 40;

\echo '=== 10. ITEM 0.4 — O PESO DAS TABELAS DE BRUTO ==='
SELECT relname AS tabela, pg_size_pretty(pg_total_relation_size(relid)) AS tamanho
  FROM pg_catalog.pg_statio_user_tables
 WHERE relname IN ('api_cache','tmdb_raw','tmdb_videos','tmdb_images','external_ratings','catalog_jobs')
 ORDER BY pg_total_relation_size(relid) DESC;
SQL
```

> **Nota sobre a consulta 9/10:** ajuste `entity_type` ao nome real da coluna de
> `tmdb_raw` se ele divergir. `LIMIT` sem `ORDER BY` devolve as primeiras linhas físicas —
> é amostra de conveniência, não aleatória; para aleatória, troque por
> `TABLESAMPLE SYSTEM (1)`. **Diga qual foi usada ao reportar o número.**

---

## 9. O que ficou de fora, e por quê

| Item | Estado | Motivo |
| --- | --- | --- |
| **0.2** — chaves de topo que chegam | Não medido | Exige `tmdb_raw`/`api_cache` (4,3 GB); banco inalcançável daqui. SQL pronto (§8.9). |
| **0.4** — custo do que é descartado | Não medido | Idem. SQL pronto (§8.9/8.10). |
| **A.3** — plano da chave OMDb | **Não determinado** | Sem credencial nesta máquina, e sondar provedor externo está fora do escopo desta leva. Declarado como desconhecido em vez de assumido gratuito. |
| **A.6** — títulos com IMDb id | Não medido | SQL pronto (§8.2). É o teto real da cobertura. |
| **B.4** — distribuição dos acesos | Não medido | SQL pronto (§8.6). |
| **C.2** — prova por renderização | **Não executada, por método** | Um Postgres semeado provaria o que os testes já afirmam. O fato decisivo está em produção (§8.1). |
| **D.2** — totais reais | Parcial | Filmes e séries medidos; temporada/episódio/pessoa por proxy declarado. SQL pronto (§8.5). |
| **D.6** — os 2.122 `dead_letter` | Não medido | SQL pronto (§8.7). |

Nenhum item foi pulado por falta de tempo. Os oito acima têm a mesma causa: **o banco de
produção não é alcançável desta máquina**, e a alternativa honesta é entregar o SQL em vez
de estimar.

---

## 10. Correções que este documento faz ao enunciado da auditoria

A regra de honestidade da leva manda o número mandar. Três correções:

1. **"4 das 19 entradas de `append-consumption.ts` mentem"** — verdade até 27/08, corrigido
   no commit `150c079`. Hoje o registro está honesto, verificado entrada por entrada (§1.3).
2. **"A OMDb parou porque o catálogo cresceu e nada re-executou"** — a seleção **cobre** os
   títulos novos (`NOT EXISTS` + ordem por popularidade). O que a trava é a **cadência**:
   200 títulos a cada 7 dias, contra os 850/dia que a cota permitiria (§4.2).
3. **"Se o filtro exigir pt-BR, liberar licença não resolve sozinho"** — **não há filtro de
   idioma.** `languageRank` é desempate de ordenação. Liberar licença **resolve** (§2.4).
