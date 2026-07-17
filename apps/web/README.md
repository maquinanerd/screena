# @screena/web

App publico do **Cinerie**, construido com **Next.js App Router** (TypeScript
strict, React Server Components, ISR/revalidate). Publica o MVP em **pt-BR**;
`en`/`es` nascem em draft/noindex ate revisao humana.

`@screena/web` e namespace tecnico legado. A marca publica e **Cinerie**; a
forma curta **Cinerie** pode aparecer na UI/logo.

## Papel

Servir as paginas publicas e indexaveis da Cinerie (filmes, series,
temporadas, pessoas, onde assistir, curadorias e noticias) descritas em
[`app/README.md`](./app/README.md).

## Regra de pureza do render (INEGOCIAVEL)

- **Zero API externa no render**: paginas indexaveis leem **apenas
  PostgreSQL/cache local** (`api_cache`). Nada de RapidAPI/TMDB/etc. em
  runtime de pagina.
- **Zero Gemini no render**: a IA so gera `content_blocks` **offline**;
  o render apenas consome blocos ja salvos, validados e com `review_status`
  permitido.
- **Gate anti-thin removido (politica 2026-07, invariante 5)**: a
  indexacao e **total** — toda entidade sincronizada, licenciada e em
  idioma publicado indexa por padrao. `noindex` fica so para caso tecnico
  (entidade sem slug/traducao/dados estruturados confiaveis). A quantidade
  de blocos de valor proprios (`renderableBlockCount` / `hasUniqueValue`)
  virou sinal de **qualidade/ranqueamento**, nao pre-requisito de indexacao.
  Ver § "Indexabilidade x qualidade editorial x licenca" abaixo.
- **Licenca**: dados com `license_status` `unknown`/`blocked` ou
  `display_allowed = false` nao aparecem em pagina indexavel.
- **Filme vs serie**: nunca diferenciar so pela cor — sempre
  `label + badge + breadcrumb + schema + URL`. Filme = vermelho
  (`--screena-movie-red`), serie = verde (`--screena-series-green`).
- **API keys** apenas em variaveis de ambiente do servidor, nunca no
  frontend.

## Estrutura

```
app/          # rotas do App Router (ver app/README.md)
components/    # componentes de UI especificos do app
lib/          # helpers de leitura local, formatacao, mapeamento de schema
middleware.ts # deteccao de locale pt|en|es (sem redirect em URL indexavel)
next.config.ts
```

## Como rodar (no futuro)

> Estado atual: este pacote ja tem rotas publicas para filmes, series, pessoas e
> noticias, presenters puros, validações com PostgreSQL efemero e render
> server-side a partir de dados locais. Ainda nao e produto completo/publicavel
> em escala.

Quando implementado, a partir da raiz do monorepo:

```bash
pnpm install
pnpm --filter @screena/web dev        # desenvolvimento
pnpm --filter @screena/web build      # build de producao
pnpm --filter @screena/web start      # servir build
pnpm --filter @screena/web typecheck  # checagem de tipos
```

Deploy previsto: VPS + CloudPanel, Next via Node/PM2/systemd.

## Indexabilidade x qualidade editorial x completude de dados x licenca x publicacao

Cinco conceitos que este pacote mantem **deliberadamente separados**. Nao os
trate como sinonimos nem deixe um decidir o outro por acidente:

| Conceito | O que significa | Onde vive | O que decide |
| --- | --- | --- | --- |
| **Indexabilidade** | Se a pagina pode ir para o indice de busca (`index`/`noindex`/`draft`/`blocked`). | `evaluateIndexability` (`@screena/seo`), reusado por `movie-indexability.ts`, `series-presenter.ts`, `person-presenter.ts`, `entity-index-presenter.ts`. | Idioma em `PUBLISHED_LOCALES`, dados estruturados confiaveis (slug + traducao) e ausencia de rating com licenca bloqueada. **Nao** depende mais da quantidade de blocos editoriais (politica 2026-07). |
| **Qualidade editorial** | Quao rica/util a pagina e para o leitor e para ranqueamento (E-E-A-T). | `hasUniqueValue` / `renderableBlockCount` no resultado de `evaluateIndexability`; `countValueBlocks` (`@screena/seo`). | Quantidade de blocos de valor proprios com `review_status` publicavel. Informativo — nunca gateia `index`/`noindex`. |
| **Completude de dados** | Se a entidade tem os campos minimos para render sem inventar nada (slug canonico, traducao, imagem local/remota segura). | Getters server-only (`movie-page.ts`, `series-page.ts`, `person-page.ts`, `entity-indexes.ts`) e os presenters puros correspondentes. | Presenca real de linhas no PostgreSQL (`slugs`, `entity_translations`, `content_blocks`). Ausencia de dado nunca vira suposicao — vira `null`/omissao. |
| **Licenca** | Se um dado exibido (tipicamente rating externo) tem permissao de exibicao. | `display_allowed` / `license_status` em `source_licenses` / `external_ratings`, aplicado por `evaluateIndexability`. | Qualquer rating exibido com `display_allowed=false` ou `license_status` `unknown`/`blocked` forca a pagina inteira para `blocked` (invariante 6), independentemente de indexabilidade/qualidade. |
| **Publicacao** | Se um `content_block` especifico pode ser **renderizado** publicamente. | `review_status` do `content_block` (`RENDERABLE_REVIEW_STATUSES` em `movie-indexability.ts`: `human_reviewed`, `published`). | So blocos revisados por humano aparecem em `view.blocks`. Blocos `draft`/`ai_generated`/`needs_review`/`needs_update`/`blocked`/`archived` nunca vazam para a view, mas **nao** impedem a pagina de indexar. |

