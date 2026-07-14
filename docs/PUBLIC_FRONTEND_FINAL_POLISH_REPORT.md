# Relatório completo — acabamento visual final do frontend público

> Documento de rastreabilidade da task **“Front-end final do Screen — acabamento visual público de produto”**.

## 1. Identificação

| Campo                                         | Valor                                                                                                      |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Projeto                                       | Screen                                                                                                     |
| Repositório                                   | `maquinanerd/screena`                                                                                      |
| Domínio público                               | `https://thescreen.media`                                                                                  |
| Data da execução                              | 14 de julho de 2026                                                                                        |
| Fuso usado neste relatório                    | America/Sao_Paulo (BRT, UTC-3)                                                                             |
| Escopo                                        | Somente frontend público                                                                                   |
| Branch                                        | `feat/public-frontend-final-polish`                                                                        |
| Base da branch                                | `main` no commit `ffbc1341ad3b248e4406735f899447e4fec07beb`                                                |
| Commit de implementação                       | `78ce02bf95236567cfddb8c9cab138ae55c153d0`                                                                 |
| Mensagem do commit                            | `feat(web): finalize public frontend visual polish`                                                        |
| Pull request                                  | [#60 — feat(web): finalize public frontend visual polish](https://github.com/maquinanerd/screena/pull/60)  |
| Estado da PR no encerramento da implementação | Draft, aberta, sem merge                                                                                   |
| CI da implementação                           | [Run 29351882434](https://github.com/maquinanerd/screena/actions/runs/29351882434) — concluído com sucesso |
| Volume do commit                              | 32 arquivos, 3.183 adições e 1.715 remoções                                                                |
| Arquivos criados                              | 4                                                                                                          |
| Arquivos modificados                          | 25                                                                                                         |
| Arquivos removidos                            | 3                                                                                                          |

Este relatório descreve o commit de implementação `78ce02b` e as evidências reunidas durante sua execução. O próprio arquivo de relatório é uma atualização documental posterior na mesma branch e não altera o comportamento do frontend.

## 2. Resumo executivo

A task transformou o frontend público do Screen de uma coleção visualmente desigual de páginas e componentes em um sistema editorial claro, consistente e reutilizável. A direção adotada usa papel/creme como superfície principal, Montserrat como tipografia da marca, hierarquia tipográfica forte, grids responsivos, mídia cinematográfica controlada e diferenciação textual entre filmes, séries, pessoas e notícias.

O trabalho cobriu:

- home pública;
- listagens de filmes, séries, pessoas e notícias;
- hub Explorar;
- detalhes de filme, série e pessoa;
- acabamento compartilhado da página de notícia;
- header, navegação, rodapé e layout global;
- cards de entidades e notícias;
- hero da home e hero compartilhado de detalhes;
- estados vazios;
- painel real de disponibilidade;
- elenco, temporadas, episódios e notícias relacionadas;
- responsividade, foco, reduced motion e forced colors;
- testes e auditorias contra conteúdo fictício.

Por precisão, “somente frontend” significa frontend público acompanhado dos testes e da auditoria de governança necessários para proteger esse frontend. O commit não é composto apenas por CSS e JSX: ele também ajusta um script de auditoria, modifica três arquivos de teste e remove um teste do gate extinto. Nenhuma dessas mudanças alcança backend, schema ou dados.

O resultado preserva a arquitetura pública existente, a leitura exclusiva de PostgreSQL/cache local no render, os presenters, as regras de licença, o gate real de streaming, ratings permitidos, canonical, robots, JSON-LD, slugs e redirects.

Nenhum backend, schema, migration, worker, job de ingestão, regra de licença, regra de rating, promoção de streaming ou chamada de API externa foi alterado.

Todos os checks locais relevantes e o CI em checkout limpo passaram. A única parte não concluída foi a captura visual por navegador: o runtime de navegador disponibilizado ao agente não encontrou navegador conectado. Por isso, a aprovação visual final nas larguras pedidas continua sendo uma etapa humana de staging antes do merge.

## 3. Origem e mudança de prioridade

O pedido mudou explicitamente a prioridade anterior: o objetivo deixou de ser um relatório 360 do produto e passou a ser uma fase dedicada de acabamento visual público.

O fluxo solicitado foi:

1. congelar backend e dados;
2. auditar as páginas públicas existentes;
3. definir um único sistema visual final;
4. refatorar os componentes públicos;
5. validar com screenshots quando o ambiente permitisse;
6. abrir uma PR exclusiva de frontend, sem merge automático.

A intenção central era fazer o site parecer um produto público editorial, não um protótipo, sem usar dados fictícios para preencher lacunas visuais.

## 4. Objetivos e critérios originais

### 4.1 Objetivo de produto

Transformar o frontend público atual do Screen em uma experiência visual finalizada, consistente e publicável, preservando as rotas, a arquitetura entity-first e os contratos reais de dados.

### 4.2 Direção visual obrigatória

- tema claro;
- fundo paper, cream ou off-white;
- linguagem editorial premium;
- maturidade percebida comparável a produtos consolidados de entretenimento, sem copiar interfaces;
- marca pública Screen;
- Montserrat como família principal;
- títulos com pesos fortes;
- grids sólidos;
- hierarquia clara;
- espaçamento consistente;
- componentes reutilizáveis;
- ausência de aparência genérica de template SaaS ou Tailwind;
- bordas e sombras com uso contido;
- nenhum CTA falso;
- nenhum elemento que simule feature inexistente.

### 4.3 Superfícies públicas incluídas

- `/pt/`;
- `/pt/filmes/`;
- `/pt/filmes/[slug]`;
- `/pt/series/`;
- `/pt/series/[slug]`;
- `/pt/pessoas/`;
- `/pt/pessoas/[slug]`;
- `/pt/noticias/`;
- `/pt/noticias/[slug]` por meio do sistema visual compartilhado;
- `/pt/explorar/`;
- header, footer e layout comuns.

### 4.4 Resoluções solicitadas

- mobile: 390 px;
- tablet: 768 px;
- desktop: 1280 px;
- wide: 1440 px ou mais.

## 5. Restrições e não objetivos

As seguintes fronteiras foram mantidas durante toda a execução:

- não alterar backend;
- não alterar PostgreSQL;
- não alterar Prisma;
- não criar ou modificar migrations;
- não alterar workers;
- não rodar RapidAPI;
- não rodar TMDB live;
- não executar fluxos `--sample` ou `--apply`;
- não promover disponibilidade de streaming;
- não alterar `display_allowed`;
- não alterar `screen_score`;
- não alterar `external_ratings`;
- não mudar fontes, escalas ou atribuições de ratings;
- não mudar decisões de licença;
- não adicionar biblioteca visual externa;
- não adicionar dependência de frontend;
- não transformar Explorar em busca ou filtros fictícios;
- não fabricar notícia, ranking, nota, trailer, provider, anúncio, newsletter, login ou lista de usuário;
- não remover canonical, metadata, JSON-LD, sitemap, robots, H1, redirects ou slugs;
- não fazer merge da PR.

## 6. Regras canônicas observadas

O trabalho seguiu `CLAUDE.md`, `.claude/rules/` e `AGENTS.md`, considerando a política atualizada de julho de 2026.

### 6.1 Indexação total

A política canônica atual não usa mais “dois blocos editoriais” como gate geral de indexação. Blocos próprios continuam sendo sinal de qualidade e ranqueamento, mas `noindex` fica reservado a estados técnicos, vazios ou bloqueados pelo avaliador canônico.

Nesta task:

- a lógica de metadata continuou delegando a decisão aos avaliadores existentes;
- comentários antigos sobre gate anti-thin foram corrigidos;
- avisos visuais de “página em revisão” deixaram de ser inferidos da decisão técnica de indexabilidade;
- nenhuma decisão de indexação em massa foi executada;
- nenhuma tabela de decisões foi alterada.

### 6.2 Pureza de render

- zero chamada externa no render;
- zero Gemini no render;
- server components continuam recebendo dados do PostgreSQL por getters locais;
- componentes compartilhados novos são apresentacionais;
- componentes client existentes continuam sem IO externo;
- a fonte Montserrat é servida localmente.

### 6.3 Filme e série não dependem apenas de cor

A diferenciação continua combinando:

- label textual;
- badge textual;
- breadcrumb;
- URL;
- schema;
- acento vermelho para filme;
- acento verde para série.

### 6.4 Honestidade de produto

O frontend só apresenta:

- entidades reais retornadas pelos presenters;
- datas futuras reais já persistidas;
- notícias reais e publicáveis;
- ratings autorizados pelo contrato existente;
- ofertas reais e licenciadas do presenter de disponibilidade;
- contagens reais do banco.

Quando não há dado, a interface omite a seção ou apresenta um estado vazio editorial honesto.

## 7. Auditoria visual inicial

### 7.1 Problemas identificados

| Problema                                                      | Impacto observado                                | Resposta implementada                               |
| ------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------- |
| Páginas com introduções e breadcrumbs diferentes              | Produto parecia composto por fases independentes | Criação de primitives compartilhadas                |
| Home extensa e dependente de placeholders visuais             | Aparência de mock e risco de conteúdo fictício   | Reescrita com dados reais e estados vazios          |
| Cards sem variações sistêmicas                                | Home e listagens exigiam markup ou CSS duplicado | Variantes `poster`, `feature` e `compact`           |
| Fallbacks de mídia fracos                                     | Cards vazios pareciam quebrados                  | Monograma e superfície editorial neutra             |
| Filme e série duplicavam hero e backdrop                      | Manutenção difícil e inconsistência visual       | `EntityDetailHero` compartilhado                    |
| Rodapé exibindo pseudo-newsletter, sociais e destinos futuros | Affordances sem funcionalidade real              | Rodapé reduzido a marca, rotas reais e atribuição   |
| Header tinha ícone de busca levando apenas a Explorar         | Parecia uma busca funcional                      | Remoção do affordance e reforço da nav real         |
| Nav não indicava rota ativa                                   | Orientação fraca                                 | `aria-current` e estado visual por segmento         |
| Home tinha CTA duplicada no hero                              | Ruído e duas ações equivalentes                  | CTA única “Ver ficha”                               |
| Ticker de episódios e gates por ambiente                      | Conteúdo visual de demonstração podia retornar   | Remoção do componente, gate e exceções de auditoria |
| Estados vazios eram texto solto                               | Páginas sem dados pareciam inacabadas            | `EmptyState` compartilhado com ação real opcional   |
| Heading levels variavam por contexto                          | Risco semântico e SEO                            | Níveis configuráveis nos cards e estados vazios     |
| Mobile dependia de grids rígidos                              | Risco de texto espremido e cards quebrados       | Breakpoints finais em 1024, 820, 640 e 440 px       |
| Pessoa e notícia herdavam acentos de filme/série              | Semântica visual confusa                         | Tratamento neutro específico                        |
| Movimento não era uniformemente reduzido                      | Acessibilidade inconsistente                     | `prefers-reduced-motion` em CSS, carousel e rail    |

### 7.2 Estruturas reaproveitadas

Foram preservados e refinados:

- getters server-only das listagens;
- presenters de entidade, notícia, hero, disponibilidade e pessoas;
- hero carousel funcional da home;
- `WatchAvailabilityPanel` e seu contrato real;
- `CastStrip`;
- facts e links externos;
- temporadas e episódios de séries;
- notícias relacionadas;
- metadata e schemas existentes;
- tokens canônicos de filme e série;
- imagens reais já resolvidas pelos presenters.

### 7.3 Prioridade de implementação

1. remover affordances falsas e gates de placeholder;
2. consolidar layout, navegação e primitives;
3. reestruturar a home com dados reais;
4. unificar listagens e Explorar;
5. unificar heros de filme e série;
6. refinar pessoa, notícia, disponibilidade, elenco e relacionados;
7. fechar responsividade e acessibilidade;
8. endurecer testes e auditorias;
9. validar rotas e build;
10. abrir PR draft.

## 8. Sistema visual final

### 8.1 Tipografia

A família principal passou a ser Montserrat variável, auto-hospedada:

- arquivo: `apps/web/public/fonts/montserrat-latin-variable.woff2`;
- tamanho: 37.956 bytes;
- pesos disponíveis: 100 a 900;
- `font-display: swap`;
- licença: `apps/web/public/fonts/OFL.txt`;
- origem: [Google Fonts — Montserrat](https://github.com/google/fonts/tree/main/ofl/montserrat);
- nenhum `@import`, Google Fonts em runtime ou download no build.

A stack de fallback permanece:

```css
'Montserrat', 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif
```

### 8.2 Paleta consolidada

| Papel               | Token             | Valor                         |
| ------------------- | ----------------- | ----------------------------- |
| Fundo principal     | `--bg-page`       | `#F7F4EC`                     |
| Superfície branca   | `--bg-surface`    | `#FFFFFF`                     |
| Superfície quente   | `--bg-warm`       | `#F4F1EA`                     |
| Fundo suave         | `--bg-muted`      | `#EBE5DA`                     |
| Off-white           | `--bg-tint`       | `#FCFAF5`                     |
| Texto principal     | `--text-strong`   | `#161616`                     |
| Texto de corpo      | `--text-body`     | `#36332F`                     |
| Texto secundário    | `--text-muted`    | `#5E5A54`                     |
| Borda principal     | `--border`        | `#E4DED3`                     |
| Borda suave         | `--border-soft`   | `#EFE9DE`                     |
| Filme               | `--accent-movie`  | `var(--screena-movie-red)`    |
| Série               | `--accent-series` | `var(--screena-series-green)` |
| Destaque controlado | `--accent-yellow` | `#F5C518`                     |

Os tokens canônicos continuam definidos como:

- filme: `--screena-movie-red: #FF3B30`;
- série: `--screena-series-green: #7AA66D`.

### 8.3 Forma, profundidade e layout

| Papel               | Decisão                                       |
| ------------------- | --------------------------------------------- |
| Raio base           | 12 px                                         |
| Raio grande         | 14 px                                         |
| Raio pequeno        | 8 px                                          |
| Altura da navegação | 72 px                                         |
| Container máximo    | 1280 px                                       |
| Medida de leitura   | 68 caracteres                                 |
| Sombra de pôster    | Sombra quente e contida                       |
| Sombra de card      | Elevação leve, sem aparência SaaS             |
| Hero                | Mídia escura com scrim sobre superfície clara |
| Seções              | Alternância de papel, branco e faixas quentes |

### 8.4 Hierarquia editorial

- títulos principais usam peso alto e tracking negativo;
- descrições mantêm largura confortável de leitura;
- eyebrows aparecem como informação editorial auxiliar;
- links de seção usam CTA textual discreta;
- cards preservam título, metadado e badge sem excesso de chrome;
- amarelo é apoio, não substitui a identidade de filme ou série;
- notícias e pessoas usam linguagem neutra.

### 8.5 Responsividade

O cascade final contém breakpoints principais em:

- 1024 px: redução de grids e hero;
- 820 px: tablet, nav horizontal rolável e colunas simplificadas;
- 640 px: mobile, cards, seções e detalhes empilhados;
- 440 px: mobile estreito, incluindo o alvo de 390 px.

Mapeamento dos alvos pedidos:

| Alvo            | Cobertura                                                             |
| --------------- | --------------------------------------------------------------------- |
| 390 px          | Regras de 440 e 640 px                                                |
| 768 px          | Regras de 820 px                                                      |
| 1280 px         | Layout base com container máximo de 1280 px                           |
| 1440 px ou mais | Layout base centralizado, sem expansão ilimitada da medida de leitura |

### 8.6 Movimento e acessibilidade visual

- `prefers-reduced-motion` desativa ou reduz transições e zooms;
- o rail usa scroll instantâneo quando reduced motion está ativo;
- o carousel não executa autoplay quando reduced motion está ativo;
- `forced-colors: active` preserva contornos e separação;
- `focus-visible` usa outline amarelo de alto contraste;
- o skip link aparece ao receber foco;
- estados ativos da navegação não dependem apenas de cor.

## 9. Implementação por superfície

### 9.1 Layout global

Alterações em `apps/web/app/layout.tsx`:

- inclusão do link “Pular para o conteúdo”;
- criação do destino `#main-content`;
- `tabIndex={-1}` no container de conteúdo para foco programático;
- manutenção de `lang="pt-BR"`;
- manutenção de metadata base, Open Graph e Twitter existentes;
- header e footer continuam globais.

### 9.2 Header e navegação

Alterações em `site-header.tsx` e `navigation.ts`:

- remoção do ícone que aparentava busca funcional;
- manutenção apenas de rotas públicas reais;
- função pura `isActiveNavigationPath`;
- suporte a índice e rotas filhas;
- normalização de barra final;
- proteção contra prefixos semelhantes, como `/pt/filmes-antigos/`;
- `aria-current="page"` no item ativo;
- estado `data-active` para acabamento visual;
- header transparente sobre o hero da home e sólido após scroll;
- header sempre sólido nas páginas internas;
- nav rolável no tablet/mobile, sem esconder destinos.

Rotas presentes no header:

- Filmes;
- Séries;
- Pessoas;
- Notícias;
- Explorar.

### 9.3 Rodapé

O rodapé foi reduzido a conteúdo verdadeiro:

- marca Screen;
- tagline pública;
- links para Início, Filmes, Séries, Pessoas, Notícias e Explorar;
- atribuição obrigatória ao TMDB;
- copyright de `thescreen.media`.

Foram removidos:

- pseudo-newsletter;
- pseudo-formulário de e-mail;
- redes sociais sem destino real;
- filtros “Top”, “Mais vistos”, “Em breve” e equivalentes sem rota própria;
- itens institucionais sem página;
- links legais ainda inexistentes;
- uso público da marca histórica “The Screen” no copyright.

### 9.4 Home `/pt/`

A home foi reescrita para consumir exclusivamente dados reais dos getters já existentes.

#### Composição de dados

O carregamento ocorre em paralelo para:

- filmes;
- séries;
- pessoas;
- notícias;
- slides reais do hero;
- lançamentos futuros já persistidos.

Foi criada a função pura `interleaveUniqueByHref` para:

- alternar filmes e séries;
- preservar a ordem de cada origem;
- remover duplicatas por `href`;
- respeitar o limite de destaques;
- evitar preenchimento artificial.

Em termos de limites:

- a home pode formar um pool de até nove filmes e nove séries;
- até seis entidades entram em “Descubra no Screen”;
- os hrefs usados nos destaques são removidos das grades seguintes;
- o presenter pode manter até seis itens restantes por vertical;
- o JSX mostra até quatro filmes e quatro séries nas grades visuais.

#### Estrutura final

1. H1 institucional único, visualmente oculto;
2. hero carousel real ou hero institucional honesto;
3. introdução editorial visível em H2;
4. seção “Descubra no Screen” com cards `feature` e `compact`;
5. faixa de filmes;
6. strip com contagens reais do catálogo;
7. seção de séries;
8. próximos lançamentos reais ou estado vazio;
9. notícias reais ou estado vazio editorial.

#### Conteúdo removido da home

- ticker de episódios;
- anúncios de demonstração;
- rankings e números fantasma sem fonte;
- plataformas hardcoded;
- notícias mockadas;
- notas decorativas nos cards próprios da home;
- duração fictícia de trailer;
- affordances de usuário inativas;
- CTAs duplicadas;
- gates de placeholder por ambiente.

#### SEO da home

- H1 institucional único;
- slides ativos usam H2 e slides inativos usam parágrafo;
- canonical e hreflang `pt-BR`/`x-default` preservados;
- `Organization` e `WebSite` JSON-LD preservados;
- robots continua vindo do avaliador canônico;
- home vazia é tratada como estado técnico; uma seção real já permite indexação conforme a política atual.

### 9.5 Listagens de filmes, séries e pessoas

As três listagens passaram a usar `EntityIndex` com:

- `Breadcrumbs` compartilhado;
- `PageIntro` compartilhado;
- H1 canônico;
- descrição editorial;
- grid responsivo;
- cards com badge textual;
- contagem e mensagem de recorte quando aplicável;
- estado vazio consistente;
- ação real para Explorar.

Correções textuais incluem:

- “Séries” com acento em título e breadcrumb;
- “Screen” no lugar de construções públicas antigas;
- descrições em pt-BR com acentuação correta;
- mensagens de estado vazio específicas por vertical.

Pessoas mantêm tratamento visual neutro e cards de retrato.

### 9.6 Explorar `/pt/explorar/`

Explorar continua sendo um hub, não uma busca.

O trabalho:

- preservou a ausência de campo de busca e filtros simulados;
- aplicou `Breadcrumbs`, `PageIntro` e `SectionHeader`;
- manteve cards de acesso às quatro áreas públicas;
- exibe contagens apenas quando são inteiros reais maiores que zero;
- renderiza seções apenas quando há cards reais;
- preserva `CollectionPage` e `BreadcrumbList`;
- usa a política de indexação total, com `noindex` somente quando nenhuma seção tem dado real.

### 9.7 Notícias

#### Índice `/pt/noticias/`

- título e copy corrigidos para pt-BR;
- breadcrumb compartilhado;
- `PageIntro` neutro/editorial;
- card de destaque com H2;
- primeira imagem real pode usar eager/high priority;
- feed com `SectionHeader`;
- empty state honesto quando não há publicação;
- ação real para Explorar;
- `CollectionPage`, `ItemList` condicional e `BreadcrumbList` preservados.

#### Detalhe `/pt/noticias/[slug]`

O arquivo da rota não foi alterado diretamente. O acabamento chegou por:

- tokens globais;
- tipografia Montserrat;
- header e footer compartilhados;
- cards de notícias relacionadas;
- regras neutras no cascade final;
- tratamento responsivo e de foco.

Nenhum artigo fictício foi criado.

### 9.8 Detalhes de filme e série

Foi criado `EntityDetailHero`, compartilhado pelas duas verticais.

O componente recebe somente uma view já resolvida e apresenta:

- backdrop decorativo quando existe;
- fallback visual quando não existe backdrop;
- pôster real quando existe;
- layout sem pôster quando a mídia está ausente;
- breadcrumb sobre mídia;
- badge textual Filme ou Série;
- H1;
- ano ou período;
- fatos técnicos;
- sinopse curta;
- links externos governados.

O componente não acessa banco, rede ou API.

#### Filme

Foram preservados:

- blocos editoriais reais;
- resumo lateral quando existe;
- elenco real;
- painel real “Disponibilidade no Brasil”;
- notícias relacionadas;
- schema `Movie`;
- redirect de slug canônico;
- metadata e robots.

#### Série

Foram preservados:

- blocos editoriais reais;
- temporadas;
- episódios;
- elenco real;
- painel real de disponibilidade;
- notícias relacionadas;
- schema `TVSeries`;
- redirect de slug canônico;
- metadata e robots.

Também foram corrigidos “Série”, “Séries” e “Episódio” na interface e no breadcrumb estruturado.

#### Avisos editoriais removidos

Os avisos “Esta página ainda está em revisão editorial” eram derivados de `indexability.decision !== "index"`. Essa associação misturava estado técnico de SEO com estado editorial. Os avisos foram removidos sem alterar a decisão de robots.

### 9.9 Pessoa

A página de pessoa passou a ter:

- breadcrumb compartilhado;
- tratamento neutro;
- foto ou fallback;
- nome em H1;
- nome original, função e metadados apenas quando existentes;
- biografia apenas quando publicada;
- filmografia apenas quando existente;
- label visível “Filme” ou “Série” em cada crédito;
- empty state único quando biografia e créditos estão ausentes;
- notícias relacionadas reais;
- schema `Person`, canonical e redirect preservados.

A diferenciação de créditos deixou de depender de um ponto colorido visualmente oculto e passou a incluir texto visível.

### 9.10 Disponibilidade no Brasil

O contrato de dados e o gate não foram alterados.

O trabalho visual:

- integrou o painel ao novo ritmo editorial;
- refinou título, nota e data de atualização;
- melhorou grupos de ofertas;
- refinou cards de provider;
- preservou agrupamentos existentes de assinatura, grátis, aluguel e compra;
- preservou preço e qualidade apenas quando presentes;
- preservou links externos seguros;
- manteve o painel ausente quando não há view licenciada.

Não houve hardcode de provider ou oferta.

### 9.11 Cards de entidade

`EntityCardLink` ganhou três variantes visuais sem mudar seu contrato de dados:

| Variante  | Uso                            |
| --------- | ------------------------------ |
| `poster`  | Listagens e grids editoriais   |
| `feature` | Destaques principais da home   |
| `compact` | Lista secundária da descoberta |

Outras mudanças:

- badge textual sempre visível;
- label Filme, Série ou Pessoa;
- alt específico para pôster ou retrato;
- fallback com monograma;
- `loading`, `fetchPriority` e `decoding` controláveis;
- primeira imagem da dobra pode ser eager;
- hover discreto;
- pessoa mantém tratamento neutro.

### 9.12 Cards de notícia

`NewsCard` passou a aceitar:

- variantes `featured`, `feed` e `related`;
- heading level 2, 3 ou 4;
- carregamento eager opcional;
- fallback editorial neutro;
- deck omitido na variante relacionada;
- metadados apenas quando presentes.

### 9.13 Próximos lançamentos

`ComingSoonRail` agora:

- aceita somente título, data, link e imagem opcional reais;
- não aceita mais duração de trailer;
- usa rótulos “lançamento anterior” e “próximo lançamento”;
- mostra setas apenas quando há mais de três itens;
- mantém scroll horizontal e scroll snap;
- respeita reduced motion;
- não promete trailer, player ou plataforma.

### 9.14 Hero carousel

O carousel existente foi preservado com:

- autoplay de seis segundos;
- pausa em hover e foco;
- navegação por setas;
- dots;
- teclado;
- swipe;
- reduced motion;
- slides reais serializáveis.

A task removeu a CTA duplicada “Ver detalhes” e manteve apenas “Ver ficha”. Nenhuma CTA de streaming foi adicionada.

## 10. Componentes criados, refatorados e removidos

### 10.1 Criados

| Componente/arquivo                | Tipo              | Responsabilidade                                                     |
| --------------------------------- | ----------------- | -------------------------------------------------------------------- |
| `page-primitives.tsx`             | Server-compatible | Breadcrumbs, introdução de página, cabeçalho de seção e estado vazio |
| `entity-detail-hero.tsx`          | Server-compatible | Hero compartilhado de filme e série                                  |
| `montserrat-latin-variable.woff2` | Asset local       | Tipografia principal sem rede em runtime                             |
| `OFL.txt`                         | Licença           | Termos de uso da Montserrat                                          |

### 10.2 Refatorados

| Componente           | Natureza              | Mudança principal                              |
| -------------------- | --------------------- | ---------------------------------------------- |
| `EntityCardLink`     | Apresentacional       | Variantes, fallback, eager e badge consistente |
| `EntityIndex`        | Apresentacional       | Primitives compartilhadas e empty state        |
| `NewsCard`           | Apresentacional       | Variantes, heading level e eager               |
| `RelatedNewsSection` | Apresentacional       | Variante relacionada e acentuação              |
| `SiteHeader`         | Client sem IO externo | Estado ativo e remoção da busca aparente       |
| `SiteFooter`         | Server puro           | Somente rotas e informações reais              |
| `HeroCarousel`       | Client sem IO externo | CTA única e honesta                            |
| `ComingSoonRail`     | Client sem IO externo | Somente lançamentos reais e reduced motion     |

### 10.3 Removidos

| Arquivo                               | Motivo                                       |
| ------------------------------------- | -------------------------------------------- |
| `episodes-ticker.tsx`                 | Dependia de composição visual de placeholder |
| `home-placeholder-governance.ts`      | Gate por ambiente deixou de ser necessário   |
| `home-placeholder-governance.test.ts` | Testava a existência do gate removido        |

## 11. Integridade de dados e fluxo de render

O fluxo continua sendo:

```text
PostgreSQL/cache local
        ↓
getter server-only
        ↓
presenter puro
        ↓
view serializável
        ↓
Server Component ou Client Component sem IO
```

Regras preservadas:

- componentes não importam `@screena/db` diretamente;
- componentes não chamam TMDB;
- componentes não chamam RapidAPI;
- componentes não chamam Gemini;
- imagens remotas são URLs públicas construídas a partir de paths já persistidos e governados;
- disponibilidade só aparece por meio da `WatchView` existente;
- ratings continuam condicionados ao presenter e às regras de licença;
- contagens são valores reais do banco;
- ausência de dado nunca é completada com item inventado.

## 12. SEO e semântica preservados

### 12.1 Elementos mantidos

- metadata por rota;
- canonical;
- robots;
- hreflang da home;
- sitemap;
- redirects de slug canônico;
- schemas de entidade;
- `BreadcrumbList`;
- `CollectionPage`;
- `ItemList` somente quando há itens;
- `Organization` e `WebSite` na home;
- H1 principal.

### 12.2 Hierarquia de headings

- cada rota verificada tem exatamente um H1;
- home usa H1 institucional visualmente oculto;
- título do slide ativo é H2;
- títulos de seção são H2;
- cards da home usam H3;
- notícia em destaque no índice usa H2;
- related news usa H3;
- empty state aceita H2 ou H3 conforme o contexto.

### 12.3 Breadcrumbs

O componente compartilhado:

- usa `<nav>` com label;
- usa lista ordenada;
- marca o item atual com `aria-current="page"`;
- aceita aparência sobre mídia;
- mantém URLs reais;
- corrige acentuação de Início, Séries e Notícias.

### 12.4 Imagens

- pôsteres usam alt com título;
- retratos usam alt com nome;
- backdrops decorativos usam alt vazio;
- notícias mantêm imagem decorativa dentro do link, com o título textual como nome acessível;
- imagens abaixo da dobra usam lazy loading;
- imagens prioritárias podem usar eager e high priority;
- dimensões permanecem declaradas quando fornecidas pela view.

## 13. Governança e testes alterados

### 13.1 Auditoria de invariantes

O script `scripts/audit/check-invariants.mjs` foi endurecido:

- removeu a opção `stripAllowedHomePlaceholderGates`;
- removeu a função que apagava o ticker permitido antes de auditar;
- deixou de excluir `episodes-ticker.tsx`, pois o arquivo não existe mais;
- manteve como exceção apenas o componente real de watch;
- trata qualquer literal fake de provider na home como violação direta;
- trata promessa de “Onde assistir” sem contrato real como violação direta.

### 13.2 Teste de UI sem streaming fictício

`no-fake-streaming-in-ui.test.ts` agora garante:

- ausência de `allowHomeVisualPlaceholders`;
- ausência de `EpisodesTicker`;
- ausência da variável de ambiente de placeholders;
- ausência de providers hardcoded;
- ausência de ranking, nota e affordance morta;
- ausência de promessa de streaming em componente sem `WatchView`;
- CTA única “Ver ficha” no hero;
- ausência de “Ver detalhes” duplicado.

### 13.3 Presenter da home

`portal-presenter.test.ts` ganhou cobertura para `interleaveUniqueByHref`:

- alternância das origens;
- preservação de ordem;
- deduplicação por href;
- listas desbalanceadas;
- aplicação do limite;
- limite zero ou negativo.

Os testes de indexabilidade também documentam a política atual:

- zero seção real: `noindex` técnico;
- uma ou mais seções reais: `index`;
- duas ou mais seções continuam sendo sinal de página rica, não gate.

### 13.4 Navegação

`public-navigation.test.ts` passou a cobrir:

- índice com barra final;
- índice sem barra final;
- rota filha;
- prefixo semelhante que não deve ativar o item;
- pathname nulo;
- existência de todas as rotas do header;
- ausência de links externos ou mortos.

## 14. Inventário completo dos 32 arquivos do commit

| Estado     | Arquivo                                                 | Finalidade da mudança                                                       |
| ---------- | ------------------------------------------------------- | --------------------------------------------------------------------------- |
| Modificado | `apps/web/app/_components/coming-soon-rail.tsx`         | Remove duração fictícia, ajusta labels, setas condicionais e reduced motion |
| Modificado | `apps/web/app/_components/entity-card.tsx`              | Adiciona variantes, fallback com monograma e prioridade de imagem           |
| Criado     | `apps/web/app/_components/entity-detail-hero.tsx`       | Unifica hero de filme e série                                               |
| Modificado | `apps/web/app/_components/entity-index.tsx`             | Usa primitives e empty state compartilhados                                 |
| Removido   | `apps/web/app/_components/episodes-ticker.tsx`          | Elimina ticker de placeholder                                               |
| Modificado | `apps/web/app/_components/hero-carousel.tsx`            | Mantém CTA única “Ver ficha”                                                |
| Modificado | `apps/web/app/_components/news-card.tsx`                | Adiciona variantes, heading level e eager                                   |
| Criado     | `apps/web/app/_components/page-primitives.tsx`          | Centraliza breadcrumbs, intros, section headers e empty states              |
| Modificado | `apps/web/app/_components/related-news-section.tsx`     | Usa variante related e corrige texto                                        |
| Modificado | `apps/web/app/_components/site-footer.tsx`              | Remove affordances falsas e mantém rotas reais                              |
| Modificado | `apps/web/app/_components/site-header.tsx`              | Adiciona estado ativo e remove pseudo-busca                                 |
| Modificado | `apps/web/app/globals.css`                              | Consolida sistema visual, páginas, componentes e breakpoints                |
| Modificado | `apps/web/app/layout.tsx`                               | Adiciona skip link e destino principal                                      |
| Modificado | `apps/web/app/pt/explorar/page.tsx`                     | Aplica primitives e section headers compartilhados                          |
| Modificado | `apps/web/app/pt/filmes/[slug]/page.tsx`                | Usa hero compartilhado e remove aviso editorial derivado de SEO             |
| Modificado | `apps/web/app/pt/filmes/page.tsx`                       | Corrige descrição e documentação de indexabilidade                          |
| Modificado | `apps/web/app/pt/noticias/page.tsx`                     | Refina índice e empty state sem fabricar notícias                           |
| Modificado | `apps/web/app/pt/page.tsx`                              | Reescreve a home com dados reais e sistema editorial final                  |
| Modificado | `apps/web/app/pt/pessoas/[slug]/page.tsx`               | Breadcrumb, labels visíveis e empty state                                   |
| Modificado | `apps/web/app/pt/pessoas/page.tsx`                      | Corrige descrição pública                                                   |
| Modificado | `apps/web/app/pt/series/[slug]/page.tsx`                | Usa hero compartilhado e corrige textos/semântica                           |
| Modificado | `apps/web/app/pt/series/page.tsx`                       | Corrige título, breadcrumb e descrição                                      |
| Criado     | `apps/web/public/fonts/OFL.txt`                         | Inclui licença da Montserrat                                                |
| Criado     | `apps/web/public/fonts/montserrat-latin-variable.woff2` | Auto-hospeda Montserrat variável                                            |
| Removido   | `apps/web/src/lib/home-placeholder-governance.ts`       | Elimina gate de placeholder por ambiente                                    |
| Modificado | `apps/web/src/lib/navigation.ts`                        | Adiciona resolução pura da rota ativa                                       |
| Modificado | `apps/web/src/lib/portal-presenter.ts`                  | Adiciona intercalação determinística e deduplicada                          |
| Modificado | `scripts/audit/check-invariants.mjs`                    | Remove exceções do antigo placeholder                                       |
| Modificado | `tests/governance/no-fake-streaming-in-ui.test.ts`      | Endurece proteção contra UI fictícia                                        |
| Removido   | `tests/web/home-placeholder-governance.test.ts`         | Remove teste do gate extinto                                                |
| Modificado | `tests/web/portal-presenter.test.ts`                    | Testa intercalação e política de indexação total                            |
| Modificado | `tests/web/public-navigation.test.ts`                   | Testa estado ativo por segmento                                             |

### 14.1 Destaques quantitativos do diff

| Arquivo         | Adições | Remoções | Leitura do impacto                      |
| --------------- | ------: | -------: | --------------------------------------- |
| `globals.css`   |   2.182 |       25 | Novo acabamento e cascade final         |
| Home            |     241 |      717 | Grande simplificação e remoção de mocks |
| Footer          |      41 |      164 | Remoção de affordances sem produto real |
| Hero de detalhe |     108 |        0 | Componente compartilhado novo           |
| Primitives      |     130 |        0 | Sistema compartilhado novo              |
| Ticker          |       0 |      170 | Placeholder removido                    |
| Filme detail    |      27 |       98 | Duplicação substituída pelo hero comum  |
| Série detail    |      32 |      104 | Duplicação substituída pelo hero comum  |
| Pessoa detail   |      27 |       39 | Semântica e estado vazio refinados      |

## 15. Validação local

### 15.1 Resultado dos comandos

| Validação                                   | Resultado                                                             |
| ------------------------------------------- | --------------------------------------------------------------------- |
| `corepack pnpm typecheck`                   | Passou                                                                |
| `corepack pnpm test`                        | Passou: 154 arquivos e 1.657 testes                                   |
| `corepack pnpm audit:invariants`            | Passou: 7 checks, 0 violações; 439 arquivos vistos no workspace local |
| `corepack pnpm audit:render`                | Passou: 74 arquivos, 0 violações no workspace local                   |
| ESLint dos arquivos alterados               | Passou                                                                |
| ESLint dos diretórios versionados           | Passou                                                                |
| `corepack pnpm --filter @screena/web build` | Passou                                                                |
| Parse de `globals.css` pelo Prettier        | Passou                                                                |
| `git diff --check`                          | Passou                                                                |
| Revisão independente do diff                | Aprovada sem bloqueadores                                             |

Os totais locais de arquivos auditados são maiores que os do CI porque o workspace continha materiais não versionados. O checkout limpo do CI auditou 429 arquivos nas invariantes e 73 arquivos no render, também sem violações.

### 15.2 Build local final

- Next.js: 15.5.19;
- compilação otimizada concluída com sucesso;
- `/pt` com First Load JS de aproximadamente 104 kB;
- demais rotas públicas com First Load JS de aproximadamente 102 kB;
- shared JS de aproximadamente 102 kB;
- middleware de aproximadamente 34,6 kB;
- rotas públicas dinâmicas preservadas;
- nenhum erro de typecheck ou geração de página.

O aviso de Autoprefixer para `align-items: end` foi resolvido trocando o valor flexível por `align-items: flex-end`. O build final não repetiu esse aviso.

Permaneceu um aviso não bloqueante de configuração: o plugin do Next.js não é detectado pelo ESLint atual. O aviso já pertence à configuração do projeto e não impediu o lint nem o build.

O CI também registrou dois avisos ambientais não bloqueantes: a configuração Prisma em `package.json` está marcada para depreciação futura e o cache de build do Next não foi encontrado. O cache do pnpm foi restaurado normalmente. Nenhum desses avisos foi introduzido ou alterado nesta task.

### 15.3 Lint global no workspace local

O comando global que varre `eslint .` encontrou 223 erros somente no bundle visual local não versionado `20Screena20Cinematic20System%2013v/`. Esses arquivos usam globais de browser e não fazem parte do repositório ou do commit.

A task não:

- editou o bundle;
- apagou o bundle;
- adicionou ignore artificial para esconder o problema;
- incluiu o bundle na PR.

O lint dos arquivos versionados passou localmente e o lint global do checkout limpo passou no GitHub Actions, confirmando que a implementação não carrega essas falhas.

### 15.4 Versão local do Node

O ambiente local estava em Node `24.14.0`, enquanto o projeto declara `>=22 <23`. Isso gerou warning de engine em comandos pnpm, mas não falha funcional.

O CI executou em Node 22 e pnpm 9.15.4, eliminando essa diferença ambiental.

## 16. CI remoto

O workflow “Typecheck, lint, test, auditorias e build publico” passou em checkout limpo.

| Campo          | Valor                                      |
| -------------- | ------------------------------------------ |
| Run            | `29351882434`                              |
| Job            | `87149866196`                              |
| Evento         | `pull_request`                             |
| Head SHA       | `78ce02bf95236567cfddb8c9cab138ae55c153d0` |
| Duração do job | 1 minuto e 43 segundos                     |
| Runner         | Ubuntu 24.04                               |
| Node           | 22.23.1                                    |
| pnpm           | 9.15.4                                     |
| Conclusão      | Success                                    |

O job principal levou 1 minuto e 43 segundos. Considerando a criação e o encerramento do run, a execução completa levou aproximadamente 1 minuto e 48 segundos.

Etapas concluídas com sucesso:

1. checkout;
2. setup do pnpm;
3. setup do Node 22;
4. instalação de dependências;
5. validação de scripts de backup;
6. geração do Prisma Client;
7. typecheck;
8. lint;
9. testes;
10. auditoria de invariantes;
11. auditoria de render público;
12. build do app público;
13. cleanup do job.

No checkout limpo do CI:

- 154 arquivos de teste passaram;
- 1.657 testes passaram;
- a etapa de testes levou aproximadamente 34,40 segundos;
- 7 checks de invariantes passaram;
- 0 violação de invariantes;
- 429 arquivos foram considerados pela auditoria de invariantes;
- 73 arquivos foram considerados pela auditoria de render;
- 0 violação de render;
- build do Next.js 15.5.19 concluído em aproximadamente 9,4 segundos.
- sete páginas estáticas de infraestrutura foram geradas durante o build.

## 17. QA de rotas e DOM

Após um restart limpo do servidor local, nove rotas públicas foram verificadas.

| Rota                               | HTTP |  H1 | Canonical | Robots                                | JSON-LD                 | Observação                         |
| ---------------------------------- | ---: | --: | --------- | ------------------------------------- | ----------------------- | ---------------------------------- |
| `/pt/`                             |  200 |   1 | Presente  | Coerente                              | Presente                | Home real                          |
| `/pt/explorar/`                    |  200 |   1 | Presente  | Coerente                              | Presente                | Hub sem busca fake                 |
| `/pt/filmes/`                      |  200 |   1 | Presente  | Coerente                              | Presente                | Listagem de filmes                 |
| `/pt/series/`                      |  200 |   1 | Presente  | Coerente                              | Presente                | “Séries” retestado com acento      |
| `/pt/pessoas/`                     |  200 |   1 | Presente  | Coerente                              | Presente                | Listagem neutra                    |
| `/pt/noticias/`                    |  200 |   1 | Presente  | `noindex, nofollow` no snapshot vazio | Presente                | Estado técnico vazio correto       |
| `/pt/filmes/abuela-tremenda-2026/` |  200 |   1 | Presente  | Coerente                              | `Movie` e breadcrumb    | Filme real disponível no snapshot  |
| `/pt/series/rancho-dutton-2026/`   |  200 |   1 | Presente  | Coerente                              | `TVSeries` e breadcrumb | Série real disponível no snapshot  |
| `/pt/pessoas/aayushi-jaiswal/`     |  200 |   1 | Presente  | Coerente                              | `Person` e breadcrumb   | Pessoa real disponível no snapshot |

Também foram verificados:

- navegação pública completa;
- rota ativa coerente;
- classes novas presentes no HTML;
- ausência de provider hardcoded;
- ausência de streaming falso;
- ausência de rating falso;
- ausência de placeholder reativado;
- ausência de CTA “Onde assistir” sem contrato real;
- título e breadcrumb “Séries” com acentuação correta.

### 17.1 Slug sugerido no pedido

O pedido citava `/pt/filmes/a-origem/`. Esse slug não existe no snapshot local atual e retornou 404. A listagem local também não continha o slug.

Para validar a rota de detalhe com dados reais, foi usado `/pt/filmes/abuela-tremenda-2026/`.

Essa diferença é estado de dados local, não regressão do frontend.

### 17.2 Reinício do servidor

A primeira instância local estava contaminada por um processo de desenvolvimento anterior e apresentou esgotamento do pool do Prisma. O processo antigo foi encerrado, o servidor foi iniciado limpo e a bateria de nove rotas passou integralmente.

## 18. Screenshots e validação visual

### 18.1 Tentativa realizada

O fluxo de navegador in-app foi carregado e tentou selecionar um runtime para `http://localhost:3000/pt/`.

O ambiente respondeu:

```text
No browser is available
```

A listagem de navegadores também retornou vazia.

### 18.2 Consequência

- nenhuma screenshot foi gerada;
- nenhuma screenshot foi commitada;
- não foi usada automação standalone de navegador fora do runtime autorizado;
- não foi feita afirmação de inspeção pixel a pixel;
- overflow visual real não pôde ser comprovado por captura.

### 18.3 Evidência substituta disponível

Foram usados como evidência parcial:

- compilação do CSS;
- presença dos breakpoints;
- inspeção do DOM;
- HTTP 200;
- contagem de H1;
- canonical, robots e JSON-LD;
- inspeção estrutural de grids e layouts;
- revisão independente do cascade;
- ausência de larguras inline obviamente excessivas.

Essa evidência não substitui a revisão visual humana pedida. A PR permanece draft justamente para staging e aprovação visual.

## 19. Achados resolvidos na revisão final

A revisão independente encontrou pontos de acabamento que foram corrigidos antes do commit:

- badge de tipo preservado no card compacto;
- grid mobile ajustado para evitar compressão;
- hero sem pôster tratado separadamente;
- tracks de Explorar ajustadas para tablet;
- ordem de headings da home corrigida;
- `dl`, `dt` e `dd` da faixa de contagens mantidos semanticamente corretos;
- notícia recebeu tratamento neutro, sem herdar vermelho de filme;
- pessoa recebeu contraste neutro;
- primeira imagem relevante ganhou eager/high priority;
- empty states da home passaram a usar H3;
- setas mortas do rail foram ocultadas quando desnecessárias;
- função de intercalação saiu da página e ganhou testes puros;
- whitelist antiga de placeholder foi removida da auditoria;
- contraste do rodapé foi refinado;
- layout sem backdrop e sem pôster foi testado estruturalmente;
- reduced motion e forced colors foram fechados;
- `align-items: end` foi trocado por `flex-end` no contexto flex.

O revisor aprovou o diff final sem bloqueadores.

## 20. Higiene do workspace e do commit

O workspace continha materiais locais não relacionados:

- `.agents/`;
- diretórios adicionais em `.claude/skills/`;
- `.codex/`;
- `skills-lock.json`;
- `20Screena20Cinematic20System%2013v.zip`;
- diretório extraído `20Screena20Cinematic20System%2013v/`.

Esses materiais:

- foram preservados;
- não foram apagados;
- não foram alterados como parte da implementação;
- não foram adicionados com `git add .`;
- não entraram no commit;
- não entraram na PR.

Os 32 caminhos intencionais foram staged explicitamente.

O bundle visual extraído foi consultado somente como referência de direção visual. Ele não é dependência do app e não foi versionado.

## 21. O que não foi alterado

Não houve mudança em:

- banco de dados;
- schema Prisma;
- migrations;
- seeds;
- workers;
- serviços de sync;
- client TMDB;
- qualquer novo client de API;
- Gemini;
- Entity Writer;
- `content_blocks`;
- licenças de fonte de rating;
- atribuição IMDb;
- atribuição Rotten Tomatoes;
- escalas de rating;
- `screen_score`;
- `external_ratings`;
- `display_allowed`;
- promoção de streaming;
- coleta de ofertas;
- contratos de `WatchView`;
- sitemap;
- robots global;
- rotas públicas;
- redirects canônicos;
- dependências do monorepo;
- package manifests;
- configuração de deploy.

## 22. Matriz de aceite

| Critério                                                      | Estado                                                   | Evidência                                                |
| ------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| Site deve parecer produto público, não protótipo              | Implementado; aprovação visual humana pendente           | Sistema visual, primitives, home e detalhes unificados   |
| Home, listagens e detalhes devem compartilhar o mesmo sistema | Concluído                                                | Montserrat, tokens, page primitives, cards e detail hero |
| Tema claro paper/cream                                        | Concluído                                                | Tokens `--bg-page`, `--bg-warm`, `--bg-tint`             |
| Montserrat como família principal                             | Concluído                                                | WOFF2 local e OFL                                        |
| Mobile não deve quebrar                                       | Cobertura estrutural concluída; inspeção visual pendente | Breakpoints 820, 640 e 440 px                            |
| Sem overflow horizontal                                       | Não comprovado visualmente                               | Browser indisponível; revisar em staging                 |
| Streaming real continua gateado                               | Concluído                                                | `WatchAvailabilityPanel` e presenter preservados         |
| “Disponibilidade no Brasil” visualmente finalizada            | Concluído no CSS; revisar com dados de staging           | Painel e offers refinados sem mudar contrato             |
| Nenhum streaming fake                                         | Concluído                                                | Teste de governança e auditoria verdes                   |
| Nenhum rating fake                                            | Concluído                                                | Testes e ausência de mudanças no contrato                |
| Nenhuma notícia fake                                          | Concluído                                                | Empty state honesto e cards apenas de dados reais        |
| Nenhum CTA falso                                              | Concluído                                                | Busca aparente, newsletter e CTA duplicada removidas     |
| Canonical e metadata preservados                              | Concluído                                                | QA de nove rotas                                         |
| JSON-LD preservado                                            | Concluído                                                | QA de nove rotas e build                                 |
| Um H1 por página                                              | Concluído                                                | QA de nove rotas                                         |
| Screenshots                                                   | Bloqueado pelo ambiente                                  | Nenhum browser disponível                                |
| Typecheck                                                     | Concluído                                                | Local e CI verdes                                        |
| Testes                                                        | Concluído                                                | 1.657 testes verdes                                      |
| Auditorias                                                    | Concluído                                                | 0 violações locais e no CI                               |
| Build                                                         | Concluído                                                | Local e CI verdes                                        |
| PR exclusiva de frontend                                      | Concluído                                                | PR #60                                                   |
| Não fazer merge                                               | Respeitado                                               | PR permanece draft                                       |

## 23. Riscos e limitações conhecidos

### 23.1 Revisão visual ainda obrigatória

O principal risco restante é visual. CSS, DOM e breakpoints foram revisados, mas não houve screenshot real. Antes do merge, staging deve confirmar composição, clipping, altura do hero, grids, hover, foco e scroll horizontal.

### 23.2 Variação de dados reais

O snapshot local não representa todas as combinações possíveis. Staging deve validar:

- título muito longo;
- sinopse longa;
- ausência de pôster;
- ausência de backdrop;
- ausência dos dois tipos de mídia;
- pessoa sem foto;
- página sem blocos editoriais;
- série com muitas temporadas;
- episódio sem título;
- disponibilidade com todos os grupos;
- disponibilidade com um único grupo;
- provider com preço longo;
- notícia com e sem imagem;
- catálogo vazio e catálogo amplo.

### 23.3 CSS acumulado

`globals.css` mantém seletores históricos de fases anteriores por compatibilidade. A task adicionou e limpou o cascade final necessário, inclusive removendo um bloco intermediário duplicado de 902 linhas durante a revisão, mas não fez uma remoção completa de CSS morto.

Entre os nomes legados ainda presentes no CSS estão:

- `.home-v4-ad-placeholder`;
- `.home-v4-trailer-duration`;
- `.home-v4-rating-row`;
- `.home-v4-compact-rating`;
- `.home-v4-media-rating`;
- seletores antigos do ticker removido;
- comentários históricos sobre ranking e “Onde assistir”.

Esses seletores e comentários não reativam conteúdo no React atual. A afirmação correta é “placeholders removidos do render público”, não “todo vestígio de CSS de placeholder foi apagado”.

Uma limpeza futura deve usar cobertura visual e inventário de classes para evitar apagar estilos ainda usados por páginas públicas.

### 23.4 Configuração ESLint/Next

O build informa que o plugin Next não é detectado na configuração ESLint. Não é regressão desta task, mas vale alinhar em uma mudança separada.

### 23.5 Estado local de notícias

`/pt/noticias/` estava vazio no snapshot local e, corretamente, respondeu `noindex, nofollow`. O visual com notícia real deve ser conferido em staging ou em um snapshot local com conteúdo publicável.

### 23.6 Slug `a-origem`

O slug citado no pedido não existe no snapshot local. A existência e a disponibilidade desse título dependem do estado do banco do ambiente em que a revisão visual ocorrer.

### 23.7 Catálogo pequeno na home

Como os destaques são retirados das grades seguintes para impedir repetição, um catálogo pequeno pode exibir filmes ou séries em “Descubra no Screen” e, ao mesmo tempo, mostrar o estado vazio da grade específica daquela vertical. Não há dado falso ou quebra de SEO, mas a composição deve ser observada em staging para decidir se a mensagem é adequada ao produto.

### 23.8 Comentário técnico legado na página de filme

Um comentário superior da rota de filme ainda descreve elenco e “Onde assistir” como fora do hero/escopo visual, enquanto o código preserva `CastStrip` e `WatchAvailabilityPanel` condicionais em seções posteriores. A implementação está correta; o comentário histórico merece limpeza documental separada.

## 24. Checklist recomendado para staging

### 24.1 Rotas

- [ ] `/pt/`
- [ ] `/pt/filmes/`
- [ ] detalhe real de filme com backdrop e pôster
- [ ] detalhe real de filme sem uma das mídias
- [ ] `/pt/series/`
- [ ] detalhe real de série com temporadas e episódios
- [ ] `/pt/pessoas/`
- [ ] detalhe real de pessoa com filmografia
- [ ] detalhe real de pessoa vazio
- [ ] `/pt/noticias/` com notícia real
- [ ] `/pt/noticias/[slug]`
- [ ] `/pt/explorar/`

### 24.2 Larguras

- [ ] 390 px
- [ ] 768 px
- [ ] 1280 px
- [ ] 1440 px

### 24.3 Comportamentos

- [ ] header transparente sobre o hero da home
- [ ] header sólido após scroll
- [ ] rota ativa no header
- [ ] nav mobile rolável sem cortar o último item
- [ ] skip link visível no foco
- [ ] foco visível em links e botões
- [ ] hero carousel por teclado
- [ ] hero carousel por swipe
- [ ] carousel sem autoplay com reduced motion
- [ ] rail de lançamentos sem setas quando há até três itens
- [ ] cards sem imagem
- [ ] cards com título longo
- [ ] detalhe sem pôster
- [ ] detalhe sem backdrop
- [ ] painel real de disponibilidade
- [ ] contraste de notícias e pessoas
- [ ] footer em conteúdo curto e longo
- [ ] ausência de overflow horizontal

### 24.4 SEO e honestidade

- [ ] exatamente um H1 por rota
- [ ] canonical autorreferente
- [ ] robots coerente com o estado técnico
- [ ] JSON-LD válido
- [ ] nenhum provider sem oferta real
- [ ] nenhuma nota sem fonte permitida
- [ ] nenhuma notícia mockada
- [ ] nenhuma CTA sem destino real

## 25. Cronologia resumida

| Horário BRT        | Marco                                                                |
| ------------------ | -------------------------------------------------------------------- |
| 13:08:44           | Branch criada a partir de `origin/main` em `ffbc1341`                |
| Durante a execução | Auditoria visual e inventário de páginas/componentes                 |
| Durante a execução | Implementação da home, primitives, detalhes, listagens e sistema CSS |
| Durante a execução | Cleanup de CSS e revisão independente                                |
| Durante a execução | QA local de nove rotas                                               |
| 13:58:22           | Commit `78ce02b` criado                                              |
| Após o commit      | Branch enviada para `origin`                                         |
| 13:59:10           | PR draft #60 aberta contra `main`                                    |
| 14:01:00           | CI da implementação concluído com sucesso                            |

## 26. Git e Pull Request

### 26.1 Branch

```text
feat/public-frontend-final-polish
```

### 26.2 Base

```text
ffbc1341ad3b248e4406735f899447e4fec07beb
```

O parent do commit de implementação, o `origin/main` usado na criação e o merge-base eram o mesmo SHA.

### 26.3 Commit de implementação

```text
78ce02bf95236567cfddb8c9cab138ae55c153d0
feat(web): finalize public frontend visual polish
```

### 26.4 Pull request

- número: 60;
- base: `main`;
- head: `feat/public-frontend-final-polish`;
- estado: aberta;
- modo: draft;
- mergeable: sim;
- merge state da implementação: clean;
- reviews formais no momento do relatório: zero;
- comentários e review threads no momento do relatório: zero;
- merge: não realizado;
- checks da implementação: verdes;
- URL: `https://github.com/maquinanerd/screena/pull/60`.

O corpo da PR inclui:

- resumo visual;
- páginas alteradas;
- componentes criados e refatorados;
- escopo preservado;
- validações;
- QA de rotas;
- limitação de screenshots;
- diferença de Node local;
- falha local do lint causada pelo bundle não versionado;
- necessidade de revisão visual em staging.

## 27. Comandos relevantes executados

```powershell
corepack pnpm typecheck
corepack pnpm test
corepack pnpm audit:invariants
corepack pnpm audit:render
corepack pnpm --filter @screena/web build
corepack pnpm exec prettier "apps/web/app/globals.css" | Out-Null
git diff --check
```

Também foram executados:

- ESLint escopado aos arquivos alterados;
- ESLint nos diretórios versionados;
- servidor local do app público;
- requests HTTP para as nove rotas;
- inspeção de H1, canonical, robots e JSON-LD;
- `gh auth status`;
- push com tracking da branch;
- abertura de PR draft pelo conector GitHub;
- consulta e acompanhamento do GitHub Actions até `success`.

## 28. Resultado final

A implementação atingiu o objetivo técnico e de sistema visual:

- o frontend público tem uma direção editorial única;
- home, listagens, detalhes, notícia e Explorar compartilham linguagem;
- componentes repetidos foram consolidados;
- placeholders e affordances fictícias foram removidos;
- o render continua puro;
- streaming e ratings continuam governados;
- SEO estrutural foi preservado;
- acessibilidade e responsividade foram fortalecidas;
- testes, auditorias, build e CI estão verdes;
- a mudança está isolada em PR draft;
- nenhum merge foi realizado.

O único critério sem evidência visual direta é a inspeção por screenshots nas quatro larguras solicitadas. Essa validação deve ser feita em staging antes de converter a PR para ready for review ou autorizar merge.
