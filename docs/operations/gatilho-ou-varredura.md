# Gatilho ou varredura — o que cada fonte entrega, quando buscar, e qual desenho cabe

> **Auditoria (PROMPT 9).** Nenhuma linha de comportamento alterada. Nenhuma escrita em
> produção, nenhum `--apply`, nenhuma varredura.
>
> **Commit auditado:** `ae495bd` · branch `claude/auditoria-trailer-nota-midia-acc8f5`
> · árvore **limpa** · **4 commits atrás de `origin/main` (`1340e8c`)**.
> Os 4 commits do delta são `#250`, `#247`, `#251`, `#252`; nenhum toca scheduler,
> ingestão, ratings ou cliente TMDB — **o escopo desta auditoria é idêntico nos dois
> pontos**, provado por `git diff --name-only HEAD origin/main`.
> `rhythms.ts` não aparece no delta: **a leva 7 ainda não aterrissou em `main`**, então o
> que está descrito aqui é o estado anterior a ela.
>
> **Isolamento:** esta sessão não tem instrução ativa de alterar ritmo, fila ou
> idempotência.
>
> **Ambiente:** alcança `api.themoviedb.org`, `omdbapi.com` e `files.tmdb.org`.
> Banco de produção **não** alcançável (host interno do Docker).
>
> **Orçamento externo gasto: 26/30 TMDB · 2/10 OMDb.** Detalhe na §18.

---

## 1. Resumo executivo

> ## ERRATA — 2026-08-31: a base de catálogo deste documento estava errada
>
> Este documento declara, na §4 e na §11, usar *"proxies declarados de #248"* para o
> tamanho do acervo. **Aqueles proxies estavam mecanicamente errados: a coluna tinha sido
> deslocada uma linha.** A contagem de séries virou a de temporadas, a de temporadas virou
> a de episódios, e **episódio nunca foi contado**. Medido em produção por `psql` em
> 2026-08-28:
>
> | | proxy usado aqui | medido | erro |
> | --- | ---: | ---: | --- |
> | títulos | 67.288 | **70.537** | −4,6% |
> | temporadas | 32.483 | **136.650** | **4,2× menor** |
> | episódios | 135.926 | **3.921.368** | **28,8× menor** |
> | pessoas | 100.000 | **1.200.796** | era o **teto** do censo |
>
> **Todas as contas deste documento foram refeitas** (§4, §5, §11, §17, §18). Os valores
> antigos aparecem tachados ou nomeados ao lado dos novos — nada foi apagado em silêncio.
>
> **A CONCLUSÃO NÃO MUDA — FICA MAIS FORTE.** O Desenho 3 era recomendado por *economia de
> 84,5%*; passa a ser recomendado por **viabilidade**. Com o número correto, a varredura
> completa custa **13.656.998 req = 3,95 DIAS a 40 req/s**: o Desenho 1 não é a opção cara,
> é a opção que **não existe**. Um dia não cabe em quatro dias.
>
> **E a ressalva deste documento agrava.** Com os proxies, episódio era 58% da mídia; com o
> número real é **95% da mídia e 57% do custo total da varredura** — e é exatamente a fatia
> que o `/changes` **não nomeia**. A frase *"vale medir antes de desenhar"* deixa de ser
> observação e vira **a medição de maior alavanca do plano inteiro**: ver §11, "O que a
> correção move para o topo da lista".
>
> Origem da correção: [`midia-notas-e-atualizacao-diaria.md`](./midia-notas-e-atualizacao-diaria.md) §5.2 (#248).

**Existe gatilho no TMDB, ele já está implementado, chamado, agendado — e cobre mídia.**

| Pergunta | Resposta |
| --- | --- |
| Existe gatilho TMDB utilizável? | **Sim.** Os três `/changes` globais, com janela de até 14 dias. |
| Está em uso? | **Sim, e produz efeito — mas só até a metade do caminho.** Ver abaixo. |
| Cobre mídia? | **Movie: SIM** (`images` e `videos` observados). **TV: SIM para imagem** (`images`); `videos` **não demonstrado** em 9 amostras. |
| Volume diário observado | **19.372 ids/dia** em todo o TMDB (movie 9.566 · tv 3.032 · person 6.774), enumeráveis com **195 requisições**. |
| Exports têm utilidade? | **Sim, duas** — e a segunda está desperdiçada: o arquivo diário traz `popularity` de graça, e **nada a persiste**. |
| OMDb tem gatilho? | **Não.** Confirmado na documentação oficial: só `i`, `t`, `s`. Nenhum feed, nenhum `updated-since`, nenhum export. |
| Desenho recomendado | **Desenho 3** — gatilho diário + exports + preenchimento + reconciliação mensal. |
| Custo do recomendado | **~564.709 req/dia** amortizados, contra **13.656.998**. *(circulou como 135.373 contra 874.379 — ver ERRATA)* |
| Economia | **95,9%** — 13.092.289 requisições por dia. |
| A varredura completa é opção? | **Não.** 13.656.998 req = **3,95 dias** a 40 req/s. Não é cara — é impossível. |

### O achado que muda o desenho

> **O gatilho chega ao detalhe e MORRE antes da mídia.**
>
> `/changes` monta o `sync_details` **com escopo de janela**, então ele re-executa
> corretamente. Mas o `sync_details` enfileira `sync_media` com
> `discriminator: input.locale` — **sem escopo**. Para todo título já sincronizado uma
> vez, o filho é `created=false`: noop.
>
> **Consequência:** mesmo agora que está provado que `/changes` sinaliza `images` e
> `videos`, **o pipeline atual não consegue agir sobre esse sinal.** Os **8.257.110**
> requests de mídia — **60,5% do custo** — não têm como ser substituídos por gatilho
> enquanto a chave do filho não tiver escopo. *(circulou como 471.394 e 54% — ERRATA)*
>
> A.3 destravou a economia; A.2 mostra que a porta está fechada por dentro.

### O segundo achado

> **Com o gatilho ligado, a OFERTA vira o maior custo.** No Desenho 2, ofertas são
> **70.537 de 109.476 requisições — 64% do total.** Mas `watch/providers` **já vem no
> append do detalhe**: todo título que o gatilho tocar traz a oferta de graça. Só os
> títulos **não alterados** precisam da chamada dedicada.

---

## 2. A.1 — Prova operacional dos gatilhos

**As quatro perguntas, respondidas separadamente. `implementado ≠ chamado ≠ agendado ≠ executado ≠ com efeito`.**

| caminho | implementado | chamado fora de teste | agendado | rodou 30d |
| --- | :-: | :-: | :-: | :-: |
| `/movie/changes` | **SIM** — `catalog.ts:341` | **SIM** — `catalog-services.ts:875` | **SIM** — fila `changes`, 6 h | **NÃO DETERMINADO** |
| `/tv/changes` | **SIM** — `catalog.ts:344` | **SIM** — `catalog-services.ts:876` | **SIM** — mesma fila | **NÃO DETERMINADO** |
| `/person/changes` | **SIM** — `catalog.ts:347` | **SIM** — `catalog-services.ts:877` | **SIM** — mesma fila | **NÃO DETERMINADO** |
| `tmdb-exports` | **SIM** — `discovery/id-exports.ts:17` | **SIM** — `bin/discover-ids.ts:105`, `bin/catalog-worker-service.ts:206` | **SIM** — fila `discovery`, 24 h | **NÃO DETERMINADO** |

**Agendamento, textual** (`services/sync/src/scheduler/rhythms.ts`):
- fila `changes` — `intervalHours: 6`, `providerApi: 'tmdb'`
- fila `discovery` — `intervalHours: 24`, `providerApi: 'tmdb-exports'`

**"Rodou 30d" é NÃO DETERMINADO** — exige `api_sync_logs`, e o banco de produção não é
alcançável desta máquina. SQL na §17.

> **Cuidado com a leitura:** "rodou" aqui significaria apenas *execução registrada*.
> Mesmo comprovada, ela não diria que produziu atualização útil — isso é a §3.

---

## 3. A.2 — Onde o ID termina

O caminho completo, seguido no código:

```
fila `changes` (6 h)
  └─> runners.ts:283  runChanges
      └─> job `sync_changes`
          └─> sync-changes-handler.ts:48  runChangesSync
              └─> changes/run.ts:238  fetchChanges(kind, {start_date, end_date, page})
                  └─> extractChangedIds()
                      └─> buildCoverageJob({kind, tmdbId, locale,
                                            reason:'changes', scope: <janela>})   ◄── entity-coverage/entry.ts
                          └─> job `sync_details`   idempotencyKey discriminator = `${locale}:${janela}`
                              └─> sync-details-handler
                                  ├─ GRAVA: detalhe, créditos, external_ids,
                                  │         watch/providers, release_dates, keywords,
                                  │         alternative_titles, recommendations, similar
                                  └─> enqueueDependencies()  ◄── sync-details-handler.ts:196
                                      ├─> `sync_media`    discriminator = input.locale   ✗ SEM ESCOPO
                                      └─> `sync_seasons`  discriminator = input.locale   ✗ SEM ESCOPO
                                          └─> `sync_episodes`  discriminator = `s<n>:<locale>`  ✗ SEM ESCOPO
```

### Classificação por trecho

| Trecho | Executa? | Produz efeito? |
| --- | --- | --- |
| `/changes` → `sync_details` | **NÃO DETERMINADO** (falta `api_sync_logs`) | **SIM, por construção** — a chave carrega a janela, então o mesmo id alterado numa janela nova **é trabalho novo** |
| `sync_details` → detalhe, créditos, ids externos, **watch/providers**, release_dates | idem | **SIM** — tudo isso vem no append e é gravado |
| `sync_details` → `sync_media` | idem | **NÃO** — chave sem escopo; título já coberto recebe `created=false` |
| `sync_details` → `sync_seasons` → `sync_episodes` | idem | **NÃO** — mesma causa |

### A prova, no próprio código

`sync-details-handler.ts:205-217` — o `base` do filho é `{ locale, tmdbId }`; a janela não
entra. O discriminador é `input.locale`, apenas. E o comentário em `:230` declara a
consequência sem rodeios:

> *"A CHAVE DO FILHO NAO TEM ESCOPO, a do pai tem (dia, no agendador; janela, no
> incremental). Logo todo `sync_details` de um titulo JA COBERTO cai aqui e recebe
> `created=false` — o noop e o caminho normal, nao a excecao."*

