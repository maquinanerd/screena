# Handoff — Página de Filme (Movie Detail) · Screena

> Documento técnico para aplicar **apenas** a tela **Movie Detail / página de filme**
> do protótipo `Screena Screens.dc.html` no repositório real **maquinanerd/screena**,
> na rota `/pt/filmes/[slug]`.
>
> **Não implemente código a partir deste documento automaticamente.** Ele é uma
> especificação de design + regras de migração. Nada de commit, nada de adicionar repo,
> nada de API externa no render.

---

## 1. Identificação da tela

| Item | Valor |
|---|---|
| Nome no design | **Movie / Detalhe do título** (rótulo "MOVIE" no nav) |
| Estado correspondente | `screen === "movie"` ou `screen === "movieDetail"` → flag `isMovieDetail` |
| Bloco no protótipo | `<sc-if value="{{ isMovieDetail }}">` |
| Linhas aprox. no `Screena Screens.dc.html` | **~631 a ~810** (do comentário `MOVIE (detalhe do título)` até o fechamento `</sc-if>` antes de `SERIES`) |
| Logic / flags | linha ~1221 `const isMovieDetail = screen === "movie" || screen === "movieDetail";` |
| Acento de categoria | `catRed = isCinema || isMovieDetail;` → `boxColor = "#F0443E"` |
| Dados usados | `cast` (~1545), `related` (~1563), `movieArticles` (~1531) |

### Partes que pertencem à página de filme (ordem vertical real)

1. **Top info bar** — grid 3 colunas: título+gênero+sinopse curta · avaliações · onde assistir
2. **Faixa de mídia** — grid 1fr/3fr/2fr, altura 540px, fundo escuro cinematográfico (poster + trailer + 3 tiles)
3. **Elenco e equipe** — grid 4 colunas, avatares circulares
4. **Anúncio leaderboard** (`AdSlot` — fora de escopo de migração)
5. **Faixa Awards** — banner bege com troféus
6. **Bilheteria** — orçamento / variação % / receita
7. **Sinopse** — parágrafo + card "resumo sem spoilers"
8. **Artigos relacionados** — grid 3 colunas
9. **Anúncio billboard** (`AdSlot` — fora de escopo)
10. **Filmes relacionados** — grid 5 posters
11. **Nav fixo** (global) e **Footer** (global) — compartilhados com as outras telas

---

## 2. Tokens visuais

Extraídos diretamente do protótipo. Fonte única: **Montserrat** (Google Fonts), pesos 100–900.

### Cores

| Token | Hex | Uso |
|---|---|---|
| `--bg-page` | `#F7F6F2` | fundo geral da página |
| `--bg-surface` | `#FFFFFF` | cards, chips "onde assistir", caixas de avaliação |
| `--bg-muted` | `#EFEDE7` | faixa Awards |
| `--bg-footer` | `#F1EEE8` | fundo do footer |
| `--bg-media` | `#0a0a0a` | base da faixa de mídia escura |
| `--text-strong` | `#101010` | títulos, números fortes |
| `--text-body` | `#242424` | corpo de texto |
| `--text-heading` | `#3a3a3a` | títulos de seção (uppercase tracking) |
| `--text-muted` | `#6E6E6E` | metadados, labels secundários, ano |
| `--accent-movie` | `#F0443E` | **acento vermelho de filmes** (badge, box do logo, CTA) |
| `--accent-movie-link` | `#8A1E1A` | links/ações em texto na página de filme ("Ler mais", "Avaliar agora") |
| `--accent-gold` | `#D2A12B` | troféus / Awards |
| `--accent-trend-up` | `#1F8A5B` | seta de tendência positiva |
| `--border` | `#E3DED6` | bordas de cards, divisores, scrollbar |
| `--border-dashed` | `#C9C2B6` | borda tracejada do card "sem spoilers" |
| `--poster-number` | `#E7E2D9` | numeral gigante (não usado na página de filme, mas no design system) |
| selection | `#F0443E` bg / `#fff` text | `::selection` |

> Verde de séries `#7FA56F` / `#395C42` **não** pertence à página de filme — não migrar.

### Tipografia

