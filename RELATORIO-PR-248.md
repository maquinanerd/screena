# RELATÓRIO — PR #248 · Auditoria: trailer, nota, mídia e atualização diária

> **Leva de AUDITORIA.** Produto: um documento e números. Nenhuma linha de comportamento
> alterada, nenhuma chamada a provedor externo, nenhuma licença liberada, nenhuma escrita
> em produção, nenhum `--apply`.
>
> Data: **2026-08-28** · Branch: `claude/auditoria-trailer-nota-midia-acc8f5`
> PR: <https://github.com/maquinanerd/screena/pull/248>
> Documento entregue: [`docs/operations/midia-notas-e-atualizacao-diaria.md`](docs/operations/midia-notas-e-atualizacao-diaria.md)

---

## Índice

1. [O que foi pedido](#1-o-que-foi-pedido)
2. [O que foi entregue](#2-o-que-foi-entregue)
3. [Item 0 — O inventário do TMDB](#3-item-0--o-inventário-do-tmdb)
4. [Item B — Os 95.701 vídeos bloqueados](#4-item-b--os-95701-vídeos-bloqueados)
5. [Item C — As 32.762 notas que não aparecem](#5-item-c--as-32762-notas-que-não-aparecem)
6. [Item A — A coleta de nota externa](#6-item-a--a-coleta-de-nota-externa)
7. [Item D — A atualização diária](#7-item-d--a-atualização-diária)
8. [As três correções ao enunciado](#8-as-três-correções-ao-enunciado)
9. [O que tem que ser feito](#9-o-que-tem-que-ser-feito)
10. [O que ficou de fora, e por quê](#10-o-que-ficou-de-fora-e-por-quê)
11. [O SQL que falta rodar](#11-o-sql-que-falta-rodar)
12. [Artefatos desta leva](#12-artefatos-desta-leva)
13. [Método: como cada número foi obtido](#13-método-como-cada-número-foi-obtido)

---

## 1. O que foi pedido

### A decisão do dono, que é o alvo do trabalho

> *"Vídeos, notas, imagens, pôster, trailer, tudo é pra ter em todos os filmes, séries,
> episódios, temporadas e etc. Isso é pra ficar atualizado, diariamente."*

Não é preferência — é política. A auditoria existe para descobrir **o que impede isso hoje
e quanto custa chegar lá, com número, não com opinião**.

Restrição declarada: **RapidAPI não é mais usado.** Qualquer caminho que ainda dependa
dele é achado.

### Regras fixas da leva

1. Nenhuma tarefa/issue/recomendação sobre rotação de credenciais — decisão já tomada.
2. **Nunca imprimir valor de chave, token ou senha.** Só nome da variável, se está
   preenchida, e formato. `printenv | cut -d= -f1` é o permitido; `printenv` puro,
   proibido. `api_providers` pode conter credencial — nunca `SELECT *` nela.
3. Não commitar o `.env`.
4. Nenhum comando com dois hífens isolados como argumento próprio.
5. Nada destrutivo sem o dono: `DROP`, `TRUNCATE`, `DELETE` em massa, destruir serviço,
   apagar backup ou volume.
6. Nenhuma escrita em produção. Nenhuma coleta em massa. Nenhum `--apply`.

### Regra de honestidade

> Se você medir e o número não bater com o que está aqui, **o número manda** e este
> documento se corrige.

Com advertência específica: o autor do enunciado já errou duas vezes no mesmo dia por
presumir em vez de medir — presumiu que a falta de trailer era defeito de extração (era
portão de licença) e que não existia caminho de coleta de nota (existe, e trouxe 469
linhas). Instrução explícita: **antes de dizer "não existe", procure.** O repositório tem
histórico de máquina construída e desligada (`decideCatalogIndexability` com leitor nunca
executado, `revalidate` declarado treze meses sem ligar cache, `COLOR_TOKENS` sem
consumidor).

### Ordem de execução mandada

**0 → B → C → A → D**, parando onde parar e dizendo onde parou. O Item 0 é o mais valioso:
é o mapa que decide todo o resto.

### O que foi medido em produção antes da leva (2026-08-28, censo do dono)

| Medida | Valor |
| --- | --- |
| `tmdb_videos` | **98.096** linhas — 95.701 `unknown`/`display_allowed=false`; **2.395** `official`/`true` |
| Amostra `deadpool-2` | 8 vídeos, um `Trailer`, todos `site=YouTube`, todos `official=true`, todos `language_code='en'`, todos bloqueados |
| `cinerie_score_calculations` | **32.762** linhas, todas `status='calculated'`, nenhuma bloqueada. `deadpool-2`: `value=75.000`, `scale=100`, `blocked_reason` vazio — e a página não exibe nota |
| `external_ratings` | **469** linhas: imdb 226 · metacritic 115 · rotten_tomatoes 113+5 · letterboxd 5 · filmaffinity 5 |
| Procedência das notas | `omdb` → imdb/metacritic/rotten_tomatoes (19–21/08); `rapidapi_film_show_ratings` → letterboxd/rotten_tomatoes/filmaffinity (10/07, nunca mais) |
| Catálogo | 34.802 filmes + 32.486 séries = **67.288** títulos |
| Temporada, episódio, pessoa | **truncados em 100.000** no censo — totais reais desconhecidos |
| Fila | 406.301 `succeeded`, 2.122 `dead_letter`, **nada pendente** |
| `api_providers` | 7 linhas (colunas `key, name, kind, homepage_url, created_at` — sem credencial) |
| `rating_sources` | 5 linhas |
| `api_cache` | 4.310 MB — metade do banco |

### Os 27 subitens pedidos

<details>
<summary><b>Item 0 — Inventário completo do TMDB</b> (0.1 a 0.7)</summary>

- **0.1** O que pedimos: ler `MOVIE_APPEND`, `TV_APPEND` e os appends de temporada/episódio.
- **0.2** O que chega: extrair chaves de topo de `tmdb_raw.payload` e `api_cache.payload`, com frequência, por amostra declarada.
- **0.3** O que é consumido: para cada chave, achar o extrator e a coluna/tabela. Marcar NÃO CONSUMIDO.
- **0.4** Quanto custa o descartado: tamanho médio no payload.
- **0.5** O que o TMDB oferece e nem pedimos (aqui sim, consultar a documentação).
- **0.6** Quais entradas de `append-consumption.ts` mentem hoje — documentar, não consertar.
- **0.7** O limite do TMDB, confirmado no código ou na doc, **não de memória**.

Instrução explícita: tratar `append-consumption.ts` como **suspeito, não como fonte** —
"a auditoria constatou que 4 das 19 entradas mentem".
</details>

<details>
<summary><b>Item A — O que já existe para coleta de nota externa</b> (A.1 a A.6)</summary>

- **A.1** Achar o código que escreveu as linhas de OMDb. **Está agendado ou é manual?** — pergunta central.
- **A.2** Confirmar ou refutar a explicação do enunciado para o "parou em 226".
- **A.3** Qual o limite da chave OMDb em produção.
- **A.4** Quais fontes uma chamada do OMDb cobre; `letterboxd`/`filmaffinity` vinham só do RapidAPI?
- **A.5** Onde o RapidAPI ainda está no código — mapear, não remover.
- **A.6** Quantos títulos têm IMDb ID — o teto real da cobertura.
</details>

<details>
<summary><b>Item B — Por que 95.701 vídeos estão bloqueados</b> (B.1 a B.5)</summary>

- **B.1** Quem escreve `license_status` e `display_allowed` em `tmdb_videos`.
- **B.2** Existe comando análogo ao das imagens? Qual a invocação para vídeo. **Não executar.**
- **B.3** O apresentador filtra vídeo por idioma? Se sim, liberar licença não resolve sozinho — "e isso precisa estar escrito no relatório em letra grande".
- **B.4** Distribuição dos 2.395 por `language_code` e `video_type`.
- **B.5** O `entity-trailer.ts` ainda tem o comportamento que o comentário descreve?
</details>

<details>
<summary><b>Item C — 32.762 notas calculadas que não aparecem</b> (C.1 a C.4)</summary>

- **C.1** Ler o caminho de `cinerie_score_calculations` até o HTML. Onde quebra?
- **C.2** Provar por renderização, não por leitura.
- **C.3** A nota aparece em algum lugar do site? Listagem, card, busca?
- **C.4** O `schema.org` declara a nota sem exibir? Seria violação.
</details>

<details>
<summary><b>Item D — A atualização diária</b> (D.1 a D.6)</summary>

- **D.1** Confirmar a chave sem escopo de `sync_media`/`sync_seasons`/`sync_episodes`, com arquivo e linha.
- **D.2** Os números reais do catálogo, sem o teto de 100.000.
- **D.3** A conta de viabilidade por fonte, com número.
- **D.4** Proposta de ritmo escalonado, se a diária não couber.
- **D.5** Onde isso se encaixa em `services/sync/src/scheduler/rhythms.ts`. **Não inventar agendador novo.**
- **D.6** Os 2.122 `dead_letter`.
</details>

<details>
<summary><b>Item E — O documento</b> (E.1 a E.3)</summary>

- **E.1** Escrever `docs/operations/midia-notas-e-atualizacao-diaria.md`.
- **E.2** Separar decisão de licença do dono, decisão de custo do dono, e conserto de código. **Não misturar.**
- **E.3** Ordenar por retorno sobre esforço, com justificativa. Dizer qual faria primeiro e por quê.
</details>

### O que não fazer

Nenhuma mudança de comportamento · nenhuma coleta em massa · não liberar licença de vídeo
(é assinatura do dono) · não mexer em sitemap, gate de decisão, ISR das fichas ou política
de cache por rota · não mexer na extração de sinopse e biografia (é o PROMPT 5, pode estar
rodando em paralelo) · não submeter nada no Search Console.

---

## 2. O que foi entregue

| Item | Estado | Onde |
| --- | --- | --- |
| **0.1** o que pedimos | ✅ medido | §3.1 |
| **0.2** o que chega | ⏸️ SQL pronto | §11 consulta 9 |
| **0.3** o que é consumido | ✅ medido, entrada por entrada | §3.2 |
| **0.4** custo do descartado | ⏸️ SQL pronto | §11 consultas 9–10 |
| **0.5** o que não pedimos | ✅ medido contra a doc | §3.4 |
| **0.6** quem mente | ✅ **ninguém** — corrigido em 27/08 | §3.3 |
| **0.7** limite do TMDB | ✅ confirmado na doc | §3.5 |
| **A.1** agendado ou manual | ✅ **agendado** | §6.1 |
| **A.2** por que parou em 226 | ✅ **refutado** — é cadência | §6.2 |
| **A.3** limite da chave | ⚠️ **não determinado** (declarado) | §6.3 |
| **A.4** fontes cobertas | ✅ medido | §6.4 |
| **A.5** onde o RapidAPI está | ✅ mapeado | §6.5 |
| **A.6** títulos com IMDb ID | ⏸️ SQL pronto | §11 consulta 2 |
| **B.1** quem escreve as colunas | ✅ medido | §4.1 |
| **B.2** o comando | ✅ identificado, **não executado** | §4.2 |
| **B.3** filtra por idioma | ✅ **NÃO** — premissa refutada | §4.4 |
| **B.4** distribuição dos acesos | ⏸️ SQL pronto | §11 consulta 6 |
| **B.5** comentário ainda vale | ✅ **não** — está velho | §4.5 |
| **C.1** onde o caminho quebra | ✅ medido — dois caminhos | §5 |
| **C.2** prova por renderização | ⏸️ **não executada, por método** | §10 |
| **C.3** aparece em listagem | ✅ **não, em lugar nenhum** | §5.2 |
| **C.4** schema.org declara | ✅ **não** — sem violação | §5.3 |
| **D.1** chave sem escopo | ✅ confirmado, arquivo:linha | §7.1 |
| **D.2** números reais | ⚠️ parcial — proxies declarados | §7.2 |
| **D.3** conta de viabilidade | ✅ calculada | §7.3 |
| **D.4** ritmo escalonado | ✅ proposto | §7.4 |
| **D.5** onde se encaixa | ✅ três ajustes na máquina existente | §7.5 |
| **D.6** dead letter | ⏸️ SQL pronto | §11 consulta 7 |
| **E.1** o documento | ✅ escrito | `docs/operations/…` |
| **E.2** separar as naturezas | ✅ feito | §9 |
| **E.3** ordenar por ROI | ✅ feito | §9.4 |

**23 de 27 subitens medidos.** Os 4 restantes + 4 parciais têm a **mesma causa única**: o
banco de produção não é alcançável da máquina local.

---

## 3. Item 0 — O inventário do TMDB

### 3.1 O que pedimos (`append-to-response.ts`)

**47 pares `(tipo, valor)`, 19 valores únicos.**

| Tipo | Appends | N |
| --- | --- | --- |
| `movie` | credits, external_ids, images, videos, keywords, recommendations, similar, reviews, release_dates, translations, alternative_titles, watch/providers, changes | 13 |
| `tv` | os de movie menos `release_dates`, mais aggregate_credits, content_ratings, episode_groups, screened_theatrically | 16 |
| `tv_season` | credits, aggregate_credits, external_ids, images, videos, translations, watch/providers | 7 |
| `tv_episode` | credits, external_ids, images, videos, translations | 5 |
| `person` | external_ids, combined_credits, images, tagged_images, translations, changes | 6 |

O teto do TMDB é **20 sub-requests por chamada**. Nenhuma lista encosta no teto — logo
**cada entidade custa 1 requisição de detalhe**, não várias. Esse é o fato que faz a conta
do Item D fechar.

### 3.2 O que é consumido, e o que é jogado fora

**Consumidos** — para cada um verifiquei três coisas: o módulo citado **existe**, a string
do campo **aparece nele**, e a função extratora **é chamada** por alguém fora de teste.

| Bloco | Tipos | Consumido por | Cópia | Pousa em |
| --- | --- | --- | --- | --- |
| `credits` | movie, tv | `normalizers/credits.ts` | append | `cast_members`, `crew_members` |
| `credits` | tv_episode | `episodes/normalize.ts` | append | idem (escopo episódio) |
| `external_ids` | movie, tv, person | `normalizers/external-ids.ts` | append | `entity_external_ids` + coluna `imdb_id` |
| `external_ids` | tv_episode | `episodes/normalize.ts` | append | `entity_external_ids` |
| `images` | movie, tv, person, tv_season | `catalog-sync/media-normalize.ts` | **endpoint próprio** | `tmdb_images` |
| `images` | tv_episode | `episodes/normalize.ts` | append | `tmdb_images` |
| `videos` | movie, tv, tv_season, tv_episode | `catalog-sync/media-normalize.ts` | **endpoint próprio** | `tmdb_videos` |
| `watch/providers` | movie, tv | `normalizers/watch-providers.ts` | append | `watch_availability` |
| `recommendations`, `similar` | movie, tv | `normalizers/recommendations.ts` | append | relacionados |
| `release_dates` | movie | `normalizers/detail-facts.ts` | append | estreia BR + classificação |
| `content_ratings` | tv | `normalizers/detail-facts.ts` | append | classificação indicativa BR |
| `keywords` | movie, tv | `catalog-entities/normalize.ts` | append | dicionário |
| `alternative_titles` | movie, tv | `catalog-entities/normalize.ts` | append | títulos alternativos |

**Jogados fora** (pedidos e sem leitor):

| Bloco | Tipos | Razão declarada |
| --- | --- | --- |
| `reviews` | movie, tv | Proibido exibir — `review_quote_allowed=false` em toda licença |
| `translations` | os 5 tipos | Porta de en/es — depende de `PUBLISHED_LOCALES` e revisão humana |
| `changes` | movie, tv, person | Usamos os `/changes` **globais**, não o bloco por entidade |
| `aggregate_credits` | tv, tv_season | Schema não tem contagem de episódios por crédito |
| `combined_credits` | person | Filmografia é montada pelo caminho **inverso** (créditos de cada título) |
| `episode_groups` | tv | Ordem cronológica — bloco de valor 11, sem escopo |
| `screened_theatrically` | tv | Fato raro, sem tela no canônico |
| `tagged_images` | person | Procedência de usuário, não editorial |
| `credits` | **tv_season** | Nenhuma tela tem elenco por temporada |
| `external_ids` | **tv_season** | Nada resolve id de temporada |
| `watch/providers` | **tv_season** | `normalizeWatchProviders` recusa — não há página de oferta por temporada |

**Verificação do lado negativo** (o que impede o erro simétrico): `episode_groups`,
`screened_theatrically`, `tagged_images` e `aggregate_credits` têm **zero ocorrências** em
`services/**` fora de teste; `combined_credits` aparece só num comentário. Ou seja, nenhuma
entrada "adiada" esconde consumidor.

**A trava passa:** `tests/governance/tmdb-append-consumption.test.ts` — **13 testes,
verdes**. Ela garante *cobertura* (nenhum par sem classificação, nenhum nas duas listas,
nenhuma entrada morta), **não veracidade**. A veracidade acima foi conferida à mão.

### 3.3 Quais entradas mentem hoje — **nenhuma**

Esta é a primeira correção ao enunciado.

O enunciado manda tratar `append-consumption.ts` como suspeito porque "4 das 19 entradas
mentem". Isso era verdade — e deixou de ser no commit **`150c079` (2026-08-27 11:34)**, que
corrigiu exatamente quatro valores. O próprio cabeçalho do arquivo documenta cada um:

| Valor | Estava | Verdade | Corrigido |
| --- | --- | --- | --- |
| `keywords` | adiado ("não há superfície") | **consumido** — `catalog-services.ts:314` | 27/08 |
| `alternative_titles` | adiado | **consumido** — `catalog-services.ts:315` | 27/08 |
| `aggregate_credits` | consumido (apontava `credits.ts`) | **não consumido** — a string nunca esteve lá | 27/08 |
| `combined_credits` | consumido (apontava `credits.ts`) | **não consumido** | 27/08 |

Na mesma leva a chave do registro deixou de ser o valor sozinho e passou a ser o par
`(tipo, valor)` — o que tornou visíveis os sete appends de temporada que vinham sendo
pedidos e descartados inteiros.

**Conclusão: o arquivo é fonte confiável a partir de 27/08.** A desconfiança do enunciado
estava correta na data em que foi escrita e deixou de estar antes desta auditoria começar.

### 3.4 O que o TMDB oferece e nem pedimos

No nível de **append**: praticamente nada. As únicas ausências são `account_states` (exige
sessão de usuário) e `lists` (curadoria de usuário) — as duas excluídas de propósito e
documentadas. **As listas de append estão completas.**

O buraco real está no nível de **endpoint**. O cliente implementa 25 rotas fixas
(`/configuration*`, `/genre/*`, `/certification/*`, `/discover/*`, `/search/*`,
`/trending/*`, os três `/changes`, listas de popularidade) mais as rotas por entidade.
**Não implementa:**

| Ausente | O que traz | Lacuna que preencheria |
| --- | --- | --- |
| `/watch/providers/movie`<br>`/watch/providers/tv`<br>`/watch/providers/regions` | **Dicionário oficial de provedores**: id, nome, logo, países | **O mais acionável.** Hoje `services/streaming/src/provider-registry.ts` é mantido **à mão** (24 provedores BR). Provedor novo no TMDB não existe para nós até alguém editar código. |
| `/find/{external_id}` | Resolve TMDB id a partir de IMDb/TVDB id | Caminho de volta do OMDb para o catálogo — hoje só temos TMDB → IMDb |
| `/configuration/primary_translations` | Idiomas com tradução de primeira classe | Decidir `PUBLISHED_LOCALES` com dado em vez de palpite |
| `/tv/episode_group/{id}` | Conteúdo de uma ordem alternativa | Bloco de valor 11 — hoje pedimos `episode_groups` e não temos como abrir o grupo |
| `/movie/{id}/lists`, `/review/{id}` | Curadoria e crítica de usuário | Nenhuma — procedência de usuário, fora da política |

### 3.5 O limite do TMDB (0.7)

Confirmado **na documentação** (`developer.themoviedb.org/docs/rate-limiting`), não de
memória:

- **Não há cota diária.** A documentação só discute limite por segundo.
- O limite antigo (40 req/10 s) foi desativado em **16/12/2019**.
- O vigente, textualmente: *"somewhere in the 40 requests per second range"*, com aviso de
  que pode mudar. Estouro devolve **429**.
- `append_to_response`: *"comma separated list of endpoints within this namespace,
  **20 items max**"*.

O projeto já codifica isso: `TMDB_QUOTA` (`packages/config/src/provider-quotas.ts`) declara
`perDay: null`, `perSecond: 40`.

> **Divergência menor medida.** O comentário daquela constante afirma que a orientação
> vigente é "~50 req/s" e que 40 seria "piso 20% abaixo". A doc diz **40**. Nosso teto está
> **no** número documentado, não abaixo dele. Não muda nenhuma conta (que já usa 40), mas o
> texto está errado.

---

## 4. Item B — Os 95.701 vídeos bloqueados

### 4.1 Quem escreve as duas colunas

`tmdb_videos` nasce com `license_status = unknown` e `display_allowed = false` — são os
**DEFAULT do DDL** (`schema.prisma:1485-1486`); `catalog-sync/media-sync.ts` não os toca.
**Toda linha entra escura.**

São **duas** colunas, e todo consumidor filtra o par:

```
display_allowed = true  AND  license_status NOT IN ('unknown','blocked')
```

Ligar só uma **não acende nada** — a linha para na segunda condição.

O único caminho que as escreve é `services/ingestion/src/media-promotion/`. E
**`tmdb_videos` não tem trigger**: diferente de `watch_availability` e `external_ratings`,
protegidas no banco por `data_usage_decisions_guard`, aqui um `UPDATE` cru passa sem
barreira. O gate em `media-promotion/license.ts` é a única coisa entre uma linha escura e
uma linha pública.

### 4.2 O comando (B.2) — identificado, **não executado**

```bash
corepack pnpm --filter @screena/ingestion promote:media --target=video --reviewer="Pablo Eduardo" --confirm
```

O que faria: lê `source_licenses` para `(source_key='tmdb', content_type='video')`, exige
licença **vigente** com `display_allowed`, e grava nas linhas o `license_status` **derivado
da licença vigente** — nunca um literal otimista. Sem `--confirm` é dry-run, e o dry-run lê
exatamente a mesma coisa que o apply.

**Não existe flag que pule o gate de licença.** Não há `--license-ok`; `--force` não existe
para este comando; `--confirm` não substitui a autorização.

### 4.3 Por que só 2.395 acenderam

O freio de mudança em massa (`media-promotion/brake.ts`): **500 linhas por execução OU 5%
do total do alvo**, o que vier primeiro. Com 98.096 linhas, 5% = 4.904 — o teto que morde é
o absoluto, **500**. Passar exige `--confirm-mass-change`.

2.395 ÷ 500 ≈ **5 execuções**. *Isso é inferência, não medição* — a confirmação está na
consulta 6c do §11.

### 4.4 O apresentador filtra por idioma? **NÃO** — premissa refutada

Esta era a dúvida que decidia se liberar licença bastaria. **Basta.**

Em `apps/web/src/lib/trailer-presenter.ts`, `languageRank` **não é filtro** — é o
**terceiro critério de desempate** da ordenação:

1. `Trailer` antes de `Teaser`
2. oficial antes de não-oficial
3. **pt-BR → inglês → resto** ← aqui, e só aqui
4. publicado mais recente
5. `videoKey` alfabético

O gate real, `isDisplayableTrailerRow`, tem cinco condições e **nenhuma é idioma**:
`displayAllowed === true`, `licenseStatus ∉ {unknown, blocked}`, `site === "YouTube"`,
`videoType ∈ {Trailer, Teaser}`, e `videoKey` que produza embed válido.

**Para o Deadpool 2:** os 8 vídeos são `en`, `site=YouTube`, e um é `Trailer`. Assim que a
promoção acender as linhas, ele é escolhido e a ficha mostra o player. Idioma só decidiria
**qual** vídeo ganha se houvesse um pt-BR concorrendo.

### 4.5 Os comentários estão velhos (B.5)

| Arquivo | Afirma | Estado real |
| --- | --- | --- |
| `apps/web/src/server/entity-trailer.ts` | *"HOJE DEVOLVE `null` PARA TODO MUNDO"*, *"NADA no repositório as promove"* | **Falso.** `media-promotion/` promove, e 2.395 linhas estão acesas — para elas a função devolve trailer. |
| `apps/web/src/lib/trailer-presenter.ts` | *"hoje isto ainda devolve `null` para todo mundo"* | **Falso**, mesma razão. |

Documentação atrás do código — classe já catalogada neste repositório. Corrigir é risco
zero; **não foi feito nesta leva**, que é de medição.

---

## 5. Item C — As 32.762 notas que não aparecem

**Há dois caminhos independentes para a nota, com fontes e portões diferentes.** Essa
separação é a resposta do item, e não estava documentada em lugar nenhum.

### 5.1 Caminho da FICHA — fiado; o portão é licença

```
cinerie_score_calculations
  └─> entity-hero.ts :: getCinerieScoreForEntity      ← PORTÃO 1: decisão de licença
      └─> movie-page.ts:362 / series-page.ts
          └─> app/pt/filmes/[slug]/page.tsx:158 :: decideCinerieScore   ← PORTÃO 2: ≥ 2 fontes
              └─> <CinerieScoreCard>
```

**A fiação está completa.** *(Uma leitura de 21/08 registrou que "`decideCinerieScore` não
é chamado por nenhuma página" — deixou de valer; hoje as duas fichas o chamam. A memória
foi corrigida nesta leva.)*

**Portão 1 — licença.** `getCinerieScoreForEntity` roda um `SELECT` em
`data_usage_decisions` exigindo, **tudo junto**: `use_case='cinerie_score_display'`,
`d.is_current`, `l.is_current`, `stage='approved_for_display'`, `display_allowed`,
`derivative_allowed`, e `valid_from`/`valid_until` cobrindo agora. **Sem essa linha,
`authorized = false` e a função nem lê o cálculo** — os 32.762 registros ficam invisíveis
independentemente do valor.

**Portão 2 — piso de duas fontes.** `decideCinerieScore` reconstrói as fontes a partir de
`explanation` e exige `≥ 2` **com rótulo declarado** (`MINIMUM_COUNTED_SOURCES = 2`). Fonte
sem rótulo é descartada.

**Escala:** `CINERIE_SCORE_DISPLAY_SCALE = 100`, e o `deadpool-2` tem `scale=100`. **Aqui
não há conflito.**

**Qual dos dois portões fecha em produção, não sei** — os dois dependem de dados que só
existem no banco. A consulta 1 do §11 separa os dois casos. **É a pergunta mais barata em
aberto de todo o relatório: uma linha de SQL.**

### 5.2 Caminho da LISTAGEM — **estruturalmente morto**

Este é o achado do item, e é **conserto de código**, não decisão do dono.

O card **não lê `cinerie_score_calculations` como fonte do número**. Lê as colunas
`movies.screen_score` / `screen_score_scale` / `screen_score_display`, e usa
`cinerie_score_calculations` só como **procedência** (`editorial-score.ts`): só libera se
houver cálculo `calculated` cujo `value`/`scale` **batam** com as colunas.

**Três interrupções em série, cada uma fatal sozinha:**

1. **Nada no repositório escreve `movies.screen_score`.** Varri `services/`, `apps/`,
   `packages/`, `scripts/`: **zero escritas**. Os dois workers de rating dizem em voz alta
   nos próprios relatórios: *"`screen_score` (nota editorial propria) NAO e tocado por este
   worker"*. Sem a coluna, `resolveEditorialScoreSources` filtra a entidade fora na
   primeira linha — `candidates` fica vazio.

2. **`screen_score_display` foi zerado por migration e nunca religado.** A migration
   `20260717120000_external_intelligence_product` executa
   `UPDATE "movies" SET "screen_score_display" = false` (e igual em `tv_shows`), e a coluna
   tem `@default(false)`. Nada a liga de volta.

3. **As escalas são incompatíveis.** `resolveCardScreenScore` exige
   `scale === SCREEN_SCORE_SCALE`, e **`SCREEN_SCORE_SCALE = 5`**
   (`home-hero-presenter.ts:23`). Os cálculos são gravados em **escala 100**. Um cálculo em
   100 **nunca** passa num gate que exige 5.

**Resposta ao C.3: a nota não aparece em nenhuma listagem, card ou busca.** Não é "aparece
num lugar e não em outro" — é um caminho inteiro construído e nunca ligado. Do ponto de
vista do dono, **a ficha é o único lugar onde a nota pode aparecer hoje**.

### 5.3 O schema.org declara a nota? **Não** — e está certo

Varri `apps/web` e `packages/seo`: **nenhum JSON-LD emite `aggregateRating`**. As únicas
ocorrências são comentários explicando por que não se emite, e testes que **reprovam** se
aparecer (`article-technical-seo.test.ts`: `expect(jsonLd.aggregateRating).toBeUndefined()`;
o canário editorial verifica o mesmo no HTML servido).

**Não há violação:** a ficha não declara o que não exibe. E como o Cinerie Score é nota
**própria**, nunca poderia virar `AggregateRating` de terceiro de qualquer forma.

---

## 6. Item A — A coleta de nota externa

### 6.1 Existe, está agendado, e tem executor (A.1)

| Camada | Onde | Estado |
| --- | --- | --- |
| Cliente HTTP | `api-clients/omdb/` | real |
| Worker | `services/ratings/src/omdb/` + `bin/sync-omdb-ratings.ts` | real |
| Fila | `rhythms.ts:177` — `ratings_omdb`, `providerApi: 'omdb'`, **7 dias** | declarada |
| Executor | `runners.ts:610` — `runRatingsOmdb` | **existe e chama o worker** |
| Cota | `omdb-budget.ts` + `provider-quotas.ts` | 1.000/dia, 150 reservados ao leitor |

**Está agendado, não é manual.** Isso responde a pergunta central do item — e refuta a
hipótese natural de "alguém rodou na mão uma vez".

### 6.2 Por que parou em 226 — a explicação do enunciado está **incompleta** (A.2)

O enunciado propõe: *"em 19/08 o catálogo tinha 239 títulos; a OMDb cobriu 226 e terminou o
serviço; depois o catálogo foi para 67.288 e nada re-executou."*

A primeira metade é consistente. **A segunda não se sustenta.**

A seleção (`stale-entity-candidates.ts`) usa `NOT EXISTS`, que cobre **os dois casos de
propósito**: entidade **nunca coletada** (não há linha) e entidade coletada há tempo
suficiente. A ordenação é `popularity DESC NULLS LAST, id ASC`. Os 67 mil títulos novos
**são candidatos válidos** e entrariam pelos mais populares. **Não há lista de entrada
fixa.**

O gargalo é a **cadência**, com duas travas em série:

1. `runRatingsOmdb` pede `backgroundOmdbSlots(spentToday, batchLimit)` =
   `min(batchLimit, 1000 − gasto − 150)`. Com `CINERIE_SCHEDULER_BATCH_LIMIT` no default
   **200**, o teto por execução é **200**, não 850.
2. Essas 200 viram **100 filmes + 100 séries** (`perType = slots/2`), e a fila só fica
   devida **a cada 7 dias**.

> ### 200 títulos por semana ≈ 28,6/dia. Volta completa: **2.355 dias — 6,5 anos.**

Isso **contradiz a justificativa escrita na própria tabela de ritmos**, que diz: *"O limite
real é a COTA (1.000/dia), não o relógio."* No código, **o relógio manda, por 30×**. É a
divergência mais cara deste relatório.

*Duas condições ainda não medidas* (consultas 3 e 4 do §11): se a fila **de fato executou**
desde 19/08, e se `CINERIE_SCHEDULER_APPLY=true`. Sem ele em produção o `/readyz` bloqueia
— então um serviço verde já é evidência forte, mas evidência não é medição.

### 6.3 O limite da chave em produção — **não determinado** (A.3)

Sendo honesto: **não consegui determinar qual plano a chave de produção usa.**

O que sei: o código assume **1.000/dia** (`OMDB_QUOTA.perDay`), com `basis: "published"`
citando `omdbapi.com/apikey.aspx` — *"FREE! (1,000 daily limit)"*. Mas isso é afirmação
sobre **o plano gratuito**, não sobre **a chave configurada**. As duas coisas foram
colapsadas na constante.

Não fiz a chamada de sonda por duas razões: não tenho a credencial nesta máquina
(`printenv | cut -d= -f1` não traz variável OMDb) e a regra 6 da leva proíbe coleta contra
provedor externo.

**Como determinar em um passo:** o painel do OMDb (Patreon) mostra o plano da conta. **Se
for pago, `OMDB_QUOTA.perDay` está subestimado e toda a conta do §7.3 melhora
proporcionalmente.**

### 6.4 Uma chamada cobre três fontes (A.4)

`services/ratings/src/omdb/sources.ts` mapeia o array `Ratings[]` de **um** payload em até
**três linhas** de `external_ratings`, cada uma com fonte, escala e crédito próprios — o
`omdb` é `provider_api`, **nunca** `rating_source` (invariante 2):

| Fonte OMDb | `rating_source` | `metric` | Natureza |
| --- | --- | --- | --- |
| Internet Movie Database | `imdb` | `audience` | média de votos de usuários |
| Rotten Tomatoes | `rotten_tomatoes` | `critics` | **Tomatometer** (o Popcornmeter não vem neste payload) |
| Metacritic | `metacritic` | `critics` | Metascore |

Isso explica os números do censo: **226 / 115 / 113 são os títulos que têm cada nota**, não
três coletas diferentes.

> ### As duas que sobram vêm SÓ do RapidAPI
>
> `letterboxd` e `filmaffinity` são as 5+5 linhas de 10/07 que nunca mais se moveram.
> **Não há segundo caminho no repositório.** Ao desligar o RapidAPI, as duas ficam
> **permanentemente descobertas**: as 10 linhas existentes envelhecem e nada as renova.
> As opções são aceitar duas fontes a menos ou abrir escopo para outro fornecedor.
> Não há terceira.

### 6.5 Onde o RapidAPI ainda está (A.5) — mapeado, não removido

Três naturezas diferentes. Misturá-las levaria a arrancar código que **não é** RapidAPI:

| Ponto | Alimenta | Chama a rede? |
| --- | --- | --- |
| `api-clients/rapidapi-core/` | Utilitários: `hashPayload`, `sanitize`, `env`. **Importado pelo caminho da OMDb** (`omdb/run.ts:27`) | **Não.** É biblioteca compartilhada. **Arrancar quebra a OMDb.** |
| `api-clients/film_show_ratings/` + `bin/sync-film-show-ratings.ts` | **Único caminho** de `letterboxd` e `filmaffinity` | **Sim.** CLI manual — **sem fila no agendador**. |
| `api-clients/streaming_availability/` + `services/streaming/` | Disponibilidade de streaming | **Sim.** CLI manual — **superado**: a fila `watch_offers` usa `providerApi: 'tmdb'`. |
| `PROVIDER_QUOTAS.rapidapi` | Teto declarado (16/dia, `assumed_floor`) | Não — é dado. |

**Nenhuma fila do agendador tem `providerApi: 'rapidapi'`.** As que consomem fornecedor
usam `tmdb`, `tmdb-exports` ou `omdb`. **Em regime automático o RapidAPI já não é
chamado.** O que sobrevive é código alcançável só por CLI manual, mais a dependência de
utilitário — que é RapidAPI só no nome.

### 6.6 O teto real da cobertura (A.6) — não medido

A seleção exige `imdb_id IS NOT NULL` (`stale-entity-candidates.ts:66,93`). Sem ele não há
como consultar a OMDb, que é chaveada por IMDb id.

`movies.imdb_id` é preenchido por `normalizers/movie.ts:79`
(`detail.imdb_id ?? detail.external_ids.imdb_id`); `tv_shows.imdb_id` por
`normalizers/tv.ts:72` (só `external_ids.imdb_id` — o detalhe de série não traz o campo no
topo). **Os dois exigem que o sync de DETALHE tenha rodado.** Título que só passou pela
descoberta de ids **não tem** e nunca será consultado.

Consulta 2 do §11. **Esse número é o teto da cobertura possível** — sem ele, a conta do
§7.3 usa 67.288, que é o limite superior otimista.

---

## 7. Item D — A atualização diária

### 7.1 A chave sem escopo (D.1) — confirmada, com arquivo e linha

| Job | Chave | Arquivo:linha | Re-sincroniza? |
| --- | --- | --- | --- |
| `sync_details` (agendador) | `<fila>:<AAAA-MM-DD>` | `runtime/selection.ts` ← `scope.ts` | **Sim** — chave nova por dia |
| `sync_media` | `discriminator: input.locale` | `sync-details-handler.ts:217` (via `push` em `:225`) | **Não — write-once** |
| `sync_seasons` | idem | `sync-details-handler.ts:217` (via `push` em `:227`) | **Não — write-once** |
| `sync_episodes` | `s<n>:<locale>` | `sync-seasons-handler.ts:106` | **Não — write-once** |

`sync_media:pt-BR` de um título já processado **colide consigo mesma para sempre**:
`catalog_jobs` não é podado em produção, então cada linha `succeeded` segura a chave
indefinidamente. O próprio código admite, em comentário em `sync-details-handler.ts:230`:

> *"A CHAVE DO FILHO NAO TEM ESCOPO, a do pai tem […] o noop e o caminho normal, nao a
> excecao."*

**Não existe fila de mídia em `rhythms.ts`.** A única reexecução é `catalog media`, que
roda o handler **inline**, fora da fila. A janela de 7 dias para mídia declarada em
`.claude/rules/ingestion.md` **não tem executor**.

**Quantos títulos congelados:** todos que já tiveram `sync_media` bem sucedido — o censo
anterior registrou 97.898. Confirmação na consulta 4 do §11.

### 7.2 Os números reais (D.2) — parcialmente medidos

Filmes e séries vieram do censo. **Temporada, episódio e pessoa continuam desconhecidos**
(truncados em 100.000). Consulta 5 do §11.

Para não travar a conta, usei **proxies declarados** — as contagens de jobs concluídos do
censo de 27/08, que são um piso razoável:

| Entidade | Valor usado | Origem |
| --- | --- | --- |
| Filmes | 34.802 | **medido** |
| Séries | 32.486 | **medido** |
| Temporadas | 32.483 | *proxy* — `sync_seasons` succeeded |
| Episódios | 135.926 | *proxy* — `sync_episodes` succeeded |
| Pessoas | 100.000 | *piso* — censo truncado; o real é maior |

### 7.3 A conta de viabilidade (D.3)

#### TMDB — cabe, com folga

| Trabalho | Requisições | Base |
| --- | --- | --- |
| Detalhe (1 req/entidade, appends inclusos) | 335.697 | 67.288 títulos + 32.483 temporadas + 135.926 episódios + 100.000 pessoas |
| Mídia (`/images` + `/videos` dedicados, 2 req) | 471.394 | títulos + temporadas + episódios |
| Ofertas (`/watch/providers` dedicado) | 67.288 | títulos |
| **Total de uma passagem completa** | **874.379** | |

| Ritmo | Duração | Teto diário |
| --- | --- | --- |
| **40 req/s** (nosso teto) | **6,07 h** | 3.456.000 |
| 20 req/s (metade, margem) | 12,14 h | 1.728.000 |
| 10 req/s (um quarto) | 24,29 h | 864.000 |

> **A diária completa do TMDB cabe em ~6 horas**, e cabe mesmo a 20 req/s. Com pessoas
> subestimadas em 3×, ainda cabe. **O TMDB nunca foi o obstáculo, e nunca foi custo.**

#### OMDb — não cabe, e a distância é grande

| Cenário | Req/dia | Volta completa (67.288 títulos) |
| --- | --- | --- |
| Cota utilizável (1.000 − 150 de reserva) | 850 | **79 dias** |
| **Ritmo real do agendador hoje** (200 a cada 7 d) | 28,6 | **2.355 dias ≈ 6,5 anos** |
| Para fechar a janela de 7 dias declarada | 9.613 | **9,6× a cota gratuita** |

### 7.4 Proposta de ritmo escalonado (D.4)

Como a diária completa da OMDb é impossível no plano gratuito, o critério tem de ser
**popularidade** — o sinal que o banco já tem, já indexa (`@@index([popularity])`) e que a
seleção **já usa** para ordenar. **Nenhum agendador novo; só números.**

| Faixa | Critério | Volume | Cadência | Req/dia |
| --- | --- | --- | --- | --- |
| **A — cabeça** | 2.000 mais populares | 2.000 | semanal | 286 |
| **B — corpo** | próximos 10.000 | 10.000 | mensal | 333 |
| **C — cauda longa** | os 55.288 restantes | 55.288 | a cada 240 dias | 230 |
| | | | **Total** | **849/dia** ✓ |

Cabe exatamente na cota utilizável (850). Título recém-ingerido não espera a faixa: o
caminho sob demanda tem 150 reservados só para ele.

**Se a chave for de plano pago, tudo encolhe proporcionalmente** — daí o §6.3 ser
pré-requisito desta decisão, e não detalhe.

Para o **TMDB** a proposta é o oposto: não escalonar por custo, e sim **ligar o que já
existe**. A tabela atual já é escalonada por volatilidade (ofertas 1 d, trending 6 h,
detalhe ativo 7 d, detalhe encerrado 30 d) e é defensável. **O que falta é mídia, que não
tem fila nenhuma.**

### 7.5 Onde se encaixa (D.5) — três ajustes, nenhum agendador novo

| Mudança | Onde | Natureza |
| --- | --- | --- |
| Dar escopo à chave de `sync_media`/`sync_seasons`/`sync_episodes` (ex.: `<locale>:<AAAA-MM-DD>`, como o pai já faz) | `sync-details-handler.ts:217`, `sync-seasons-handler.ts:106` | conserto |
| Criar a fila `media` em `RHYTHMS` (7 d, `providerApi: 'tmdb'`) + runner | `scheduler/rhythms.ts`, `runtime/runners.ts` | código novo, no padrão existente |
| Trocar a cadência da OMDb de "7 dias × 200" para "diária × fatia da faixa" | `rhythms.ts:177`, `runners.ts:610` | conserto — **alinha o código à justificativa que já está escrita lá** |

### 7.6 Os 2.122 `dead_letter` (D.6) — não medidos

Não foi possível caracterizar. Consulta 7 do §11.

**Armadilha já catalogada** para quem for rodar: a causa do job morto é **descartada pelo
formatador** da CLI — use `--json` para ver a mensagem real.

---

## 8. As três correções ao enunciado

A regra de honestidade manda o número mandar.

| # | O enunciado dizia | A medida mostrou |
| --- | --- | --- |
| **1** | "4 das 19 entradas de `append-consumption.ts` mentem" | **Verdade até 27/08.** Corrigido em `150c079`, antes desta auditoria começar. Verifiquei as 27 entradas / 47 pares uma a uma, inclusive pelo lado negativo. **Hoje nenhuma mente.** |
| **2** | "A OMDb parou porque o catálogo cresceu e nada re-executou" | **A seleção cobre os títulos novos** (`NOT EXISTS` + `popularity DESC`). O que trava é a **cadência**: 200 a cada 7 dias contra os 850/dia que a cota permitiria. Volta: 6,5 anos. |
| **3** | "Se o filtro exigir pt-BR, liberar licença não resolve sozinho" | **Não há filtro de idioma.** `languageRank` é desempate de ordenação. Os cinco filtros reais não incluem idioma. **Liberar licença resolve.** |

---

## 9. O que tem que ser feito

O pedido de não misturar (E.2) é o ponto mais importante. **Cada linha tem um dono
diferente.**

### 9.1 Decisão de LICENÇA — assinatura do dono, nenhum agente decide

| # | O quê | Efeito |
| --- | --- | --- |
| **L1** | Promover as ~95.701 linhas de `tmdb_videos`<br>`promote:media --target=video --confirm` (+ `--confirm-mass-change` acima de 500) | **Acende o trailer em todo o catálogo.** A licença-mãe existe desde 13/08; falta o ato por linha. |
| **L2** | Aplicar/confirmar a decisão vigente de `cinerie_score_display` em `data_usage_decisions` | Destrava o **portão 1** da nota na ficha |
| **L3** | Decidir o destino de `letterboxd` e `filmaffinity`: aceitar perdê-las, ou abrir escopo para outro fornecedor | Consequência direta de desligar o RapidAPI |

### 9.2 Decisão de CUSTO — do dono; envolve dinheiro ou tempo de espera

| # | O quê | Efeito |
| --- | --- | --- |
| **K1** | Plano da OMDb: continuar gratuito (volta de 79 dias no melhor caso) ou pagar | Define se a faixa C é de 240 ou de 30 dias |
| **K2** | Ritmo do TMDB: 40 req/s (6 h/dia) ou 20 req/s (12 h/dia, mais gentil) | Sem custo em dinheiro — só janela de execução |
| **K3** | Aceitar o escalonamento da OMDb por popularidade (§7.4) | Título impopular fica com nota velha, **declaradamente** |

### 9.3 Conserto de CÓDIGO — não precisa do dono; precisa de PR

| # | O quê | Onde |
| --- | --- | --- |
| **C1** | Chave de idempotência sem escopo torna mídia/temporada/episódio *write-once* | `sync-details-handler.ts:217`, `sync-seasons-handler.ts:106` |
| **C2** | Não há fila de mídia no agendador | `scheduler/rhythms.ts` |
| **C3** | Cadência da OMDb (200/7 d) contradiz a própria justificativa (cota/dia) | `rhythms.ts:177`, `runners.ts:610` |
| **C4** | Nada escreve `movies.screen_score` / `tv_shows.screen_score` | escritor inexistente |
| **C5** | `screen_score_display` zerado por migration e nunca religado | `20260717120000_external_intelligence_product` |
| **C6** | Escalas incompatíveis: cálculo em 100, card exige 5 | `home-hero-presenter.ts:23` vs. fórmula |
| **C7** | Comentários de `entity-trailer.ts` e `trailer-presenter.ts` afirmam algo falso | os dois arquivos |
| **C8** | Comentário de `TMDB_QUOTA` diz "~50 req/s"; a doc diz 40 | `provider-quotas.ts` |

### 9.4 A ordem, por retorno sobre esforço (E.3)

| # | Ação | Esforço | Retorno | Por que nesta posição |
| --- | --- | --- | --- | --- |
| **1** | **L1 — promover os vídeos** | um comando + assinatura | **Enorme** | Muda 95.701 linhas e acende o trailer em ~67 mil fichas. O dado **já está no banco, pago e coletado**. Único item onde o produto muda hoje sem escrever código. B.3 provou que idioma não atrapalha. |
| **2** | **L2 — a decisão do Score** | um comando | **Alto** | 32.762 notas calculadas esperando um `SELECT` retornar linha. Mesmo perfil: o trabalho caro já foi feito. |
| **3** | **C1 — dar escopo à chave** | PR pequeno, cirúrgico | **Alto** | Sem isso **nada** de mídia se atualiza — nem hoje, nem nunca. É a trava única entre "mídia congelada" e "mídia diária", e o TMDB já provou que cabe. Vem depois de 1 e 2 só porque eles são de minutos. |
| **4** | **C3 — cadência da OMDb** | PR pequeno | **Alto** | 30× mais notas por semana mudando dois números. Sem isso, mesmo com cota sobrando, a volta leva 6,5 anos. |
| **5** | **C2 — fila de mídia** | PR médio | Alto | Torna o item 3 recorrente em vez de manual. Depende do 3. |
| **6** | **K1 — descobrir o plano da OMDb** | uma consulta ao painel | Médio | Barato de descobrir e **define** a faixa C. Não bloqueia 1–5. |
| **7** | **C4/C5/C6 — o caminho da listagem** | PR médio, 3 defeitos em série | Médio | Maior conserto, mas a ficha (1–2) já entrega a nota ao leitor. É ampliação de alcance, não desbloqueio. |
| **8** | **C7/C8 — comentários velhos** | trivial | Baixo/composto | Risco zero. Vale junto de qualquer PR que encoste nos arquivos. Documentação que mente já custou tempo a esta auditoria. |

> ### O que eu faria primeiro, e por quê
>
> **O item 1.** É o único da lista em que o produto melhora visivelmente **hoje**, sem PR,
> sem deploy e sem risco de regressão — o dado está pago, coletado, guardado e provadamente
> exibível assim que a coluna virar. Todo o resto exige escrever ou decidir alguma coisa.
> E tem uma propriedade rara: **se der errado, a reversão é o mesmo comando com
> `--revoke`.**

---

## 10. O que ficou de fora, e por quê

| Item | Estado | Motivo |
| --- | --- | --- |
| **0.2** chaves de topo que chegam | não medido | Exige `tmdb_raw`/`api_cache` (4,3 GB); banco inalcançável. SQL pronto. |
| **0.4** custo do descartado | não medido | Idem. |
| **A.3** plano da chave OMDb | **não determinado** | Sem credencial nesta máquina; sondar provedor externo está fora do escopo (regra 6). **Declarado como desconhecido em vez de assumido gratuito.** |
| **A.6** títulos com IMDb ID | não medido | SQL pronto. É o teto real da cobertura. |
| **B.4** distribuição dos acesos | não medido | SQL pronto. |
| **C.2** prova por renderização | **não executada, por método** | Um Postgres semeado provaria *"dada uma decisão vigente e duas fontes, o card renderiza"* — que é o que os testes já afirmam. **O fato decisivo mora nos dados de produção.** Semear localmente responderia uma pergunta que não é a que está aberta. |
| **D.2** totais reais | parcial | Filmes e séries medidos; temporada/episódio/pessoa por **proxy declarado**. SQL pronto. |
| **D.6** os 2.122 `dead_letter` | não medido | SQL pronto. |

**Nenhum item foi pulado por falta de tempo.** Sete dos oito têm a mesma causa: **o banco
de produção não é alcançável desta máquina** (`DATABASE_URL` aponta para
`rss_prime_screen-db:5432`, hostname interno do Docker). A alternativa honesta é entregar o
SQL em vez de estimar. O oitavo (C.2) ficou de fora por método, não por impedimento.

---

## 11. O SQL que falta rodar

**Caminho:** painel → projeto `rss_prime` → serviço `screen-db` → ícone `>_` → aba
**Bash** → `psql -U screena -d screena`.
*(A aba "Postgres Client" não serve: tenta conectar como role `postgres`, que não existe
nesse cluster.)*

Tudo abaixo é **leitura pura**. Nenhum `UPDATE`, `DELETE`, `DROP` ou `--apply`. As
consultas sobre `tmdb_raw`/`api_cache` usam **amostra declarada**, porque são milhões de
linhas e 4,3 GB.

> **`api_providers` pode conter credencial — nenhuma consulta abaixo a toca.**

```bash
psql -U screena -d screena <<'SQL'
\echo '=== 1. C — QUAL PORTAO FECHA A NOTA (a pergunta mais barata do relatorio) ==='
SELECT count(*) AS decisoes_vigentes_do_score
  FROM data_usage_decisions d
  JOIN source_licenses l ON l.id = d.source_license_id
 WHERE d.use_case = 'cinerie_score_display' AND d.is_current AND l.is_current
   AND d.stage = 'approved_for_display' AND d.display_allowed AND d.derivative_allowed
   AND d.valid_from <= now() AND (d.valid_until IS NULL OR d.valid_until > now());
-- 0  => portao 1 (licenca) e a causa. 1 => portao 2; rode a proxima.

SELECT jsonb_array_length(explanation) AS fontes_no_calculo, count(*) AS titulos
  FROM cinerie_score_calculations
 WHERE status = 'calculated' AND jsonb_typeof(explanation) = 'array'
 GROUP BY 1 ORDER BY 1;

\echo '=== 2. A.6 — O TETO REAL DA COBERTURA OMDb ==='
SELECT 'movies' AS tabela, count(*) AS total, count(imdb_id) AS com_imdb_id,
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

\echo '=== 6b. B.3 — IDIOMA DOS TRAILERS ELEGIVEIS (idioma nao filtra; isto e contexto) ==='
SELECT language_code, count(*) AS n
  FROM tmdb_videos
 WHERE video_type IN ('Trailer','Teaser') AND site = 'YouTube'
 GROUP BY 1 ORDER BY n DESC LIMIT 15;

\echo '=== 6c. B — QUANDO OS 2.395 FORAM ACESOS (confirma as ~5 execucoes) ==='
SELECT date_trunc('hour', updated_at) AS hora, count(*) AS linhas
  FROM tmdb_videos WHERE display_allowed = true
 GROUP BY 1 ORDER BY 1;

\echo '=== 7. D.6 — OS DEAD LETTER ==='
SELECT job_type, count(*) AS n, min(created_at) AS primeiro, max(created_at) AS ultimo
  FROM catalog_jobs WHERE status = 'dead_letter'
 GROUP BY 1 ORDER BY n DESC;

\echo '=== 8. C.3 — A COLUNA screen_score FOI ESCRITA ALGUMA VEZ? (espero 0) ==='
SELECT count(*) FILTER (WHERE screen_score IS NOT NULL) AS com_nota,
       count(*) FILTER (WHERE screen_score_display)     AS com_display,
       count(*)                                         AS total
  FROM movies;

\echo '=== 9. ITEM 0.2 — CHAVES DE TOPO QUE CHEGAM (AMOSTRA DECLARADA: 5.000) ==='
WITH amostra AS (SELECT payload, entity_type FROM tmdb_raw LIMIT 5000)
SELECT entity_type, k AS chave, count(*) AS ocorrencias
  FROM amostra, LATERAL jsonb_object_keys(amostra.payload) k
 GROUP BY 1,2 ORDER BY 1, 3 DESC;

\echo '=== 9b. ITEM 0.4 — TAMANHO MEDIO POR BLOCO (AMOSTRA: 2.000) ==='
WITH amostra AS (SELECT payload, entity_type FROM tmdb_raw LIMIT 2000)
SELECT entity_type, k AS bloco, count(*) AS linhas,
       pg_size_pretty(avg(pg_column_size(payload -> k))::bigint) AS tamanho_medio,
       pg_size_pretty(sum(pg_column_size(payload -> k))::bigint) AS total_na_amostra
  FROM amostra, LATERAL jsonb_object_keys(amostra.payload) k
 GROUP BY 1,2 ORDER BY sum(pg_column_size(payload -> k)) DESC LIMIT 40;

\echo '=== 10. ITEM 0.4 — O PESO DAS TABELAS DE BRUTO ==='
SELECT relname AS tabela, pg_size_pretty(pg_total_relation_size(relid)) AS tamanho
  FROM pg_catalog.pg_statio_user_tables
 WHERE relname IN ('api_cache','tmdb_raw','tmdb_videos','tmdb_images',
                   'external_ratings','catalog_jobs')
 ORDER BY pg_total_relation_size(relid) DESC;
SQL
```

> **Nota sobre 9/9b/10:** ajuste `entity_type` ao nome real da coluna de `tmdb_raw` se
> divergir. `LIMIT` sem `ORDER BY` devolve as primeiras linhas **físicas** — é amostra de
> conveniência, não aleatória. Para aleatória, troque por `TABLESAMPLE SYSTEM (1)`.
> **Diga qual foi usada ao reportar o número.**

---

## 12. Artefatos desta leva

### Arquivos criados

| Arquivo | O que é |
| --- | --- |
| `docs/operations/midia-notas-e-atualizacao-diaria.md` | O documento pedido no Item E: estado medido, três causas separadas por natureza, conta de viabilidade, proposta de ritmo, SQL |
| `RELATORIO-PR-248.md` | Este arquivo — registro completo da leva |

### Arquivos alterados

**Nenhum.** Zero linha de código tocada, conforme a regra da leva.

### Memória do agente (fora do repositório)

| Memória | Conteúdo |
| --- | --- |
| `omdb-anda-a-200-por-semana-tmdb-nao-tem-cota` (novo) | A cadência real da fila e a capacidade do TMDB, com as contas |
| `nota-da-listagem-tem-tres-interrupcoes-em-serie` (novo) | Os dois caminhos da nota, as três interrupções, e o não-filtro de idioma |
| `cinerie-score-premise-refuted` (corrigido) | Dizia que `decideCinerieScore` não era chamado por nenhuma página — passou a registrar que a fiação da ficha está completa desde então |

### Verificações executadas

| Verificação | Resultado |
| --- | --- |
| `vitest run tests/governance/tmdb-append-consumption.test.ts` | **13 testes, verdes** |
| Varredura de bytes de controle no documento | limpo |
| Referências de arquivo:linha (`:217`, `:225`, `:227`, `:106`) | conferidas no checkout atual |

---

## 13. Método: como cada número foi obtido

Para que ninguém precise refazer o caminho, e para que a diferença entre **medido**,
**lido** e **recebido pronto** fique explícita — a distinção que este repositório já pagou
caro para aprender.

| Categoria | O que é | Exemplos nesta leva |
| --- | --- | --- |
| **RECEBIDO PRONTO** | Veio do censo do dono, não medi | 98.096 vídeos · 32.762 cálculos · 469 notas · 67.288 títulos · 2.122 dead-letter |
| **LI no código** | Grep/leitura de arquivo, verificável a mão | `SCREEN_SCORE_SCALE = 5` · `CINERIE_SCORE_DISPLAY_SCALE = 100` · `batchLimit` default 200 · intervalo de 7 dias · os 47 pares de append · `discriminator: input.locale` |
| **VERIFIQUEI** | Fiz a asserção e provei que ela vale | As 27 entradas do registro (módulo existe + string aparece + função é chamada) · o lado negativo (4 valores com zero ocorrências) · **zero escritores de `movies.screen_score`** em 4 diretórios · zero `aggregate_rating` no JSON-LD |
| **CONFIRMEI NA DOC** | Fonte externa, citada, não de memória | TMDB: ~40 req/s, sem cota diária, 20 appends max |
| **EXECUTEI** | Rodei e li a saída | O teste de governança (13 verdes) |
| **CALCULEI** | Aritmética sobre os anteriores | 874.379 req = 6,07 h · 79 dias · 6,5 anos · 9,6× a cota · as faixas A/B/C |
| **INFERI** | Plausível, **não provado** — marcado como tal | 2.395 ÷ 500 ≈ 5 execuções do promotor |
| **NÃO DETERMINEI** | Declarado como desconhecido | O plano da chave OMDb em produção |

**A regra que segui:** onde não pude medir, escrevi o SQL em vez de estimar; onde estimei,
disse que era estimativa; onde o número contradisse o enunciado, o número mandou (§8).
