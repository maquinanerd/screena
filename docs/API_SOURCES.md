# Governanca de Fontes Externas — Screen

Este documento define a **governanca de fontes externas** do Screen: para cada API/fonte,
descreve **uso**, **periodicidade de sincronizacao**, **atribuicao** e **tratamento de
licenca**. E o contrato de referencia para os workers de ingestao, ratings, streaming e
noticias.

> Regra inegociavel que atravessa o documento inteiro: **toda fonte externa e consumida
> apenas por pipeline offline — NUNCA no render. TMDB e Entity Writer rodam hoje em
> TypeScript/Node + Prisma; workers Python permanecem como roadmap/shim futuro para
> ratings, streaming, RSS/news e orquestracao.
> Paginas publicas indexaveis leem exclusivamente PostgreSQL/cache local
> (`api_cache`). Nenhuma rota publica abre conexao com API externa.

---

## Invariantes que governam este documento

Estas invariantes valem para **todas** as fontes abaixo e prevalecem sobre qualquer
conveniencia de implementacao:

- **Invariante 1 — IMDb != Rotten Tomatoes.** Nunca misturar fontes, escalas, icones ou
  linguagem. Nota IMDb (escala 10) jamais vira Tomatometer; Tomatometer/Popcornmeter
  (escala 100) pertencem so ao Rotten Tomatoes.
- **Invariante 2 — provider_api != rating_source.** O fornecedor tecnico (ex.: RapidAPI,
  agregador) **nunca** e a fonte editorial. Quem entrega o byte nao e quem assina a nota.
- **Invariante 3 — Zero API externa no render.** Paginas indexaveis leem apenas
  PostgreSQL/cache local. Consumo externo e 100% offline, por worker.
- **Invariante 6 — Sem licenca clara, nao aparece.** Dados com
  `source_licenses.license_status` em `unknown`/`blocked`, ou com `display_allowed=false`,
  **nao** vao para nenhuma pagina indexavel.

Regra estrutural reforcada caso a caso:
**`provider_api != rating_source`** — sempre que uma resposta tecnica trouxer uma nota,
o worker deve **reatribuir a nota a sua fonte editorial real** (`rating_source`) e gravar
**separadamente** o fornecedor tecnico em `provider_api` + `provider_payload_hash`. Os dois
campos nunca colapsam num so.

Complementos sempre aplicaveis:

- API keys/segredos **so em env vars** — nunca no frontend, nunca no bundle.
- **Todo sync externo gera log** em `api_sync_logs` (fonte, endpoint, status, custo de cota,
  hashes).
- Requisitos tecnicos minimos de todo cliente: **cache** (`api_cache`), **retry**,
  **rate-limit**, **backoff**, **circuit-breaker**.
- **Sem pirataria** — nada de torrent, IPTV, player ilegal, link de download ou embed
  pirata; somente metadados e ofertas/links legais.

---

## Glossario rapido de governanca

| Termo | Significado |
| --- | --- |
| `provider_api` | Fornecedor **tecnico** que entrega o dado (ex.: RapidAPI, agregador). Nunca e fonte editorial. |
| `rating_source` | Fonte **editorial** real da nota (imdb, rotten_tomatoes, metacritic, letterboxd, filmaffinity). |
| `provider_payload_hash` | Hash do payload bruto retornado pelo `provider_api`, para auditoria/rastreio. |
| `source_licenses` | Tabela que governa exibicao: `license_status`, `display_allowed`, `logo_allowed`, `score_allowed`, `review_quote_allowed`, `requires_attribution`, `requires_linkback`. |
| `api_sync_logs` | Log obrigatorio de toda chamada/sincronizacao externa. |
| `api_cache` | Cache local que o render le; nunca a API ao vivo. |

---

## 1. TMDB (The Movie Database) — fonte estrutural principal

**Papel.** Fornecedor tecnico **primario** de metadados estruturais de entidade. Consumido
por `services/ingestion`. Abastece: filmes, series, temporadas, episodios, pessoas, elenco
(cast/crew), imagens, trailers, generos, IDs externos e watch providers (referencia de
disponibilidade). E a espinha dorsal do grafo de entidades e do mapeamento
`tmdb_id` <-> IDs canonicos (`entity_external_ids`), fornecendo `imdb_id` de referencia
quando disponivel.

