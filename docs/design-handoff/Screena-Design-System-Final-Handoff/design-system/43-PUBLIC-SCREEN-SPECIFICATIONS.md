# 43 — Public Screen Specifications (D4A)

Especificação individual das 18 telas para o Claude Code implementar **sem decidir** seções, ordem, componentes, containers, dados, omissões, assets, anúncios, interações, logo ou estados. Fonte de verdade: `page-specifications.json`. Status: `SPECIFIED_NOT_MIGRATED`. **Contratos de dado referenciam `data-visual-contracts.json` (não duplicados aqui).**

## Regras transversais (todas as telas)
- Card **nunca** `<div/span/h1/article onClick>`: link principal explícito ou stretched-link acessível (DD-19).
- **Label sem valor não aparece** (campo ausente omitido; nunca "N/D").
- Cinerie Score com 6 estados honestos; **sem nota/streaming fictício**.
- Overlay escuro só em mídia/hero (DD-20); footer claro; SectionHeader sem barra.
- Logo por contexto: vermelho=filme, verde=série, neutro=resto.
- WCAG 2.2 AA; foco visível; touch ≥44; toda interação aponta a um componente canônico.

---

## 01 · Switcher (overlay)
**Rota:** — (não roteável) · **Contexto:** dev · **Template:** DevOverlayTemplate · **Logo:** n/a · **Prioridade:** P3

**Árvore de componentes:**
```
Overlay
└── RouteList (button/link)
```

**Seções (ordem exata):**

| # | ID | Título | Componente | Container | Itens | Ver tudo | Omitir quando | Vazio |
|---|---|---|---|---|---|---|---|---|
| 1 | switch-list | Rotas do protótipo | button | overlay | 20 | — | nunca | n/a |

**Tokens:** zIndex: z-90 (protótipo, NÃO token de produto) · note: remover no build

**Interações:** button→button (navegar entre flags de tela (dev))

**Contratos de dado:** routeFlags(dev) → ver `data-visual-contracts.json`

**Ad slots (0):** —

**Image slots (0):** —

**Estados:** open

**Exceções:** EX-01-dev: overlay de dev; z-90 fora do sistema; remover no build

**UI honesta:** ratings/score/streaming/imagem ausentes → estado honesto (ver estados). Sem dado inventado.

---

## 02 · Home
**Rota:** /pt · **Contexto:** neutro · **Template:** HomeTemplate · **Logo:** neutro (branca no hero / preta no scroll) · **Prioridade:** P0

**Árvore de componentes:**
```
Page
├── Header (transparent→solid)
├── HomeHero (slides)
├── Main
│   ├── Section 'Today's Featured Picks' (feature + poster grid)
│   ├── AdSlot(leaderboard)
│   ├── Section 'Popular This Week' (highlight-rail-card)
│   ├── Section 'Filmes em alta' (band condicional + monthStats)
│   ├── AdSlot(leaderboard)
│   ├── Section 'Séries da semana' (band condicional)
│   ├── Section 'Get a Glimpse / Em breve' (trailer-card rail)
│   ├── AdSlot(leaderboard)
│   └── Section 'Notícias & Entrevistas' (news-overlay mosaic)
│       └── AdSlot(leaderboard)
└── Footer (claro)
```

**Seções (ordem exata):**

| # | ID | Título | Componente | Container | Itens | Ver tudo | Omitir quando | Vazio |
|---|---|---|---|---|---|---|---|---|
| 1 | hero | (sem título — slides) | home-hero | container-full-bleed | 1 | — | nunca (sempre ≥1) | fallback neutro claro se sem backdrop |
| 2 | featured | Today's Featured Picks | editorial-feature-card + content-grid | container-editorial | 7 | sim | seção omitida se vazia | omite |
| 3 | popular | Popular This Week | highlight-rail-card | container-editorial | 8 | sim | omitida se vazia | skeleton no loading |
| 4 | filmes-alta | Filmes em alta | movie-card + monthStats | container-editorial | 6 | sim | band só quando showMoviesBand | omite |
| 5 | series-semana | Séries da semana | series-card | container-editorial | 6 | sim | band só quando showSeriesBand | omite |
| 6 | em-breve | Get a Glimpse (Em breve) | trailer-card | container-full-bleed (faixa escura de mídia) | 6 | sim | omitida se vazia | omite |
| 7 | noticias | Notícias & Entrevistas | news-overlay-card | container-editorial | 5 | sim | omitida se vazia | omite |

**Tokens:** container: container-editorial 1280 + full-bleed nas faixas de mídia · sectionRhythm: 56px · typography: section-header 26px (2 pesagens), display-xl no hero · media: backdrop 16/9, poster 2/3, trailer-still 16/10 · accent: movie #D42A2E (CTA), scrim em mídia