**Não há caminho alternativo para a mídia.** `images` e `videos` chegam no append do
detalhe, mas o registro de consumo os classifica como `dedicated-endpoint`: os
normalizadores do detalhe não os leem (a cópia do append vem filtrada por idioma). Mídia
só entra por `sync_media` — e `sync_media` é write-once.

### O achado colateral que muda a conta

`runChangesSync` **não filtra pelo nosso catálogo.** `ids.map((id) => buildCoverageJob(...))`
enfileira **todo** id alterado no TMDB — inclusive entidades que não temos. Isso não é
manutenção; é descoberta acidental, e é o que faz o Desenho 2 custar 19.372 detalhes/dia em
vez de ~731.

---

## 4. A.3 — O `/changes` cobre mídia? **(a pergunta que decide tudo)**

Medido empiricamente em **2026-08-28**, janela UTC `2026-08-27 → 2026-08-28`. As chamadas
globais foram **reaproveitadas de A.4** — zero chamada global nova.

> # Movie `/changes` cobre mídia? — **SIM**
> # TV `/changes` cobre mídia? — **SIM (imagem); `videos` NÃO DEMONSTRADO**
> ## É seguro usar `/changes` como gatilho de mídia para o conjunto auditado? — **PARCIAL**

### A prova — MOVIE (5 entidades, janela `2026-08-27..2026-08-28`)

| Entidade | Chaves retornadas |
| --- | --- |
| `movie/769314` | production_companies, crew, genres, release_dates, **images** |
| `movie/1142683` | **videos**, **images** |
| `movie/1756809` | crew, release_dates, production_companies, genres, cast, plot_keywords, **images** |
| `movie/1433330` | cast |
| `movie/1630409` | crew |

**União (8):** cast, crew, genres, **images**, plot_keywords, production_companies,
release_dates, **videos**.
**Chaves de mídia: `images`, `videos`.** Evidência inequívoca, dentro da mesma janela.

### A prova — TV (9 entidades, duas rodadas, mesma janela)

| Entidade | Chaves retornadas |
| --- | --- |
| `tv/68845` · `tv/301466` · `tv/229985` · `tv/225320` | season |
| `tv/30984` | season, **images** |
| `tv/108978` | name, **images**, season |
| `tv/326879` | translations, season, name, certifications, overview |
| `tv/88329` · `tv/283019` | **images** |

**União (6):** certifications, **images**, name, overview, season, translations.
**Chaves de mídia: `images`.** `videos` **não apareceu em nenhuma das 9 amostras.**

> **Isso NÃO prova que TV nunca sinaliza `videos`.** Nove amostras num único dia são
> evidência exploratória. A conclusão honesta é: *não foi demonstrado*. Provar exigiria
> amostra maior, e o orçamento da regra 9 não comporta.

### O gatilho é ACIONÁVEL, não só um sinal

Inspecionei a estrutura do item de mudança — e isso vale tanto quanto o veredito:

**`key: season`** (tv/30984) — `value` carrega **`season_id` e `season_number`**.

> O gatilho **diz qual temporada mudou**. Não é "algo mudou nesta série": é
> "a temporada N mudou". Uma manutenção dirigida pode buscar só aquela temporada, em vez
> de reenumerar todas.

**`key: images`** — `value` carrega o tipo (`poster`), com `iso_639_1` (`en`, `xx`) e
`action` (`added` / `updated`), e `original_value` quando é atualização.

> O gatilho **diz qual arte mudou e em que idioma**. Uma manutenção dirigida pode decidir
> se vale rebuscar a galeria.

### Nível de episódio

**Não observado.** Nenhuma chave de episódio apareceu em 9 séries. Alteração de episódio
aparentemente se manifesta como `season` (a temporada que o contém) — o que é coerente com
o `season_id`/`season_number` observados, mas **não foi provado** nesta amostra.

### Qual fatia dos 8.257.110 fica coberta *(recalculado em 2026-08-31)*

O custo de mídia se divide (contagens **medidas** em 2026-08-28: 37.554 filmes, 32.983
séries, 136.650 temporadas, 3.921.368 episódios; 2 requisições cada):

| Fatia | Requisições | Gatilho | Situação |
| --- | ---: | --- | --- |
| Filme | 75.108 | `images` + `videos` **demonstrados** | **coberta** |
| Série | 65.966 | `images` demonstrado; `videos` não | **coberta para imagem** |
| Temporada | 273.300 | `season` com `season_id` — **acionável** | **coberta indiretamente** |
| Episódio | **7.842.736** | nenhuma chave de episódio observada | **descoberta** |
| **Total** | **8.257.110** | | **~5% coberta, ~95% descoberta** |

> ### A correção inverte esta seção
>
> Com os proxies errados, a leitura era *"~58% coberta, ~42% descoberta"*. Com o número
> medido é **~5% coberta, ~95% descoberta**. Episódio salta de 271.852 para **7.842.736
> requisições** — de 58% para **95% da mídia**, e para **57% do custo total da varredura
> completa**.
>
> **O que era uma ressalva vira a pergunta central.** Se a hipótese *"episódio se manifesta
> como `season`"* se confirmar, 95% da mídia passa a coberta e o Desenho 3 cai de 564.709
> para **~303.285 req/dia** (§11). Se não se confirmar, episódio fica na reconciliação e
> **sozinho responde por 46% do custo do desenho recomendado**.
>
> **Uma única medição decide quase metade do orçamento permanente.** É a de maior alavanca
> deste plano — e custa 9 chamadas de API, como as desta seção.

---

## 5. A.4 — O volume real do gatilho

Três dias **completos e encerrados em UTC**. O dia corrente não foi usado. Sem paginação —
a primeira página já devolve `total_results`. **9 chamadas.**

