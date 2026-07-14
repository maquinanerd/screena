# Divergências do port canônico cinematográfico

Este arquivo registra diferenças verificáveis entre o artefato canônico
`Screen Screens v4.dc.html` e o produto real. Uma divergência só pode sair
daqui depois de comparação visual ou de contrato.

## D-001 — Montserrat não acompanha o ZIP

- **Canônico:** importa Montserrat por Google Fonts e usa pesos 500, 600, 650,
  700, 750, 800 e 900.
- **Pacote:** não contém `.woff`, `.woff2`, `.ttf` ou `.otf`.
- **Produto:** auto-hospeda a Montserrat variável e a licença OFL para preservar
  os pesos intermediários sem rede no render.
- **Impacto visual esperado:** nenhum; deve ser confirmado por screenshot.
- **Motivo:** invariantes de pureza de render e build determinístico.

## D-002 — Descrição “SVG oficial” contradiz os assets

- **Canônico:** logo inline com quatro elementos `<text>` Montserrat e um
  `<rect>` no `viewBox="0 0 406 78"`.
- **Pacote:** todos os SVGs de logo em `uploads/` também contêm `<text>` e zero
  `<path>`, embora o prompt os descreva como “SVG oficial”. Algumas variantes
  ainda usam geometria diferente da raiz canônica.
- **Produto:** usa um componente SVG inline com as coordenadas do HTML de hash
  validado (`rect x=239 y=20 width=81 height=42`) e Montserrat auto-hospedada.
- **Impacto visual esperado:** nenhum no header/footer; URLs SVG de metadata
  ainda dependem da disponibilidade de Montserrat/fallback do visualizador.

## D-003 — Navegação canônica contém features não publicadas

- **Canônico:** `Início · Filmes · Séries · Listas · Notícias · Onde assistir`,
  mais `Entrar` e avatar.
- **Produto:** listas, conta e browse dedicado de streaming ainda não existem.
- **Produto portado:** preserva, na ordem, apenas os itens canônicos com produto
  real: `Início · Filmes · Séries · Notícias`; mantém Explorar no ícone de busca
  canônico e omite Listas, Onde assistir e ações de autenticação inexistentes. O
  cluster direito conserva o footprint desktop de 170 px para não deslocar a
  busca, sem criar controles invisíveis ou falsamente interativos.
- **Impacto visual:** o grupo central fica mais curto e contém quatro rótulos;
  comparar em 1.280/1.440 px.
- **Motivo:** não apresentar affordance morta ou prometer feature sem backend.

## D-004 — Newsletter ainda não possui backend

- **Canônico:** pseudoformulário visual no footer.
- **Produto:** não há cadastro de newsletter.
- **Produto portado:** em dev/preview preserva a composição canônica com
  elementos não interativos; em produção mostra informação honesta na mesma
  superfície, sem campo ou botão falsamente funcionais.
- **Impacto visual:** produção tem menos conteúdo dentro da faixa branca.

## D-005 — Runtime publicitário ausente

- **Canônico:** 23 posições descritas como Google AdSense.
- **Produto:** não há unidade, client ID nem autorização para carregar script
  publicitário externo.
- **Produto portado:** inventaria as 23 posições exatas — 15 leaderboards, 4
  billboards, 3 skyscrapers e 1 rectangle — com margem e hint de cada tela.
  Treze posições pertencem a superfícies reais ativas/condicionais; dez ficam
  diferidas junto com Browse, categorias de notícia, Listas, Entrar e formatos
  popup/interstitial. `AdSlot` modela as quatro dimensões sem carregar script; o
  placeholder tracejado aparece apenas em dev/preview.
- **Impacto visual:** em produção os slots ativos reservam espaço vazio até
  integração aprovada. Slots de telas sem produto real não aparecem no runtime,
  mas permanecem verificáveis no inventário canônico.

## D-006 — Dados mock do protótipo não entram em páginas indexáveis

- **Canônico:** arrays locais pintam ranking, agenda, plataformas, ações de
  usuário, listas, progresso e notícias de exemplo.