| Papel | Família | Tamanho | Peso | Line-height | Tracking |
|---|---|---|---|---|---|
| Título do filme (`h1`) | Montserrat | `34px` | `800` | normal | `-0.03em` |
| Ano (no `h1`) | Montserrat | herda | `600` | — | — |
| Badge de gênero | Montserrat | `10px` | normal | — | `0.14em`, uppercase |
| Sinopse curta (top bar) | Montserrat | `15px` | normal | `1.55` | — |
| Labels "Avaliações"/"Onde assistir" | Montserrat | `13px` | `700` | — | — |
| Nota de avaliação (número) | Montserrat | `22px` | `800` | — | `-0.02em` |
| Sufixo "/10" / "%" | Montserrat | `11px` | `600` | — | — |
| Títulos de seção (Elenco, Bilheteria, Sinopse…) | Montserrat | `19–20px` | `800` | — | `0.18–0.2em`, uppercase |
| Nome de pessoa (elenco) | Montserrat | `14px` | `700` | `1.4` | — |
| Papel/personagem (elenco) | Montserrat | `14px` | normal (`#6E6E6E`) | `1.4` | — |
| Números de bilheteria | Montserrat | `30px` | `800` | `1` | `-0.02em` |
| Variação % (destaque) | Montserrat | `60px` | `800` | `1` | `-0.04em` |
| Corpo da sinopse | Montserrat | `16px` | normal | `1.7` | — |
| Card relacionado (título) | Montserrat | `15px` | `700` | `1.3` | — |
| Poster relacionado (título) | Montserrat | `14px` | `650` | — | — |
| Texto faixa Awards | Montserrat | `15px` | normal | `1.5` | — |
| CTA Awards (vitórias) | Montserrat | `17px` | `700` | — | — |

### Espaçamentos, containers, grids

| Item | Valor |
|---|---|
| Container central | `max-width: 1280px; margin: 0 auto;` |
| Padding horizontal padrão | `0 80px` (desktop) |
| Padding vertical entre seções | `48–72px` no topo de cada seção |
| Top info bar | `padding: 36px 80px 28px;` grid `1.45fr 1.25fr 1fr; gap: 40px; align-items: start` |
| Faixa de mídia | full-bleed, `grid-template-columns: 1fr 3fr 2fr; gap: 4px; height: 540px` |
| Tiles da mídia (coluna 3) | `grid-template-rows: 1fr 1fr 1fr; gap: 4px` |
| Avaliações | `display: flex; gap: 10px` (3 caixas `flex:1`) |
| Onde assistir | `display: flex; gap: 10px; flex-wrap: wrap`; chips `height: 44px; padding: 0 18px` |
| Elenco | `grid-template-columns: repeat(4,1fr); gap: 20px 36px`; avatar `48×48` circular |
| Bilheteria | `grid-template-columns: 1fr auto 1fr; gap: 48px; max-width: 960px` |
| Sinopse | `grid-template-columns: 1fr 320px; gap: 40px; align-items: start` |
| Artigos relacionados | `grid-template-columns: repeat(3,1fr); gap: 20px` |
| Filmes relacionados | `grid-template-columns: repeat(5,1fr); gap: 18px`; poster `aspect-ratio: 2/3` |
| Cards "Bilheteria" | `padding: 30px 32px; gap: 18px` |

### Bordas, sombras, radius

| Item | Valor |
|---|---|
| Radius global | **`0`** — design system de cantos retos (sem border-radius em cards/badges/chips) |
| Exceções a radius:0 | avatares de elenco (`border-radius: 50%`), botão circular de play (`50%`), setas de seção (`50%`) |
| Borda padrão | `1px solid #E3DED6` |
| Borda tracejada | `1.5px dashed #C9C2B6` (card sem spoilers) |
| Sombra de card | `0 10px 30px rgba(20,20,20,0.06)` (bilheteria) |
| Sombra de card relacionado | `0 10px 28px rgba(0,0,0,0.07)` |
| Sombra de poster | `0 10px 28px rgba(0,0,0,0.1)` |

### Responsivo / breakpoints

O protótipo é desenhado para **desktop ~1440px** (preview `1440×1024`). Não há media queries no protótipo. Para o repo real, ver §5 (responsividade básica).

---

## 3. Estrutura da página de filme — seção por seção

### 3.1 Header / Top info bar
Grid de 3 colunas (`1.45fr 1.25fr 1fr`):

- **Coluna 1:** `h1` "Oppenheimer (2023)" (ano em peso 600 cinza) + badge de gênero vermelho (`#F0443E`, uppercase, tracking 0.14em, radius 0) + sinopse curta (`15px/1.55`, max `58ch`) com link "Ler mais" (`#8A1E1A`, underline).
- **Coluna 2:** label "Avaliações" + 3 caixas (IMDb, TMDB, Rotten Tomatoes) com logo SVG + nota grande (`22px/800`) + sufixo. Link "Avaliar agora".
- **Coluna 3:** label "Onde assistir" + chips de plataforma (Netflix, Prime, Max, Apple TV+), `height: 44px`, borda `#E3DED6`.

