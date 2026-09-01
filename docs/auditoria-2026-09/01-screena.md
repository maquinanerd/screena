# FASE 1 — Auditoria do repositório `screena` (produto público: **Cinerie**)

**Cobertura: abri e li 33 de 2.174 arquivos versionados (1,5%).**

Esse número sozinho seria vergonhoso, então declaro o método inteiro — porque é
ele, e não a contagem de arquivos, que sustenta os achados:

| Instrumento | Alcance |
| --- | --- |
| Leitura integral ou substancial | **33 arquivos**, escolhidos por RISCO (ver lista no anexo) |
| Varredura por padrão (`git grep`) | **100% dos 2.174** arquivos, em 21 varreduras temáticas |
| Execução da suíte | **7.567 testes em 582 arquivos**, rodados de verdade |
| Portões de qualidade | `typecheck`, `lint`, `audit:invariants`, `audit:render` — rodados |
| Medição em produção | **24 consultas** ao PostgreSQL real (somente leitura) |
| Medição HTTP | 12 requisições reais a `https://cinerie.com`, com cabeçalhos |

Fixture, snapshot, `.gitkeep`, PNG/WEBP/SVG/WOFF2 e os 254 Markdown de
documentação entram no denominador mas **não** foram lidos linha a linha —
declarado, não escondido. Os 93 JSON também não: 168.751 das linhas do
repositório são JSON, e a maioria é `pnpm-lock.yaml` e fixture de teste.

Priorizei, nesta ordem: caminho que **grava em banco**, que **chama API
externa**, que **renderiza página pública**, que **decide licença ou
indexabilidade**.

---

## Sumário — os cinco achados mais graves

| # | Achado | Gravidade | Evidência |
| --- | --- | --- | --- |
| 1 | **A camada editorial de IA não existe em produção.** `content_blocks = 0`, `entity_writer_jobs = 0`, `entity_writer_logs = 0`. O "diferencial competitivo" declarado no `CLAUDE.md` (invariantes 12 e 13, seção 9) nunca produziu uma linha. | **CRÍTICO** | medido no banco |
| 2 | **A fila "diária" da OMDb rodou em 2 dos últimos 7 dias** — e nos dois dias gastou 923 e 850 unidades de cota, acima do envelope declarado de 700. Resultado: **760 títulos de 83.314 (0,91%) têm nota externa.** | **CRÍTICO** | medido no banco |
| 3 | **"Onde assistir" renderiza em 147 de 83.314 títulos (0,18%).** Há 70.869 linhas em `watch_availability`, mas 70.036 têm `display_allowed = false`. | **ALTO** | medido no banco, com a cláusula real do gate |
| 4 | **`CLAUDE.md:201` proíbe o que a produção faz.** "NUNCA publicar conteudo automaticamente" versus o ADR 0017 (aceito) e `EDITORIAL_AUTO_PUBLISH_ENABLED=true` no serviço `cinerie-cms`. O documento que se declara autoritativo está desatualizado. | **ALTO** | medido no código e no painel |
| 5 | **3,6 GB de cache expirado nunca apagado.** `api_cache` tem 500.140 linhas vencidas de 561.970 (89%) — metade do banco de 10 GB é lixo com `expires_at` no passado. | **ALTO** | medido no banco |

Uma segunda rodada de medição (01:45) acrescentou três achados do mesmo peso —
**62,5% das fichas sem sinopse em português**, **2.152 biografias existentes e
100% bloqueadas** por `biography_source_status = unknown`, e **`original_language`
nula em 43,2% dos filmes** — todos detalhados em D2.

E o contraponto, que seria desonesto omitir: **a suíte inteira passa
(7.567/7.567), o typecheck passa, o lint passa e os dois auditores de
governança passam.** Este não é um repositório descuidado. Os defeitos acima
não são de código malfeito — são de **operação e de escopo**: coisas
construídas com esmero que não estão rodando, ou rodando abaixo do que
prometem.

---

## D1 — Estrutura e build

### O que este sistema é (três frases minhas, depois de ler o código)

1. É um monorepo TypeScript que ingere o catálogo inteiro do TMDB para um
   PostgreSQL próprio e serve, a partir **só** desse banco, um site público em
   pt-BR com ficha de filme, série, temporada, episódio e pessoa.
2. Em volta desse núcleo há três sistemas satélites construídos e apenas
   parcialmente ligados: notas externas (OMDb), disponibilidade de streaming e
   uma redação editorial que recebe matérias de um CMS Payload por um worker de
   projeção.
3. A governança é levada a sério a ponto de virar código: há auditores próprios
   para as invariantes e para a pureza do render, e o comentário do código
   frequentemente registra a medição que motivou a decisão — inclusive os erros
   anteriores.

### Árvore (2º nível) e papel

| Caminho | Arquivos | Papel |
| --- | ---: | --- |
| `services/` | 878 | Toda a lógica offline: ingestão TMDB, agendador, ratings, streaming, editorial, plataforma de usuário, legal |
| `apps/` | 590 | `web` (site público), `cms` (Payload), `admin` (painel interno) |
| `docs/` | 193 | ADRs, runbooks de operação, especificação |
| `tests/` | 186 | Governança + testes de web fora dos pacotes |
| `packages/` | 153 | `config`, `db` (Prisma), `seo`, `schemas`, `ui`, `types`, `public-contracts`, `cinerie-score`, `editorial-contracts` |
| `api-clients/` | 61 | `tmdb`, `omdb`, `rapidapi-core`, `film_show_ratings`, `streaming_availability` |
| `scripts/` | 19 | Auditores (`check-invariants`, `check-render-purity`) e validadores |
| `workers/` | 9 | Esqueletos Python de roadmap (não executados) |
| `database/` | 4 | Legado; a fonte executável é `packages/db/prisma` |

**25 workspaces pnpm.** 35 CLIs em `*/bin/*.ts`. 40 rotas de página, 43
manipuladores de rota, 26 migrations Prisma.

### Build, teste e implantação — resultado REAL, não o que o CI diz

Rodei tudo num clone limpo de `origin/main` (`c24dba1`), em `C:\aud\screena`,
com `pnpm install --frozen-lockfile`:

| Comando | Resultado real |
| --- | --- |
| `pnpm test` | **582 arquivos, 7.567 testes, 100% verde**, 76,8 s |
| `pnpm typecheck` | **passa** (`tsc` + `typecheck:catalog-runtime`) |
| `pnpm lint` | **passa**, sem saída |
| `pnpm audit:invariants` | **PASSOU** — 7 ok, 0 violações |
| `pnpm audit:render` | **PASSOU** — 2 ok, 0 violações |