- **Contrato do próprio pacote:** mocks não são fonte real; seção sem dado deve
  ser omitida.
- **Produto portado:** preserva a posição/estrutura condicional, mas só renderiza
  conteúdo persistido e permitido pelos presenters atuais.
- **Impacto visual:** ambientes sem catálogo/editorial suficiente podem exibir
  menos seções que o screenshot do protótipo.

## D-007 — Inconsistências documentais internas do ZIP

- `paginas/README.md` informa zero slots em páginas que totalizam 31;
- `docs/implementacao-fiel-screen-v4.md` mede zero `x-import`, embora existam 31
  tags `<image-slot>`;
- a auditoria do pacote fala em sete backups, mas há seis;
- páginas `01`–`18` são semanticamente equivalentes após normalizar whitespace,
  porém só `paginas/00-principal-completo.html` é cópia byte-exata;
- `.image-slots.state.json` referencia `hero-common`, ausente do canônico;
- o caminho local escrito no prompt do ZIP está desatualizado.

Esses pontos não alteram a autoridade do HTML raiz validado por SHA-256.

## D-008 — Tagline global não promete disponibilidade universal

- **Canônico:** “Filmes, séries, pessoas, notícias e onde assistir — em um só
  lugar.”
- **Produto:** disponibilidade existe apenas quando há oferta BR persistida e
  licenciada; a governança proíbe a promessa genérica em componente global.
- **Produto portado:** “Filmes, séries, pessoas e notícias de entretenimento —
  em um só lugar.”
- **Impacto visual:** apenas a quebra de linha da frase; grid e tipografia
  permanecem idênticos.

## D-009 — Atribuição obrigatória ao TMDB permanece no rodapé

- **Canônico:** não mostra a atribuição ao TMDB no bloco inferior do footer.
- **Produto:** o catálogo e as imagens usam dados do TMDB e a atribuição pública
  já faz parte da governança do repositório.
- **Produto portado:** mantém a frase de atribuição imediatamente antes da linha
  inferior, com corpo de 10 px e dentro do mesmo container de 1.280 px.
- **Impacto visual:** acrescenta uma linha discreta e 18 px de margem antes do
  copyright; não altera o grid principal do footer.

## D-010 — Busca mobile não expande um campo inexistente

- **Contrato responsivo:** abaixo de 1.024 px, o ícone de busca deveria expandir
  um campo.
- **Produto:** ainda não possui busca por query; `/pt/explorar/` é um hub de
  descoberta, não um endpoint de resultados pesquisáveis.
- **Produto portado:** mantém o ícone canônico acessível em todas as larguras e o
  liga ao hub real, sem criar input, submissão ou promessa de busca falsa.
- **Impacto visual/comportamental:** o ícone não abre campo no header mobile;
  navegar por ele troca para a rota Explorar.

## D-011 — Destaque da home ainda é seleção determinística

- **Canônico:** `homePresenter.hero` representa um destaque curado.
- **Produto:** o getter existente seleciona até cinco títulos reais por ano,
  filmes antes de séries; não existe ainda uma tabela ou flag de curadoria da
  home.
- **Produto portado:** preserva o hero com dados reais e sem fallback visual,
  mas registra que a seleção ainda não é uma decisão editorial explícita. O H1
  institucional da home permanece estável e oculto; o título visual do slide
  ativo usa H2 para não trocar a entidade principal durante o autoplay.
- **Impacto visual:** nenhum na geometria; o título exibido pode diferir de uma
  programação editorial futura.

## D-012 — Faixas temporais dependem de sinais ainda incompletos

- **Canônico:** Top 10 semanal, Filmes em alta e Séries da semana.
- **Produto:** não possui ranking semanal nem histórico de sete dias. Filmes e
  séries guardam apenas o snapshot de `popularity` já ingerido do TMDB.
- **Produto portado:** usa esse snapshot somente em `Filmes em alta`, em ordem
  decrescente e sem repetir cards. Top 10 e Séries da semana permanecem nas
  posições condicionais do código, mas não geram DOM até existir dado temporal
  adequado. A faixa de estatísticas pessoais também fica ausente para anônimo.
