# Mapa de páginas da Cinerie (contrato de nomenclatura e escopo)

> Documento operacional. **Antes de qualquer alteração visual, consulte este mapa.**
> O estado descrito aqui é o shell público neutro criado pelo reset de julho de 2026. Ele não é o design final e não autoriza inventar uma nova direção visual.

## Regra central

- O frontend público está deliberadamente reduzido a fundo branco, texto preto,
  navegação real e conteúdo textual persistido.
- A próxima direção visual depende de arquivos canônicos ainda não fornecidos e
  de um novo escopo humano explícito. Até lá, não reconstruir hero, cards,
  anúncios ou chrome por interpretação.
- Uma alteração visual em uma rota não autoriza mudar contratos de dados, SEO,
  indexabilidade, licenças, schema, serviços ou outras rotas.
- “Zerar design” não significa “zerar produto”: getters, presenters, rotas,
  canonical, robots, sitemap e JSON-LD continuam sendo contratos ativos.

## Telas e rotas oficiais

### Public Home Shell

- **Rota:** `/pt/` (`/` redireciona para o locale publicado).
- **Arquivo:** [`apps/web/app/pt/page.tsx`](../../apps/web/app/pt/page.tsx)
- **Estado atual:** H1 institucional, descrição, navegação e listas textuais de
  conteúdo real. Sem hero visual, carrossel, cards, anúncios ou placeholders.
- **Contrato preservado:** getters PostgreSQL, metadata, canonical, robots,
  indexabilidade e JSON-LD `Organization` + `WebSite`.

### Public Catalog Index

- **Rotas:** `/pt/filmes/`, `/pt/series/`, `/pt/pessoas/`, `/pt/noticias/`.
- **Estado atual:** H1, descrição, breadcrumb e listas textuais de links reais,
  com empty state honesto.
- **Contrato preservado:** getters/presenters, canonical, robots e JSON-LD de
  coleção/breadcrumb quando já existiam.

### Entity Detail Pages

- **Rotas:** `/pt/filmes/[slug]`, `/pt/series/[slug]`, `/pt/pessoas/[slug]`.
- **Estado atual:** fichas textuais com fatos existentes, conteúdo editorial
  revisado, créditos, links externos e disponibilidade licenciada quando houver.
- **Contrato preservado:** slug canônico, redirects, metadata, canonical,
  robots, badges/labels por vertical e schemas `Movie`/`TVSeries`/`Person`.

### News Pages

- **Rotas:** `/pt/noticias/`, `/pt/noticias/[slug]`.
- **Estado atual:** índice e artigo em texto simples; nenhum artigo ou mídia é
  inventado.
- **Contrato preservado:** estados editoriais, getter local, canonical, robots,
  `CollectionPage`, `NewsArticle` e `BreadcrumbList`.

### Explore Shell

- **Rota:** `/pt/explorar/`.
- **Estado atual:** links para áreas reais e agenda semanal persistida, sem busca,
  filtro ou feature social fictícia.

### Technical Preview

- **Rota:** `/dev/movie-page-preview/`.
- **Estado atual:** página técnica mínima e `noindex`, sem ficha, entidade ou
  JSON-LD fictício. A rota existe apenas para preservar o contrato de URL.

### User App Area

- **Rotas:** futuras/autenticadas (perfil, listas, watchlist, avaliação,
  importação).
- **Estado:** não implementadas. Nenhuma feature de usuário deve aparecer como
  ativa na superfície pública até existir de fato.

### Admin Area

- **Onde:** `apps/admin/*`, `apps/admin/scripts/*`, `services/*`.
- **Descrição:** admin editorial e ferramentas offline. Nunca entram no caminho
  de render público.

## Componentes compartilhados atuais

- `site-header.tsx`: chrome textual mínimo.
- `site-footer.tsx`: **rodapé global escuro de 5 faixas** e o **único endereço do
  crédito de fonte** desde 13/08/2026 (decisão do proprietário). Ele não conhece
  nome de fonte: lê a projeção de `services/legal`. Antes de mexer, ler
  [`FOOTER-SPEC.md`](./FOOTER-SPEC.md) §4 e §10 — as divergências entre a spec e
  o implementado estão registradas lá, com o motivo de cada uma.
- `footer-newsletter.tsx`: `<form>` real do rodapé. A rota `/api/newsletter`
  responde `503` honesto (não há armazenamento de inscrição); ela nunca finge
  sucesso.
