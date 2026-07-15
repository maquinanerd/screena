# ADR 0004 — Rotas publicas de temporada e episodio (Fase 4)

- Status: aceito (implementacao em PR draft para revisao).
- Data: 2026-07-15.
- Contexto: apos [[0003-seo-runtime-source-of-truth]] (Fase 3, SEO como fonte
  unica), as temporadas e episodios existiam apenas inline na pagina da serie
  (via `?temporada=`). A Fase 4 cria rotas publicas dedicadas, lendo o dado ja
  persistido, integradas aos contratos de SEO da Fase 3.

## Decisao

### Rotas
- `/pt/series/[slug]/temporadas/[season]/` — pagina de temporada.
- `/pt/series/[slug]/temporadas/[season]/episodios/[episode]/` — pagina de episodio.

Temporada e episodio **NAO tem slug proprio**: a URL usa o **slug canonico da
serie** + o **numero real** da temporada (e do episodio). `[season]`/`[episode]`
sao numeros na FORMA CANONICA (inteiro positivo, sem zero a esquerda). A politica
para forma nao-canonica (`01`, `003`) e **404** (`parseRouteNumber` retorna null
-> `notFound()`), pois o projeto nao normaliza numeros de rota. Slug de serie
nao-canonico gera `301` para a URL canonica (mesma politica das paginas de
filme/serie).

### Camadas
- Getters server-only `getSeasonPageData` / `getEpisodePageData`
  (`apps/web/src/server/`): leem SOMENTE PostgreSQL local (Prisma), com `select`
  enxuto; validam a cadeia serie -> temporada -> episodio (filtros por
  `tvShowId`/`seasonId` garantem coerencia); `notFound()` (retorno null) para
  qualquer elo invalido; resolvem `prev/next`.
- Presenter puro `season-episode-presenter` (`buildSeasonPageView` /
  `buildEpisodePageView`), reusando helpers do `series-presenter`.
- Componente reutilizavel `PrevNextNav` (navegacao anterior/proximo).
- A pagina da serie passou a **linkar** as temporadas para as rotas dedicadas
  (`seasonPath`), preservando a pre-visualizacao inline (`?temporada=`).

### SEO (contratos da Fase 3)
- Cada rota resolve a decisao vigente persistida via `resolveEntityPageSeo` com
  os **tipos reais** `season`/`episode` (`is_current = true`), fail-closed em
  falha de banco. `robots`, `canonical` e inclusao no sitemap vem dessa resolucao
  — nunca da decisao da serie.
- `generateMetadata` em ambas as rotas: title/description/robots/canonical +
  Open Graph minimo.
- JSON-LD via `serializeJsonLd` (HTML-safe): temporada = `TVSeason` +
  `BreadcrumbList` (+ `partOfSeries`); episodio = `TVEpisode` + `BreadcrumbList`
  (+ `partOfSeason` + `partOfSeries`). Sem `AggregateRating`, sem ratings de
  terceiros.

### Sitemap paginado (extensao da Fase 3)
- Novos tipos `seasons` e `episodes` no sitemap paginado NO PostgreSQL: `COUNT`
  no index, `LIMIT/OFFSET` por shard, `ORDER BY` deterministico (chave primaria),
  TODAS as exclusoes no `WHERE` (idioma publicado, serie com slug canonico + nome,
  decisao vigente `!= index` da temporada/episodio). URL composta via
  `seasonPath`/`episodePath`. Parser estrito aceita
  `sitemap-pt-BR-seasons-N` / `sitemap-pt-BR-episodes-N`. Sem `getAllSitemapUrls`,
  sem carga integral do catalogo.

### Shell visual
- Preservado. As paginas sao **textuais** como as de filme/serie (o shell branco
  atual nao renderiza `<img>`); os presenters computam poster/still (prontos para
  o design futuro), exatamente como o `movie-presenter` computa `media` sem a
  pagina renderizar imagem. Nenhum redesenho; nenhuma segunda biblioteca visual.

## Validacao
- `apps/web/scripts/validate-season-episode-routes-real-postgres.ts` (script
  `validate:season-episode-routes`, **32 checks** em PostgreSQL 16 efemero):
  temporada/episodio validos e invalidos, escopo por serie, ordenacao,
  anterior/proximo, midia ausente, decisao persistida index/noindex, canonical,
  sitemap paginado (multiplos shards com LIMIT=2, exclusao antes da paginacao,
  404, prova instrumentada de `LIMIT`) e JSON-LD seguro. Adicionado a CI Linux.

## Consequencias e follow-ups
- Sem alteracao de schema/migrations. Sem API externa no render (audit:render).
- Imagens (poster/still) resolvidas na view mas nao renderizadas — integracao
  visual e escopo do design final, nao da Fase 4/5.
- Fase 5 (registro de cobertura das APIs) **nao** foi iniciada.
