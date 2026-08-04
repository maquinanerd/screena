# 16 — Page Templates (D4A)

**13 templates** cobrindo as 18 telas públicas. Só criamos template com tela consumidora real. Status: `TEMPLATES_DEFINED_NOT_MIGRATED`. Fonte de verdade: `page-templates.json`. **Nenhum componente aplicado ao canônico.**

## Templates → telas
| Template | Telas | Logo | Hero | Container |
|---|---|---|---|---|
| HomeTemplate | 02, 04 | neutro (branca no hero / preta no scroll) | home-hero (slides, autoplay 6s, pausável) | container-editorial 1280 (faixas de mídia = full-bleed) |
| NewsIndexTemplate | 03 | neutro | não (destaque via mosaico) | container-editorial 1280 |
| ArticleTemplate | 05 | neutro | article-hero (headline + imagem de topo) | container-reading 720 (corpo) dentro de container-editorial |
| MovieDetailTemplate | 06 | cinema (vermelha) | não (top-info-bar branca: poster + título + metadata + ações) | container-editorial 1280 |
| SeriesDetailTemplate | 07, 08 | serie (verde) | não (top-info-bar) — mobile: header compacto | container-editorial 1280 (08: full-width mobile 390) |
| PersonDetailTemplate | 09 | neutro | person-hero (portrait + nome; sem imagem→neutro claro) | container-editorial 1280 |
| CatalogBrowseTemplate | 10 | neutro | compact-hero (título + descrição; sem imagem estrutural escura) | container-editorial 1280 |
| ExploreTemplate | 11, 12 | neutro (preta) | não (título + descrição compactos) | container-editorial 1280 |
| CollectionTemplate | 15 | neutro | não (cabeçalho de coleção) | container-editorial 1280 |
| SettingsTemplate | 13, 14 | neutro (preta) | não (cabeçalho de página) | container-reading/edit ~720–960 |
| AuthTemplate | 16 | neutro (preta) | não | coluna centrada ~420–480 |
| AdScreenTemplate | 17, 18 | neutro | não | overlay centrado (17) / full-bleed interstitial (18) |
| DevOverlayTemplate | 01 | n/a | não | overlay |

## Templates NÃO criados (sem tela consumidora)
- EntityDetailTemplate (dividido em Movie/SeriesDetail por contexto real)
- SeasonDetailTemplate + EpisodeDetailTemplate (temporada/episódio são SEÇÕES do SeriesDetail, não telas standalone)
- SearchTemplate (busca é componente/drawer global, não tela dedicada)
- CatalogIndexTemplate (coberto por CatalogBrowse + Explore)
- InstitutionalTemplate (nenhuma tela puramente institucional entre as 18; settings tem template próprio)

## Anatomia por template
Cada template define: finalidade · telas · Header · logo · hero · container · grid · sidebar · seções (ordem) · publicidade · newsletter · related · footer · sticky · sem-imagem · dados-parciais · estados · responsividade · componentes permitidos · componentes proibidos (ver `page-templates.json`).

### HomeTemplate
**Finalidade:** home editorial e home de categoria (mesmo layout, dataset+acento por contexto). **Telas:** 02, 04.
- **Header:** transparent-on-image no topo → default-light sólido no scroll (350ms) · **Hero:** home-hero (slides, autoplay 6s, pausável) · **Container:** container-editorial 1280 (faixas de mídia = full-bleed) · **Grid:** grid-poster / grid-top10 / grid-news conforme seção
- **Seções (ordem):** hero → Today's Featured Picks → Popular This Week → Filmes em alta (band condicional) → Séries da semana (band condicional) → Get a Glimpse (Em breve) → Notícias & Entrevistas
- **Publicidade:** 4 leaderboards intercalados (só 02; 04 = 0) · **Footer:** footer claro global · **Sticky:** header
- **Sem imagem:** pôster→poster-fallback; hero sem backdrop→fundo neutro claro (nunca escuro estrutural) · **Parcial:** seção sem itens é omitida (não renderiza cabeçalho vazio)
- **Estados:** default · loading(skeleton de rails) · empty(seção omitida)
- **Permitidos:** home-hero, section-header, highlight-rail-card, content-rail, content-grid, news-overlay-card, trailer-card, movie-card, series-card, chip, ad-slot, button, icon-button, carousel
- **Proibidos:** entity-hero, article-body, form fields, fundo escuro fora de mídia/hero