- `entity-index.tsx`: lista textual e schemas de coleção/breadcrumb.
- `entity-external-ids.tsx`: identidade externa real, sem rating implícito.
- `watch-availability-panel.tsx`: ofertas legais já filtradas pelo gate; nenhum
  client externo no render.

Os antigos componentes de hero, cards, anúncios, rails, logo inline e inventários
visuais foram removidos no reset. Não trate seus nomes históricos em presenters ou
getters preservados como autorização para recriá-los.

### Contrato de navegação global (header/rodapé)

Fonte única: [`apps/web/src/lib/navigation.ts`](../../apps/web/src/lib/navigation.ts).

- **Menu primário** (header, nesta ordem, tela 02 do canônico):
  `Início · Filmes · Séries · Listas · Notícias · Onde assistir`.
- **Secundário** (`SECONDARY_NAV_ITEMS`): `Pessoas` e `Explorar` — rotas reais que
  ficam fora do header e continuam navegáveis pelo rodapé e pelo menu mobile.
- O item ativo é marcado por `aria-current="page"` **e** por um sublinhado com o
  acento do contexto (neutro/filme = vermelho da marca, série = verde). A cor é
  reforço: nunca é o único sinal (invariante 11).
- Sobre hero, o header é **transparente de verdade** — quem escurece o topo é o
  `hero__scrim-v`. Rota de hero sem hero renderizado volta ao estado sólido.
- Tirar um destino do menu primário nunca pode transformá-lo em link morto:
  `tests/web/public-navigation.test.ts` prova que toda rota de `NAV_ITEMS` e
  `SECONDARY_NAV_ITEMS` existe e aparece no rodapé/menu mobile.
- **O rodapé deixou de espelhar `navigation.ts` em 13/08/2026.** Ele tem colunas
  próprias em [`apps/web/src/config/footer.ts`](../../apps/web/src/config/footer.ts)
  (5 colunas da `FOOTER-SPEC.md`). A regra "só rota real" não afrouxou — ficou
  mais forte: o mesmo teste exige que **todo** href do rodapé resolva para um
  arquivo de rota e que **nenhum href se repita** (a repetição sob rótulos
  diferentes era o defeito dos 12 rótulos removidos, registrado na auditoria).

### Acentos: dois contratos DIFERENTES

Nunca use uma variável só para header e hero. São eixos distintos:

| Superfície | Segue | Home (`/pt/`) |
| --- | --- | --- |
| Sublinhado do item ativo do menu | a **ROTA** (`data-context` do header, derivado do pathname) | sempre **vermelho** da marca, mesmo com slide de série |
| Indicador do carrossel | o **SLIDE** (`data-vertical` de cada dot) | vermelho em filme, **verde** em série |

Provado nos dois sentidos ao mesmo tempo pelos checks C1/C2 de
`pnpm --filter @screena/web qa:home-fold` (app Next real + PostgreSQL real).

### Primeira dobra: duas seções com contratos DIFERENTES

Nunca trate as duas como a mesma coisa — a confusão entre elas foi exatamente o
defeito corrigido em
[`home-editorial-highlights-and-ticker-carousel.md`](./home-editorial-highlights-and-ticker-carousel.md).

| Seção | O que consome | Destino dos links | Controles |
| --- | --- | --- | --- |
| **Faixa amarela** (`HomeTicker`) | 4 fontes de catálogo: `episodes.air_date`, `movies.release_date`, `seasons.air_date`, `watch_availability.available_from` | ficha real (`/pt/filmes/…`, `/pt/series/…`) | dots = carrossel de 4–5 novidades, 1 visível por vez |
| **Destaques de hoje** (`HomeEditorialHighlights`) | cadeia EDITORIAL: `articles` + `article_translations` + `entity_news_links` | **sempre** `/pt/noticias/{slug}/` | `Filmes`/`Séries` = **tabs**, nunca navegação |

- "Destaques de hoje" **não é catálogo**: nenhum pôster de entidade, nenhuma
  metadata de ficha (`Filme · 2026`, nota, duração, temporada) entra nesses cards.
- A vertical de uma matéria vem dos **vínculos persistidos** em
  `entity_news_links` (`movie`/`tv`), nunca de palavra-chave no título nem de
  `articles.category` — esse campo é texto livre sem vocabulário controlado e
  serve apenas como eyebrow exibido.
- A faixa **nunca** exibe sessão de cinema, formato (70mm), idioma, rede ou
  horário: o sistema não persiste esses fatos. "Em cartaz" não é inferido de
  `release_date`.

### "Em breve": a MESMA seção, três datasets

