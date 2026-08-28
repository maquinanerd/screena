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

### Title Media Galleries

- **Rotas:** `/pt/filmes/[slug]/imagens/`, `/pt/filmes/[slug]/videos/`,
  `/pt/series/[slug]/imagens/`, `/pt/series/[slug]/videos/`.
- **Estado atual:** grade de pôsteres/cenas/stills/logotipos e lista de
  trailers/teasers/bastidores, com **contagem real** no topo e composição por
  tipo e por idioma. Tudo de `tmdb_images`/`tmdb_videos`; nenhuma imagem ou
  vídeo é inventado.
- **PISO DE PÁGINA FINA:** **4 imagens** e **2 vídeos**. Abaixo disso a página
  RESPONDE (o conteúdo existe) mas recebe `noindex` e **não entra no sitemap**.
  É o caso técnico da invariante 5 — a entidade dona continua indexando.
  Os dois pisos vivem em `apps/web/src/lib/gallery-presenter.ts` e são os
  MESMOS que o sitemap usa no `HAVING`.
- **Licença:** imagem passa pelo gate de `source_licenses` (`tmdb`/`image`);
  vídeo é gated por LINHA (`tmdb_videos.display_allowed`).
- **Nada de terceiro carrega antes do clique:** a lista de vídeos não usa
  miniatura do YouTube (seria uma requisição ao Google no render) — o fundo do
  cartão é um backdrop do TMDB, e o player é o `TrailerModal` da PR #174.
- **Contrato preservado:** slug canônico com redirect 301, canonical
  autorreferente, `BreadcrumbList` + `mainEntity` (`Movie`/`TVSeries`), e a
  diferenciação filme/série por label + badge + breadcrumb + schema + URL.

### Person Photo Gallery

- **Rota:** `/pt/pessoas/[slug]/fotos/`. (A **tira** de 4 fotos vive na ficha,
  em `Entity Detail`; esta é a página inteira.)
- **Estado atual:** grade de retratos (`tmdb_images` com
  `entity_type='person'`, `image_type='profile'`), com contagem real no topo e
  composição por idioma. Nenhuma foto é inventada.
- **DOIS GATES, e é a diferença para a galeria de título:** a foto de pessoa é
  promovida por **LINHA** (`display_allowed` + `license_status` em
  `official`/`licensed`, escritos por `promote:media --target=person-photo`)
  **e** passa pela licença da **FONTE** (`source_licenses` `tmdb`/`image`).
  A imagem de título só tem o segundo, porque não há linha para promover.
- **PISO DE PÁGINA FINA:** **5 fotos** — e ele é DERIVADO da tira
  (`PERSON_PHOTOS_STRIP_LIMIT + 1`), não escrito à mão. Com 4 ou menos, a
  galeria mostraria exatamente o que a ficha já mostra: `noindex`, e a ficha
  nem oferece o link. A entidade dona continua indexando.
- **A ausência FALA:** sem foto exibível, a tira da ficha não renderiza **e**
  emite `section_absent` com `section: "fotos"`. O motivo é derivado do estado
  do catálogo — `no_licensed_person_photo` (nada promovido em lugar nenhum;
  `actionable: true`) vs `no_photo_for_person` (há foto em outras pessoas, não
  nesta; `actionable: false`).
- **Badge NEUTRO:** pessoa não participa da distinção filme/série da invariante
  11, então não recebe acento vermelho nem verde.
- **Contrato preservado:** slug canônico com redirect 301, canonical
  autorreferente, `BreadcrumbList` + `mainEntity` (`Person`). Fora do sitemap,
  como as galerias de título.
- **Escopo:** são páginas de MÍDIA de um título. Não são índice de catálogo,
  não listam outros títulos e não substituem a banda de mídia da ficha.

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
- `footer-newsletter.tsx`: `<form>` real do rodapé, **atrás da flag
  `CINERIE_NEWSLETTER_ENABLED`** (desligada por default). Sem armazenamento de
  inscrição, a faixa não renderiza — um formulário que nunca consegue ter sucesso
  é pior que ausência. A ausência é logada (`newsletter_storage_unavailable`,
  `actionable: true`), e a rota `/api/newsletter` continua respondendo `503`
  honesto. O que destrava a flag está em [`newsletter.md`](./newsletter.md).
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

#### Trailer: botão gateado por licença

- O card ganha um botão de play **só quando existe trailer exibível**. Hoje isso
  é `null` para todo mundo: `tmdb_videos` nasce `display_allowed = false` e
  `services/legal/src/authorization-spec.ts` **não tem entrada de licença para
  vídeo** do TMDB — só para metadados e imagens. Sem trailer, o card fica
  exatamente como está, sem botão e sem espaço reservado.
