# Relatório da PR #258 — ausência não é defasagem

> **Uma linha:** a fila de notas girava a cada 168h porque 168h é o menor
> `refreshAfterHours` das três fontes da OMDb. O relógio estava certo **para a
> pergunta errada** — um título com zero notas não está defasado, ele nunca foi
> perguntado. `now − never` não é um intervalo. A fila só conhecia o trabalho de
> *reatualizar*, então 99,13% do catálogo nunca era selecionado, com o worker
> rodando verde todo dia.

| | |
|---|---|
| **Data** | 2026-08-31 |
| **PR** | [#258](https://github.com/maquinanerd/screena/pull/258) |
| **Branch** | `claude/external-ratings-catalog-31b887` |
| **Base** | `main` @ `8b10ea6` (não avançou durante a sessão) |
| **Commits** | `48deb99` (a leva), `833adbf` (costura por texto), `ecfa1c0` (docs que contradiziam o código) |
| **Diff** | 26 arquivos, 2.338 inserções, 124 remoções |
| **Arquivos novos** | 6 — 2 de código, 3 de teste, 1 de doc (+ 1 validador real) |
| **CI** | **verde** em `ecfa1c0`, run [33417418486](https://github.com/maquinanerd/screena/actions/runs/33417418486) — os três jobs |
| **Testes** | **7.530 passando / 578 arquivos** (delta desta PR: +33 testes, +3 arquivos) |

---

## 0. Como ler este relatório

O enunciado trazia números medidos em produção e a regra da casa é que **o número
manda**. Os números de distribuição bateram. **Três afirmações estruturais do
enunciado não se sustentaram**, e estão nas seções 3.1, 7.1 e 7.2 — duas delas
mudariam o que consertar, e uma delas apontava para um arquivo morto.

Um **quarto defeito**, que não estava no enunciado, apareceu durante a correção e
teria transformado a cadência nova num incidente diário. Está na seção 6.

O que este documento **não** é: prova de que a ficha do Código Vingança mudou.
Ela não mudou, e a seção 9 diz exatamente por quê e o que falta.

---

## 1. O enunciado

Medido no banco de produção em 2026-08-31, distribuição de notas externas por
filme (48.611 filmes):

```
0 notas | 48.187   <-- 99,13%
1 nota  |     43
2 notas |     56
3 notas |    320
6 notas |      5
```

424 filmes têm alguma nota. O card do Cinerie Score exige **duas ou mais** fontes
nomeadas. Logo, no máximo 0,87% dos filmes podem exibir o Score hoje.

O caso apontado: **Código: Vingança** (`Mutiny`, id 7363) tem **quatro** cálculos,
todos `status=calculated`, todos com `jsonb_array_length(explanation)=1`, gravados
em 26, 28, 29 e 31 de agosto, valores 66, 65, 64, 64.

> Leitura correta desse caso, e ela está certa: o worker de score **roda todo dia,
> calcula certo, e produz uma nota de UMA fonte que a tela recusa todo dia**. Não é
> bug de cálculo, não é portão de licença, não é sincronia. É ausência de OMDb.

Três defeitos foram apontados: o relógio de defasagem aplicado à ausência, a ordem
por inserção, e o estouro de cota não reconhecido.

---

## 2. O que eu fiz, em ordem

### 2.1 Li a cadeia inteira antes de tocar em qualquer coisa

`rhythms.ts` → `runners.ts` (`runRatingsOmdb`) → `quota.ts`
(`backgroundOmdbSlots`) → `bin/sync-omdb-ratings.ts` → `omdb/run.ts` →
`persistence/stale-entity-candidates.ts` → `omdb/mapping.ts` →
`api-clients/rapidapi-core/src/http.ts`.

Isso pagou imediatamente: o segundo defeito do enunciado apontava para
`entity-candidates.ts`, e um `grep -rn createPrismaEntityCandidates` mostrou que
esse arquivo **não está no caminho da OMDb** (§7.1).

### 2.2 Confirmei o estado da página antes de acreditar no diagnóstico

`https://cinerie.com/pt/filmes/codigo-vinganca/` — **sem Cinerie Score**. As
strings "IMDb", "Rotten Tomatoes" e "Metacritic" aparecem na página, mas são
`span.footer__credit-text` — créditos estáticos de rodapé, não notas.

### 2.3 Verifiquei de onde vem a única fonte contada

`services/ratings/src/score/compute-run.ts:24` — o TMDB entra por
`vote_average_tmdb`/`vote_count_tmdb` **da própria linha do título**, não de
`external_ratings`. Consequência que importa para esta leva: o Código Vingança tem
**zero linhas** em `external_ratings`, logo cai no conjunto de **cobertura**, não
no de atualização.

---

## 3. A correção — Parte A e B: o relógio e os dois trabalhos

### 3.1 Ausência não é defasagem

A `rationale` da fila dizia, textualmente, que a janela saía de
`RATING_STALE_POLICY` porque 168h é o menor `refreshAfterHours` das três fontes.
**Isso está certo para REATUALIZAR e é irrelevante para COBRIR.**

A selecão unia os dois conjuntos num `NOT EXISTS` só:

```sql
NOT EXISTS (SELECT 1 FROM external_ratings r
             WHERE ... AND r.provider_api = $2
               AND r.fetched_at >= $3)      -- cutoff de frescor
```

Quem nunca foi coletado herdava a janela de quem já tinha dado. Agora são **dois
modos disjuntos** (`services/ratings/src/persistence/stale-entity-candidates.ts`):

| modo | predicado | cutoff |
|---|---|---|
| `coverage` | `NOT EXISTS (qualquer nota, qualquer provider)` | **ignorado** |
| `refresh` | `EXISTS (qualquer nota)` **E** `NOT EXISTS (fresca daquele provider)` | aplicado |

Disjuntos por construção — nenhum título é pago duas vezes no mesmo dia.

> **Por que `coverage` olha QUALQUER provider e não só `omdb`:** "tem nota" é fato
> sobre a **página**, não sobre o cano. Um título com nota vinda de outro provider
> já não está mudo, e mandar a fatia finita atrás dele gastaria cobertura no
> título errado.

### 3.2 O `min()` escondia quem estava limitando

```
backgroundOmdbSlots = min(batchLimit, cota − gasto − reserva)
                    = min(200, 850)
```

Com `batchLimit` no global de **200**, quem limitava era **o relógio do
agendador**, não a cota — 650 requisições/dia sobre a mesa. E havia um **teste
verde** afirmando o contrário (§8.1).

Correção: `intervalHours: 1 * DAY` e teto próprio de **700**
(`OMDB_BACKGROUND_DAILY_ENVELOPE`).

```
antes:  200 / 168h =  28,6/dia
agora:  700 /  24h =    700/dia      →  24,5×
```

**700 e não 849.** A folga de 150 sobre o teto de 850 iguala uma reserva do leitor
inteira — cabe um ciclo de retry sem cruzar o teto do fornecedor. Isso importa
porque **a OMDb não publica cabeçalho de cota nenhum**: não há
`X-RateLimit-Remaining` para conferir, e `api_sync_logs.quota_cost` conta o que
*nós* emitimos, não o que o fornecedor contabilizou. Folga é o único substituto de
observabilidade que existe.

### 3.3 A divisão cobertura/atualização — 85/15, com a conta

```
cobertura   595/dia (85%)
atualização 105/dia (15%)
```

Os 15% **não são proporção estética**:

```
105 req/dia × 7 dias (a janela de 168h) = 735 reatualizações por janela
conjunto coberto hoje ..................... 424 títulos
folga ..................................... 1,7×
```

15% honram a janela de 168h para **todo** título já coberto enquanto o conjunto
coberto couber em **735 títulos**.

**O gatilho de revisão é esse número, não "quando parecer pouco".**
`planOmdbRotation` devolve `refreshWindowFits` para que isso apareça no relatório
em vez de ser descoberto meses depois. Sem medição ele devolve `null` — nunca um
"sim" por omissão. A divisão é configurável (`OMDB_COVERAGE_RATIO`), não literal
enterrado, como o enunciado pediu.

### 3.4 A divisão filme/série — 59/41, revista com número

`perType = Math.floor(slots / 2)` parecia neutro e não era.

```
                    catálogo   sem imdb_id   CONSULTÁVEL   fatia
filmes ..........    48.611        8.114        40.497      58,9%
séries ..........    34.700        6.461        28.239      41,1%
                                                ------
                                                68.736
```

Os conjuntos têm tamanhos diferentes, então fatias iguais terminam a volta em
**dias diferentes** — e quem termina primeiro **não libera a fatia**, porque a
janela de frescor barra a reconsulta. A fatia do tipo menor vira slot ocioso
enquanto o maior ainda tem dezenas de milhares na fila.

Proporcional ao consultável, as duas voltas fecham **no mesmo dia**:

```
cobertura filme .. 350/dia → 40.497 títulos → 116 dias
cobertura série .. 245/dia → 28.239 títulos → 116 dias
```

> **Sobre a cobertura de score 94,5% × 7,6% citada no enunciado:** aquilo mede
> linhas de `cinerie_score_calculations`, cuja entrada dominante é o voto do TMDB
> — não `external_ratings`. Para repartir a cota da **OMDb** o denominador honesto
> é quem a OMDb alcança (tem `imdb_id`). Usar a cobertura de score daria mais cota
> à série por um motivo que a OMDb não resolve.

---

## 4. A correção — Parte C: a ordem editorial

```
1  estreou dentro da janela de exibição (até 90 dias atrás)
2  estreia nos próximos 60 dias
3  série com temporada no ar  (Returning Series, In Production)
4  o resto, por popularity DESC NULLS LAST
5  desempate estável por id ASC
```

**Balde 1 usa 90 dias, não 30:** "estreou nos últimos 30 dias" e "ainda em cartaz"
são o mesmo balde no enunciado, e a corrida de cinema típica cobre os dois em ~90
dias.

**Balde 3 é mais estreito que `AIRING_TV_STATUSES`** (que inclui `Planned` e
`Pilot`): aquele conjunto responde "o detalhe ainda muda?", este responde "tem
episódio no ar?". `Planned` não tem.

**Não há guarda de `NULL`.** Data nula faz as duas primeiras comparações darem
`NULL` (nunca `true`) e a linha cai naturalmente no balde 3 ou 4. Um
`WHEN date IS NULL THEN 4` antecipado mandaria uma série **em exibição** sem data
de estreia para o fim da fila — o oposto do que o balde 3 existe para fazer.

**Custo:** a `CASE` no `ORDER BY` impede uso do índice de `release_date` para
ordenar — vira scan + top-N heapsort. Sobre 48k filmes, num worker **offline**,
são dezenas de ms. O caminho de render (invariante 3) não é tocado. Nenhuma
migration foi necessária: `external_ratings` já tem `@@index([entityType, entityId])`.

---

## 5. A correção — Parte D: o estouro de cota

A OMDb responde **HTTP 200** para todo erro. Para o executor HTTP isso é sucesso:
`consecutiveFailures` não incrementa, o breaker não abre, o lote segue. Um lote de
200 que cruzasse a cota no item 50 fazia as **150 chamadas restantes**, todas
recusadas, todas cobradas.

`services/ratings/src/omdb/error-response.ts` separa três fatos que eram um só:

| `Error` | classe | motivo registrado | lote |
|---|---|---|---|
| `Request limit reached!` / `Daily request limit reached!` | `quota` | `omdb-quota-exhausted` | **PARA** + abre o circuito |
| `Invalid API key!` | `auth` | `omdb-auth-rejected` | **PARA** + abre o circuito |
| `Movie not found!`, `Incorrect IMDb ID.` | `not-found` | `omdb-error-response` | continua |

**A comparação é por substring normalizada (`limit reached`), não igualdade
exata.** A OMDb publica ao menos duas redações para o mesmo fato; uma igualdade
contra a primeira daria **falso** para a segunda — o defeito de volta, agora com
um teste verde por cima. Fonte: [omdbapi/OMDb-API#126](https://github.com/omdbapi/OMDb-API/issues/126)
e [#124](https://github.com/omdbapi/OMDb-API/issues/124).

**Fail-open para `not-found`:** erro desconhecido é tratado como fato sobre o
título e o lote continua. O contrário (desconhecido = cota) abriria o breaker e
mataria o ciclo inteiro por causa de uma redação nova — trocaria uma perda pequena
e recuperável por uma grande.

**O breaker precisou de uma porta nova.** `RapidApiHttpClient.tripCircuit()`:
o executor genérico sabe **abrir** o circuito; quem entende o vocabulário do
fornecedor sabe **quando pedir**. Sem isso, a alternativa seria ensinar o módulo
que existe para *não* conhecer providers a conhecer um.

**O id barrado NÃO vira "sem nota".** Cota é fato sobre o *dia*: ele continua
candidato no ciclo seguinte.

---

## 6. O quarto defeito — a cota era contada DUAS vezes

Não estava no enunciado. Apareceu ao verificar se o envelope de 700 fecharia.

`recordRun` (`scheduler/runtime/facts.ts:225`) grava uma linha de `api_sync_logs`
com `provider_api='omdb'` e `quota_cost = <slots planejados>`. **E** cada filho
`sync-omdb-ratings` grava a sua linha com o custo **real**
(`client.getRequestCount()`). `readSpentToday` soma as duas.

A 200 requisições por **semana** isso nunca encostou em nada. A 700 por **dia**
encostaria todo dia:

```
ciclo gasta 700 reais
api_sync_logs registra 700 (filhos) + 700 (scheduler) = 1.400
readSpentToday devolve 1.400 > 1.000
→ o LEITOR (barrado só quando o teto inteiro acaba) fica sem resposta
  o resto do dia, por cota que ninguém gastou.
```

**A cadência nova transformaria um erro dormente num incidente diário.**

Corrigido: `runRatingsOmdb` passa `requests: 0`. `runAwards`, logo abaixo no mesmo
arquivo, **já fazia isso**, com esta justificativa escrita: *"o custo real aparece
no log da própria CLI, que grava `api_sync_logs` por conta dela"*. `runRatingsOmdb`
era o outlier — o que é evidência de que era bug, não escolha de projeto.

---

## 7. Três afirmações do enunciado que não se sustentaram

### 7.1 `entity-candidates.ts` não está no caminho da OMDb

O enunciado pedia (C.1) substituir `orderBy = { id: 'asc' }` em
`services/ratings/src/persistence/entity-candidates.ts`.

```
$ grep -rn createPrismaEntityCandidates --include=*.ts .
services/ratings/bin/sync-film-show-ratings.ts:219
services/ratings/bin/sync-film-show-ratings.ts:252
```

**Único consumidor: `sync-film-show-ratings.ts`** — o caminho RapidAPI, que a
regra 6 do próprio enunciado declara desativado. Trocar a ordem ali não move uma
linha da OMDb.

A OMDb sempre usou `stale-entity-candidates.ts`, que **já** ordenava por
`popularity DESC NULLS LAST, id ASC` (mudado em 2026-08-21). O que faltava lá era
prioridade **editorial**, não popularidade. Foi onde eu mexi.

### 7.2 `cinerie_score_calculations` já tem dedup

O enunciado (Parte E) afirma: *"grava uma linha nova a cada recálculo, mesmo
quando nada mudou (…) não existe dedup"*.

Existe, e no **banco**, não só no modelo Prisma:

```
packages/db/prisma/migrations/20260717120000_external_intelligence_product/migration.sql:823
CREATE UNIQUE INDEX "cinerie_score_calculations_entity_version_inputs_key"
```
sobre `(entity_type, entity_id, version, inputs_hash)`.

As duas linhas com valor **64** não são recálculo idêntico: têm `inputs_hash`
**diferentes**. O valor é arredondado (`Decimal(6,3)` exibido inteiro) e as
entradas mudaram — tipicamente o `vote_average_tmdb`, que anda todo dia. O
crescimento é de entrada que muda, e não há linha redundante para deduplicar.

### 7.3 O leitor da ficha não pega o cálculo velho

`apps/web/src/server/entity-hero.ts:90-93`:

```ts
const calculation = await prisma.cinerieScoreCalculation.findFirst({
  where: { entityType, entityId, status: "calculated" },
  orderBy: { calculatedAt: "desc" },
  select: { value: true, scale: true, explanation: true },
});
```

Sempre a linha mais recente calculada. A preocupação de E.2 não se aplica.

### 7.4 Um número menor

O enunciado diz "~65.800 títulos consultáveis" na seção PROVA, mas seus próprios
números dão **68.736** (83.311 − 14.575). Usei 68.736 e sinalizo a divergência.

---

## 8. Testes

### 8.1 Testes que guardavam o defeito — corrigidos

**`services/sync/src/scheduler/__tests__/batch-limit.test.ts`** afirmava:

> *"a fila da OMDb NAO ganha teto proprio: ela e limitada por COTA, nao por relogio"*
> com o comentário *"200 esta CERTO para ela"*.

A premissa (`backgroundOmdbSlots` compara com o saldo) é **verdadeira**; a
conclusão **não segue**. O `min(200, 850)` mostra que quem limitava era o teto
global. O teste agora afirma o teto próprio **e** que ele é maior que o global
**e** menor que a cota — as três coisas, para não passar por acidente.

**`services/ratings/src/omdb/__tests__/args-and-gate.test.ts`** — `mode: null` no
default (`null` = não informado; o CLI aplica `refresh`, e o parser não escolhe
sozinho, para que "o agendador não passou o modo" continue distinguível de
"pediram refresh").

### 8.2 Testes novos (+33 testes, 3 arquivos)

| arquivo | testes | o que mede |
|---|---:|---|
| `packages/config/src/__tests__/omdb-rotation.test.ts` | 13 | a soma das fatias é **exatamente** o envelope (varrendo 0…1000, porque arredondamento só quebra nos restos); filme ≠ metade de série; a janela de 168h fecha |
| `services/ratings/src/omdb/__tests__/quota-exhaustion.test.ts` | 15 | quantos ids foram **realmente consultados** depois da recusa |
| `services/ratings/src/omdb/__tests__/scheduler-argv-seam.test.ts` | 5 | o argv que o agendador spawna é aceito pelo filho |

**Todo caso positivo tem controle negativo.** Sem eles:
- um classificador que devolvesse `quota` para tudo passaria no teste positivo — e
  abriria o breaker em cima de um "Movie not found!";
- `refreshWindowFits` poderia ser `true` constante;
- um `movieShare` de volta a `0.5` passaria despercebido.

### 8.3 A costura por TEXTO (commit `833adbf`)

`runRatingsOmdb` monta um array de strings e spawna o worker como **processo
filho**. Entre os dois **não há tipo**.

Renomear `--mode`, mudar o vocabulário de `OmdbRotationMode` ou apertar uma
validação do parser **não quebra o typecheck e não quebra nenhum teste de unidade
dos dois lados** — cada um continua correto sozinho. Quebra em produção, no
primeiro ciclo, com o painel dizendo apenas `omdb_child_failed`.

O teste monta o argv exatamente como o runner monta e exige que os valores
**cheguem** — não só que o parse retorne `ok`. Um parser que engolisse `--mode` e
deixasse `mode` nulo rodaria atualização no lugar de cobertura em silêncio.

### 8.4 A ordem, medida contra PostgreSQL real

O enunciado foi explícito: *"o teste tem que medir a ORDEM RESULTANTE, não a
existência da cláusula — um teste que faz grep no SQL não distingue mundo nenhum"*.

`services/ratings/scripts/validate-omdb-candidate-order-real-postgres.ts` sobe um
PostgreSQL 16 efêmero, roda `migrate deploy` + `db seed`, planta 8 filmes e 4
séries com datas e popularidades **escolhidas para que a ordem editorial discorde
tanto de `id ASC` quanto de `popularity DESC` puro**, e afirma a sequência que
volta. **Saída do CI:**

```
    ordem devolvida: estreou-e-popular > estreou-ontem > estreia-proxima >
                     antigo-popularissimo > sem-data > estreia-longinqua >
                     saiu-de-cartaz > antigo-obscuro
[PASS] 7. CONTROLE NEGATIVO: NAO e `id ASC` — sob id ASC o 1o seria
          "antigo-popularissimo"; veio "estreou-e-popular"
[PASS] 8. CONTROLE NEGATIVO: NAO e `popularity DESC` puro —
          "antigo-popularissimo" (pop 9999) ficou na posicao 4
    ordem devolvida (tv): estreou-agora > no-ar-sem-data > encerrada-popular > planejada
RESUMO: 16/16 checks OK.
```

Também prova a partição (cobertura exclui quem tem nota; atualização só a
vencida; interseção vazia) e que **a cobertura ignora a janela de frescor** — o
defeito original, nomeado no check 16.

O validador falha se rodar **menos** checks que o esperado: um validador que morre
no meio não passa.

---

## 9. A prova — o que eu posso e o que eu não posso afirmar

### 9.1 O estado ANTES, medido hoje

```json
{ "temCinerieScore": false, "temIMDb": true, "temRottenTomatoes": true, "temMetacritic": true }
```

As três marcas na página são `span.footer__credit-text` — créditos estáticos, não
notas. **Sem Score.** O enunciado está certo.

### 9.2 O que eu NÃO posso provar

**A ficha do Código Vingança com o Score. Ela não mudou, e não podia.** Faltam
duas coisas que não estão no meu alcance:

1. **Deploy.** `autoDeploy: false` — mergear não implanta.
2. **Um ciclo real da fila**, com `--apply`, contra a OMDb de produção. A regra 7
   do enunciado proíbe varredura em massa nesta leva, e com razão.

Purgar o cache da Cloudflare também não está no meu alcance, e não adiantaria:
não há o que purgar enquanto o dado não existir.

### 9.3 A previsão, fundamentada — e por que é previsão, não prova

O Código Vingança:

- tem `imdb_id` (`tt32338669`) → **alcançável** pela OMDb;
- tem **zero** linhas em `external_ratings` (a única fonte contada é o TMDB, que
  vem da própria linha do título — §2.3) → cai em **cobertura**;
- `release_date` dentro da janela → **balde 1** (ou 2, se a data que vale for a
  estreia BR de 10/09).

Logo: **entre os primeiros candidatos do primeiro ciclo de cobertura.** Uma
requisição traz IMDb + Rotten Tomatoes + Metacritic; com o TMDB são **4 fontes
contadas**, contra o piso de 2 (`MINIMUM_COUNTED_SOURCES`).

Isso é raciocínio sobre código e dados medidos. **Não é a ficha na tela**, e eu
não vou apresentar como se fosse.

### 9.4 As contas que o enunciado pediu

| pergunta | resposta |
|---|---|
| slots/dia reais | **700** (era 28,6) |
| volta completa, 68.736 consultáveis | **116 dias** (era 6,6 anos) |
| filme / série | 350 / 245 por dia — as duas voltas fecham juntas |
| atualização cabe na janela? | sim, 735 de capacidade contra 424 cobertos |

---

## 10. O que ainda tem que ser feito — e não é código

### 10.1 Mergear e reimplantar

Mergeado ≠ implantado. Depois do merge, subir o release; a fila só muda de
comportamento quando o novo código estiver rodando no `screen-cron`.

### 10.2 As consultas de "depois"

O banco não é alcançável desta máquina (`rss_prime_screen-db` é hostname interno
do Docker). Painel → `rss_prime` → `screen-db` → `>_` → **Bash** →
`psql -U screena -d screena`. A aba "Postgres Client" não serve.

Todas as consultas estão em
[`docs/operations/omdb-coverage-and-quota.md`](docs/operations/omdb-coverage-and-quota.md) §6:

- **6.1** cota gasta e recusada hoje (Parte D.4) — `ciclos_cortados_por_cota > 0`
  significa que o **fornecedor** recusou enquanto o nosso contador achava que
  havia saldo: o único sinal de que `quota_cost` subconta o consumo real;
- **6.2** distribuição de notas por filme (a tabela do enunciado, para o "depois");
- **6.3** total de `external_ratings`;
- **6.4** os 20 primeiros candidatos da nova ordem, com título e data;
- **6.5** crescimento de `cinerie_score_calculations` (Parte E.1);
- **6.6** por que faltam `imdb_id` (Parte F.1).

### 10.3 O piso real do problema (Parte F.2)

A consulta 6.6 divide os 14.575 em dois grupos com ações opostas:

- `nunca_sincronizado` → **recuperável**: rodar o detalhe traz o id. É a fila
  `title_detail_*`, não esta.
- `tmdb_nao_tem` → **piso real**: o TMDB não conhece o IMDb id, e a OMDb consulta
  **só** por IMDb id — não há busca por TMDB id, e a doc confirma que não há
  change feed nem lote. Nenhuma cadência conserta esses.

Não dá para dividir os dois sem o banco. É a última medição que falta.

### 10.4 Retenção de `cinerie_score_calculations` — Parte E.3, não implementada

**Deliberado.** O dedup por `inputs_hash` já existe (§7.2), então não há linha
redundante para deduplicar. Com 50.207 linhas e índices em `(entity_type,
entity_id)` e `calculated_at`, a leitura da ficha é um index scan.

**Recomendação, quando virar problema:** retenção por idade (`DELETE WHERE
calculated_at < now() - interval '180 days'`, preservando a mais recente por
entidade). Custo baixo, preserva histórico recente, sem coluna nova.

`is_current` custaria coluna + backfill + trigger (ou transação de dois passos)
para resolver um problema de **leitura** que o `ORDER BY calculated_at DESC` já
resolve. Não recomendo.

Qualquer um dos dois exige **tarefa aprovada para banco** (CLAUDE.md §10).

### 10.5 Documentos que afirmavam o oposto do código (commit `ecfa1c0`)

`ingestion-scheduler.md` declarava a fila "semanal" e, duas seções abaixo, teto
"200 (global)" com o limitante anotado como "cota" — as duas não podiam estar
certas ao mesmo tempo, e a que o operador lia primeiro era a errada.
`midia-notas-e-atualizacao-diaria.md` citava "7 dias" e concluía que **estar
agendado bastava**.

Estar agendado nunca bastou. Ambos corrigidos e apontando para o doc novo.

---

## 11. Portões

| portão | resultado |
|---|---|
| `pnpm typecheck` (+ `typecheck:catalog-runtime`) | ✅ |
| `pnpm lint` | ✅ |
| `pnpm test` | ✅ **7.530 / 578 arquivos** |
| `pnpm build` | ✅ |
| `pnpm audit:invariants` | ✅ 7 ok, 0 violações |
| `pnpm audit:render` | ✅ 2 ok, 0 violações |
| `validate:omdb` | ✅ 27/27 |
| `validate:external-intelligence-product` | ✅ 51/51 |
| **`validate:omdb-order`** (novo, no CI) | ✅ **16/16** |
| **CI** em `ecfa1c0` | ✅ **os três jobs** (job grande: 33m59s) |

**Prettier:** os 6 arquivos de serviço tocados **já falhavam `--check` em `HEAD`**
(verificado contra `git show HEAD:<arquivo>`). O CI roda eslint, não prettier.
Rodar `--write` produziria um diff de centenas de linhas sem relação com a leva.
Não mexi.

---

## 12. Governança

- **Invariante 1** — IMDb ≠ Rotten Tomatoes. Nenhuma escala convertida, nenhum
  rótulo cruzado. O mapper continua recusando divergência de escala em vez de
  converter.
- **Invariante 2** — `provider_api` (`omdb`, o cano) ≠ `rating_source`
  (`imdb`/`rotten_tomatoes`/`metacritic`, a fonte). O validador de ordem insere
  com os dois separados e o trigger `external_ratings_integrity_guard_trg` os
  confere.
- **Invariante 3/4** — nada tocado no caminho de render; `audit:render` verde.
- **Invariante 6** — nenhuma mudança em licença ou `display_allowed`. A seleção
  olha **existência** de nota, nunca exibição.
- **Sem `AggregateRating`** fabricado, sem fonte inventada para completar duas, e
  o piso de `MINIMUM_COUNTED_SOURCES = 2` **não** foi tocado.
- **Sem mudança de schema/migration.** Nenhum índice novo foi necessário.
- **Zero chamadas reais à OMDb** nesta leva. Nenhuma chave impressa; nenhum `.env`
  commitado.
- **Nenhum serviço parado ou reiniciado.**

---

## 13. A lição, em uma frase

> **Uma janela de frescor aplicada a quem nunca foi consultado torna o conjunto
> inteiro invisível — e o painel fica verde o tempo todo, porque o trabalho que
> ele mede é o único que a fila sabe fazer.**

Corolário operacional: sempre que existir janela de frescor sobre um conjunto,
pergunte se ela está sendo aplicada à **ausência**. Se o predicado de seleção
mistura "nunca coletado" com "coletado há tempo" numa condição só, ele quase
certamente está errado — e o conserto é **separar em modos disjuntos**, nunca
afrouxar a janela.

---

## Apêndice A — arquivos tocados

**Código novo (2)**
- `packages/config/src/omdb-rotation.ts` — a política de repartição (pura)
- `services/ratings/src/omdb/error-response.ts` — o classificador do erro da OMDb

**Testes novos (3)** — `omdb-rotation.test.ts`, `quota-exhaustion.test.ts`,
`scheduler-argv-seam.test.ts`

**Validador novo (1)** — `validate-omdb-candidate-order-real-postgres.ts`

**Doc novo (1)** — `docs/operations/omdb-coverage-and-quota.md`

**Modificados (19)**

| arquivo | o quê |
|---|---|
| `services/sync/src/scheduler/rhythms.ts` | 7 dias → 1 dia; teto próprio 700; `rationale` corrigida |
| `services/sync/src/scheduler/runtime/runners.ts` | 2 lotes → 4; `requests: 0` (dupla contagem) |
| `services/ratings/src/persistence/stale-entity-candidates.ts` | modos disjuntos + ordem editorial |
| `services/ratings/src/omdb/run.ts` | aborta por recusa do fornecedor; `errorCode` no log |
| `services/ratings/src/omdb/mapping.ts` | três motivos distintos onde havia um |
| `services/ratings/src/omdb/types.ts` | `omdb-quota-exhausted`, `omdb-auth-rejected` |
| `services/ratings/src/omdb/args.ts` | `--mode=coverage\|refresh` |
| `services/ratings/src/ports.ts` | `mode` e `now` no contrato de seleção |
| `services/ratings/bin/sync-omdb-ratings.ts` | injeta modo e `tripProviderCircuit` |
| `api-clients/rapidapi-core/src/http.ts` | `tripCircuit()` |
| `api-clients/omdb/src/client.ts` | expõe `tripCircuit()` |
| `packages/config/src/index.ts`, `services/ratings/package.json`, `.github/workflows/ci.yml` | registro |
| `batch-limit.test.ts`, `args-and-gate.test.ts` | testes que guardavam o defeito |
| `CLAUDE.md`, `ingestion-scheduler.md`, `midia-notas-e-atualizacao-diaria.md` | ponteiros e correções |

## Apêndice B — as regras do enunciado

| regra | cumprida |
|---|---|
| 1. Nada sobre rotação de credenciais | ✅ não mencionado |
| 2. Nunca imprimir chave/token | ✅ nenhum valor impresso; nenhum `SELECT *` em `api_providers` |
| 3. Não commitar `.env` | ✅ |
| 4. Nenhum comando com dois hifens isolados | ✅ |
| 5. Nada destrutivo | ✅ nenhum DROP/TRUNCATE/DELETE; nenhum serviço parado |
| 6. RapidAPI não é mais usado | ✅ não mexi — e foi o que revelou §7.1 |
| 7. Nenhuma varredura em massa contra a OMDb | ✅ **zero** chamadas reais; a string de cota veio da doc/issues |
