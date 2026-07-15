# Relatório do reset da camada visual pública

- Data: 14 de julho de 2026
- Branch: `chore/audit-and-reset-public-design`
- Base: `origin/main` (`df0a89c`)
- Commit visual: `f242708 chore(web): reset public visual layer to blank shell`

## Resultado

A camada visual pública do Screen foi reduzida a um shell branco, textual e
deliberadamente provisório. O produto continua vivo: rotas, dados, getters,
presenters, canonical, robots, sitemap, redirects, JSON-LD, H1, gates de licença e
estados editoriais foram preservados.

Este trabalho não portou nenhum pacote visual existente e não criou uma direção
visual substituta. O estado resultante deve permanecer como base limpa e
verificável até que o design público final seja fornecido.

O inventário completo anterior ao reset está em
[`SITE_BACKEND_API_PRODUCT_AUDIT_BEFORE_DESIGN_RESET.md`](./SITE_BACKEND_API_PRODUCT_AUDIT_BEFORE_DESIGN_RESET.md).

## O que foi removido ou neutralizado

### CSS e composição

- `globals.css` caiu de mais de 4 mil linhas para 314 linhas de reset, tipografia,
  acessibilidade, container e estruturas textuais mínimas.
- Sete CSS Modules cinematográficos foram removidos: categoria, explorar, filme,
  série, pessoa, índice de notícias e artigo.
- Saíram gradientes, sombras, posters/backdrops renderizados, grids finais, rails,
  animações, chrome hero-aware, placeholders decorativos e estilos de anúncio.

### Componentes puramente visuais

Foram removidos:

- `ad-slot.tsx`;
- `cast-strip.tsx`;
- `category-home.tsx`;
- `certification-badge.tsx`;
- `coming-soon-rail.tsx`;
- `entity-card.tsx`;
- `hero-carousel.tsx`;
- `news-card.tsx`;
- `rating-stars.tsx`;
- `related-news-section.tsx`;
- `screen-logo.tsx`;
- três inventários/helpers exclusivamente visuais de anúncios, imagens e
  placeholders.

Os respectivos testes de port cinematográfico/inventário foram substituídos por
contratos do shell público. Presenters e getters de dados permaneceram no repo,
mesmo quando seus nomes históricos ainda mencionam “hero” ou “card”.

### Affordances e conteúdo fictício

- Header: somente marca textual `Screen` e links reais para Filmes, Séries,
  Pessoas, Notícias e Explorar.
- Footer: marca, os mesmos links reais e atribuição do TMDB; sem newsletter,
  redes sociais ou links institucionais inexistentes.
- `/dev/movie-page-preview/`: continua sendo uma rota técnica `noindex`, mas não
  contém mais ficha, entidade ou JSON-LD fictício.
- Nenhuma busca, watchlist, avaliação, login, anúncio ou CTA inexistente foi
  introduzido.

## O que foi preservado

Nenhum arquivo de `packages/`, `services/`, `api-clients/`, `packages/db/`,
`apps/web/src/server/`, migrations, schema Prisma ou workers foi alterado pelo
commit visual.

Continuam intactos:

- PostgreSQL, Prisma, migrations e seeds;
- ingestão TMDB e sincronização offline;
- clients e pipelines de ratings/streaming;
- cache e logs de API;
- Entity Writer/Gemini offline;
- slugs, aliases e redirects canônicos;
- getters server-only e presenters puros;
- gates `display_allowed`, licença e estado editorial;
- `screen_score`, `external_ratings` e `watch_availability`;
- sitemap, robots, middleware, canonical e metadados;
- schemas JSON-LD e diferenciação textual filme/série;
- testes de governança e pureza de render.

## Estado das rotas públicas

| Rota                  | Shell atual                                      | Dados/contrato preservado                                                                                     |
| --------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `/`                   | redirect de locale existente                     | middleware e destino `/pt/` intactos                                                                          |
| `/pt/`                | H1, descrição, navegação e listas textuais reais | quatro getters locais, canonical, robots, indexabilidade, `Organization` e `WebSite`                          |
| `/pt/filmes/`         | lista textual ou empty state                     | `getMovieIndexData`, `CollectionPage` e breadcrumb                                                            |
| `/pt/filmes/[slug]`   | ficha textual                                    | getter, redirect canônico, metadata, `Movie`, breadcrumb, conteúdo revisado, elenco, notícias e watch gateado |
| `/pt/series/`         | lista textual ou empty state                     | `getSeriesIndexData`, `CollectionPage` e breadcrumb                                                           |
| `/pt/series/[slug]`   | ficha textual com temporadas                     | getter, query `temporada`, âncoras, redirect, `TVSeries`, conteúdo revisado, elenco, notícias e watch gateado |
| `/pt/pessoas/`        | lista textual ou empty state                     | `getPersonIndexData`, `CollectionPage` e breadcrumb                                                           |
| `/pt/pessoas/[slug]`  | biografia/ficha textual                          | getter, redirect, `Person`, identidade externa, créditos e notícias                                           |
| `/pt/noticias/`       | lista textual ou empty state                     | getter, indexabilidade, `CollectionPage`, `ItemList` e breadcrumb                                             |
| `/pt/noticias/[slug]` | artigo textual                                   | getter, estado editorial, canonical, `NewsArticle` e breadcrumb                                               |
| `/pt/explorar/`       | links reais e agenda persistida                  | canonical, robots, `CollectionPage` e breadcrumb                                                              |
| `/sitemap.xml`        | implementação inalterada                         | presenter e fallback existentes                                                                               |
| `/robots.txt`         | implementação inalterada                         | regras e sitemap canônico existentes                                                                          |

