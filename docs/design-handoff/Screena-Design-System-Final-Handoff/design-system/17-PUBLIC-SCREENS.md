# 17 — Public Screens (D4A)

As **18 telas públicas** confirmadas contra `screen-inventory.json` + `paginas/01–18` + canônico. Soma exata: **18**. Não há tela inventada nem renomeada sem registro.

| ID | Tela | Arquivo | Rota | Tipo/Contexto | Template | Logo | Ads | ImgSlots | Prioridade |
|---|---|---|---|---|---|---|---|---|---|
| 01 | Switcher (overlay) | paginas/01-switcher-open.html | — | dev | DevOverlayTemplate | n/a | 0 | 0 | P3 |
| 02 | Home | paginas/02-*.html | /pt | neutro | HomeTemplate | neutro | 4 | 8 | P0 |
| 03 | Notícias | paginas/03-*.html | /pt/noticias | noticia | NewsIndexTemplate | neutro | 6 | 0 | P1 |
| 04 | Categoria (Filmes/Séries) | paginas/04-*.html | /pt/filmes,/pt/series | filme|serie | HomeTemplate | cinema vermelha | 0 | 0 | P0 |
| 05 | Artigo | paginas/05-*.html | /pt/noticias/[slug] | noticia | ArticleTemplate | neutro | 1 | 0 | P1 |
| 06 | Detalhe de Filme | paginas/06-*.html | /pt/filmes/[slug] | filme | MovieDetailTemplate | cinema | 0 | 9 | P0 |
| 07 | Detalhe de Série | paginas/07-*.html | /pt/series/[slug] | serie | SeriesDetailTemplate | serie | 0 | 10 | P0 |
| 08 | Série (mobile) | paginas/08-*.html | /pt/series/[slug] @390 | serie | SeriesDetailTemplate | serie | 0 | 3 | P1 |
| 09 | Pessoa | paginas/09-*.html | /pt/pessoas/[slug] | pessoa | PersonDetailTemplate | neutro | 1 | 0 | P1 |
| 10 | Onde assistir (Browse) | paginas/10-*.html | /pt/onde-assistir | neutro | CatalogBrowseTemplate | neutro | 2 | 0 | P1 |
| 11 | Explorar (Discover) | paginas/11-*.html | /pt/explorar | neutro | ExploreTemplate | neutro | 1 | 7 | P1 |
| 12 | Mais aguardados | paginas/12-*.html | /pt/em-breve | neutro/misto | ExploreTemplate | neutro | 0 | 1 | P2 |
| 13 | Configurações | paginas/13-*.html | /pt/configuracoes | neutro | SettingsTemplate | neutro | 0 | 1 | P1 |
| 14 | Importar dados | paginas/14-*.html | /pt/configuracoes/dados | neutro | SettingsTemplate | neutro | 0 | 0 | P2 |
| 15 | Listas | paginas/15-*.html | /pt/listas | neutro/misto | CollectionTemplate | neutro | 3 | 0 | P1 |
| 16 | Entrar | paginas/16-*.html | /pt/entrar | neutro | AuthTemplate | neutro | 1 | 0 | P1 |
| 17 | Anúncio · pop-up | paginas/17-*.html | — | publicidade | AdScreenTemplate | neutro | 1 | 0 | P3 |
| 18 | Anúncio · tela cheia | paginas/18-*.html | — | publicidade | AdScreenTemplate | neutro | 1 | 0 | P3 |

**Totais:** 18 telas · 21 ad slots · 39 image slots (template; loops rendem N).

## Notas
- **01 Switcher** é overlay de dev (P3) — removido no build de produção.
- **04 Categoria** reusa o HomeTemplate com bands condicionais e acento/logo por contexto (vermelho=filme, verde=série).
- **08 Série mobile** é a variante @390 do 07 (mesmo template).
- **17/18** são superfícies de publicidade, não telas de produto plenas (P3).
- **Temporada/Episódio** não são telas standalone — são **seções** do SeriesDetailTemplate. **Busca** é componente/drawer global, não tela. Documentado em `16-PAGE-TEMPLATES.md`.
- Logo contextual: esperada == encontrada em 100% (ver `screen-inventory.json`).