| tipo | dia UTC | `start_date` | `end_date` | `total_results` | `total_pages` |
| --- | --- | --- | --- | ---: | ---: |
| movie | 2026-08-25 | 2026-08-25 | 2026-08-26 | **9.767** | 98 |
| movie | 2026-08-26 | 2026-08-26 | 2026-08-27 | **10.168** | 102 |
| movie | 2026-08-27 | 2026-08-27 | 2026-08-28 | **8.763** | 88 |
| tv | 2026-08-25 | 2026-08-25 | 2026-08-26 | **3.011** | 31 |
| tv | 2026-08-26 | 2026-08-26 | 2026-08-27 | **3.101** | 32 |
| tv | 2026-08-27 | 2026-08-27 | 2026-08-28 | **2.986** | 30 |
| person | 2026-08-25 | 2026-08-25 | 2026-08-26 | **7.562** | 76 |
| person | 2026-08-26 | 2026-08-26 | 2026-08-27 | **6.783** | 68 |
| person | 2026-08-27 | 2026-08-27 | 2026-08-28 | **5.979** | 60 |

| tipo | mín | mediana | máx | média | páginas/dia |
| --- | ---: | ---: | ---: | ---: | ---: |
| movie | 8.763 | 9.767 | 10.168 | **9.566** | 96 |
| tv | 2.986 | 3.011 | 3.101 | **3.032** | 31 |
| person | 5.979 | 6.783 | 7.562 | **6.774** | 68 |
| **total** | | | | **19.372** | **195** |

### A comparação que responde a pergunta do dono

| | requisições/dia |
| --- | ---: |
| Enumerar o gatilho inteiro (3 tipos, todas as páginas) | **195** |
| Passagem completa por força bruta | **13.656.998** *(circulou como 874.379)* |

> **195 requisições dizem quais 19.372 entidades mudaram em todo o TMDB.**
> É **0,0014%** do custo da varredura. **O gatilho não é uma otimização — e, corrigido o
> número, não é sequer uma escolha:** a varredura completa leva 3,95 dias a 40 req/s, então
> a alternativa ao gatilho não é "gastar mais", é **não conseguir fechar o dia**.

### A ressalva que o número exige

Esses 19.372 são **de todo o TMDB**, não do nosso catálogo. Nosso catálogo cobre **3,05%**
dos filmes (**37.554** de ~1,23 M) e **14,47%** das séries (**32.983** de ~228 k).
*(circulou como 2,83% / 14,25%, sobre 34.802 / 32.486 — ver ERRATA)*

- **Piso** (se a mudança fosse uniforme): **~731 ids/dia** são nossos — 292 filmes + 439
  séries. Pessoa continua **fora do piso**: nosso `count` é agora conhecido (1.200.796),
  mas o universo de pessoas do TMDB não foi medido, então não há denominador.
- **Real: maior.** Mudança concentra em título popular, e nosso catálogo **é** o topo por
  popularidade. Só o banco fecha o número (SQL na §17).

E hoje `runChangesSync` **não filtra**: enfileira os 19.372. As duas contas estão na §15.

---

## 6. Descoberta, manutenção e reconciliação — os três papéis (A.5)

O gatilho serve a **um** dos três. Confundir os papéis é o que faz um desenho parecer
completo e deixar buraco.

| Papel | Pergunta que responde | Mecanismo | Cadência |
| --- | --- | --- | --- |
| **Descoberta** | "existe entidade que ainda não temos?" | **Daily ID Exports** — o universo inteiro de ids, de graça, sem cota | diária |
| **Manutenção** | "o que mudou desde ontem?" | **`/changes`** | diária (hoje 6 h) |
| **Reconciliação** | "o que escapou dos dois?" | varredura periódica ou checagem de cobertura | mensal |
| **Preenchimento** | "fechar a lacuna conhecida de hoje" | backfill controlado | **temporário**, até fechar |

### Por que o gatilho não basta sozinho

Entidade que **nunca mudou** no TMDB nunca aparece no `/changes`. E ela pode ser exatamente
a que: nunca coletamos; coletamos pela metade; perdeu um job para dead-letter; existia
antes de a nossa sincronização começar. **Gatilho é sobre mudança, não sobre cobertura.**

### A reconciliação precisa ser varredura completa? **Não necessariamente**

Duas alternativas mais baratas, ambas viáveis com o que já existe:

1. **Reconciliação por export** — comparar os ids do export diário com o catálogo local
   responde "o que existe no TMDB e não em nós" **sem uma única chamada à API**. Isso cobre
   a lacuna de *existência*.
2. **Reconciliação por frescor** — `last_synced_at`/`stale_after` já existem no schema.
   Selecionar quem passou da janela e re-enfileirar cobre a lacuna de *atualidade*, e custa
   só os que realmente venceram.

A varredura completa continua sendo a rede de segurança para o que **nenhuma das duas** vê:
gravação que falhou em silêncio, campo que mudou sem o TMDB registrar, defeito nosso.
Por isso ela entra no Desenho 3 — mensal, não diária.

---

## 7. A.6 — As exportações diárias

### O que já existe

| Pergunta | Resposta |
| --- | --- |
| Implementado? | **SIM** — `services/ingestion/src/discovery/id-exports.ts` |
| Baixado? | **SIM** — `bin/discover-ids.ts:105`, `bin/catalog-worker-service.ts:206` |
| Processado? | **SIM** — parser JSONL + filtro adulto de 2 camadas |
| Agendado? | **SIM** — fila `discovery`, 24 h, `providerApi: 'tmdb-exports'` |
| Rodou 30d? | **NÃO DETERMINADO** (falta `api_sync_logs`) |
| **O que faz hoje** | Enfileira `sync_details` por id, com `reason:'discovery'` e **sem escopo** |

### O formato, medido

Prefixo de **64 KB** via `Range` de `tv_series_ids_08_27_2026.json.gz` (arquivo completo:
5.035.963 bytes). **Não baixei nenhum arquivo inteiro.**

```
{"id":1,"original_name":"プライド","popularity":3.872}
{"id":2,"original_name":"Clerks","popularity":6.3021}
{"id":3,"original_name":"The Message","popularity":2.7534}
```

**Campos: `id`, `original_name`, `popularity`.**

Tamanhos do dia 27/08 (via `Content-Length`, sem baixar):

| arquivo | bytes | |
| --- | ---: | --- |
| `person_ids` | 76.703.983 | 73 MB |
| `movie_ids` | 27.685.914 | 26 MB |
| `tv_series_ids` | 5.035.963 | 4 MB |
| `production_company_ids` | 3.121.057 | 2 MB |
| `keyword_ids` | 1.011.993 | < 1 MB |
| `collection_ids` | 162.876 | < 1 MB |
| `tv_network_ids` | 51.816 | < 1 MB |

### Utilidade 1 — descoberta de entidade nova: **SIM, e já é usada**

É exatamente o que a fila `discovery` faz. Comparar os ids do export com o catálogo local
revela o que falta **sem gastar uma chamada de API** — os arquivos são públicos e ficam
fora da cota.

**Limite honesto:** o export dá o **id**, não o conteúdo. Descobrir é barato; **cobrir**
custa uma requisição de detalhe por entidade. O export elimina o custo de *procurar*, não o
de *buscar*.

### Utilidade 2 — popularidade: **SIM, e está desperdiçada**

> **`movies.popularity` e `tv_shows.popularity` são escritos em UM lugar só:**
> `normalizers/movie.ts:89` e `normalizers/tv.ts:83`, a partir de `detail.popularity` —
> **isto é, só via `sync_details`.**
>
> O `popularity` do export é lido (`IdExportRecord.popularity`) e usado **apenas para
> ordenar**: `seed-plan.ts`, `sync-queue.ts`, `export-sample.ts`. **Nunca é persistido.**

**Podemos atualizar a popularidade do catálogo inteiro usando os arquivos diários, sem
consultar detalhe?** **Sim.** O dado está lá, é diário, e custa **zero requisição de API** —
apenas o download de 26 MB (filmes) + 4 MB (séries).

Isso importa porque a popularidade é o sinal que ordena a fila de cobertura
(`POPULARITY_PRIORITY_OFFSETS`) e que a proposta de escalonamento da OMDb usa. **Hoje a
prioridade é calculada sobre uma popularidade que só se atualiza quando o título é
sincronizado — o que é circular: o título precisa ser buscado para saber se merecia ser
buscado.** O export quebra essa circularidade de graça.