Resumo pratico: uma entidade sincronizada com slug e traducao **sempre** indexa
(salvo idioma fora de `PUBLISHED_LOCALES` ou rating com licenca bloqueada),
mesmo com **zero** `content_blocks` publicados. Blocos publicados melhoram a
pagina (qualidade/ranqueamento); eles nunca sao a condicao para ela existir no
indice.

## Validadores descartaveis (dev, PostgreSQL efemero)

Alem da validacao individual por rota (abaixo), existe um **comando
agregador** que roda os cinco validadores em sequencia e resume o resultado:

```bash
pnpm --filter @screena/web validate:all
# ou, a partir da raiz do monorepo:
corepack pnpm validate:all
```

Cada validador (`validate:news-pages`, `validate:entity-indexes`,
`validate:movie-page`, `validate:series-page`, `validate:person-page`) sobe e
derruba o **seu proprio** PostgreSQL 16 efemero (`embedded-postgres`), em
porta livre e diretorio temporario dedicado — nao ha banco compartilhado nem
estado cruzado entre eles. Todos sao ferramentas de desenvolvimento
**descartaveis**: nunca rodam no render, no build de app, nem em producao;
ZERO rede, ZERO Gemini, ZERO TMDB.

### Pagina de filme

```bash
pnpm --filter @screena/web validate:movie-page
```

Ferramenta de desenvolvimento **descartavel**
([`scripts/validate-movie-page-real-postgres.ts`](./scripts/validate-movie-page-real-postgres.ts))
— nunca roda no render/produto. Sobe um PostgreSQL 16 **efemero** via
`embedded-postgres` (mesmo padrao de `@screena/db` e `@screena/entity-writer`),
aplica a migration e o seed existentes (sem criar migration nem alterar schema),
cria dados minimos de filme (movie + slug canonico + traducao + content_blocks) e
chama **diretamente** `getMoviePageData(slug)` para exercitar o fluxo real:

`slug pt-BR -> movie -> entity_translation -> content_blocks -> presenter ->
indexabilidade (index/noindex, politica 2026-07 de indexacao total)`.

Valida, entre outros: filme inexistente (`null`); 0/1 blocos publicos ->
ainda `index` (indexacao total; blocos viram sinal de qualidade, nao gate);
2 blocos publicos -> tambem `index` (e `hasUniqueValue=true`); blocos
`ai_generated`/`needs_review`/`draft`/`archived` nunca aparecem; canonical usa
o slug canonico pt-BR; e o presenter (titulo da traducao, ano/duracao
derivados, `metaDescription` nunca inventada).

- **NAO sobe servidor Next**, **NAO chama Gemini**, **NAO chama TMDB** nem
  qualquer API externa: so le o PostgreSQL efemero local.
- **Nao depende do banco local do usuario**; o banco efemero e derrubado e o
  diretorio temporario removido ao final. `DATABASE_URL` so existe em memoria.

## Fixture dev para abrir a pagina no navegador

```bash
pnpm --filter @screena/web seed:dev-movie
```

Insere/atualiza um filme de EXEMPLO no **banco LOCAL de desenvolvimento** (o do
`docker-compose.dev.yml`) para abrir a rota `/pt/filmes/interestelar/` no
navegador: movie `Interstellar` + slug canonico pt-BR `interestelar` + traducao
pt-BR `Interestelar` + 2 content_blocks renderizaveis (`editorial_intro` +
`cast_intro`, `published`/`human_reviewed`, `human`) — blocos de qualidade
para a pagina indexar como "rica" (`hasUniqueValue=true`); a indexacao em si
(`index`) ja ocorreria mesmo sem eles, sob a politica de indexacao total.

- **Dev-only e idempotente**: rodar de novo atualiza/mantem; nunca duplica
  movie, slug, translation nem content_block ativo (ancoras: `tmdb_id`
  sentinela, slug, e find-ativo-ou-cria por `block_type`).
- **Exige `DATABASE_URL`** (carrega `.env` da raiz se existir); aborta se
  ausente e **nunca imprime a senha**.
- **NAO chama Gemini**, **NAO chama TMDB**, sem ratings/streaming/API externa.
- Fluxo completo (Docker -> migrate -> seed -> fixture -> `dev`) no README raiz,
  secao "Banco Local De Desenvolvimento".
