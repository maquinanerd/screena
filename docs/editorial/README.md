# Plataforma editorial da Cinerie

> Documento canonico da cadeia editorial: fontes, itens recebidos, proveniencia,
> deduplicacao, ciclo de vida do artigo, publicacao, projecao publica e
> observabilidade. Em pt-BR; codigo e identificadores em ingles.
>
> Em caso de conflito, `CLAUDE.md` (as 13 invariantes) prevalece.

---

## 1. O que esta plataforma NAO e

Registrar isto primeiro evita retrabalho e escopo inflado:

- **Nao e um agregador de RSS.** A Cinerie **nao reconstroi RSSPRIME nem
  MN26**. O transporte (feed, API, webhook, scraping) e responsabilidade de
  quem entrega o item. Esta plataforma comeca no **contrato de entrada**.
- **Nao e um CMS.** Nao ha editor visual, biblioteca de midia propria nem
  workflow de aprovacao com multiplos papeis. O admin existente
  (`apps/admin`) continua sendo a superficie operacional.
- **Nao e um segundo search engine, nem uma segunda tabela de
  indexabilidade, nem um segundo sistema de redirects.** Artigo entra nas
  tabelas que ja existem.
- **Nao ha scheduler proprio.** Ver secao 6.

---

## 2. Os quatro conceitos (nao confundir)

```
EDITORIAL SOURCE  ->  SOURCE ITEM  ->  [decisao editorial humana]  ->  ARTICLE
   (a fonte)          (o recebido)                                   (o publicado)
```

| Conceito | Tabela | O que e | O que NAO e |
| --- | --- | --- | --- |
| **Source** | `editorial_sources` | Uma fonte que rastreamos | Uma autorizacao para reproduzir |
| **Source item** | `source_items` | Um item recebido: identidade, URL, fingerprints, trecho | Um artigo; nunca vira pagina publica |
| **Provenance** | `article_source_links` | Quais fontes sustentam um artigo | Autoria |
| **Article** | `articles` + `article_translations` | O artigo **proprio** da Cinerie | Uma copia do material recebido |

Duas separacoes que o codigo trata como lei:

```
conteudo recebido  !=  artigo publico da Cinerie
fonte externa      !=  autor Cinerie
```

---

## 3. Fonte editorial (`editorial_sources`)

**Registrar uma fonte nao autoriza reproduzir o conteudo dela.** O direito
mora em `use_rights`, que e **decisao humana registrada**, e continua
subordinado a `source_licenses` (invariante 6).

Defaults deliberadamente restritivos:

| Campo | Default | Por que |
| --- | --- | --- |
| `status` | `paused` | Fonte recem-cadastrada **nao ingere** ate decisao humana |
| `use_rights` | `unknown` | So autoriza rastrear a existencia do item |
| `requires_attribution` | `true` | Credito e o default; dispensa-lo e a excecao |
| `requires_linkback` | `true` | Idem |

`use_rights`: `unknown` | `headline_and_link_only` | `excerpt_with_attribution`
| `full_syndication`.

O `domain` e travado por CHECK no formato canonico (minusculo, sem esquema,
sem `www.`, sem caminho) porque e chave de deduplicacao por host.

### Desativar uma fonte (tres operacoes DIFERENTES)

| Operacao | Como | Efeito |
| --- | --- | --- |
| Parar de ingerir | `status = 'paused'` / `'retired'` | Nenhum item novo entra |
| Parar de exibir | `use_rights` / `source_licenses` | Deixa de aparecer publicamente |
| Apagar evidencia | **impossivel** | FK `RESTRICT` bloqueia |

Uma fonte que sustenta artigo **nao pode ser apagada**. Provado no validador
(check 14).

---

## 4. Item recebido (`source_items`) e retencao

### Retencao minima de conteudo de terceiro

**O corpo integral de um artigo de terceiro NAO e persistido.** Guardamos
identidade, URL, metadados e fingerprints, mais um `excerpt` **curto**.