**Consumo.** **Pipeline offline em TypeScript/Node + Prisma** (`api-clients/tmdb`,
`services/ingestion`, `services/sync`). **Nunca no render.** Os workers Python de
TMDB que ainda aparecerem em `workers/` sao legado/scaffold e nao devem ser
reimplementados do zero nesta fase.

**Periodicidade de sincronizacao.**

| Conjunto | Frequencia | Observacao |
| --- | --- | --- |
| Populares (`popular`) | **Diario** | Catalogo de alta demanda atualizado todo dia. |
| Catalogo geral (detalhes de entidade) | **A cada 7–14 dias** | Refresh de metadados estaveis; janela escalonada por entidade. |
| Trending | **A cada 6–12 h** | Sinal volatil; janela curta. |
| Imagens / trailers | **A cada 7 dias** | Material de catalogo; baixa volatilidade. |

**Atribuicao.** TMDB exige atribuicao conforme seus termos de uso. Respeitar
`source_licenses` do TMDB (`requires_attribution`, `logo_allowed`) ao exibir qualquer dado
ou logo proveniente da fonte.

**Tratamento de licenca.** TMDB e **`provider_api`** (fornecedor tecnico), **nao** uma
`rating_source` editorial — reforca a **Invariante 2**. Os watch providers do TMDB sao
**referencia tecnica**, nao substituem o cliente de disponibilidade dedicado
(ver secao 6). Dados com `license_status` em `unknown`/`blocked` ou `display_allowed=false`
nao vao para pagina indexavel (**Invariante 6**).

---

## 2. Film & Show Ratings — fornecedor TECNICO de notas (provider_api)

**Papel.** Agregador **tecnico** (ex.: via RapidAPI) que entrega notas de **multiplas fontes
editoriais** em uma unica chamada. Consumido por `services/ratings`. **NAO** e, ele proprio,
uma fonte editorial.

**Regra critica de atribuicao (Invariante 2).** Este servico e **`provider_api`**, nunca
`rating_source`:

- Se a resposta tecnica retorna uma **nota IMDb**, a fonte editorial gravada e
  `rating_source = imdb` (escala 10).
- Se retorna **Rotten Tomatoes**, a fonte editorial e `rating_source = rotten_tomatoes`
  (escala 100).
- O nome do agregador **nunca** aparece como fonte da nota para o usuario. Ele e gravado
  apenas em `provider_api` + `provider_payload_hash` de `external_ratings`.

Cada nota retornada deve ser **reatribuida a sua fonte editorial real**, com a **escala
correta**: imdb=10, rotten_tomatoes=100, metacritic=100, letterboxd=5, filmaffinity=10.

**Consumo.** **Worker-only** (Python 3.12, systemd timers). **Nunca no render.**

**Periodicidade.** Acompanha o ciclo de `services/ratings` (refresh periódico das notas
das entidades ativas; janela alinhada ao catalogo, tipicamente diario para populares e
7–14 dias para o restante).

**Atribuicao.** A nota so e exibida se a `source_licenses` **da fonte editorial real**
permitir (`display_allowed`, `score_allowed`), com `attribution_text`/`attribution_url`
quando exigido. A atribuicao e **sempre da fonte editorial**, nunca do agregador.

**Tratamento de licenca.** Reforca **Invariantes 1, 2 e 6**: nunca misturar fontes/escalas;
nota IMDb (10) nunca vira Tomatometer; nada de `AggregateRating` fingindo nota propria;
sem licenca clara, nao exibe.

---

## 3. RottenTomato API — Tomatometer e audiencia (fonte editorial)

**Papel.** **Fonte editorial** (`rating_source = rotten_tomatoes`) e **unica dona** do
**Tomatometer** (critica) e do **Popcornmeter/audiencia**, ambos em **escala 100**.
Consumido por `services/ratings`; base do bloco de valor "comparacao critica vs audiencia".
Grava em `external_ratings` com `rating_label`/`metric` corretos (critica vs audiencia).

**Consumo.** **Worker-only** (Python 3.12, systemd timers). **Nunca no render.**

**Periodicidade.** Alinhada ao ciclo de `services/ratings` (populares com janela curta;
catalogo geral em janela de 7–14 dias).

