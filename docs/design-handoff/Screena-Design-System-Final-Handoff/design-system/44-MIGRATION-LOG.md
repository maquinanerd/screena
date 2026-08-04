# 44 — Migration Log (D4B)

Migração semântica + visual das 18 telas para os componentes canônicos. **Único arquivo canônico editado:** `Screen Screens v4.dc.html`.

## Gate 1 — Preflight (PASS)
- Hash inicial (SHA-256): `0cc8fcd6afe74b64afcbf4c1e4d7c50b62585d6baf8d1faf2df68f18677bfe74`
- Bytes iniciais: **367.827**
- Snapshot `POST-REBRAND-SNAPSHOT/` intacto (11 entradas)
- JSONs validados: page-specifications (18), component-contracts (104), migration-matrix, interactive-semantics-map
- Baseline reconfirmada por script: **106 = 64 span + 40 div + 1 h1 + 1 article**
- Backup: `backups/Screen Screens v4.PRE-D4B.dc.html` (hash idêntico ao inicial)

## Bug da 1ª transformação + recuperação
- 1ª passada trocou apenas as **tags de abertura** (`<span>`/`<div>`→`<a>`/`<button>`), deixando os fechamentos `</span>`/`</div>` — gerou HTML malformado (React reparentou → âncoras-invólucro gigantes de 2841px, hrefs nulos).
- **Recuperação:** restaurado o template a partir do backup e reaplicada a transformação com **parser balanceado** (pilha de open/close por nome de tag, ignorando voids SVG/HTML). Resultado: 106 abre+fecha pareados; `<a>` 77/77 e `<button>` 29/29 balanceados.

## Migração semântica (106 → 0)
- **LINK 77 → `<a href data-nav>`** (navegação real: foco, teclado, Enter, abrir em nova aba)
- **TAB 24 → `<button type="button" role="tab">`**
- **ICON_BUTTON 4 → `<button type="button" aria-label>`** (setas de carousel/recs)
- **REMOVER 1** → switcher (dev) → `<button aria-label>`
- `<h1>` do hero permanece **heading**; o controle virou `<a>` interno.
- `<article>` de notícia permanece **estrutural** (`position:relative`), com **stretched-link** no título (`<a style-after>` cobrindo o card) — sem `article onClick`, sem link aninhado, sem foco duplicado.

## Alterações de lógica (href + navegação)
- `route(s)` — mapa screen→rota (`/pt`, `/pt/filmes`, `/pt/series`, `/pt/pessoas`, `/pt/onde-assistir`, `/pt/explorar`, `/pt/em-breve`, `/pt/noticias`, `/pt/configuracoes`, …).
- **31 sites `go: () => this.go(ARG)`** → acrescido `href: this.route(ARG)` (href por item = destino exato do handler).
- `deck` (emAlta/continuar/lançamentos/…): `go`/`href` por tipo.
- `discFeature`: `go`/`href` (movieDetail).
- `catDetailGo`: `it.href` por contexto (série/filme).
- `movieRecs` e `knownFor`: normalizador `.map()` com `go`/`href` (cards de recomendação viraram links reais).
- **navGuard**: interceptor global `click` (capture) que faz `preventDefault` em `a[data-nav]` → o protótipo continua navegando por estado (URL não muda), mantendo o `<a>` semântico.

## Resultado por lote (todos PASS)
- **A** — 01 Switcher, 16 Entrar, 17 Ad-pop, 18 Ad-tela
- **B** — 13 Configurações, 14 Importar dados
- **C** — 03 Notícias, 10 Onde assistir, 11 Explorar, 12 Mais aguardados, 15 Listas
- **D** — 05 Artigo, 09 Pessoa
- **E** — 02 Home, 04 Categoria (Filmes/Séries)
- **F** — 06 Filme, 07 Série, 08 Série mobile

## Resultado por tela (sweep ao vivo — badHref/nested/wrapper = 0 em todas)
02 Home 45a/18b · 03 Notícias 16a/10b · 04 Cinema 38a/13b (logo vermelha, 24 slots) · 04 Série 40a/16b (logo verde, 26 slots) · 05 Artigo 12a/7b (1 article) · 06 Filme ~40a · 07 Série 28a/13b/10 tabs · 08 Série-mobile 16a, sem overflow · 09 Pessoa 3a/7b · 10 Browse 252a/12b · 11 Discover 4a/32 slots · 12 Aguardados 3a/18b · 13 Config 3a/54 ctrl · 14 Dados 3a/17b · 15 Listas 3a/7b · 16 Entrar 3a/9b · 17/18 Anúncio (overlay, rótulo PUBLICIDADE presente).

## QA estrutural (PASS)
0 inadequados · a 77/77 · button 29/29 · div 785/785 · span 553/553 · article 2/2 · h1 12/12 · sc-for 81/81 · sc-if 28/28 · 77 `<a>` todos com href · 29 `<button>` todos type=button · **21 AdSlots + 39 image-slots preservados** · 60 ids estáticos sem duplicata · 0 âncora aninhada.

## Warnings pré-existentes (aceitos, não são erros)
Holes loop-scoped (`{{ m.title }}`, `{{ a.cat }}`, etc.) emitem "never resolved" na passada de placeholder do dc-runtime — comportamento **pré-existente** (presente no backup), não introduzido pela D4B, não impede render. `<image-slot> without an id` idem.

## F-03 (responsividade)
Desktop (1280) verificado ao vivo nas 18 telas (sem overflow/invólucro). Mobile (390) e tablet (768): herdados do canônico — a migração é semântica (a/button) e não altera o CSS responsivo; screen 08 confirmado nativo-mobile sem overflow. Limitação: as ferramentas de screenshot não capturam conteúdo de `<iframe>`, então não há captura pixel a 390/768 (recomenda-se validação pixel dedicada na unidade de responsividade). Matriz em `responsive-matrix.json`.

## Regressões
- Encontrada: âncoras-invólucro por fechamento não pareado (1ª passada). **Corrigida** com parser balanceado.
- Encontrada: hrefs nulos em cards de recomendação (factories sem `go`/`href`). **Corrigida** (deck/discFeature/movieRecs/knownFor/catDetail).

## Hash final
`8cb1f3fca5bca12c26290266ce6ca0f590bd876f91cc8ee5837e09f5d103b213` · **380.216 bytes**
