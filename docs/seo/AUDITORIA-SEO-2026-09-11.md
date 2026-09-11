# Auditoria de SEO — Cinerie (`https://cinerie.com`)

> **Data:** 11/09/2026. **Escopo:** site público ao vivo + código (`apps/web`,
> `packages/seo`), na worktree `objective-gauss-33f1fd` (HEAD `a74b97f`).
>
> **Método:** cinco auditorias independentes — técnica e sitemaps (73
> requisições), dados estruturados (18), conteúdo/E-E-A-T/GEO (18), revisão de
> código (~29 arquivos) e desempenho — consolidadas aqui sem repetição.
>
> **Marcação de evidência, em todo o documento:** **MEDIDO** = observado ao vivo
> nesta data; **LI** = lido no código; **INFERIDO** = deduzido do que foi medido.
> Nenhum número abaixo é estimativa de terceiro repetida sem conferência.
>
> **Não foram usados** Search Console, CrUX autenticado nem Rich Results Test
> (ferramentas externas fora do alcance desta sessão). Onde a elegibilidade a
> *rich result* é citada, ela é INFERIDA da documentação do Google.

---

## 1. Veredito

**Nada do que a política quer indexado está sendo impedido hoje.** As duas
proteções mais sensíveis funcionam no ar: temporada e episódio saem
`noindex, follow` e ficam fora do sitemap (a válvula de 27/08 está de pé), e
`/en/` e `/es/` respondem 404 sem `hreflang` apontando para elas. O HTML servido
ao Googlebot é idêntico ao do navegador, o conteúdo principal vem no SSR e o
schema bate com a rota em 15/15 páginas amostradas. **Nenhum `AggregateRating`
foi emitido** — o Cinerie Score não virou nota de terceiro em lugar nenhum.

O risco não está no que está publicado: está em **quatro coisas que já têm data
ou já custam tráfego**.

1. **O sitemap tem um teto que zera o índice inteiro** quando ultrapassado —
   e a projeção põe o estouro entre ~21/10 e ~06/11/2026.
2. **42,7% do sitemap são galerias sem texto próprio** (69.016 URLs), que
   competem por rastreio com as fichas.
3. **`og:image` não existe fora de notícia** — toda ficha compartilhada em
   WhatsApp, X ou Facebook sai sem imagem.
4. **Não existe Sobre, Contato, Política editorial nem página de autor** — o
   conjunto de sinais de E-E-A-T que um site com opinião editorial e notas
   agregadas mais precisa ter.

---

## 2. Placar por área

| Área | Estado | Em uma linha |
|---|---|---|
| Rastreio e redirects | **Bom, com ressalva** | HTTPS, HSTS, barra final e 404 corretos; `www` responde 200 sem redirecionar |
| Indexabilidade | **Risco alto** | Teto do sitemap com data; galerias e pessoas em desacordo entre página e sitemap |
| Sitemaps | **Atenção** | Bem-formados e dentro dos limites, mas lentos (12–20 s) e sem cache |
| Dados estruturados | **Bom núcleo, lacunas altas** | Tipo certo por rota e zero `AggregateRating`; falta `image` e o ItemList das listagens descreve o que não está na página |
| Social / Open Graph | **Alto** | `og:image` só em notícia; `twitter:card=summary` no resto |
| Conteúdo e E-E-A-T | **Crítico** | Sem Sobre/Contato/Política editorial/Autor; sinopses curtas; FAQ zero |
| GEO (busca com IA) | **Decisão pendente** | Crawlers de *treino* bloqueados na borda; os de *busca* liberados |
| Desempenho | Ver §7 | — |

---

## 3. Achados altos e críticos

### 3.1 O teto de 300.000 URLs zera o índice inteiro — e há data provável
**ALTO · MEDIDO + LI + INFERIDO**

- `SITEMAP_TOTAL_URL_CEILING = 300_000` (`apps/web/src/server/seo/sitemap-index.ts:218`).
  Acima dele, `getSitemapIndexXml` lança e o `catch` publica um **índice vazio**
  (`:1048-1051`, `:1073-1077`) — *fail-closed* que apaga o sitemap inteiro, não
  só o tipo que estourou.
