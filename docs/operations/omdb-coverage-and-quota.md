# A nota externa no catálogo inteiro — o relógio, a ordem, o estouro

> Operação da fila `ratings_omdb`. Leia antes de mexer em cadência, em ordem de
> candidato ou em cota da OMDb.
>
> Medições de produção citadas aqui: **2026-08-31**. Números derivados do código
> foram calculados com `planOmdbRotation`/`backgroundOmdbSlots` reais, não a mão.

---

## 1. O que estava errado (três defeitos em série)

| # | Defeito | Onde | Efeito medido |
| --- | --- | --- | --- |
| 1 | A janela de frescor aplicada à **ausência** | `rhythms.ts` (`ratings_omdb`, `7 * DAY`) | 99,13% dos filmes sem nota com o worker rodando verde |
| 2 | O teto global de 200 mascarado de "limite de cota" | `rhythms.ts` (`batchLimit: null`) | 650 requisições/dia sobre a mesa |
| 3 | Estouro de cota não reconhecido | `omdb/mapping.ts` | lote seguia depois do teto; cada chamada cobrada, nenhuma trazendo nota |

**O defeito 1 é o principal, e não é de cadência — é de conjunto.** Um título com
zero notas não está *defasado*; ele nunca foi perguntado. `now − never` não é um
intervalo. A fila só conhecia o trabalho de **reatualizar**, e por isso o
trabalho de **cobrir** nunca era selecionado.

Um quarto defeito apareceu durante o conserto e está descrito na seção 5:
a cota da OMDb era **contada duas vezes**.

---

## 2. A cadência nova, e quantos slots ela entrega de verdade

```
cota diária OMDb ................. 1.000   (plano gratuito; OMDB_QUOTA.perDay)
reserva do leitor ................   150   (ON_DEMAND_RESERVE, 15%)
teto da cota ..................... 850
batchLimit da fila ............... 700     (OMDB_BACKGROUND_DAILY_ENVELOPE)
intervalHours .................... 24 h
--------------------------------------------------
slots/dia REAIS .................. 700
```

**Antes: 200 a cada 168 h = 28,6/dia. Agora: 700/dia. Fator 24,5×.**

`backgroundOmdbSlots` devolve `min(batchLimit, cota − gasto − reserva)`. O `min`
é o ponto: com `batchLimit` no global de **200**, quem limitava era o relógio do
agendador, **não a cota** — apesar de a `rationale` da fila afirmar o contrário.
Por isso a fila ganhou teto próprio (700), que é a regra declarada em
`effectiveBatchLimit`: teto próprio existe onde o limitante é diferente.

**700 e não 849.** A folga de 150 sobre o teto de 850 iguala uma reserva do
leitor inteira — cabe um ciclo de retry sem cruzar o teto do fornecedor. A folga
é o único substituto de observabilidade que existe aqui: **a OMDb não publica
nenhum cabeçalho de cota** (`X-RateLimit-*` não existe; medido). Subir para 800
compraria ~12 dias de volta e derrubaria a folga a um terço disso.

---

## 3. A divisão do dia

### Cobertura × atualização — 85 / 15

```
cobertura ..... 595/dia   (título com ZERO notas; ignora janela de frescor)
atualização ... 105/dia   (título com nota vencida; RATING_STALE_POLICY, 168 h)
```

A conta que fixa os 15% **não é uma proporção estética**:

```
105 req/dia × 7 dias (a janela de 168 h) = 735 reatualizações por janela
conjunto coberto hoje ...................... 424 títulos
folga ...................................... 1,7×
```

Ou seja: 15% honram a janela de 168 h para **todo** título já coberto enquanto o
conjunto coberto couber em **735 títulos**.

**O gatilho de revisão é esse número, não "quando parecer pouco".**
`planOmdbRotation` devolve `refreshWindowFits` para que isso apareça no
relatório em vez de ser descoberto meses depois. A divisão é configurável
(`OMDB_COVERAGE_RATIO`), não literal enterrado.

### Filme × série — 58 / 42, não metade a metade

**Medido no banco em 2026-08-31** (o enunciado dizia 8.114 / 6.461; a medição
direta devolveu 3.314 títulos a mais sem `imdb_id`):

```
                    catálogo   sem imdb_id   CONSULTÁVEL   fatia
filmes ..........    48.611       10.660        37.951      58,0%
séries ..........    34.700        7.229        27.471      42,0%
                                                ------
                                                65.422
```