> **Uma armadilha que eu mesmo caí e registro para ninguém repetir.** Na
> primeira execução, a suíte deu **10 arquivos falhando e 9 testes vermelhos**.
> Não era defeito do produto: era o **Prisma Client não gerado** no clone novo
> (`SyntaxError: '@prisma/client' does not provide an export named 'PrismaClient'`).
> Depois de `pnpm --filter @screena/db db:generate` a suíte foi a 100%.
>
> Isso vira um achado pequeno, mas real: `scripts/typecheck/ensure-prisma-client.mjs`
> **apenas avisa** e manda rodar o comando à mão. Um clone limpo seguido de
> `pnpm install && pnpm test` entrega 10 suítes vermelhas com uma mensagem que
> não diz o que fazer. Um `postinstall` resolveria.
>
> Vale notar o que funcionou: o teste `dry-run-precheck.test.ts` tem um
> **controle positivo** — "(1) o binário roda e responde ao `--help`" — e foi
> ele que falhou primeiro, impedindo que os casos (2) e (3) passassem por
> vacuidade. O comentário do arquivo diz exatamente isso na linha 105. O guarda
> funcionou.

Aviso de engine em toda execução: o repositório pede `node >=22 <23` e a máquina
tem **v24.19.0**. Não quebrou nada aqui, mas é divergência entre o declarado e o
usado.

### Serviço que roda este código e `autoDeploy`

Cinco dos oito serviços do painel saem deste repositório: `screen-app`,
`screen-catalog-worker`, `screen-cron`, `cinerie-cms`,
`cinerie-publication-worker`. **`autoDeploy = false` em todos os cinco.** Nada
sobe sozinho; todo deploy é manual.

---

## D2 — Banco

Medido no PostgreSQL **17.11** de produção (`screen-db`, banco `screena`, 10 GB,
90 tabelas). Detalhe completo em [`anexos/db-medicoes.md`](anexos/db-medicoes.md).

### O que está cheio

`entities` 5.477.942 (episode 3.960.233 · person 1.294.418 · season 139.977 ·
movie 48.613 · tv 34.701). `movies` e `tv_shows` estão **100% sincronizados**
(48.613/48.613 e 34.701/34.701). `people` está em **72,0%** (931.944 de
1.294.418).

### O que está vazio — e o que isso significa

**29 tabelas com exatamente zero linhas.** As que importam:

| Tabela | Linhas | Consequência |
| --- | ---: | --- |
| `content_blocks` | **0** | Nenhum bloco editorial de IA existe. É o **achado 1**. |
| `entity_writer_jobs` / `entity_writer_logs` | **0** | O Entity Writer nunca rodou em produção |
| `keywords`, `collections`, `networks`, `production_companies`, `tv_networks` | **0** | Dicionários de catálogo nunca populados |
| `movie_production_companies`, `tv_production_companies`, `entity_keywords`, `movie_collection_memberships` | **0** | E as tabelas de ligação correspondentes também |
| `entity_alternative_titles` | **0** | Sem títulos alternativos — afeta busca |
| `source_items`, `editorial_sources`, `article_source_links` | **0** | A proveniência editorial não é registrada |
| `hero_curation_decisions` | **0** | A curadoria de capa existe em schema e não em uso |
| `user_ratings`, `user_reviews`, `user_list_items`, `user_profiles`, … | **0** | A plataforma de usuário (`users = 2`) não tem uso |

Uma **coluna lida pela tela e escrita por ninguém** é o padrão que este
ecossistema já pagou duas vezes. Aqui o equivalente em escala de tabela é
`content_blocks`: `packages/seo` conta blocos de valor, `evaluateIndexability`
recebe `valueBlocksCount`, e o valor real é sempre `0`.

### `DEFAULT`s que escondem dado — e por que aqui estão CERTOS

O `schema.prisma` tem 28 colunas booleanas nascendo `false` e 6 status nascendo
`unknown`. Esse é exatamente o formato "booleano de exibição que nasce `false`"
que costuma esconder dado. **Neste repositório é decisão consciente e correta**:
a invariante 6 exige que dado sem licença clara não apareça, então o default
seguro é não exibir. Os comentários dizem isso na própria linha
(`schema.prisma:361`, `:970`, `:1066`, `:1126`: "default seguro (inv. 6)").

O efeito colateral é real, porém: **70.036 das 70.869 linhas de
`watch_availability` estão em `display_allowed = false`** e ninguém as promoveu.
O default não é o defeito; a **ausência de um processo de promoção rodando** é.

### Segunda rodada de medição — o que a ficha realmente tem para mostrar

Voltei ao banco às 01:45 para medir o **conteúdo** das fichas, não só a
existência das linhas. Quatro números que mudam a leitura do produto:

**1. A maioria das fichas não tem sinopse em português.**

| Tipo | Com `summary` em pt-BR | Total | Cobertura |
| --- | ---: | ---: | ---: |
| `movie` | 19.367 | 51.696 | **37,5%** |
| `tv` | 13.050 | 34.745 | **37,6%** |
| `person` | **0** | 62.514 | **0%** |

**62,5% das fichas de filme e 62,4% das de série vão ao ar sem sinopse**, e
nenhuma das 62.514 pessoas com tradução tem resumo.

**2. Existem 2.152 biografias, e nenhuma pode ser exibida.**

`people.biography` está preenchida em **2.152 de 1.315.205 pessoas (0,16%)**.
E `biography_source_status` está em **`unknown` para 1.315.149 — 100% delas**.

`unknown` é exatamente o estado que a invariante 6 usa para bloquear exibição.
Ou seja: o trabalho de trazer a biografia foi feito para 2.152 pessoas e **o
resultado é invisível**, porque a coluna que governa a exibição nasce `unknown`
e **nada no sistema a altera**. Encher `biography` não tira ninguém do bloqueio.

**3. `original_language` continua nula em quase metade do catálogo.**

| Tipo | Sem `original_language` | Total | % |
| --- | ---: | ---: | ---: |
| `movies` | 22.353 | 51.697 | **43,2%** |
| `tv_shows` | 20.766 | 34.847 | **59,6%** |

Bate com o que a própria documentação do repositório registra. Combinado com
`languages = 3` linhas, confirma que **o recorte de cinco idiomas do PR #260 não
chegou ao dado de produção**.

**4. E o contraponto: as imagens existem.**

| Tipo | Com `poster_path` | Com `backdrop_path` |
| --- | ---: | ---: |
| `movies` | **47.177 (91,3%)** | 36.166 (70,0%) |
| `tv_shows` | **32.379 (92,9%)** | 29.391 (84,3%) |

Mais de 91% dos títulos têm pôster no banco. A ficha não mostrar imagem acima da
dobra (FASE 6) **não é falta de dado** — é ordem de blocos.

### O catálogo está ingerindo agora