- Hoje: **161.673 URLs** (53,9% do teto). Em 27/08 eram 110.498 (número escrito
  no próprio código): **+51.175 em 15 dias**.
- Projeção linear: estouro entre **~21/10 e ~06/11/2026** (INFERIDO).
- Hoje o único aviso é um `console.error` **depois** de o índice já ter saído
  vazio.

**Correção:** teto **por tipo** (derruba só o tipo que estourou), alerta antes do
corte, e decidir o que fica no sitemap (§3.2).

### 3.2 Galerias: 69.016 URLs (42,7% do sitemap) sem conteúdo próprio
**ALTO · MEDIDO**

- `/pt/filmes/{slug}/imagens/` e `/pt/series/{slug}/videos/`: `index, follow`,
  canonical autorreferente, **nenhum `<main>`** e **0 palavras** de conteúdo
  principal — o corpo é navegação e contadores. Description de template com
  46–50 caracteres.
- Não usam extensão `image:`/`video:` de sitemap: não alimentam Google Imagens
  nem Vídeos; só pedem rastreio.
- **Vazamento medido (LI):** a galeria de imagens de **episódio**
  (`…/episodios/[episode]/imagens/page.tsx:105`) decide indexar só por
  `images.indexable` (≥ 4 imagens) e **ignora a suspensão do episódio dono**
  (`src/server/episode-page.ts:210`). Resultado: página `index` de uma árvore
  suspensa, e fora do sitemap. O comentário em `:102-104` ("o episódio dono
  continua indexando") está falso desde 27/08.

**Correção:** o vazamento do episódio é bug e sai com um `&&` (`index:
images.indexable && data.seo.decision === 'index'`). **Tirar as galerias do
índice é indexação em massa e exige decisão do dono** (CLAUDE.md §6).

### 3.3 `og:image` ausente fora de notícia
**ALTO · MEDIDO + LI**

- 25 das 29 páginas 200 amostradas não têm `og:image` nem `twitter:image`;
  `twitter:card=summary`. Home, listagens, filmes, séries e pessoas também não
  têm `og:url`. Só notícia tem imagem e `summary_large_image`.
- Causa: `app/layout.tsx:25-26` define `openGraph` sem imagem e o
  `generateMetadata` das fichas não declara `openGraph`.
- **Nenhuma página emite `max-image-preview:large`** — mesmo as notícias, cujas
  imagens (1296 e 1600 px) já cumprem o requisito do Discover.

**Correção:** `og:image` por entidade a partir do pôster já exibido (mesma
licença que já governa a imagem na página), `og:url` = canonical,
`summary_large_image` e `max-image-preview:large`. Se houver dúvida sobre usar a
imagem do TMDB no OG, a decisão é do dono — uma imagem-padrão da marca não tem
essa restrição.

### 3.4 ItemList das listagens descreve o que não está na página
**ALTO · MEDIDO**

- `/pt/filmes/` e `/pt/series/`: o `ItemList` traz 24 títulos e **0/24 aparecem
  ou são linkados na página**. A página mostra outros títulos (hero, trilhos,
  rankings).
- Causa (LI): `app/pt/filmes/page.tsx:137-147` e `series/page.tsx:127-138` montam
  `mainEntity` de `getMovieIndexData()`, ordenado por ano desc — enquanto a tela
  renderiza `HomeLike`, alimentado por outra consulta. `/pt/noticias/` e
  `/pt/pessoas/` usam os mesmos cards que renderizam e estão coerentes.
- Marcar o que o usuário não vê é o padrão que leva a **ação manual por dados
  estruturados** (INFERIDO).

**Correção:** montar o `ItemList` a partir dos cards renderizados (ou remover
`mainEntity`), com teste que exija `href` no HTML para cada `url` do ItemList.

### 3.5 JSON-LD sem `image` nas entidades
**ALTO (Movie) / MÉDIO (TVSeries, Person) · MEDIDO**

- `Movie` (2/2) sem `image` — **propriedade obrigatória** para o Google — e sem
  `director`, `genre` e `duration`, todos visíveis na página. `TVSeries` sem
  `image`, `genre`, `numberOfSeasons`. `Person` sem `image`, com o retrato na
  tela.
- O único tipo que emite `image` é `TVEpisode` — ou seja, é inconsistência, não
  política (LI: não há comentário nem teste que justifique a omissão).

### 3.6 E-E-A-T: faltam as páginas institucionais
**CRÍTICO · MEDIDO (roteamento + navegação ao vivo)**

Não existem **Sobre/Quem somos**, **Política editorial**, **Contato** nem
**página de autor** (`apps/web/app/pt/*` só tem `termos`, `privacidade`,
`creditos-de-dados`). A assinatura das matérias ("por Pablo Gameleira") é texto
simples, sem link nem perfil; por isso o `NewsArticle` também sai sem
`author.url` — omissão deliberada e correta enquanto a página não existir.

Para um site que publica opinião editorial e reexibe notas de terceiros, esse é o
conjunto de sinais mais penalizado por diretrizes de qualidade e por heurísticas
de confiança de sistemas de IA (INFERIDO).

### 3.7 Sitemap × meta robots não saem da mesma fonte
**ALTO · MEDIDO + LI**

O projeto exige que sitemap e `<meta robots>` nunca discordem. Hoje discordam em
quatro pontos:

| Caso | Página | Sitemap |
|---|---|---|
| Pessoas (73.574 registros) | `index, follow` | **0 URLs** (shard 404) — o sitemap exige biografia licenciada + foto (`sitemap-index.ts:503-544`), a página não |
| `/pt/pessoas/`, `/pt/onde-assistir/`, `/pt/em-breve/` | `index` | fora do `static-1` |
| Galerias | piso de nº de imagens | herda a decisão do dono |
| Decisão ausente | `index` (`resolver.ts:380`) | `noindex` (`sitemap-index.ts:323-328`) |

A exceção de **pessoa** não está registrada no CLAUDE.md — vive só em comentário
de código. **Qual lado muda é decisão humana** (é indexação em massa).

---

## 4. Achados médios

| # | Achado | Evidência |
|---|---|---|
| M1 | `www.cinerie.com` serve o site inteiro com **200**, sem redirect para o apex (canonical mitiga, não resolve). Não há regra de host em `middleware.ts` nem em `next.config.ts` — o lugar é a borda | MEDIDO + LI |
| M2 | Sitemaps **lentos e sem cache**: índice 11,8–13,9 s, `imagens-*` 18,7–19,6 s, `static-1` 13,5 s para 746 bytes; nenhum `Cache-Control`, `cf-cache-status: DYNAMIC`. Cada leitura roda as agregações de todos os tipos | MEDIDO + LI |
| M3 | **11.666 fichas** (12,6%) com slug `tmdb-{id}`, título no alfabeto original (grego, japonês, coreano) e **sem description**, indexadas — em tensão com "entidade sem tradução = `noindex` técnico" | MEDIDO + INFERIDO |
| M4 | **Meta description ausente** em 7 de 29 páginas 200 (3 de 5 filmes, 2 de 2 pessoas): sem sinopse, a tag não sai. Sem fallback factual | MEDIDO + LI |
| M5 | Falha de banco ao ler a decisão vira **`noindex, nofollow` guardado em cache** pelo ISR (`indexability-decision.ts:96-131`); o correto é 5xx, que não é cacheado | LI |
| M6 | O sitemap de Google News (`/news-sitemap.xml`) está **vazio e correto** (última matéria há 58,3 h, fora da janela de 48 h) — mas `news-sitemap.ts:77-82` engole falha de banco **sem log**: "sem notícia" e "banco caiu" ficam indistinguíveis | MEDIDO + LI |
| M7 | Identidade da organização fragmentada: `Organization.url` = `/pt/`, `WebSite.url` = `/`, `publisher.url` = sem barra; nenhum `@id` | MEDIDO |
| M8 | Degrau de gênero da trilha aponta para a **mesma URL** do índice em 4/4 fichas ("Filmes › Ação" leva à lista geral) | MEDIDO |
| M9 | Árvore suspensa continua rastreável: as abas linkam temporadas e cada temporada linka todos os episódios (~3,9 M URLs `noindex, follow`) | LI + INFERIDO |
| M10 | Cobertura editorial inconsistente: títulos populares **sem** bloco editorial (Moana, Silo) ao lado de outros **com** (Homem-Aranha, One Piece); sinopses de 40–95 palavras, abaixo da janela de citação por IA | MEDIDO |
| M11 | "Onde assistir" **vazio em 6/6** títulos correntes amostrados, embora o hub prove que há dado real para clássicos — a lacuna está onde há mais tráfego | MEDIDO |
| M12 | **FAQ ausente em 100%** da amostra (6 entidades + 2 notícias), apesar de ser bloco de valor declarado | MEDIDO |
| M13 | `/pt/pessoas/` (73.574) devolve perfis mínimos sem biografia na primeira página — sem filtro de relevância | MEDIDO |
| M14 | Notícia sem `dateModified` visível e sem `about`/`mentions` para as entidades citadas nos cartões | MEDIDO |

---

## 5. Achados baixos

Raiz em 2 saltos com **307** (deveria ser 308 enquanto só `pt` publica); 308 de
barra final sem HSTS; **dois grupos `User-agent: *`** no robots.txt (o bloco
gerenciado da Cloudflare + o do app — o Google une, um parser ingênuo não);
`lastmod` do índice por **tipo**, não por shard; `static-1` sem `lastmod` e
incompleto; `og:locale` inválido (`pt-BR` em vez de `pt_BR`) nas notícias e
ausente em galeria/temporada/episódio; `og:type: website` nas fichas (cabia
`video.movie`/`video.tv_show`/`profile`); títulos de listagem curtos (16–25
caracteres) e três acima de 65; 404 de ficha **sem `lang` e sem H1**, e o 404
genérico com o texto padrão do Next **em inglês**; `/llms.txt` inexistente; datas
de `Movie`/`TVSeries` só com o ano; trilha visível diferente da do JSON-LD em
temporada, episódio e notícia; `sameAs` só com IMDb; `inLanguage` ausente em
`CollectionPage`/`WebSite`; `/favicon.ico` **404** e sem `<link rel="icon">`.

---

## 6. GEO: crawlers de IA — decisão de negócio, não defeito

**MEDIDO no robots.txt servido:**

| Crawler | Papel | Estado |
|---|---|---|
| GPTBot, ClaudeBot, Google-Extended, CCBot, Amazonbot, Applebot-Extended, Bytespider, meta-externalagent | **treino** de modelo | **bloqueados** |
| OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User, PerplexityBot | **busca/resposta ao vivo** | liberados |
| Googlebot, Googlebot-News, Bingbot, Applebot | busca | liberados |

Os bloqueios vêm do **bloco gerenciado da Cloudflare** (`Content-Signal:
search=yes, ai-train=no, use=reference`), não do código: uma varredura por esses
user-agents no monorepo inteiro não encontra nenhum (MEDIDO). Bloquear
`Google-Extended` não afeta Search nem AI Overviews (documentação do Google).

**Portanto:** a visibilidade em busca com IA **não está bloqueada** — o que está
bloqueado é o uso para treino. Isso é decisão de negócio do dono; fica
registrado, sem recomendação automática de inverter.

---

## 7. Desempenho

> **A PageSpeed Insights não entregou nada, e o motivo importa:** a API v5 sem
> chave responde 429 com `quota_limit_value: "0"` — não é cota esgotada, é
> **limite zero** (5 tentativas, em dois horários; a interface pública também
> travou sem emitir a chamada). Logo: **sem score 0–100, sem Speed Index, sem
> INP e sem CrUX de campo**. Os números abaixo são de **laboratório próprio**
> (Chrome 152 headless via DevTools Protocol, com os parâmetros de *throttling*
> do modo `devtools` do Lighthouse, 3 execuções por caso, mediana). **Não são um
> relatório do Lighthouse** e não devem ser citados como "PageSpeed".

### 7.1 Mediana de 3 execuções

| Página | LCP mobile | LCP desktop | FCP mobile | TBT~ mobile | CLS | Peso mobile |
|---|---|---|---|---|---|---|
| home | 3.228 ms | 1.872 ms | 3.212 ms | 289 ms | 0,005 | 1.377 KB |
| filme | **5.084 ms** | 1.476 ms | 2.744 ms | 616 ms | 0 | 1.521 KB |
| série | 3.628 ms | 1.220 ms | 2.656 ms | 276 ms | 0 | 322 KB |
| notícia | 2.668 ms | 732 ms | 2.668 ms | 665 ms | **0,088** (desktop) | 367 KB |

No **desktop todos os LCP estão na faixa boa**. O problema é mobile — e o pior
caso tem causa estrutural, não "peso de página".

### 7.2 P1 · O transbordo horizontal explica o LCP de 5,1 s — e é uma linha de CSS
**MEDIDO + LI**

Com viewport de 412 px, a ficha mede `scrollWidth` de **1.816 px**:

- `globals.css:4437-4448` — no desktop a grade é `320px minmax(0, 1fr)`; em
  `@media (max-width: 1023px)` vira **`grid-template-columns: 1fr`**, e `1fr` é
  `minmax(auto, 1fr)`: o mínimo passa a ser o *min-content* do conteúdo.
- O conteúdo é o trilho "Mais como este": `.similar-card { flex: 0 0 210px }` +
  `gap: 16px`, com 8 cartões. **8 × 210 + 7 × 16 = 1.792 px** — exatamente o
  elemento medido.
- Consequência: o Chrome limita o zoom mínimo, a *layout viewport* vira
  1.648 × 3.292 px, e o LCP passa a ser **um pôster de "Mais como este" a
  y = 2.353 px**, com `loading="lazy"` e prioridade baixa.
- A ficha **sem** esse bloco mede 412 px e prova o contrário.

**Correção:** `minmax(0, 1fr)` em `globals.css:4446` — a variante de uma coluna
(`.ficha-grid--solo`) e o desktop já fazem certo. Ganho estimado: **−2 s** no LCP
mobile das fichas.

### 7.3 P2 · 951 KB de fotos de elenco em `original` por ficha
**MEDIDO + LI**

Seis fotos de elenco carregadas em `https://image.tmdb.org/t/p/original/…` e
exibidas em **64 × 64 px** no mobile: **951.132 B, 61% do peso da página**. A
maior tem 2000 × 3000 px para um quadrado de 64 px (17,9× do necessário).
Em `w300` as mesmas seis somam 101.612 B: **−849 KB (−89%)**.

Causa: `tmdbSize: "original"` em `apps/web/src/lib/cast-presenter.ts:31` — e o
mesmo em `person-presenter.ts:43`, `entity-index-presenter.ts:37`,
`series-presenter.ts:43` e `season-episode-presenter.ts:34`. **A escala é o
catálogo inteiro**, não a ficha medida.

### 7.4 P3 · HTML sem cache de borda na home e em toda ficha de série
**MEDIDO**

| Página | TTFB mediana | origem (`Server-Timing`) | `cf-cache-status` |
|---|---|---|---|
| home | 1.323 ms | 1.124 ms | DYNAMIC (5/5) |
| série | 571 ms | 339 ms | **BYPASS (10/10)** |
| filme (fria, 1ª visita) | 954–1.038 ms | 746–833 ms | MISS → HIT (2ª: ~180 ms) |

A ficha de filme é a única superfície com cache de rota real. São **35.925 URLs
de série** sempre na origem. As causas estão documentadas no próprio código
(`force-dynamic` na home porque o build do release roda sem `DATABASE_URL`; na
série por causa de `?temporada=`; na notícia **de propósito**, para não segurar
matéria retratada). Mexer nisso é decisão de deploy — ver
`docs/operations/route-cache-and-isr-disk.md`.

### 7.5 P4 · O elemento LCP das fichas tem `loading="lazy"`
**MEDIDO + LI**

`filmes/[slug]/page.tsx:455-461` e `series/[slug]/page.tsx:558-565`: o backdrop
da banda de mídia — que foi o LCP no desktop — carrega com `loading="lazy"`
(269 ms de atraso + 1.061 ms de download, prioridade baixa), enquanto o
`preload` com `fetchpriority="high"` aponta para o **pôster**, que não é o maior
elemento visível.

### 7.6 P5 · CSS de 143 KB bloqueante, 82–90% sem casar, e fonte sem `preload`
**MEDIDO**

Uma folha única de **143.465 B**, bloqueante em todas as páginas, da qual só
**10,1% a 18,4%** casa com algo na página. No mobile ela ocupa o caminho crítico
por ~1,2 s, e o FCP só acontece 650–830 ms depois.

A `@font-face` (Montserrat variável, `globals.css:21-27`) **não tem `preload`**
em nenhuma página: a fonte só é descoberta depois do CSS. É a causa medida do
**CLS 0,088** da notícia no desktop — um único deslocamento em t = 1.199 ms,
logo após `fonts.ready`, com a `nav` do header mudando de 446 px para 461 px.

### 7.7 Também medido

`/favicon.ico` responde **404 com 23.145 B de HTML** (todo navegador pede);
`upgrade-insecure-requests` numa política **report-only** gera erro de console em
toda página (`middleware.ts:88`); o hero da home usa `w1280` sem `srcset`
(−165 KB no slide medido com `w780`); a ficha de série tem **149 KB de HTML**
(guia de temporadas inteiro no HTML e repetido no payload RSC); dois chunks de JS
concentram ~101 KB na rede com 62–67% sem executar.

---

## 8. O que já foi corrigido nesta leva

A PR das marcas (#277, mesma data) resolve dois achados deste relatório, porque
caíram no caminho:

- **`Organization.logo`** passa a ser PNG 672×163. O anterior era um SVG de
  520×78 feito de `<text>` **sem fonte embutida** — abaixo dos 112 px mínimos do
  Google e dependente da fonte instalada no rasterizador (A3 da auditoria de
  dados estruturados).
- **`publisher.logo`** passa a existir no `NewsArticle` (parte de M7).

O favicon (§5) **não** foi resolvido: exige um ícone quadrado que não dá para
derivar da palavra-marca sem desenhar marca nova.

---

## 9. Plano de ação

### A. Código — PRs pequenos, sem decisão humana pendente

Os cinco primeiros saem da medição de §7, não dependem de decisão de ninguém e
são os de maior efeito por linha mexida.

1. **`minmax(0, 1fr)`** na grade da ficha em mobile (`globals.css:4446`) — acaba com o transbordo de 1.816 px e tira ~2 s do LCP.
2. **`tmdbSize: "w300"`** nas fotos de elenco, nos **cinco** presenters — −849 KB por ficha, no catálogo inteiro.
3. **O backdrop da ficha é o elemento LCP e carrega `lazy`** — prioridade alta nele, e o `preload` apontando para ele em vez do pôster.
4. **`preload` da Montserrat variável** — causa medida do CLS 0,088 da notícia.
5. **`srcset` no hero da home** (hoje `w1280` fixo) — −165 KB no slide medido.
6. Galeria de episódio: respeitar a suspensão do dono (`&&` em `imagens/page.tsx:105`) + caso no teste da válvula.
7. Teto do sitemap **por tipo** + alerta antes do corte.
8. `og:image`/`og:url`/`summary_large_image` + `max-image-preview:large`.
9. `image`, `director`, `genre`, `duration` no `Movie`; `image` em `TVSeries` e `Person`.
10. ItemList das listagens a partir dos cards renderizados, com teste de paridade.
11. Falha de banco → 5xx em vez de `noindex` cacheado; log no fail-closed do sitemap de notícias.
12. Fallback de meta description a partir do payload (ano, direção, gênero, duração).
13. `@id` único de Organization/WebSite, reaproveitado no `publisher`.
14. Degrau de gênero fora da trilha enquanto não houver página de gênero.
15. `not-found.tsx` em pt-BR com `lang` e H1; `og:locale` `pt_BR`; 308 na raiz.

> Fora da caixa de "PR pequeno": a folha única de 143 KB, bloqueante e com
> 82–90% sem casar (§7.6), pede divisão por rota — refatoração, não ajuste.

### B. Infraestrutura e deploy (fora do código de página)

16. Redirect 301 de `www` para o apex, preservando caminho.
17. `Cache-Control` nos sitemaps (e reduzir o custo das agregações no código).
18. Revisar o bloco gerenciado de robots.txt à luz de §6 — decisão de negócio.
19. Cache de borda da **home** (DYNAMIC) e de **toda ficha de série** (BYPASS 10/10) — §7.4. As causas estão escritas no próprio código e a mudança é de deploy, não de render: ver [`docs/operations/route-cache-and-isr-disk.md`](../operations/route-cache-and-isr-disk.md).

### C. Decisão do dono (licença ou indexação em massa — CLAUDE.md §6)

20. **Galerias** (69.016 URLs) entram ou saem do índice?
21. **Pessoas**: a página passa a seguir o gate do sitemap, ou o sitemap passa a seguir a página?
22. **11.666 fichas `tmdb-{id}`** sem tradução: mantêm `index` (com description de fallback) ou viram `noindex` técnico?
23. Usar a imagem do TMDB no `og:image` das fichas.
24. Páginas institucionais (Sobre, Política editorial, Contato, Autor) — §3.6.
25. Favicon quadrado — hoje `/favicon.ico` responde **404 com 23 KB de HTML** em toda visita (§7.7), e não dá para derivar um ícone quadrado da palavra-marca sem desenhar marca nova.

---

## 10. O que está correto (verificado, não presumido)

- HTTPS forçado, HSTS de 2 anos com `includeSubDomains; preload`, gzip e zstd.
- Barra final normalizada em 1 salto (308); slug com maiúscula dá 404, não duplicata; a raiz não negocia idioma e responde igual ao Googlebot.
- Temporada e episódio: `noindex, follow` na página **e** ausência no sitemap; os shards antigos respondem 404.
- `/en/` e `/es/`: 404, sem `hreflang` apontando para eles. O `hreflang` da home é autorreferente e coerente com ter só pt-BR publicado.
- Sitemaps bem-formados, dentro dos limites (maior: 50.000 URLs / 10,15 MB), sem duplicatas, com `lastmod` válido e variado.
- 19/19 URLs de sitemap amostradas: 200, indexável, canonical autorreferente.
- HTML do Googlebot **idêntico** ao do navegador; conteúdo principal no SSR; 1 H1 por página; `lang="pt-BR"`; nenhuma `<img>` sem `alt`.
- Tipo de schema correto em 15/15 páginas; `BreadcrumbList` em 14/14 não-home; **zero `AggregateRating`** mesmo com nota visível na tela — o Cinerie Score não vira nota de terceiro (travado por teste).
- `?utm_source` canonicaliza para a URL limpa.
- Notícias: ~900–1.200 palavras, fonte externa citada e 4–7 links para entidades.
- Fatos essenciais (ano, direção, elenco, duração, gêneros) em **texto** no SSR — legíveis por crawler sem JS.

---

## 11. Limites desta auditoria

- Sem Search Console, sem CrUX autenticado, sem Rich Results Test: elegibilidade a *rich result* é INFERIDA da documentação.
- TTFB com 1 leitura por URL, a partir do Brasil; parte das fichas já aquecidas na borda pela própria sequência de testes.
- O UA de Googlebot saiu de IP que não é do Google.
- A projeção do teto do sitemap (§3.1) é linear e parte de um número escrito no código (110.498 em 27/08), não medido por esta auditoria.
- A escala de M3 e M4 vem da amostra (29 páginas) mais a contagem de slugs no sitemap.
- **O desempenho (§7) é de laboratório, não do PageSpeed.** A API v5 sem chave responde 429 com `quota_limit_value: "0"` (limite zero, não cota esgotada), e a interface pública travou sem emitir a chamada. Os números vêm de Chrome 152 headless via DevTools Protocol, 3 execuções por caso, mediana — **não há score 0–100, Speed Index, INP nem dado de campo (CrUX)**, e nada ali deve ser citado como "nota do PageSpeed".
- Uma nota de contexto para quem for agir: o CLAUDE.md descreve ratings, streaming e notícias como "ainda não funcionais como produto". A medição ao vivo mostra os três **ativos** (notas em 4/6 títulos, hub de streaming com dado datado de hoje, 368 matérias publicadas). Prescreva pelo estado medido, não pela lista de pendências do documento.