### Resultado

| | |
| --- | --- |
| **Serve para** | descobrir ids novos (já usado); atualizar popularidade do catálogo inteiro sem cota (**não usado**) |
| **Não serve para** | trazer conteúdo — só id, nome original e popularidade |
| **Substitui** | a varredura de *descoberta*; e substituiria a atualização de popularidade via detalhe |
| **Não substitui** | `/changes` (o export não diz o que mudou, só o que existe) nem o detalhe |

---

## 8. A.7 — O append `changes` por entidade

| Pergunta | Resposta |
| --- | --- |
| Gera requisição adicional? | **Não.** É sub-recurso de `append_to_response`, dentro da mesma chamada de detalhe. |
| Aumenta payload ou conta chamada? | **Só payload.** Mas conta contra o teto de **20 sub-requests** — movie usa 13, tv 16, então hoje não desloca ninguém. |
| Alguma parte do código consome? | **Não.** `changes` não existe em `TmdbMovieDetail`/`TmdbTvDetail` (`api-clients/tmdb/src/types.ts`), e nenhum normalizador lê `detail.changes`. Desaparece no limite do tipo, sem erro e sem aviso. |
| Traz informação que o `/changes` global não dá? | **Sim, e é justamente a que falta.** O global dá **quais ids** mudaram; o append por entidade dá **o quê** mudou (`key`, `action`, `value`, `iso_639_1`, `original_value`) — provado em A.3. |
| Ajuda a descobrir o que mudou depois do gatilho? | **Sim — e é o único caminho para isso.** Sem ele, saber que o id 1142683 mudou não diz se foi `videos` ou `cast`. |
| Seria usado numa decisão real? | **Sim.** É exatamente o sinal que decidiria *"vale rebuscar a mídia deste título?"* — a pergunta de **8.257.110** requisições/dia. |

### Classificação: **potencialmente útil — e mal posicionado**

Não é peso morto por natureza; é peso morto **por posição**. No append do detalhe ele chega
*junto* com o detalhe — isto é, **depois** de a requisição cara já ter sido paga. A
informação que ele carrega só teria valor **antes** dessa decisão.

> O uso correto seria `/movie/{id}/changes` como chamada **própria e barata**, entre o
> gatilho global e a decisão de rebuscar. No append, ele responde uma pergunta que já não
> se pode usar.

**Nada foi removido.** A classificação é: **potencialmente útil, hoje inerte na posição em
que está.**

---

## 9. B — O OMDb

### B.1 — Confirmação da ausência

Verificado na documentação oficial (`omdbapi.com`), parâmetro por parâmetro:

- **Por ID/Título:** `i`, `t`, `type`, `y`, `plot`, `r`, `callback`, `v`
- **Por busca:** `s`, `type`, `y`, `r`, `page`, `callback`, `v`
- **Pôster:** `img.omdbapi.com`

> # OMDb não possui mecanismo de mudança conhecido/documentado.
>
> Nenhum change feed, `updated-since`, lote de mudanças, webhook, export, dump incremental
> ou endpoint de ids modificados. **Nada.**

A estratégia é obrigatoriamente **consulta individual + escalonamento de frequência**. Não
há equivalência a forçar com o TMDB.

### B.1b — Achado novo: a cota é **inobservável**

Inspecionei os cabeçalhos de resposta de duas chamadas reais. O único cabeçalho não-padrão
é `x-aspnet-version: 4.0.30319`.

> **O OMDb não publica nenhum cabeçalho de cota** — sem `X-RateLimit-Limit`, sem
> `Remaining`, sem `Reset`. O único sinal de estouro é o **corpo** da resposta.
>
> Isso eleva a pendência "qual o plano da chave?" de *"não verifiquei"* para
> **"não há o que verificar em runtime"**. A única fonte é o painel do OMDb (Patreon).
>
> Consequência operacional: `api_sync_logs.quota_cost` — o **nosso** contador — é a única
> medida de consumo que temos, e nada a reconcilia com a realidade do fornecedor. Se ela
> derivar, ninguém percebe até o estouro.

### B.2 — Com que frequência a nota muda? **NÃO DETERMINADO — falta o banco**

O que **está** determinado, por código:

**O que `external_ratings` guarda por coleta:** `ratingSource`, `ratingLabel`, `metric`,
`ratingValue`, `ratingScale`, `ratingCount`, `ratingUrl`, `providerApi`,
`providerPayloadHash`, `fetchedAt`, `scoreType`, atribuição, licença.

**`provider_payload_hash` — calculado? persistido? comparado?**

| | |
| --- | --- |
| Calculado | **Sim** — `hashPayload` (`omdb/run.ts:407`) |
| Persistido | **Sim** — `external-ratings-store.ts:235,274` |
| **Comparado para evitar escrita?** | **NÃO** |

A decisão é **deliberada e documentada** (`external-ratings-store.ts:180-186`): o store
compara o **conteúdo da nota** (`ratingValue`, `ratingScale`, `ratingLabel`, `ratingCount`,
`ratingUrl`, `providerApi`, `scoreType`), não o hash. O motivo declarado:

> *"`providerPayloadHash` e o hash do payload BRUTO inteiro […] Esse hash muda sempre que
> QUALQUER item da lista muda — inclusive itens de outros filmes. Inclui-lo aqui faria toda
> linha parecer 'mudada' a cada ciclo."*

E quando nada mudou, `fetchedAt` **avança mesmo assim** (o relógio de frescor precisa
andar), sem bumpar `updated_at`. **O comportamento está correto** — mas note a consequência
para a medição: `updated_at` distingue mudança real, `fetched_at` não.

**O histórico longitudinal não pôde ser medido.** `external_ratings` tem UNIQUE em
`(entity_type, entity_id, rating_source, metric)` — ou seja, **uma linha por par, sobrescrita
no lugar**. Não há tabela de histórico de notas.

> **Isso é um achado, não uma limitação da auditoria:** a pergunta *"com que frequência a
> nota muda?"* **não pode ser respondida com o schema atual**, hoje nem no futuro. O banco
> guarda o estado, não a série temporal. O máximo que o SQL da §17 extrai é
> `updated_at` vs `created_at` vs `fetched_at` — que diz *se já mudou alguma vez*, não
> *com que frequência*.

### B.3 — O critério de escalonamento: **NÃO DETERMINADO — falta o banco**

Os sinais disponíveis no schema, e o que cada um vale:

| Sinal | Existe? | Serve para prever volatilidade? |
| --- | --- | --- |
| `release_date` / `first_air_date` | sim | **Provavelmente o melhor** — nota de lançamento move; nota de clássico não |
| `popularity` | sim, indexado | Proxy de *atenção*, não de *volatilidade*. E hoje só atualiza via `sync_details` (§7) |
| `fetched_at` (tempo desde a última coleta) | sim | Necessário como desempate, não como critério |
| ausência de nota | sim | **Prioridade extra óbvia** — nunca consultado vem antes de reconsultado |
| `rating_count` | sim | **O sinal mais promissor não testado** — votos crescendo indicam nota em movimento |
| crescimento de `rating_count` | **não** | Exigiria histórico, que o schema não guarda |

> **Não substituo popularidade por recência sem dado.** A comparação honesta exige medir,
> em `external_ratings` × `movies`, quais linhas com `updated_at > created_at` (nota que já
> mudou) se concentram em qual faixa de idade. **SQL na §17.**
>
> O que já posso afirmar: **popularidade sozinha é o critério errado**, porque ela mede
> atenção, e a pergunta é volatilidade. Um clássico muito popular tem nota estável; um
> lançamento obscuro tem nota móvel. Uma proposta defensável é composta —
> `recência × ausência de nota × idade da coleta` —, com popularidade como **desempate**,
> não como eixo. Mas a forma final vem do dado.

### B.4 — A folga da cota

Cota **1.000/dia**, **150** reservadas ao caminho sob demanda.

