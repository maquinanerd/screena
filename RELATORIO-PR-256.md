# Relatório da PR #256 — a mídia nasce liberada, e o filho do sync volta a rodar

> **Uma linha:** o pedido era "libera tudo e mantém atualizado". Liberar era o menor
> dos três problemas — a licença já dizia sim desde agosto; a linha é que nascia
> apagada por *default do DDL*, sem ninguém consultar licença nenhuma. E o que
> impedia "manter atualizado" era uma chave de idempotência sem escopo: os filhos de
> `sync_details` escreviam **uma vez e nunca mais**, sem erro em lugar nenhum.

| | |
|---|---|
| **Data** | 2026-08-28 |
| **PR** | [#256](https://github.com/maquinanerd/screena/pull/256) |
| **Branch** | `claude/liberar-midia-todos-conteudos-737f83` |
| **Base** | `main` @ `577cc8e` (mergeada duas vezes durante a sessão: `0493283`, depois `a49876c`) |
| **Commits** | `866d908` (a leva), `593cd24` e `b8101d5` (correções de comentário mentiroso) |
| **Arquivos no commit principal** | 52 (1.978 inserções, 428 remoções) |
| **Arquivos novos** | 6 — 3 de código, 3 de teste |
| **CI** | **verde** em `593cd24` (os três jobs) |
| **Testes** | 7.447 passando / 572 arquivos |

---

## 0. Como ler este relatório

O prompt trazia números medidos. **Três deles não bateram**, e a regra da casa é que
o número manda. As correções estão nas seções 2.2, 4.1 e 6.2, e não são detalhe:
duas delas mudariam a decisão de o que consertar.

O que este documento **não** é: prova de que a página mudou. Ela não mudou ainda, e
a seção 8 explica exatamente por quê e o que falta.

---

## 1. O enunciado

A decisão do dono, por escrito, em 2026-08-28:

> "Parou com essa porra de licença, tá tudo liberado, crie um comando pra liberar
> tudo, para de ficar segurando as coisas."
>
> "VIDEOS, NOTAS, IMAGENS, POSTER, TRAILER, TUDO É PRA TER EM TODOS OS FILMES
> SÉRIES, EPISÓDIOS, TEMPORADAS E ETC. ISSO É PRA FICAR ATUALIZADO, DIARIAMENTE."

O pedido vinha dividido em três frentes — liberar (A), a nota aparecer (B), ficar
atualizado sozinho (C) — com a advertência explícita de que meia liberação com o
motor diário quebrado dá o mesmo resultado de hoje daqui a um mês.

O caso de prova apontado: `https://cinerie.com/pt/filmes/deadpool-2/`, sem trailer e
sem nota.

---

## 2. O que eu fiz, em ordem

### 2.1 Li a cadeia inteira antes de tocar em qualquer coisa

Ler o comando de promoção não bastava. Foram quatro cadeias distintas, e confundi-las
é o que faz uma leva dessas virar meia leva:

| cadeia | de onde sai | onde morre hoje |
|---|---|---|
| **vídeo/trailer** | `tmdb_videos.display_allowed` (por LINHA) | a linha nasce `false` |
| **imagem de título** | `source_licenses` (pela FONTE) | **já acesa** desde 21/08 |
| **foto de pessoa** | `tmdb_images.display_allowed` (por LINHA) | a linha nasce `false` |
| **nota (Cinerie Score)** | `cinerie_score_calculations` | dois caminhos diferentes: ficha e listagem |

O runbook `docs/operations/media-promotion-runbook.md` §1 já explicava a diferença
entre gate por FONTE e gate por LINHA. Foi o que evitou eu "consertar" a galeria de
título, que nunca esteve quebrada.

### 2.2 O teto de 500 — o primeiro número que não bateu

O enunciado dizia: *"`promote:media` libera 500 por execução. 95.701 ÷ 500 = ~192
execuções. Esse teto é o problema."*

Lido no código, são **três números diferentes**, e nenhum é teto de lote por execução:

| número | onde vive | o que é |
|---|---|---|
| **500** | `media-promotion/brake.ts` :: `DEFAULT_MASS_CHANGE_THRESHOLDS.maxChanges` | teto do **freio**. Passar dele exige `--confirm-mass-change`. Com o opt-in, passa tudo. |
| **5%** | mesma constante, `maxChangeRatio` | idem, proporcional. O denominador é a **tabela inteira**, não a seleção. |
| **200** | `persistence/media-promotion-store.ts` :: `MUTATION_CHUNK` | lote do `updateMany`. **Interno** — o comando já iterava sozinho até acabar. |

E `--limit` é `null` por padrão: sem ele, `listCandidates` traz **todas** as linhas do
alvo numa execução.

**Logo: uma execução com `--confirm-mass-change` sempre promoveu o acervo inteiro.**
O que de fato obrigava repetir era outra coisa — `--target` era obrigatório e
**recusava `all`**, com um comentário explicando o porquê:

> `--target` é OBRIGATORIO. Nao ha alvo default e nao ha "todos": promover video e
> foto de pessoa na mesma execucao juntaria dois censos e dois denominadores num
> relatorio so, e o freio perderia o sentido.

O argumento estava **certo** e a conclusão virou obstáculo. Ver 3.2.

### 2.3 Achei a causa de o catálogo congelar, e ela não estava no enunciado

O enunciado apontava a chave de idempotência sem escopo como um item de manutenção
(C.1). Lendo os handlers, é a causa-raiz de metade do pedido — inclusive de "todo
filme tem que ter trailer".

`buildCoverageJob` **sempre** deu escopo ao pai: a janela, vindo do `/changes`; o dia,
vindo do agendador. O filho não tinha:

```ts
// sync-details-handler.ts, antes
idempotencyKey: buildIdempotencyKey({
  jobType, entityType: input.entityType, externalId,
  discriminator: input.locale,      // <- `pt-BR`, e só. Idêntico para sempre.
})
```

Pior: `SyncDetailsInput` **nem lia** o campo. `buildCoverageJob` já gravava o escopo no
payload como `window`, e `validateSyncDetailsInput` o descartava silenciosamente.

Efeito: o pai voltava a rodar, o filho batia no unique de `idempotency_key`, recebia
`created = false` e não fazia nada. `tmdb_videos`, `tmdb_images`, `seasons` e
`episodes` eram escritos **uma vez**, no primeiro ciclo que tocou o título, e nunca
mais. O próprio comentário do handler tratava isso como normal:

> "o noop e o caminho normal, nao a excecao"

Trailer novo, pôster novo e episódio novo não entravam. Zero erro em zero lugar.

### 2.4 Medi a produção antes de acreditar no diagnóstico da nota

`fetch(url, { cache: 'reload' })` + `DOMParser`, procurando `.score-card__value` e
`[data-trailer="ready"]`. Amostra **espalhada pelo sitemap** (a cada N), nunca o topo
— topo de sitemap é ordem de id e topo de listagem é ordem de ano; os dois concentram
a cabeça já processada. O resultado está na seção 6.

---

## 3. A correção — Parte A: liberar

### 3.1 A decisão gravada, e onde

Investiguei antes de criar tabela, como o enunciado mandava. A estrutura equivalente
que o repositório já usa é `source_licenses` + `data_usage_decisions`, e `apply.ts` já
carimba `decided_by`, `decided_at`, `decision_origin`, `policy_version` e `notes` em
cada linha nova.

`services/legal/src/authorization-spec.ts` ganhou `OWNER_DECISION_2026_08_28` com a
citação literal, e a nota `MEDIA_BORN_DISPLAYABLE_NOTE`, que vai para
`source_licenses.notes` das duas licenças de mídia — para que a pergunta *"por que
esta linha de `tmdb_videos` nasceu acesa?"* seja respondível pelo **registro**, sem
abrir o repositório.

Os quatro itens que o enunciado pediu, e o estado de cada um:

| item | estado |
|---|---|
| vídeo TMDB **nasce e permanece** exibível | **NOVO** — licença subiu para `cinerie-source-auth/tmdb-video/2026-08-v3` |
| imagem e pôster TMDB idem | **NOVO** — `cinerie-source-auth/tmdb-image/2026-08-v4` |
| nota OMDb (IMDb, RT, Metacritic) exibível | **já registrado** — decisão `rating_display` por fonte, `approved_for_display` |
| `cinerie_score_display` habilitado | **já registrado** — sob a licença-âncora do IMDb, `derivative_allowed = true`, base `owner_decision` |

Só (1) e (2) são novos, e o que muda neles é o **nascimento** — a licença-mãe já dizia
`display_allowed = true` desde 13/08 (vídeo) e 21/08 (imagem).

**Por que subir a versão da licença.** `plan.ts::licenseMatches` compara
`policy_version`, e **não** compara `notes`. Mudar só a nota não produziria linha nova:
o registro continuaria sem a decisão. A subida de versão é o que faz o `apply` gravar.

### 3.2 O comando único

`services/ingestion/package.json`:

```json
"media:liberar-tudo":  "tsx bin/promote-media.ts --target=all --confirm --confirm-mass-change",
"media:reverter-tudo": "tsx bin/promote-media.ts --target=all --revoke --confirm --confirm-mass-change"
```

```bash
corepack pnpm --filter @screena/ingestion media:liberar-tudo --reviewer="Pablo Eduardo"
```

**`--target=all` NÃO funde os censos.** O bin itera alvo por alvo, e cada iteração roda
a promoção inteira — licença, guardrails, freio, censo — com o denominador do seu
próprio alvo. O relatório **empilha** as execuções em vez de somar. O argumento
original do parser continua valendo; o que ele proibia era fundir, e isto não funde.

O `--reviewer` continua obrigatório: identidade humana no relatório e no log é barata
e insubstituível.

`combinedExitCode` mora em `run.ts` (puro), **não** no bin — pelo motivo que o
`compute-cinerie-score` já pagou: um bin que chama `main()` no topo do módulo não pode
ser importado por teste sem abrir o Prisma, e foi assim que o parser dele passou
quatro dias com um defeito em produção sem nenhum teste possível. O pior desfecho
vence: `ok < failed < mass-change < blocked`. Um `all` em que o vídeo acendeu e a foto
foi barrada **não** pode sair 0.

**Testado ponta a ponta sem banco:**

```
> tsx bin/promote-media.ts --target=all --confirm --confirm-mass-change "--reviewer=Pablo Eduardo"
Bloqueado: DATABASE_URL ausente: defina o banco alvo (nunca commite a URL).
Exit status 3
```

Parseia tudo e para no gate de ambiente. O `pnpm` encaminhou `--reviewer="Pablo
Eduardo"` como um argumento único, com aspas preservadas.

### 3.3 Nascer liberado — o item que encerra a repetição

`services/ingestion/src/media-promotion/birth.ts` (PURO, sem banco/rede/relógio) lê
`source_licenses` pelo **mesmo gate** da promoção (`authorizeMediaPromotion`) e decide
o estado de nascimento. `media-store.ts` e `episode-store.ts` gravam esse par no
`create`. O leitor Prisma é `persistence/media-birth-reader.ts`.

Três decisões que são o coração disto, e todas as três são fáceis de errar:

**1. O `update` NUNCA reacende.** Só a criação aplica a política. Se o update
aplicasse, o próximo ciclo de ingestão desfaria em silêncio uma revogação deliberada
de `promote:media --revoke`, e a reversão deixaria de existir na prática. Apagar
continua sendo um ato que só outro ato desfaz.

**2. Imagem usa o gate MAIS ESTRITO** — `authorizeMediaPromotion('person-photo', …)`,
que exige `official`/`licensed` (`in`, não `notIn`) — inclusive para imagem de título.
É a direção segura de errar: a licença vigente é `official`, então hoje as duas
leituras dão o mesmo resultado; e no dia em que ela cair para `third_party`, a linha
de título nascer apagada **não muda nada na tela** (a galeria de título é gated pela
FONTE e ignora a coluna da linha), enquanto nascer acesa criaria uma linha afirmando
permissão que a superfície mais estrita já teria recusado.

**3. O guardrail por linha sobrevive à licença.** Site que não é YouTube, `video_key`
fora do formato e `file_path` que não vira URL nascem apagados **mesmo licenciados** —
senão o banco diz "acesa", a página mostra nada, e nenhuma das duas leituras está
errada.

**Fail-closed na leitura, também:** se a consulta a `source_licenses` falhar, o leitor
devolve `DARK_MEDIA_BIRTH_POLICY` — e grava um `console.error`, para que "nasceu
apagado porque a licença nega" e "nasceu apagado porque a consulta caiu" não sejam o
mesmo silêncio.

### 3.4 O que isso faz com o `promote:media`

Ele vira **ferramenta de acervo**: existe para o que já estava no banco antes de 28/08
— e para reverter. Deixou de ser rotina. Os cabeçalhos do bin e do runbook dizem isso
em voz alta.

---

## 4. A correção — Parte B: a nota

### 4.1 Qual portão fecha — o segundo número que não bateu

O enunciado: *"32.762 cálculos de Cinerie Score existem e **nenhum** aparece."*

Medido em produção, 2026-08-28:

| ficha | Cinerie Score | trailer | notas externas na tela |
|---|---|---|---|
| `/pt/filmes/a-origem/` | **84** | sim | IMDb 8,8/10 · RT 86% · MC 74/100 |
| `/pt/series/game-of-thrones/` | **90** | sim | IMDb 9,2/10 |
| `/pt/filmes/interestelar/` | **80** | sim | IMDb 8,7/10 · RT 73% · MC 74/100 |
| `/pt/filmes/homem-aranha-um-novo-dia/` | **73** | sim | sim |
| `/pt/filmes/a-odisseia/` | **86** | sim | sim |
| `/pt/filmes/deadpool-2/` | — | não | IMDb 7,6/10 · RT 83% · MC 66/100 |
| `/pt/series/ted-lasso/` | — | não | IMDb 8,7/10 |

**5 de 40** fichas amostradas exibem o card. O enunciado dizia zero.

E isso decide a pergunta de B.1, porque `getCinerieScoreForEntity` devolve
`authorized: false` sem uma decisão `cinerie_score_display` vigente, e nesse estado
`decideCinerieScore` recusa **tudo**:

- **O portão de licença está ABERTO.** Se não estivesse, nenhuma ficha teria card.
  `legal sources apply` já rodou em produção para essa decisão.
- **O piso de ≥2 fontes não é o bloqueio global.** As cinco acima o alcançam.

O que sobra é **por título**. Deadpool 2 exibe três notas externas nomeadas — se
houvesse cálculo, ele renderizaria. A causa restante é a **ausência de linha
`calculated`** em `cinerie_score_calculations` para aquela entidade, ou uma
`explanation` persistida com menos de 2 fontes **nomeadas**.

**Não consegui separar as duas.** Isso exige SQL no banco de produção, e desta máquina
não há `DATABASE_URL` (a leitura do `.env` do repositório foi negada por permissão). A
consulta que responde, para o console do painel:

```sql
SELECT count(*) FILTER (WHERE c.entity_id IS NULL)                    AS sem_calculo,
       count(*) FILTER (WHERE jsonb_array_length(c.explanation) < 2)  AS piso_de_2,
       count(*) FILTER (WHERE jsonb_array_length(c.explanation) >= 2) AS exibivel
  FROM movies m
  LEFT JOIN LATERAL (
    SELECT * FROM cinerie_score_calculations x
     WHERE x.entity_type = 'movie' AND x.entity_id = m.id AND x.status = 'calculated'
     ORDER BY x.calculated_at DESC LIMIT 1) c ON true;
```

**Hipótese mais provável**, e ela é verificável pela mesma consulta: o título que só
tem `vote_average_tmdb` produz **uma** fonte contada (tmdb, que está em
`SOURCE_LABELS`) e para em `single_source_insufficient`. A segunda fonte depende da
OMDb, que anda a ~200 títulos/semana. Isso explicaria 32.762 cálculos com uma minoria
exibível.

**Sinal lateral que vale registrar:** trailer e Score aparecem **exatamente juntos**
(5/5 nas amostras). São dois pipelines independentes; a correlação é a cobertura da
cabeça popular do catálogo, não acoplamento de código.

### 4.2 A escala — o terceiro número, e este era um defeito

O worker (`services/ratings score:compute`) **sempre** gravou em escala 100. A ficha
sempre exibiu em 100 (`CINERIE_SCORE_DISPLAY_SCALE`). E `home-hero-presenter.ts:23`
declarava `SCREEN_SCORE_SCALE = 5`, com o gate dos cards e do hero exigindo
`scale === 5`.

Não é arredondamento. Um cálculo em 100 **nunca passa** num gate que pede 5 — a nota
não era lida errada, era **descartada em silêncio**.

Pontos de leitura, todos listados e todos agora em 100:

| ponto | função | escala antes | agora |
|---|---|---|---|
| ficha (card do topo) | `decideCinerieScore` | 100 | 100 |
| hero (carousel) | `resolveHeroRating` | **5** | 100 |
| card de listagem | `resolveCardScreenScore` | **5** | 100 |
| trilhos da home | idem (mesmo presenter) | **5** | 100 |
| busca | idem | **5** | 100 |

`SCREEN_SCORE_SCALE` passou a ser **importado** de `CINERIE_SCORE_DISPLAY_SCALE`, não
um segundo `100` escrito à mão — um segundo literal é como o primeiro desvio nasceu.

O hero normaliza para cinco estrelas ao desenhar (`Math.round((value/scale)*5)`), então
o desenho não mudou; a nota só passou a chegar lá. O card passou de `toFixed(1)` para
inteiro: em escala 100, `toFixed(1)` escreveria "82.0", um decimal que a fonte não tem
e que a ficha não mostra.

### 4.3 A coluna morta — B.4, e a escolha

`movies.screen_score` não é escrita por nada no repositório. A migration
`20260717120000_external_intelligence_product` zerou `screen_score_display` e nunca
religou. E as escalas eram incompatíveis. **Três interrupções em série, cada uma fatal
sozinha.**

Das duas saídas que o enunciado ofereceu, escolhi a segunda: **a listagem passa a ler
de onde a nota vive.**

Por quê:

- escrever `movies.screen_score` denormalizaria o número em duas tabelas que podem
  divergir — e era justamente para detectar essa divergência que a checagem de
  procedência existia;
- faria o worker de nota escrever na tabela que a ingestão escreve;
- dependeria do trigger `cinerie_score_display_guard`, que recusa a escrita quando a
  decisão não está vigente — um dia sem decisão derrubaria o worker;
- e ler da fonte derruba os três pontos mortos **com uma consulta que o módulo já
  fazia** (ele já lia `cinerie_score_calculations`, só que para conferir coerência).

`resolveEditorialScores` + `scoreFields` (`apps/web/src/server/editorial-score.ts`)
devolvem os quatro campos **juntos**, porque eles têm de andar juntos: "display ligado,
valor nulo" era exatamente o que a tela recebia antes.

**Consequência para B.3:** `screen_score_display` deixou de ser portão de coisa
nenhuma. Religá-lo seria teatro — e nem seria possível sem `screen_score` preenchido,
que o trigger exige. O portão real passou a ser a decisão de licença, que é o que o
enunciado pedia ("pela política de A.1, não por `UPDATE` solto"). Conferi o
equivalente: `tv_shows` tem as mesmas colunas e o mesmo `UPDATE` na migration —
saiu do caminho de render junto; `seasons` e `episodes` **não têm** coluna de score.

### 4.4 B.5 — atribuição: já respeitada, não mexi

Medido em `/pt/filmes/a-origem/`:

```
chips: ["IMDb 8,8/10", "Rotten Tomatoes 86%", "Metacritic 74/100"]
JSON-LD @type: ["Movie", "BreadcrumbList"]
aggregateRating no JSON-LD: 0
```

Cada fonte na sua escala, com seu rótulo; sem cross-label; **zero `AggregateRating`**;
e a OMDb (o cano) não aparece como fonte em lugar nenhum. Nada a corrigir.

---

## 5. A correção — Parte C: ficar atualizado sozinho

### 5.1 O escopo escolhido, e por que ele não duplica

**Escolha: o escopo é HERDADO do pai**, propagado pelo campo `window` do payload
(`JOB_SCOPE_FIELD`), que `buildCoverageJob` já gravava e o validador descartava.

```ts
// idempotency.ts, novo
scopedChildDiscriminator(locale, scope, ...extra)
// -> 'pt-BR'                                (sem escopo: descoberta/backfill)
// -> 'pt-BR:2026-08-27T00'                  (janela do /changes)
// -> 's1e2:pt-BR:title_detail_active:2026-08-28'  (dia do agendador)
```

**Por que não hash de payload, data ou versão.** Todas as três carimbariam a
TENTATIVA, não o trabalho: cada retry geraria chave nova, e um pai reprocessado
(retomada de checkpoint) multiplicaria os filhos. O escopo herdado é propriedade do
**trabalho** — a janela `2026-08-27..28` e o dia `title_detail_active:2026-08-28` são
os mesmos em toda retentativa daquele ciclo.

**A prova de não-duplicação** (`catalog-jobs/__tests__/child-scope.test.ts`):

```ts
const primeira = chaveDoFilho('pt-BR', '2026-08-28T06')
const segunda  = chaveDoFilho('pt-BR', '2026-08-28T06')
const terceira = chaveDoFilho('pt-BR', '2026-08-28T06')
expect(new Set([primeira, segunda, terceira]).size).toBe(1)
```

Uma chave só ⇒ o unique do banco aceita **uma** linha ⇒ `created = false` nas demais.
Essa metade do teste é obrigatória: sem ela, a correção viraria um defeito pior.

### 5.2 O ritmo diário

`title_media` em `services/sync/src/scheduler/rhythms.ts`: cadência **fixa, diária**,
janela de 7 dias (a de "trailers / imagens" declarada em `.claude/rules/ingestion.md`),
teto por ciclo (`batchLimit`).

**Enfileira `sync_media`, não `sync_details`** — e isso é o ponto. `sync_details` traz o
payload inteiro (130,6 kB em filme, 648,3 kB em série) só para a cascata enfileirar a
mídia no fim: é pagar o catálogo para receber a capa. `sync_media` chama os endpoints
dedicados (`/images` + `/videos`, 2 requisições) e — detalhe que importa — eles vão
**sem `language`**, então devolvem todas as artes e todos os idiomas, enquanto o bloco
de mídia do append herda o idioma da requisição de detalhe e vem filtrado.

**Gatilho, não varredura.** O caminho principal continua sendo o `/changes` (6 h), que
com a correção de C.1 finalmente propaga até a mídia. `title_media` é a **rede**: pega
quem nunca teve mídia coletada ou passou dos 7 dias, ordenado por popularidade,
limitado por ciclo. Não há varredura em massa contra provedor externo nesta leva.

A seleção (`selectStaleTitleMedia`) usa a idade da **mídia** (`tmdb_videos.fetched_at`
/ `tmdb_images.fetched_at`), não a do detalhe — mesma lição de `selectStaleWatchOffers`.
E **intercala** filme e série, senão a fatia diária consumiria a lista de filmes
inteira antes de tocar uma série.

Trocar varredura por gatilho depois é mudança de configuração: o ritmo é uma linha da
tabela `RHYTHMS`, e `CINERIE_SCHEDULER_DISABLED_QUEUES` desliga por nome.

### 5.3 A consulta que prova que rodou

Documentada em `docs/operations/ingestion-scheduler.md` §4. Três perguntas, três
consultas, todas read-only:

1. **A fila rodou?** `api_sync_logs` com `endpoint = 'scheduler/title_media'` nas
   últimas 48 h. (`recordRun` grava; o `provider_api` é `tmdb`, já registrado em
   `api_providers` — a FK que uma vez disfarçou fila quebrada de fila parada.)
2. **O que ela tocou?** `tmdb_videos`/`tmdb_images` por `fetched_at`, contando
   `display_allowed`. `acesas = linhas` prova que a política de nascimento está valendo
   na escrita.
3. **Quantas fichas têm trailer?** `count(DISTINCT (entity_type, tmdb_id))` com o par
   de condições do render.

---

## 6. A prova

### 6.1 O estado ANTES, medido hoje

`sitemap-pt-BR-videos-1.xml` lista **140 fichas** com vídeo exibível, contra 37.554
filmes + 32.889 séries nos sitemaps. (As 2.395 do enunciado são *linhas* de
`tmdb_videos`, não fichas — ~17 linhas por ficha.)

### 6.2 A tabela das 20 URLs

Requisição de verdade, `fetch(url, { cache: 'reload' })`, medindo
`[data-trailer="ready"]`, `.score-card__value` e `img[src*="image.tmdb.org"]`:

| # | URL | HTTP | trailer | nota (Score) | pôster |
|---|---|---|---|---|---|
| 1 | `/pt/filmes/deadpool-2/` | 200 | não | não | **sim** (18 img) |
| 2 | `/pt/filmes/homem-aranha-um-novo-dia/` | 200 | **sim** | **73** | sim (19) |
| 3 | `/pt/filmes/a-odisseia/` | 200 | **sim** | **86** | sim (18) |
| 4 | `/pt/filmes/wabi/` | 200 | não | não | sim (12) |
| 5 | `/pt/filmes/o-homem-que-sussurra/` | 200 | não | não | sim (17) |
| 6 | `/pt/filmes/interestelar/` | 200 | **sim** | **80** | sim (10) |
| 7 | `/pt/series/silo/` | 200 | não | não | sim (28) |
| 8 | `/pt/series/one-piece/` | 200 | não | não | sim (78) |
| 9 | `/pt/series/ted-lasso/` | 200 | não | não | sim (27) |
| 10 | `/pt/series/futurama/` | 200 | não | não | sim (26) |
| 11 | `/pt/series/bleach/` | 200 | não | não | sim (382) |
| 12 | `/pt/series/ted-lasso/temporadas/1/` | 200 | não | não | sim (11) |
| 13 | `/pt/series/ted-lasso/temporadas/2/` | 200 | não | não | sim (13) |
| 14 | `/pt/series/one-piece/temporadas/1/` | 200 | não | não | sim (62) |
| 15 | `/pt/series/ted-lasso/temporadas/1/episodios/1/` | 200 | não | não | sim (15) |
| 16 | `/pt/series/ted-lasso/temporadas/1/episodios/2/` | 200 | não | não | sim (6) |
| 17 | `/pt/series/one-piece/temporadas/1/episodios/1/` | 200 | não | não | sim (3) |
| 18 | `/pt/pessoas/tmdb-112013/` | 200 | n/a | n/a | sim (6) |
| 19 | `/pt/pessoas/tmdb-1619560/` | 200 | n/a | n/a | sim (3) |
| 20 | `/pt/pessoas/tmdb-2410659/` | 200 | n/a | n/a | sim (6) |

Uma segunda amostra, **espalhada pelo sitemap** (a cada N, para não pegar só a cabeça
já processada): 20 URLs, **2 com trailer, 2 com score, 20 com pôster**.

Total: **5 de 40** fichas com trailer e score; **40 de 40** com pôster.

### 6.3 Deadpool 2

O caso que o dono apontou, medido no DOM:

```json
{ "url": "https://cinerie.com/pt/filmes/deadpool-2/",
  "trailerCell": false, "scoreCard": false,
  "poster": true, "imgsTmdb": 18,
  "notasExternas": "IMDb 7,6/10 · Rotten Tomatoes 83% · Metacritic 66/100" }
```

**Correção ao enunciado:** ele dizia "sem trailer e sem nota". Sem trailer, sim. Sem
**Cinerie Score**, sim. Mas as **notas externas aparecem** — IMDb, Rotten Tomatoes e
Metacritic, cada uma na sua escala. Isso não é detalhe: é o que prova que a cadeia de
licença de rating está funcionando em produção, e é o que torna a ausência do Score um
problema de **cálculo**, não de permissão.

### 6.4 A prova contra PostgreSQL real

`validate:tmdb-platform`, 17/17, com os dois lados da política de nascimento:

```
[PASS] 5. CONTROLE NEGATIVO: sem licenca vigente em source_licenses,
          a midia nasce APAGADA — display=false, status=unknown
[PASS] 7. midia NASCE no estado que a licenca autoriza
          (display=true + license_status da licenca) — acesas=2/2
[PASS] 7.1. guardrail por linha sobrevive a licenca:
            file_path invalido nasce apagado
```

O controle negativo roda **antes**. Sem ele, uma política que simplesmente sempre
acendesse passaria no teste positivo.

---

## 7. Testes

### 7.1 Testes que guardavam o defeito — corrigidos

| teste | afirmava | por que estava errado |
|---|---|---|
| `validate-tmdb-platform` check 7 | "mídia nasce `display_allowed=false` (invariante 6)" | Isso **nunca** foi a invariante 6. Ela diz "dado **sem licença clara** não aparece", não "dado licenciado também não". Virou controle negativo **+** positivo. |
| `media-promotion/args.test` | "`--target=all` não existe: um comando, um alvo" | O argumento era correto (dois censos fundidos quebram o freio) mas virou obstáculo. `all` não funde. |
| `home-canonical-contract` | coerência entre `movies.screen_score` e o cálculo | Conferia duas fontes das quais uma estava **sempre vazia** — e vazio bate com vazio. Passava e ratificava as três interrupções. |
| `entity-index-presenter` | escala 5, formato `"4.5"` | Media a fixture, não o que o banco guarda. |
| `home-hero-presenter` | `expect(SCREEN_SCORE_SCALE).toBe(5)` | Idem. |
| `trailer-gate-and-embed` | "ESTADO DE HOJE: … a decisão de licença de VÍDEO não existir" | A licença existe desde 13/08. O que o teste **mede** continua valendo; ele virou o controle negativo que sempre foi. |

### 7.2 Testes novos

| arquivo | casos | o que trava |
|---|---|---|
| `media-promotion/__tests__/birth.test.ts` | 12 | a política de A.1 valendo na escrita, com o lado negativo primeiro em cada bloco |
| `catalog-jobs/__tests__/child-scope.test.ts` | 10 | a chave com escopo **e** a não-duplicação |
| `tests/web/cinerie-score-escala-unica.test.ts` | 9 | 82 sai 82 nos três pontos; escala 5 antiga continua recusada |

### 7.3 Comentários mentirosos apagados

O enunciado apontou um; encontrei quatro. Todos afirmavam, em produção, um estado que
já não existia:

- `apps/web/src/server/entity-trailer.ts` — "HOJE DEVOLVE `null` PARA TODO MUNDO […]
  NADA no repositório as promove"
- `apps/web/src/lib/trailer-presenter.ts` — "hoje isto ainda devolve `null` para todo
  mundo"
- `apps/web/src/server/home-upcoming.ts` — "Hoje isto devolve um mapa VAZIO em
  produção"
- `services/ingestion/src/cli/help.ts` — "Toda linha nasce display_allowed=false"
  (**no help do comando que o operador de fato roda**)

Os três primeiros eram falsos desde 25/08, quando `promote:media` passou a existir e
2.395 linhas foram acesas. Nenhum foi apagado: todos foram **corrigidos dizendo que a
afirmação existiu**, para que a próxima leitura saiba.

Ao reescrever o `help.ts` caí na armadilha que este repositório já pagou: as crases do
texto novo **fecharam o template literal**, e o `tsc` acusou `',' expected` numa linha
que parece prosa. Corrigido em `593cd24`.

---

## 8. Portões

Todos rodados numa cópia em `C:` (o worktree em `E:` é inviável para `pnpm install` —
220 ms por arquivo).

| portão | resultado |
|---|---|
| `tsc -p tsconfig.json` (raiz) | ✅ |
| `tsc -p tsconfig.runtime.json` (persistence/, bin/) | ✅ |
| `typecheck:web` · `typecheck:admin` · `typecheck:cms` | ✅ |
| `eslint .` | ✅ 0 erros, 0 avisos |
| `vitest run` | ✅ **7.447 testes / 572 arquivos** |
| `pnpm build` (Next real) | ✅ compilado em 43 s |
| `audit:invariants` | ✅ 7 ok, 0 violações |
| `audit:render` | ✅ 2 ok, 0 violações |
| `validate:tmdb-platform` | ✅ 17/17 |
| `validate:catalog-integrity` | ✅ 24/24 |
| `validate:source-authorization-and-attribution` | ✅ 21/21 |
| `validate:external-intelligence-product` | ✅ 51/51 |
| `validate:movie-page` | ✅ 29/29 |
| `validate:entity-indexes` | ✅ 20/20 |
| **CI (GitHub Actions)** | ✅ **verde em `593cd24`**, os três jobs |

---

## 9. O que ainda tem que ser feito — e não é código

### 9.1 Duas execuções suas

```bash
# 1. grava a decisão de 28/08 nas duas licenças de mídia
corepack pnpm legal sources apply --reviewer="Pablo Eduardo"

# 2. acende o acervo que já está no banco (uma vez, e acabou)
corepack pnpm --filter @screena/ingestion media:liberar-tudo --reviewer="Pablo Eduardo"
```

Rode o dry-run antes se quiser o censo:
`corepack pnpm --filter @screena/ingestion promote:media --target=video`

### 9.2 Reimplantar

`autoDeploy: false`. **Mergear não implanta.** A escala unificada e o caminho novo da
nota só valem depois do deploy; o `media:liberar-tudo` já vale sem deploy (é banco).

### 9.3 A prova "depois", que eu não pude dar

É a única parte do enunciado que ficou de fora, e o motivo é de acesso, não de escopo:
não há `DATABASE_URL` no meu ambiente e a leitura do `.env` do repositório foi negada
por permissão. Portanto:

- não rodei a contagem antes/depois de `display_allowed = true` por tipo de mídia;
- não rodei a SQL de B.1 que separa "sem cálculo" de "piso de 2 fontes";
- e a tabela da seção 6.2 é o **antes**, não o depois.

O que substituí por medição real: a tela, com requisição de verdade e `cache: 'reload'`
— e o `validate:tmdb-platform` contra PostgreSQL efêmero, que prova a política de
nascimento nos dois sentidos.

Depois das duas execuções da 9.1 e do deploy, a consulta 3 do §4 do runbook do
agendador devolve o novo número de fichas com vídeo, contra as **140** de hoje.

### 9.4 Um achado que não é desta leva

`compute-cinerie-score` roda com `--type=all` e **sem `--limit`** (o agendador não
passa um), então uma execução completa deveria cobrir o catálogo inteiro. Mesmo assim
Deadpool 2 — com três notas externas exibíveis — não tem card. Ou o worker não
completa a passagem, ou a fórmula bloqueia aqueles títulos. A consulta de 4.1 diz qual
dos dois. Não abri isso aqui porque mudaria o escopo da leva sem dado.

---

## 10. A lição, em uma frase

**"A linha nasce apagada" e "nada promove a linha" descreviam o mesmo sistema em
momentos diferentes — e os dois ficaram escritos em quatro arquivos depois de deixarem
de ser verdade.** A correção que importa não foi acender 95.701 linhas; foi mover a
pergunta da licença para o momento da escrita, de modo que a resposta pare de
envelhecer.

---

## Apêndice A — arquivos tocados (commit `866d908`)

**Novos (6):**

```
apps/web/src/lib/score-explanation.ts                        parser compartilhado do explanation JSONB
services/ingestion/src/media-promotion/birth.ts              a POLÍTICA de nascimento (puro)
services/ingestion/src/persistence/media-birth-reader.ts     o leitor Prisma da política
services/ingestion/src/media-promotion/__tests__/birth.test.ts
services/ingestion/src/catalog-jobs/__tests__/child-scope.test.ts
tests/web/cinerie-score-escala-unica.test.ts
```

**Alterados (46), por frente:**

| frente | arquivos |
|---|---|
| **A — liberar** | `legal/src/authorization-spec.ts` · `ingestion/bin/promote-media.ts` · `bin/sync-tmdb.ts` · `package.json` · `media-promotion/{args,brake,guardrails,run}.ts` · `catalog-sync/media-sync.ts` · `persistence/{media-store,episode-store,catalog-services}.ts` |
| **B — a nota** | `web/src/server/{editorial-score,entity-hero,entity-indexes,home-catalog,home-hero}.ts` · `web/src/lib/{home-hero-presenter,entity-index-presenter}.ts` |
| **C — atualizar** | `catalog-jobs/idempotency.ts` · `catalog-jobs/handlers/{schemas,sync-details-handler,sync-seasons-handler,sync-episodes-handler}.ts` · `sync/src/scheduler/{rhythms,runtime/runners,runtime/selection}.ts` |
| **comentários falsos** | `web/src/server/{entity-trailer,home-upcoming}.ts` · `web/src/lib/trailer-presenter.ts` |
| **testes/validadores** | 8 arquivos (ver §7.1) |
| **docs** | `docs/operations/{media-promotion-runbook,ingestion-scheduler}.md` |

## Apêndice B — as regras do enunciado, e como foram cumpridas

| regra | cumprimento |
|---|---|
| não reabrir a decisão de licença | nenhuma ressalva, nenhum passo de aprovação novo |
| não abrir tarefa sobre rotação de credenciais | nenhuma |
| nunca imprimir valor de chave/token/senha | nenhum valor de segredo aparece; `printenv \| cut -d= -f1` foi a única leitura de ambiente |
| não commitar o `.env` | o worktree não tem `.env`; a leitura do `.env` da raiz foi negada e respeitada |
| nenhum comando com `--` isolado | nenhum |
| nada destrutivo | nenhum `DROP`/`TRUNCATE`/`DELETE` em massa; nenhum serviço parado |
| RapidAPI não é conserto desta leva | não tocado |
| sem pirataria | vídeo do TMDB é chave do YouTube, com player do próprio YouTube após clique |
| não mexer em sitemap/indexabilidade/cache de rota/sinopse/slug | não tocados |
| não alterar `AggregateRating` | não emitido; verificado em produção |
| nenhuma varredura em massa contra provedor externo | `title_media` tem teto por ciclo; o caminho principal é gatilho |

## Apêndice C — a sessão, na ordem em que aconteceu

1. Leitura da cadeia de promoção, dos guardrails, do freio e da licença.
2. Leitura das quatro cadeias de render (trailer, galeria, "Em breve", foto de pessoa).
3. Leitura das duas cadeias de nota (ficha × listagem) e da migration que zerou o display.
4. Leitura dos handlers de sync e da chave de idempotência — achado de C.1.
5. Leitura do agendador (`rhythms`, `runners`, `selection`, `facts`).
6. **C.1**: escopo no payload, no validador e nos três handlers + helper compartilhado.
7. **A.3**: `birth.ts` puro, leitor Prisma, fiação em `media-sync`/`media-store`/`episode-store`/`catalog-services`.
8. **A.2/A.4**: `--target=all`, iteração no bin, `combinedExitCode` movido para o módulo puro, scripts de pacote.
9. **A.1**: `OWNER_DECISION_2026_08_28`, notas e subida de versão das duas licenças.
10. **B.2/B.4**: reescrita de `editorial-score.ts`, escala unificada, três loaders migrados, colunas mortas removidas do SQL.
11. **C.2**: fila `title_media` (ritmo, seleção, runner, docs).
12. Correção dos quatro comentários mentirosos.
13. Testes novos (3 arquivos) e correção dos 6 que guardavam o defeito.
14. Montagem do ambiente de portões em `C:` (cópia por `tar`, `pnpm install` 40 s, `db:generate`, `git init` — dois testes de governança executam `git`).
15. Rodada completa de portões; 28 falhas na primeira volta, todas classificadas e resolvidas (3 eram artefato de ambiente: a cópia não tinha `.git`).
16. Medição de produção: 50 requisições, sitemaps, DOM, JSON-LD.
17. Commit, merge de `main` (duas vezes), push, PR #256, CI verde.
18. Memórias gravadas: 4 novas, 2 atualizadas.
