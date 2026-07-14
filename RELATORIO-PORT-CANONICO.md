# Relatório final — port canônico do frontend cinematográfico Screen

Data da consolidação: **14 de julho de 2026**

Repositório: `maquinanerd/screena`

Branch: `feat/web-canonical-cinematic-port`

Base: `origin/main` em `ffbc1341ad3b248e4406735f899447e4fec07beb`

Título da PR: `feat(web): port canonical cinematic frontend exactly`
Estado pretendido da PR: **draft**, com inspeção humana em staging ainda pendente

## 1. Resultado executivo

O frontend público foi portado em uma branch limpa criada diretamente de
`origin/main`. Nenhum commit ou arquivo da reinterpretação visual da PR #60 foi
transplantado. O pacote anexado foi tratado como fonte visual única, e o app real
foi adaptado apenas onde o próprio produto não possui um contrato de dados ou uma
feature funcional.

O resultado cobre:

- fundação visual, tokens, Montserrat auto-hospedada, logo, header e footer;
- home cinematográfica;
- detalhe de filme;
- detalhe de série em desktop e a composição mobile específica;
- detalhe de pessoa;
- índice de notícias e artigo;
- entradas de Filmes e Séries sem ranking, streaming ou conteúdo fictício;
- a parte funcional da tela Explorar: agenda semanal de lançamentos reais;
- inventários verificáveis dos 23 espaços publicitários e das 31 categorias de
  imagem declaradas pelo HTML canônico;
- testes de contrato, acessibilidade, SEO, dados e governança.

Não foi copiado conteúdo de demonstração do protótipo. Seções sem dado real ou
sem backend foram omitidas e documentadas em `DIVERGENCIAS.md`, preservando a
ordem relativa dos blocos que continuam renderizados.

## 2. Fonte canônica e verificação forense

Arquivo recebido:

`E:\Área de Trabalho 2\20Screena20Cinematic20System%2013v.zip`

| Verificação | Resultado |
| --- | --- |
| Tamanho do ZIP | 136.489.068 bytes |
| SHA-256 do ZIP | `47ba0e7ad845f02f22c74654f7e23faa81614f3e18d2d7f04ef95ae496fa41e4` |
| Entradas | 458 |
| Bytes descompactados | 140.902.710 |
| Fonte visual principal | `Screen Screens v4.dc.html` |
| Tamanho da fonte principal | **340.582 bytes**, conforme esperado |
| SHA-256 da fonte principal | `cb852d6f4b012c9c1351ce7c506994e3a863e1d8592f55868e06ea23fc69973d` |
| Cópia declarada | `paginas/00-principal-completo.html` |
| Igualdade da cópia | mesmo tamanho, mesmo SHA-256 e igualdade byte a byte |

A ordem de autoridade usada foi:

1. `Screen Screens v4.dc.html`;
2. `paginas/00-principal-completo.html`;
3. `docs/implementacao-fiel-screen-v4.md`;
4. HTMLs individuais em `paginas/`;
5. documentação e inventários auxiliares não conflitantes.

Backups, protótipos antigos, versões de print e diretórios marcados como legado
não foram usados para redesenhar ou “melhorar” o sistema.

## 3. Isolamento da PR #60

- A branch nova foi criada de `origin/main`, não da branch da PR #60.
- O `merge-base` com `origin/main` é exatamente
  `ffbc1341ad3b248e4406735f899447e4fec07beb`.
- A PR #60 permaneceu aberta e em draft durante a execução.
- A PR #60 não foi mesclada, convertida para pronta ou alterada.
- Não houve cherry-pick, cópia de CSS ou transplante de componentes da branch
  visual contaminada.
- ZIP, extração local, `.agents`, `.claude/skills`, `.codex` e outros arquivos
  locais não relacionados permaneceram fora do staging.

## 4. Princípios aplicados no port

### 4.1 Fidelidade visual

- grid, ordem, cores, pesos, raios, espaçamentos e proporções vieram do HTML
  canônico;
