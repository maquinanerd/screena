---
mission: "Home — destaques editoriais e ticker multi-item"
status: "IN_PROGRESS"
date_started: "2026-07-28"
date_finished: null
repository: "maquinanerd/screena"
primary_checkout_protected: true
worktree: ".claude/worktrees/home-primeira-dobra-relatorio-531524"
branch: "fix/home-editorial-highlights-ticker-carousel"
base_branch: "main"
base_sha: "143aef8ec48d30de34990a9433259c2dcda78f96"
starting_head_sha: "143aef8ec48d30de34990a9433259c2dcda78f96"
final_head_sha: null
pull_request: null
merge_sha: null
pr_ci_status: null
post_merge_ci_status: null
canonical_sources:
  - "docs/design-handoff/Screena-Design-System-Final-Handoff/Screen Screens v4.dc.html"
  - "docs/frontend/home-first-fold-correction.md"
---

# Destaques editoriais e carrossel da faixa amarela — relatório técnico

Documento de rastreabilidade da task **"CINERIE — CORREÇÃO DEFINITIVA DA HOME:
DESTAQUES EDITORIAIS + CARROSSEL DE NOVIDADES DA FAIXA AMARELA"**.

Continuação de [`home-first-fold-correction.md`](./home-first-fold-correction.md)
(PR #89 · merge `0b2481a`), que corrigiu chrome, hero, Cinerie Score e provedor
licenciado. **Nada daquele relatório é revertido aqui.** Esta missão corrige duas
interpretações erradas que sobreviveram àquela PR.

---

## 1. Resumo executivo

### Problema

Duas seções da primeira dobra faziam a coisa errada — e faziam bem o bastante
para passar em build, typecheck, lint e 3.777 testes:

1. **"Destaques de hoje" era catálogo.** Os três cards eram fichas de filme
   (pôster + `Filme · 2026`) linkando para `/pt/filmes/{slug}/`. O canônico
   mostra **matérias editoriais**. E `Filmes` / `Séries` eram **âncoras de
   navegação** para as listagens de catálogo: clicar saía da home.
2. **A faixa amarela era um item só.** Ela mostrava *o episódio de hoje* **ou**
   *a próxima estreia* — nunca as duas coisas, nunca outro tipo de novidade. Os
   dots existiam, mas representavam um conjunto que quase sempre tinha um
   elemento.

### Causa raiz

Não é "faltou dado". São duas decisões de arquitetura erradas, cada uma em uma
linha específica:

1. **A seção editorial nunca leu a cadeia editorial.** `HomeLike` derivava os
   destaques do dataset de CATÁLOGO já carregado para outra seção
   (`featuredSource.slice(0, 3)`), e o controle segmentado foi implementado
   como dois `<a href={MOVIES_INDEX_PATH}>` / `<a href={SERIES_INDEX_PATH}>`.
   Nunca houve loader editorial: a seção não tinha de onde tirar uma matéria.
2. **O loader da faixa era um fallback exclusivo, não um agregador.**
   `getHomeTickerEpisodes()` fazia `if (today.length > 0) return today` — o
   `return` antecipado tornava as duas fontes mutuamente exclusivas — e o
   contrato `TickerEpisode` só sabia descrever episódio. Filme, temporada e
   streaming não tinham como existir na faixa nem em tese.

### Solução

- **Cadeia editorial nova e completa**: `articles` + `article_translations` +
  `entity_news_links` → loader → presenter puro → tabs reais. Classificação
  Filmes/Séries por **vínculo de entidade persistido**, nunca por palavra-chave.
- **Faixa vira agregador de quatro fontes reais** (episódio, estreia de filme,
  estreia de temporada, chegada ao streaming), com contrato em união
  discriminada, ordenação determinística, dedupe em duas camadas e carrossel
  com autoplay, teclado, pausa e `prefers-reduced-motion`.

### Resultado

| Gate | Resultado |
| --- | --- |
| `pnpm typecheck` / `typecheck:web` / `typecheck:admin` | PASSOU |
| `pnpm lint` | PASSOU |
| `pnpm test` | **3.832** testes em **313** arquivos, 100% verdes |
| `pnpm audit:invariants` · `audit:render` · `api:coverage` | PASSOU (7 / 2 / 7 checagens) |
| `pnpm build` | PASSOU |
| `pnpm --filter @screena/web validate:all` | 139/140 (a exceção é limitação de ambiente Windows — ver §10) |
| `qa:home-editorial` (app Next real + PG16 real) | **42/42** |
| `qa:home-fold` (regressão da PR #89) | **26/26** |

---

## 2. Ground truth

```
origin/main na abertura   143aef8ec48d30de34990a9433259c2dcda78f96
                          docs(home): consolida o relatorio da primeira dobra (#90)
branch                    fix/home-editorial-highlights-ticker-carousel
worktree                  .claude/worktrees/home-primeira-dobra-relatorio-531524
starting HEAD             143aef8ec48d30de34990a9433259c2dcda78f96
```

`origin/main` **não** havia avançado além do esperado: `143aef8` (PR #90) sobre
`0b2481a` (PR #89). Nenhuma PR anterior foi reaberta.

### Checkout primário — intacto

Medido no início e no fim da missão, idêntico nos dois momentos:

```
HEAD     508fa72c952fa46bc0a34855c953ee8a612d98af
branch   feat/data-governance-hardening
estado   350 entradas sujas (WIP protegido)
```

Nenhum comando de escrita foi executado nele. Todo o trabalho ficou no worktree.

---

## 3. Fontes canônicas

### HTML canônico

```
docs/design-handoff/Screena-Design-System-Final-Handoff/Screen Screens v4.dc.html
sha256: 6936a3416d9d008d46c0e88b87127817e7cc30a3acd5829da86e8b61296ca770  ✅ confere
380.309 bytes · 3.453 linhas
```

**Achado relevante sobre o arquivo:** ele vive apenas no **checkout primário** e
não é rastreado pelo git (`git ls-files` não retorna nenhum `.dc.html`). Foi lido
em modo somente-leitura; nada nele foi alterado.

**Segundo achado, mais importante:** o canônico **não tem uma única classe CSS**.
`grep -o 'class="[^"]*"'` não retorna nada nas 3.453 linhas; há um único `<style>`
(linhas 26–33) que é só reset. Todo o estilo é `style="…"` inline por elemento.
Ou seja, `.ticker__*`, `.feat-*` e `.seg-toggle*` são nomes do **port**, não do
design — a comparação tem de ser feita por *valor computado*, não por seletor.

### O que o canônico realmente diz (bloco 02 · `isHomeLike`)

**Faixa amarela** (linhas 167–183) — é um **carrossel**, não um item:

- fundo `#F5C518`, `max-width:1280px`, `padding:14px 80px`;
- `<sc-for list="{{ tickerDots }}" hint-placeholder-count="6">` → **um dot por
  item**; `tickerData()` (linhas 2396–2400) alimenta **6 itens** na home;
- dot ativo `width:18px`, inativo `6px`, ambos `height:6px`, ativo `#101010`;
- autoplay de 4.200 ms (linha 2338); sem setas prev/next no markup;
- CTA = `<a>` preto com `Onde assistir` + o nome da plataforma.

**Destaques de hoje** (linhas 185–224) — é **editorial**:

- `grid-template-columns:1.62fr 1fr 1fr; gap:24px`, três cards de `460px`,
  `border-radius:10px`;
- card principal: capa da coleção + **headline** + **deck** (`max-width:52ch`);
- cards B e C: pôster + **kicker em caixa alta** (B em `#F5C518`, C em
  `rgba(255,255,255,0.72)`) + headline com `-webkit-line-clamp:3`;
- **nenhuma metadata de entidade**: não há ano, tipo, nota, duração ou
  classificação em card algum;
- o controle segmentado é **dois `<span>`** dentro de um pill `#EFEBE3` — sem
  `href`, sem `onClick`, sem `role`. É um mock visual, não navegação.

### Relatório anterior

[`home-first-fold-correction.md`](./home-first-fold-correction.md) governa header,
hero, título, scrims, Cinerie Score, menu, provedor licenciado e o QA real da
primeira dobra. Nenhuma dessas correções foi tocada — provado por
`qa:home-fold` 26/26 (§9.2).

---

## 4. Diagnóstico

| Sintoma | Causa raiz | Evidência | Arquivo | Símbolo |
| --- | --- | --- | --- | --- |
| Cards de "Destaques" são fichas de filme com pôster | A seção reusava o dataset de CATÁLOGO já carregado para outra banda; nunca existiu loader editorial | `const featuredSource = showMoviesBand ? movieCards : seriesCards` seguido de `.slice(0, 3)` | `apps/web/app/_components/home-like.tsx` (antes) | `HomeLike` |
| Cards linkam para `/pt/filmes/{slug}/` | Consequência direta: `EntityCard.href` é rota de ficha | `<a className="feat-card feat-card--lead" href={featured[0].href}>` | idem | idem |
| Cards mostram `Filme · 2026` | `EntityCard.meta` (ano/tipo) renderizado como subtítulo | `{featured[0].kind === 'series' ? 'Série' : 'Filme'} · {featured[0].meta}` | idem | idem |
| `Filmes`/`Séries` saem da home | Implementados como âncoras de navegação, não como tabs | `<a aria-current=… className="seg-toggle__opt" href={MOVIES_INDEX_PATH}>` | idem | idem |
| Faixa mostra uma novidade só | `return` antecipado torna as duas fontes **mutuamente exclusivas** | `const today = …; if (today.length > 0) return today` | `apps/web/src/server/home-ticker.ts` (antes) | `getHomeTickerEpisodes` |
| Faixa só sabe falar de episódio | O contrato tinha forma de episódio; filme/temporada/streaming não eram representáveis | `interface TickerEpisode { kind: 'today' \| 'upcoming'; series; seasonEp; episodeTitle; … }` | idem | `TickerEpisode` |
| Poucos dots mesmo com catálogo cheio | `toTickerEpisodes` deduplica por série **dentro de uma única fonte**, então uma série com vários episódios hoje virava 1 item e nada mais entrava | `const seenShows = new Set<string>(); … if (seenShows.has(key)) continue` | idem | `toTickerEpisodes` |

> O ponto que interessa para o futuro: **nenhum desses defeitos era um bug de
> execução.** O código compilava, renderizava e passava em tudo — só mostrava a
> coisa errada. Por isso as travas novas (§8) verificam *o que a seção consome*,
> não apenas *se ela renderiza*.

---

## 5. Inventário de arquivos

### Criados (7)

| Arquivo | Linhas | Papel |
| --- | ---: | --- |
| `apps/web/src/lib/home-editorial-presenter.ts` | 267 | Presenter puro: gate, classificação, ordenação, forma do card |
| `apps/web/src/lib/home-ticker-presenter.ts` | 235 | Contrato em união discriminada + ordenação e dedupe puros |
| `apps/web/src/server/home-editorial.ts` | 130 | Loader editorial (2 queries) |
| `apps/web/app/_components/home-editorial-highlights.tsx` | 186 | Seção com tabs reais |
| `apps/web/src/lib/__tests__/home-editorial-presenter.test.ts` | 314 | 16 testes do presenter editorial |
| `apps/web/src/lib/__tests__/home-ticker-presenter.test.ts` | 215 | 13 testes de ordenação/dedupe/teto |
| `tests/web/home-editorial-and-ticker-contract.test.ts` | 206 | 21 travas estruturais |
| `apps/web/scripts/qa-home-editorial-ticker-real-postgres.ts` | 1.248 | QA visual no app Next real + PG16 real |

### Editados (13)

| Arquivo | +/− | Mudança |
| --- | ---: | --- |
| `apps/web/src/server/home-ticker.ts` | +436 −203 | Reescrito: agregador de 4 fontes |
| `apps/web/app/_components/home-ticker.tsx` | +119 −56 | Vira carrossel real |
| `apps/web/app/_components/home-like.tsx` | +31 −72 | Seção editorial substitui o bloco de catálogo |
| `apps/web/app/pt/page.tsx` | +32 −14 | Liga os dois loaders novos |
| `apps/web/app/pt/series/page.tsx` | +8 −4 | idem |
| `apps/web/app/pt/filmes/page.tsx` | +6 −2 | idem |
| `apps/web/app/globals.css` | +61 −0 | Placeholder, estado vazio, grid adaptativo, alvo de toque |
| `apps/web/scripts/qa-home-first-fold-real-postgres.ts` | +27 −9 | Contrato do estado neutro atualizado |
| `tests/web/home-canonical-contract.test.ts` | +39 −9 | Contrato atualizado + guards novos |
| `tests/web/public-shell-reset.test.ts` | +6 −3 | Placeholder entra na allowlist de capa de mídia |
| `tests/web/category-home-canonical-contract.test.ts` | +2 −2 | Nome do getter |
| `apps/web/package.json` | +1 | Script `qa:home-editorial` |
| `.gitignore` | +1 | Capturas do QA novo |

### Removidos / temporários

Nenhum arquivo removido. Nenhum arquivo temporário deixado no repositório: as
capturas do QA vão para `apps/web/.qa-home-editorial/`, que está no `.gitignore`.

**Diffstat real:** `21 files changed, 3570 insertions(+), 374 deletions(-)`.

---

## 6. Linhagem dos dados editoriais

```
articles + article_translations + entity_news_links   (PostgreSQL, pt-BR)
  → getHomeEditorialHighlights()                      2 queries, sem N+1
  → isPublishableArticle + isNewsAttributionSatisfied gate ÚNICO (@screena/seo)
  → classifyEditorialVerticals(linkedEntityTypes)     sinal PERSISTIDO
  → buildHomeEditorialHighlights()                    ordena, corta, monta o card
  → <HomeEditorialHighlights>                         tabs trocam a lista visível
  → <a href="/pt/noticias/{slug}/">                   sempre matéria
```

### 6.1 Publicabilidade — o gate real, não um simplificado

O presenter chama `isPublishableArticle` (wrapper de
`isArticlePublishable`, de `packages/seo/src/article-publication.ts`) — **o mesmo
gate** que `/pt/noticias/`, a página de artigo e o sitemap usam — mais
`isNewsAttributionSatisfied`. Ficam de fora, portanto:

| Estado | Motivo de exclusão |
| --- | --- |
| `draft`, `ai_generated`, `needs_review`, `needs_update` | `not_published` |
| `blocked`, `archived` | `retracted` |
| `published_at` no futuro | `future_scheduled` (embargo) |
| `license_status` `unknown`/`blocked` | `blocked_license` |
| `display_allowed = false` | `display_not_allowed` |
| slug ou título vazios | `missing_slug` / `missing_headline` |
| `requires_attribution` sem `source_name` | `missing_required_attribution` |
| `requires_linkback` sem `source_url` | `missing_required_linkback` |

### 6.2 Classificação — por que NÃO usar `articles.category`

O contrato pedia, como sinal 1, uma "categoria editorial explícita". **Ela não
existe no schema.** `Article.category` é `String?` de texto livre, sem enum e sem
vocabulário controlado — o próprio schema anota `// v2: FK ArticleCategory`, e
`ArticleCategory` não existe em lugar nenhum do repositório. Os valores reais são
rótulos de exibição (`Bastidores`, `Estreias`, `Séries`, `Cinema`, `Entrevista`,
`Streaming`), e `Cinema`/`Estreias` não dizem se a matéria é de filme ou de série.

Casar essa string contra `/série|cinema/` **seria exatamente a heurística de
palavra-chave que o contrato proíbe** — só que aplicada a outro campo. Então a
classificação usa os sinais 2 e 3 (entidades relacionadas persistidas), e
`category` é usada **apenas como eyebrow** (rótulo exibido), nunca como
classificador.

| Vínculos em `entity_news_links` | Vertical |
| --- | --- |
| só `movie` | Filmes |
| só `tv` | Séries |
| `movie` **e** `tv` | aparece nos **dois** filtros |
| só `person`, ou nenhum vínculo | **não entra na seção** |

Sem eyebrow persistido, o card usa o rótulo da própria vertical (`Filmes` /
`Séries`) — também um fato derivado de sinal real, nunca inventado.

**Prova nos dois sentidos** (`home-editorial-presenter.test.ts`):

- controle negativo — matéria intitulada *"Série, temporada e episódio: o guia da
  nova temporada"*, categoria `Séries`, mas com vínculo **`movie`**: aparece em
  **Filmes**, e só em Filmes;
- no QA real — matéria *"SEM VÍNCULO: filme, cinema, série, temporada e episódio
  no título"*, vinculada só a uma pessoa: **fora dos destaques**, e ainda assim
  publicada na banda editorial geral (ela é publicável; só não é classificável).

### 6.3 Ordenação

`publishedAt` (resolvido: tradução, com o artigo como fallback) decrescente,
desempate por `articleId` crescente. **Sem aleatoriedade, sem popularidade TMDB,
sem contagem de votos.** O teste embaralha a entrada e exige saída idêntica.

O critério 1 do contrato ("prioridade/featured editorial persistida, quando
existir") **não tem fonte**: não há campo de destaque em `articles` — o "featured"
da listagem de notícias é só o primeiro card já ordenado. Inventar prioridade
seria heurística não persistida, então a ordenação começa pela data.

### 6.4 Imagem

`Article.heroImagePath` passa por `normalizeNewsLocalImagePath` — o mesmo
validador das notícias: só caminho **local** (`/media/`, `/uploads/`, `/brand/`)
com extensão de imagem, sem `http(s)://`, sem `//`, sem `?`/`#`, sem `..`. Sem
imagem publicável, o card usa `feat-card__placeholder`: superfície própria que
preserva o layout e **não** finge ser a capa real. O pôster da entidade
relacionada **nunca** entra no lugar.

---

## 7. Linhagem dos dados do ticker

```
episodes.air_date          movies.release_date
seasons.air_date           watch_availability.available_from
        └──────────────┬──────────────┘
                       ▼
        getHomeTickerItems()            4 queries de descoberta (paralelas)
                       ▼
        licensedWatchWhere(now)         gate compartilhado de licença
        selectTickerWatchOffer()        presenter puro reaplica os gates
                       ▼
        resolveIdentities()             slug canônico + título pt-BR (lote)
                       ▼
        orderAndDedupeTickerItems()     hoje → futuro asc → streaming; 1 por entidade; ≤5
                       ▼
        <HomeTicker>                    1 item por vez, dots, autoplay, teclado
                       ▼
        CTA + crédito do item ATIVO
```

### 7.1 As quatro fontes e o que cada uma pode afirmar

| Fonte | Coluna persistida | Texto produzido |
| --- | --- | --- |
| Episódio | `episodes.air_date` + `seasons.season_number` | `Ruptura · T2 · E5 · Cavalo de Troia · novo episódio hoje` |
| Estreia de filme | `movies.release_date` | `Águas Mortais · estreia hoje` / `· estreia em 2 de agosto` |
| Estreia de temporada | `seasons.air_date` + `season_number` (`> 0`) | `O Urso · temporada 4 estreia em 31 de julho` |
| Chegada ao streaming | `watch_availability.available_from` | `Um Sonho de Liberdade · chegou ao streaming` |

`season_number = 0` (especiais do TMDB) é excluído: não é estreia de temporada.
O número da temporada é sempre o **persistido**, nunca deduzido.

### 7.2 O que a faixa NUNCA renderiza

O protótipo cita `70mm`, `Legendado`, `3 sessões`, `reexibição`, `em cartaz hoje`,
`Kinoplex`, `Cinesystem`. **Nada disso é exibido**, porque o sistema não persiste
cinema, sessão, formato, idioma de exibição, rede, horário ou território de sala.

Em particular: **"em cartaz" não é inferido de `release_date`.** Um filme com data
de estreia *estreia*; estar em cartaz numa sala é outro fato, que não existe no
banco. O texto diz `estreia hoje`. Travado por teste (com o comentário do código
removido antes do match, para que documentar a regra não a viole).

### 7.3 Ordenação e dedupe

**Ordenação** — baldes, depois data, depois tipo, depois id:

1. acontece **hoje** (inclui oferta que passa a valer hoje);
2. acontece no **futuro**, por data **crescente**;
3. **chegada ao streaming** já vigente, da mais **recente** para a mais antiga.

**Dedupe em duas camadas**:

1. identidade exata (`kind` + entidade + data);
2. **uma novidade por ENTIDADE** — a mesma série não ocupa dois slots para
   chegar a cinco, e um filme não aparece como `movie_release` **e**
   `streaming_arrival` quando os dois comunicam o mesmo fato. Vence quem ficou
   à frente na ordenação.

Filme `5` e série `5` **não** colidem: `movies.id` e `tv_shows.id` são sequências
independentes, e a chave de dedupe carrega o tipo. Há teste para isso.

### 7.4 Queries — contagem real

**Constante, independente da quantidade de itens.** 7 no caminho comum, no
máximo 9:

| # | Query | Observação |
| ---: | --- | --- |
| 1–4 | `episode` · `movie` · `season` · `watchAvailability` | descoberta, em paralelo, `take` próprio |
| 5–6 | `slug` + `entityTranslation` | lote, filmes e séries na mesma query cada |
| 7 | `watchAvailability` (provedores) | lote, **uma** query para todas as entidades |
| 8–9 | `movie` / `tvShow` (nome original) | **só** para quem apareceu exclusivamente via streaming; sem essas entidades, não acontecem |

Nenhuma consulta de streaming por item. Travado por teste
(`not.toMatch(/for \([^)]*\) \{\s*await prisma\.watchAvailability/)`).

### 7.5 Licença

Preservada integralmente da PR #89. O provedor só existe se passar por
`licensedWatchWhere(now)` — o **mesmo** gate do painel de detalhe e do hub
`/pt/onde-assistir` — e por `selectTickerWatchOffer`, que reaplica
`display_allowed`, modalidade legal, deep link `http(s)` e atribuição/linkback
exigidos. **Chegada ao streaming sem provedor aprovado simplesmente não vira
item.** Nenhuma `DataUsageDecision` foi criada, nenhum `display_allowed` foi
promovido, nenhuma licença foi alterada.

O crédito acompanha o item **ativo**: trocou de slide, trocou o crédito. Sem
provedor, nenhum crédito residual sobra. Provado item a item no QA real (§9.1,
check 29).

---

## 8. Matriz de capacidades

| Capacidade | Implementada | Conectada | Fixture QA | Produção consultada | Autorizada | Visível |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| Notícias de Filmes | ✅ | ✅ | ✅ 3 matérias | ❌ | ✅ gate editorial | ✅ tab Filmes |
| Notícias de Séries | ✅ | ✅ | ✅ 3 matérias | ❌ | ✅ gate editorial | ✅ tab Séries |
| Tabs internas (sem navegação) | ✅ | ✅ | ✅ | ❌ | n/a | ✅ |
| Ticker 4–5 itens | ✅ | ✅ | ✅ 5 itens | ❌ | n/a | ✅ 5 dots |
| Episódio (hoje / futuro) | ✅ | ✅ | ✅ 2 itens | ❌ | n/a | ✅ |
| Filme (estreia) | ✅ | ✅ | ✅ 1 item | ❌ | n/a | ✅ |
| Série (estreia de temporada) | ✅ | ✅ | ✅ 1 item | ❌ | n/a | ✅ |
| Streaming / provedor | ✅ | ✅ | ✅ 1 item | ❌ | ✅ `licensedWatchWhere` + decisão vigente | ✅ CTA + crédito |
| Sessão de cinema (formato/rede/horário) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ **por decisão** |

A última linha é o ponto: a capacidade **não existe** no sistema, então não é
exibida — nem com texto plausível copiado do mock.

---

## 9. QA — aplicação Next.js real

### 9.1 `pnpm --filter @screena/web qa:home-editorial` — **42/42**

PostgreSQL 16 efêmero (`embedded-postgres`) + `prisma migrate deploy` +
`db:seed` + fixtures + `next start` sobre o build real + Playwright.

**Cenário:** 5 novidades de **entidades distintas** (episódio hoje com provedor;
episódio futuro sem provedor; filme estreando hoje; temporada estreando na
semana; filme recém-chegado ao streaming com provedor), 3+3 matérias publicadas,
e **4 controles negativos**: agendada, rascunho, retratada e sem classificação.

Blocos de checagem:

| Bloco | Checks | O que prova |
| --- | ---: | --- |
| D1 destaques (tab Filmes) | 12 | 3 cards, todos → `/pt/noticias/`; nenhum → ficha; tabs são `<button role=tab>` sem `href`; tab inicial Filmes; URL `/pt/`; grid de 3 colunas; deck no lead; eyebrow nos 3; zero metadata de catálogo; alt real; placeholder em 1 card; zero overflow; agendada/rascunho/retratada não vazam; sem classificação fora dos destaques |
| D2 clicar em Séries | 4 | URL continua `/pt/`; `aria-selected` muda; **o conteúdo muda de verdade**; cards continuam → `/pt/noticias/` |
| D3 teclado | 1 | Seta direita troca a tab sem navegar |
| T1–T3 faixa | 6 | 5 dots, 1 item visível, dot ativo 18px; provedor + crédito; clique em dot troca; teclado troca; nada de sessão de cinema |
| T4 varredura dos 5 slides | 4 | 5 textos **distintos**; item sem provedor cai para `Ver filme`/`Ver série`; crédito existe **se e somente se** há provedor; dois CTAs com plataformas reais do banco |
| T5–T7 movimento | 3 | Autoplay troca sozinho (~6 s); **hover pausa**; `prefers-reduced-motion` desliga o autoplay **e** o controle manual continua |
| E1–E3 estados de dado | 4 | Vertical vazia → mensagem honesta, sem cair no catálogo, sem trocar de tab; 2 matérias → grid de 2 colunas sem inventar a 3ª; faixa sem novidade → permanece, `AGENDA` + `Ver lançamentos`, 0 dots, sem crédito |
| V viewports | 5 | 1576×892, 1280×900, 1126×799, 768×1024, 390×844 — zero overflow, 5 dots, CTA na tela, 3 cards no desktop |

Overflow medido em toda captura por
`document.documentElement.scrollWidth <= clientWidth`.

**Capturas:** `apps/web/.qa-home-editorial/` — viewport, recorte da **faixa** e
recorte da seção **destaques** por cenário (o hero é alto e a viewport sozinha
não mostraria nenhuma das duas).

### 9.2 `pnpm --filter @screena/web qa:home-fold` — **26/26**

Regressão da PR #89: header transparente sobre o hero e sólido após scroll,
menu na ordem canônica, título sem sublinhado, backdrop real, acento do menu
seguindo a ROTA e o dot seguindo o SLIDE, Cinerie Score nos dois estados,
provedor licenciado nos três estados, 5 viewports.

Dois checks foram **atualizados** (não afrouxados), por consequência intencional
da mudança:

- o estado neutro da faixa deixou de ser episódio-only:
  `"Nenhum episódio novo confirmado para hoje"` / `"Ver séries"` →
  `"Nenhuma novidade confirmada para hoje"` / `"Ver lançamentos"`;
- o ritmo abaixo da faixa era medido por `.feat-head`. Aquele cenário **não
  semeia matéria nenhuma**, então a seção editorial corretamente não existe: a
  âncora passou a ser a primeira banda de conteúdo após a faixa, e **foi
  adicionado** um check novo provando que, sem matéria publicada, "Destaques de
  hoje" não é renderizado.

### 9.3 Segurança do QA

- `DATABASE_URL` sempre `127.0.0.1` num banco descartável; o script **aborta** se
  não for. Nenhum `.env` de produção é lido ou copiado.
- Zero rede de dados: nenhuma chamada a TMDB/RapidAPI/Gemini. As URLs de
  **imagem** (CDN do TMDB e `/media/` das matérias) são interceptadas no browser
  e servidas por assets locais gerados deterministicamente (LCG próprio, sem
  `Math.random`).
- Nenhuma fixture toca `apps/web/public/`. Postgres derrubado e diretório
  removido no `finally`.

---

## 10. Testes e gates

| Comando | Resultado |
| --- | --- |
| `pnpm typecheck` | PASSOU |
| `pnpm typecheck:web` | PASSOU |
| `pnpm typecheck:admin` | PASSOU |
| `pnpm lint` | PASSOU |
| `pnpm test` | **3.832 testes / 313 arquivos**, 100% verdes |
| `pnpm audit:invariants` | PASSOU — 7 ok, 0 violações |
| `pnpm audit:render` | PASSOU — 2 ok, 0 violações |
| `pnpm api:coverage` | PASSOU — 7 ok, 0 violações |
| `pnpm build` | PASSOU |
| `pnpm --filter @screena/web validate:all` | 139/140 assertivas (6 validadores 100%; ver nota) |
| `qa:home-editorial` | 42/42 |
| `qa:home-fold` | 26/26 |

**Nota sobre `validate:all` (139/140).** A única assertiva que não roda é
`validate:person-eligibility`, e a falha é de **ambiente**, não do código: o
`initdb` do PostgreSQL embarcado recusa UTF8 quando os binários vivem sob um
caminho com caractere não-ASCII, e este repositório está sob `Área de Trabalho`.
Os outros validadores têm fallback de encoding; esse não. O arquivo
**não foi tocado** nesta missão (`git status` limpo para ele) e a CI roda em
Linux, onde ele passa. Registrado aqui em vez de escondido atrás do "PASSOU"
agregado.

### Testes novos (50)

**`home-editorial-presenter.test.ts` — 16.** Classificação por sinal persistido
(incluindo o controle negativo de keyword); sem vínculo classificável não entra;
híbrida nos dois filtros; agendada/rascunho/retratada/arquivada não passam;
licença bloqueada e display negado não passam; crédito e linkback exigidos e
ausentes bloqueiam (**com controle positivo**); sem slug/título não vira card;
todo href é de notícia; eyebrow real com fallback de vertical; imagem só local
válida (5 casos inválidos); alt presente; ordenação determinística sob
embaralhamento; data do artigo como fallback; limite por vertical.

**`home-ticker-presenter.test.ts` — 13.** Ordenação por balde/data/tipo/id;
determinismo sob embaralhamento; oferta que passa a valer hoje conta como hoje;
chegadas da mais recente para a mais antiga; dedupe exato; mesma série não ocupa
dois slots; mesmo filme não é estreia **e** chegada; filme e série de mesmo id
não colidem; teto de 5; menos que o alvo devolve só o real; helpers puros.

**`home-editorial-and-ticker-contract.test.ts` — 21.** Travas estruturais: a
seção não cita contrato de catálogo; o loader não toca tabelas de catálogo;
nenhum href de ficha; nenhuma metadata de entidade; placeholder e nunca pôster;
alt sempre real; a seção só renderiza com matéria; tabs são `<button>` com
`role`/`aria-selected`/`aria-controls`/`tabpanel`; **sem** `href`, `router.push`,
`useRouter`, `window.location`, `<Link>` ou `aria-current`; a lista trocada é
dataset, não estilo; a tab não deriva do hero; roving tabindex; estados vazios;
faixa com 1 item por vez e 1 dot por item; autoplay/hover/reduced-motion;
controle manual; CTA por tipo; crédito no item ativo; 4 fontes no loader;
chegada exige provedor; zero provedor hardcoded e zero dado de sessão.

### Testes de contrato atualizados (não afrouxados)

- `home-canonical-contract.test.ts`: nomes dos getters; marcador de ordem passa a
  ser `<HomeEditorialHighlights`; copy do estado neutro. **Ganhou** guards: as 5
  `kind` do ticker precisam existir; toda janela de data precisa vir de coluna
  persistida; `seasonNumber > 0` e `season.seasonNumber` real; lote por
  `movieIds`/`tvIds`; proibição explícita de "em cartaz" e de dado de sessão.
  **Ganhou também** um helper `code()` que remove comentários antes de casar
  texto proibido — sem ele, *documentar* a regra passaria a violá-la.
- `public-shell-reset.test.ts`: `feat-card__placeholder` entra na allowlist de
  gradiente como **capa de mídia** (mesma categoria de `list-card__media--g`),
  com o porquê no comentário: ele ocupa o lugar da imagem da matéria, e é
  justamente por **não** usar o pôster da entidade que precisa de superfície
  própria.
- `category-home-canonical-contract.test.ts`: nome do getter.

---

## 11. Revisão adversarial

Todos os itens do checklist da missão foram verificados. Os **cinco achados
reais** abaixo foram corrigidos; os demais itens não se aplicavam ou já estavam
cobertos por trava.

| # | Sev. | Achado | Correção |
| --- | --- | --- | --- |
| A1 | **BLOCKER** | **Alvos de toque dos dots se sobrepunham.** A área ampliada de 24 px de largura invadia o dot vizinho (os dots ficam a 6 px), e o alvo de cima roubava o clique do de baixo. **Pego pelo QA no app real** — o Playwright reportou `<button class="ticker__dot"> intercepts pointer events` —, não pela leitura do CSS. | A área cresce só até a **metade do gap** (`left:-3px; right:-3px`), então os alvos se encostam sem se cobrir; a altura vai a 24 px |
| A2 | MAJOR | **`fetchPriority="high"` na imagem do card principal.** A seção fica abaixo do hero e da faixa — fora da primeira dobra em todas as viewports medidas —, então a prioridade competia com o backdrop do hero, que é o LCP real | `loading="lazy"` nos três cards |
| A3 | MAJOR | **Hover e foco compartilhavam um booleano.** Sair do foco com `Tab` religava o autoplay mesmo com o mouse parado sobre a faixa: o texto trocava embaixo do cursor de quem estava lendo | `hovered` e `focused` viraram estados independentes; `paused = hovered \|\| focused` |
| A4 | MINOR | **`aria-live` no container inteiro.** A cada troca de slide o leitor de tela repetia dots e CTA | `aria-live` restrito ao `.ticker__lead` (texto); dots ganharam `aria-controls` apontando para ele |
| A5 | MINOR | **Contagem de queries documentada errada.** O cabeçalho dizia "constante (7)"; eram 9, porque o backfill de nome rodava sempre | Backfill agora só consulta entidades que apareceram **exclusivamente** via streaming (0–2 queries); cabeçalho corrigido para "7 no caminho comum, no máximo 9" |

**Caps declarados, não escondidos.** Dois limites de leitura existem e estão
documentados no código e aqui: `EDITORIAL_FETCH_LIMIT = 60` traduções por request
e `EVENT_FETCH_LIMIT = 60` linhas por fonte de evento. O caso extremo conhecido do
segundo é uma temporada inteira estreando no mesmo dia numa única série — as 60
linhas seriam do mesmo `tv_show_id` e a faixa mostraria **menos itens reais**.
É a troca certa: a alternativa seria fabricar novidade para completar cinco.

**Um achado do banco, não meu.** A primeira versão do cenário E3 do QA fazia
`UPDATE watch_availability SET available_from = NULL` e o PostgreSQL recusou:
`fail-closed: approved_payload_hash ausente ou != fingerprint do payload atual`.
O guard de produção estava **certo** — `available_from` integra o fingerprint do
payload aprovado. O cenário passou a usar `display_allowed`, que fica fora do
fingerprint exatamente por ser a chave de exibição.

### Delta consciente em relação ao canônico

O card principal do canônico tem headline + deck, **sem** kicker. O contrato desta
missão pede eyebrow nos três cards. O contrato venceu, e o eyebrow do lead usa o
amarelo editorial (`--c-accent-editorial`), consistente com o card B.

---

## 12. Produção

```
deploy:              não executado
banco de produção:   não consultado
indexação:           inalterada
migrations:          nenhuma criada ou alterada
licenças:            nenhuma DataUsageDecision criada; nenhum display_allowed promovido
EasyPanel:           não tocado
```

Nenhuma decisão que exija revisão humana (licença, indexação em massa,
publicação) foi tomada por esta missão.

---

## 13. Próxima sessão — resumo autocontido

**O que mudou.** "Destaques de hoje" deixou de ser catálogo e virou seção
editorial: três matérias publicadas, todas linkando para `/pt/noticias/`, com
`Filmes`/`Séries` como tabs internas que não navegam. A faixa amarela deixou de
ser "episódio de hoje ou fallback" e virou carrossel de 4–5 novidades reais
agregadas de quatro fontes persistidas.

**Onde olhar primeiro.**

| Assunto | Arquivo |
| --- | --- |
| Gate, classificação e forma do card editorial | `apps/web/src/lib/home-editorial-presenter.ts` |
| Query editorial | `apps/web/src/server/home-editorial.ts` |
| Tabs | `apps/web/app/_components/home-editorial-highlights.tsx` |
| Contrato, ordenação e dedupe do ticker | `apps/web/src/lib/home-ticker-presenter.ts` |
| Agregação das 4 fontes | `apps/web/src/server/home-ticker.ts` |
| Carrossel | `apps/web/app/_components/home-ticker.tsx` |
| QA no app real | `pnpm --filter @screena/web qa:home-editorial` (exige `pnpm build`) |

**Três coisas para não reaprender do jeito difícil.**

1. **`articles.category` não classifica nada.** É texto livre sem vocabulário
   controlado. A vertical vem de `entity_news_links`. Se um dia existir
   `ArticleCategory` como enum, ele entra como sinal 1 — até lá, não.
2. **O canônico não tem classes CSS.** É tudo `style=` inline. Comparar por
   seletor não funciona; compare por valor computado.
3. **Alvo de toque ampliado pode roubar clique do vizinho.** Ninguém vê isso
   lendo CSS — foi o Playwright no app real que apontou. Se ampliar área de
   clique de elementos próximos, cresça no máximo até metade do gap.

**O que continua fora do escopo e por quê.** Sessão de cinema, formato de
exibição, idioma da sessão, rede/sala e horário: o sistema **não persiste** esses
fatos. Enquanto não existir integração real, a faixa não os menciona — mesmo que
o protótipo os mostre.