### NewsIndexTemplate
**Finalidade:** índice de notícias e entrevistas com mosaico e categorias. **Telas:** 03.
- **Header:** default-light · **Hero:** não (destaque via mosaico) · **Container:** container-editorial 1280 · **Grid:** grid-news 1.25fr/1fr (mosaico 1 grande + 4 pequenos) + grid de cards
- **Seções (ordem):** section-header 'Notícias & Entrevistas' → chips de categoria → mosaico overlay → grid de news-card → paginação
- **Publicidade:** 6 leaderboards (inclui 2 da band de categoria embutida) · **Footer:** footer claro · **Sticky:** header
- **Sem imagem:** news sem imagem→card só texto; overlay sem imagem→superfície muted · **Parcial:** campos ausentes omitidos
- **Estados:** default · loading · empty · zero-results
- **Permitidos:** section-header, chip, news-overlay-card, news-card, article-card, compact-content-card, pagination, ad-slot, tabs
- **Proibidos:** entity-hero, cinerie-score, streaming-availability

### ArticleTemplate
**Finalidade:** leitura de artigo/notícia individual. **Telas:** 05.
- **Header:** default-light · **Hero:** article-hero (headline + imagem de topo) · **Container:** container-reading 720 (corpo) dentro de container-editorial · **Grid:** coluna única de leitura + trilhos relacionados full-width
- **Seções (ordem):** article-hero → article-header (byline/datas/tempo) → article-body (pull-quote/fact-box/inline-media) → source-attribution → correction-notice → ai-disclosure → related-entities → related-articles → ad-slot → footer
- **Publicidade:** 1 leaderboard (entre corpo e relacionados) · **Footer:** footer claro · **Sticky:** header
- **Sem imagem:** sem imagem de topo→article-hero compacto neutro · **Parcial:** tempo de leitura/atualização omitidos se ausentes
- **Estados:** default · loading · partial
- **Permitidos:** article-hero, article-header, article-body, source-attribution, correction-notice, ai-disclosure, related-entities, related-articles, article-footer, related-content-card, ad-slot, link
- **Proibidos:** entity-hero, cinerie-score, movie-card como corpo

### MovieDetailTemplate
**Finalidade:** detalhe de filme (top-info-bar clara, sem hero cover). **Telas:** 06.
- **Header:** default-light sólida (sem transparência — decisão do usuário) · **Hero:** não (top-info-bar branca: poster + título + metadata + ações) · **Container:** container-editorial 1280 · **Grid:** grid-detail-media 1fr/3fr/2fr nas faixas de mídia
- **Seções (ordem):** top-info-bar (poster/entity-title/entity-metadata/entity-actions/cinerie-score/external-rating/streaming) → sinopse → ficha técnica (creator-credits/entity-metadata) → elenco (cast-list) → mídia (trailer/fotos) → editorial relacionado → recomendações (content-rail)
- **Publicidade:** 0 (revisão 15/07 removeu os 2 leaderboards) · **Footer:** footer claro · **Sticky:** header
- **Sem imagem:** poster ausente→poster-fallback; still ausente→muted · **Parcial:** score/rating/streaming ausentes seguem estados honestos (não renderiza vazio)
- **Estados:** default · no-score(insufficient/not_calculated/unavailable/blocked/omitted) · no-streaming · partial-media · no-image
- **Permitidos:** entity-title, entity-metadata, entity-actions, creator-credits, cinerie-score, external-rating, rating-source-list, user-rating, streaming-availability, streaming-unavailable, cast-list, media-gallery, content-rail, recommendation-card, related-articles, media-image, button, icon-button
- **Proibidos:** home-hero, article-body como corpo principal, nota fictícia, streaming inferido

