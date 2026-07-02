# Screen — Especificação do produto (SPEC)

> **Movies, series, ratings and where to watch.**
> Base global de entretenimento _entity-first_, em **https://thescreen.media**, com camada editorial própria.

Este documento é a **especificação canônica do produto** Screen. Ele descreve a
visão, as entidades centrais, o modelo de dados de alto nível, a arquitetura, as
regras de pureza de render, a camada editorial, a identidade visual, a estratégia
de i18n e SEO, as metas de performance, o admin, as fronteiras do MVP e as 13
invariantes inegociáveis.

> **Estado atual — fundação avançada / vertical slice técnica.** Esta SPEC descreve
> o produto-alvo, mas o repositório já avançou além da Fase 0 pura: há
> Prisma/PostgreSQL, migrations/seeds, client TMDB real em TypeScript, ingestão
> TMDB, Entity Writer offline em TypeScript, rotas públicas e testes de
> governança. Ratings, streaming, RSSPRIME/MN26, admin editorial completo e
> usuários/community ainda não estão funcionais.

> **Identidade.** Screen é a marca pública principal. **The Screen** pode aparecer
> apenas como referência histórica, explicativa ou nome expandido não-principal.
> **Screena** permanece como namespace técnico/legado interno
> (`@screena/*`, tokens `--screena-*`); **screena.media** e **The Nerd News** são
> legados históricos e não devem voltar como identidade pública.

---

## 1. Visão e posicionamento

Screen é uma **base global de entretenimento _entity-first_**: filmes, séries,
temporadas, episódios, pessoas, franquias, ratings externos, onde assistir,
reviews, trailers e notícias — tudo organizado em torno da **entidade** (a obra),
e não de uma página solta.

**Entity-first** significa que cada obra é uma **entidade canônica** com identidade
estável: `slug` próprio, IDs externos mapeados (`tmdb_id`, `imdb_id`…), tipo bem
definido (filme / série / temporada / episódio / pessoa) e marcação schema.org
correspondente. Tudo o que importa para quem decide o que assistir — ficha,
ratings atribuídos, onde assistir por país, contexto editorial, notícias — é
agregado **ao redor dessa entidade**.

**Posicionamento:**

> **As APIs fornecem os dados. Screen escreve a camada editorial.**

Fornecedores externos (TMDB, provedores de rating via RapidAPI, fontes de
disponibilidade de streaming) são **fontes de dados técnicos**. Eles **não são, e
nunca aparecem como**, a voz editorial do Screen. O valor do produto está na
curadoria, na contextualização e na escrita própria — construída sobre dados
licenciados e atribuídos corretamente. O resultado **não é um agregador cru de
API**: cada página indexável precisa carregar valor editorial próprio.

- **Domínio canônico público:** `https://thescreen.media`.
- **MVP publica em pt-BR.** `en`/`es` nascem em rascunho (`draft`/`noindex`) até
  revisão humana.

---

## 2. Entidades centrais

Screen trata cada obra como uma entidade canônica. As entidades e objetos
centrais do produto são:

| Entidade          | Papel                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------- |
| **Filmes**        | Obra cinematográfica. Schema `Movie`. Acento visual vermelho.                                 |
| **Séries**        | Obra serializada. Schema `TVSeries`. Acento visual verde.                                      |
| **Temporadas**    | Subdivisão de uma série. Schema `TVSeason`. Pertencem a uma série.                            |
| **Episódios**     | Subdivisão de uma temporada. Schema `TVEpisode`. Pertencem a uma temporada.                   |
| **Pessoas**       | Atores, diretores, equipe técnica. Schema `Person`.                                           |
| **Franquias**     | Coleções que agrupam obras relacionadas (universo, saga, ordem cronológica).                  |
| **Ratings**       | Notas externas **atribuídas** (IMDb, Rotten Tomatoes, Metacritic, Letterboxd, FilmAffinity…). |
| **Reviews**       | Reviews **próprias** do Screen (schema `Review`).                                          |
| **Trailers**      | Trailers e vídeos (apenas links/embeds **legais**).                                            |
| **Onde assistir** | Disponibilidade por país e modalidade, com licença e oferta reais.                            |
| **Notícias**      | Artigos editoriais (schema `NewsArticle`), vinculados a entidades quando aplicável.           |