**Interações:** carousel→home-hero (slides autoplay 6s pausável, reduced-motion) · link→highlight-rail-card/movie-card/series-card (título é link principal) · button→entity-actions (Ver detalhes / Ver trailer / bookmark(icon-button)) · button→content-rail (prev/next icon-button)

**Contratos de dado:** Hero, MovieCard, SeriesCard, RecommendationCard, NewsCard, AdSlot → ver `data-visual-contracts.json`

**Ad slots (4):** featured:leaderboard, filmes-alta:leaderboard, em-breve:leaderboard, noticias:leaderboard

**Image slots (8):** hero-slide-1..N (16/9), featured-lead (16/9), featured-poster-1..4 (2/3), news-mosaic-1..5 (16/9|1/1), 8 slots de imagem no template (loops rendem N em execução)

**Estados:** default · loading(skeleton rails) · empty(seção omitida) · hero-no-image(neutro claro)

**Exceções:** EX-02-band: 04 reusa este template com bands condicionais + acento por contexto

**UI honesta:** ratings/score/streaming/imagem ausentes → estado honesto (ver estados). Sem dado inventado.

---

## 03 · Notícias
**Rota:** /pt/noticias · **Contexto:** noticia · **Template:** NewsIndexTemplate · **Logo:** neutro · **Prioridade:** P1

**Árvore de componentes:**
```
Page
├── Header
├── Main
│   ├── SectionHeader 'Notícias & Entrevistas'
│   ├── Chips (categorias)
│   ├── NewsOverlay mosaic (1 grande + 4 pequenos)
│   ├── AdSlot ×N
│   ├── Grid de NewsCard/ArticleCard
│   ├── (band de categoria embutida — newsIsCat)
│   └── Pagination
└── Footer
```

**Seções (ordem exata):**

| # | ID | Título | Componente | Container | Itens | Ver tudo | Omitir quando | Vazio |
|---|---|---|---|---|---|---|---|---|
| 1 | news-head | Notícias & Entrevistas | section-header | container-editorial | 1 | — | nunca | n/a |
| 2 | news-cats | Categorias | chip | container-editorial | 6 | — | nunca | n/a |
| 3 | news-mosaic | Destaques | news-overlay-card | container-editorial | 5 | — | omite se vazio | empty-state |
| 4 | news-grid | Todas as notícias | news-card + article-card | container-editorial | 12 | sim | zero-results→empty-state | zero-results |
| 5 | news-cat-band | Filmes/Séries (categoria embutida) | content-rail | container-editorial | 6 | sim | só quando newsIsCat | omite |
| 6 | news-pag | Paginação | pagination | container-editorial | 1 | — | 1 página→omite | n/a |

**Tokens:** container: container-editorial 1280 · grid: grid-news · typography: section-header 26px · newsCategory: cores de editoria (exception, semânticas)

**Interações:** chip→chip (filtrar categoria (não só cor: texto+estado)) · link→news-card (headline é link) · pagination→pagination (link de página (altera URL))

**Contratos de dado:** NewsCard, ArticleHeader, AdSlot → ver `data-visual-contracts.json`

**Ad slots (6):** news-mosaic:leaderboard, news-grid:leaderboard, news-grid:leaderboard, news-grid:leaderboard, news-cat-band:leaderboard, news-cat-band:leaderboard

**Image slots (0):** —

**Estados:** default · loading · empty · zero-results

**UI honesta:** ratings/score/streaming/imagem ausentes → estado honesto (ver estados). Sem dado inventado.

---

## 04 · Categoria (Filmes/Séries)
**Rota:** /pt/filmes,/pt/series · **Contexto:** filme|serie · **Template:** HomeTemplate · **Logo:** cinema vermelha (filmes) | serie verde (séries) · **Prioridade:** P0

**Árvore de componentes:**
```
Page
├── Header (logo por contexto)
├── HomeHero
├── Main (layout home-like + band condicional showMoviesBand/showSeriesBand)
└── Footer
```

**Seções (ordem exata):**

| # | ID | Título | Componente | Container | Itens | Ver tudo | Omitir quando | Vazio |
|---|---|---|---|---|---|---|---|---|
| 1 | cat-hero | (hero) | home-hero | container-full-bleed | 1 | — | nunca | neutro claro |
| 2 | cat-band | Banda da categoria | movie-card|series-card | container-editorial | 8 | sim | band da branch ativa | omite |
| 3 | cat-rest | Seções home-like | content-rail | container-editorial | 8 | sim | reusa seções da Home | omite |