O teto de 1000 caracteres do trecho e um **CHECK no banco**, nao uma convencao
de codigo: nenhum ingestor futuro consegue transformar esta tabela num espelho
de conteudo alheio, mesmo por engano. Provado no validador (check 8).

Proibido: burlar paywall, contornar autenticacao, copiar conteudo integral
para pagina publica.

### Identidade

`(source_id, external_id)` e a **chave de idempotencia primaria**: reingerir o
mesmo item **atualiza**, nunca duplica. Manchete **nao** e identidade.

`normalized_url` (ver `src/identity.ts`) e o segundo eixo: minusculo, sem
`www.`, sem fragmento, **sem parametros de rastreamento** e com os parametros
restantes **ordenados**. Sem isso, o mesmo artigo chegando por RSS
(`?utm_source=rss`) e por rede social (`?utm_source=twitter`) vira dois itens.

---

## 5. Deduplicacao — fail-closed

**Regra-mestra: sem evidencia de identidade estavel, NAO se funde.** Preservar
dois itens e barato e reversivel; fundir dois fatos distintos corrompe a
proveniencia de um artigo publicado.

**Nao existe sinal semantico** — sem embeddings, sem similaridade de texto,
sem "mesma manchete". Manchete e um sinal notoriamente ruim: *"Trailer de X e
divulgado"* descreve eventos diferentes em anos diferentes.

| Sinal | Veredito | Funde? |
| --- | --- | --- |
| mesma `(source_id, external_id)` | reingestao (upsert) | e o mesmo item |
| mesma `normalized_url` | `duplicate` | sim |
| mesmo `content_fingerprint` **na mesma fonte** | `duplicate` | sim |
| mesma entidade + janela de 48h | `related` | **nao** |
| nada acima | `unique` | nao |

Duas regras que evitam o erro caro:

- **`null` nunca casa com `null`.** Dois itens sem URL normalizada nao sao "o
  mesmo recurso" — sao dois itens sobre os quais nao sabemos nada.
- **Fingerprint igual em fontes DIFERENTES nao funde.** Isso e sindicacao: um
  fato com **duas proveniencias legitimas**, nao uma duplicata a descartar.

O banco reforca: CHECK `source_items_dedup_verdict_shape` exige que
`duplicate`/`superseded` apontem o primario e que `related`/`unique`
**nunca** apontem. Provado no validador (checks 5-10).

### Clustering de "mesmo fato"

**Nao implementado.** `related` agrupa para revisao humana e nada mais. Nao ha
merge automatico de historias.

---

## 6. Ciclo de vida do artigo

Usa o `review_status` (`ReviewStatus`) que `article_translations` **ja** tem —
nao ha maquina de estados paralela.

```
draft -> needs_review -> human_reviewed -> published
                                              |
                            +-----------------+-----------------+
                            v                 v                 v
                       needs_update     blocked (despublicado)  archived (retratado)
                                              |                 |
                                              +-----> needs_review <-----+
```

**Retratada nunca volta direto a `published`.** `blocked`/`archived` so
transitam para `needs_review`: republicar sem nova revisao humana exatamente o
conteudo que foi retirado seria o pior desfecho possivel.

### Publicacao — gate

`evaluatePublishGate` exige, alem do gate publico (licenca, atribuicao,
linkback, slug, titulo, data):

- **corpo proprio real** (>= 200 chars);
- **idioma** declarado;
- **proveniencia: >= 1 fonte ligada**. Um artigo sem nenhuma fonte nao
  consegue responder *"o que sustenta isto?"* — e essa pergunta e a diferenca
  entre reportagem e afirmacao sem lastro. Provado no validador (check 11).

### Agendamento (`scheduled`)

**Nao existe estado `scheduled` nem scheduler proprio.** Uma materia agendada
e uma materia `published` com `published_at` no **futuro**.

O embargo e aplicado na **LEITURA publica**, nao na escrita editorial:

- publicar com data futura e **legitimo** e nao e bloqueado;
- toda superficie publica compara `published_at <= agora` antes de mostrar.

