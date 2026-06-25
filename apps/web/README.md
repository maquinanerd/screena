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