**Tokens:** note: idêntico a HomeTemplate; muda dataset + acento (movie #D42A2E / series #395C42) + logo · accent: vermelho (filme) / verde (série)

**Interações:** link→movie-card|series-card (título link) · button→content-rail (prev/next)

**Contratos de dado:** MovieCard, SeriesCard, Hero → ver `data-visual-contracts.json`

**Ad slots (0):** —

**Image slots (0):** herda slots do layout home-like (loops)

**Estados:** default(filme) · default(serie) · loading · empty

**Exceções:** EX-04-dual: mesma tela, dois contextos (branch catRed/catGreen); logo e acento por branch

**UI honesta:** ratings/score/streaming/imagem ausentes → estado honesto (ver estados). Sem dado inventado.

---

## 05 · Artigo
**Rota:** /pt/noticias/[slug] · **Contexto:** noticia · **Template:** ArticleTemplate · **Logo:** neutro · **Prioridade:** P1

**Árvore de componentes:**
```
Page
├── Header
├── ArticleHero
├── Main (container-reading 720)
│   ├── ArticleHeader (byline/datas/tempo)
│   ├── ArticleBody (pull-quote/fact-box/inline-media)
│   ├── SourceAttribution
│   ├── CorrectionNotice
│   ├── AIDisclosure
│   ├── AdSlot(leaderboard)
│   ├── RelatedEntities
│   └── RelatedArticles
└── Footer
```

**Seções (ordem exata):**

| # | ID | Título | Componente | Container | Itens | Ver tudo | Omitir quando | Vazio |
|---|---|---|---|---|---|---|---|---|
| 1 | art-hero | (headline) | article-hero | container-editorial | 1 | — | sem imagem→hero compacto neutro | n/a |
| 2 | art-header | Cabeçalho | article-header | container-reading | 1 | — | tempo/atualização omitidos se ausentes | n/a |
| 3 | art-body | Corpo | article-body | container-reading | 1 | — | nunca (obrigatório) | n/a |
| 4 | art-sources | Fontes & transparência | source-attribution + correction-notice + ai-disclosure | container-reading | 1 | — | cada bloco omitido se ausente | omite |
| 5 | art-rel-ent | Entidades relacionadas | related-entities | container-editorial | 6 | sim | omite se vazio | omite |
| 6 | art-rel-art | Leia também | related-articles + related-content-card | container-editorial | 6 | sim | omite se vazio | omite |

**Tokens:** container: container-reading 720 (corpo) · typography: body-lg 17/1.7, heading-h1 34 · media: news 16/9

**Interações:** link→article-body/related (links descritivos) · button→article-footer (compartilhar (icon-button))

**Contratos de dado:** ArticleHeader, NewsCard, AdSlot → ver `data-visual-contracts.json`

**Ad slots (1):** art-sources:leaderboard

**Image slots (0):** —

**Estados:** default · partial(sem tempo/atualização) · no-hero-image

**UI honesta:** ratings/score/streaming/imagem ausentes → estado honesto (ver estados). Sem dado inventado.

---

## 06 · Detalhe de Filme
**Rota:** /pt/filmes/[slug] · **Contexto:** filme · **Template:** MovieDetailTemplate · **Logo:** cinema (vermelha) · **Prioridade:** P0

**Árvore de componentes:**
```
Page
├── Header (sólida vermelha)
├── TopInfoBar (claro, sem hero cover)
│   ├── MediaImage(poster 2/3)
│   ├── EntityTitle + EntityMetadata
│   ├── EntityActions (trailer/watchlist/share)
│   ├── CinerieScore + ExternalRating (RatingSourceList)
│   └── StreamingAvailability
├── Main
│   ├── Section Sinopse
│   ├── Section Ficha técnica (CreatorCredits/EntityMetadata)
│   ├── Section Elenco (CastList)
│   ├── Section Mídia (trailer/fotos — MediaGallery)
│   ├── Section Editorial relacionado (ArticleCard)
│   └── Section Recomendações (ContentRail/RecommendationCard)
└── Footer
```

**Seções (ordem exata):**

| # | ID | Título | Componente | Container | Itens | Ver tudo | Omitir quando | Vazio |
|---|---|---|---|---|---|---|---|---|
| 1 | mv-info | Top info bar | entity-title+entity-metadata+entity-actions+cinerie-score+external-rating+streaming-availability | container-editorial | 1 | — | score/streaming ausentes→estado honesto | estado honesto (não vazio) |
| 2 | mv-synopsis | Sinopse | article-body(curto) | container-editorial | 1 | — | omite se ausente | omite |
| 3 | mv-facts | Ficha técnica | creator-credits+entity-metadata | container-editorial | 1 | — | campo ausente omitido (sem N/D) | omite |
| 4 | mv-cast | Elenco | cast-list | container-editorial | 8 | sim | omite se vazio | omite |
| 5 | mv-media | Mídia | media-gallery | container-editorial | 6 | sim | still ausente→muted | omite |
| 6 | mv-editorial | Do editorial | article-card | container-editorial | 3 | sim | omite se vazio | omite |
| 7 | mv-recs | Você também pode gostar | recommendation-card | container-editorial | 6 | sim | omite se vazio | omite |

**Tokens:** container: container-editorial 1280 · grid: grid-detail-media 1fr/3fr/2fr · media: poster 2/3, backdrop 16/9 · score: numeric-lg 47 (Cinerie Score), numeric-md 22 (rating) · accent: movie #D42A2E CTA / #8A1E1A links

**Interações:** button→entity-actions (Assistir trailer / +Watchlist / Compartilhar(icon-button)) · link→cast-list/recommendation-card (nome/título link) · carousel→media-gallery (prev/next) · link→streaming-availability (link externo do provedor)

**Contratos de dado:** Hero(top-info), CinerieScore, ExternalRating, StreamingAvailability, MovieCard, RecommendationCard, ArticleHeader, AdSlot(n/a) → ver `data-visual-contracts.json`

**Ad slots (0):** —

**Image slots (9):** movie-poster (2/3), movie-trailer (16/9), movie-fotos (16/9), movie-noticias (16/9), movie-premios (16/9), movie-critica (16/9), mcast-{initials} (3/4), {a.slotId} (varia), {m.slotId} (2/3)

**Estados:** default · no-score(6 estados honestos) · no-streaming · partial-media · no-image(fallback)

**Exceções:** EX-06-nohero: hero cover removido por decisão do usuário → top-info-bar branca; nav sólida

**UI honesta:** ratings/score/streaming/imagem ausentes → estado honesto (ver estados). Sem dado inventado.

---

## 07 · Detalhe de Série
**Rota:** /pt/series/[slug] · **Contexto:** serie · **Template:** SeriesDetailTemplate · **Logo:** serie (verde) · **Prioridade:** P0

**Árvore de componentes:**
```
Page
├── Header (sólida verde)
├── TopInfoBar (poster/título/status/ações/score/streaming)
├── Main
│   ├── SeasonSelector
│   ├── SeasonSummary
│   ├── Episode list (EpisodeCard ×N)
│   ├── Section Elenco (CastList)
│   ├── Section Mídia (MediaGallery)
│   ├── Section Editorial (ArticleCard)
│   └── Section More like this (ContentRail)
└── Footer
```

**Seções (ordem exata):**

| # | ID | Título | Componente | Container | Itens | Ver tudo | Omitir quando | Vazio |
|---|---|---|---|---|---|---|---|---|
| 1 | sr-info | Top info bar | entity-title+entity-metadata+entity-actions+cinerie-score+streaming-availability | container-editorial | 1 | — | status/score/streaming honestos | estado honesto |
| 2 | sr-seasons | Temporadas | season-selector | container-editorial | 1 | — | 1 temporada→sem seletor | n/a |
| 3 | sr-season-sum | Resumo da temporada | season-summary | container-editorial | 1 | — | temporada futura→'em breve' | 'em breve' |
| 4 | sr-eps | Episódios | episode-card | container-editorial | 10 | — | futuro→sem still/sinopse; spoiler oculto | 'em breve' |
| 5 | sr-cast | Elenco | cast-list | container-editorial | 8 | sim | omite se vazio | omite |
| 6 | sr-media | Mídia | media-gallery | container-editorial | 6 | sim | still ausente→muted | omite |
| 7 | sr-editorial | Do editorial | article-card | container-editorial | 3 | sim | omite se vazio | omite |
| 8 | sr-recs | Mais como este | recommendation-card | container-editorial | 6 | sim | omite se vazio | omite |

**Tokens:** container: container-editorial 1280 · media: still 16/9, poster 2/3 · accent: series #395C42 (texto/links) / #7FA56F (ponto) · score: numeric-lg 47

**Interações:** tabs→season-selector (trocar temporada (aria-selected, roving)) · button→episode-card (revelar spoiler / abrir episódio) · link→cast-list/recommendation-card (link) · button→entity-actions (trailer/watchlist/share)

**Contratos de dado:** CinerieScore, ExternalRating, StreamingAvailability, SeasonCard, EpisodeCard, SeriesCard, RecommendationCard → ver `data-visual-contracts.json`

**Ad slots (0):** —

**Image slots (10):** series-poster (2/3), media-trailer (16/9), media-fotos (16/9), media-noticias (16/9), media-premios (16/9), series-critica (16/9), ep-{slotId} (16/9), cast-{initials} (3/4), {a.slotId} (varia), {m.slotId} (2/3)

**Estados:** default · future-season · spoiler-hidden · no-score · no-streaming · partial-episode

**Exceções:** EX-07-nohero: top-info-bar branca (hero removido); temporada/episódio são seções, não telas

**UI honesta:** ratings/score/streaming/imagem ausentes → estado honesto (ver estados). Sem dado inventado.

---

## 08 · Série (mobile)
**Rota:** /pt/series/[slug] @390 · **Contexto:** serie · **Template:** SeriesDetailTemplate · **Logo:** serie (verde) · **Prioridade:** P1

**Árvore de componentes:**
```
Page(390)
├── MobileNavigation
├── TopInfoBar compacto
├── SeasonSelector (overflow horizontal)
├── EpisodeCard list
└── Footer mobile
```

**Seções (ordem exata):**

| # | ID | Título | Componente | Container | Itens | Ver tudo | Omitir quando | Vazio |
|---|---|---|---|---|---|---|---|---|
| 1 | m-info | Top info (mobile) | entity-title+entity-metadata+entity-actions | full-width | 1 | — | — | estado honesto |
| 2 | m-seasons | Temporadas | season-selector | full-width | 1 | — | — | n/a |
| 3 | m-eps | Episódios | episode-card | full-width | 6 | — | futuro→'em breve'; spoiler oculto | 'em breve' |

**Tokens:** container: full-width mobile 390 · touchTarget: ≥44px · typography: reduzida vs desktop

**Interações:** tabs→season-selector (overflow horizontal roving) · button→mobile-navigation (drawer (foco preso, Escape, safe-area)) · button→episode-card (revelar spoiler)

**Contratos de dado:** SeasonCard, EpisodeCard, SeriesCard → ver `data-visual-contracts.json`

**Ad slots (0):** —

**Image slots (3):** m-series-poster (2/3), m-ep-{slotId} (16/9), m-media (16/9)

**Estados:** default(390) · future-season · spoiler-hidden · drawer-open

**Exceções:** EX-08-mobile: variante mobile do 07 (mesmo template, breakpoint 390)

**UI honesta:** ratings/score/streaming/imagem ausentes → estado honesto (ver estados). Sem dado inventado.

---

## 09 · Pessoa
**Rota:** /pt/pessoas/[slug] · **Contexto:** pessoa · **Template:** PersonDetailTemplate · **Logo:** neutro · **Prioridade:** P1

**Árvore de componentes:**
```
Page
├── Header
├── PersonHero (portrait + nome)
├── Main
│   ├── Biografia
│   ├── EntityMetadata
│   ├── PersonCredits (filmografia)
│   ├── AdSlot(leaderboard)
│   ├── Notícias relacionadas
│   └── Related people
└── Footer
```

**Seções (ordem exata):**

| # | ID | Título | Componente | Container | Itens | Ver tudo | Omitir quando | Vazio |
|---|---|---|---|---|---|---|---|---|
| 1 | pe-hero | (nome) | person-hero | container-editorial | 1 | — | sem portrait→avatar iniciais | neutro claro |
| 2 | pe-bio | Biografia | article-body(curto) | container-reading | 1 | — | sem bio→omite bloco | omite |
| 3 | pe-meta | Dados | entity-metadata | container-editorial | 1 | — | campo ausente omitido | omite |
| 4 | pe-credits | Filmografia | person-credits + movie-card + series-card | container-editorial | 12 | sim | omite se vazio | empty-state |
| 5 | pe-news | Notícias | related-articles | container-editorial | 3 | sim | omite se vazio | omite |
| 6 | pe-related | Pessoas relacionadas | related-content-card | container-editorial | 6 | sim | omite se vazio | omite |

**Tokens:** container: container-editorial 1280 + reading 720 (bio) · media: portrait 3/4 · typography: heading-h1 34

**Interações:** link→person-credits/movie-card (título link) · button→content-rail (prev/next)

**Contratos de dado:** PersonCard, MovieCard, SeriesCard, NewsCard, AdSlot → ver `data-visual-contracts.json`

**Ad slots (1):** pe-credits:leaderboard

**Image slots (0):** —

**Estados:** default · no-image(avatar) · no-bio · partial

**UI honesta:** ratings/score/streaming/imagem ausentes → estado honesto (ver estados). Sem dado inventado.

---

## 10 · Onde assistir (Browse)
**Rota:** /pt/onde-assistir · **Contexto:** neutro · **Template:** CatalogBrowseTemplate · **Logo:** neutro · **Prioridade:** P1

**Árvore de componentes:**
```
Page
├── Header
├── CompactHero (título + descrição)
├── Main
│   ├── Filtros (Chip/SegmentedControl)
│   ├── AdSlot(leaderboard)
│   ├── Rails por provedor (ContentRail)
│   ├── PosterGrid
│   ├── AdSlot(leaderboard)
│   └── Pagination
└── Footer
```

**Seções (ordem exata):**

| # | ID | Título | Componente | Container | Itens | Ver tudo | Omitir quando | Vazio |
|---|---|---|---|---|---|---|---|---|
| 1 | br-hero | Onde assistir | compact-hero | container-editorial | 1 | — | sem imagem→sem fundo escuro | n/a |
| 2 | br-filters | Filtros | chip+toggle-segmented | container-editorial | 8 | — | nunca | n/a |
| 3 | br-rails | Por provedor | content-rail + movie-card/series-card | container-editorial | 8 | sim | provedor sem títulos→omite/streaming-unavailable | omite |
| 4 | br-grid | Catálogo | content-grid | container-editorial | 24 | sim | zero-results→empty | zero-results |
| 5 | br-pag | Paginação | pagination | container-editorial | 1 | — | 1 página→omite | n/a |

**Tokens:** container: container-editorial 1280 · media: poster 2/3 · control: chip 30/36px, segmented

**Interações:** chip→chip (filtrar (texto+estado, não só cor)) · toggle→toggle-segmented (alternar modalidade) · link→movie-card (título link) · pagination→pagination (link de página)

**Contratos de dado:** StreamingAvailability, MovieCard, SeriesCard, AdSlot → ver `data-visual-contracts.json`

**Ad slots (2):** br-filters:leaderboard, br-grid:leaderboard

**Image slots (0):** —

**Estados:** default · filtered · loading · empty · zero-results

**UI honesta:** ratings/score/streaming/imagem ausentes → estado honesto (ver estados). Sem dado inventado.

---

## 11 · Explorar (Discover)
**Rota:** /pt/explorar · **Contexto:** neutro · **Template:** ExploreTemplate · **Logo:** neutro (preta) · **Prioridade:** P1

**Árvore de componentes:**
```
Page
├── Header
├── Main
│   ├── SectionHeader + Tabs/Chips
│   ├── Coleções (ContentRail/Carousel)
│   ├── PosterGrid
│   ├── AdSlot(leaderboard)
│   └── Pagination
└── Footer
```

**Seções (ordem exata):**

| # | ID | Título | Componente | Container | Itens | Ver tudo | Omitir quando | Vazio |
|---|---|---|---|---|---|---|---|---|
| 1 | dc-head | Explorar | section-header + tabs | container-editorial | 1 | — | nunca | n/a |
| 2 | dc-collections | Coleções | content-rail + carousel | container-editorial | 8 | sim | omite se vazio | omite |
| 3 | dc-grid | Resultados | content-grid | container-editorial | 24 | sim | zero-results→empty | zero-results |
| 4 | dc-pag | Paginação | pagination | container-editorial | 1 | — | 1 página→omite | n/a |

**Tokens:** container: container-editorial 1280 · media: poster 2/3, backdrop 16/9 · grid: grid-poster

**Interações:** tabs→tabs (trocar categoria) · chip→chip (filtro) · carousel→carousel (coleções prev/next) · link→movie-card (link)

**Contratos de dado:** MovieCard, SeriesCard, RecommendationCard, AdSlot → ver `data-visual-contracts.json`

**Ad slots (1):** dc-grid:leaderboard

**Image slots (7):** discover-collection-1..7 (16/9|2/3)

**Estados:** default · filtered · loading · empty · zero-results

**UI honesta:** ratings/score/streaming/imagem ausentes → estado honesto (ver estados). Sem dado inventado.

---

## 12 · Mais aguardados
**Rota:** /pt/em-breve · **Contexto:** neutro/misto · **Template:** ExploreTemplate · **Logo:** neutro (preta) · **Prioridade:** P2

**Árvore de componentes:**
```
Page
├── Header
├── Main
│   ├── SectionHeader 'Mais aguardados'
│   ├── TrailerCard rail (Em breve)
│   └── PosterGrid por data
└── Footer
```

**Seções (ordem exata):**

| # | ID | Título | Componente | Container | Itens | Ver tudo | Omitir quando | Vazio |
|---|---|---|---|---|---|---|---|---|
| 1 | an-head | Mais aguardados | section-header | container-editorial | 1 | — | nunca | n/a |
| 2 | an-trailers | Em breve | trailer-card | container-full-bleed (faixa escura) | 6 | sim | omite se vazio | omite |
| 3 | an-grid | Por estreia | content-grid + movie-card | container-editorial | 24 | sim | sem data→'a definir' (não inventa) | empty |

**Tokens:** container: container-editorial 1280 + full-bleed (trailers) · media: trailer-still 16/10, poster 2/3

**Interações:** button→trailer-card (Watch / bookmark) · link→movie-card (link) · button→content-rail (prev/next)

**Contratos de dado:** MovieCard, RecommendationCard → ver `data-visual-contracts.json`

**Ad slots (0):** —

**Image slots (1):** anticipated-lead (16/10)

**Estados:** default · loading · empty

**Exceções:** EX-12-nodate: estreia ausente → 'a definir', nunca data inventada

**UI honesta:** ratings/score/streaming/imagem ausentes → estado honesto (ver estados). Sem dado inventado.

---

## 13 · Configurações
**Rota:** /pt/configuracoes · **Contexto:** neutro · **Template:** SettingsTemplate · **Logo:** neutro (preta) · **Prioridade:** P1

**Árvore de componentes:**
```
Page
├── Header
├── Main (container ~720–960)
│   ├── SectionHeader 'Configurações'
│   ├── Tabs/anchor (seções)
│   ├── Field groups (field/select/switch/checkbox)
│   ├── FormActions
│   └── Alert/Toast (feedback)
└── Footer
```

**Seções (ordem exata):**

| # | ID | Título | Componente | Container | Itens | Ver tudo | Omitir quando | Vazio |
|---|---|---|---|---|---|---|---|---|
| 1 | st-head | Configurações | section-header | container-reading | 1 | — | nunca | n/a |
| 2 | st-nav | Seções | tabs | container-reading | 1 | — | nunca | n/a |
| 3 | st-account | Conta | field+avatar | container-reading | 1 | — | email não verificado→product-state | n/a |
| 4 | st-prefs | Preferências | switch+select+checkbox | container-reading | 1 | — | opcional marcado 'opcional' | n/a |
| 5 | st-actions | Salvar | form-actions + toast | container-reading | 1 | — | nunca | n/a |

**Tokens:** container: container-reading/edit ~720–960 · control: height-md 44, radius-control 8 · state: focus #101010, error #C7382F

**Interações:** tabs→tabs (trocar seção) · switch→switch (ligar/desligar (role switch)) · select→select (escolher) · button→form-actions (Salvar (loading não muda largura))

**Contratos de dado:** (forms — data-visual: n/a de catálogo) → ver `data-visual-contracts.json`

**Ad slots (0):** —

**Image slots (1):** settings-avatar (1/1)

**Estados:** default · focus · invalid · success · loading · disabled · readonly · email-unverified

**Exceções:** EX-13-auth: tela existe mas funcionalidade autenticada NÃO é implementada nesta unidade (só estrutura/estados)

**UI honesta:** ratings/score/streaming/imagem ausentes → estado honesto (ver estados). Sem dado inventado.

---

## 14 · Importar dados
**Rota:** /pt/configuracoes/dados · **Contexto:** neutro · **Template:** SettingsTemplate · **Logo:** neutro (preta) · **Prioridade:** P2

**Árvore de componentes:**
```
Page
├── Header
├── Main (container ~720)
│   ├── SectionHeader 'Importar dados'
│   ├── Field de upload/fonte
│   ├── FormActions
│   └── Estados: loading/success/error (Alert)
└── Footer
```

**Seções (ordem exata):**

| # | ID | Título | Componente | Container | Itens | Ver tudo | Omitir quando | Vazio |
|---|---|---|---|---|---|---|---|---|
| 1 | dt-head | Importar dados | section-header | container-reading | 1 | — | nunca | n/a |
| 2 | dt-source | Fonte | field+select | container-reading | 1 | — | nunca | n/a |
| 3 | dt-run | Importar | form-actions + alert | container-reading | 1 | — | nunca | estados loading/success/error |
| 4 | dt-log | Resultado | alert + loading-state | container-reading | 1 | — | sem resultado→omite | empty |

**Tokens:** container: container-reading ~720 · control: height-md 44

**Interações:** select→select (fonte) · button→form-actions (Importar (loading)) · button→button (Cancelar)

**Contratos de dado:** (forms) → ver `data-visual-contracts.json`

**Ad slots (0):** —

**Image slots (0):** —

**Estados:** default · loading · success · error · empty

**Exceções:** EX-14-auth: sem integração real; só estrutura e estados

**UI honesta:** ratings/score/streaming/imagem ausentes → estado honesto (ver estados). Sem dado inventado.

---

## 15 · Listas
**Rota:** /pt/listas · **Contexto:** neutro/misto · **Template:** CollectionTemplate · **Logo:** neutro (preta) · **Prioridade:** P1

**Árvore de componentes:**
```
Page
├── Header
├── Main
│   ├── SectionHeader 'Listas'
│   ├── AdSlot(leaderboard)
│   ├── Cards de lista (Horizontal/Compact)
│   ├── PosterGrid da lista
│   ├── AdSlot(leaderboard) ×2
│   └── EmptyState (sem listas)
└── Footer
```

**Seções (ordem exata):**

| # | ID | Título | Componente | Container | Itens | Ver tudo | Omitir quando | Vazio |
|---|---|---|---|---|---|---|---|---|
| 1 | ls-head | Listas | section-header | container-editorial | 1 | — | nunca | n/a |
| 2 | ls-cards | Suas listas | horizontal-content-card+compact-content-card | container-editorial | 6 | sim | sem listas→empty-state | empty-state |
| 3 | ls-grid | Itens da lista | content-grid + movie-card/series-card | container-editorial | 24 | sim | lista vazia→empty-state | empty-state 'lista vazia' |

**Tokens:** container: container-editorial 1280 · media: poster 2/3

**Interações:** link→horizontal-content-card (abrir lista) · link→movie-card (link) · button→empty-state (ação sugerida)

**Contratos de dado:** MovieCard, SeriesCard, AdSlot → ver `data-visual-contracts.json`

**Ad slots (3):** ls-cards:leaderboard, ls-cards:leaderboard, ls-grid:leaderboard

**Image slots (0):** —

**Estados:** default · empty · loading · private · unauthenticated

**Exceções:** EX-15-auth: listas de usuário: estados private/unauthenticated como product-state; sem tela autenticada plena

**UI honesta:** ratings/score/streaming/imagem ausentes → estado honesto (ver estados). Sem dado inventado.

---

## 16 · Entrar
**Rota:** /pt/entrar · **Contexto:** neutro · **Template:** AuthTemplate · **Logo:** neutro (preta) · **Prioridade:** P1

**Árvore de componentes:**
```
Page
├── Header (minimal)
├── Main (coluna centrada ~420)
│   ├── Título
│   ├── Field (email)
│   ├── PasswordInput
│   ├── FormActions (Entrar)
│   ├── Link secundário (cadastrar/recuperar)
│   └── AdSlot(leaderboard)
└── Footer (minimal)
```

**Seções (ordem exata):**

| # | ID | Título | Componente | Container | Itens | Ver tudo | Omitir quando | Vazio |
|---|---|---|---|---|---|---|---|---|
| 1 | en-head | Entrar | section-header(sm) | centered | 1 | — | nunca | n/a |
| 2 | en-form | Formulário | field+password-input+form-actions | centered | 1 | — | nunca | erro→alert |
| 3 | en-alt | Alternativas | link | centered | 1 | — | nunca | n/a |

**Tokens:** container: coluna centrada ~420 · control: height-md 44, radius-control 8

**Interações:** button→form-actions (Entrar (loading)) · link→link (cadastrar/recuperar)

**Contratos de dado:** (forms), AdSlot → ver `data-visual-contracts.json`

**Ad slots (1):** en-alt:leaderboard

**Image slots (0):** —

**Estados:** default · focus · invalid · loading · error

**Exceções:** EX-16-auth: formulário de entrada; sem backend/autenticação real nesta unidade

**UI honesta:** ratings/score/streaming/imagem ausentes → estado honesto (ver estados). Sem dado inventado.

---

## 17 · Anúncio · pop-up
**Rota:** — (não roteável) · **Contexto:** publicidade · **Template:** AdScreenTemplate · **Logo:** neutro · **Prioridade:** P3

**Árvore de componentes:**
```
ModalOverlay
├── AdSlot(rectangle)
├── AdLabel 'PUBLICIDADE'
└── IconButton(fechar)
```

**Seções (ordem exata):**

| # | ID | Título | Componente | Container | Itens | Ver tudo | Omitir quando | Vazio |
|---|---|---|---|---|---|---|---|---|
| 1 | ad-pop | Pop-up | ad-slot(rectangle)+icon-button | overlay centrado | 1 | — | sem criativo→unavailable | unavailable |

**Tokens:** zIndex: z-modal 100 / backdrop 90 · shadow: shadow-modal

**Interações:** button→icon-button (fechar (aria-label, Escape)) · modal→modal (foco preso, retorno de foco)

**Contratos de dado:** AdSlot → ver `data-visual-contracts.json`

**Ad slots (1):** ad-pop:rectangle

**Image slots (0):** —

**Estados:** filled · placeholder · unavailable · closing

**Exceções:** EX-17-ad: superfície de publicidade; não é tela de produto plena; rótulo obrigatório

**UI honesta:** ratings/score/streaming/imagem ausentes → estado honesto (ver estados). Sem dado inventado.

---

## 18 · Anúncio · tela cheia
**Rota:** — (não roteável) · **Contexto:** publicidade · **Template:** AdScreenTemplate · **Logo:** neutro · **Prioridade:** P3

**Árvore de componentes:**
```
Interstitial(full-bleed)
├── AdSlot(billboard)
├── AdLabel 'PUBLICIDADE'
└── IconButton(fechar/pular)
```

**Seções (ordem exata):**

| # | ID | Título | Componente | Container | Itens | Ver tudo | Omitir quando | Vazio |
|---|---|---|---|---|---|---|---|---|
| 1 | ad-tela | Interstitial | ad-slot(billboard)+icon-button | full-bleed | 1 | — | sem criativo→unavailable | unavailable |

**Tokens:** zIndex: z-modal 100 · note: full-bleed

**Interações:** button→icon-button (fechar/pular (aria-label, temporizador))

**Contratos de dado:** AdSlot → ver `data-visual-contracts.json`

**Ad slots (1):** ad-tela:billboard

**Image slots (0):** —

**Estados:** filled · placeholder · unavailable · closing

**Exceções:** EX-18-ad: interstitial de publicidade; rótulo obrigatório; espaço reservado

**UI honesta:** ratings/score/streaming/imagem ausentes → estado honesto (ver estados). Sem dado inventado.