- o container desktop permanece em 1.280 px;
- a nav conserva 72 px e o trilho visual canônico;
- filme continua com acento vermelho `#F0443E`;
- série continua com acento verde `#7FA56F`;
- o fundo principal permanece `#FDFDFD`;
- títulos reais longos usam a escala compacta já prevista no sistema, evitando
  corte sem alterar o grid ou introduzir quebra não canônica;
- seções não foram reordenadas para preencher lacunas de dados.

### 4.2 Dados reais

- páginas públicas leem somente PostgreSQL/cache local;
- não há chamada a TMDB, RapidAPI ou Gemini no render;
- não foram inventados ranking, nota, plataforma, episódio, contagem social,
  watchlist, progresso, login ou disponibilidade;
- disponibilidade só aparece quando o contrato governado existente permite;
- imagem e conteúdo editorial vêm dos presenters/getters existentes;
- fallbacks se limitam aos gradientes do sistema, iniciais e travessão para campo
  opcional ausente.

### 4.3 Semântica sem mudança visual

- navegação usa links reais;
- controles interativos usam elementos semânticos;
- a home mantém um H1 institucional estável e oculto;
- o título visual do slide ativo usa H2 e slides inativos usam parágrafo, evitando
  que o H1 mude durante o autoplay;
- cada ficha mantém um único H1;
- foco visível, labels, `aria-current`, alt text, reduced motion e hit targets
  foram preservados ou corrigidos.

## 5. Matriz das telas canônicas

| Tela | Destino no app | Estado | Observação |
| --- | --- | --- | --- |
| `01-switcher-open` | sem rota pública | Diferida | Switcher pertence ao protótipo/handoff, não ao produto. |
| `02-home` | `/pt/` | Portada | Hero, anúncios, filmes reais, séries condicionais, lançamentos e notícias na ordem canônica. |
| `03-news` | `/pt/noticias/` | Portada | Magazine, feed e quatro posições de anúncio; rail/ranking/newsletter omitidos sem contrato. |
| `04-cat-home` | `/pt/filmes/`, `/pt/series/` | Portada parcialmente | Introdução pública, três anúncios, lançamentos reais em Filmes e Top News; hero/Top 10/streaming omitidos. |
| `05-article` | `/pt/noticias/[slug]/` | Portada | Hero radial, coluna de leitura, metadata e anúncio; sem figura ou relacionados fictícios. |
| `06-movie-detail` | `/pt/filmes/[slug]/` | Portada | Mídia, ficha, obra, crítica, watch governado, elenco, notícias e detalhes quando há dados. |
| `07-series-detail` | `/pt/series/[slug]/` | Portada | Grid desktop, ficha, temporadas, episódios, elenco, obra, crítica e detalhes. |
| `08-series-mobile` | mesma rota de série | Portada | Ordem mobile específica, mídia 16:9, número junto ao episódio e notícias ocultas conforme a tela. |
| `09-person` | `/pt/pessoas/[slug]/` | Portada | Identidade, biografia publicada, filmografia real/estado vazio, notícias e detalhes. |
| `10-browse` | sem rota própria | Diferida | Filtros, plataformas e coleção navegável exigem contratos ausentes. |
| `11-discover` | `/pt/explorar/` | Portada parcialmente | Leaderboard, cabeçalho e agenda real dos próximos sete dias. |
| `12-anticipated` | sem rota própria | Diferida | Não existe ranking social de títulos aguardados. |
| `13-settings` | sem produto autenticado | Diferida | Não existe conta pública funcional. |
| `14-data` | sem produto autenticado | Diferida | Não existe importação de biblioteca. |
| `15-listas` | sem produto autenticado | Diferida | Não existe CRUD público de listas. |
| `16-entrar` | sem autenticação pública | Diferida | Não foi criado formulário falso. |
| `17-ad-pop` | sem runtime de ads | Diferida | Inventariada, não renderizada. |
| `18-ad-tela` | sem runtime de ads | Diferida | Inventariada, não renderizada. |

“Portada parcialmente” não significa versão reinterpretada: significa que a
geometria da tela foi mantida para os blocos sustentados pelo produto e que os
blocos dependentes de mocks/features inexistentes não geram DOM.

## 6. Implementação por superfície

### 6.1 Fundação, marca e chrome