Cada rating externo carrega **sempre** fonte editorial (`rating_source`), escala
canônica, valor, atribuição e estado de licença — nunca números soltos. Trailers
e embeds são **sempre legais**: nada de torrent, IPTV, player ilegal, link de
download ou embed pirata.

---

## 3. Modelo de dados (alto nível)

Visão de **alto nível** das tabelas canônicas, agrupadas por domínio. A fonte
executável atual é o schema Prisma real em `packages/db/prisma/schema.prisma`,
com migrations e seeds em `packages/db/prisma/`. O ORM em uso é **Prisma**;
banco **PostgreSQL**.

### Entidades

`movies`, `tv_shows`, `seasons`, `episodes`, `people`, `franchises`.

### Elenco e equipe

`cast_members` (pessoa ↔ obra, papel/personagem), `crew_members` (pessoa ↔ obra,
função técnica).

### Mídia

`images` (posters, backdrops, fotos), `trailers` (vídeos com links/embeds legais).

### Ratings e licenças

`external_ratings` (notas externas atribuídas; colunas-chave: `rating_source`,
`rating_label`, `metric`, `rating_value`, `rating_scale`, `rating_count`,
`rating_url`, `provider_api`, `provider_payload_hash`, `fetched_at`,
`attribution_text`, `attribution_url`, `license_status`, `display_allowed`),
`rating_sources` (catálogo de fontes editoriais com sua escala canônica),
`source_licenses` (estado de licença por fonte: `license_status` em
`official | licensed | third_party | unknown | blocked`; flags `display_allowed`,
`logo_allowed`, `score_allowed`, `review_quote_allowed`, `requires_attribution`,
`requires_linkback`), `api_providers` (fornecedores técnicos, distintos das
fontes editoriais).

### Onde assistir

`platforms` (plataformas de streaming), `providers` (fornecedores/distribuidores
de oferta), `watch_availability` (disponibilidade por entidade, país e modalidade).

### Notícias

`articles`, `article_translations`, `entity_news_links` (vínculo notícia ↔
entidade), `news_clusters` (agrupamento de notícias relacionadas).

### Editorial / content_blocks

`content_blocks` (blocos editoriais versionados), `reviews` (reviews próprias),
`entity_translations` (traduções de campos de entidade).

### Entity Writer

`entity_writer_jobs` (fila de jobs), `entity_writer_logs` (log de execução).

### Infra / cache / logs

`api_sync_logs` (log de todo sync externo), `api_cache` (cache local de respostas
externas), `entity_external_ids` (mapeamento de IDs externos).

### i18n / slugs

`countries`, `languages`, `slugs` (slugs canônicos por entidade/idioma),
`redirects` (redirecionamentos quando um slug muda).

### Indexabilidade

`page_indexability_decisions` (decisão por página: `index | noindex | draft |
stale | blocked`).

> Detalhes completos de agrupamento, colunas-chave e política de índices vivem em
> [`database/schema.md`](../database/schema.md).

---

## 4. Arquitetura

Screen separa **três pipelines distintos**: (a) ingestão/sincronização de
dados externos, (b) geração editorial offline e (c) render público. O render
**nunca** chama APIs externas nem o Gemini.

### Fluxo principal — dados, editorial e render

```
   ┌─────────────────────────────────────────────────────────────┐
   │ Fontes externas                                              │
   │   TMDB        Ratings (RapidAPI)        Streaming (oferta)   │
   └───────┬───────────────┬─────────────────────┬───────────────┘
           │               │                     │
           ▼               ▼                     ▼
        ┌──────────────────────────────────────────────┐
        │            Ingestion Workers (sync)           │
        │   normaliza · atribui fonte · loga · cacheia  │
        └───────────────────────┬──────────────────────┘
                                │  (todo sync gera log)
                                ▼
                       ┌──────────────────┐
                       │   PostgreSQL     │  ← fonte única do render
                       │  (+ cache local) │
                       └────────┬─────────┘
                                │  payload controlado
                                ▼
                    ┌────────────────────────┐
                    │  Entity Writer (Gemini) │  OFFLINE
                    │  gera content_blocks    │
                    │  valida · versiona      │
                    └────────┬───────────────┘
                             │  blocos salvos + revisados
                             ▼
                       ┌──────────────────┐
                       │   PostgreSQL     │  (content_blocks publicados)
                       └────────┬─────────┘
                                │  leitura local apenas
                                ▼
                    ┌────────────────────────┐
                    │   Next.js (App Router)  │  RENDER
                    │  RSC · ISR/revalidate   │
                    │  zero API · zero Gemini │
                    └────────┬───────────────┘
                             ▼
                    ┌────────────────────────┐
                    │   Google / AdSense      │
                    │  (indexação · receita)  │
                    └────────────────────────┘
```

