# Fase 0 — auditoria do port canônico cinematográfico

## 1. Objetivo e regra de autoridade

Esta branch existe para portar, com máxima fidelidade, o pacote **Screena White
Cinematic Editorial System 13v** para o app público real da Cinerie. O trabalho
não reaproveita a interpretação visual da PR #60 e não parte de nenhum commit
daquela branch.

A ordem de autoridade adotada é a definida pelo próprio pacote:

1. `Screen Screens v4.dc.html`;
2. `paginas/00-principal-completo.html`;
3. `docs/implementacao-fiel-screen-v4.md`;
4. HTML individual em `paginas/`;
5. Markdown individual em `paginas/`;
6. contratos e inventários canônicos atualizados;
7. material histórico apenas como arquivo, nunca como fonte de implementação.

Diretórios e arquivos marcados como legados no pacote não serão usados para
tomar decisões visuais: `screen-v4-design-handoff/`,
`design_handoff_the_screen/`, `handoff/`, `backups/`, `LEGACY__*`, versões
`*-print-*`, protótipos v2 e o documento revertido `docs/mapa-de-padroes.md`.

## 2. Verificação forense do artefato

O ZIP recebido foi lido em
`E:\Área de Trabalho 2\20Screena20Cinematic20System%2013v.zip` e extraído
somente para uma pasta temporária fora do repositório.

| Verificação          | Resultado                                                                    |
| -------------------- | ---------------------------------------------------------------------------- |
| Tamanho do ZIP       | 136.489.068 bytes                                                            |
| SHA-256 do ZIP       | `47ba0e7ad845f02f22c74654f7e23faa81614f3e18d2d7f04ef95ae496fa41e4`           |
| Entradas no ZIP      | 458                                                                          |
| Bytes descompactados | 140.902.710                                                                  |
| Arquivo canônico     | `Screen Screens v4.dc.html`                                                  |
| Tamanho canônico     | 340.582 bytes — confere                                                      |
| SHA-256 canônico     | `cb852d6f4b012c9c1351ce7c506994e3a863e1d8592f55868e06ea23fc69973d` — confere |
| Cópia declarada      | `paginas/00-principal-completo.html`                                         |
| Identidade da cópia  | mesmo tamanho, mesmo SHA-256 e igualdade byte a byte — confere               |

O arquivo canônico contém 18 telas, chrome compartilhado, 23 posições de
anúncio, 31 slots de imagem, 1.740 declarações `style`, 41 estados
`style-hover` e o sprite de ícones descrito no handoff.

## 3. Estado Git e isolamento da PR #60

- PR #60: aberta, `draft`, `mergeStateStatus=CLEAN` no momento da auditoria.
- A PR #60 não foi convertida para pronta, não foi mesclada e não foi alterada.
- Branch abandonada para este trabalho: `feat/public-frontend-final-polish`.
- Nova branch: `feat/web-canonical-cinematic-port`.
- Base exata: `origin/main` em
  `ffbc1341ad3b248e4406735f899447e4fec07beb`.
- `merge-base` da nova branch com `origin/main`: o mesmo SHA acima.
- Nenhum commit, CSS, componente ou asset da PR #60 foi transplantado.
- Arquivos locais não rastreados que já existiam no workspace foram
  preservados e ficam fora do escopo e do staging.

## 4. Stack e fronteiras encontradas no app real

O app público usa Next.js 15 App Router, React 19 e TypeScript estrito. A UI
vive principalmente em `apps/web/app/**`; os contratos de apresentação ficam
em `apps/web/src/lib/**`; as consultas server-only ficam em
`apps/web/src/server/**`.

O port pode ficar restrito à camada de apresentação:

- `apps/web/app/**`;
- `apps/web/public/**`;
- testes e auditorias que descrevem a estrutura visual;
- presenters puros apenas se uma forma visual exigir um campo já persistido.

Não há necessidade técnica de alterar:

- `packages/db/**` ou Prisma;
- schema, migrations ou seeds;
- `services/**`;
- `api-clients/**`;
- `workers/**`;
- ingestão, ratings, streaming ou Entity Writer;
- decisões de licença, publicação ou indexabilidade em massa.

As páginas públicas continuarão lendo somente PostgreSQL/cache local. Nenhuma
API externa ou Gemini será introduzida no render.

## 5. Rotas reais e contratos de dados existentes