### SeriesDetailTemplate
**Finalidade:** detalhe de série (+ temporadas/episódios como seções); variante mobile. **Telas:** 07, 08.
- **Header:** default-light sólida (07); mobile-navigation (08) · **Hero:** não (top-info-bar) — mobile: header compacto · **Container:** container-editorial 1280 (08: full-width mobile 390) · **Grid:** grid-detail-media; episódios em lista vertical
- **Seções (ordem):** top-info-bar (poster/entity-title/entity-metadata/status/actions/score/streaming) → season-selector → season-summary → episode list (episode-card) → elenco → mídia → editorial → more like this (content-rail)
- **Publicidade:** 0 · **Footer:** footer claro (07); rodapé mobile compacto (08) · **Sticky:** header, season-selector (opcional)
- **Sem imagem:** still de episódio ausente→muted; poster→fallback · **Parcial:** temporada futura sem episódios→season-summary 'em breve'; spoiler oculto
- **Estados:** default · future-season · spoiler-hidden · no-score · no-streaming · partial-episode · mobile(390)
- **Permitidos:** entity-title, entity-metadata, entity-actions, cinerie-score, external-rating, streaming-availability, season-selector, season-summary, episode-card, episode-metadata, episode-progress, cast-list, media-gallery, content-rail, recommendation-card, mobile-navigation, media-image
- **Proibidos:** home-hero, tratar temporada como movie-card, tracking autenticado funcional

### PersonDetailTemplate
**Finalidade:** detalhe de pessoa (biografia + créditos). **Telas:** 09.
- **Header:** default-light · **Hero:** person-hero (portrait + nome; sem imagem→neutro claro) · **Container:** container-editorial 1280 · **Grid:** portrait + coluna de biografia; créditos em content-grid/rail
- **Seções (ordem):** person-hero → biografia → metadata → person-credits (filmografia) → notícias relacionadas → related people → ad-slot
- **Publicidade:** 1 leaderboard · **Footer:** footer claro · **Sticky:** header
- **Sem imagem:** portrait ausente→avatar iniciais; sem bio→omite bloco · **Parcial:** função/conhecido-por omitidos se ausentes
- **Estados:** default · no-image · no-bio · partial
- **Permitidos:** person-hero, avatar, person-credits, movie-card, series-card, content-grid, content-rail, related-content-card, related-articles, ad-slot, link
- **Proibidos:** cinerie-score, streaming-availability, entity-hero

### CatalogBrowseTemplate
**Finalidade:** onde assistir — navegação por provedores/filtros. **Telas:** 10.
- **Header:** default-light · **Hero:** compact-hero (título + descrição; sem imagem estrutural escura) · **Container:** container-editorial 1280 · **Grid:** grid-poster + rails por provedor
- **Seções (ordem):** compact-hero → filtros (chip/toggle-segmented) → rails por provedor (content-rail) → poster grid → paginação → ad-slot
- **Publicidade:** 2 leaderboards · **Footer:** footer claro · **Sticky:** header, barra de filtros (opcional)
- **Sem imagem:** poster→fallback · **Parcial:** provedor sem títulos→seção omitida; sem oferta→streaming-unavailable
- **Estados:** default · filtered · loading · empty · zero-results
- **Permitidos:** compact-hero, section-header, chip, toggle-segmented, content-rail, content-grid, movie-card, series-card, streaming-availability, streaming-region-notice, pagination, ad-slot
- **Proibidos:** entity-hero, article-body, disponibilidade inventada

### ExploreTemplate
**Finalidade:** explorar/descobrir e mais aguardados (grids filtráveis + coleções). **Telas:** 11, 12.
- **Header:** default-light · **Hero:** não (título + descrição compactos) · **Container:** container-editorial 1280 · **Grid:** grid-poster + coleções em content-rail; trailer-card para 'em breve' (12)
- **Seções (ordem):** section-header → filtros/tabs (chip/tabs) → coleções (content-rail) → poster grid → trailer-card rail (12: Em breve) → paginação → ad-slot
- **Publicidade:** 1 leaderboard (11); 0 (12) · **Footer:** footer claro · **Sticky:** header
- **Sem imagem:** poster→fallback; trailer still→muted · **Parcial:** coleção vazia omitida
- **Estados:** default · filtered · loading · empty · zero-results
- **Permitidos:** section-header, chip, tabs, content-rail, content-grid, movie-card, series-card, trailer-card, carousel, pagination, ad-slot
- **Proibidos:** entity-hero, cinerie-score isolado sem contexto, data de estreia inventada

