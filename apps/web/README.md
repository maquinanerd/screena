# @screena/web

App publico da Screena, construido com **Next.js App Router** (TypeScript
strict, React Server Components, ISR/revalidate). Publica o MVP em **pt-BR**;
`en`/`es` nascem em draft/noindex ate revisao humana.

## Papel

Servir as paginas publicas e indexaveis da Screena (filmes, series,
temporadas, pessoas, onde assistir, curadorias e noticias) descritas em
[`app/README.md`](./app/README.md).

## Regra de pureza do render (INEGOCIAVEL)

- **Zero API externa no render**: paginas indexaveis leem **apenas
  PostgreSQL/cache local** (`api_cache`). Nada de RapidAPI/TMDB/etc. em
  runtime de pagina.
- **Zero Gemini no render**: a IA so gera `content_blocks` **offline**;
  o render apenas consome blocos ja salvos, validados e com `review_status`
  permitido.
- **Gate anti-thin**: pagina sem **>= 2 blocos de valor proprios** recebe
  `noindex`.
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

> Fase 0: este pacote e um **stub**. As dependencias estao **declaradas**,
> mas nao instaladas, e nao ha app final.

Quando implementado, a partir da raiz do monorepo:

```bash
pnpm install
pnpm --filter @screena/web dev        # desenvolvimento
pnpm --filter @screena/web build      # build de producao
pnpm --filter @screena/web start      # servir build
pnpm --filter @screena/web typecheck  # checagem de tipos
```

Deploy previsto: VPS + CloudPanel, Next via Node/PM2/systemd.

## Validacao real da pagina de filme (dev, descartavel)

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
gate anti-thin (index/noindex)`.

Valida, entre outros: filme inexistente (`null`); 0/1 blocos publicos ->
`noindex`; 2 blocos publicos -> `index`; blocos `ai_generated`/`needs_review`/
`draft`/`archived` nunca aparecem; canonical usa o slug canonico pt-BR; e o
presenter (titulo da traducao, ano/duracao derivados, `metaDescription` nunca
inventada).

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
`cast_intro`, `published`/`human_reviewed`, `human`) — o suficiente para passar o
gate anti-thin (`index`) localmente.

- **Dev-only e idempotente**: rodar de novo atualiza/mantem; nunca duplica
  movie, slug, translation nem content_block ativo (ancoras: `tmdb_id`
  sentinela, slug, e find-ativo-ou-cria por `block_type`).
- **Exige `DATABASE_URL`** (carrega `.env` da raiz se existir); aborta se
  ausente e **nunca imprime a senha**.
- **NAO chama Gemini**, **NAO chama TMDB**, sem ratings/streaming/API externa.
- Fluxo completo (Docker -> migrate -> seed -> fixture -> `dev`) no README raiz,
  secao "Banco Local De Desenvolvimento".