- **Impacto visual:** ambientes atuais não exibem Top 10, estatísticas mensais
  nem a faixa semanal de séries.

## D-013 — “Em breve” possui lançamentos, não trailers

- **Canônico:** subtítulo “Trailers de próximos lançamentos” e pílula de duração.
- **Produto:** possui datas e imagens de filmes futuros persistidos, mas não
  possui trailer ou duração governados.
- **Produto portado:** mantém posição, rail, cards de 232 px e geometria 16:9;
  usa “Próximos lançamentos” e remove play/duração e ARIA de trailer.
- **Impacto visual:** a pílula sobre a thumbnail não aparece.

## D-014 — Notícias não possuem ranking, rail ou categorias navegáveis

- **Canônico:** o modo “Todas” combina magazine, dois cards de rail, “Mais
  lidas”, newsletter e três tabs; os modos Cinema/Séries têm layouts próprios.
- **Produto:** o CMS fornece destaque e feed publicável, mas não fornece métricas
  de leitura, rail editorial nem filtro/rota de categoria.
- **Produto portado:** reproduz header, magazine, três cards secundários, feed e
  os quatro AdSlots do modo “Todas”. Expõe apenas a tab `Todas`; rail, ranking,
  newsletter e modos de categoria ficam ausentes em vez de usar mocks.
- **Impacto visual:** a coluna canônica de 290 px continua reservada no desktop,
  mas vazia; a sidebar inferior contém apenas o skyscraper reservado. Em tablet,
  a coluna opcional some conforme o contrato responsivo.

## D-015 — Corpo do artigo é textual, sem blocos ricos do protótipo

- **Canônico:** artigo de demonstração contém headings internos, figura,
  legenda, tags, compartilhamento, ficha rica de uma série e quatro artigos
  relacionados.
- **Produto:** o presenter atual entrega parágrafos, fonte, aviso de IA e links
  simples para entidades relacionadas; não há AST de blocos, tags sociais nem
  artigos relacionados.
- **Produto portado:** mantém o hero radial de 560 px, sem criar o image-slot que
  a tela 05 não possui, além da coluna de leitura de 720 px, tipografia 17/1.8 e
  leaderboard intermediário. A imagem editorial continua apenas em metadata e
  Schema.org; links de entidades não substituem artigos relacionados.
- **Impacto visual:** figuras, ficha rica, tags/share e grid “Leia também” ficam
  ausentes até seus contratos existirem.

## D-016 — Categorias não simulam ranking, streaming ou trailer

- **Canônico:** a tela 04 combina hero editorial completo, Top 10, filtros por
  plataforma, ranking, próximos trailers e Top News.
- **Produto:** os índices possuem cards reais, nota própria apenas quando
  governada, notícias publicadas e datas futuras de filmes; não há ranking Top
  10, agregação de plataforma por categoria, trailer, classificação, direção ou
  elenco no contrato dos índices.
- **Produto portado:** não promove arbitrariamente o primeiro card do índice a
  hero ou ranking. Renderiza uma introdução pública honesta, próximos lançamentos
  somente em Filmes e Top News sem repetição. Não publica ItemList para cards que
  não aparecem na página. Os três AdSlots permanecem na ordem original e blocos
  sem fonte real não geram DOM.
- **Impacto visual:** hero, numeração Top 10, estrelas, filtros de streaming,
  ranking e CTA de trailer não aparecem. Quando blocos intermediários estão
  ausentes, dois espaços publicitários podem ficar consecutivos.

## D-017 — Explorar não finge busca, atividade pessoal ou sinais sociais

- **Canônico:** Browse/Discover/Mais Aguardados combinam busca funcional,
  filtros, plataformas, crescimento em 24 horas, progresso de reprodução,
  watchlist, contagens da comunidade e rankings sociais.
- **Produto:** não há endpoint de busca, sessão de usuário, histórico de
  reprodução, watchlist/comunidade, agregação de streaming para o hub nem rota
  dedicada de “Mais Aguardados”. Há catálogo real e filmes futuros com data
  persistida.