| Superfície canônica             | Rota real                    | Dados já disponíveis                                                                |
| ------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------- |
| Home (`02`)                     | `/pt/`                       | hero curado, filmes, séries, pessoas, notícias, próximos lançamentos e contagens    |
| Notícias (`03`)                 | `/pt/noticias/`              | destaque, feed e metadados editoriais                                               |
| Categoria (`04`)                | `/pt/filmes/`, `/pt/series/` | cards reais e total da vertical                                                     |
| Artigo (`05`)                   | `/pt/noticias/[slug]/`       | título, deck, autor, data, corpo, fonte e relacionados                              |
| Filme (`06`)                    | `/pt/filmes/[slug]/`         | ficha, mídia, blocos publicados, elenco, links externos, notícias e watch governado |
| Série (`07`/`08`)               | `/pt/series/[slug]/`         | ficha, mídia, temporadas, episódios, elenco, notícias e watch governado             |
| Pessoa (`09`)                   | `/pt/pessoas/[slug]/`        | perfil, biografia publicada, créditos, links e notícias                             |
| Browse/Discover (`10`/`11`)     | `/pt/explorar/`              | coleções reais de filmes, séries, pessoas e notícias                                |
| Mais aguardados (`12`)          | sem rota dedicada            | somente próximos filmes já persistidos, sem ranking social/salvos                   |
| Configurações (`13`)            | sem produto autenticado      | indisponível                                                                        |
| Dados/importação (`14`)         | sem produto autenticado      | indisponível                                                                        |
| Listas (`15`)                   | sem produto autenticado      | indisponível                                                                        |
| Entrar/cadastrar (`16`)         | sem autenticação real        | indisponível                                                                        |
| Pop-up/interstitial (`17`/`18`) | sem runtime publicitário     | indisponível                                                                        |

Todos os getters server-only, redirects canônicos, metadata, robots, canonical,
hreflang e JSON-LD existentes devem sobreviver à troca de markup.

## 6. Mapeamento visual obrigatório

### Fundação e chrome

- fundo global `#FDFDFD` e superfícies claras do arquivo canônico;
- container desktop de 1.280 px; nav com trilho de até 1.380 px e 80 px de
  padding lateral;
- nav fixa de 72 px;
- Montserrat variável, com pesos reais 500, 600, 650, 700, 750, 800 e 900;
- vermelho `#F0443E` para filme, verde `#7FA56F` para série e amarelos
  `#F5C518`/`#F5C84B` apenas para energia/rating;
- todos os raios preservados individualmente; é proibida qualquer regra que os
  normalize;
- logo no `viewBox="0 0 406 78"`, dimensões e variantes por contexto iguais ao
  canônico; sufixo NEWS em toda a superfície editorial de notícias;
- footer na mesma ordem, proporção, grid, espaçamento e tratamento de marca.

### Ordem canônica da home

1. hero full-bleed;
2. ticker de episódios, quando houver agenda real;
3. Top 10, somente quando existir ranking real completo;
4. leaderboard;
5. filmes em alta;
6. faixa de números mensais, somente para usuário real;
7. leaderboard;
8. séries da semana;
9. continuar assistindo, somente para usuário real;
10. em breve;
11. leaderboard;
12. Top News.

A ausência de dado não autoriza reordenar os blocos restantes. Cada seção será
implementada em sua posição original e condicionada pelo contrato de dados.

### Demais páginas

As ordens internas declaradas nos comentários do HTML canônico serão mantidas:
hero, faixas de mídia, awards, sinopse, guia editorial, elenco, notícias,
detalhes e recomendações; magazine/rail/feed nas notícias; e os layouts
específicos de pessoa, explorar e artigo. Nenhuma página será transformada em
dashboard, catálogo genérico ou landing page alternativa.

## 7. Responsividade

O desktop de 1.280–1.440 px é a referência pixel-fiel. As derivações abaixo
seguem apenas o contrato do pacote:

- ≥1.440: container de 1.280 px centralizado;
- 1.280–1.439: estado canônico;
- 1.024–1.279: padding de 48 px e redução conservadora de colunas;
- 768–1.023: padding de 32 px, sidebars abaixo do conteúdo e skyscraper oculto;
- ≤767: padding de 20 px, nav mobile, rails com swipe e grids previstos;
- ≤390: padding de 16 px e tetos tipográficos do contrato.

Não haverá alteração de valores desktop para acomodar o mobile. Aspect ratios,
ordem do DOM e crop `object-fit: cover` são invariantes visuais.

## 8. Semântica, acessibilidade e comportamento

