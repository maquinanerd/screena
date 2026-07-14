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

## D-011 — Transparência das categorias aguarda o hero canônico

- **Canônico:** home, categoria de filmes, categoria de séries e artigo usam o
  header transparente sobre um hero escuro até 80 px de scroll.
- **Estado intermediário:** os índices reais ainda usam o cabeçalho claro legado;
  ligar a tinta branca por pathname tornou o logo ilegível sobre branco no smoke.
- **Produto portado:** home e artigo já recebem o comportamento canônico; filmes
  e séries permanecem sólidos somente até a fase que portar seus heros escuros.
- **Impacto visual:** divergência temporária limitada ao topo dos dois índices;
  esta entrada deve ser removida junto com o port das categorias.