- O gate está em `apps/web/src/lib/trailer-presenter.ts` e tem **cinco**
  condições, não uma: `display_allowed`, licença fora de `unknown`/`blocked`,
  `site = YouTube`, tipo em `Trailer`/`Teaser`, e chave de 11 caracteres.
- O player é **um só no site** (`app/_components/youtube-frame.tsx`), usado pelo
  modal de trailer e pelo bloco `embed` do corpo de matéria. A política da URL
  (domínio `youtube-nocookie`, zero query, formato do id) vive em
  `src/lib/youtube-embed.ts` — um lugar, não dois.
- **Nada de terceiro carrega antes de um clique.** No trilho, o clique em
  "Assistir ao trailer" é o disparo (o modal, e portanto o player, só existe
  depois dele). Na matéria, o embed é um cartão de ativação. É disso que o §6 da
  política de privacidade publicada depende — e foi por isso que a política
  ganhou o item 6.1 nesta frente.

Provado por `tests/web/upcoming-rail-by-route.test.ts` (fiação por rota),
`tests/web/home-upcoming-presenter.test.ts` (presenter puro + mistura) e
`apps/web/app/_components/__tests__/home-like-upcoming.test.tsx` (texto visível
no card renderizado + ausência e log na mesma asserção),
`tests/web/trailer-gate-and-embed.test.ts` (gate condição por condição + política
da URL) e, num DOM real (`jsdom`),
`apps/web/app/_components/__tests__/trailer-modal.test.tsx` e
`youtube-facade.test.tsx` (foco, ESC, fundo, devolução de foco, e a asserção
negativa de que nenhum endereço do YouTube existe antes do clique).

### "Em alta" e "Popular essa semana": rótulo que afirma janela TEM janela

Três superfícies afirmavam um recorte de tempo e ordenavam por
`movies.popularity`, que é **acumulada** — um número sem janela nenhuma. Desde
2026-08-21 as três leem `discovery_snapshots`, capturado offline pela fila
`trending` do agendador (6 h, 4 requisições por ciclo).

| Superfície | Rótulo visível | Janela | Getter |
| --- | --- | --- | --- |
| Faixa da home | **"Filmes em alta"** | `trending/day` | `getHomeCatalogData()` |
| Banda escura (home, filmes, séries) | **"Popular essa semana"** — abas *Filmes* e *Séries* | `trending/week` | `loadPopularRanking()` |
| `/pt/explorar/` | **"Em Alta"** | `trending/day` | `getDiscoverData()` |

- **As abas que NÃO mudaram** continuam com o critério próprio: *Clássicos*
  (estreia até 1999 + volume mínimo de votos), *No ar* (episódio na janela de 7
  dias), *Novas temporadas* (estreia de temporada na janela), *Streaming* (oferta
  licenciada), *Em cartaz*/*Cinema* (vazias — o fato "sessão numa sala" não
  existe no modelo de dados). Elas nunca afirmaram a janela que não tinham.
- **`day` e `week` não colapsam.** São duas capturas distintas e respondem
  perguntas distintas: "o que explodiu hoje" e "o que sustentou a semana". Reusar
  uma pela outra reintroduz a mentira com outro nome.
- **NUNCA há fallback para popularidade.** Snapshot vazio ⇒ a seção declara a
  ausência; ela não é completada com títulos não-trending. Um título fora da
  lista sob um rótulo que afirma a lista é a mesma mentira em letra miúda.
- **A ausência tem TRÊS causas e elas não colapsam**, porque pedem ações
  diferentes: `no_trending_snapshot` (a fila nunca rodou — ligue),
  `trending_snapshot_expired` (a fila parou — descubra por quê; o alerta de fila
  parada do agendador já deve estar gritando) e `no_trending_overlap` (a captura
  veio cheia, mas o que está em alta no mundo ainda não está no nosso catálogo —
  não há o que fazer na ingestão, some conforme a semente cresce).
- **O snapshot lido é o VIGENTE** (`expires_at > now`), nunca "o mais recente".
  Sem esse filtro, uma fila parada faria a tela exibir o que estava em alta na
  semana passada sob o rótulo "essa semana", para sempre.
- **`buildTrendingMovieCards` passou a fazer o que o nome diz.** Ele se chamava
  assim desde sempre e recebia ordem por popularidade acumulada.

Travado por `apps/web/src/server/__tests__/popular-rankings-queries.test.ts`
(prova sobre a CONSULTA, não sobre o markup) e por
`tests/governance/projection-has-consumer.test.ts`, que reprova quando uma tabela
de projeção não tem leitor onde ela foi feita para ser lida — o guard que teria
pegado `discovery_snapshots` escrita por meses sem nenhuma superfície.

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