### CollectionTemplate
**Finalidade:** listas do usuário (visão pública/editorial das coleções). **Telas:** 15.
- **Header:** default-light · **Hero:** não (cabeçalho de coleção) · **Container:** container-editorial 1280 · **Grid:** grid-poster por lista + cards de lista
- **Seções (ordem):** section-header → cards de lista (compact/horizontal) → poster grid da lista selecionada → ad-slot → empty-state (sem listas)
- **Publicidade:** 3 leaderboards · **Footer:** footer claro · **Sticky:** header
- **Sem imagem:** poster→fallback · **Parcial:** lista vazia→empty-state 'sua lista está vazia' (sem cards fantasma)
- **Estados:** default · empty · loading · private(product-state) · unauthenticated(product-state)
- **Permitidos:** section-header, horizontal-content-card, compact-content-card, content-grid, movie-card, series-card, empty-state, product-state, ad-slot, button
- **Proibidos:** entity-hero, dado fictício em lista vazia

### SettingsTemplate
**Finalidade:** configurações e importação de dados (formulários, sem funcionalidade autenticada nesta unidade). **Telas:** 13, 14.
- **Header:** default-light · **Hero:** não (cabeçalho de página) · **Container:** container-reading/edit ~720–960 · **Grid:** coluna única de formulário; seções de field
- **Seções (ordem):** section-header → grupos de field (field/select/checkbox/switch) → form-actions → alert/toast de feedback (13); importação: field de arquivo + estados loading/success/error (14)
- **Publicidade:** 0 · **Footer:** footer claro · **Sticky:** header
- **Sem imagem:** n/a (14 sem imagem; 13: 1 slot de avatar) · **Parcial:** campos opcionais marcados 'opcional'
- **Estados:** default · focus · invalid · success · loading · disabled · readonly · email-unverified(product-state)
- **Permitidos:** section-header, field, select, checkbox, radio, switch, textarea, password-input, form-actions, alert, toast, button, tabs, product-state
- **Proibidos:** card grid decorativo, placeholder como único label, criar telas autenticadas completas

### AuthTemplate
**Finalidade:** entrar/cadastrar (formulário centrado). **Telas:** 16.
- **Header:** default-light minimal · **Hero:** não · **Container:** coluna centrada ~420–480 · **Grid:** coluna única
- **Seções (ordem):** logo → título → field (email/senha) → form-actions (Entrar) → link secundário → ad-slot → footer minimal
- **Publicidade:** 1 leaderboard · **Footer:** footer claro (minimal) · **Sticky:** —
- **Sem imagem:** n/a · **Parcial:** n/a
- **Estados:** default · focus · invalid · loading · error
- **Permitidos:** field, password-input, form-actions, button, link, ad-slot, alert
- **Proibidos:** hero de imagem, fundo escuro estrutural, dado fictício de conta

### AdScreenTemplate
**Finalidade:** superfícies de publicidade (pop-up e interstitial) — não são telas de produto plenas. **Telas:** 17, 18.
- **Header:** não (overlay) / minimal · **Hero:** não · **Container:** overlay centrado (17) / full-bleed interstitial (18) · **Grid:** slot único
- **Seções (ordem):** ad-slot (rectangle/pop 17; billboard/interstitial 18) + botão fechar (icon-button) + rótulo PUBLICIDADE
- **Publicidade:** 1 cada (17 e 18) · **Footer:** não · **Sticky:** —
- **Sem imagem:** sem criativo→ad-slot unavailable (espaço reservado) · **Parcial:** n/a
- **Estados:** filled · placeholder · unavailable · closing
- **Permitidos:** ad-slot, icon-button, modal, product-state
- **Proibidos:** parecer conteúdo editorial, anunciante fictício

### DevOverlayTemplate
**Finalidade:** switcher de protótipo — DEV ONLY, remover no build de produção. **Telas:** 01.
- **Header:** não · **Hero:** não · **Container:** overlay · **Grid:** lista de rotas
- **Seções (ordem):** lista de flags/rotas do protótipo
- **Publicidade:** 0 · **Footer:** não · **Sticky:** —
- **Sem imagem:** n/a · **Parcial:** n/a
- **Estados:** open
- **Permitidos:** button, link
- **Proibidos:** ir para produção, z-index de produto