| Envelope | Uso máx. | **Folga** | Títulos/mês | Volta completa (**70.537**) |
| ---: | ---: | ---: | ---: | ---: |
| 600/dia | 750/1.000 | **250** | 18.000 | 118 dias (3,9 meses) |
| **700/dia** | **850/1.000** | **150** | **21.000** | **101 dias (3,4 meses)** |
| 800/dia | 950/1.000 | **50** | 24.000 | 88 dias (2,9 meses) |
| 849/dia *(proposta anterior)* | 999/1.000 | **1** | 25.470 | 83 dias (2,8 meses) |

*(a volta completa circulou sobre 67.288 títulos: 112 / 96 / 84 / 79 dias — ERRATA)*

#### Recomendado: **700/dia**

O que se ganha subindo de 700 para 800: 13 dias a menos por volta (101 → 88). O que se
perde: a folga cai de 150 para 50 — **um terço de um dia de retry**. Com 700, a folga de
150 é igual à própria reserva do leitor: cabe uma reexecução completa de um ciclo que tenha
falhado, sem tocar na reserva.

De 700 para 600 a folga sobe para 250, mas a volta vai a 112 dias — 16 dias a mais por 100
requisições que, na prática, quase nunca serão usadas. **700 é o joelho da curva.**

#### Quando a cota estoura hoje — **defeito confirmado**

Segui o caminho pelo código:

1. **O OMDb responde HTTP 200.** O cliente documenta: *"a OMDb responde ERRO com HTTP 200 e
   um campo `Error` no corpo"* (`api-clients/omdb/src/client.ts:8`).
2. `isFailureResponse` (`omdb/mapping.ts:96`) detecta `Response:"False"` e vira **rejeição**.
3. **A string `"Request limit reached!"` não é reconhecida em lugar nenhum.** Varredura em
   `api-clients/omdb/` e `services/ratings/`: **zero ocorrências** de "Request limit",
   "limit reached", "daily limit" ou "maximum usage".
4. Como o HTTP é **200**, não entra no caminho de falha de rede: `consecutiveFailures`
   (`omdb/run.ts:319`) **não incrementa**, e o circuit breaker **não abre**.
5. O lote **continua**, item por item, até o fim.

> **Consequência:** um lote de 200 que cruze o limite da cota no item 50 **continua fazendo
> as 150 chamadas restantes**, todas recusadas, todas contadas pelo fornecedor. E o motivo
> registrado é indistinguível de *"este IMDb ID não existe"*.
>
> **O que NÃO acontece (e é o alívio):** a rejeição não grava "sem nota". Como a seleção usa
> `NOT EXISTS`, o título continua candidato e volta no próximo ciclo. **O dano é cota
> desperdiçada, não dado envenenado.**

**A proteção que existe** é a pré-checagem (`checkOmdbBudget`), lida **uma vez por ciclo**
(`readSpentToday`, `facts.ts:170` — soma `quota_cost` do dia civil UTC). Ela impede
**começar** um lote sem cota; **não consegue parar no meio dele**. E, combinada com B.1b (o
fornecedor não publica cota), ela depende inteiramente de o nosso contador estar certo.

### B.5 — O `Plot` do OMDb serve para pt-BR? **NÃO**

Chamada de amostra, `tt5463162` (Deadpool 2), `plot=full`:

> **OMDb retornou:** *"After losing Vanessa (Morena Baccarin), the love of his life,
> fourth-wall-breaking mercenary Wade Wilson, aka Deadpool (Ryan Reynolds), must assemble a
> team and protect a young mutant Russell Collins, aka Firefist (Julian Dennison), from
> Cable (Josh Brolin), a no-nonsense, dangerous cyborg from the future, and must also learn
> the most important lesson of all: to be part of a family again."*

| Pergunta | Resposta |
| --- | --- |
| Idioma observado | **Inglês** |
| É português? | **Não** |
| Serve como sinopse pt-BR? | **Não.** Publicar isso numa ficha pt-BR seria idioma trocado em URL indexável. |
| Serve como matéria-prima para tradução? | **Tecnicamente sim** — mas tradução cega é proibida (invariante 7 + `.claude/rules/i18n.md` §9) |
| Serve como fallback técnico não exibido? | **Sim** — para o Entity Writer, é payload controlado adicional |
| Conclusão | **Não serve para este caso.** A sinopse pt-BR continua sendo problema do TMDB (`translations`) ou do Entity Writer. |

*A contagem de títulos sem sinopse depende do banco — não foi medida aqui, e não repito
número decorado.*

**A mesma chamada confirmou o desenho de três fontes numa requisição:**

```json
[ {"Source":"Internet Movie Database","Value":"7.6/10"},
  {"Source":"Rotten Tomatoes",        "Value":"83%"},
  {"Source":"Metacritic",             "Value":"66/100"} ]
```

E o payload carrega, além das notas: `Rated` (classificação), `Awards`, `BoxOffice`,
`Poster`, `Runtime`, `Director`, `Writer`, `Actors`, `Country`, `Production`.

---

## 10. C.1 — A tabela de decisão

| dado | fonte | caminho / endpoint | frequência de mudança | evidência | tem gatilho? | mecanismo | ritmo proposto | custo/dia |
| --- | --- | --- | --- | --- | :-: | --- | --- | ---: |
| **Título e sinopse** (movie) | TMDB | `/movie/{id}` append | baixa | medido API (`overview` não apareceu em 5 amostras) | **SIM** | `/movie/changes` | diário, por gatilho | incluso no detalhe |
| **Título e sinopse** (tv) | TMDB | `/tv/{id}` append | baixa–média | medido API (`overview`, `name`, `translations` observados) | **SIM** | `/tv/changes` | diário, por gatilho | incluso no detalhe |
| **Elenco e equipe** | TMDB | append `credits` | média | medido API (`cast`, `crew` em 3 de 5 filmes) | **SIM** | `/changes` | diário, por gatilho | incluso no detalhe |
| **Imagem e pôster** (movie) | TMDB | `/movie/{id}/images` | **alta** | **medido API** (`images` em 3 de 5) | **SIM** | `/changes` → key `images` | diário, por gatilho | 1 req/alterado |
| **Imagem e pôster** (tv) | TMDB | `/tv/{id}/images` | **alta** | **medido API** (`images` em 4 de 9) | **SIM** | `/changes` → key `images` | diário, por gatilho | 1 req/alterado |
| **Vídeo e trailer** (movie) | TMDB | `/movie/{id}/videos` | média | **medido API** (`videos` em 1 de 5) | **SIM** | `/changes` → key `videos` | diário, por gatilho | 1 req/alterado |
| **Vídeo e trailer** (tv) | TMDB | `/tv/{id}/videos` | não determinado | medido API — **`videos` não observado em 9** | **NÃO DEMONSTRADO** | — | reconciliação | 1 req/título na reconciliação |
| **Oferta de streaming** | TMDB | append `watch/providers` **+** `/{id}/watch/providers` | **muito alta** | doc oficial + `rhythms.ts` | **NÃO** — nenhuma key observada | varredura, **menos** os que o gatilho já trouxe no append | diário | **70.537** menos os alterados |
| **Classificação indicativa** (movie) | TMDB | append `release_dates` | baixa | **medido API** (`release_dates` em 2 de 5) | **SIM** | `/changes` | diário, por gatilho | incluso no detalhe |
| **Classificação indicativa** (tv) | TMDB | append `content_ratings` | baixa | **medido API** (`certifications` observado) | **SIM** | `/changes` | diário, por gatilho | incluso no detalhe |
| **Temporada** | TMDB | `/tv/{id}/season/{n}` | média | **medido API** — key `season` com **`season_id` + `season_number`** | **SIM, acionável** | `/tv/changes` → key `season` | diário, dirigido | 1 req/temporada alterada |
| **Episódio** | TMDB | `/tv/{id}/season/{n}/episode/{e}` | média | medido API — **nenhuma key de episódio em 9** | **NÃO DEMONSTRADO** | (hipótese: via `season`) | reconciliação até provar | **7.842.736** na varredura *(circulou como 271.852)* |
| **Pessoa** | TMDB | `/person/{id}` | baixa | **medido API** (6.774 ids/dia) | **SIM** | `/person/changes` | diário, por gatilho | 1 req/alterado |
| **Nota externa** | **OMDb** | `/?i={imdbID}` | não determinado | **doc oficial: sem gatilho** | **NÃO** | rodízio escalonado | ver §11 | **700** |
| **Popularidade** | **TMDB exports** | `files.tmdb.org/p/exports` | diária | **medido** (`popularity` no JSONL) | **n/a — o arquivo É o feed** | download diário | diário | **0 req de API** (30 MB) |
| **Descoberta de id** | **TMDB exports** | idem | diária | **medido** (`id` no JSONL) | **n/a** | download + diff local | diário | **0 req de API** |

