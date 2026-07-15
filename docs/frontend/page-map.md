# Mapa de páginas do Screen (contrato de nomenclatura e escopo)

> Documento operacional. **Antes de qualquer alteração visual, consulte este mapa.**
> O estado descrito aqui é o shell público neutro criado pelo reset de julho de 2026. Ele não é o design final e não autoriza inventar uma nova direção visual.

## Regra central

- O frontend público está deliberadamente reduzido a fundo branco, texto preto,
  navegação real e conteúdo textual persistido.
- A próxima direção visual deve vir dos arquivos canônicos aprovados do Claude
  Design, em outra PR e com port fiel. Não reconstruir hero, cards, anúncios ou
  chrome por interpretação.
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

## Fontes de dado por camada

- **TMDB:** base canônica de entidade, consumida somente por ingestão offline.
- **Ratings/streaming externos:** enriquecimento offline persistido; o render só
  vê dados aprovados pelos gates aplicáveis.
- **Entity Writer/Gemini:** geração offline de blocos versionados e revisáveis.
- **Render público:** apenas PostgreSQL/cache local; zero API externa e zero
  Gemini no render.

## Próxima fase visual

O port do Claude Design deve ocorrer em uma PR própria. Antes de escrever CSS ou
componentes, registrar a fonte canônica, mapear cada seção para os contratos acima
e provar que a implementação não introduz dados, CTAs ou funcionalidades falsas.