`perType = Math.floor(slots / 2)` parecia neutro e não era. Os conjuntos têm
tamanhos diferentes, então fatias iguais terminam a volta em **dias diferentes**
— e quem termina primeiro **não libera a fatia**, porque a janela de frescor
barra a reconsulta. A fatia do tipo menor vira slot ocioso enquanto o maior
ainda tem dezenas de milhares na fila.

Proporcional ao consultável, as duas voltas fecham no mesmo dia:

```
cobertura filme .. 345/dia → 37.951 títulos → 111 dias
cobertura série .. 250/dia → 27.471 títulos → 110 dias
```

> **Nota sobre a cobertura de score 94,5% × 7,6%** citada no enunciado: aquilo
> mede *linhas de `cinerie_score_calculations`*, cuja entrada dominante é o voto
> do TMDB — não `external_ratings`. Para repartir a cota da OMDb o denominador
> honesto é **quem a OMDb alcança** (tem `imdb_id`), e é ele que está na tabela
> acima. Usar a cobertura de score aqui daria mais cota à série por um motivo
> que a OMDb não resolve.

---

## 4. A ordem editorial

```
1  estreou dentro da janela de exibição (até 90 dias atrás)
2  estreia nos próximos 60 dias
3  série com temporada no ar  (Returning Series, In Production)
4  o resto, por popularity DESC NULLS LAST
5  desempate estável por id ASC
```

O balde 1 usa **90 dias**, não 30: "estreou nos últimos 30 dias" e "ainda em
cartaz" são o mesmo balde no enunciado, e a corrida de cinema típica cobre os
dois em ~90 dias.

O balde 3 usa um conjunto **mais estreito** que o `AIRING_TV_STATUSES` de
`@screena/sync` (que inclui `Planned` e `Pilot`): aquele responde "o detalhe
ainda muda?", este responde "tem episódio no ar?". `Planned` não tem.

**Onde a ordem mora:** `services/ratings/src/persistence/stale-entity-candidates.ts`.

> **`entity-candidates.ts` NÃO é esse arquivo.** Ele tem `orderBy: { id: 'asc' }`
> e alimenta **apenas** `sync-film-show-ratings.ts` — o caminho RapidAPI, que o
> dono desativou. Trocar a ordem lá não move uma linha da OMDb. Ver seção 7.

**Como isso é guardado:** `pnpm --filter @screena/ratings validate:omdb-order`
sobe um PostgreSQL 16 efêmero, planta títulos com datas conhecidas e afirma a
**sequência que volta** — não o texto do SQL. Dois controles negativos garantem
que o teste distingue mundo: o título mais popular (`popularity 9999`) **não**
pode vir primeiro, e o primeiro id inserido **não** pode vir primeiro. Roda no CI.

---

## 5. O estouro de cota, reconhecido

A OMDb responde **HTTP 200** para todo erro, com `Response:"False"` e um campo
`Error`. Para o executor HTTP isso é sucesso: `consecutiveFailures` não
incrementa e o breaker não abre.

Agora `classifyOmdbError` (`services/ratings/src/omdb/error-response.ts`) separa
três fatos que eram um só:

| `Error` | classe | motivo registrado | lote |
| --- | --- | --- | --- |
| `Request limit reached!` / `Daily request limit reached!` | `quota` | `omdb-quota-exhausted` | **PARA** + abre o circuito |
| `Invalid API key!` | `auth` | `omdb-auth-rejected` | **PARA** + abre o circuito |
| `Movie not found!`, `Incorrect IMDb ID.` | `not-found` | `omdb-error-response` | continua |

A comparação é por **substring normalizada** (`limit reached`), não igualdade
exata: a OMDb publica ao menos duas redações para o mesmo fato, e uma igualdade
contra a primeira daria falso para a segunda — o defeito de volta, com teste
verde por cima.

O id barrado **não vira "sem nota"**. Cota é fato sobre o *dia*: ele continua
candidato no ciclo seguinte.

### O quarto defeito: cota contada duas vezes

`recordRun` grava uma linha de `api_sync_logs` com `provider_api='omdb'` e
`quota_cost = <slots planejados>`, **e** cada filho `sync-omdb-ratings` grava a
sua linha com o custo **real**. `readSpentToday` somava as duas.

A 200 requisições por semana isso nunca encostava em nada. A 700 por dia
encostaria **todo dia**: `spentToday` leria ~1.400 depois de um ciclo de 700, e
o **leitor** — que só é barrado quando o teto inteiro acaba — ficaria sem
resposta pelo resto do dia por causa de cota que ninguém gastou.