---

## 11. C.2 e C.3 — A conta dos três desenhos

### Desenho 1 — varredura completa diária

| componente | req/dia | circulou como |
| --- | ---: | ---: |
| detalhe (título + temporada + episódio + pessoa) | **5.329.351** | 335.697 |
| **mídia** (`/images` + `/videos` dedicados) | **8.257.110 (60,5%)** | 471.394 (54%) |
| ofertas | 70.537 | 67.288 |
| **total** | **13.656.998** | 874.379 |

**3,95 DIAS a 40 req/s · 409.709.940 req/mês.**

> **Este desenho deixou de existir.** Ele se chama "varredura completa **diária**", e a
> passagem leva quase quatro dias no nosso próprio teto de ritmo. Não é o desenho caro — é
> o desenho impossível. Ele permanece na tabela apenas como **denominador**: é contra ele
> que a economia dos outros dois é medida.

### Desenho 2 — gatilho diário + preenchimento

**Custo permanente (manutenção), como o pipeline está fiado hoje** — `runChangesSync` não
filtra pelo catálogo, então enfileira todos os 19.372:

| componente | req/dia |
| --- | ---: |
| enumerar o gatilho (195 páginas) | 195 |
| detalhe dos ids alterados | 19.372 |
| mídia dos alterados com key de mídia (~50%, 2 req cada) | 19.372 |
| ofertas | **70.537** |
| exports (download, **fora da cota da API**) | 0 |
| **total** | **109.476** *(circulou como 106.227)* |

**45,6 min/dia · economia de 99,2% (13.547.522 req/dia).**

**Se o gatilho filtrasse pelo nosso catálogo** (piso de **731** ids/dia):

| componente | req/dia |
| --- | ---: |
| enumerar + detalhe + mídia | 1.657 |
| ofertas | 70.537 |
| **total** | **72.194** |

**30,1 min/dia · economia de 99,5%.** Note que aqui **a oferta é 97,7% do custo.**

> **Atenção ao que este número NÃO diz.** A economia de 99,2% supõe que o gatilho substitui
> a mídia. Ele **não substitui a de episódio** — 95% da mídia — porque o `/changes` não a
> nomeia. Este Desenho 2 é o cenário em que essa mídia simplesmente **não é buscada**. É
> exatamente a lacuna que o Desenho 3 compra de volta, e por isso ele custa 5× mais.

**Custo TEMPORÁRIO de preenchimento** — contabilizado **separadamente**, como o prompt
exige: uma passagem única de cobertura sobre a lacuna conhecida. O tamanho depende de
quantas entidades estão incompletas (§17). A 40 req/s, fechar uma lacuna de 100 mil
entidades custa **~42 minutos**, uma vez. **Não entra no custo permanente.**

### Desenho 3 — gatilho diário + reconciliação periódica

| cadência da reconciliação | amortizado/dia | total/dia | economia | janela a 40 req/s |
| --- | ---: | ---: | ---: | ---: |
| **quinzenal** | +910.467 | 1.019.943 | 92,5% | 7,08 h/dia |
| **mensal** | +455.233 | **564.709** | **95,9%** | **3,92 h/dia** |

*(circulou como +58.292 / 164.519 / 81,2% e +29.146 / **135.373** / 84,5% — ERRATA)*

A quinzenal não se justifica: dobra o custo amortizado da reconciliação (910.467 vs
455.233) para reduzir a janela de inconsistência de 30 para 15 dias — numa base cujo dado
mais volátil (a oferta) **já é varrido diariamente por caminho próprio**. **Mensal.** E a
correção **reforça** a escolha: a quinzenal agora consumiria 7 h de janela por dia, contra
3,9 h da mensal.

### O que a correção move para o topo da lista

A reconciliação passou a **dominar** o desenho recomendado: 455.233 de 564.709 req/dia —
**80,6% do custo permanente**. E dentro dela, a mídia de episódio amortizada
(7.842.736 ÷ 30 = **261.425/dia**) é **57,4% da reconciliação e 46,3% do desenho inteiro**.

| se a hipótese *"episódio se manifesta como `season`"* … | Desenho 3 | economia |
| --- | ---: | ---: |
| **não for medida** (estado atual) | **564.709/dia** | 95,9% |
| **se confirmar** — episódio sai da reconciliação | **~303.285/dia** | **97,8%** |

**Uma medição de 9 chamadas de API decide 46% do orçamento permanente.** Com os proxies
errados esse mesmo item valia 3,3% e era razoável deixá-lo para depois. Corrigido o número,
ele é **o primeiro item de medição do plano** — antes de qualquer decisão de cadência.

### C.3 — Quanto o gatilho elimina *(recalculado; agora são TRÊS cenários, não dois)*

**Cenário A — mídia INTEIRA entra no gatilho** *(hipotético — a medição o refuta para 95%
da mídia; mantido como limite superior)*

| | req/dia | |
| --- | ---: | --- |
| Varredura completa | 13.656.998 | |
| Desenho 2 | 109.476 | |
| **Economizado** | **13.547.522** | **99,2%** |

A mídia cairia de **8.257.110 para ~19.372** — 99,8% de redução na maior fatia do custo.

**Cenário B — mídia NÃO entra no gatilho**

| componente | req/dia |
| --- | ---: |
| enumerar | 195 |
| detalhe | 19.372 |
| **mídia varrida** | **8.257.110** |
| ofertas | 70.537 |
| **total** | **8.347.214** |

**Economia de apenas 38,9%** — e a mídia passa a ser **98,9% do custo restante**.

**Cenário C — o que a medição realmente sustenta** *(gatilho cobre filme, série e
temporada; episódio é varrido)*

| componente | req/dia |
| --- | ---: |
| enumerar | 195 |
| detalhe | 19.372 |
| mídia dirigida pelo gatilho (filme + série + temporada) | 19.372 |
| **mídia de EPISÓDIO, varrida** | **7.842.736** |
| ofertas | 70.537 |
| **total** | **7.952.212** |

**Economia de 41,8%** — e a mídia de episódio sozinha é **98,6% do custo restante**.

> **A consequência, sem esconder — e ela mudou de tamanho.** Com os proxies errados, o
> Cenário A parecia o realista e o B o pessimista: *"A.3 separa 88% de economia de 36%"*.
> Corrigido o número, **o Cenário A é hipotético**: ele exige que o gatilho cubra a mídia
> de episódio, que é 95% da mídia e que a medição deste documento mostra **não nomeada**
> pelo `/changes`. O cenário que a evidência sustenta é o C, com **41,8%**.
>
> Por isso o Desenho 3 não é luxo: a reconciliação mensal é o que transforma esses 7,8
> milhões de requisições/dia de episódio em **261.425/dia amortizados**. **A reconciliação
> deixou de ser seguro contra falha silenciosa e passou a ser o mecanismo principal de
> cobertura da maior fatia do acervo.**

**A ressalva que o Cenário A carrega:** ele vale para filme e para imagem de série. A fatia
de **episódio (7.842.736 req = 95% da mídia)** não teve gatilho demonstrado. Enquanto isso
não for medido, a parte de episódio da mídia fica na reconciliação — o que o Desenho 3 já
absorve.

**Estratégia periódica de mídia é justificável?** Sim, e é exatamente o que a reconciliação
mensal faz: a mídia descoberta pelo gatilho entra diariamente; a mídia de episódio e o que
escapou entram uma vez por mês. **Não implementado nesta leva.**

---

## 12. C.4 — O desenho recomendado

# Desenho 3 — gatilho diário + exports + preenchimento + reconciliação mensal