### Fluxo de notícias

```
   RSSPRIME ──▶ news_clusters ──▶ entity_news_links ──▶ (entidades)
       │
       └──────▶ MN26 ──▶ articles ──▶ (Next.js render)
```

- **RSSPRIME** alimenta a ingestão de notícias, que são agrupadas em
  `news_clusters` (notícias relacionadas) e vinculadas a entidades via
  `entity_news_links`.
- **MN26** produz `articles` (notícias editoriais), renderizadas pelo Next.js
  como `NewsArticle`.

### Deploy

- **VPS + CloudPanel.**
- **Next.js** servido via Node com **PM2/systemd**.
- **Workers** (ingestão e Entity Writer) via **systemd timers**.
- Runtime: **Node 22 LTS**, **Python 3.12** (workers).

---

## 5. Regra de pureza de render

> **Zero API externa no render. Zero Gemini no render.**

Toda página pública indexável lê **apenas PostgreSQL/cache local**. Durante a
renderização **não** ocorre nenhuma chamada a TMDB, a provedores de rating, a
fontes de streaming nem ao Gemini. A IA gera blocos de conteúdo **offline**, que
são salvos, validados e revisados **antes** de qualquer publicação.

Consequências práticas:

- Sincronização externa e geração de conteúdo são **pipelines separados** do
  render, executados por workers em `systemd timers`.
- O render usa **RSC + ISR/`revalidate`**: a página é estática/incremental e lê
  dados já materializados no PostgreSQL.
- Chaves de API vivem **somente em variáveis de ambiente**, nunca no frontend.
- Dado sem licença clara (`license_status` `unknown`/`blocked` ou
  `display_allowed=false`) **não aparece** em página indexável.

---

## 6. Camada editorial

A diferença entre Screen e um agregador cru está na **camada editorial
própria**, escrita sobre dados licenciados e atribuídos.

### Entity Writer

O **Entity Writer** é o agente editorial offline (Gemini). Seus limites são
inegociáveis:

- Escreve **apenas** com base em **payload controlado** do PostgreSQL.
- **Não inventa fatos**, **não cria entidades**, **não chama APIs externas** e
  **não publica sozinho**.
- Não copia sinopse externa; produz texto próprio e contextual.
- Cada execução é enfileirada em `entity_writer_jobs` (status: `queued`,
  `claimed`, `running`, `completed`, `failed`, `blocked`, `cancelled`) e
  registrada em `entity_writer_logs`.

### content_blocks

Os blocos editoriais são **versionados e revisáveis**. São o coração do gate
anti-thin.

- **Tipos:** `editorial_intro`, `summary_without_spoilers`, `ratings_explanation`,
  `where_to_watch_text`, `cast_intro`, `similar_titles_intro`, `franchise_context`,
  `season_guide`, `episode_context`, `faq`, `news_context`, `review_summary`.
- **Status (`review_status`):** `draft`, `ai_generated`, `needs_review`,
  `human_reviewed`, `published`, `needs_update`, `blocked`, `archived`.
- **Colunas:** `id`, `entity_type`, `entity_id`, `language_code`, `block_type`,
  `content`, `source_type`, `model_provider`, `model_name`, `prompt_version`,
  `input_hash`, `output_hash`, `review_status`, `warnings_json`, `published_at`,
  `created_at`, `updated_at`.