Corrigido: `runRatingsOmdb` passa `requests: 0`, como `runAwards` já fazia, com
a mesma justificativa — **o filho é a única autoridade sobre quanto se gastou**.

---

## 6. Consultas de verificação (rodar no painel → `screen-db` → `>_` → **Bash**)

> A aba "Postgres Client" **não serve**: ela conecta como role `postgres`, que não
> existe nesse cluster. Tem que ser **Bash** + `psql -U screena -d screena`.

### 6.1 Cota gasta e recusada hoje (PARTE D.4)

```sql
SELECT
  COALESCE(SUM(quota_cost), 0)                                   AS gasto_hoje,
  COUNT(*) FILTER (WHERE error_code = 'omdb-quota-exhausted')    AS ciclos_cortados_por_cota,
  COUNT(*) FILTER (WHERE error_code = 'omdb-auth-rejected')      AS ciclos_cortados_por_credencial,
  COUNT(*) FILTER (WHERE status = 'aborted')                     AS ciclos_abortados
FROM api_sync_logs
WHERE provider_api = 'omdb'
  AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC');
```

`gasto_hoje` é a mesma soma que `readSpentToday` usa para decidir os slots.
`ciclos_cortados_por_cota > 0` significa que **o fornecedor** recusou enquanto o
nosso contador ainda achava que havia saldo — o único sinal de que `quota_cost`
subconta o consumo real.

### 6.2 Distribuição de notas por filme (PROVA 3)

```sql
SELECT n_notas, COUNT(*) AS filmes
FROM (
  SELECT m.id, COUNT(r.id) AS n_notas
    FROM movies m
    LEFT JOIN external_ratings r
      ON r.entity_type = 'movie' AND r.entity_id = m.id
   GROUP BY m.id
) t
GROUP BY n_notas
ORDER BY n_notas;
```

### 6.3 Total de `external_ratings` (PROVA 2)

```sql
SELECT provider_api, rating_source, COUNT(*)
  FROM external_ratings
 GROUP BY ROLLUP (provider_api, rating_source)
 ORDER BY 1, 2;
```

### 6.4 Os 20 primeiros candidatos da nova ordem (PROVA 4)

É a mesma cláusula que `stale-entity-candidates.ts` monta, em modo de leitura:

```sql
SELECT m.title_original, m.release_date, m.popularity,
       CASE
         WHEN m.release_date >= (CURRENT_DATE - 90) AND m.release_date <= CURRENT_DATE THEN 1
         WHEN m.release_date >  CURRENT_DATE AND m.release_date <= (CURRENT_DATE + 60) THEN 2
         ELSE 4
       END AS balde
  FROM movies m
 WHERE m.imdb_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM external_ratings r
                    WHERE r.entity_type = 'movie' AND r.entity_id = m.id)
 ORDER BY balde, m.popularity DESC NULLS LAST, m.id ASC
 LIMIT 20;
```

### 6.5 Crescimento de `cinerie_score_calculations` (PARTE E.1)

```sql
SELECT calculated_at::date AS dia, COUNT(*) AS linhas
  FROM cinerie_score_calculations
 WHERE calculated_at >= now() - interval '15 days'
 GROUP BY 1 ORDER BY 1;
```

### 6.6 Por que faltam `imdb_id` (PARTE F.1)

Distingue **"o TMDB não tem o id"** de **"a sincronia de detalhe não rodou"**:
`imdb_id` só é preenchido pelo sync de **detalhe** (`normalizers/movie.ts:79`,
`tv.ts:72`), a partir de `detail.imdb_id ?? detail.external_ids.imdb_id`.
Título que só passou pela descoberta de ids nunca teve o campo escrito.

```sql
SELECT 'movie' AS tipo,
       COUNT(*) FILTER (WHERE imdb_id IS NULL AND last_synced_at IS NULL)     AS nunca_sincronizado,
       COUNT(*) FILTER (WHERE imdb_id IS NULL AND last_synced_at IS NOT NULL) AS tmdb_nao_tem,
       COUNT(*) FILTER (WHERE imdb_id IS NULL)                                AS total_sem_imdb
  FROM movies
UNION ALL
SELECT 'tv',
       COUNT(*) FILTER (WHERE imdb_id IS NULL AND last_synced_at IS NULL),
       COUNT(*) FILTER (WHERE imdb_id IS NULL AND last_synced_at IS NOT NULL),
       COUNT(*) FILTER (WHERE imdb_id IS NULL)
  FROM tv_shows;
```