- Montserrat variável auto-hospedada em
  `apps/web/public/fonts/montserrat-latin-variable.woff2`;
- licença OFL em `apps/web/public/fonts/OFL.txt`;
- nenhum import externo de fonte;
- logos no `viewBox="0 0 406 78"` e variantes neutra, cinema e série;
- componente `ScreenLogo` usado em header/footer;
- header e footer reconstruídos com a ordem e o footprint canônicos;
- tagline ajustada apenas para não prometer streaming universal;
- atribuição obrigatória ao TMDB preservada no footer;
- tokens e responsividade consolidados em `globals.css` e módulos por rota.

O pacote descreve os SVGs como oficiais, mas os arquivos fornecidos usam
`<text>` e não outlines. O port reproduz a geometria do HTML de hash validado e
depende da Montserrat local, como registrado em D-002.

### 6.2 Home

Ordem implementada:

1. H1 institucional oculto e hero full-bleed;
2. ticker somente se houver agenda real — atualmente não simulado;
3. Top 10 somente com ranking semanal completo — atualmente omitido;
4. leaderboard;
5. Filmes em alta com popularidade persistida;
6. estatísticas pessoais — omitidas sem usuário;
7. leaderboard;
8. Séries da semana — condicional ao contrato temporal;
9. continuar assistindo — omitido sem usuário/histórico;
10. Em breve com datas reais, sem fingir trailer;
11. leaderboard;
12. Top News, sem repetir o destaque.

O getter de catálogo adicionado em `apps/web/src/server/home-catalog.ts` é
server-only, somente leitura e restrito ao app web. Ele não escreve, não chama
rede externa e não altera domínio ou schema.

### 6.3 Filme

- composição de mídia e identidade da tela 06;
- fatos opcionais mostram travessão em vez de inventar valor;
- content blocks são roteados semanticamente: obra, crítica e watch;
- FAQ, explicação de ratings e similares não são despejados em “A obra”;
- elenco real com fallback de iniciais;
- notícias relacionadas reais;
- foco branco nas superfícies escuras e preto nas claras;
- tablet/mobile empilham a mídia sem alterar a ordem editorial.

Galeria, prêmios e recomendações ficam ausentes quando não há contrato/mídia.

### 6.4 Série desktop e mobile

- desktop preserva a composição `1fr / 3fr / 2fr` da tela 07;
- tablet empilha poster e backdrop conforme o contrato;
- seleção de temporada é funcional via `?temporada=` e renderiza apenas a
  temporada selecionada;
- episódios usam dados persistidos e mídia 16:9;
- no mobile, o número aparece junto ao título e o overlay desktop é ocultado;
- ordem mobile: mídia, identidade, elenco, obra, episódios e detalhes;
- crítica e notícias são ocultadas no breakpoint mobile quando a tela 08 não as
  contém;
- nenhuma temporada, episódio ou still foi fabricado.

### 6.5 Pessoa

- identidade, foto, profissão, fatos, links e biografia;
- somente `editorial_intro` compatível é usado como biografia;
- filmografia usa créditos reais e expõe estado vazio honesto;
- a linha de crédito inteira é linkável;
- notícias são renderizadas apenas quando relacionadas e publicadas.

### 6.6 Notícias e artigo

- o modo “Todas” preserva magazine, feed, ordem e quatro posições de anúncio;
- a coluna desktop de 290 px permanece reservada, ainda que vazia;
- cards e destaque são links integrais com um único nome acessível;
- modos Cinema/Séries, newsletter e “Mais lidas” não são simulados;
- o artigo usa hero radial sem inventar uma imagem que a tela 05 não declara;
- a imagem editorial persiste apenas em metadata/Schema.org;
- o hero usa `min-height`, evitando cortar título/deck dinâmicos;
- coluna textual de 720 px, tipografia 17/1.8 e anúncio intermediário foram
  preservados;
- não foi criado grid de artigos relacionados a partir de entidades que não são
  artigos.

### 6.7 Categorias Filmes e Séries