Os totais mudaram **durante a auditoria**: `movies` foi de 48.613 (00:44) para
51.697 (01:47) — **+3.084 em uma hora, +6,3%**. Nas 24 h: +3.486 filmes, +720
séries, **+26.431 pessoas**. `search_documents` foi reprojetado 7 minutos antes
da medição.

Isso é uma boa notícia e um agravante ao mesmo tempo:

- **Boa:** o `screen-catalog-worker` está saudável e trabalhando. A ingestão
  TMDB não é o problema deste sistema.
- **Agravante:** o denominador cresce mais rápido que a cobertura de nota
  (0,91%), de oferta (0,18%) e de sinopse (37,5%). **Esses percentuais pioram
  sozinhos** enquanto as filas correspondentes não acompanham o ritmo da
  ingestão. Cada hora de catálogo novo dilui as três.

### Índices

**330 índices; 143 nunca foram usados** (`idx_scan = 0`) — 43,3%, ocupando
**122,3 MB**. Parte disso é esperado (índice de rota ainda não exercitada), mas
143 é muito, e nenhum relatório do repositório acompanha esse número.

`pg_stat_statements` **não está instalado**, então não há medição de tempo por
consulta em produção. Não instalei: mudar configuração do servidor está fora do
"ajuste leve" autorizado.

### `api_cache` — metade do banco é lixo

| Métrica | Valor |
| --- | ---: |
| Linhas totais | 561.970 |
| **Vencidas (`expires_at < now()`)** | **500.140 (89,0%)** |
| Vigentes | 61.830 |
| Sem `expires_at` | 0 |
| **Payload vencido** | **3.615 MB** |
| Linha mais antiga | 2026-07-07 |

A coluna `expires_at` existe e é preenchida em 100% das linhas. **Não existe
job que apague o que venceu.** São 3,6 GB de um banco de 10 GB.

### Migrations

26 migrations, de `20260625120000_init` a `20260825120000_hero_curation_decisions`.
Uma delas é declaradamente destrutiva pelo nome — `20260821120000_drop_user_theme_preference`
— e é coerente com a decisão de tema único registrada no `CLAUDE.md`. Não
encontrei migration que zere dado sem reabilitar.

### Enums cujos valores nunca aparecem no dado

51 enums. Dois casos medidos:

- `CinerieScoreStatus`: as 52.833 linhas de `cinerie_score_calculations` estão
  **todas** em `calculated`. Nenhuma `single_source_insufficient`.
- `LicenseStatus` em `external_ratings`: só aparecem `unknown` (15 linhas) e
  `third_party` (1.492). `official` e `licensed` não aparecem.

---

## D3 — APIs externas

### TMDB

| Item | Valor |
| --- | --- |
| Variável | `TMDB_READ_ACCESS_TOKEN` (v4) — e ainda `TMDB_API_KEY` e `SCREENA_TMDB_API_KEY` (v3, **valores idênticos entre si**) |
| Cota | **de ritmo**, não diária (~50 req/s) |
| Como sabe que estourou | `429` com `Retry-After` tratado em `api-clients/tmdb/src/http.ts` |
| Cache | `api_cache`, com `payload_hash` para evitar reescrita |
| **Custo medido de 24 h** | **19.124 unidades de `quota_cost`** em 56.808 registros de `api_sync_logs` |
| Gatilho de mudança | **sim** — fila `changes` a cada 6 h, além do export diário de ids |

### OMDb — o achado 2, com a conta

| Item | Valor |
| --- | --- |
| Variável | `OMDB_API_KEY` |
| Cota | **1.000/dia**, e a OMDb **não publica cabeçalho de cota** |
| Como sabe que estourou | Ela responde erro com **HTTP 200** e campo `Error`; quem reconhece é `services/ratings/src/omdb/error-response.ts`, que chama `tripCircuit()` — o client expõe o botão e não interpreta ([`api-clients/omdb/src/client.ts:96`](api-clients/omdb/src/client.ts)) |
| Envelope declarado | **700/dia** ([`packages/config/src/omdb-rotation.ts:93`](packages/config/src/omdb-rotation.ts)), com 150 de folga sobre o limite útil de 850 |
| Divisão | 85% cobertura / 15% atualização; 58% filme / 42% série |

**A conta da volta, com os números que medi hoje:**

```
universo consultável = 83.314 títulos − 17.891 sem imdb_id = 65.423
slots de cobertura   = 700 × 0,85 = 595/dia
volta NOMINAL        = 65.423 ÷ 595 = 110 dias
```

**Mas a fila não roda todo dia.** `quota_cost` da OMDb, por dia, nos últimos 7:

| Dia | Cota gasta |
| --- | ---: |
| 2026-08-25 | 0 |
| 2026-08-26 | 0 |
| 2026-08-27 | 0 |
| 2026-08-28 | **923** |
| 2026-08-29 | 0 |
| 2026-08-30 | 0 |
| 2026-08-31 | **850** |

```
gasto real em 7 dias = 1.773  →  253/dia de média
cobertura real       = 253 × 0,85 = 215/dia
volta REAL           = 65.423 ÷ 215 = 304 dias
```

E o efeito confirma a conta: **760 títulos distintos têm nota externa**, de
83.314 — **0,91%**; de 65.423 consultáveis, **1,16%**.

Dois problemas separados no mesmo número:

1. **A fila "diária" roda 2 dias em 7.** Não determinei a causa; ela mora no
   `screen-cron`, que está **amarelo** no painel.
2. **Quando roda, estoura o próprio envelope.** 923 e 850 são maiores que os 700
   declarados, e 923 é maior até que o limite útil de 850 (cota 1.000 menos a
   reserva de 150 do leitor). O módulo que declara os 700 é exemplar em rigor;
   o que executa não o respeita.

O piso, que nenhuma cadência conserta: **17.891 títulos (21,5%) não têm
`imdb_id`** (10.661 filmes + 7.230 séries — confirmei no banco, batendo com os
10.660/7.229 documentados). A OMDb só resolve por IMDb id. Esses títulos nunca
terão nota por essa fonte.

### RapidAPI — a resposta precisa à regra 6 do escopo

A decisão do dono é que RapidAPI não é mais usada. O que encontrei, separando
o que é dependência do que é menção:

**1. `@screena/rapidapi-core` NÃO é removível — e o nome mente.**
`api-clients/omdb/package.json` declara `"@screena/rapidapi-core": "workspace:*"`,
e [`api-clients/omdb/src/client.ts:20`](api-clients/omdb/src/client.ts) importa
dele `RapidApiHttpClient`, `buildCacheKey` e `createRapidApiFetchTransport`. O
pacote é a infraestrutura HTTP compartilhada (retry, breaker, cache-key,
sanitização) do **único fornecedor de notas em uso**. Não é código morto: é
**código vivo com nome errado**.