Todas as páginas tocadas mantêm exatamente um H1 no contrato de render. Filme e
série continuam diferenciados por label/badge, breadcrumb, URL e schema — não só
por cor.

## Arquivos alterados

As mudanças de aplicação ficaram limitadas a:

- `apps/web/app/globals.css`;
- componentes visuais em `apps/web/app/_components/`;
- páginas em `apps/web/app/pt/` e o preview técnico;
- `apps/web/src/lib/navigation.ts` e três helpers exclusivamente visuais removidos;
- testes de contrato/governança diretamente ligados ao frontend público.

Este commit documental também atualiza `docs/frontend/page-map.md` e
`apps/web/public/brand/README.md` para que não apontem para componentes removidos.

## Validações executadas

Os checks obrigatórios rodaram com Node `22.23.1` e pnpm `9.15.4`:

| Comando                                     | Resultado                                                  |
| ------------------------------------------- | ---------------------------------------------------------- |
| `corepack pnpm typecheck`                   | passou                                                     |
| `corepack pnpm lint`                        | passou                                                     |
| `corepack pnpm test`                        | passou: 163 arquivos, 1.682 testes                         |
| `corepack pnpm audit:invariants`            | passou: 0 violações                                        |
| `corepack pnpm audit:render`                | passou: 0 violações                                        |
| `corepack pnpm --filter @screena/web build` | passou; todas as rotas esperadas constam do manifesto Next |
| `git diff --check`                          | passou                                                     |

O host disponibilizava Node 24.14.0; por isso os checks finais foram executados com
um runtime Node 22 transitório, sem alterar o repositório.

### Validação descartável com PostgreSQL real efêmero

Nenhuma API externa, Gemini ou banco remoto foi chamado. Os validadores criaram
PostgreSQL 16 local temporário, aplicaram as migrations existentes, leram os mesmos
getters do render e removeram a instância ao final.

| Validador                 | Resultado funcional |
| ------------------------- | ------------------- |
| `validate:news-pages`     | 19/19               |
| `validate:entity-indexes` | 19/20               |
| `validate:movie-page`     | 25/27               |
| `validate:series-page`    | 24/26               |
| `validate:person-page`    | 24/26               |

As sete asserções restantes não indicam regressão do reset: elas ainda esperam a
política antiga “página fina = noindex”. O getter retorna `index`, como exige a
política canônica atual de indexação total no `CLAUDE.md`. Esses scripts devem ser
alinhados em uma contribuição própria; este reset não restaurou a regra obsoleta.

### Smoke HTTP

Não foi iniciado um servidor HTTP com dados artificiais: não havia PostgreSQL local
durável configurado e a tarefa proíbe criar/promover dados fake ou rodar seeds com
`--apply`. A cobertura usada foi o manifesto do build, os contratos de rota/SEO e
os validadores com PostgreSQL efêmero. Nenhum status HTTP foi alegado sem teste.

## Riscos e pendências deliberadamente fora do escopo

- Os gaps técnicos registrados na auditoria 360 (indexabilidade persistida,
  atribuição/licença de streaming, documentação operacional e outros) não foram
  corrigidos nesta PR visual.
- Validadores descartáveis ainda contêm asserções da política anti-thin antiga.
- A interface não busca acabamento estético; ela é propositalmente neutra.
- Nenhum pacote visual existente foi copiado nem portado para este reset.

## Estado de espera

O design público final ainda não foi fornecido. O repositório deve permanecer neste
shell até existir material canônico aprovado e um novo escopo humano explícito. Só
então uma PR visual própria poderá partir desta base, mapear cada seção aos contratos
de dados existentes, manter render puro e não inventar notas, disponibilidade,
ações de usuário, conteúdo ou links.