- nenhum primeiro card foi promovido arbitrariamente a hero;
- nenhum catálogo genérico substitui Top 10;
- não existe ItemList para cards que não aparecem visualmente;
- H1 e descrição são visíveis e honestos;
- três anúncios permanecem nas posições canônicas;
- Filmes mostra lançamentos reais; ambas as rotas podem mostrar notícias
  editoriais reais;
- ranking, filtros de plataforma, trailer, elenco e ratings ausentes não são
  simulados.

### 6.8 Explorar

- a rota não mistura Discover com um catálogo genérico;
- destaque, crescimento em 24 h, continuar assistindo, watchlist e sinais
  sociais permanecem ausentes;
- a agenda usa filmes persistidos dos próximos sete dias;
- dia da semana e dia do mês são calculados em UTC;
- estado vazio explícito aparece quando não há estreia real na janela.

## 7. Inventários canônicos

### 7.1 Publicidade

O HTML declara exatamente 23 posições:

- 15 leaderboards;
- 4 billboards;
- 3 skyscrapers;
- 1 rectangle.

Treze são ativas ou condicionais nas superfícies reais; dez permanecem
diferidas com as telas/features ausentes. `AdSlot` preserva dimensões e reserva
espaço sem carregar Google AdSense ou qualquer script externo. O placeholder
tracejado só aparece em dev/preview.

### 7.2 Imagens

Foram inventariadas 31 categorias de `<image-slot>`:

- filme: 9;
- série desktop: 10;
- série mobile: 3;
- Discover: 7;
- Mais aguardados: 1;
- Configurações: 1.

Estado do port:

- 16 ativas ou condicionais com dados reais;
- 15 diferidas sem contrato funcional ou mídia persistida.

O inventário não copia URLs de demonstração e não transforma uploads do pacote
em conteúdo editorial público.

## 8. Responsividade

Breakpoints conservados:

- `>= 1440 px`: container de 1.280 px centralizado;
- `1280–1439 px`: desktop canônico;
- `1024–1279 px`: padding de 48 px;
- `768–1023 px`: padding de 32 px, sidebars abaixo e skyscraper oculto;
- `<= 767 px`: padding de 20 px, rails por swipe e composição mobile;
- `<= 390 px`: padding de 16 px e tetos tipográficos.

Aspect ratios, crops por `object-fit: cover`, ordem do DOM e espaçamentos desktop
não foram alterados para acomodar o mobile.

## 9. SEO, acessibilidade e governança

- canonical, robots, hreflang e JSON-LD existentes foram preservados;
- a home emite `Organization` e `WebSite`, sem `SearchAction` falso;
- fichas mantêm `@id`, `mainEntityOfPage` e `sameAs` somente com IDs reais;
- nenhum `AggregateRating` próprio foi inventado;
- filme/série continuam diferenciados por label, badge, breadcrumb, schema e URL,
  nunca apenas por cor;
- links de notícias não têm alvos duplicados sem nome acessível;
- H1 da home não muda com autoplay;
- não há classe CSS órfã nos módulos finais de Categorias e Explorar;
- reduced motion e foco visível continuam suportados.

## 10. Escopo técnico efetivamente alterado

### Alterado

- `apps/web/app/**`: markup, componentes e CSS da camada pública;
- `apps/web/public/brand/**`: variantes de logo e documentação;
- `apps/web/public/fonts/**`: Montserrat e OFL;
- `apps/web/src/lib/**`: presenters/contratos puros, navegação e inventários;
- `apps/web/src/server/home-catalog.ts`: getter server-only read-only do app web;
- `apps/web/src/server/home-upcoming.ts`: alinhamento de comentário/uso do
  presenter;
- `tests/governance/**` e `tests/web/**`: contratos e regressões do port;
- documentação de preflight, divergências e este relatório.

### Não alterado

- `apps/admin/**`;
- `packages/db/**`;
- Prisma, schema, migrations e seeds;
- `services/streaming/**`;
- `services/ratings/**`;
- `services/ingestion/**`;
- `services/entity-writer/**`;
- `api-clients/**`;
- workers;
- dados, flags de licença, `display_allowed`, `screen_score` ou ratings externos;
- manifests, dependências e lockfile.

Não houve escrita Prisma, ingestão, promoção, sync, `--sample`, `--apply`, TMDB,
RapidAPI ou Gemini.