**Atribuicao.** Exibir Tomatometer/audiencia **somente se
`source_licenses.score_allowed = true`** para o Rotten Tomatoes. Respeitar tambem
`display_allowed`, `logo_allowed`, `requires_attribution`, `requires_linkback`.

**Tratamento de licenca (Invariantes 1, 2, 6).** Tomatometer/Popcornmeter pertencem **so**
ao Rotten Tomatoes; nunca aplicar a outra fonte. **IMDb != Rotten Tomatoes** — fontes,
escalas, icones e linguagem sempre separados. `provider_api` (quem entregou o byte) e
sempre distinto de `rating_source`. Nada de `AggregateRating` fingindo nota propria.

---

## 4. IMDb API — nota em escala 10 (fonte editorial)

**Papel.** **Fonte editorial** (`rating_source = imdb`) cuja nota usa **escala 10**.
Consumido por `services/ratings`. Fornece nota e contagem de votos do IMDb, gravadas em
`external_ratings` com `rating_source = imdb`, `rating_scale = 10`. Pode fornecer `imdb_id`
de referencia para `entity_external_ids`.

**Consumo.** **Worker-only** (Python 3.12, systemd timers). **Nunca no render.**

**Periodicidade.** Alinhada ao ciclo de `services/ratings` (populares diario; catalogo geral
7–14 dias).

**Atribuicao.** Exibicao condicionada a `source_licenses` do IMDb (`display_allowed`,
`score_allowed`, `requires_attribution`, `requires_linkback`), com
`attribution_text`/`attribution_url` quando exigido.

**Tratamento de licenca (Invariantes 1, 2, 6).** IMDb usa **escala 10** e a nota IMDb
**NUNCA** vira Tomatometer nem usa icone/linguagem do Rotten Tomatoes. **IMDb != Rotten
Tomatoes** — fontes, escalas, icones e linguagem totalmente separados. O fornecedor tecnico
que entrega o dado (`provider_api`) e distinto da fonte editorial IMDb (`rating_source`).
Sem licenca clara, nao exibe.

---

## 5. Streaming Availability — onde assistir por pais (primario)

**Papel.** Cliente **primario** de disponibilidade. Consumido por `services/streaming` para
popular `watch_availability`, `platforms` e `providers`. Fornece, por **pais**, em quais
plataformas legais e modalidades (assinatura, aluguel, compra, gratis com anuncios) uma
entidade esta disponivel, com **deep links** oficiais. Base do bloco de valor "onde assistir
por pais".

**Consumo.** **Worker-only** (Python 3.12, systemd timers). **Nunca no render.**

**Periodicidade.** Refresh periodico da disponibilidade das entidades ativas; cada registro
exibido carrega carimbo **"Atualizado em"** (data do ultimo sync confiavel) para o usuario.

**Atribuicao.** Fornecedor tecnico (`provider_api`), nunca fonte editorial. Exibir apenas
plataformas legais e links oficiais; respeitar `source_licenses` quando aplicavel. Sempre
mostrar **"Atualizado em"** na superficie publica.

**Tratamento de licenca (Invariantes 3, 6 + sem pirataria).** Cliente **primario** de
disponibilidade, preferencial sobre KASO. **Sem pirataria** — nada de torrent, IPTV, player
ilegal, link de download ou embed pirata; somente ofertas legais. `provider_api !=
rating_source`. Sem licenca clara, nao exibe.

---

## 6. KASO — disponibilidade (apenas fallback)

**Papel.** Cliente **secundario** de disponibilidade. E **apenas fallback**: usado somente
quando `Streaming Availability` **nao resolve** uma entidade/pais. Consumido por
`services/streaming` para complementar `watch_availability` em casos nao cobertos pelo
cliente primario.

**Consumo.** **Worker-only** (Python 3.12, systemd timers). **Nunca no render.**

**Periodicidade.** Acionado sob demanda, apenas como complemento — nao roda como sync
primario de catalogo.

**Atribuicao.** Fornecedor tecnico (`provider_api`), nunca fonte editorial. Apenas
plataformas legais e links oficiais; respeitar `source_licenses`. Mesma exigencia de
"Atualizado em".

