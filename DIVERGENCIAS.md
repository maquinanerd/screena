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
- **Produto portado:** modela as quatro dimensões e reserva as posições; o
  placeholder tracejado aparece apenas em dev/preview.
- **Impacto visual:** em produção o espaço existe, mas fica vazio até integração
  aprovada.

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

## D-012 — Destaque da home ainda é seleção determinística

- **Canônico:** `homePresenter.hero` representa um destaque curado.
- **Produto:** o getter existente seleciona até cinco títulos reais por ano,
  filmes antes de séries; não existe ainda uma tabela ou flag de curadoria da
  home.
- **Produto portado:** preserva o hero com dados reais e sem fallback visual,
  mas registra que a seleção ainda não é uma decisão editorial explícita.
- **Impacto visual:** nenhum na geometria; o título exibido pode diferir de uma
  programação editorial futura.

## D-013 — Faixas temporais dependem de sinais ainda incompletos

- **Canônico:** Top 10 semanal, Filmes em alta e Séries da semana.
- **Produto:** não possui ranking semanal nem histórico de sete dias. Filmes e
  séries guardam apenas o snapshot de `popularity` já ingerido do TMDB.
- **Produto portado:** usa esse snapshot somente em `Filmes em alta`, em ordem
  decrescente e sem repetir cards. Top 10 e Séries da semana permanecem nas
  posições condicionais do código, mas não geram DOM até existir dado temporal
  adequado. A faixa de estatísticas pessoais também fica ausente para anônimo.
- **Impacto visual:** ambientes atuais não exibem Top 10, estatísticas mensais
  nem a faixa semanal de séries.

## D-014 — “Em breve” possui lançamentos, não trailers

- **Canônico:** subtítulo “Trailers de próximos lançamentos” e pílula de duração.
- **Produto:** possui datas e imagens de filmes futuros persistidos, mas não
  possui trailer ou duração governados.
- **Produto portado:** mantém posição, rail, cards de 232 px e geometria 16:9;
  usa “Próximos lançamentos” e remove play/duração e ARIA de trailer.
- **Impacto visual:** a pílula sobre a thumbnail não aparece.

## D-015 — Notícias não possuem ranking, rail ou categorias navegáveis

- **Canônico:** o modo “Todas” combina magazine, dois cards de rail, “Mais
  lidas”, newsletter e três tabs; os modos Cinema/Séries têm layouts próprios.
- **Produto:** o CMS fornece destaque e feed publicável, mas não fornece métricas
  de leitura, rail editorial nem filtro/rota de categoria.
- **Produto portado:** reproduz header, magazine, três cards secundários, feed e
  os quatro AdSlots do modo “Todas”. Expõe apenas a tab `Todas`; rail, ranking,
  newsletter e modos de categoria ficam ausentes em vez de usar mocks.
- **Impacto visual:** a coluna de 290 px do magazine não aparece e o conteúdo
  ocupa a largura editorial disponível; a sidebar inferior contém apenas o
  skyscraper reservado.

## D-016 — Corpo do artigo é textual, sem blocos ricos do protótipo

- **Canônico:** artigo de demonstração contém headings internos, figura,
  legenda, tags, compartilhamento, ficha rica de uma série e quatro artigos
  relacionados.
- **Produto:** o presenter atual entrega parágrafos, fonte, aviso de IA e links
  simples para entidades relacionadas; não há AST de blocos, tags sociais nem
  artigos relacionados.
- **Produto portado:** mantém hero 560 px, coluna de leitura de 720 px, tipografia
  17/1.8 e o leaderboard intermediário. Renderiza somente os campos persistidos
  e apresenta entidades relacionadas como referências textuais honestas.
- **Impacto visual:** figuras, ficha rica, tags/share e grid “Leia também” ficam
  ausentes até seus contratos existirem.

## D-017 — Categorias não simulam ranking, streaming ou trailer

- **Canônico:** a tela 04 combina hero editorial completo, Top 10, filtros por
  plataforma, ranking, próximos trailers e Top News.
- **Produto:** os índices possuem cards reais, nota própria apenas quando
  governada, notícias publicadas e datas futuras de filmes; não há ranking Top
  10, agregação de plataforma por categoria, trailer, classificação, direção ou
  elenco no contrato dos índices.
- **Produto portado:** usa o primeiro card real no hero, os quatro seguintes na
  grade canônica, próximos lançamentos somente em Filmes e Top News sem
  repetição. Os três AdSlots permanecem na ordem original; os blocos sem fonte
  real não geram DOM.
- **Impacto visual:** não aparecem numeração Top 10, estrelas, filtros de
  streaming, ranking nem CTA de trailer. Quando blocos intermediários estão
  ausentes, dois espaços publicitários podem ficar consecutivos.

## D-018 — Explorar não finge busca, atividade pessoal ou sinais sociais

- **Canônico:** Browse/Discover/Mais Aguardados combinam busca funcional,
  filtros, plataformas, crescimento em 24 horas, progresso de reprodução,
  watchlist, contagens da comunidade e rankings sociais.
- **Produto:** não há endpoint de busca, sessão de usuário, histórico de
  reprodução, watchlist/comunidade, agregação de streaming para o hub nem rota
  dedicada de “Mais Aguardados”. Há catálogo real e filmes futuros com data
  persistida.
- **Produto portado:** instancia a tela Discover em `/pt/explorar/`, com o
  leaderboard, cabeçalho, navegação real, destaque determinístico, rail misto e
  agenda de lançamentos. Browse e a tela social de Mais Aguardados ficam
  diferidos; nenhum contador, rank, progresso ou ação falsa é exibido.
- **Impacto visual:** barra de busca, CTA de watchlist/trailer, Em Alta com
  crescimento, Continuar assistindo, Mais Aguardados e Populares não aparecem.

## D-019 — Superfícies autenticadas permanecem fora do app público

- **Canônico:** as telas 13–16 apresentam Configurações, Dados/importação,
  Listas e Entrar/cadastrar como produto funcional.
- **Produto:** ainda não existe autenticação pública, conta de usuário,
  preferências persistidas, importação de biblioteca ou CRUD de listas.
- **Produto portado:** não cria rotas, formulários, botões ou navegação que
  aparentem salvar dados sem backend. O inventário visual dessas telas continua
  no ZIP canônico e poderá ser portado quando seus contratos forem reais.
- **Impacto visual/comportamental:** essas quatro telas não estão acessíveis no
  runtime atual; nenhum fluxo falso ou dead-end foi adicionado.