**2. Os dois clientes RapidAPI de verdade continuam versionados e ligados:**
`api-clients/film_show_ratings` (9 arquivos) e
`api-clients/streaming_availability` (9), consumidos por
`services/ratings/src/film-show-ratings/` e
`services/streaming/src/streaming-availability/`, com alias em
`tsconfig.base.json:37-40` e `vitest.config.ts:82-91`.

**3. As chaves continuam no ambiente de PRODUÇÃO** — e no serviço errado. As
seis variáveis `RAPIDAPI_*` estão no **`screen-app`**, que é o render público.

**4. E há dado RapidAPI vivo no banco**, embora corretamente bloqueado:

| Origem | Linhas | Estado |
| --- | ---: | --- |
| `rapidapi_film_show_ratings` → letterboxd / rotten_tomatoes / filmaffinity | **15** | `display_allowed = false`, `license_status = unknown` → **não renderiza** |
| `omdb` → imdb / metacritic / rotten_tomatoes | 1.492 | `display_allowed = true`, `third_party` |
| `streaming_availability` em `watch_availability` | **6** | — |

Ou seja: **21 linhas de resíduo**, todas fora da tela. A invariante 6 está sendo
honrada. O achado é a **superfície** (código, aliases, chaves em produção), não
vazamento de dado.

### Invariante 2 (`provider_api != rating_source`) — cumprida, e medida

O banco mostra a separação exatamente como a regra pede: `provider_api = omdb`
produzindo `rating_source` `imdb` (750), `metacritic` (399) e `rotten_tomatoes`
(343). Um payload, três fontes editoriais, o fornecedor técnico nunca
apresentado como fonte.

---

## D4 — Filas, jobs, agendamento

O relógio é o `screen-cron`, rodando `@screena/sync scheduler:start`. A tabela
de ritmos ([`services/sync/src/scheduler/rhythms.ts`](services/sync/src/scheduler/rhythms.ts))
tem **13 filas**. O teto global é `CINERIE_SCHEDULER_BATCH_LIMIT`, default
**200** ([`services/sync/src/scheduler/config.ts:110`](services/sync/src/scheduler/config.ts)) —
e **confirmei no painel que essa variável NÃO está definida**, logo 200 é o valor
vigente. `CINERIE_SCHEDULER_APPLY=true`: o agendador escreve de verdade.

### A VOLTA de cada fila

Filas cujo teto consome **itens** (verifiquei em `runtime/runners.ts` que cada
uma chama `select…(prisma, olderThan, deps.batchLimit)`):

| Fila | Intervalo | Teto/ciclo | Universo medido | **A volta** |
| --- | --- | ---: | ---: | --- |
| `people` | 30 dias | 200 | 1.294.418 pessoas | **529 anos** |
| `title_detail_ended` | 30 dias | 200 | ⊂ 83.314 títulos | até **34 anos** |
| `title_detail_active` | 7 dias | 200 | ⊂ 83.314 títulos | até **8 anos** |
| `watch_offers` | 1 dia | 200 | 83.314 títulos | **417 dias** |
| `title_media` | 1 dia | **12.000** | 83.314 títulos | **7 dias** ✔ |
| `ratings_omdb` | 1 dia | 700 (envelope) | 65.423 consultáveis | **110 dias nominal / 304 real** |

**Correção importante, e ela é minha.** Ao ver `people` com volta de 529 anos eu
inferi que o catálogo de pessoas estaria praticamente vazio. **A medição
refutou:** 931.944 de 1.294.418 pessoas (72,0%) têm `last_synced_at`, e a mais
recente é de **2026-09-01 01:32** — uma hora antes da medição.

A explicação é que o carregamento em massa **não vem desta fila**: vem do
`screen-catalog-worker`, que tem produtor próprio (`discover_ids` →
`sync_details`). A fila `people` do agendador é **manutenção de frescor**, e é
como manutenção que ela é inviável: a 200 por 30 dias, uma pessoa já
sincronizada só voltaria a ser conferida daqui a séculos. O número correto de
dizer não é "o catálogo está vazio" — é **"o catálogo é carregado, e nunca
reconferido"**.

`people` também é a única seleção com `ORDER BY e."id" ASC` puro
([`selection.ts:283`](services/sync/src/scheduler/runtime/selection.ts)); as
outras usam `popularity DESC NULLS LAST, id ASC`. O comentário admite a razão
("`people` nao tem `popularity` no schema"). Ordenar por id em fila de refresh
significa que quem tem id alto é servido por último, sempre.

### Idempotência

A chave é `idempotency_key` com escopo diário (`dailyScope(queue, now)` em
`runners.ts`). **É por exceção capturada, não por `ON CONFLICT`** — e isso é
visível no log do PostgreSQL de produção, que registrei em screenshot:

```
ERROR: duplicate key value violates unique constraint "catalog_jobs_idempotency_key_key"
DETAIL: Key (idempotency_key)=(sync_details:movie:422:pt-BR) already exists.
```

Cada duplicata é uma **transação abortada** no servidor, não um no-op barato.
Com 508.135 jobs bem-sucedidos, o volume de aborto correspondente é material —
e é ruído permanente no log de erro do banco, que atrapalha achar erro de
verdade. O código captura e conta como `already_queued`, então o comportamento
final está certo; o custo é que ele passa pelo caminho de exceção do banco.

### Dead letters

**5.532 jobs em `dead_letter`** (1,1% de 513.667):

| Tipo | Mortos |
| --- | ---: |
| `sync_details` | 3.658 |
| `sync_media` | 1.836 |
| `sync_episodes` | 21 |
| `discover_ids` | 16 |
| `sync_seasons` | 1 |

Não determinei a causa por tipo — a mensagem fica no registro do job e minha
memória do ecossistema diz que o formatador da CLI a descarta (use `--json`).

### Dá para provar por consulta que rodou ontem?

**Sim.** `api_sync_logs` tem 471.163 registros; nas últimas 24 h: `tmdb` 56.808,
`omdb` 127, `tmdb-exports` 1. O último registro é de **2026-09-01 01:32:38**.
A ingestão TMDB está viva e ativa. É exatamente essa mesma consulta que expõe o
buraco da OMDb.

### Cascatas

Sim: `discovery` enfileira `sync_details` para cada id descoberto. O teto do
filho existe e tem história registrada no próprio código: `discoveryLimit`
default **2000**, e o comentário de `config.ts` conta que antes era `null`
(export inteiro), o que enfileiraria "da ordem de **6,3 milhões** de
`sync_details`" num único ciclo.

---

## D5 — Frontend

### Rotas e modo de render