A regra vive num unico lugar — `evaluateArticlePublication` em
`@screena/seo` (`packages/seo/src/article-publication.ts`) — consumido por
listagem, pagina de artigo, noticias relacionadas, sitemap, busca e
indexabilidade. **A duplicacao dessa regra era exatamente o que permitia as
superficies divergirem.** O instante e sempre **injetado** (`nowIso`), nunca
lido de `Date.now()` dentro do modulo puro.

Nao ha job que "publique quando a hora chegar": a materia simplesmente passa a
aparecer. A projecao (busca/indexabilidade) precisa ser reprocessada — e a
sentinela alerta com `scheduled_overdue` quando isso nao acontece.

### Atualizacao vs correcao

| | Preserva slug | Preserva `published_at` | Registra evidencia |
| --- | --- | --- | --- |
| Atualizacao normal | sim | sim | so `updated_at` |
| **Correcao material** | sim | sim | `corrected_at` + `correction_note` |

Correcao material **exige nota explicita** — nunca e inferida do diff. Os dois
campos andam juntos (CHECK `article_translations_correction_pair`).

**Nao existe "correcao automatica de fatos" por IA.**

---

## 7. Slug e redirect

Artigos **nao** usam a tabela `slugs` (que e de entidades de catalogo, com FK
composta para `entities`). O slug vive em `article_translations.slug`, unico
por idioma.

- **Artigo publicado nao troca de slug quando o titulo muda.** Trocar a URL de
  uma materia no ar quebra links externos e zera o historico da pagina.
- Troca **deliberada** (`requestedSlug`) grava **301** na tabela `redirects`
  que ja existe — o runtime
  (`apps/web/src/server/seo/redirect-lookup.ts`) resolve a cadeia sozinho.
- **Redirect A -> A nunca e gravado** (seria um loop na cadeia). Rascunho nao
  gera redirect: nunca teve URL publica.

---

## 8. Artigo <-> entidade

`entity_news_links` (ja existente) liga artigo a `movie` | `tv` | `person`
pelo **ID canonico**, nunca pelo slug: mudar o slug de uma entidade nao pode
quebrar a relacao editorial.

- **entidade -> noticias**: `apps/web/src/server/related-news.ts`
- **artigo -> entidades**: resolvido em `news-pages.ts`

Ambos leem **apenas PostgreSQL local** e aplicam o mesmo gate de publicacao —
relacionadas nunca podem ser um vazamento lateral de rascunho ou agendada.

Nao ha inferencia de relacao em runtime (nada de casar por titulo).

---

## 9. Projecao publica: busca e indexabilidade

Artigo entra nas **mesmas tabelas** das entidades, via o discriminador
`PublicDocKind` (`entity` | `article`) + `article_id`.

`EntityType` deliberadamente **nao** ganhou o valor `article` — artigos nao
vivem em `entities`/`slugs`.

### Busca (`search_documents`)

- Indexa **manchete, deck, autor e categoria**. **O corpo NAO e indexado**, e o
  payload da fonte muito menos: a busca nao e espelho de conteudo de terceiro.
- Usa a **mesma dobra** (`foldText`) da busca de catalogo; a paridade e travada
  por teste.
- Aparece em `/pt/busca` numa **secao propria** ("Noticias"), nunca misturada a
  lista de entidades — tipo nunca pode depender so de formatacao
  (invariante 11).
- **Remocao e parte do contrato**: quando o artigo deixa de ser publicavel, o
  documento e **removido**. Sem isso, materia retratada continuaria
  pesquisavel.

### Indexabilidade (`page_indexability_decisions`)

Mesma precedencia da politica de SEO, do mais restritivo ao menos:

1. licenca/atribuicao bloqueada -> `blocked` (invariante 6)
2. idioma fora de `PUBLISHED_LOCALES` -> `draft` (invariante 7)
3. caso tecnico (rascunho, agendada, retratada, sem slug/titulo, corpo
   insuficiente, `index_status` rebaixado) -> `noindex`
4. caso contrario -> `index` (invariante 5, indexacao total)