- **Produto portado:** instancia somente as partes sustentadas da tela Discover
  em `/pt/explorar/`: leaderboard, cabeçalho e agenda de lançamentos. Destaque e
  Em Alta ficam ocultos porque não existem curadoria nem sinal temporal; a rota
  possui estado vazio explícito. Browse e Mais Aguardados ficam diferidos;
  nenhum catálogo genérico, contador, rank, progresso, filtro ou ação falsa é
  exibido.
- **Impacto visual:** barra de busca, CTA de watchlist/trailer, Em Alta com
  crescimento, Continuar assistindo, Mais Aguardados e Populares não aparecem.

## D-018 — Superfícies autenticadas permanecem fora do app público

- **Canônico:** as telas 13–16 apresentam Configurações, Dados/importação,
  Listas e Entrar/cadastrar como produto funcional.
- **Produto:** ainda não existe autenticação pública, conta de usuário,
  preferências persistidas, importação de biblioteca ou CRUD de listas.
- **Produto portado:** não cria rotas, formulários, botões ou navegação que
  aparentem salvar dados sem backend. O inventário visual dessas telas continua
  no ZIP canônico e poderá ser portado quando seus contratos forem reais.
- **Impacto visual/comportamental:** essas quatro telas não estão acessíveis no
  runtime atual; nenhum fluxo falso ou dead-end foi adicionado.

## D-019 — Mídia usa elementos nativos com dimensões governadas

- **Canônico:** `<image-slot>` é um componente de protótipo; o inventário sugere
  substituí-lo por `next/image`, enquanto o guia principal também admite
  `<img>`.
- **Produto:** presenters já entregam URL validada, largura e altura intrínsecas;
  parte das imagens vem do CDN governado do TMDB e parte é local.
- **Produto portado:** usa `<img>` com `width`, `height`, `loading`, alt e
  `object-fit` explícitos, sem loader ou transformação adicional que altere o
  crop aprovado. Fallbacks preservam apenas os gradientes canônicos.
- **Impacto técnico:** a otimização automática do `next/image` não é aplicada;
  proporção, crop e layout permanecem controlados pelo CSS do port.

## D-020 — Content blocks só aparecem na seção semanticamente compatível

- **Canônico:** detalhe de filme/série/pessoa possui regiões específicas para A
  obra/biografia, crítica, disponibilidade, episódios, elenco e notícias.
- **Produto:** o enum genérico de `content_blocks` também contém FAQ, explicação
  de ratings e introdução de similares, mesmo quando a página não possui o
  consumidor visual ou os dados correspondentes.
- **Produto portado:** mapeia cada bloco revisado apenas para sua região
  compatível; não despeja FAQ ou texto de ratings sob “A obra”. Blocos sem
  consumidor real (`faq`, `ratings_explanation`, `similar_titles_intro` e tipos
  incompatíveis com a entidade) permanecem fora do DOM.
- **Impacto visual/editorial:** esses tipos aprovados só serão exibidos quando
  houver componente canônico e dados associados, evitando classificação
  editorial incorreta.

## D-021 — Slots de imagem sem contrato real permanecem diferidos

- **Canônico:** o HTML raiz declara 31 categorias de `<image-slot>` distribuídas
  entre filme, série desktop/mobile, Discover, Mais aguardados e Configurações.
- **Produto:** nem todas possuem mídia persistida ou uma superfície funcional;
  galeria, prêmios, recomendações, progresso do usuário e avatar autenticado não
  têm contrato suficiente nesta branch.
- **Produto portado:** inventaria as 31 categorias exatas e renderiza somente as
  16 ativas/condicionais alimentadas por presenters reais. As outras 15 ficam
  explicitamente diferidas, sem copiar URLs ou imagens fictícias do protótipo.
- **Impacto visual:** regiões sem mídia ou feature real são omitidas, preservando
  a ordem dos blocos restantes e evitando placeholders que pareçam conteúdo.