| Papel | Mecanismo | Cadência | Custo/dia |
| --- | --- | --- | ---: |
| **Descoberta** | Daily ID Exports — diff local contra o catálogo | diária | **0 req de API** |
| **Manutenção** | `/changes` (movie, tv, person) | diária | 195 enumeração + 19.372 detalhe |
| **Mídia** | key `images`/`videos` do `/changes` → `/images` + `/videos` dirigidos | diária | ~19.372 |
| **Temporada** | key `season` → busca dirigida pelo `season_number` do payload | diária | 1 req/temporada alterada |
| **Episódio** | **sem gatilho demonstrado** → reconciliação | mensal | amortizado |
| **Ofertas** | append do detalhe para os alterados + varredura dedicada para o resto | diária | ≤ 70.537 |
| **Popularidade** | export diário → `UPDATE` em lote | diária | **0 req de API** |
| **Reconciliação** | varredura completa | mensal | **+455.233** amortizado |
| **Preenchimento** | backfill controlado até fechar a lacuna | **temporário** | fora do permanente |
| **OMDb** | rodízio escalonado por recência + ausência de nota + idade da coleta | diária | **700** |

### Por que ele vence, numericamente

| desenho | custo/dia | economia | risco residual |
| --- | ---: | ---: | --- |
| 1 — varredura completa | **13.656.998** | — | **não executa**: 3,95 dias por passagem |
| 2 — só gatilho | **109.476** | 99,2% | **entidade que nunca muda nunca é revisitada**; falha silenciosa é permanente; **95% da mídia (episódio) nunca é buscada** |
| **3 — gatilho + reconciliação mensal** | **564.709** | **95,9%** | janela máxima de inconsistência: **30 dias** |

*(circulou como 874.379 / 106.227 / 135.373, com economias de 87,9% e 84,5% — ERRATA)*

O Desenho 3 custa **455.233 req/dia a mais** que o Desenho 2 — **3,3% do orçamento da
varredura completa**, a mesma proporção de antes — e compra **duas** coisas que o gatilho
não dá: a garantia de que uma entidade que nunca mudou é revisitada dentro de um mês, **e a
única cobertura existente para a mídia de episódio**, que é 95% da mídia e que o `/changes`
não nomeia.

> **O que a correção muda aqui.** Antes, a reconciliação era um **seguro** contra falha
> silenciosa — bom, mas dispensável se você confiasse no gatilho. Agora ela é também o
> **único mecanismo de cobertura** da maior fatia do acervo. O Desenho 2 deixou de ser
> "arriscado" e passou a ser **incompleto por construção**.

**O Desenho 2 sozinho é uma aposta em que o gatilho nunca erra.** Este repositório já
registrou `/changes` inteiro virando dead-letter em silêncio por um campo faltando no
payload. A reconciliação é o seguro contra exatamente essa classe — e custa 3,3%.

> A recomendação técnica é esta. **A escolha final é do dono do projeto.**

### O pré-requisito que o desenho tem

**O Desenho 3 não funciona sem dar escopo à chave de `sync_media`/`sync_seasons`/
`sync_episodes`.** Com a chave atual, a parte de mídia do gatilho é noop — o desenho
degrada silenciosamente para o Cenário B (36% de economia), com a aparência do Cenário A.
Esse conserto é da **leva 7**, e este documento é a justificativa numérica dele.

---

## 13. O que ficou NÃO DETERMINADO

| Item | O que faltou | Por quê | **Que evidência provaria** |
| --- | --- | --- | --- |
| **A.1** — rodou 30d | execução registrada das filas `changes` e `discovery` | banco de produção inalcançável | `SELECT` em `api_sync_logs` filtrando `provider_api IN ('tmdb','tmdb-exports')` — §17 consulta 1 |
| **A.2** — efeito real | se o `sync_details` do gatilho chegou a gravar | idem | `catalog_jobs` com `run_id LIKE 'scheduler:%'` e `payload->>'reason' = 'changes'` — §17 consulta 2 |
| **A.3** — TV `videos` | `videos` não apareceu em 9 séries | orçamento da regra 9 (26/30 gastas) | amostra de ~50 séries alteradas em 3–5 dias distintos |
| **A.3** — episódio | nenhuma key de episódio observada | idem | `/tv/{id}/season/{n}/changes` para séries com key `season`, mesma janela |
| **A.4** — interseção | quantos dos 19.372 são NOSSOS | banco inalcançável | cruzar os ids do `/changes` com `movies.tmdb_id`/`tv_shows.tmdb_id` — §17 consulta 3 |
| **B.2** — frequência da nota | histórico longitudinal | **o schema não guarda** — `external_ratings` tem UNIQUE por par, sobrescrito no lugar | só uma tabela de histórico responderia. O parcial (`updated_at > created_at`) está em §17 consulta 4 |
| **B.3** — critério | comparação recência × popularidade | banco inalcançável | §17 consulta 5 |
| **B.4** — plano da chave | qual plano OMDb está ativo | **o fornecedor não publica cabeçalho de cota** (medido) | painel do OMDb/Patreon — não há caminho técnico |
| **B.5** — títulos sem sinopse | contagem | banco inalcançável | §17 consulta 6 |
| **Preenchimento** | tamanho da lacuna | idem | §17 consulta 7 |

---

## 14. O SQL que fecha o que faltou

Painel → `rss_prime` → `screen-db` → `>_` → **Bash** → `psql -U screena -d screena`.
Leitura pura. Nenhuma escrita. **`api_providers` não é tocada.**

```bash
psql -U screena -d screena <<'SQL'
\echo '=== 1. A.1 — AS FILAS changes E discovery RODARAM NOS ULTIMOS 30 DIAS? ==='
SELECT provider_api, date_trunc('day', created_at) AS dia, status,
       count(*) AS execucoes, sum(quota_cost) AS cota
  FROM api_sync_logs
 WHERE provider_api IN ('tmdb','tmdb-exports')
   AND created_at > now() - interval '30 days'
 GROUP BY 1,2,3 ORDER BY 2 DESC, 1;

\echo '=== 2. A.2 — O GATILHO PRODUZIU JOB DE VERDADE? ==='
SELECT job_type, payload->>'reason' AS motivo, status, count(*) AS jobs,
       min(created_at) AS primeiro, max(created_at) AS ultimo
  FROM catalog_jobs
 WHERE payload->>'reason' = 'changes'
 GROUP BY 1,2,3 ORDER BY 4 DESC;
-- zero linhas => o gatilho NUNCA enfileirou nada, e A.1 vira irrelevante.

\echo '=== 2b. A.2 — O FILHO DE MIDIA E MESMO NOOP? (duplicados por tipo) ==='
SELECT job_type, count(*) AS total,
       count(*) FILTER (WHERE status = 'succeeded') AS succeeded,
       count(DISTINCT external_id)                  AS entidades_distintas
  FROM catalog_jobs
 WHERE job_type IN ('sync_details','sync_media','sync_seasons','sync_episodes')
 GROUP BY 1 ORDER BY 2 DESC;
-- total ~= entidades_distintas em sync_media => write-once confirmado.

\echo '=== 3. A.4 — QUANTOS DOS 19.372 IDS/DIA SAO NOSSOS? ==='
SELECT 'movies' AS t, count(*) AS no_catalogo FROM movies
UNION ALL SELECT 'tv_shows', count(*) FROM tv_shows;
-- Compare com o universo TMDB (~1,23 M filmes, ~228 k series).
-- A intersecao REAL exige cruzar os ids do /changes; o piso uniforme e ~731/dia.

\echo '=== 4. B.2 — A NOTA JA MUDOU ALGUMA VEZ? (o schema nao guarda historico) ==='
SELECT rating_source, metric,
       count(*)                                        AS linhas,
       count(*) FILTER (WHERE updated_at > created_at) AS ja_mudaram,
       round(avg(EXTRACT(EPOCH FROM (fetched_at - created_at))/86400)::numeric, 1) AS dias_medios_de_vida
  FROM external_ratings
 GROUP BY 1,2 ORDER BY 3 DESC;

\echo '=== 5. B.3 — RECENCIA PREVE VOLATILIDADE MELHOR QUE POPULARIDADE? ==='
SELECT CASE
         WHEN m.release_date IS NULL                          THEN '(sem data)'
         WHEN m.release_date > now() - interval '14 days'      THEN 'a) <= 14 dias'
         WHEN m.release_date > now() - interval '60 days'      THEN 'b) 15-60 dias'
         WHEN m.release_date > now() - interval '365 days'     THEN 'c) 61-365 dias'
         ELSE                                                       'd) > 1 ano'
       END AS faixa_de_idade,
       count(*)                                        AS notas,
       count(*) FILTER (WHERE r.updated_at > r.created_at) AS ja_mudaram,
       round(100.0 * count(*) FILTER (WHERE r.updated_at > r.created_at)
             / NULLIF(count(*),0), 1)                   AS pct_que_mudou,
       round(avg(m.popularity)::numeric, 1)             AS popularidade_media
  FROM external_ratings r
  JOIN movies m ON m.id = r.entity_id AND r.entity_type = 'movie'
 GROUP BY 1 ORDER BY 1;
-- Se pct_que_mudou cai com a idade, RECENCIA vence. Se acompanha popularidade, nao.

\echo '=== 6. B.5 — QUANTOS TITULOS SEM SINOPSE ==='
SELECT 'movies' AS t, count(*) AS total,
       count(*) FILTER (WHERE overview IS NULL OR btrim(overview) = '') AS sem_sinopse
  FROM movies
UNION ALL
SELECT 'tv_shows', count(*),
       count(*) FILTER (WHERE overview IS NULL OR btrim(overview) = '')
  FROM tv_shows;

\echo '=== 7. PREENCHIMENTO — O TAMANHO DA LACUNA ==='
SELECT 'movies sem imdb_id'   AS lacuna, count(*) FROM movies   WHERE imdb_id IS NULL
UNION ALL SELECT 'tv sem imdb_id',        count(*) FROM tv_shows WHERE imdb_id IS NULL
UNION ALL SELECT 'movies sem last_synced', count(*) FROM movies   WHERE last_synced_at IS NULL
UNION ALL SELECT 'tv sem last_synced',     count(*) FROM tv_shows WHERE last_synced_at IS NULL;

\echo '=== 8. OS NUMEROS REAIS (censo truncou em 100.000) ==='
SELECT 'seasons' t, count(*) n FROM seasons
UNION ALL SELECT 'episodes', count(*) FROM episodes
UNION ALL SELECT 'people',   count(*) FROM people;
SQL
```