> **Área de avaliações → FORA DE ESCOPO por enquanto.** Migrar como placeholder estrutural sem dados reais (ver §5/§6).
> **Onde assistir → FORA DE ESCOPO por enquanto.** Idem.

### 3.2 Breadcrumb
> O protótipo **não tem** breadcrumb na página de filme (existe na página de artigo). No repo real, adicionar breadcrumb simples `Início › Filmes › {título}` é **opcional**; se incluído, usar `#6E6E6E`, separador `›`, link ativo em `#8A1E1A`. Tratar como item de layout, não como dado.

### 3.3 Badge "Filme"
Badge vermelho `#F0443E`, texto branco, `font-size: 10px`, `letter-spacing: 0.14em`, `text-transform: uppercase`, `padding: 6px 11px`, `border-radius: 0`. No protótipo carrega os gêneros ("Biografia · Drama · História"); no repo real pode exibir o(s) gênero(s) reais vindos de `getMoviePageData`.

### 3.4 Título / ano / metadados
`h1` 34px/800, `-0.03em`. Ano entre parênteses peso 600 `#6E6E6E`. Duração/classificação aparecem no **hero da home** (3h 1m, PG-13) — na página de filme a duração pode entrar junto aos metadados se houver dado real; caso contrário omitir.

### 3.5 Sinopse curta
Parágrafo `15px/1.55`, `#242424`, `max-width: 58ch`, com link "Ler mais".

### 3.6 Faixa de mídia / poster / trailer (placeholder visual)
Grid `1fr 3fr 2fr`, `height: 540px`, fundo `#0a0a0a`, `gap: 4px`:
- **1/6:** poster — placeholder gradiente escuro.
- **3/6:** trailer — placeholder com scrim + botão play circular (74×74, borda branca) + legendas "03:01 | Trailer" e "13 vídeos | 252 fotos".
- **2/6:** três tiles ("Fotos e Vídeos", "Notícias e Eventos", "Prêmios e Indicações"), cada um gradiente + scrim inferior + rótulo branco 18px/700.

> Migrar **somente como placeholder visual**, sem dados falsos. Sem `<img>` com URLs inventadas — usar blocos com `background` neutro ou o primeiro frame real se já existir no DB.

### 3.7 Elenco / equipe
Grid `repeat(4,1fr); gap: 20px 36px`. Cada item: avatar circular 48×48 + nome (700) + papel (`#6E6E6E`). Cabeçalho centralizado com setas circulares de navegação.

> Migrar **somente se houver dados de elenco** em `getMoviePageData`. Sem dados → omitir a seção inteira (não renderizar placeholders de pessoas falsas).

### 3.8 Awards / Bilheteria
- **Faixa Awards:** banner `#EFEDE7`, troféus dourados `#D2A12B`, texto + "X vitórias & Y indicações".
- **Bilheteria:** orçamento / variação % (60px) / receita, em 3 colunas.

> **FUTURO.** Não implementar prêmios nem bilheteria reais agora. Não migrar a faixa Awards nem o bloco Bilheteria com números reais. Se quiser preservar o layout, deixar atrás de flag/condicional desativada, sem dados.

### 3.9 Sinopse / blocos editoriais
Grid `1fr 320px`: parágrafo `16px/1.7` + card lateral tracejado "Resumo sem spoilers" com link "sinopse completa". **Este é o principal bloco editorial a migrar** (texto real vindo do DB).

### 3.10 Artigos relacionados / filmes relacionados
- **Artigos relacionados:** grid `repeat(3,1fr)`, cards com capa + título + autor.
- **Filmes relacionados:** grid `repeat(5,1fr)`, posters `2/3` com badge de gênero.

> **FUTURO se não houver dados reais.** Não inventar artigos nem filmes. Renderizar só com dados reais de relacionamento já existentes; caso contrário omitir.

### 3.11 Footer
Footer global `#F1EEE8`, borda superior `#E3DED6`, grid `300px 1fr`, colunas de links (`footerCols`). É compartilhado entre telas — tratar como layout global do app, não específico da página de filme.

---

## 4. Regras para implementação no repo real

Aplicar na rota:

```
apps/web/app/pt/filmes/[slug]/page.tsx
```

**Invariantes a preservar (não violar):**

- `page.tsx` permanece **Server Component** (sem `"use client"` no topo da página).
- Dados **exclusivamente** via `getMoviePageData` (não chamar DB direto na página).
- Acesso a DB **apenas** em `apps/web/src/server/**`.
- Indexabilidade decidida por `evaluateMovieIndexability` — respeitar `noindex`.
- Passar em `validate:movie-page`.
- Passar em `audit:render`.
- **Zero API externa no render.** Nada de fetch a TMDB/Gemini/etc. durante o render.
- **Zero Gemini no render.**
- Sem dados inventados / sem hardcode de filme exemplo (nada de "Interestelar"/"Oppenheimer" fixos no componente real).

**Estado "em revisão editorial":** quando `evaluateMovieIndexability` retornar `noindex`, exibir o estado de revisão editorial (placeholder informativo) em vez do conteúdo completo — mantendo o layout/skeleton, sem dados falsos.

---

## 5. O que migrar AGORA

Apenas o esqueleto visual + os blocos com dados reais já disponíveis:

- **Layout geral** da página (fundo `#F7F6F2`, fonte Montserrat).
- **Container** `max-width: 1280px; padding: 0 80px`.
- **Hero / top info bar** (estrutura grid 3 colunas).
- **Breadcrumb** (opcional, item de layout).
- **Badge "Filme"** vermelho `#F0443E` (gênero real).
- **Título / ano / duração** (com dados reais; duração só se existir).
- **Blocos editoriais** — sinopse `16px/1.7` + card "sem spoilers" (texto real).
- **Placeholder visual de mídia** (sem dados falsos, sem `<img>` inventado).
- **Estado "em revisão editorial"** quando `noindex`.
- **Responsividade básica:** abaixo de ~1024px colapsar o grid 3-colunas da top bar para 1 coluna; reduzir `padding: 0 80px` → `0 20px`; mídia `540px` → altura fluida; grids de elenco/relacionados para 2 colunas. Sem reescrever o design — só evitar overflow.

---

## 6. O que NÃO migrar agora

Explícito:

- ❌ Não migrar **home**.
- ❌ Não migrar **página de série**.
- ❌ Não migrar **browse**.
- ❌ Não migrar **pessoa**.
- ❌ Não criar **design system completo**.
- ❌ Não implementar **ratings reais** (IMDb/TMDB/RT — área de avaliações fica fora de escopo).
- ❌ Não implementar **streaming / onde assistir** real.
- ❌ Não implementar **bilheteria real**.
- ❌ Não implementar **prêmios reais** (faixa Awards).
- ❌ Não criar **carrosséis funcionais com JS** (setas são decorativas por enquanto).
- ❌ Não criar **client component** sem necessidade.
- ❌ Não **inventar dados**.
- ❌ Não **hardcodar Oppenheimer/Interestelar** (nem qualquer filme exemplo) no componente real.

---

## 7. Sugestão de arquivos a alterar no repo real

| Arquivo | Quando |
|---|---|
| `apps/web/app/pt/filmes/[slug]/page.tsx` | sempre — é a rota alvo |
| CSS global / `*.module.css` | se precisar de estilos não-inline (manter tokens da §2) |
| Componentes server-only / presentacionais | se quebrar a página em sub-blocos (Hero, Sinopse, MediaPlaceholder) — todos server por padrão |
| `movie-presenter.ts` | **somente** se for necessário mapear campos existentes para a view |
| `movie-page.ts` (query/seleção) | **somente** se for necessário selecionar campos já existentes |

> Não criar arquivos novos além do necessário. Preferir reaproveitar presenter/query existentes.

---

## 8. Checklist de validação

Rodar, na ordem:

```bash
npx pnpm@9.15.4 --filter @screena/web build
npx pnpm@9.15.4 --filter @screena/web typecheck
npx pnpm@9.15.4 --filter @screena/web lint
npx pnpm@9.15.4 --filter @screena/web validate:movie-page
npx pnpm@9.15.4 test
npx pnpm@9.15.4 typecheck
npx pnpm@9.15.4 lint
npx pnpm@9.15.4 audit:invariants
npx pnpm@9.15.4 audit:render
```

---

### Lembretes finais

- Não implemente código a partir deste handoff.
- Não adicione o repositório aqui.
- Não faça commit.
- Este arquivo é a especificação; a aplicação no repo real é feita separadamente.