40 rotas de página, 43 manipuladores. **Todas as rotas públicas medidas são
dinâmicas.** Os `sitemap.xml` e `sitemaps/[shard]` declaram
`export const dynamic = "force-dynamic"` explicitamente, com a justificativa
correta no comentário ("o build roda sem `DATABASE_URL`").

### Cache real, medido por requisição

Cabeçalho de `/pt/filmes/` medido no navegador:

```
cache-control: private, no-cache, no-store, max-age=0, must-revalidate
cf-cache-status: DYNAMIC
```

**Nada é cacheado** — nem no navegador, nem na Cloudflare. Com 83.347 URLs no
sitemap, cada visita do Googlebot é uma renderização completa contra o banco.

Tempos medidos com `Cache-Control: no-cache`:

| Rota | HTTP | TTFB | Total | Bytes |
| --- | ---: | ---: | ---: | ---: |
| `/pt/` | 200 | 1,246 s | 1,458 s | 112.561 |
| `/pt/filmes/` | 200 | 0,707 s | 0,909 s | 100.915 |
| `/pt/series/` | 200 | 1,006 s | 1,204 s | 104.381 |
| `/pt/pessoas/` | 200 | **1,369 s** | 1,561 s | 57.617 |
| `/pt/noticias/` | 200 | 0,423 s | 0,592 s | 84.729 |

### O subrequest do middleware

[`apps/web/middleware.ts:38`](apps/web/middleware.ts) faz, em **toda** requisição
que não seja asset, um `fetch` para `/api/seo/redirect` da própria origem. Duas
observações:

- O índice de redirects é cacheado 30 s em memória
  ([`redirect-lookup.ts:40`](apps/web/src/server/seo/redirect-lookup.ts)), então
  o banco **não** é consultado por requisição. Bom.
- Mas o **round-trip HTTP acontece sempre**, para consultar uma tabela de
  **479 linhas**. O próprio comentário do arquivo (linha 22) reconhece: "com
  Node middleware (Next 15.5) a leitura da tabela pode ocorrer direto no
  middleware, eliminando o subrequest".
- **E o `fetch` não tem timeout nem `AbortController`.** O `try/catch` é
  fail-closed para *erro*, não para *travamento*: se o handler pendurar, o
  middleware pendura junto, e com ele a requisição do usuário.

> **Onde eu quase menti, e não vou.** Medi esse endpoint pelo navegador e deu
> ~490 ms. Esse número **inclui minha latência de rede** e não serve como custo
> do subrequest servidor-a-servidor. O que posso afirmar com honestidade é um
> **limite superior**: a rota mais rápida do site responde em **423 ms** de TTFB
> total, então o subrequest interno custa menos que isso. O valor exato é
> **NÃO DETERMINADO**.

### SEO

- **Canônica**: presente e autorreferente (`<link rel="canonical" href="https://cinerie.com/pt/filmes/">`).
- **Robots**: `<meta name="robots" content="index, follow">` na página. O
  `robots.txt` servido é o boilerplate de *content signals* da Cloudflare.
- **Sitemap**: índice com **7 shards**, todos `pt-BR`:

| Shard | URLs | Tamanho |
| --- | ---: | ---: |
| `movies-1` | **48.611** | 9,5 MB |
| `series-1` | 34.600 | 6,4 MB |
| `news-1` | 131 | — |
| `static-1` | 5 | — |
| `imagens-1`, `imagens-2`, `videos-1` | não medidos | — |

Dois achados aqui:

1. **Não existe shard de `pessoas`.** Há **62.647 pessoas com slug pt-BR** no
   banco e a rota `/pt/pessoas/{slug}/` está no ar — e nenhuma delas é
   anunciada. É a maior classe de entidade com slug fora da descoberta.
2. **`movies-1` está a 1.389 URLs do teto.** O limite do protocolo é 50.000 URLs
   por shard; o arquivo tem 48.611. Com 100% dos filmes já no sitemap, os
   próximos ~1.400 filmes ingeridos estouram o shard.

### A decisão de indexabilidade não cobre entidade nenhuma

`page_indexability_decisions` tem **164 linhas, e todas as 164 são
`doc_kind = article`, `entity_type = NULL`, `decision = index`.**

Não há **uma única** decisão registrada para filme, série ou pessoa — as 83.347
URLs do sitemap entram sem decisão persistida. O motor
(`packages/seo/src/indexability.ts`, adaptador sobre `resolvePageSeo`) está
correto e testado; o que não existe é a **execução** que grava a decisão. É o
padrão `implementado ≠ executado` em estado puro.

### Estados vazios

O código trata isso com cuidado incomum: existe `src/lib/section-absence.ts` e a
função `watchAbsenceReason` deriva o motivo da ausência **do estado**, com um
comentário longo explicando por que um motivo fixo "envelhece sozinho"
([`entity-watch.ts:104`](apps/web/src/server/entity-watch.ts)). E o descarte de
`offer_type` desconhecido virou `console.warn` com o valor cru, depois que um
`continue` mudo fez sumir toda oferta `ads`.

### Um defeito visível a olho nu

Na `/pt/filmes/`, o ticker "NOVO … estreia hoje" lista, numa página
`lang="pt-BR"`: **`Астероид-77F`**, **`По контуру`**, `Of Men and Monsters`,
`Switch Over`. Títulos em cirílico e inglês, sem tradução, apresentados como
estreia do dia para o público brasileiro. Volta na FASE 6.

---

## D6 — Segurança

### Segredos

**Nenhum segredo versionado.** Varri `*.env`, `credential`, `service-account`,
`*.pem`, `*.key` no índice do Git: os únicos casos são código de plataforma de
usuário (nome de arquivo, não valor). O `.gitignore` cobre `.env` e derivados.

### Onde os segredos ficam — e o problema real

O serviço **`screen-app`** (render público, sob a invariante 3) carrega **51
variáveis**, incluindo `GEMINI_API_KEY`, `OMDB_API_KEY`, os três identificadores
TMDB, as quatro chaves RapidAPI, `BREVO_API_KEY`,
`EDITORIAL_MEDIA_S3_SECRET_ACCESS_KEY` e `TMDB_RAW_R2_SECRET_ACCESS_KEY`.

Por contraste, `screen-catalog-worker` — que **precisa** falar com o TMDB — tem
**14** variáveis e só `TMDB_READ_ACCESS_TOKEN`.

O auditor `audit:render` passa e a invariante 3 está de fato cumprida no código.
Mas o princípio do menor privilégio não está: o processo mais exposto da
arquitetura é o que guarda mais credenciais, e nenhuma delas é necessária no
render.

### Superfície e autenticação

