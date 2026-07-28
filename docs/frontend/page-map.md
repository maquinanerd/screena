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

- `site-header.tsx` e `site-footer.tsx`: chrome textual mínimo.
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
