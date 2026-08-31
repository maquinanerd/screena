# Relatório da PR #249 — o texto já estava no banco, e o censo media o próprio teto

> O que segue é o desfecho **medido**, não a intenção da leva. Onde eu não medi,
> está escrito que não medi — e o que falta medir está com o comando pronto.

**PR:** https://github.com/maquinanerd/screena/pull/249 · **MERGEADA**
**Em `main`:** `0493283` (squash) · **mergeada em:** 2026-08-28T18:57:48Z
**Base:** `8f97770` (#246) · atualizada **três vezes** durante a leva, até `1340e8c` (#252)
**Diff:** 22 arquivos · +2.856 / −253
**Commits da branch:** `0062788` · `cd7daef` · `de8d7f7` · `3f46a3c`, mais três merges de `main` (`c027e8e`, `881178a`, `482bb35`)

### CI

| execução | commit | desfecho |
| --- | --- | --- |
| `33185214056` | `0062788` | success |
| `33185693953` | `cd7daef` | success |
| `33186407924` | `de8d7f7` | success |
| `33186904934` | `3f46a3c` | success |
| `33193817712` | `c027e8e` (com #250/#251) | success |
| `33196451916` | `881178a` (com #247) | success |
| `33199041266` | `482bb35` (com #252) | success |

**Sete execuções, sete verdes.**

**Merge:** por auto-merge (squash), assim que o último check fechou. A PR ficou
`BEHIND` **três vezes** porque o CI leva ~31 min e `main` recebeu PR a cada
~20–30 min (#250, #251, #247, #252). A cada volta eu mergeei `main`, conferi que
os arquivos não colidiam e reverifiquei o que fazia sentido — a #247 mexeu na
ficha de filme, então reexecutei `validate:synopsis-render` (4/4).

**Não usei `--admin`.** Ele mergearia por cima dos checks obrigatórios, e o verde
reportado aqui só vale porque esse gate existe.

### O estado depois desta leva, em cinco linhas

1. O **extrator** de sinopse e biografia passou a ler a entrada `pt-BR` do bloco
   `translations` quando o campo de topo vem vazio — que é o que o TMDB devolve
   para todo título sem tradução no idioma pedido.
2. O **censo de indexabilidade** deixou de parar em 100.000 por tipo. Passou a
   paginar por chave, varrer o tipo inteiro por padrão, e **declarar** quando um
   teto explícito cortou a varredura.
3. Existe um **backfill** (`catalog backfill-text`) que recupera o texto do
   payload já guardado, sem chamar o TMDB.
4. **Nada disso foi executado em produção.** Nenhum `--apply` de indexabilidade,
   nenhuma escrita, nenhuma chamada externa. Os números de produção deste
   relatório são os do enunciado, de 2026-08-28 — não são novos.
5. As **32.087 pessoas** em `no_biography` **não saem de lá por extração**, e
   isso está provado contra PostgreSQL real. É decisão de licença, humana.

---

## Sumário em uma linha

O enunciado dizia "86% do corte são dois bugs de extração, não qualidade" — e
estava certo nos dois bugs, mas **o censo que os mediu estava truncado**, então
os 306.800 nunca foram o total: eram piso. Os dois defeitos são de uma linha
cada, e o texto que faltava já estava pago, baixado e arquivado no banco.

---

## 1. O enunciado

O pedido veio em seis itens (A a F), com uma regra de honestidade explícita:

> Se você medir e o número não bater com o que está aqui, **o número manda e este
> documento se corrige.**

E nomeava o defeito-assinatura do projeto:

> **um backfill que reporta "N títulos processados" sem verificar que o texto
> ficou legível na página.** Processar não é recuperar.

O pedido original está na íntegra no **Apêndice A**.

Três afirmações do enunciado se confirmaram e uma se corrigiu:

| afirmação do enunciado | veredito |
| --- | --- |
| `translations` já é pedido em toda requisição de detalhe | **confirmado** (`MOVIE_APPEND`, `TV_APPEND`, `PERSON_APPEND`) |
| o extrator lê só o `overview` de topo | **confirmado** (`display-fields.ts`) |
| `biography` sofre da mesma doença | **confirmado** — e é pior que isso (§4) |
| "os três primeiros somam 264.434 — 86% do corte" | **piso, não total** — o censo estava truncado (§2) |

---

## 2. Item A — o teto de 100.000

### 2.1 Onde estava (A.1)

`services/ingestion/src/persistence/indexability-writer.ts:497`:

```ts
const limit = options.limit ?? 100_000
```

Esse `limit` virava um `LIMIT` de SQL **por tipo de entidade**, em `factsSql()`.
`movie` (34.802) e `tv` (32.486) ficavam abaixo dele; `season`, `episode` e
`person` batiam nele e paravam. Daí os três 100.000 idênticos.

### 2.2 O dano não é "faltaram linhas"

É que o **denominador estava errado**, e ele é usado para decidir:

```
flipRatio = flips / evaluated
```

O freio de mudança em massa (`evaluateMassChangeBrake`) compara esse `flipRatio`
com um teto de 5%. Com `evaluated` truncado, o freio media contra um universo que
não existe. E o relatório somava "306.800 noindex" como se fosse o corte inteiro.

Um detalhe que **não** estava quebrado, e vale registrar porque seria o erro
óbvio: `readPublishableSeriesIds` — o gate herdado de temporada e episódio — já
lia com `LIMIT ALL`. Se ele também tivesse teto, temporadas legítimas cairiam em
`parent_not_publishable` e a cascata inteira seria fantasma.

### 2.3 O conserto (A.2, A.3)

- Leitura **paginada por chave** (`e.id > último`, `FACTS_PAGE_SIZE = 20_000`).
  Keyset, não `OFFSET`: o `ORDER BY e.id` já existia em todas as consultas.
- Default passa a ser **sem teto**.
- `--limit` continua existindo como teto **declarado** do operador, e agora sai:
  - no JSON, como `truncatedTypes` e `byEntityType.<tipo>.truncated`;
  - em **texto**, num aviso no topo da saída.

### 2.4 Um refinamento que fiz depois, e por quê

A primeira versão marcava `truncated` quando `evaluated >= cap`. Isso reporta
truncamento para um tipo que tem **exatamente** `cap` linhas — e foi lido
inteiro. Um falso positivo aqui faz o operador desconfiar de um censo completo,
que é o oposto do que o campo existe para fazer.

A varredura passa a confirmar o fim com uma **sonda de uma linha** depois do
teto, em vez de deduzir do número. Custa um `LIMIT 1` por tipo, e só no caminho
em que o operador declarou um teto. Há check de fronteira: `--limit` igual ao
total devolve `truncatedTypes: []`.

### 2.5 O que eu **não** consegui fazer

**A.4 — os números verdadeiros de temporada, episódio e pessoa: não medidos.**
O `DATABASE_URL` deste checkout resolve `rss_prime_screen-db`, hostname interno
do Docker. Da máquina local dá `ENOTFOUND`. Comando pronto em §11.1.

**A.5 — quantos títulos sem sinopse estão em `dead_letter`: não medido.** SQL em
[`docs/operations/text-recovery-measurement.md`](docs/operations/text-recovery-measurement.md) §3.

---

## 3. Item B — a sinopse e a biografia

### 3.1 A cadeia que perdia o dado

O detalhe do TMDB é pedido com `language=pt-BR`. Quando o título **não tem**
tradução naquele idioma, `overview` volta **string vazia** — não ausente, não em
inglês:

```
""  →  null  →  upsertTranslation(…, null)  →  summary = NULL  →  no_synopsis
```

O título tinha cadeia de fallback (`title` → `original_title`). A sinopse não
tinha nenhuma.

### 3.2 O texto já estava no banco

`MOVIE_APPEND`, `TV_APPEND` e `PERSON_APPEND` já pediam `translations` em **toda**
requisição de detalhe. E — o ponto que muda o custo — o `fetcher` do cache é o
endpoint RICO, então **`api_cache.payload` guarda a resposta inteira**, com o
bloco de traduções, para toda entidade sincronizada por `catalog sync`. O rótulo
`append_to_response=external_ids,credits` aparece só na CHAVE do cache, não na
requisição.

Ou seja: a cota foi paga, o byte foi baixado, o byte foi arquivado. O que faltava
era **leitura**.

### 3.3 O conserto (B.1, B.2, B.3, B.4)

Módulo puro novo — `services/ingestion/src/localized-text.ts` — com precedência
explícita:

1. campo de topo (`overview` / `biography`), quando não vazio
2. entrada `pt-BR` dentro de `translations`, quando não vazia
3. `null` — sem inventar

E com **proveniência** no valor de retorno (`'detail'` / `'translations'` /
`null`). Sem isso, uma sinopse recuperada do bloco fica indistinguível de uma que
sempre esteve no campo principal, e a próxima investigação começa do zero.

`pt-PT` **não entra** — é decisão editorial do dono (Item E), e há teste travando
a recusa. E texto existente **nunca** é sobrescrito: a garantia é do PostgreSQL,
na mesma instrução (§6).

### 3.4 `append-consumption.ts` — quais entradas continuam mentindo (B.5)

**Nenhuma.** Auditei as 17 entradas de `APPEND_CONSUMED` abrindo o módulo citado
em cada uma e procurando o campo:

| par `(tipo, valor)` | módulo citado | lê mesmo? |
| --- | --- | --- |
| `credits` (movie, tv) | `normalizers/credits.ts` | sim |
| `credits` (tv_episode) | `episodes/normalize.ts` | sim (`credits.cast`) |
| `external_ids` (movie, tv, person) | `normalizers/external-ids.ts` | sim |
| `external_ids` (tv_episode) | `episodes/normalize.ts` | sim |
| `images` (movie, tv, person) | `catalog-sync/media-normalize.ts` | endpoint próprio, **declarado** |
| `images` (tv_season) | idem | endpoint próprio, **declarado** |
| `images` (tv_episode) | `episodes/normalize.ts` | sim (`images.stills`) |
| `videos` (movie, tv) | `catalog-sync/media-normalize.ts` | endpoint próprio, **declarado** |
| `videos` (tv_season, tv_episode) | idem | endpoint próprio, **declarado** |
| `watch/providers` (movie, tv) | `normalizers/watch-providers.ts` | sim |
| `recommendations` (movie, tv) | `normalizers/recommendations.ts` | sim |
| `similar` (movie, tv) | `normalizers/recommendations.ts` | sim |
| `release_dates` (movie) | `normalizers/detail-facts.ts` | sim |
| `content_ratings` (tv) | `normalizers/detail-facts.ts` | sim |
| `keywords` (movie, tv) | `catalog-entities/normalize.ts` | sim |
| `alternative_titles` (movie, tv) | `catalog-entities/normalize.ts` | sim |
| `translations` (movie, tv, person) | `localized-text.ts` | **novo nesta leva** |

Os "4 de 19" que o enunciado cita foram corrigidos em **2026-08-27**, antes desta
branch — `keywords` e `alternative_titles` (declaravam dívida onde havia consumo)
e `aggregate_credits` e `combined_credits` (apontavam para módulos onde a string
nunca existiu). Os comentários no arquivo registram cada uma.

`translations` continua **adiado** em `tv_season` e `tv_episode`. É a mesma
dívida, ainda não paga, agora declarada com o número — §12.1.

---

## 4. O achado que muda o cálculo: `no_biography` não é extração

Esta é a parte do relatório que eu mais quero que seja lida.

O gate de biografia é **duplo**:

```sql
BTRIM(COALESCE(biography,'')) <> ''
AND biography_source_status::text IN ('official','licensed','third_party')
```

`people.biography_source_status` nasce `unknown`. Varri o repositório inteiro,
por **dois caminhos independentes** (grep dirigido por diretório e varredura
ampla repo-wide): **nada escreve nessa coluna** além do `DEFAULT` da migration e
de fixtures de validador. Nenhum CLI, nenhum worker, nenhum serviço. O bundle
compilado só a **lê**.

**Consequência:** um backfill que preencha `people.biography` reporta "32.087
pessoas processadas" e muda **zero** vereditos. É exatamente o defeito-assinatura
que o enunciado nomeou, num lugar onde ninguém tinha olhado.

O validador prova as duas metades, contra PostgreSQL real:

```
[PASS] PESSOA: bio preenchida e MESMO ASSIM `no_biography` — a licenca e o gate
[PASS] CONTROLE: liberando a licenca a MESMA pessoa passa a indexar
```

Liberar a exibição é decisão de licença — humana por definição (CLAUDE.md §6,
invariante 6). **Não fiz, e não devo fazer.**

Por isso o relatório do `backfill-text` separa **preenchida** de **exibível**. Um
número que some as duas está mentindo.

---

## 5. Item C — as 66.688 pessoas sem slug

### 5.1 A causa, identificada no código (C.1)

`upsertPeopleStubs` (`services/ingestion/src/persistence/store.ts:65`) cria uma
linha em `people` para **cada** membro de elenco e equipe de **cada** título
ingerido — o `append_to_response=credits` traz o elenco inteiro. Esse caminho
**nunca** chama `createPrismaCatalogFinalize`: não cria slug, não cria tradução.

Slug de pessoa nasce em exatamente dois lugares:

1. `sync_details` com `kind='person'` (`finalizeDetail` em `catalog-services.ts`);
2. a promoção de `tmdb_raw` (`raw-promote/run.ts`).

Os dois só rodam para pessoas **explicitamente enfileiradas**. Uma pessoa que
entrou como efeito colateral do elenco de um filme nunca passa por nenhum deles.

Daí a proporção de duas em cada três. **Não é página fina — é página que nunca foi
criada.**

### 5.2 Por que não consertei (C.3)

O enunciado autoriza: *"Conserte a causa dominante, **se for conserto pequeno e
claro**. Se for grande, não conserte."*

O reparo **já existe** e é operacional, não de código: `catalog
backfill-finalization` cria slug para as pessoas elegíveis. Escrever um segundo
gerador de slug seria duplicar a parte mais sutil do catálogo (colisão, 301,
transação).

### 5.3 C.2 e C.4 — não medidos

O SQL que quebra por causa (nome vazio / alfabeto não latino / sem crédito
publicável / nunca sincronizada) e que responde "quantas voltariam a ter URL"
está em [`docs/operations/text-recovery-measurement.md`](docs/operations/text-recovery-measurement.md) §5.

**Há uma ordem que importa:** a elegibilidade de pessoa exige crédito em obra
**publicável**, e obra publicável depende de ter sinopse. Medir pessoa **antes**
de recuperar filme e série **subestima** o resultado.

> Os slugs `tmdb-1465816` / `tmdb-1729257` que o enunciado cita são outro
> mecanismo: ali o slug **existe**, só é feio. Não confundir com ausência.

---

## 6. Item D — o backfill

`catalog backfill-text` (`services/ingestion/src/persistence/text-backfill.ts`).

| exigência | como foi atendida |
| --- | --- |
| D.1 zero chamadas ao TMDB | `externalCallsMade` é sempre 0, e o relatório o declara |
| D.2 `ON CONFLICT`, não exceção capturada | `INSERT … ON CONFLICT … DO UPDATE … WHERE` — avaliado pelo PostgreSQL na mesma instrução |
| D.3 lotes, progresso, retomável | lote de 500, progresso em stderr, `checkpoint` por tipo |
| D.4 log de sync | `api_sync_logs`, `quota_cost = 0` |
| D.5 aviso do cache | na saída do comando, no `--help` e no doc de operação |
| D.6 preparar e parar | **não rodei contra produção** |

### 6.1 A regra de precedência **não** mora no SQL

A consulta só **reduz** o payload para transporte: devolve o campo de topo e as
entradas de `translations` cujo `iso_639_1` é `pt` — as duas regiões. Quem escolhe
entre topo e bloco, e entre `BR` e `PT`, é o TypeScript.

A redução existe por **memória**, não por política: um detalhe de filme popular
com todos os appends passa de 300 KB, e um lote de 500 linhas traria 150 MB de
JSON para escolher um parágrafo. Filtrar por `pt` no SQL corta isso para centenas
de bytes por linha **sem decidir nada** — e `pt-PT` viaja junto justamente para
que a medição do Item E saia da mesma passagem.

### 6.2 D.5 — o aviso operacional, por extenso

Desde 28/08 as fichas são cacheadas: **1 h no edge da Cloudflare, 4 h no
navegador**. Depois do backfill, a página **não** mostra o texto novo na hora.

**"A página ainda não mudou" NÃO é prova de que a extração falhou.** É sucesso
medido em proxy, com o sinal invertido.

Confira nesta ordem:

1. **O banco** — única fonte sem cache:
   ```sql
   SELECT summary FROM entity_translations
    WHERE entity_type = 'movie' AND entity_id = <id> AND language_code = 'pt-BR';
   ```
2. **O veredito** — `pnpm catalog index-decisions --dry-run`. Preencher o texto
   **não** reescreve `page_indexability_decisions` sozinho.
3. **A página** — por último, com o cache da Cloudflare purgado, em janela anônima.

---

## 7. Item E — pt-PT: medido, não implementado

O extrator **recusa** `pt-PT`, e há teste travando a recusa
(`localized-text-extraction.test.ts`, caso 6): se um dia entrar, aquele teste
fica vermelho — que é como a mudança se torna visível em vez de silenciosa.

O que a leva entrega é a **medição**, no mesmo `--dry-run`:

- `recoverableOnlyWithPtPt` — quantos títulos só o português europeu recuperaria;
- `ptPtSamples` — até 20 sinopses `pt-PT` reais, com o texto, para julgar
  legibilidade (E.2).

A medição olha os **dois** payloads guardados (`api_cache` e `tmdb_raw`), não só
o escolhido — senão subestimaria na entidade que tem pt-PT só no arquivo bruto.

**E.1 e E.2 não foram medidos** — dependem de produção.

---

## 8. As provas — nenhuma passa por `grep` no fonte

### 8.1 `localized-text-extraction.test.ts` (F.1) — 12 casos

Substitui `display-fields-synopsis-loss.test.ts`. Cada recuperação é provada
**duas vezes**: que a cadeia nova acha o texto, e que o extrator antigo —
reproduzido no arquivo como gêmeo — **não** acha.

### 8.2 `validate-text-recovery-real-postgres.ts` (novo) — **35/35**

PostgreSQL 16 real e efêmero. Cobre D, F.3, F.4 e A.6:

```
[PASS] LINHA DE BASE: o filme 101 esta noindex por `no_synopsis`
[PASS] LINHA DE BASE (CASCATA): temporada e episodio caem por `parent_not_publishable`
[PASS] FILME: a sinopse sai do bloco `translations` e chega em entity_translations
[PASS] payload guardado SO em `tmdb_raw` tambem e lido
[PASS] so `en` no bloco -> NAO recupera (nao ha fallback de idioma)
[PASS] so `pt-PT` -> NAO recupera, mas E MEDIDO (Item E)
[PASS] ON CONFLICT ... WHERE: a escrita sobre texto EXISTENTE e recusada pelo PostgreSQL
[PASS] CONTROLE POSITIVO do guard: sobre summary VAZIO a mesma escrita passa
[PASS] a SEGUNDA execucao nao grava nada, e o conjunto de candidatos ENCOLHEU
[PASS] F.3 — o filme 101 sai de `no_synopsis` e entra em `index`/`eligible`
[PASS] F.4 — recuperar a SERIE devolve a temporada ao indice (cascata)
[PASS] F.4 — e o EPISODIO junto (e aqui que moram 116.004 paginas em producao)
[PASS] A.3/A.4 — sem teto, o censo soma o TOTAL REAL — evaluated=100001
[PASS] CONTROLE NEGATIVO — com --limit 100000 (o default antigo) o censo perde a ultima linha
[PASS] A.2 — e AGORA ele se declara TRUNCADO em vez de passar por medicao
[PASS] --limit IGUAL ao total NAO e truncamento (o tipo foi lido inteiro)
[PASS] o DENOMINADOR do freio muda junto (era o efeito invisivel do teto)
```

O controle negativo do Item A é **executado**: semeia **100.001** filmes — um a
mais que o antigo default — e prova que `--limit 100000` ainda perde a última
linha, mas agora **se declara** truncado.

### 8.3 `validate-synopsis-render-real-postgres.ts` (novo) — **4/4** (F.2)

Importa a rota real (`app/pt/filmes/[slug]/page.tsx`), aguarda o componente
async como o Next aguardaria, e renderiza para HTML.

**E procura o texto FORA dos `<script>`.** Procurar no markup inteiro casaria com
o `description` do JSON-LD e "provaria" que a página *mostra* um texto que ela
apenas *declara* — a diferença inteira entre um leitor ler a sinopse e um crawler
achar uma string.

### 8.4 Controle negativo executado (F.5)

Reintroduzi o defeito no extrator (retorno antecipado depois do campo de topo) e
rodei:

```
× (1) FILME: overview de topo vazio + pt-BR no bloco -> sinopse preenchida
  → expected null to be 'Sinopse em portugues do Brasil, que o…'
× (2) SERIE: mesmo caso (a serie e o maior balde do censo real)
× (8) PESSOA: biografia de topo vazia + pt-BR no bloco -> biografia preenchida
Tests  3 failed | 9 passed (12)
```

Restaurado: 12/12 verdes.

### 8.5 Três testes que teriam passado pelo motivo errado

Este é o valor real dos controles negativos nesta leva.

**(a) O teste que previa ficar vermelho e não ficou.**
`display-fields-synopsis-loss.test.ts` dizia no cabeçalho: *"quando alguém
consumir o bloco, ESTES TESTES VÃO FICAR VERMELHOS"*. Consumi o bloco e eles
continuaram **verdes**. O fixture tinha uma única tradução `en`/`US`, e a regra
nova aceita só `pt`/`BR` — devolvia `null` nos dois mundos, corretamente. **Um
teste que só exercita o caso que a regra recusa não distingue mundo nenhum.**
Reescrito com casos em pares: o que a regra recupera **e** o que ela continua
recusando.

**(b) O guard de `ON CONFLICT` que nunca executou.**
O check "não sobrescreve texto existente" passava **verde sem a instrução ter
rodado uma vez**: uma entidade que já tem texto não entra no conjunto de
candidatos do backfill. O que o guard protege é a **corrida**. Exportei a
primitiva de escrita para chamá-la direto, com controle positivo (sobre linha
vazia, escreve) e os três ramos: recusa, update-de-vazio e insert puro.

**(c) O validador que contribuía zero asserções.**
`validate:person-eligibility` morria no `initdb --encoding=UTF8` **antes de
qualquer check**, e fazia `validate:all` reportar `FALHOU` por motivo de
ambiente. Ao dar-lhe o escape hatch, apareceu um bug latente: `prismaBin()`
resolvia `prisma/package.json` a partir de `apps/web/scripts`, onde `prisma` não
é dependência. No Linux do CI ele passava; aqui falhava. **Duas máquinas, dois
resultados, nenhum dos dois medindo o defeito real.** Corrigido: `validate:all`
foi de 148/149 local para **161/161** no CI.

---

## 9. Dois defeitos que só apareceram ao exercitar a CLI

Encontrados depois de abrir a PR, rodando o comando contra um PostgreSQL real —
não lendo o código.

### 9.1 `--locale` diferente de pt-BR gravava tradução cega

`pickLocalizedText` lê a entrada `pt-BR`, sempre. A coluna gravada usava o
`--locale` do comando. `backfill-text --locale en-US --apply` escreveria o texto
pt-BR numa linha `en-US` de `entity_translations` — tradução cega, que a
invariante 7 proíbe exatamente por isso.

Passa a recusar, com a razão na mensagem: aceitar outro idioma exige mudar a
**regra** de extração, não passar uma flag.

### 9.2 A falha do log de sync derrubava o comando depois do trabalho

`api_sync_logs.provider_api` tem FK para `api_providers`. Num banco sem a linha
`tmdb`, a exceção subia e matava o comando **depois** de ele ter percorrido o
catálogo e gravado sinopses — sem imprimir uma linha do relatório. O operador
ficava com um stack trace e nenhuma ideia do que foi escrito: **pior que a
ausência do log, que era o problema que o log resolve.**

Agora a falha é reportada em voz alta, o relatório sai assim mesmo, e o comando
termina em `EXIT_CODES.failed` (4). Medido nos dois sentidos: sem a linha `tmdb`,
exit 4 com a causa e o relatório completo; com ela, exit 0 e a linha gravada
(`endpoint=backfill-text/movie+tv+person?dry-run=1`, `quota_cost=0`).

---

## 10. Portões

Todos medidos.

| portão | resultado |
| --- | --- |
| `pnpm typecheck` (raiz + runtime) | ok |
| `pnpm typecheck:apps` (web + admin + cms) | ok |
| `pnpm lint` | ok |
| `pnpm test` | **569 arquivos · 7.412 testes** |
| `pnpm audit:invariants` | 7 ok, 0 violações |
| `pnpm audit:render` | 2 ok, 0 violações |
| `pnpm build` | ok |

Validadores reais de PostgreSQL:

| validador | checks |
| --- | --- |
| `validate:text-recovery` (**novo**) | 35/35 |
| `validate:synopsis-render` (**novo**) | 4/4 |
| `validate:all` (7 validadores web) | **161/161** |
| `validate:indexability-producer` | 26/26 |
| `validate:index-decisions-cli` | 16/16 |
| `validate:seo-runtime` | 141/141 |
| `validate:season-episode-routes` | 32/32 |
| `validate:tmdb-platform` | 15/15 |
| `validate:catalog-platform-complete` | 82/82 |

Os dois validadores novos foram **registrados no CI** — uma prova que não roda
não é portão.

> **Sobre o total da suíte.** 7.399 antes; 7.406 com a minha mudança (removi um
> arquivo de 5 testes, adicionei um de 12: **+7**); 7.412 depois de mergear
> `main` (a #247 trouxe 6 testes de contrato editorial). **O delta fecha em cada
> passo** — é assim que se percebe um recorte silencioso.

### 10.1 Um vermelho que não era regressão

Depois de mergear `main` (que trazia a #250), a suíte deu **1 failed | 7405
passed**:

```
× (7) o BUILD concorda com o registro — intencao declarada vs. decisao do Next
  → expected [ Array(1) ] to deeply equal []
```

A prova (7) de `tests/web/route-cache-policy.test.ts` lê
`apps/web/.next/prerender-manifest.json` — e o meu `.next` era de **antes** da
#250 ter removido o `generateStaticParams` da ficha de série. Reconstruí:
`/pt/series/[slug]` saiu de `dynamicRoutes`, e o teste voltou a 8/8.

Registro porque a mensagem fala de "intenção declarada vs. decisão do Next" e
**parece defeito de código**: um agente apressado reverteria trabalho alheio.

---

## 11. O que ainda tem que ser feito

Nada disto é código. Tudo depende de acesso ao banco de produção, que o agente
não tem.

### 11.1 Rodar o censo de verdade

```bash
pnpm catalog index-decisions --dry-run --json
```

O campo a ler primeiro é **`truncatedTypes`**. Se vier vazio, os números de
temporada, episódio e pessoa são os primeiros confiáveis que este projeto já teve
para esses três tipos.

> **Atenção ao tempo.** Sem teto, `episode` e `person` passam a ser varridos
> inteiros. A primeira execução demora bem mais que as anteriores. O ciclo
> horário roda com `--apply` e sem `--confirm-mass-change`: com o catálogo no
> estado atual ele continua **bloqueado pelo freio**, gravando zero linhas — o
> que muda é que agora ele mede o universo certo antes de recusar.

### 11.2 Medir quanto a extração recupera

```bash
pnpm catalog backfill-text --dry-run --json
```

Campos a ler: `candidates`, `recovered`, `bySource.translations`,
`skipped.no_stored_payload`, `recoverableOnlyWithPtPt`, `ptPtSamples`.

### 11.3 Medir o `dead_letter` — e **não** reprocessar junto

São 2.122 jobs. Uma entidade nesse estado não tem dado de detalhe nenhum: não é
falta de extração, é sincronia que nunca completou. SQL em
[`docs/operations/text-recovery-measurement.md`](docs/operations/text-recovery-measurement.md) §3.
Se for parcela relevante, o terceiro caminho é **reprocessar**, e é leva própria.

### 11.4 A ordem importa

Cada passo muda o denominador do seguinte:

1. censo (§11.1)
2. medição do backfill (§11.2)
3. `dead_letter` (§11.3) — medir, não reprocessar
4. `pnpm catalog backfill-text --apply`
5. `pnpm catalog backfill-finalization --entity person --apply` — **depois** do
   passo 4 (mais títulos publicáveis = mais pessoas elegíveis)
6. censo refeito, para comparar com o passo 1
7. só então decidir sobre `--apply` da indexabilidade — que continua sendo
   **decisão humana** e passa pelo freio

### 11.5 A decisão de licença da biografia

As 32.087 pessoas em `no_biography` dependem de `biography_source_status` sair de
`unknown`. É decisão do dono. Enquanto não acontecer, extrair biografia enche a
coluna e não acende página nenhuma.

---

## 12. O que ficou de fora, e por quê

### 12.1 Temporada e episódio têm o mesmo defeito de uma linha

`services/ingestion/src/normalizers/season.ts:31` e
`services/ingestion/src/normalizers/episode.ts:22` leem só o campo de topo. São
**42.914 episódios** em `no_synopsis` no censo (truncado) de 2026-08-28.

Deixei de fora porque o backfill deles lê **outra tabela** e **outra chave de
`api_cache`** (`/tv/{id}/season/{n}/episode/{e}`), e a presença desses payloads no
cache é **não verificada**. Está declarado em `APPEND_DEFERRED`, com o número —
não escondido atrás da classificação de movie/tv.

### 12.2 `pt-PT`

Por decisão do enunciado: Item E é medição.

### 12.3 O `missing_slug` de pessoa

Causa identificada (§5), reparo já existente e operacional.

### 12.4 Uma imprecisão minha, que registro

O commit `de8d7f7` tem a mensagem *"reverte reformatação acidental do validador
de elegibilidade"* — mas carregou junto uma mudança semântica em
`text-backfill.ts` (a medição de `pt-PT` passou a olhar os dois payloads
guardados, não só o escolhido). O diff é revisável; o `git log` sozinho não conta
essa parte. Não pude emendar: force-push está negado neste repositório.

### 12.5 Uma reformatação acidental, e o que ela ensinou

Rodei `npx prettier --write` da **raiz** sobre um arquivo de `apps/web`. A raiz
usa aspas simples sem `;`; `apps/web` usa aspas duplas com `;`. Duas edições
semânticas viraram um diff de **295 linhas**. Restaurei do `main` e reapliquei à
mão: 58 adicionadas, 1 removida. `pnpm lint` não reclama de nenhum dos dois
estilos, então nada avisa.

---

## 13. A lição, em uma frase

**A pergunta "o TMDB tem esse dado?" e a pergunta "nós extraímos esse dado?" são
diferentes, e `api_cache.payload` guarda a resposta inteira** — então, antes de
propor uma chamada nova, olhe o que já está no banco.

E o corolário, que vale para o próximo censo: **número redondo em relatório de
contagem é teto até prova em contrário.**

---

## Apêndice A — o pedido original, na íntegra

> # PROMPT 5 — 86% DO CORTE SÃO DOIS BUGS DE EXTRAÇÃO, NÃO QUALIDADE
>
> Tarefa única. **Nenhum `--apply` de indexabilidade. Nenhuma escrita em
> produção.** O corte está suspenso até o catálogo ser recuperado.
>
> ## REGRAS FIXAS
>
> 1. Não abra tarefa, issue ou recomendação sobre rotação de credenciais. Decisão
>    tomada pelo dono do projeto.
> 2. NUNCA imprima valor de chave, token ou senha. Só o nome da variável, se está
>    preenchida, e o FORMATO. Para listar variáveis use `printenv | cut -d= -f1`.
>    `printenv` puro é proibido. `env | grep` em log ou relatório é proibido.
> 3. Não commite o `.env`.
> 4. Nenhum comando com dois hifens isolados como argumento próprio.
> 5. Nada destrutivo sem o dono: `DROP`, `TRUNCATE`, `DELETE` em massa, destruir
>    serviço, apagar backup, apagar volume.
> 6. **Zero chamadas novas ao TMDB.** O dado já foi pago e está guardado. Se a sua
>    solução precisa chamar a API, ela está errada.
> 7. Produção roda `prisma migrate deploy` e NUNCA `db:seed`.
>
> ## REGRA DE HONESTIDADE
>
> Se você medir e o número não bater com o que está aqui, **o número manda e este
> documento se corrige.**
>
> O defeito assinatura deste projeto — sucesso medido em proxy — já apareceu
> dezessete vezes, e a décima sétima está no Item A abaixo. Nesta leva ele tem um
> formato previsível: **um backfill que reporta "N títulos processados" sem
> verificar que o texto ficou legível na página.** Processar não é recuperar. A
> medida é `summary` preenchido E a página renderizando o texto E o veredito de
> indexabilidade mudando.
>
> Nenhum teste pode passar por `grep` no fonte. Todo teste executa e afirma sobre
> a saída, com controle negativo: reintroduza o defeito e prove que fica vermelho.
>
> ## O CENSO REAL (medido em produção, 2026-08-28, exit 5, nada gravado)
>
> ```
> evaluated 367.288 · index 60.488 · noindex 306.800 · flipRatio 83,53% · blocked
> ```
>
> | tipo | avaliadas | index | principais motivos de noindex |
> |---|---:|---:|---|
> | movie | 34.802 | 15.771 | `no_synopsis` 18.936 · `no_image` 95 |
> | tv | 32.486 | 12.582 | `no_synopsis` 19.679 · `no_image` 131 · `missing_slug` 94 |
> | season | **100.000** | 26.334 | `parent_not_publishable` 67.807 · `missing_title` 4.778 · `insufficient_data` 962 |
> | episode | **100.000** | 5.801 | `parent_not_publishable` 48.197 · `no_synopsis` 42.914 · `missing_title` 3.088 |
> | person | **100.000** | **0** | `missing_slug` 66.688 · `no_biography` 32.087 · `no_eligible_credit` 1.225 |
>
> Totais por motivo, sobre os 306.800 `noindex`:
>
> ```
> parent_not_publishable 116.004 (37,8%)   no_synopsis  81.529 (26,6%)
> missing_slug            66.901 (21,8%)   no_biography 32.087 (10,5%)
> missing_title            7.866 ( 2,6%)   resto         2.413 ( 0,8%)
> ```
>
> **Estado da fila (2026-08-28 14:23 UTC):** `succeeded` **406.301** ·
> `dead_letter` **2.122** · nada pendente, nada rodando, nada em `retry_wait`.
> Último job criado às 12:27.
>
> **O que já está no ar:** #241, #242, #244 e #245 implantadas. As 10 rotas de
> ficha têm ISR (`s-maxage=3600`) e uma Cache Rule da Cloudflare serve essas 67
> mil páginas do edge — medido em 39 ms. Home e listagens continuam dinâmicas.
> **Não encoste em nada disso.**
>
> **Os três primeiros somam 264.434 — 86% do corte.** E `parent_not_publishable` é
> cascata: 67.807 temporadas e 48.197 episódios fora porque a série acima deles
> não é publicável, e a série não é publicável quase sempre por `no_synopsis`.
>
> Um censo independente por SQL, rodado antes, deu **exatamente** os mesmos
> números para `tv` (12.582 / 19.679 / 94 / 131) e diferiu de 1 em `movie`. Filme
> e série estão medidos e confiáveis.
>
> ## ITEM A — O TETO DE 100.000 (faça primeiro, é o que invalida tudo)
>
> `season`, `episode` e `person` reportam **exatamente 100.000 avaliadas cada**.
> Três números redondos iguais não são coincidência: é um teto no produtor, não
> uma medição.
>
> **Enquanto esse teto existir, nenhum número desses três tipos vale, e os 306.800
> são piso, não total.**
>
> - **A.1** — Ache o limite. Diga arquivo, linha e valor.
> - **A.2** — Torne-o explícito e observável. Duas coisas obrigatórias: o JSON
>   precisa dizer, por tipo, se a avaliação foi **completa ou truncada** (um
>   booleano, não uma inferência do leitor); rodar truncado tem que **avisar em
>   texto**, não passar em silêncio.
> - **A.3** — Permita avaliar o tipo inteiro. Se paginar for necessário por
>   memória, pagine — mas o censo tem que somar o total real, não parar no
>   primeiro lote.
> - **A.4** — Rode e traga os **números verdadeiros** de temporada, episódio e
>   pessoa.
> - **A.5** — **A terceira causa possível, que ninguém investigou.** Existem
>   **2.122 jobs em `dead_letter`**: entidades cujo `sync_details` falhou, esgotou
>   as tentativas e desistiu. Uma entidade nesse estado **não tem dado de detalhe
>   nenhum**, e portanto não tem sinopse — não por falta de extração, nem por
>   ausência no TMDB, mas porque a sincronia nunca completou. Meça quantos dos
>   títulos sem sinopse estão nessa condição, e agrupe os motivos de morte. Se for
>   parcela relevante, a recuperação tem **três** caminhos e não dois — e o
>   terceiro é reprocessar, não extrair. **Só meça e relate. Não reprocesse nada
>   nesta leva.**
> - **A.6** — Teste com controle negativo: um conjunto maior que o teto, e prove
>   que o censo reporta o total certo e que a versão truncada é sinalizada.
>
> ## ITEM B — A SINOPSE E A BIOGRAFIA JÁ ESTÃO NO BANCO
>
> `MOVIE_APPEND` e `TV_APPEND` (`api-clients/tmdb/src/append-to-response.ts`) já
> pedem `translations` em toda requisição de detalhe. O bloco com a sinopse **de
> todos os idiomas** chega, a cota já foi paga, e a resposta inteira está em
> `api_cache.payload` e `tmdb_raw.payload`.
>
> `readMovieDisplayFields` / `readTvDisplayFields`
> (`services/ingestion/src/display-fields.ts`) leem **só o `overview` de topo** —
> o do idioma pedido — que vem `""` quando não há tradução pt-BR ali. Título tem
> cadeia de fallback (`title` → `original_title`). Sinopse não tem nenhuma.
>
> ```
> ""  →  null  →  upsertTranslation(…, null)  →  summary = NULL  →  no_synopsis
> ```
>
> `translations` está marcado `deferred` em `append-consumption.ts`. **`biography`
> também está** — e pessoa tem 32.087 `no_biography`. É a mesma doença, no mesmo
> arquivo, valendo dois tipos.
>
> - **B.1** — Extraia a sinopse com precedência explícita: (1) `overview` de topo,
>   quando não vazio; (2) entrada `pt-BR` dentro de `translations`, quando não
>   vazia. **Pare aí.** `pt-PT` é decisão de política, não conserto de bug — ver
>   Item E. Ler o `pt-BR` que está dentro de `translations` não é fallback. É ler
>   o dado certo no lugar certo. É correção de bug puro.
> - **B.2** — Faça o mesmo para **biografia de pessoa**. Se o bloco correspondente
>   estiver guardado e não lido, extraia com a mesma precedência.
> - **B.3** — Registre **de onde** cada texto veio — campo principal contra bloco
>   de traduções. Sem isso ninguém audita depois e a próxima pessoa refaz esta
>   investigação do zero.
> - **B.4** — **Não sobrescreva texto existente.** Só preenche `NULL` ou vazio.
>   Idempotente: a segunda execução não muda nada.
> - **B.5** — Corrija a classificação de `translations` e de `biography` em
>   `append-consumption.ts`. E confira as outras entradas enquanto está nele — a
>   auditoria diz que 4 de 19 mentem. Liste as que continuarem mentindo.
>
> ## ITEM C — 66.688 PESSOAS SEM SLUG
>
> `missing_slug` é 21,8% de todo o corte, e 66.688 dos 66.901 são pessoas. **Duas
> de cada três pessoas do catálogo não têm URL canônica.** Não é página fina — é
> página que não existe.
>
> Já apareceram dois filmes com slug `tmdb-1465816` e `tmdb-1729257`, títulos em
> alfabeto grego onde a transliteração desistiu e caiu no id. Pode ser o mesmo
> mecanismo.
>
> - **C.1** — Por que 66.688 pessoas não têm linha canônica em `slugs`? O gerador
>   falha, nunca roda para pessoa, ou roda e rejeita?
> - **C.2** — Quebre por causa, com números. Nome vazio? Alfabeto não latino?
>   Colisão? Nunca processado?
> - **C.3** — Conserte a causa dominante, **se for conserto pequeno e claro**. Se
>   for grande, **não conserte**: relate com número e proposta, e deixe para uma
>   leva própria.
> - **C.4** — Quantas pessoas voltariam a ter URL com o conserto.
>
> ## ITEM D — O BACKFILL
>
> - **D.1** — Um job que varre os títulos e pessoas sem texto, lê o bloco **já
>   guardado** em `api_cache` / `tmdb_raw`, e preenche o que der. **Zero chamadas
>   ao TMDB.**
> - **D.2** — Idempotente de verdade — `ON CONFLICT`, não exceção capturada. Este
>   projeto já queima dezenas de milhares de erros de duplicate key por minuto, em
>   rajada, por idempotência via exceção capturada. Não crie mais um.
> - **D.3** — Em lotes, com progresso, retomável. Morrer no meio não pode obrigar
>   a recomeçar do zero.
> - **D.4** — Gera log de sync, invariante 10.
> - **D.5** — **AVISO OPERACIONAL, E ELE PRECISA ENTRAR NO RELATÓRIO.** Desde
>   28/08 as fichas são cacheadas: 1 hora no edge da Cloudflare, 4 horas no
>   navegador. Quando o backfill preencher uma sinopse, **a página não vai mostrar
>   o texto novo na hora** — e quem for conferir vai concluir que o backfill
>   falhou. Escreva, explicitamente, como verificar sem se enganar: consultar o
>   banco direto, ou abrir em janela anônima depois de purgar o cache da
>   Cloudflare. **"A página ainda não mudou" não é prova de que a extração
>   falhou.** É sucesso medido em proxy, com o sinal invertido.
> - **D.6** — **Prepare e pare.** Não rode contra produção.
>
> ## ITEM E — MEDIR, NÃO DECIDIR: o caso `pt-PT`
>
> - **E.1** — Quantos títulos são recuperados **só** com `pt-BR` do bloco, e
>   quantos a mais entrariam aceitando `pt-PT`.
> - **E.2** — Amostre 20 sinopses `pt-PT` reais e mostre o texto. Quero ver se é
>   português legível para leitor brasileiro.
> - **E.3** — **Não implemente.** Aceitar português europeu em página pt-BR é
>   escolha editorial do dono.
>
> ## ITEM F — AS PROVAS
>
> - **F.1** — Unidade: payload com `overview` de topo vazio e `pt-BR` no bloco →
>   sinopse preenchida. Sem nenhum dos dois → `null`, sem inventar.
> - **F.2** — **Ponta a ponta**: semeie um título assim, rode o backfill, e
>   **renderize a página** confirmando que o texto aparece no HTML. Não basta
>   estar no banco. Use o caminho que
>   `validate-decision-robots-render-real-postgres.ts` já abriu para importar as
>   rotas reais fora do Next.
> - **F.3** — Prove que a recuperação **muda o veredito**: o mesmo título, antes
>   `no_synopsis`, depois `eligible`, rodando a política de verdade.
> - **F.4** — Prove a **cascata**: uma série recuperada devolve ao índice as
>   temporadas e episódios que estavam em `parent_not_publishable`. É aí que estão
>   116.004 páginas.
> - **F.5** — Controle negativo executado, não afirmado: volte o extrator a ler só
>   o topo e prove que F.1 a F.4 ficam vermelhos.
>
> ## RELATÓRIO
>
> - os números verdadeiros de temporada, episódio e pessoa, sem o teto
> - quantos títulos e pessoas a extração recupera, e quantos continuam sem texto
> - quantos dos títulos sem sinopse estão em `dead_letter`, e por qual motivo
>   morreram
> - como conferir a recuperação sem ser enganado pelo cache das fichas
> - **o censo refeito depois da recuperação**, comparado com os 60.488 `index` /
>   306.800 `noindex` de hoje
> - quanto do `parent_not_publishable` cai por cascata
> - a causa do `missing_slug` de pessoa, com número
> - quais entradas de `append-consumption.ts` continuam mentindo
> - o que ficou de fora e por quê
>
> Se o escopo não couber numa leva, faça **na ordem A → B → C → D** e pare onde
> parar, dizendo exatamente onde parou. Metade feita e relatada com honestidade
> vale mais que tudo feito pela metade em silêncio.
>
> ## PORTÕES
>
> Todos, medidos: `typecheck`, `lint`, suíte completa, `audit:invariants`,
> `audit:render`, `build`, e os quatro validadores reais de PostgreSQL. Um PR só.
>
> ## O QUE NÃO FAZER
>
> - Nenhuma chamada nova ao TMDB.
> - Nenhum `--apply` de indexabilidade. Nenhuma escrita em produção.
> - Não implemente `pt-PT`. Item E é medição.
> - Não mexa na política de indexabilidade, no `CATALOG_POLICY_VERSION` nem no
>   freio de mudança em massa.
> - Não mexa no sitemap, no gate de decisão, no ISR das fichas nem na política de
>   cache por rota. #241, #242, #244 e #245 estão implantadas e funcionando.
> - Não mexa em fila, scheduler, duplicate key, home, listagens, galeria ou
>   `CastStrip`.
> - Não submeta nada no Search Console.

Um segundo pedido veio depois da PR aberta e do CI verde:

> faz o merge quando tudo tiver pronto me avisa, enquanto isso, monte um md
> atualizado de tudo, do meu prompt e das suas respostas, o que você fez o que
> tem que fazer etc. faça tudo.

Este documento é a resposta a esse segundo pedido.

---

## Apêndice B — resposta ao "RELATÓRIO", item a item

| pedido | resposta |
| --- | --- |
| números verdadeiros de temporada/episódio/pessoa | **não medidos** — sem acesso a produção. Comando pronto (§11.1) |
| quantos a extração recupera | **não medido** — comando pronto (§11.2) |
| quantos estão em `dead_letter`, e por que morreram | **não medido** — SQL pronto (§11.3) |
| como conferir sem ser enganado pelo cache | §6.2, e no `--help` do comando |
| o censo refeito depois da recuperação | **não medido** — depende de §11.4 |
| quanto do `parent_not_publishable` cai por cascata | mecanismo **provado** contra PostgreSQL real (§8.2); número não medido |
| a causa do `missing_slug` de pessoa, com número | causa **identificada** no código (§5.1); número não medido (§5.3) |
| quais entradas de `append-consumption.ts` mentem | **nenhuma** — 17/17 verificadas (§3.4) |
| o que ficou de fora e por quê | §12 |

**Onde parei:** A e B completos; C diagnosticado e deliberadamente não
consertado (§5.2); D construído e **não executado**; E medido pelo código, não
implementado; F provado com controle negativo executado. O que falta é medição em
produção — que o agente não alcança.

---

## Apêndice C — a sessão, na ordem em que aconteceu

**Fase 1 — diagnóstico**

1. Achei o teto (`indexability-writer.ts:497`), confirmei que `api_cache.payload`
   guarda o append rico, e descobri — grepando por quem **escreve**
   `biography_source_status` — que **ninguém escreve**.

**Fase 2 — os consertos, na ordem A → B → C → D do enunciado**

2. **Item A.** Paginação por chave, default sem teto, `truncatedTypes` no JSON e
   aviso em texto.
3. **Item B.** `localized-text.ts` (módulo puro), proveniência no retorno,
   `readPersonBiography`, e `translations` movido para `APPEND_CONSUMED`.
4. **Auditoria do registro de append.** 17 entradas conferidas contra o módulo
   citado. Nenhuma mente.
5. **F.1 + controle negativo.** Reescrevi o teste de caracterização; reintroduzi
   o defeito e provei 3 vermelhos; restaurei.
6. **Item D.** `text-backfill.ts` + `catalog backfill-text`, com `ON CONFLICT`,
   lotes, checkpoint e log de sync.
7. **Item C.** Diagnosticado no código; **não** consertado, por decisão do
   enunciado.

**Fase 3 — as provas**

8. **Validador de banco real.** 35/35, incluindo A.6 com 100.001 filmes e a
   cascata F.4. Nesse caminho descobri que o check "não sobrescreve" passava por
   vacuidade e exportei a primitiva de escrita para exercitá-lo.
9. **F.2.** Validador que renderiza a rota real e procura o texto **fora** do
   JSON-LD. 4/4.
10. **Portões.** Suíte, typecheck, lint, auditorias, build; e os validadores
    reais — incluindo montar um cluster PostgreSQL manual em caminho sem acento,
    porque `initdb --encoding=UTF8` morre neste checkout.

**Fase 4 — PR e refinamentos**

11. **PR #249**, CI verde.
12. **Refinamentos depois da PR**, todos vindos de exercitar o comando de
    verdade, não de reler o código: truncamento preciso (§2.4), reversão de uma
    reformatação acidental (§12.5), guarda de `--locale` (§9.1) e o log de sync
    que apagava o relatório (§9.2).

**Fase 5 — merge**

13. **`main` andou três vezes** debaixo da PR (#250, #251, #247, #252). Mergeei
    `main` a cada vez, reverifiquei o que cada uma tocava, e armei `--auto`
    (squash) em vez de disputar corrida.
14. Nesse caminho apareceu o **vermelho que não era regressão** (§10.1) e a
    reformatação acidental do prettier (§12.5).
15. **Merge em `0493283`**, 2026-08-28T18:57:48Z, com as sete execuções de CI
    verdes. Este relatório entrou depois, em PR própria — a convenção da casa.