O trilho `.glimpse-rail` vive no template compartilhado
[`HomeLike`](../../apps/web/app/_components/home-like.tsx) e aparece nas **três**
superfícies home-like. O que muda é só o dataset:

| Rota | Getter | Dataset | Log de ausência (`vertical`) |
| --- | --- | --- | --- |
| `/pt/` | `getHomeUpcomingMixed()` | filmes **+** séries, cota equilibrada | `mixed` |
| `/pt/filmes/` | `getHomeUpcomingMovies()` | só `Movie.releaseDate` futura | `movie` |
| `/pt/series/` | `getHomeUpcomingSeries()` | só `TvShow.firstAirDate` futura | `series` |

- A home tem **duas ordenações diferentes** e ambas importam: **seleção** por
  cota (3 filmes + 3 séries em 6 vagas; vertical vazia devolve as vagas para a
  outra) e **exibição** por estreia ascendente. Ordenar só por data devolveria
  seis filmes sempre que a fila de filmes fosse mais densa — era o estado
  anterior da home.
- `Season.airDate`/`Episode.airDate` **não** entram neste trilho: temporada e
  episódio futuros de uma série já no ar são a agenda, e têm superfície própria
  em `/pt/em-breve/` (`getAnticipatedData`).
- O card **nunca** distingue filme de série só pela cor (invariante 11): o badge
  carrega o texto "Filme"/"Série", a URL já diverge (`/pt/filmes/` vs
  `/pt/series/`) e o bookmark grava `movie` vs `tv`. O acento é reforço.
- **Piso de 4 itens** (`HOME_UPCOMING_MIN`): abaixo disso o trilho não
  renderiza. Um carrossel com 1 ou 2 cards não é carrossel, e a sangria à
  direita promete conteúdo que não existe. Na home o piso vale para a
  **mistura**, não para cada vertical: 2 filmes + 2 séries acendem o trilho.
- Trilho ausente **não some calado**: passa por `SectionBoundary` com
  `section: 'em-breve'`, a rota/vertical consultadas e a contagem real. Os dois
  estados têm motivos **diferentes** — `no_upcoming_title` (zero, a ingestão não
  cobriu) e `below_upcoming_floor` (existe, mas abaixo do piso, `available`
  diz quanto). `/pt/series/` vazia e `/pt/series/` nunca ingerida são
  visualmente idênticas — só o log separa as duas.
- O piso mora numa função só (`hasEnoughUpcoming`), chamada pelo template **e**
  pela contagem de seções populadas da home. Se cada um aplicasse o seu próprio
  `>= 4`, a indexabilidade acabaria contando uma seção que não está na página.

Provado por `tests/web/upcoming-rail-by-route.test.ts` (fiação por rota),
`tests/web/home-upcoming-presenter.test.ts` (presenter puro + mistura) e
`apps/web/app/_components/__tests__/home-like-upcoming.test.tsx` (texto visível
no card renderizado + ausência e log na mesma asserção).

### QA visual da primeira dobra

São **dois** harnesses, com coberturas disjuntas:

- `qa:home-fold` — chrome, hero, Cinerie Score e provedor licenciado (PR #89);
- `qa:home-editorial` — seção editorial e carrossel da faixa amarela (esta PR).

`pnpm --filter @screena/web qa:home-fold` sobe um **PostgreSQL 16 efêmero**,
aplica migrations + seed, cria fixtures de QA, sobe a **aplicação Next real** e
mede a Home em 5 viewports. Requer `pnpm build` antes. Nunca toca produção:
a `DATABASE_URL` é sempre `127.0.0.1` num banco descartável, e o script aborta
se não for. A URL de **imagem** do CDN do TMDB é interceptada no browser e
servida por asset local — QA determinístico e offline.

## Fontes de dado por camada

- **TMDB:** base canônica de entidade, consumida somente por ingestão offline.
- **Ratings/streaming externos:** enriquecimento offline persistido; o render só
  vê dados aprovados pelos gates aplicáveis.
- **Entity Writer/Gemini:** geração offline de blocos versionados e revisáveis.
- **Render público:** apenas PostgreSQL/cache local; zero API externa e zero
  Gemini no render.

## Estado de espera visual

O design público final ainda não foi fornecido. Até existir uma fonte canônica
aprovada e um novo escopo humano explícito, este shell deve permanecer neutro e
nenhuma branch visual deve ser criada por antecipação. Quando esse material chegar,
a implementação deverá ocorrer em uma PR própria, mapear cada seção para os
contratos acima e provar que não introduz dados, CTAs ou funcionalidades falsas.