## 11. Commits por fase

| Commit | Conteúdo |
| --- | --- |
| `98deb72` | auditoria da fonte canônica e isolamento da branch |
| `8b6f8f3` | fundação, Montserrat, logo, chrome e AdSlot |
| `f76d086` | home cinematográfica |
| `29a516c` | detalhe de filme |
| `505a14a` | detalhe de série |
| `e4c4bcb` | detalhe de pessoa |
| `547a226` | categorias e notícias |
| `dc8f336` | superfície Explorar |
| `5682705` | documentação das superfícies autenticadas diferidas |
| `2ede065` | inventário e testes das 23 posições de anúncio |

A consolidação final adiciona correções de fidelidade, inventário de imagens,
governança semântica, testes finais e este relatório.

## 12. Validações executadas

| Comando/verificação | Resultado final |
| --- | --- |
| `corepack pnpm typecheck` | **PASSOU** |
| `corepack pnpm lint` | **PASSOU** para o conteúdo da branch |
| `corepack pnpm test` | **PASSOU — 166 arquivos, 1.719 testes** |
| `corepack pnpm audit:invariants` | **PASSOU — 7 checks, 0 avisos, 0 violações** |
| `corepack pnpm audit:render` | **PASSOU — 80 arquivos do app, 0 violações** |
| `corepack pnpm --filter @screena/web build` | **PASSOU — Next.js 15.5.19** |
| ESLint dos arquivos alterados/versionados | **PASSOU** |
| `git diff --check` | **PASSOU**; apenas aviso local LF/CRLF |
| smoke HTTP local | **8/8 rotas com HTTP 200** |
| captura headless | home em 1440×1600 e série em 390×844 inspecionadas |

O primeiro `pnpm lint` também enxergou a extração **não versionada** do pacote
dentro do workspace e reportou erros nos JavaScripts do protótipo. A referência
foi temporariamente movida para fora do repo, o comando exato foi repetido e
passou; a pasta foi restaurada no mesmo caminho. Nenhum erro pertencia ao app ou
ao diff versionado.

Rotas do smoke test:

- `/pt/`;
- `/pt/filmes/`;
- `/pt/series/`;
- `/pt/noticias/`;
- `/pt/explorar/`;
- `/pt/filmes/mestres-do-universo-2026/`;
- `/pt/series/avatar-o-ultimo-mestre-do-ar-2024/`;
- `/pt/pessoas/anne-hathaway/`.

## 13. Limitações e pendências honestas

1. A inspeção visual humana lado a lado em staging continua obrigatória.
2. Houve inspeção headless local em dois viewports, mas não pixel-diff completo
   das 18 telas e de todos os breakpoints.
3. Parte dos testes de contrato visual verifica estrutura/strings do código;
   eles detectam regressões conhecidas, mas não provam fidelidade pixel a pixel.
4. Os inventários de anúncios e imagens são transcrições auditadas do HTML,
   não geração automática a cada teste.
5. O ambiente local usa Node `24.14.0`, fora do range do repo `>=22 <23`. O
   pnpm é o correto, `9.15.4`, e todos os gates passaram mesmo assim. Staging/CI
   deve usar Node 22 LTS.
6. O build avisa que o plugin Next.js não foi detectado na configuração ESLint;
   é um aviso preexistente e não impediu lint, typecheck ou build.
7. O runtime de publicidade não existe; os slots apenas preservam espaço.
8. Browse, Mais aguardados, conta, importação, listas, login e formatos de ads
   de tela cheia permanecem diferidos até terem produto real.

Por essas limitações, a entrega não é rotulada como “100% pixel-perfect”. Ela é
o port de máxima fidelidade verificável ao pacote canônico dentro dos contratos
reais do produto, sem dados falsos, features mortas ou expansão de escopo.

## 14. Execução local

O app foi validado em:

`http://localhost:3000/pt/`

Comando equivalente:

```bash
corepack pnpm --filter @screena/web dev
```

O processo local deve permanecer ativo para inspeção manual após a publicação da
branch. A validação definitiva ainda deve ocorrer em staging antes de qualquer
merge.