As limitações semânticas do protótipo não serão copiadas:

- `span` de navegação vira `Link`/`a` real;
- ação vira `button` real;
- landmarks, headings e formulários seguem o contrato do pacote;
- cada rota mantém exatamente um `h1`;
- foco visível, hit target mínimo 44×44 px, `aria-current`, labels de ícones,
  alt de mídia e `prefers-reduced-motion` são obrigatórios;
- mudanças semânticas não podem mudar a aparência aprovada.

O runtime `support.js`, `data-dc-*`, `hint-*`, `<helmet>`, o switcher de frames
e os web components de drag-and-drop não serão portados.

## 9. Dados fictícios e features ainda inexistentes

Os arrays da classe `Component` existem para o protótipo pintar; não são fonte
de verdade de produção. O contrato canônico determina:

- nenhuma manchete, episódio, plataforma, nota, contagem, ranking ou progresso
  inventado;
- nenhuma ação de watchlist, avaliação, login, lista ou importação apresentada
  como funcional sem backend real;
- bloco sem dado real não renderiza, mas sua posição e implementação continuam
  preservadas no código;
- nota só aparece quando o contrato de display/licença existente permitir;
- disponibilidade só aparece via `watch_availability` governada;
- fallbacks visuais podem usar os gradientes canônicos e `—` para metadado
  opcional, sem afirmar fatos.

Para validação visual integral, o HTML canônico continuará sendo a referência
lado a lado. Mocks do pacote não serão copiados para páginas indexáveis.

## 10. Publicidade

O design contém exatamente 23 posições. O repo não possui configuração de
AdSense aprovada. Portanto:

- todas as posições e dimensões serão modeladas no componente `AdSlot`;
- em desenvolvimento, o placeholder tracejado pode identificar o formato;
- em produção, a área pode ser reservada sem script externo e sem claim falso;
- nenhuma nova posição será criada e nenhuma integração externa será inventada;
- a ausência do runtime AdSense será registrada em `DIVERGENCIAS.md` até haver
  configuração humana aprovada.

## 11. Assets e tipografia

- O pacote não contém um arquivo Montserrat, embora exija Montserrat variável e
  referencie Google Fonts no protótipo.
- O produto não deve depender de import externo de fonte no render. A mesma
  família será auto-hospedada com licença OFL e `font-weight: 100 900`.
- Os SVGs de logo do pacote e o markup canônico foram auditados; eles usam
  glifos `<text>` no `viewBox` oficial, além da caixa colorida. O port não
  redesenhará esses glifos nem trocará proporções.
- Imagens de catálogo/editoriais virão dos presenters existentes. Uploads,
  screenshots e referências históricas do ZIP não serão promovidos a conteúdo
  real.

## 12. Fases e commits

1. Fase 0 — este relatório e auditoria.
2. Fase 1 — tokens, Montserrat, logo, ícones, chrome, `AdSlot` e mídia base.
3. Fase 2 — home.
4. Fase 3 — detalhe de filme.
5. Fase 4 — detalhe de série e linguagem mobile.
6. Fase 5 — pessoa.
7. Fase 6 — notícias, categoria editorial e artigo.
8. Fase 7 — explorar/browse e próximos lançamentos reais.
9. Fase 8 — superfícies de usuário somente dentro dos contratos reais; qualquer
   item sem backend permanece explicitamente diferido.
10. Fase 9 — inventário e comportamento dos 23 slots publicitários.
11. Fase 10 — responsividade e acessibilidade.
12. Fase 11 — auditoria final, screenshots, divergências e suíte completa.

Cada fase terá commit próprio. A implementação não será reunida em um commit
visual monolítico.

## 13. Validação planejada

- comparação lado a lado por rota em 1.280 px com o HTML canônico;
- inspeções adicionais em 1.440, 1.024, 768, 390 e 320 px;
- teste de ordem estrutural e tokens que não permita nova interpretação;
- auditoria das 23 posições de anúncio e 31 categorias de slot de imagem;
- busca por imports externos de fonte e por features/mocks proibidos;
- `corepack pnpm typecheck`;
- `corepack pnpm lint`;
- `corepack pnpm test`;
- `corepack pnpm audit:invariants`;
- `corepack pnpm audit:render`;
- `corepack pnpm --filter @screena/web build`.

Toda divergência inevitável será descrita em `DIVERGENCIAS.md`. A entrega não
usará a expressão “100% fiel” sem evidência visual e inventário de diferenças.