---

## 15. Orçamento externo gasto

| Provedor | Gasto | Limite | Uso |
| --- | ---: | ---: | --- |
| **TMDB** | **26** | 30 | 9 (A.4 globais) + 9 (A.3 rodada 1) + 2 (estrutura do item) + 1 (global tv pág. 2) + 5 (A.3 rodada 2) |
| **OMDb** | **2** | 10 | 1 (B.5 `Plot` + `Ratings[]`) + 1 (sonda de estado da chave) |
| `files.tmdb.org` | 7 HEAD + 1 Range de 64 KB | 1 arquivo | **Nenhum arquivo baixado inteiro** — os HEAD só leram `Content-Length` |

As chamadas globais de A.4 foram **reaproveitadas** por A.3, como o enunciado pediu: A.3
gastou **0** chamadas globais próprias.

---

## 16. Portões

**Esta leva não alterou código.** O único arquivo criado é este documento. Nenhum portão de
build/teste era aplicável; ainda assim, o único teste tocado pela investigação
(`tests/governance/tmdb-append-consumption.test.ts`) foi executado e passa — 13 testes.

---

## 17. As 25 perguntas, respondidas

| # | Pergunta | Resposta |
| --: | --- | --- |
| 1 | TMDB `/changes` existe no cliente? | **SIM** — `catalog.ts:341,344,347` |
| 2 | É chamado? | **SIM** — `catalog-services.ts:875-877` |
| 3 | É agendado? | **SIM** — fila `changes`, 6 h |
| 4 | Rodou? | **NÃO DETERMINADO** — falta `api_sync_logs` |
| 5 | Produziu efeito? | **Parcialmente, por construção:** SIM no detalhe; **NÃO na mídia/temporada/episódio** (chave do filho sem escopo) |
| 6 | Movie `/changes` sinaliza mídia? | **SIM** — `images` e `videos` |
| 6b | TV `/changes` sinaliza mídia? | **SIM para `images`**; `videos` **não demonstrado** em 9 |
| 6c | Seguro como gatilho de mídia? | **NÃO, para o volume** — **~5%** da mídia coberta; **episódio (95%)** descoberto *(circulou como 58%/42% — ERRATA)* |
| 7 | Quantos ids mudam por dia? | **19.372** em todo o TMDB; **~731** nossos (piso) |
| 8 | Substitui a varredura de detalhe? | **SIM** — **5.329.351** → 19.372 |
| 9 | Substitui a de mídia? | **Filme: sim. Série: para imagem. Episódio: não demonstrado.** |
| 10 | O que exige preenchimento? | Entidades que nunca mudaram, incompletas ou anteriores à nossa sincronização |
| 11 | O que exige reconciliação? | Falha silenciosa, job morto, mídia de episódio, e o que o gatilho não nomeia |
| 12 | Para que servem os exports? | Descoberta de id (já usado) **e** popularidade (não usado) |
| 13 | Exports para descoberta? | **SIM — já é o que a fila `discovery` faz** |
| 14 | Exports para popularidade? | **SIM, e está desperdiçado** — `popularity` vem no arquivo e nada a persiste |
| 15 | Append `changes` é útil? | **Potencialmente útil, hoje inerte** — chega depois da decisão que informaria |
| 16 | OMDb tem gatilho? | **NÃO** — confirmado na doc oficial |
| 17 | Frequência de `rating_value`? | **NÃO DETERMINADO** — o schema não guarda histórico |
| 18 | Frequência de `rating_count`? | **NÃO DETERMINADO** — mesma causa |
| 19 | Recência prevê melhor que popularidade? | **NÃO DETERMINADO** — SQL na §14 consulta 5. Mas popularidade mede **atenção**, não volatilidade |
| 20 | Critério composto para a OMDb? | recência × ausência de nota × idade da coleta, popularidade como **desempate** — forma final vem do dado |
| 21 | Envelope de cota recomendado? | **700/dia** — folga de 150, volta em 96 dias |
| 22 | O que ocorre no estouro? | **HTTP 200 + `Response:"False"`; a string não é reconhecida; o breaker não abre; o lote continua queimando cota.** O título não é envenenado — volta no próximo ciclo |
| 23 | `Plot` serve para pt-BR? | **NÃO** — vem em inglês |
| 24 | Quanto custa cada desenho? | **13.656.998** · **109.476** · **564.709** req/dia *(circulou como 874.379 · 106.227 · 135.373)* |
| 25 | Qual adotar? | **Desenho 3** — 95,9% de economia, janela de inconsistência de 30 dias. E agora **por viabilidade**, não só por economia: o Desenho 1 leva 3,95 dias por passagem |

---

## 18. Critério de aceitação — a resposta em uma frase

> Com o Desenho 3, gastaríamos **~109.476 chamadas/dia em manutenção**,
> **~455.233/dia amortizadas em reconciliação** (uma varredura completa por mês) e
> **0 em descoberta e popularidade** (os exports estão fora da cota da API) —
> mais um **custo temporário de preenchimento**, contabilizado à parte e que termina —
> em vez de **13.656.998 chamadas diárias por força bruta**, que **não cabem num dia**.
>
> **Total permanente: 564.709 req/dia (3,92 h a 40 req/s). Economia: 95,9%.**

*(esta frase circulou com 106.227 · 29.146 · 874.379 · **135.373 req/dia · 84,5%** — todos
derivados dos proxies deslocados; ver ERRATA no topo)*

E o pré-requisito, dito uma vez mais porque o número inteiro depende dele: **enquanto a
chave de idempotência de `sync_media` não tiver escopo, a parte de mídia deste desenho é
noop, e a economia real cai de 99,2% para 38,9% — com a aparência de estar funcionando.**

**E o segundo pré-requisito, que a correção promoveu a primeiro:** medir se a chave
`season` do `/changes` acompanha alteração de episódio. Ela decide **46% do orçamento
permanente** (564.709 contra ~303.285 req/dia) e custa 9 chamadas de API.