`cinerie.com` e `www.cinerie.com` (porta 3000), `cms.cinerie.com` (3002),
`rss.thepeg.site` (8080, RSSPRIME). As rotas `/api/auth/**` e `/api/me/**`
existem e são reais.

A rota interna `/api/internal/entity-resolve` é o exemplo bom do repositório:
nasce desligada (`503` quando não há chave, distinguido de `401` de propósito),
recusa chave com menos de 24 caracteres, faz **comparação em tempo constante**
com `timingSafeEqual` ([`entity-resolve-auth.ts:103`](apps/web/src/lib/entity-resolve-auth.ts)),
tem rate limit, `X-Robots-Tag: noindex`, `no-store`, ausência deliberada de CORS
e `405` explícito para outros métodos. Não devolve palpite: "um `null` é
inofensivo; um id errado é uma mentira publicada".

Limitação declarada pelo próprio código: o rate limit é **por processo**
(`Map` de módulo), então com N réplicas o teto efetivo é N vezes o configurado.

### Entrada não confiável

Achei **um** `$queryRawUnsafe` no caminho do agendador
([`selection.ts:278`](services/sync/src/scheduler/runtime/selection.ts)) — mas
ele é parametrizado (`$1`, `$2`), sem concatenação de entrada. Não é injeção.
Não encontrei `eval` em código de produção.

### Cabeçalhos — medidos, não lidos no código

Presentes em `/pt/filmes/`: `x-content-type-options: nosniff`,
`x-frame-options: DENY`, `referrer-policy: strict-origin-when-cross-origin`,
`permissions-policy` (17 diretivas).

**Ausentes:**

- **`Content-Security-Policy`** — o próprio `next.config.ts` diz que
  "o equivalente moderno (`frame-ancestors 'none'`) vive no CSP e fica para a PR
  propria". Está declarado como pendência, não esquecido — mas está ausente.
- **`Strict-Transport-Security`** — não veio nem do app nem da Cloudflare.

Vazam versão/infra: `x-powered-by: Next.js` e `x-screena-locale: pt`.

### Auditoria de dependências

**NÃO DETERMINADO.** Não rodei `pnpm audit` (precisa de rede ao registro e eu
priorizei medições que ninguém mais faria). Fecha com:
`corepack pnpm audit --audit-level=moderate --json`.

---

## D7 — Testes

**582 arquivos, 7.567 casos, 100% verde em 76,8 s** (com o Prisma Client
gerado). O total bate com a evolução esperada do repositório — não há sinal de
recorte de suíte.

Cobertura de linhas: **não há ferramenta configurada** (sem `@vitest/coverage-*`
no `package.json`). Digo isso em vez de inventar um número.

### Testes que ratificam defeito

**Procurei ativamente e não encontrei nenhum.** O que encontrei foi o oposto, e
merece registro: os testes deste repositório carregam **controles positivos e
negativos explícitos**, com o motivo escrito. Exemplo literal em
[`dry-run-precheck.test.ts:105`](services/ingestion/src/cli/__tests__/dry-run-precheck.test.ts):

```
// Sem isto, (2) e (3) passariam por vacuidade se o `spawnSync` falhar ao
// achar o tsx ou o arquivo: um filho que nunca sobe tambem "nao sobe".
expect(run.status).toBe(0)
```

E foi esse controle que pegou o meu ambiente quebrado antes que eu tirasse
conclusão errada. É o padrão certo.

### Testes que tocam produção

**Zero no caminho padrão.** Os validadores contra Postgres real
(`*-real-postgres.ts`) são scripts separados, invocados por `pnpm validate:*`, e
o worker editorial tem barreira anti-produção travada por
`tests/governance/editorial-worker-boundary.test.ts`.

---

## D8 — Dívida

### Comentários mentirosos

**Verifiquei os comentários que afirmam comportamento nos 33 arquivos lidos e
não encontrei nenhum falso.** Ao contrário: o padrão de comentário aqui é
registrar a medição e o erro anterior — `omdb-rotation.ts` documenta que a PR
#258 trouxe 8.114/6.461 "de um enunciado" e a medição direta devolveu
10.660/7.229. **Conferi no banco hoje: 10.661 e 7.230.** O comentário está
certo (diferença de 1 em cada é ingestão do próprio dia).

### O que mente é o **nome**, não o comentário

**`@screena/rapidapi-core`** é a infraestrutura HTTP do cliente **OMDb**, que
não é RapidAPI. Todo mundo que ler "vamos remover RapidAPI" vai olhar para esse
pacote e concluir errado — nos dois sentidos possíveis.

### E o que mente é a **governança**

**`CLAUDE.md:201`**: "**NUNCA** publicar conteudo automaticamente — publicacao
passa por humano."

Contra:
- `docs/adr/0017-automation-publisher-actor.md`, **status aceito**, 2026-07-29,
  que cria o ator `automation_publisher` com escopo `editorial_auto_publish`
  alcançando `published`;
- `EDITORIAL_AUTO_PUBLISH_ENABLED=true` no serviço `cinerie-cms` **em produção**;
- `docs/operations/editorial-auto-publication-quota.md`, que documenta os tetos
  diários dessa autopublicação.