`index_status` **so rebaixa, nunca forca** `index`.

Historico append-only com supersede em transacao e **sem churn**: decisao
identica a vigente nao grava nada.

> A guarda `page_indexability_supersedes_same_group()` foi reescrita para ser
> **kind-aware e NULL-safe** (`IS NOT DISTINCT FROM`). A versao anterior
> comparava `entity_type = NEW.entity_type`; para artigos os dois lados sao
> NULL, `NULL = NULL` nao e TRUE, e **toda** cadeia de historico de artigo era
> recusada pelo banco.

### Sitemap

Ja integrado. So entra artigo publicavel **e** indexavel. O SQL usa
`COALESCE(published_at, ...) <= NOW()` — antes usava `IS NOT NULL`, o que
listava materia agendada.

### Indexacao global

`CINERIE_PUBLIC_INDEXING_ENABLED` **continua desligada**. Esta plataforma
apenas **prepara** as decisoes.

---

## 10. Autoria e IA

Nao inventar autores. Distinguir: autor humano, "Redacao Cinerie"
(organizacao), automacao e fonte original.

Se houver IA no upstream, preservar a separacao entre **fato extraido**,
**texto gerado** e **artigo aprovado**. Proibido inventar aspas, declaracoes,
datas, numeros, nomes, atribuicoes ou licencas. Conteudo produzido por modelo
**nao** e presumido factual (invariante 12).

`articles.ai_assisted` habilita o disclaimer de IA no render.

---

## 11. Observabilidade

Metricas em `src/metrics.ts` (`EDITORIAL_METRIC_NAMES`), mesma convencao do
catalogo: nomes canonicos numa constante unica, labels de baixa cardinalidade
(**nunca** id de artigo ou de item).

Sentinela (`evaluateEditorialSentinel`) detecta **incoerencia entre camadas** —
o tipo de falha que nao aparece em teste unitario porque cada camada, isolada,
esta correta:

| Alerta | Severidade | Significa |
| --- | --- | --- |
| `ingest_stalled` | warning | fonte ativa, zero itens em 24h |
| `items_without_articles` | info | entram itens, nada e publicado |
| `search_projection_broken` | **critical** | ha artigo publicado e zero documento de busca |
| `search_projection_stale` | warning | artigos sem documento correspondente |
| `indexability_stale` | warning | artigos sem decisao vigente |
| `article_without_provenance` | **critical** | artigo publicado sem fonte ligada |
| `scheduled_overdue` | warning | embargo expirou e a projecao nao rodou |
| `ingest_failures` | warning | itens `failed` aguardando reprocessamento |

Sem ruido: **nao ha alerta por materia publicada**.

---

## 12. O que NAO foi implementado (declarado)

Nao prometemos capacidade inexistente:

- **Scheduler / cron de publicacao** — nao existe. Ver secao 6.
- **Clustering semantico de mesmo fato** — nao existe. So `related`
  deterministico.
- **Fila/dead-letter editorial dedicada** — a ingestao editorial ainda nao usa
  `catalog_jobs`; nao ha `CatalogJobType` editorial.
- **Backfill em massa** — nao ha script de backfill; `reprojectArticle` opera
  por artigo.
- **Taxonomia editorial** — `articles.category` continua texto livre. Nao ha
  tabela de categorias/topicos.
- **Workflow de autoria com papeis** — `author_name` e texto; nao ha tabela
  `Author` nem RBAC editorial proprio.
- **CMS / superficie de escrita nova** — o admin segue como esta.
- **Leitor de RSS / integracao RSSPRIME / MN26** — fora de escopo por decisao.

---

## 13. Referencias

- Nucleo puro: `services/news-ingestion/src/`
- Adapters Prisma: `services/news-ingestion/src/persistence/editorial-store.ts`
- Gate publico canonico: `packages/seo/src/article-publication.ts`
- Migration: `packages/db/prisma/migrations/20260727120000_editorial_news_platform/`
- Validador PG16: `pnpm validate:editorial-platform`
- Runbook: [`runbook.md`](./runbook.md)