Um bloco gerado por IA **só conta como valor** se: veio de payload controlado;
passou na validação anti-alucinação; está salvo em `content_blocks`; tem
`prompt_version` e `input_hash`; não copia sinopse externa; e tem `review_status`
permitido.

### Gate anti-thin (blocos de valor)

Uma página só é indexável se tiver **pelo menos 2 blocos de valor próprios** além
do dado cru de API. Blocos de valor aceitos:

1. introdução editorial própria; 2. onde assistir por país; 3. ratings externos
atribuídos; 4. comparação crítica vs. audiência; 5. review própria; 6. notícias
relacionadas; 7. FAQ útil; 8. trailer incorporado; 9. elenco comentado;
10. contexto de franquia; 11. ordem cronológica; 12. guia de temporadas;
13. obras parecidas; 14. histórico de atualização; 15. análise sem/com spoiler
separada.

Páginas que não atingem o gate recebem **`noindex`** (registrado em
`page_indexability_decisions`).

---

## 7. Identidade visual e sistema de cores

Screen usa cor como **acento**, nunca como única forma de diferenciação.

| Token                    | Valor     | Uso                                          |
| ------------------------ | --------- | -------------------------------------------- |
| `--screena-black`        | `#000000` | Preto base.                                  |
| `--screena-white`        | `#F5F5F5` | Branco da marca.                             |
| `--screena-movie-red`    | `#FF3B30` | Acento de **filme**.                         |
| `--screena-series-green` | `#7AA66D` | Acento de **série**.                         |
| `--screena-bg-dark`      | `#050505` | Fundo escuro.                                |
| `--screena-bg-light`     | `#F4F4F4` | Fundo claro.                                 |

**Regra de cor:**

- **Filme = vermelho** (`--screena-movie-red`).
- **Série = verde** (`--screena-series-green`).
- **Home / busca / misto / institucional = neutro.**

> **A diferenciação filme/série NUNCA depende só da cor.** Sempre **label + badge
> + breadcrumb + schema + URL**, em conjunto. A cor é reforço visual, não o sinal
> primário (acessibilidade e clareza acima de estética).

---

## 8. Internacionalização (i18n)

- **pt-BR publica primeiro.** É o idioma de lançamento do MVP, indexável.
- **`en`/`es` nascem em `draft`/`noindex`** e só passam a indexar após **revisão
  humana**.
- Traduções de campos de entidade vivem em `entity_translations`; traduções de
  notícias em `article_translations`.
- Slugs são canônicos por entidade/idioma (`slugs`); mudanças de slug geram
  `redirects`.

### Rotas do MVP (pt)

```
/pt/filmes/
/pt/filmes/{slug}/
/pt/filmes/{slug}/onde-assistir/
/pt/filmes/{slug}/elenco/
/pt/filmes/{slug}/avaliacoes/
/pt/series/
/pt/series/{slug}/
/pt/series/{slug}/temporada-{number}/
/pt/series/{slug}/onde-assistir/
/pt/pessoas/{slug}/
/pt/streaming/netflix/melhores-filmes/
/pt/onde-assistir/{slug}/
/pt/noticias/{slug}/
```

### Rotas futuras (en)

```
/en/movies/{slug}/
/en/tv/{slug}/
/en/people/{slug}/
/en/news/{slug}/
```

---

## 9. Schema.org

Marcação estruturada (JSON-LD) por tipo de página:

| Tipo de página | Schema.org                                             |
| -------------- | ------------------------------------------------------ |
| Filme          | `Movie`                                                |
| Série          | `TVSeries`                                             |
| Temporada      | `TVSeason`                                             |
| Episódio       | `TVEpisode`                                            |
| Pessoa         | `Person`                                               |
| Notícia        | `NewsArticle`                                          |
| Review própria | `Review`                                               |
| Todas as principais | `BreadcrumbList`                                  |
| FAQ            | `FAQPage` — **somente** quando há FAQ visível na página |
| Avaliação agregada | `AggregateRating` — **somente** quando permitido e atribuído |

Regras: nunca usar `AggregateRating` fingindo nota própria; nota IMDb nunca vira
Tomatometer; Tomatometer/Popcornmeter pertencem só ao Rotten Tomatoes.

---