O `CLAUDE.md` se declara autoritativo ("quando houver conflito ... **este
arquivo vence**"). Hoje ele proíbe, por escrito e com prioridade declarada, o
que o sistema faz em produção. Ou a linha 201 ganha a ressalva do ADR 0017, ou a
autopublicação está operando contra a lei do projeto. **É uma decisão do dono, e
não minha** — por isso não toquei.

#### E o que a autopublicação é de fato — porque a contradição não é descuido

Li o gate para poder descrever o que a linha 201 estaria proibindo, e ele é uma
das melhores peças do repositório. Registro em detalhe porque a FASE 4 depende
disto para julgar o kal-el:

**A máquina de estados** ([`apps/cms/src/workflow.ts:83`](../../apps/cms/src/workflow.ts))
tem 12 estados e a aresta que importa é explícita:

```typescript
automation_draft: ['draft', 'needs_review', 'ready_to_publish', 'blocked', 'archived'],
ready_to_publish: ['published', 'changes_requested', 'human_reviewed', 'blocked', 'archived'],
```

E o comentário declara a razão: *"`automation_draft` alcanca `ready_to_publish` —
e SO por ali chega a `published`, porque o gate de publicacao roda nessa aresta.
O caminho e exclusivo do `automation_publisher`"*. `published` **nunca** vem
direto; sempre passa pela aresta onde o gate roda.

**O gate** ([`apps/cms/src/auto-publication.ts`](../../apps/cms/src/auto-publication.ts),
555 linhas, **puro** — não escreve, não consulta banco, não chama rede) devolve
**cinco** desfechos distintos, e o cabeçalho explica por que não são três:

| Desfecho | Significa | Persistiu algo? |
| --- | --- | --- |
| `PUBLISHED` | publicou | sim |
| `ROUTED_TO_REVIEW` | conteúdo bom, decisão humana necessária | **sim**, em `needs_review` |
| `DEFERRED` | conteúdo bom, teto do dia esgotado | **não** — a reserva falha dentro da transação e o rollback leva o artigo junto |
| `BLOCKED` | erro permanente; reenviar igual não adianta | — |
| `CONFLICT` | revisão antiga, idempotência divergente, contrato incompatível | — |

O comentário conta o defeito que motivou separar `DEFERRED` de
`ROUTED_TO_REVIEW`: os dois nasceram com o mesmo rótulo, então teto esgotado
respondia "encaminhado para revisão" — *"mandar o produtor esperar por uma
revisao que nunca apareceria numa fila vazia […] O conteudo evaporava em
silencio, com 202 na resposta."*

**Os quatro tetos** ([`apps/cms/src/env-auto-publish.ts:54`](../../apps/cms/src/env-auto-publish.ts)),
com defaults conservadores que só valem em produção:

```typescript
export const CONSERVATIVE_DAILY_LIMIT = 50
export const CONSERVATIVE_PER_AUTHOR_LIMIT = 20
export const CONSERVATIVE_PER_SECTION_LIMIT = 30
export const CONSERVATIVE_PER_CONTENT_TYPE_LIMIT = 40
```

**O dia civil da redação** é por fuso IANA, e a validação **recusa offset fixo e
abreviação** (`env-auto-publish.ts:148`) — porque só um identificador IANA sabe
quando o dia vira sob horário de verão.

Ou seja: a autopublicação tem ator próprio derivado de escopo, aresta única com
gate, cinco desfechos que não colapsam causas, quatro tetos com reserva
transacional e dia civil por fuso real. **Não é "a IA publica sozinha" no
sentido que a linha 201 proíbe** — é publicação automática com contenção
desenhada.

O achado, então, é preciso: **não há defeito no mecanismo; há defeito no
documento que se declara a lei e diz o contrário do que o sistema faz.** Quem
ler o `CLAUDE.md` para decidir algo vai decidir errado.

### TODO / FIXME / HACK

Praticamente **zero**. A busca ingênua devolve 154 ocorrências, mas quase todas
são a palavra portuguesa "TODO" ("TODO card", "TODO idioma", "TODO mundo").
Filtrando para marcadores reais (`TODO:`, `FIXME`, `HACK`, `XXX:`) sobra **1
ocorrência**, e ela é uma referência a um documento de decisão, não uma
pendência esquecida.

### Duplicação que pode divergir

- `TMDB_API_KEY` e `SCREENA_TMDB_API_KEY` guardam **o mesmo valor** (provei por
  hash). Duas variáveis, um segredo, duas chances de rotacionar só uma.
- `CINERIE_PUBLIC_SITE_URL`, `SCREENA_PUBLIC_SITE_URL` e
  `THE_SCREEN_PUBLIC_SITE_URL` coexistem. Pior: `CINERIE_PUBLIC_INDEXING_ENABLED`
  vale `true` e `THE_SCREEN_PUBLIC_INDEXING_ENABLED` vale `0` — **formatos
  diferentes para a mesma pergunta**, e um deles é o valor oposto.

### Números mágicos

Bem tratados no geral: `batchLimit` está na tabela de ritmos ao lado do
intervalo, com o comentário explicando por que teto e cadência são a mesma classe
de decisão; escalas de rating vivem em `@screena/config`. O teto global de
**200** é a exceção — é um default de `config.ts` que governa 6 filas com
universos que vão de dezenas a 1,29 milhão de linhas.

---

## Tabela de achados

| # | Grav. | Arquivo:linha / local | Achado | Evidência | Consequência |
| --- | --- | --- | --- | --- | --- |
| S-01 | **CRÍTICO** | tabela `content_blocks` | 0 linhas; `entity_writer_jobs`/`logs` = 0 | banco | O diferencial editorial declarado não existe no produto |
| S-02 | **CRÍTICO** | `api_sync_logs` (fila `ratings_omdb`) | Fila "diária" rodou 2 de 7 dias; 923 e 850 de cota, acima do envelope de 700 | banco | 760 de 83.314 títulos (0,91%) com nota; volta real de 304 dias |
| S-03 | **ALTO** | `watch_availability` | 70.036 de 70.869 linhas com `display_allowed=false` | banco, com a cláusula real do gate | "Onde assistir" em 147 títulos (0,18%) |
| S-04 | **ALTO** | `CLAUDE.md:201` × `docs/adr/0017` × painel | Governança autoritativa proíbe o que a produção faz | código + painel | Regra sem valor, ou operação fora da regra |
| S-05 | **ALTO** | `api_cache` | 500.140 linhas vencidas (89%), 3,6 GB, sem job de expurgo | banco | Metade do banco de 10 GB é lixo |
| S-06 | **ALTO** | `page_indexability_decisions` | 164 linhas, **todas** de artigo; zero para entidade | banco | 83.347 URLs no sitemap sem decisão registrada |
| S-07 | **ALTO** | sitemap: sem shard `pessoas` | 62.647 pessoas com slug fora da descoberta | HTTP + banco | Maior classe de entidade indexável invisível ao buscador |
| S-08 | **ALTO** | painel, serviço `screen-app` | Render público carrega Gemini, OMDb, TMDB×3, RapidAPI×4, Brevo, S3, R2 | painel | Menor privilégio violado no processo mais exposto |
| S-09 | **MÉDIO** | `apps/web/middleware.ts:38` | Subrequest HTTP por requisição, **sem timeout** | código | Handler pendurado pendura a requisição do usuário |
| S-10 | **MÉDIO** | `services/sync/src/scheduler/config.ts:110` | Teto global 200 governa 6 filas; volta de `people` = 529 anos | código + banco | Frescor não é mantido; item sincronizado nunca é reconferido |
| S-11 | **MÉDIO** | sitemap `movies-1` | 48.611 URLs de um teto de 50.000 | HTTP | ~1.400 filmes até estourar o shard |
| S-12 | **MÉDIO** | `api-clients/rapidapi-core` | Nome mente: é infra do OMDb, não removível | código | Remoção "óbvia" quebraria o único fornecedor de notas |
| S-13 | **MÉDIO** | `api-clients/film_show_ratings`, `streaming_availability`, chaves `RAPIDAPI_*` em `screen-app` | Fornecedor descontinuado ainda versionado, aliasado e com chave em produção | código + painel | Superfície e confusão; 21 linhas de resíduo no banco (bloqueadas) |
| S-14 | **MÉDIO** | produção, cabeçalhos | Sem CSP e sem HSTS | requisição | Defesa em profundidade incompleta |
| S-15 | **MÉDIO** | `catalog_jobs` | 5.532 dead letters (1,1%) | banco | 3.658 `sync_details` e 1.836 `sync_media` perdidos |
| S-21 | **ALTO** | `entity_translations` | 62,5% dos filmes e 62,4% das séries sem sinopse pt-BR; 0 de 62.514 pessoas | banco | A maioria das fichas vai ao ar sem o texto que descreve a obra |
| S-22 | **ALTO** | `people.biography_source_status` | 2.152 biografias preenchidas; **100% das 1,3 M** em `unknown`, que bloqueia exibição | banco | Trabalho feito e invisível; encher `biography` não destrava nada |
| S-23 | **ALTO** | `movies.original_language`, `tv_shows.original_language` | Nula em 43,2% dos filmes e 59,6% das séries; `languages` tem 3 linhas | banco | O recorte de cinco idiomas não chegou ao dado |
| S-24 | **MÉDIO** | ritmo de ingestão × filas de enriquecimento | +3.084 filmes/h enquanto nota (0,91%), oferta (0,18%) e sinopse (37,5%) não acompanham | banco | As três coberturas **pioram sozinhas** a cada hora |
| S-16 | **BAIXO** | `.env` / painel | `TMDB_API_KEY` = `SCREENA_TMDB_API_KEY`; três variáveis de site URL; dois formatos de flag de indexação | hash + painel | Rotação parcial e configuração ambígua |
| S-17 | **BAIXO** | idempotência por exceção | `duplicate key` aborta transação no servidor | log do Postgres | Ruído permanente no log de erro do banco |
| S-18 | **BAIXO** | `scripts/typecheck/ensure-prisma-client.mjs` | Só avisa; não gera | execução | Clone limpo dá 10 suítes vermelhas com mensagem confusa |
| S-19 | **BAIXO** | 143 de 330 índices | `idx_scan = 0`, 122 MB | banco | Custo de escrita e disco sem retorno |
| S-20 | **BAIXO** | `package.json` engines | Pede node `>=22 <23`; ambiente usa v24 | execução | Aviso em toda execução |

---

## O que está morto

- **`workers/`** (9 arquivos Python) — esqueletos de roadmap, não executados por
  nenhum serviço. O `CLAUDE.md` já os declara assim.
- **`database/`** (4 arquivos) — legado; a fonte executável é `packages/db/prisma`.
- **`api-clients/imdb`, `kaso`, `rotten_tomatoes`** — só `README.md`, sem
  `package.json`. Declarados como placeholder.
- **`api-clients/film_show_ratings` e `streaming_availability`** — vivos no
  código, mortos por decisão do dono.
- **29 tabelas com zero linhas** — schema construído sem produtor rodando.

## O que mente

1. O **nome** `@screena/rapidapi-core` (é infra do OMDb).
2. O **`CLAUDE.md:201`** contra o ADR 0017 e a produção.
3. **`THE_SCREEN_PUBLIC_INDEXING_ENABLED=0`** convivendo com
   `CINERIE_PUBLIC_INDEXING_ENABLED=true` — duas respostas para a mesma pergunta.

Nenhum comentário de código, entre os que li, mente.

---

## O que NÃO determinei — e o comando que fecha

| Item | Comando/consulta |
| --- | --- |
| Por que `screen-cron` está amarelo e por que a fila OMDb roda 2/7 dias | Logs do serviço no painel; `SELECT status, count(*), max(created_at) FROM api_sync_logs WHERE provider_api='omdb' GROUP BY 1` |
| Custo servidor-a-servidor do subrequest do middleware | Instrumentar `/api/seo/redirect` com `Server-Timing`, ou medir de dentro do container |
| Causa dos 5.532 dead letters por tipo | `pnpm catalog inspect --json` (o formatador de texto descarta a mensagem) |
| Vulnerabilidades de dependência | `corepack pnpm audit --audit-level=moderate --json` |
| Cobertura de linhas dos testes | Instalar `@vitest/coverage-v8` e rodar `vitest run --coverage` |
| URLs nos shards `imagens-1/2` e `videos-1` | `GET /sitemaps/sitemap-pt-BR-imagens-1.xml` e contar `<loc>` |
| Se os 143 índices sem uso são realmente removíveis | Cruzar `pg_stat_user_indexes` com o `schema.prisma` e as consultas de cada rota |

---

## Anexo — os 33 arquivos que abri

**Integrais (12):** `package.json` · `pnpm-workspace.yaml` ·
`apps/web/middleware.ts` · `apps/web/app/api/seo/redirect/route.ts` ·
`apps/web/app/sitemap.xml/route.ts` · `apps/web/app/sitemaps/[shard]/route.ts` ·
`apps/web/app/api/internal/entity-resolve/route.ts` ·
`apps/web/src/server/entity-watch.ts` · `apps/web/src/server/entity-ratings.ts` ·
`packages/seo/src/indexability.ts` · `packages/config/src/omdb-rotation.ts` ·
`api-clients/omdb/src/client.ts`

**Substanciais (16):** `apps/web/src/server/seo/redirect-lookup.ts` ·
`apps/web/src/lib/entity-resolve-auth.ts` · `apps/web/next.config.ts` ·
`scripts/audit/check-render-purity.mjs` ·
`services/sync/src/scheduler/rhythms.ts` ·
`services/sync/src/scheduler/config.ts` · `services/sync/src/scheduler/due.ts` ·
`services/sync/src/scheduler/runtime/runners.ts` ·
`services/sync/src/scheduler/runtime/selection.ts` ·
`packages/db/prisma/schema.prisma` (3.015 linhas, lido por estrutura) ·
`docs/adr/0017-automation-publisher-actor.md` · `.env` (só nomes) ·
`CLAUDE.md` · `.claude/rules/{ratings,seo,ingestion,i18n,entity-writer}.md` ·
`apps/cms/src/workflow.ts` · `apps/cms/src/auto-publication.ts` ·
`apps/cms/src/env-auto-publish.ts` · `apps/cms/src/collections.ts` (por padrão) ·
`services/news-ingestion/bin/project-editorial.ts` (trechos da outbox)

**Diretórios que NÃO abri, e por quê:** `apps/cms/**` (369 arquivos — li 4:
`workflow.ts`, `auto-publication.ts`, `env-auto-publish.ts` e `collections.ts`), `apps/admin/**`,
`services/user-platform/**` (a plataforma tem 2 usuários; risco de produto
baixo), `packages/ui/**`, `docs/**` além dos 2 citados, todos os `__tests__/**`
individualmente (rodei os 7.567 em vez de lê-los), os 93 JSON e os 19 PNG.
