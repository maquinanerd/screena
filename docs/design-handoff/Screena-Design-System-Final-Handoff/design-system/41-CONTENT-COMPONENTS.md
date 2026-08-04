# 41 — Content Components (D3C)

Componentes canônicos de conteúdo definidos sobre os primitivos + Button + tokens (D3A/D3B). **Nenhuma das 18 telas foi migrada** (migração = D4). Prova visual: `Components-Content-Forms-Feedback.dc.html`. Contratos: `component-contracts.json` (+77 D3C) e `data-visual-contracts.json`.

## Diagnóstico do canônico (real, sem estimativa)
Contagem por script sobre `Screen Screens v4.dc.html` (366.405 chars).

| Família | Instâncias | Assinaturas | Locais (páginas) | Compartilhada | Decisão |
|---|---|---|---|---|---|
| Mídia / Poster | **39 image-slots** (7 PÔSTER explícitos + demais data-driven; +backdrop/still/news/hero) | 2:3 · 16:9 · 3:4 | home, movie/series-detail, browse, discover | sim | CONSOLIDAR → MediaImage/Avatar |
| Publicidade | **21 ad-slots** | leaderboard 14 · skyscraper 3 · billboard 3 · rectangle 1 | 10 páginas | sim (já componentizado) | MANTER → AdSlot |
| Cards de filme/série | data-driven (`sc-for`/mk*) | poster+badge+título+meta | home, browse, discover, category | sim | CONSOLIDAR → Movie/SeriesCard |
| Hero | data-driven (75 menções) | backdrop+scrim+ações | home, detail, category, person | sim | CONSOLIDAR → 5 heroes |
| Rail | data-driven (26 menções; scroll 37) | trilho+controles | home, detail, discover | sim | CONSOLIDAR → ContentRail |
| Rating / Score | rating 141 · Cinerie Score presente | estrela · % · score | detail, cards | sim | CONSOLIDAR + 6 estados de Score |
| Streaming | Netflix 14 · Prime 10 · Max · Disney 6 · Apple TV+ 12 · “onde assistir” 8 | provider+modalidade | detail, discover | sim | CONSOLIDAR → StreamingAvailability |
| Temporada/Episódio | temporada 72 · episód 38 · season 37 | still+meta+sinopse | series-detail (+ mobile) | parcial | CONSOLIDAR → Season*/Episode* |
| Pessoas/Elenco | cast 30 · elenco 16 | retrato+nome+personagem | detail, person | sim | CONSOLIDAR → CastList/PersonCredits |
| Notícia/Artigo | news 77 · notícia 22 | imagem+headline+resumo | news, article, home | sim | CONSOLIDAR → News/Article* |
| Newsletter | 3 | e-mail+CTA | home/rodapé | sim | CONSOLIDAR → NewsletterCard |
| **Formulários** | **0 controles** (`<input>/<select>/<textarea>`=0) | — | nenhuma | — | **DEFINIR NOVO** |
| **Skeleton/Loading/Empty** | **0** | — | nenhuma | — | **DEFINIR NOVO** |
| **Modal/Drawer/Toast/Alert** | **0** (só `toggleSwitcher` de protótipo) | — | nenhuma | — | **DEFINIR NOVO** |

**Leitura:** o canônico é um protótipo **editorial estático** — rico em mídia/cards/hero/rating/streaming, mas **sem formulários e sem estados de carregamento/vazio/erro**. Estes últimos são **novos** no sistema (lacunas F-02 “Cinerie Score sem estado vazio” e F-03 da D2), definidos aqui como componentes reutilizáveis.

## Famílias definidas (77 componentes D3C)
- **Mídia (2):** MediaImage (poster/backdrop/portrait/still/news/editorial/gallery), Avatar.
- **Cards de entidade (5):** Movie, Series, Person, Season, Episode.
- **Cards editoriais (8):** News, Article, EditorialFeature, Horizontal, Compact, SearchResult, Recommendation, Related.
- **Hero (5):** Home, Entity, Article, Person, Compact.
- **Layout (4):** ContentRail, ContentGrid, MediaGallery, Carousel.
- **Metadata (4):** EntityTitle, EntityMetadata (Genre/Cert/Runtime/Release/Status/TechnicalFacts), CreatorCredits, EntityActions.
- **Rating (5):** CinerieScore (6 estados), ExternalRating, RatingSourceList, UserRating, RatingDistribution.
- **Streaming (3):** StreamingAvailability (Provider/Offer), RegionNotice, Unavailable.
- **Temporada/Episódio (5):** SeasonSelector, SeasonSummary, EpisodeProgress, EpisodeMetadata, EpisodeActions.
- **Pessoas (3):** CastList (CastMember/CharacterLabel), CrewList, PersonCredits.
- **Editorial/Artigo (8):** ArticleHeader (Byline/datas/ReadingTime), ArticleBody (PullQuote/FactBox/InlineMedia), SourceAttribution, CorrectionNotice, AIDisclosure, RelatedEntities, RelatedArticles, ArticleFooter.
- **Publicidade (1):** AdSlot (AdLabel/AdPlaceholder/AdUnavailable).
- **Newsletter (1):** NewsletterCard (Form/EmailInput/Submit/Success/Error/Privacy).
- **Formulários (9):** Field (Label/Input/Description/Error/Message), PasswordInput, SearchInput, Textarea, Select, Checkbox, Radio, Switch, FormActions.
- **Feedback/Overlays (13):** Alert, Toast, Modal, Drawer, Dropdown, Tooltip, Popover, ConfirmationDialog, EmptyState, ErrorState, LoadingState, Skeleton, OfflineState.
- **Estados de produto (1):** ProductState (15 estados reutilizáveis).

## Regras invioláveis
- Card não é `<div onClick>`: **link principal explícito** (título é `<a>`), sem links aninhados.
- **Label sem valor não aparece** (campo ausente omitido, nunca “N/D”).
- Fallback de mídia **não parece conteúdo real**; sem imagem inventada.
- Cinerie Score **nunca** confundido com nota externa; 6 estados honestos.
- Streaming **sem inventar** disponibilidade nem inferir por poster/trailer.
- Publicidade sempre rotulada, espaço reservado, nunca disfarçada de conteúdo.