- `nunca_sincronizado` → **recuperável**: rodar o detalhe traz o id.
- `tmdb_nao_tem` → **piso real**: o TMDB não conhece o IMDb id, e a OMDb
  consulta **só** por IMDb id (não há busca por TMDB id). Nenhuma cadência
  conserta esses.

#### O resultado medido em 2026-08-31 — o balde recuperável está VAZIO

```
 tipo  | nunca_sincronizado | tmdb_nao_tem | total_sem_imdb
-------+--------------------+--------------+----------------
 tv    |                  0 |         7229 |           7229
 movie |                  0 |        10660 |          10660
```

**`nunca_sincronizado = 0` nos dois tipos.** Todos já passaram pelo sync de
detalhe, então não há nada a recuperar rodando o detalhe de novo.

E o extrator não é o culpado — foi a primeira hipótese e ela não se sustenta:

| verificação | resultado |
| --- | --- |
| `external_ids` está no append de filme? | sim, `MOVIE_APPEND` |
| `external_ids` está no append de série? | sim, `TV_APPEND` |
| o normalizador de filme lê? | `detail.imdb_id ?? detail.external_ids?.imdb_id` |
| o normalizador de série lê? | `detail.external_ids?.imdb_id` (série não tem no topo) |

Pedimos, recebemos e lemos. **O TMDB simplesmente não tem o id para eles** — o
que é plausível para uma base montada a partir dos Daily ID Exports, que incluem
uma cauda longa de títulos obscuros sem vínculo com o IMDb.

**Portanto: 17.889 títulos (21,5% do catálogo) nunca poderão ter nota externa via
OMDb, com qualquer cadência.** Este é o piso real do problema, e ele só muda com
uma fonte que resolva por TMDB id — não com mais cota nem com mais frequência.

---

## 7. Coisas que parecem verdade e não são

- **"A ordem da OMDb é `id ASC`."** Não é, e não era. `entity-candidates.ts` tem
  `id ASC`, mas alimenta só o caminho **RapidAPI** (desativado). A OMDb sempre
  usou `stale-entity-candidates.ts`, que já ordenava por `popularity DESC`.
  O que faltava lá era **prioridade editorial**, não popularidade.

- **"`cinerie_score_calculations` grava uma linha a cada recálculo, mesmo sem
  mudança."** Não grava. Existe
  `UNIQUE (entity_type, entity_id, version, inputs_hash)` — índice real, na
  migration `20260717120000`, não só no modelo Prisma. Duas linhas com o mesmo
  **valor** (ex.: 64 e 64) têm `inputs_hash` **diferentes**: o valor é
  arredondado e as entradas mudaram. O crescimento é de entrada que muda
  (tipicamente o voto do TMDB, diário), não de recálculo idêntico.

- **"O leitor da ficha pode pegar o cálculo velho."** Não pode:
  `apps/web/src/server/entity-hero.ts:90-93` faz
  `findFirst({ where: { status: 'calculated' }, orderBy: { calculatedAt: 'desc' } })`.
  Sempre a linha mais recente calculada.

- **"O limite real é a cota, não o relógio."** Era o que a `rationale` da fila
  dizia, e era falso por 24,5×. Ver seção 2.

---

## 8. O que ficou de fora, e por quê

- **Retenção de `cinerie_score_calculations`.** Não implementada. O dedup por
  `inputs_hash` já existe (seção 7), então a tabela cresce só quando uma entrada
  realmente muda — não há linha redundante para deduplicar. Com 50.207 linhas e
  índice em `(entity_type, entity_id)` e em `calculated_at`, a leitura da ficha
  é um index scan e não há problema de desempenho a resolver hoje.
  **Recomendação, quando virar problema:** retenção por idade
  (`DELETE WHERE calculated_at < now() - interval '180 days'` preservando a
  linha mais recente por entidade) — custo baixo, preserva o histórico recente
  e não exige coluna nova. `is_current` seria mais caro (coluna + backfill +
  trigger ou transação de dois passos) e resolveria um problema de leitura que
  o `ORDER BY calculated_at DESC` já resolve.
  Precisa de tarefa aprovada para banco (CLAUDE.md, seção 10).

- **Backfill de `imdb_id`.** Os títulos `nunca_sincronizado` da consulta 6.6 são
  recuperáveis por sync de detalhe, mas isso é a fila `title_detail_*`, não esta.

- **Medições de produção.** O banco não é alcançável desta máquina
  (`rss_prime_screen-db` é hostname interno do Docker). Todo "antes/depois" passa
  pelas consultas da seção 6, rodadas no console do painel.
