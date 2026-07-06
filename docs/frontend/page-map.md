# Mapa de páginas do Screen (contrato de nomenclatura e escopo)

> Documento operacional. **Antes de qualquer alteração visual, consulte este mapa.**
> Ele existe para evitar confusão de escopo: cada rota/tela tem um nome oficial e
> um propósito. Nunca trate uma tela como se fosse outra.

## Regra central

- **Nunca** tratar `Public Marketing Home v4` como `Public Catalog Index`. A home
  pública é uma superfície editorial/cinematográfica — não é uma listagem de catálogo.
- **Nunca** tratar um ajuste no `Home Hero Carousel` como autorização para reescrever
  a home inteira. O hero é um bloco dentro da home, não a home.
- Alteração visual em uma tela **não** autoriza mudar as outras.

## Telas / rotas oficiais

### Public Marketing Home v4
- **Rota:** `/pt`
- **Arquivo:** [`apps/web/app/pt/page.tsx`](../../apps/web/app/pt/page.tsx)
- **Referência de design:** `screena-white-cinematic-editorial-system/project/Screen Screens v4.dc.html`
- **Descrição:** home pública editorial/cinematográfica ("White Cinematic Editorial").
  Hero-carousel + seções de destaque com ritmo visual v4. **Não** é catálogo genérico.
  Só exibe dado real e honesto (sem ranking/nota/watchlist/botão de feature inativa).

### Public Catalog Index
- **Rotas:** `/pt/filmes`, `/pt/series`, `/pt/pessoas`, `/pt/noticias`
- **Descrição:** listagens/catálogos por entidade (portas de entrada). Aqui sim é
  grade de cards de catálogo.

### Entity Detail Pages
- **Rotas:** `/pt/filmes/[slug]`, `/pt/series/[slug]`, `/pt/pessoas/[slug]`
- **Descrição:** fichas internas de entidades (schema `Movie`/`TVSeries`/`Person`),
  com blocos editoriais, elenco e "onde assistir" quando houver dado licenciado.

### Home Hero Carousel
- **Onde:** componente **dentro** da `Public Marketing Home v4`
  ([`apps/web/app/_components/hero-carousel.tsx`](../../apps/web/app/_components/hero-carousel.tsx)).
- **Descrição:** apenas o bloco hero/carousel do topo da home (slides, dots,
  metadados, botões `Onde assistir`/`Ver ficha`). **Não** é a home inteira.

### User App Area
- **Rotas:** futuras/autenticadas (perfil, listas, watchlist, avaliação, importação).
- **Descrição:** ainda **não implementadas**. Nenhuma feature de usuário (watchlist,
  "Avaliar", "Marcar como assistido", "Adicionar à lista") deve aparecer como ativa
  em nenhuma superfície pública até existir de fato.

### Admin Area
- **Onde:** `apps/admin/*`, `apps/admin/scripts/*`, `services/*`.
- **Descrição:** scripts, ingestão, admin editorial e ferramentas internas. Nunca no
  caminho de render público.

## Fontes de dado por camada (resumo)

- **TMDB** = base canônica de entidade (filme/série/pessoa, título, sinopse, ano,
  imagens, elenco, crew, gêneros, IDs externos). Consumido **só offline** (ingestão),
  nunca no render.
- **Streaming Availability / ratings externos** = camadas futuras (enriquecimento),
  persistidas no banco; nunca chamadas no render.
- **Render público** lê **apenas** PostgreSQL/cache local (invariantes 3 e 4).