**Tratamento de licenca / uso no MVP.** **NAO usar no MVP** se `Streaming Availability` ja
resolver a entidade/pais — KASO so entra como rede de seguranca. **Sem pirataria** (nada de
torrent, IPTV, player ilegal, link de download ou embed pirata). `provider_api !=
rating_source`. Sem licenca clara, nao exibe. **Zero API externa no render.**

---

## Mapa de papeis (provider_api vs rating_source)

Reforco direto da **Invariante 2** — qual fonte e tecnica e qual e editorial:

| Fonte | Papel | provider_api? | rating_source? | Escala | Observacao |
| --- | --- | :---: | :---: | --- | --- |
| TMDB | Metadados estruturais | Sim | Nao | — | Espinha dorsal de entidades/IDs. |
| Film & Show Ratings | Agregador tecnico de notas | Sim | **Nao** | varia por fonte | Reatribuir cada nota a fonte real. |
| RottenTomato API | Tomatometer/audiencia | (entrega) | **Sim** (`rotten_tomatoes`) | 100 | So exibe se `score_allowed=true`. |
| IMDb API | Nota IMDb | (entrega) | **Sim** (`imdb`) | 10 | Nunca vira Tomatometer. |
| Streaming Availability | Onde assistir | Sim | Nao | — | Primario; "Atualizado em". |
| KASO | Onde assistir (fallback) | Sim | Nao | — | So se o primario falhar. |

---

## APIs a descartar / adiar

Nao integrar (ou adiar ate revisao explicita) qualquer fonte que se enquadre em um destes
criterios:

- **Sem documentacao clara** — contrato instavel, campos ambiguos, sem termos de uso/licenca
  legiveis (cai direto na **Invariante 6**: sem licenca clara, nao exibe).
- **Latencia alta para uso sincrono** — fontes lentas demais para o ciclo de worker
  confiavel; nunca justificam consumo no render (**Invariante 3** permanece inviolavel:
  nada disso vira chamada no render, mesmo que tentador).
- **Scraping instavel** — coleta que quebra a cada mudanca de HTML, sem API oficial; risco
  legal e operacional.
- **Qualquer fonte que retorne pirataria** — torrent, IPTV, player pirata, link de download
  ou embed ilegal: **descarte imediato e definitivo**, sem excecao (regra "sem pirataria").

Toda fonte recusada/adiada deve ser registrada com o motivo, para evitar retrabalho de
avaliacao.

---

## Tabela de prioridade (1..7)

Ordem de prioridade de integracao/consumo na Fase 0 / MVP:

| # | Fonte | Tipo | Servico consumidor | Status no MVP |
| --- | --- | --- | --- | --- |
| 1 | **TMDB** | provider_api (estrutural) | `services/ingestion` | Primaria — base de tudo. |
| 2 | **Streaming Availability** | provider_api (disponibilidade) | `services/streaming` | Primaria de "onde assistir". |
| 3 | **IMDb API** | rating_source (`imdb`, escala 10) | `services/ratings` | Ativa. |
| 4 | **RottenTomato API** | rating_source (`rotten_tomatoes`, escala 100) | `services/ratings` | Ativa (so exibe se `score_allowed=true`). |
| 5 | **Film & Show Ratings** | provider_api (agregador de notas) | `services/ratings` | Ativa — sempre reatribuindo a fonte real. |
| 6 | **KASO** | provider_api (disponibilidade, fallback) | `services/streaming` | Standby — so se o item 2 falhar. |
| 7 | **(Reservado) fontes em avaliacao** | a definir | — | Adiadas; ver "APIs a descartar/adiar". |

---

## Checklist operacional por fonte (resumo)

Antes de promover qualquer dado externo para pagina indexavel, o worker deve garantir:

1. Consumo **offline** por worker — **nunca no render** (Invariante 3).
2. **API key so em env var**; nada de segredo no frontend.
3. **Log** da chamada em `api_sync_logs`; **cache** em `api_cache`.
4. `provider_api` e `rating_source` gravados **separados** (Invariante 2); nota reatribuida a
   fonte editorial real, na **escala correta**.
5. **IMDb != Rotten Tomatoes** — escala/icone/linguagem coerentes com a fonte (Invariante 1).
6. `source_licenses` checada: so exibe se `license_status` valido e `display_allowed=true`
   (Invariante 6); atribuicao/linkback quando exigido.
7. Disponibilidade com **"Atualizado em"**; **zero** conteudo pirata.