## 10. Performance

Metas de Core Web Vitals (campo, p75):

- **LCP < 2,5 s** (Largest Contentful Paint).
- **CLS < 0,1** (Cumulative Layout Shift).
- **INP bom** (Interaction to Next Paint) — faixa "good" do Core Web Vitals.

Habilitadores arquiteturais: render estático/incremental (RSC + ISR/`revalidate`),
zero chamada externa no render (latência previsível), imagens dimensionadas (sem
layout shift) e leitura local do PostgreSQL/cache.

---

## 11. Admin

O painel editorial (`@screena/admin`) é uma aplicação Next.js separada do site
público (`@screena/web`). Responsabilidades:

- **Revisão editorial** de `content_blocks` (fluxo `needs_review` →
  `human_reviewed` → `published`).
- **Gestão de indexabilidade**: inspeção e decisão em
  `page_indexability_decisions` (`index | noindex | draft | stale | blocked`).
- **Fila do Entity Writer**: acompanhamento de `entity_writer_jobs` e
  `entity_writer_logs`.
- **Licenças e atribuição**: conferência de `source_licenses` e `external_ratings`
  (fonte, escala, flags de exibição).
- **Sync e logs**: visibilidade de `api_sync_logs`.

O admin **não** contorna as invariantes: não publica conteúdo sem revisão, não
exibe dado sem licença e não mistura fontes de rating.

---

## 12. Fronteiras do MVP

O que **NÃO** entra no MVP (e por quê):

- **Kubernetes** — orquestração excessiva para o porte; deploy é VPS + CloudPanel
  com PM2/systemd e systemd timers.
- **Microsserviços** — domínio coeso; workers e apps bastam, sem malha de
  serviços.
- **Elasticsearch** — busca atendida pelo PostgreSQL; sem motor de busca
  dedicado no MVP.
- **WordPress no core** — o core não depende de WordPress; a camada editorial é
  própria.
- **Múltiplos bancos** — uma fonte de verdade: **PostgreSQL** (+ cache local).
- **API externa no render** — proibido por invariante; render lê só local.
- **Gemini no render** — proibido por invariante; IA só offline.

---

## 13. As 13 invariantes inegociáveis

1. **IMDb ≠ Rotten Tomatoes** — nunca misturar fontes, escalas, ícones ou
   linguagem.
2. **`provider_api` ≠ `rating_source`** — o fornecedor técnico (ex.: RapidAPI)
   nunca é a fonte editorial.
3. **Zero API externa no render** — páginas públicas indexáveis leem apenas
   PostgreSQL/cache local.
4. **Zero Gemini no render** — a IA só gera `content_blocks` offline, salvos e
   validados.
5. **Página fina recebe `noindex`** — sem pelo menos 2 blocos de valor próprios
   além de dado cru de API, não indexa.
6. **Dados sem licença clara não aparecem** — `license_status` `unknown`/`blocked`
   ou `display_allowed=false` ⇒ fora de página indexável.
7. **pt-BR publica primeiro** — `en`/`es` nascem em `draft`/`noindex` até revisão
   humana.
8. **Sem pirataria** — nada de torrent, IPTV, player ilegal, link de download ou
   embed pirata.
9. **Filmes usam acento vermelho** (`--screena-movie-red`, nome legado do token).
10. **Séries usam acento verde** (`--screena-series-green`, nome legado do token).
11. **A diferenciação filme/série NUNCA depende só da cor** — sempre label +
    badge + breadcrumb + schema + URL.
12. **Entity Writer só escreve com base em payload controlado** do PostgreSQL —
    não inventa fatos, não cria entidades, não chama APIs externas, não publica
    sozinho.
13. **`content_blocks` são versionados e revisáveis** — `prompt_version`,
    `input_hash`, `output_hash`, `model_provider`, `model_name` e `review_status`
    obrigatórios.

**Complementares:** API keys só em variáveis de ambiente (nunca no frontend);
todo sync externo gera log; nota IMDb nunca vira Tomatometer; Tomatometer/
Popcornmeter pertencem só ao Rotten Tomatoes; nada de `AggregateRating` fingindo
nota própria; WordPress não entra no core.
