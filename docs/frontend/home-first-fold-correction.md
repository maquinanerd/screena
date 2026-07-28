# Correção da primeira dobra da Home — relatório técnico completo

> Documento de rastreabilidade da task "CINERIE — CORREÇÃO DEFINITIVA DA HOME:
> HEADER + HERO + TICKER + PRIMEIRA DOBRA". Registra **tudo** que foi criado e
> editado, o código antes/depois, o que passa a aparecer no site publicado e de
> onde cada informação é lida.

---

## 1. Identificação

| Campo | Valor |
| --- | --- |
| Repositório | `maquinanerd/screena` |
| Base (`origin/main` na abertura) | `c3bb632ca72c310283772c6a54b29cb92ff359f1` (squash da PR #88) |
| Branch | `claude/home-header-hero-fixes-76c7f0` |
| Worktree | `.claude/worktrees/home-header-hero-fixes-76c7f0` (checkout primário intocado) |
| PR | [#89](https://github.com/maquinanerd/screena/pull/89) — **MERGED** |
| Commits da branch | `e305cb4` (1ª rodada) · `73850de` (2ª rodada) |
| **Head final** | `73850de476a7c02b0e5d26f1aad5f2cb0fb2762e` |
| **Merge SHA** (squash em `main`) | `0b2481aec1a4f3820bb0b3274454486593db0733` |
| Merge em | 2026-07-28T15:52:15Z |
| CI na PR (head `73850de`) | 3/3 pass — typecheck+lint+test+auditorias+build · backup/restore PG16 · imagem Docker |
| CI pós-merge em `main` (`0b2481a`) | **success** — [run 30375485358](https://github.com/maquinanerd/screena/actions/runs/30375485358) |

> Este relatório foi **consolidado após o merge** e reflete o estado FINAL da
> PR #89. Números, snippets e conclusões da primeira rodada que foram superados
> pela segunda estão corrigidos aqui, não preservados.

Este documento cobre **duas rodadas**. A primeira corrigiu chrome e CSS e
declarou débitos; a segunda fechou os débitos e **corrigiu uma afirmação errada**
da primeira (ver seção 8: a cadeia do Cinerie Score não estava "ligada" — estava
quebrada no loader).

**Rota afetada:** `/pt/` (`Public Marketing Home v4`). Por compartilhar o
template `HomeLike` e o chrome global, as mudanças alcançam também `/pt/filmes/`,
`/pt/series/` (hero + ticker) e o header/rodapé de **todas** as rotas.

---

## 2. Escopo

**Dentro:** header (geometria, transparência, menu, estado ativo), hero
(tipografia do título, meta-row, indicadores), faixa amarela (ticker) e o ritmo
vertical até "Destaques de hoje".

**Fora (deliberadamente não tocado):** arquitetura, contratos de dado, SEO,
indexabilidade, licenças, schema, serviços, cards de "Destaques", bandas
"Popular essa semana"/"Filmes em alta"/"Em breve"/"Notícias", JSON-LD.

Nenhum conteúdo do screenshot de referência foi hardcodado. Nenhuma migration.
Nenhuma chamada externa introduzida no render.

---

## 3. Diagnóstico — as 7 divergências e a causa raiz de cada uma

| # | Sintoma relatado | Causa raiz encontrada | Arquivo |
| --- | --- | --- | --- |
| 1 | Faixa escura com borda separando header e hero | `.site-header[data-overlay='true']` aplicava um **gradiente próprio** `linear-gradient(180deg, rgba(5,5,5,.55), rgba(5,5,5,0))` **empilhado** sobre o `hero__scrim-v`, que já entrega `.55` em 0%. Dois scrims no mesmo lugar → banda visível. | `globals.css:335` |
| 2 | Menu errado (`Filmes·Séries·Pessoas·Notícias·Explorar`) | `NAV_ITEMS` desatualizado em relação à tela 02 | `navigation.ts:18` |
| 3 | Título do hero com linha branca sob cada linha | O título era `<p className="hero__title">` e a regra global `p a { text-decoration: underline; text-decoration-thickness: .08em }` o alcançava. **Não era** `border-bottom` nem pseudo-elemento. | `globals.css:189` + `home-hero-carousel.tsx:97` |
| 4 | Indicador ativo do carrossel branco | `.hero__dot[aria-selected='true'] { background: #fff }`, sem qualquer sinal de vertical | `globals.css:816` |
| 5 | Faixa amarela ausente | `HomeTicker` fazia `if (items.length === 0) return null` — sem episódio estreando **hoje**, a faixa inteira sumia | `home-ticker.tsx:17` |
| 6 | Ritmo/transição para "Destaques de hoje" | `paddingTop: 56` somado à ausência da faixa | `home-like.tsx:118` |
| 7 | Scrims/contraste | **Nenhum defeito.** Os dois overlays canônicos já existiam com os valores exatos do handoff; a percepção de "mais luminosidade" vinha do backdrop diferente. Verificado, não alterado. | `globals.css:670,684` |

Sobre o item 3, a regra culpada (inalterada, porque é correta para corpo de texto):

```css
/* apps/web/app/globals.css:189 */
p a,
.article-body a,
.prose a {
  color: var(--ctx-accent-dark);
  text-decoration: underline;
  text-decoration-thickness: 0.08em;
  text-underline-offset: 0.18em;
}
```

O `<p>` também trazia `max-width: 70ch` e `text-wrap: pretty` do reset — mais um
motivo para trocar o elemento em vez de só sobrescrever a decoração.

---

## 4. Inventário de arquivos

### 4.1 Inventário FINAL — 24 arquivos, +2683/−87

Números conferidos contra o Git **e** contra a PR (os dois batem):

```bash
git diff --numstat c3bb632ca72c310283772c6a54b29cb92ff359f1..73850de476a7c02b0e5d26f1aad5f2cb0fb2762e
# 24 files changed, 2683 insertions(+), 87 deletions(-)
```

> Os números da 1ª rodada ("12 arquivos, +346/−85") ficaram obsoletos com a 2ª e
> **não** são preservados aqui.

**Novos (3 arquivos, +1875):**

| Arquivo | Δ | Natureza |
| --- | --- | --- |
| [apps/web/scripts/qa-home-first-fold-real-postgres.ts](../../apps/web/scripts/qa-home-first-fold-real-postgres.ts) | +830 | QA visual no app Next real + PG16 efêmero |
| [apps/web/src/server/editorial-score.ts](../../apps/web/src/server/editorial-score.ts) | +108 | procedência do Cinerie Score (fecha a cadeia quebrada) |
| [docs/frontend/home-first-fold-correction.md](./home-first-fold-correction.md) | +937 | este relatório |

**Código de produto (13 arquivos, +519/−80):**

| Arquivo | Δ | Natureza |
| --- | --- | --- |
| [apps/web/src/server/home-ticker.ts](../../apps/web/src/server/home-ticker.ts) | +188/−22 | fallback de estreia + provedor licenciado em lote |
| [apps/web/app/globals.css](../../apps/web/app/globals.css) | +89/−11 | header, título, dots, crédito e ticker mobile |
| [apps/web/app/_components/home-ticker.tsx](../../apps/web/app/_components/home-ticker.tsx) | +69/−14 | faixa como estrutura fixa, 3 estados + provedor/crédito |
| [apps/web/src/lib/watch-availability-presenter.ts](../../apps/web/src/lib/watch-availability-presenter.ts) | +32 | `selectTickerWatchOffer` + crédito por oferta |
| [apps/web/src/server/home-hero.ts](../../apps/web/src/server/home-hero.ts) | +28 | procedência do score no loader do hero |
| [apps/web/app/_components/site-header.tsx](../../apps/web/app/_components/site-header.tsx) | +25/−12 | `data-context`, guarda de hero, menu mobile |
| [apps/web/src/server/entity-indexes.ts](../../apps/web/src/server/entity-indexes.ts) | +23 | mesma procedência nos índices |
| [apps/web/app/_components/home-hero-carousel.tsx](../../apps/web/app/_components/home-hero-carousel.tsx) | +19/−15 | título deixa de ser `<p>`, meta-row condicional, `data-vertical` |
| [apps/web/src/lib/navigation.ts](../../apps/web/src/lib/navigation.ts) | +18/−2 | `NAV_ITEMS` novo + `SECONDARY_NAV_ITEMS` |
| [apps/web/src/server/home-catalog.ts](../../apps/web/src/server/home-catalog.ts) | +15 | mesma procedência nos cards da home |
| [apps/web/src/lib/routes.ts](../../apps/web/src/lib/routes.ts) | +6 | `LISTS_PATH`, `WATCH_PATH` |
| [apps/web/app/_components/site-footer.tsx](../../apps/web/app/_components/site-footer.tsx) | +4/−2 | rodapé lista primário + secundário |
| [apps/web/app/_components/home-like.tsx](../../apps/web/app/_components/home-like.tsx) | +3/−2 | ritmo 56 → 48 |

**Testes e guards (4 arquivos, +234/−7):**

| Arquivo | Δ | Natureza |
| --- | --- | --- |
| [tests/web/home-canonical-contract.test.ts](../../tests/web/home-canonical-contract.test.ts) | +113 | primeira dobra, acentos separados, procedência do score, faixa |
| [tests/web/watch-availability-presenter.test.ts](../../tests/web/watch-availability-presenter.test.ts) | +46 | 7 casos de `selectTickerWatchOffer` |
| [tests/governance/no-fake-streaming-in-ui.test.ts](../../tests/governance/no-fake-streaming-in-ui.test.ts) | +43/−2 | tokens reais + **controle negativo** |
| [tests/web/public-navigation.test.ts](../../tests/web/public-navigation.test.ts) | +32/−5 | menu novo + prova de rota viva |

**Infra e docs (4 arquivos, +55):**

| Arquivo | Δ | Natureza |
| --- | --- | --- |
| [docs/frontend/page-map.md](./page-map.md) | +38 | navegação global, acentos e QA |
| [scripts/audit/check-invariants.mjs](../../scripts/audit/check-invariants.mjs) | +13 | `allowedWhen` no guard de streaming |
| [.gitignore](../../.gitignore) | +3 | capturas do QA |
| [apps/web/package.json](../../apps/web/package.json) | +1 | script `qa:home-fold` |

### 4.2 Artefatos de QA não versionados

| Onde | Conteúdo |
| --- | --- |
| `apps/web/.qa-home-fold/` (gitignored) | capturas do **app Next real**, regeráveis por `qa:home-fold` |
| `…/scratchpad/fold-harness*.html`, `shoot.mjs` | harness estático da 1ª rodada — teste rápido de CSS, **não** evidência final |

### 4.3 Nada foi deletado.

---

## 5. As mudanças, arquivo por arquivo

### 5.1 `apps/web/src/lib/routes.ts` — duas rotas nomeadas

```ts
/** Caminho das listas do titular (com barra final). Area privada: noindex. */
export const LISTS_PATH = `/${PT_LOCALE_SEGMENT}/listas/`;

/** Caminho do hub "Onde assistir" (com barra final). */
export const WATCH_PATH = `/${PT_LOCALE_SEGMENT}/onde-assistir/`;
```

Módulo **puro** (sem env/DB/IO), importável por Client Component.

### 5.2 `apps/web/src/lib/navigation.ts` — fonte única do menu

```ts
/**
 * Menu PRIMÁRIO do header, na ordem do design canônico (tela 02).
 * Somente destinos públicos que possuem uma rota real no app.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Início', href: HOME_PATH },
  { label: 'Filmes', href: MOVIES_INDEX_PATH },
  { label: 'Séries', href: SERIES_INDEX_PATH },
  { label: 'Listas', href: LISTS_PATH },
  { label: 'Notícias', href: NEWS_INDEX_PATH },
  { label: 'Onde assistir', href: WATCH_PATH },
]

/**
 * Destinos reais que NÃO fazem parte do menu primário do canônico (Pessoas e
 * Explorar). As rotas continuam existindo e navegáveis: aparecem no rodapé e
 * no menu mobile — sair do header nunca significa virar link morto.
 */
export const SECONDARY_NAV_ITEMS: readonly NavItem[] = [
  { label: 'Pessoas', href: PEOPLE_INDEX_PATH },
  { label: 'Explorar', href: EXPLORE_PATH },
]
```

`isActiveNavigationPath` **não** mudou. Ela já tratava a Home como caso especial
(igualdade exata), então `Início` não fica ativo em `/pt/filmes/`:

```ts
if (target === normalizeNavigationPath(HOME_PATH)) return current === target
return current === target || current.startsWith(`${target}/`)
```

### 5.3 `apps/web/app/_components/site-header.tsx`

Três mudanças. **(a)** `data-context` no elemento, derivado **só do pathname**:

```tsx
<header
  className="site-header"
  data-context={context}          // 'movie' | 'series' | 'neutral'
  data-overlay={overlay ? 'true' : 'false'}
>
```

```ts
function logoContextOf(pathname: string | null): LogoContext {
  if (pathname === null) return 'neutral'
  if (pathname.startsWith('/pt/filmes')) return 'movie'
  if (pathname.startsWith('/pt/series')) return 'series'
  return 'neutral'
}
```

**(b)** guarda de hero — porque o overlay agora é transparente de verdade:

```tsx
/**
 * Rota de hero sem hero renderizado (catalogo vazio) existe: como o overlay
 * agora e TRANSPARENTE de verdade, texto branco cairia sobre pagina clara.
 * Comeca `true` (caso comum, sem flash no SSR) e o efeito corrige quando o
 * hero de fato nao esta no documento.
 */
const [hasHero, setHasHero] = useState(true)

useEffect(() => {
  if (!heroRoute) return
  setHasHero(document.querySelector('#main-content .hero') !== null)
  const onScroll = () => setScrolled(window.scrollY > 24)
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
  return () => window.removeEventListener('scroll', onScroll)
}, [heroRoute, pathname])

const overlay = heroRoute && hasHero && !scrolled
```

**(c)** menu mobile passa a listar primário + secundário (o `Início` hardcodado
saiu, porque agora está em `NAV_ITEMS`):

```tsx
{[...NAV_ITEMS, ...SECONDARY_NAV_ITEMS].map((item) => (
  <li key={item.href}>
    <a href={item.href} onClick={() => menuRef.current?.close()}>{item.label}</a>
  </li>
))}
```

### 5.4 `apps/web/app/_components/site-footer.tsx`

```tsx
{/* Rodape carrega TODAS as rotas reais: as do menu primario mais
    Pessoas/Explorar, que ficam fora do header canonico. */}
{[...NAV_ITEMS, ...SECONDARY_NAV_ITEMS].map((item) => (
  <li key={item.href}><a href={item.href}>{item.label}</a></li>
))}
```

### 5.5 `apps/web/app/_components/home-hero-carousel.tsx`

**Título — a correção crítica.** De `<p>` para `<div>`:

```diff
-            <p className="hero__title">
+            <div className="hero__title">
               <a href={slide.href}>{slide.title}</a>
-            </p>
+            </div>
```

O link permanece (é navegação real para a ficha) mas não altera a aparência —
ver o reset em 5.7. O `<h1>` semântico único da Home continua sendo o
institucional visualmente oculto, travado por `tests/governance/home-seo-identity.test.ts`.

**Meta-row condicional** — não reserva espaço morto quando não há nem nota nem
classificação:

```tsx
{stars !== null || slide.certification !== null ? (
  <div className="hero__meta-row">
    {stars !== null ? (
      <span aria-label={`Nota ${slide.rating?.value} de ${slide.rating?.scale}`} className="hero__stars">
        {stars.on}
        <span aria-hidden="true" className="hero__stars-off">{stars.off}</span>
      </span>
    ) : null}
    {slide.certification !== null ? (
      <span className="hero__cert">{slide.certification}</span>
    ) : null}
  </div>
) : null}
```

**Dots carregam a vertical do próprio slide:**

```diff
   aria-selected={index === active}
   className="hero__dot"
+  data-vertical={s.vertical}
   key={s.href}
```

### 5.6 `apps/web/src/server/home-ticker.ts` — reescrito

Contrato **final** (com o provedor da 2ª rodada):

```ts
/**
 * Provedor legal de UMA serie do ticker — ja aprovado pelo MESMO gate de
 * licenca do painel de detalhe (`licensedWatchWhere` + presenter puro). Nunca
 * plataforma inventada, nunca logo (a licenca do agregador nao autoriza logo).
 */
export interface TickerProvider {
  /** Nome do provedor como licenciado (texto; nunca logo). */
  name: string
  /** `watch_availability.provider_key` — chave estavel. */
  key: string
  /** Credito exigido pela licenca, quando exigido; senao null. */
  attributionText: string | null
  /** Linkback exigido pela licenca, quando exigido; senao null. */
  attributionUrl: string | null
}

export interface TickerEpisode {
  /** Estreia hoje ou proxima estreia confirmada. */
  kind: 'today' | 'upcoming'
  series: string           // traducao pt-BR, ou name_original
  seasonEp: string         // "T2 · E5"
  episodeTitle: string | null
  airDateLabel: string | null   // so em 'upcoming'
  href: string             // /pt/series/{slug}/
  /** Provedor legal quando ha oferta licenciada vigente; senao null. */
  provider: TickerProvider | null
}
```

Duas consultas em cascata — a segunda só roda se a primeira vier vazia:

```ts
const todayEpisodes = await prisma.episode.findMany({
  where: { airDate: { gte: dayStart, lt: dayEnd } },
  take: TICKER_LIMIT * 3,
  orderBy: [{ tvShowId: 'asc' }, { episodeNumber: 'asc' }],
  select: EPISODE_SELECT,
})
const today = await toTickerEpisodes(prisma, todayEpisodes, 'today')
if (today.length > 0) return today

// Fallback honesto: proxima estreia JA CONFIRMADA no banco (nunca estimada).
const windowEnd = new Date(dayEnd.getTime() + UPCOMING_WINDOW_DAYS * 24 * 60 * 60 * 1000)
const upcomingEpisodes = await prisma.episode.findMany({
  where: { airDate: { gte: dayEnd, lt: windowEnd } },
  take: TICKER_LIMIT * 3,
  orderBy: [{ airDate: 'asc' }, { tvShowId: 'asc' }, { episodeNumber: 'asc' }],
  select: EPISODE_SELECT,
})
return toTickerEpisodes(prisma, upcomingEpisodes, 'upcoming')
```

`UPCOMING_WINDOW_DAYS = 30`. A resolução de título/slug foi extraída para
`toTickerEpisodes()` e continua **em lote** (uma query de traduções + uma de
slugs + **uma de ofertas licenciadas** para todos os `tvShowId`) — sem N+1.
Série sem slug canônico pt-BR ou sem título é descartada: nunca link quebrado.

O provedor sai de `providersByShow()`, que reusa o gate compartilhado e delega a
escolha ao presenter puro (detalhes na seção 10):

```ts
const rows = await prisma.watchAvailability.findMany({
  where: { entityType: 'tv', entityId: { in: [...showIds] }, ...licensedWatchWhere(now) },
  take: WATCH_FETCH_LIMIT,
  select: { /* … provider, oferta, licenca, atribuicao … */ },
})
// …agrupa por serie e escolhe UMA oferta, deterministicamente:
const offer = selectTickerWatchOffer(candidateRows)
```

Data formatada no servidor, em UTC, sem alegar hora:

```ts
function formatAirDate(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(date)
}
```

### 5.7 `apps/web/app/_components/home-ticker.tsx` — reescrito

A faixa deixou de ter early-return. Três estados:

```tsx
const BADGE: Readonly<Record<TickerEpisode['kind'], string>> = {
  today: 'NOVO',
  upcoming: 'EM BREVE',
}

const item = items.length > 0 ? (items[Math.min(active, items.length - 1)] as TickerEpisode) : null
```

```tsx
<span className="ticker__label">{item === null ? 'AGENDA' : BADGE[item.kind]}</span>
<span className="ticker__text">
  {item === null ? (
    'Nenhum episódio novo confirmado para hoje'
  ) : (
    <>
      <strong>{item.series}</strong> · {item.seasonEp}
      {item.episodeTitle !== null ? <> · {item.episodeTitle}</> : null}
      {item.airDateLabel !== null ? <> · estreia em {item.airDateLabel}</> : null}
    </>
  )}
</span>
```

CTA **final** — três variantes, com o crédito da licença quando exigido:

```tsx
{item?.provider != null ? (
  <a className="ticker__cta" href={item.href}>
    Onde assistir <strong>{item.provider.name}</strong>
  </a>
) : (
  <a className="ticker__cta" href={item === null ? SERIES_INDEX_PATH : item.href}>
    {item === null ? 'Ver séries' : 'Ver série'}
  </a>
)}
```

```tsx
{item?.provider != null ? <TickerCredit provider={item.provider} /> : null}
```

```tsx
/**
 * Credito da licenca do agregador. Renderizado SEMPRE que o provedor exigir
 * atribuicao — sem ele a oferta nao poderia aparecer (invariante 6).
 */
function TickerCredit({ provider }: { provider: TickerProvider }): ReactNode {
  if (provider.attributionText === null) return null
  return (
    <p className="ticker__credit">
      {provider.attributionUrl !== null ? (
        <a href={provider.attributionUrl} rel="nofollow noopener" target="_blank">
          {provider.attributionText}
        </a>
      ) : (
        provider.attributionText
      )}
    </p>
  )
}
```

| Estado | Selo | CTA | Crédito |
| --- | --- | --- | --- |
| Episódio + oferta aprovada | `NOVO`/`EM BREVE` | `Onde assistir **<provedor>**` | linha visível + linkback |
| Episódio sem oferta aprovada | `NOVO`/`EM BREVE` | `Ver série` | — |
| Nenhuma estreia | `AGENDA` | `Ver séries` | — |

Import via `routes` e não `site`, porque é Client Component e `site.ts` lê env:

```ts
// `routes` (nao `site`): modulo puro, importavel em client component.
import { SERIES_INDEX_PATH } from '../../src/lib/routes'
```

### 5.8 `apps/web/app/globals.css`

**Header — acento de navegação separado por contexto de rota:**

```css
.site-header {
  /* … */
  /* Acento do INDICADOR DE NAVEGACAO (estado ativo do menu). Neutro = acento
     da marca Cinerie; nas verticais acompanha a rota. NAO e sinal de vertical:
     a diferenciacao filme/serie continua em label + badge + breadcrumb +
     schema + URL (invariante 11). */
  --nav-accent: var(--c-accent-movie);
}

.site-header[data-context='series'] {
  --nav-accent: var(--c-accent-series);
}
```

**Header — overlay transparente de verdade:**

```diff
 .site-header[data-overlay='true'] {
-  /* scrim superior de midia: texto branco legivel (AA) sobre qualquer hero */
-  background: linear-gradient(180deg, rgba(5, 5, 5, 0.55) 0%, rgba(5, 5, 5, 0) 100%);
+  /* TRANSPARENTE de verdade: nenhuma faixa/scrim proprio sobre o hero. O
+     escurecimento do topo ja vem do `hero__scrim-v` (0.55 em 0%), que mantem
+     a barra legivel (AA) sem duplicar gradiente nem criar banda visivel. */
+  background: transparent;
   backdrop-filter: none;
   -webkit-backdrop-filter: none;
   border-bottom-color: transparent;
   color: #fff;
 }
```

**Links do menu:**

```diff
 .site-header__link {
-  font-size: 15px;
+  font-size: 13px;
   font-weight: 600;
   color: var(--c-text-primary);
   padding-block: 4px;
   border-bottom: 2px solid transparent;
+  white-space: nowrap;
   transition: color 0.35s;
 }

 .site-header__link[aria-current='page'] {
-  color: var(--ctx-accent-dark);
-  border-bottom-color: var(--ctx-accent);
+  color: var(--c-text-primary);
+  border-bottom-color: var(--nav-accent);
 }

 .site-header[data-overlay='true'] .site-header__link[aria-current='page'] {
   color: #fff;
-  border-bottom-color: #fff;
+  border-bottom-color: var(--nav-accent);
 }
```

`--ctx-accent` era declarado em `[data-vertical]` no `<main>`, que **não** é
ancestral do header — resolvia sempre para o fallback preto. Daí o `--nav-accent`
próprio.

**Título:**

```diff
 .hero__title {
-  font-size: 84px;
+  font-size: clamp(52px, 5.25vw, 84px);
   font-weight: 800;
   letter-spacing: -0.035em;
   color: rgba(255, 255, 255, 0.95);
   line-height: 0.9;
   margin: 0;
+  max-width: 620px;
   text-shadow: 0 2px 30px rgba(0, 0, 0, 0.5);
+  /* Titulo longo quebra em ate 3 linhas, equilibrado — nunca palavra picada */
+  text-wrap: balance;
+  overflow-wrap: normal;
+  word-break: normal;
 }

+/*
+ * O titulo NAVEGA para a ficha, mas o link nao pode mudar a aparencia do
+ * display: sem sublinhado, borda ou sombra herdados de `p a`/link global.
+ */
 .hero__title a {
   color: inherit;
+  text-decoration: none;
+  border: 0;
+  box-shadow: none;
+  background-image: none;
 }
```

**Indicadores:**

```diff
 .hero__dot {
-  width: 22px;
+  width: 8px;
   height: 5px;
-  background: rgba(255, 255, 255, 0.35);
+  background: rgba(255, 255, 255, 0.45);
 }

+/*
+ * O indicador ATIVO carrega o acento da vertical do slide (filme = vermelho,
+ * serie = verde) — nunca branco. A cor e reforco: o estado ativo ja e
+ * anunciado por `aria-selected` e pela largura (invariante 11).
+ */
 .hero__dot[aria-selected='true'] {
-  width: 44px;
-  background: #fff;
+  width: 26px;
+  background: var(--c-accent-movie);
+}
+
+.hero__dot[aria-selected='true'][data-vertical='series'] {
+  background: var(--c-accent-series);
 }
```

**Ticker no mobile:**

```css
@media (max-width: 767px) {
  .ticker__inner {
    padding-inline: var(--pad-page-mobile);
    flex-wrap: wrap;
    gap: 12px;
  }
  /* No mobile a faixa quebra em duas linhas — ela nunca some nem estoura. */
  .ticker__text { white-space: normal; }
  .ticker__lead { flex-basis: 100%; }
}
```

### 5.9 `apps/web/app/_components/home-like.tsx`

```diff
-      {/* Ticker de episódios novos HOJE — dado real ou nada */}
+      {/* Faixa amarela: estrutura fixa da composição; o TEXTO é que muda
+          (hoje → próxima estreia confirmada → estado neutro honesto) */}
       <HomeTicker items={tickerEpisodes} />
```

```diff
-          style={{ paddingTop: 56, paddingBottom: 10 }}
+          style={{ paddingTop: 48, paddingBottom: 10 }}
```

### 5.10 Testes

**`tests/web/home-canonical-contract.test.ts`** — dois `it` novos:

```ts
it('primeira dobra: header transparente, título limpo e dot com acento', () => {
  expect(css).toMatch(/\.site-header\[data-overlay='true'\] \{[^}]*background: transparent/s)
  expect(css).not.toMatch(/\.site-header\[data-overlay='true'\] \{[^}]*linear-gradient/s)
  expect(header).toContain("document.querySelector('#main-content .hero')")

  expect(hero).toContain('<div className="hero__title">')
  expect(hero).not.toMatch(/<p className="hero__title">/)
  expect(css).toMatch(/\.hero__title a \{[^}]*text-decoration: none/s)

  expect(hero).toContain('data-vertical={s.vertical}')
  expect(css).toMatch(/\.hero__dot\[aria-selected='true'\] \{[^}]*background: var\(--c-accent-movie\)/s)
  expect(css).toMatch(/\.hero__dot\[aria-selected='true'\]\[data-vertical='series'\] \{[^}]*var\(--c-accent-series\)/s)
})

it('faixa amarela é estrutura fixa, mas nunca inventa episódio ou plataforma', () => {
  expect(ticker).not.toMatch(/if \(items\.length === 0\) return null/)
  expect(ticker).toContain('className="ticker"')
  expect(ticker).toContain('Nenhum episódio novo confirmado para hoje')
  expect(ticker).not.toMatch(/Netflix|Prime Video|Disney\+|Max\b|Apple TV/)
  expect(tickerServer).toContain("'upcoming'")
  expect(tickerServer).toMatch(/airDate: \{ gte: dayEnd/)
})
```

**`tests/web/public-navigation.test.ts`** — guard atualizado **deliberadamente**
(o antigo travava o menu de 5 itens) e reforçado com prova de que nada virou link
morto:

```ts
it('mantém Pessoas e Explorar navegáveis fora do header', () => {
  expect(header).toContain('...NAV_ITEMS, ...SECONDARY_NAV_ITEMS')
  expect(footer).toContain('...NAV_ITEMS, ...SECONDARY_NAV_ITEMS')
})
```

O laço de link morto passou a varrer `NAV_ITEMS` **e** `SECONDARY_NAV_ITEMS`,
verificando `existsSync` do `page.tsx` de cada rota.

---

## 6. O que passa a aparecer no site publicado

Primeira dobra de `/pt/`, de cima para baixo:

### 6.1 Header (todas as rotas)

| Elemento | Publicado |
| --- | --- |
| Barra | `fixed`, 72 px, container 1380 px, padding 80 px, `z-index: 60` |
| Fundo no topo do hero | **transparente** — nenhuma faixa; o escurecimento vem do scrim do hero |
| Fundo ao rolar >24 px | `rgba(253,253,253,.94)` + blur 10 px + borda inferior |
| Wordmark | `cinerie-wordmark-white.svg` em overlay; preta/por contexto no estado sólido |
| Menu | `Início · Filmes · Séries · Listas · Notícias · Onde assistir` — 13 px, peso 600, gap 32 px |
| Item ativo | `aria-current="page"` + sublinhado 2 px com `--nav-accent` |
| Direita | busca (`/pt/busca/`) e conta (`/pt/conta/`), alvos ≥44 px |
| <1024 px | menu vira `<dialog>` nativo com primário + `Pessoas` + `Explorar` + Buscar + Minha conta |

Cor do sublinhado ativo, **por rota** (nunca por slide):

| Rota | `data-context` | `--nav-accent` |
| --- | --- | --- |
| `/pt/` e demais | `neutral` | `#f0443e` (vermelho da marca) |
| `/pt/filmes*` | `movie` | `#f0443e` |
| `/pt/series*` | `series` | `#7fa56f` |

### 6.2 Hero

| Elemento | Publicado |
| --- | --- |
| Altura | `88vh`, min 620, max 880; fundo `#080808` |
| Imagem | `<img>` remoto TMDB, `object-fit: cover`, `fetchPriority="high"` |
| Scrims | vertical (5 paradas) + horizontal 95° à esquerda — inalterados |
| Eyebrow | `Filme em destaque · 2026` / `Série em destaque · 3 temporadas · 28 episódios`; 11 px/800/`.16em`, vermelho ou verde |
| Título | `clamp(52px, 5.25vw, 84px)`, peso 800, `line-height .9`, `-0.035em`, **sem qualquer sublinhado**, até 3 linhas equilibradas, `max-width: 620px` |
| Linha de meta | estrelas (quando houver nota liberada) + chip de classificação; some inteira se não houver nenhum dos dois |
| Coluna direita | direção 13 px/700, elenco 12 px, sinopse 12 px/1.55, `max-width: 330px`, alinhada à direita |
| Dots | 8 px inativo / 26 px ativo, 5 px de altura, `bottom: 26px`; ativo em **vermelho no slide de filme, verde no de série** |
| Interação | autoplay 6 s pausável em hover/foco, desligado em `prefers-reduced-motion`; `role="tablist"`, setas do teclado |

### 6.3 Faixa amarela — sempre presente

| Estado | Selo | Texto | CTA |
| --- | --- | --- | --- |
| Episódio hoje | `NOVO` | **Série** · T2 · E5 · Título | `Ver série` → `/pt/series/{slug}/` |
| Próxima estreia (≤30 dias) | `EM BREVE` | **Série** · T2 · E5 · Título · estreia em 30 de julho | `Ver série` |
| Nada confirmado | `AGENDA` | Nenhum episódio novo confirmado para hoje | `Ver séries` → `/pt/series/` |

Fundo `#F5C518`, texto `#101010`, container 1280/80 px, padding vertical 14 px.
Até 6 itens rotacionam por dots (tabs reais). No mobile quebra em duas linhas.

### 6.4 Destaques de hoje

Começa 48 px abaixo da faixa. Heading `DESTAQUES` (800) + `de hoje` (leve), tabs
`Filmes`/`Séries` à direita. Cards não foram tocados.

---

## 7. De onde vem cada informação

Todo o render lê **apenas PostgreSQL local** via Prisma (`@screena/db`).
Zero API externa, zero Gemini (invariantes 3 e 4). Único host externo é o CDN de
imagem do TMDB, montado por helper governado.

### 7.1 Hero — `getHomeHeroSlides()` (`apps/web/src/server/home-hero.ts`)

| Campo na tela | Tabela / coluna | Caminho |
| --- | --- | --- |
| Título | `entity_translations.title` (pt-BR) → fallback `movies.title_original` / `tv_shows.name_original` | loader → `HeroSlideInput.title` → `buildHeroSlide` |
| Link | `slugs.slug` com `language_code='pt-BR'` e `is_canonical=true` | `detailPath()`; **sem slug o slide é descartado** |
| Eyebrow (ano) | `movies.release_date` → ano UTC | `buildPrimaryMeta` |
| Eyebrow (temporadas/episódios) | `tv_shows.number_of_seasons`, `number_of_episodes` | `formatCountLabel` |
| Estrelas | `movies/tv_shows.screen_score`, `screen_score_scale`, `screen_score_display`, origem editorial | `resolveHeroRating` |
| Classificação | `movies/tv_shows.certification` | `trimToNull` |
| Direção | `crew_members` (job `Director` ou department `Directing`) → `people.name` | `directorNameForEntity` |
| Elenco | `cast_members` + `people` | `getCastForEntity` → `buildHeroCast` (teto 3) |
| Sinopse | `entity_translations.summary` (pt-BR) | `trimSynopsis` (160 chars, corte em palavra) |
| Imagem | `movies/tv_shows.backdrop_path` (`w1280`) → fallback `poster_path` (`w780`) | `resolveHeroImage` → `buildTmdbImageUrl` |

Ordem: filmes por ano desc, depois séries por ano desc; teto de 5 slides
(`HOME_HERO_SLIDE_LIMIT`). Crew/cast só são resolvidos para os slides que
efetivamente entram — sem N+1 no catálogo inteiro.

### 7.2 Faixa amarela — `getHomeTickerEpisodes()` (`apps/web/src/server/home-ticker.ts`)

| Campo na tela | Tabela / coluna |
| --- | --- |
| Nome da série | `entity_translations.title` (pt-BR) → fallback `tv_shows.name_original` |
| `T{n} · E{n}` | `seasons.season_number` (derivada — o episódio não a armazena) + `episodes.episode_number` |
| Título do episódio | `episodes.name` |
| Data ("estreia em …") | `episodes.air_date` |
| Link | `slugs.slug` (`entity_type='tv'`, pt-BR, canônico) |
| Seleção "hoje" | `episodes.air_date ∈ [00:00 UTC, +24h)` |
| Seleção "em breve" | `episodes.air_date ∈ [+24h, +30 dias)`, ordenado por data asc |

### 7.3 Navegação

Constantes estáticas em `apps/web/src/lib/routes.ts`. Nenhuma leitura de banco.

---

## 8. A cadeia do Cinerie Score estava QUEBRADA no loader

Este é o achado mais importante da segunda rodada, e ele **contradiz o que este
relatório afirmava antes** ("implementado e ligado").

`resolveHeroRating` exige `screenScoreSource === 'editorial'`. Nenhum loader
populava esse campo — nem `home-hero.ts`, nem `home-catalog.ts`, nem
`entity-indexes.ts`. A estrela era **inalcançável por construção**, não apenas
sem dado. A própria migration já registrava isso:

> "o gate de render nunca deixou a nota aparecer: `screenScoreSource` nunca e
> populado por nenhum loader"
> — `20260717120000_external_intelligence_product/migration.sql`

### Como foi fechado (sem migration, sem inventar nota)

Novo módulo [editorial-score.ts](../../apps/web/src/server/editorial-score.ts):
a procedência vem de **`cinerie_score_calculations`** — o histórico versionado
do cálculo. Só conta quando existe linha `status='calculated'` cujo `value` e
`scale` **batem** com o `screen_score`/`screen_score_scale` persistido. Cálculo
divergente (nota alterada depois) não autoriza: fail-closed. Uma query em lote
por tipo de entidade; chave composta `movie:1` / `tv:1`, porque `movies.id` e
`tv_shows.id` são sequências independentes.

O gate-mestra continua sendo `screen_score_display`, travado **no banco** pelo
trigger `cinerie_score_display_guard`, que exige `DataUsageDecision` vigente
para `cinerie_score_display` com `derivative_allowed`.

Nada disso calcula nota: fórmula e alimentação em produção seguem dependendo do
Prompt 11. O que mudou é que a UI deixou de ser inalcançável.

### O que NUNCA pode alimentar as estrelas

IMDb, Rotten Tomatoes (Tomatometer/Popcornmeter), Metacritic, Letterboxd,
FilmAffinity e `vote_average_tmdb`. As estrelas são a nota **própria** da
Cinerie, escala 5. Notas externas são blocos separados, cada uma na sua escala e
com sua atribuição (invariantes 1 e 2). O guard
`tests/web/home-canonical-contract.test.ts` varre o código de `editorial-score`
e reprova qualquer referência a essas fontes.

**TMDB.** `vote_average` é metadado técnico de catálogo. Esta PR **não** o
promove a sexta fonte pública de rating — isso exige decisão registrada própria
(fonte, rótulo, métrica, escala, atribuição, frescor, gate de exibição).

## 9. Matriz de estados por capacidade

| Capacidade | Implementado | Conectado à tela | Fixture QA | Dado em produção | Autorizado | Visível |
| --- | --- | --- | --- | --- | --- | --- |
| Cinerie Score no hero (estrelas) | sim | **sim (fechado nesta PR)** | sim (ambos os estados) | não consultado | via `screen_score_display` + trigger | quando o dado existir |
| Cinerie Score nos cards | sim | **sim (mesmo helper)** | indireto | não consultado | idem | quando o dado existir |
| Classificação indicativa | sim | sim | sim | não consultado | n/a | quando existir |
| Ticker — episódio de hoje | sim | sim | sim | depende do catálogo | n/a | condicional |
| Ticker — próxima estreia | sim | sim | sim | depende do catálogo | n/a | condicional |
| Ticker — estado neutro | sim | sim | sim | n/a | n/a | sempre |
| Provider no ticker | sim | **sim (fechado nesta PR)** | sim (3 estados) | não consultado | `licensedWatchWhere()` | quando houver oferta aprovada |
| Crédito/linkback do provider | sim | sim | sim | n/a | exigido pela licença | junto com o provider |
| Ratings externos (IMDb/RT/Metacritic/Letterboxd/FilmAffinity) | contratos existem | fora do hero | não | fora do escopo | fora do escopo | não nesta dobra |
| TMDB como fonte pública de rating | não | não | não | `vote_average` existe como metadado | não | não |

> "Dado em produção: **não consultado**" é literal. Este QA rodou contra um
> PostgreSQL descartável; nenhuma linha de produção foi lida ou escrita, e este
> relatório não afirma o que existe lá.

## 10. Provider licenciado na faixa amarela

A infraestrutura já existia; faltava a **integração**. Fechada assim:

- **Zero regra nova de licença.** `providersByShow()` em
  [home-ticker.ts](../../apps/web/src/server/home-ticker.ts) reusa
  `licensedWatchWhere(now)` — o mesmo gate do painel de detalhe e do hub
  `/pt/onde-assistir` (display allowed + oferta vigente + `DataUsageDecision`
  vigente + licença-mãe vigente + território).
- **Uma query para todas as séries** do ticker (nunca N+1), com teto defensivo.
- **Escolha determinística** por `selectTickerWatchOffer()`, novo em
  [watch-availability-presenter.ts](../../apps/web/src/lib/watch-availability-presenter.ts):
  delega a `buildWatchAvailabilityView` e devolve a primeira oferta do primeiro
  grupo. A política é a já publicada pelo painel — assinatura → grátis →
  aluguel → compra; dentro do grupo, provedor (asc), qualidade (desc), deep link.
  **Não existe "provedor principal" por popularidade comercial**: isso seria
  afirmação sem dado persistido.
- **Crédito visível.** `WatchAvailabilityOffer` passou a carregar a atribuição
  **da própria oferta** (o painel usa o agregado; uma superfície que mostra UMA
  oferta precisa do crédito dela). Oferta que exige atribuição e não a tem é
  descartada — fail-closed.
- **Nunca logo:** `logo_allowed = false` na licença do agregador; o provider
  aparece como TEXTO dentro do CTA preto.

Estados renderizados:

| Estado | Selo | CTA | Crédito |
| --- | --- | --- | --- |
| Episódio hoje + oferta aprovada | `NOVO` | `Onde assistir **Max**` → ficha da série | linha de crédito + linkback |
| Episódio sem oferta aprovada | `NOVO`/`EM BREVE` | `Ver série` | — |
| Nenhuma estreia | `AGENDA` | `Ver séries` | — |

**DESIGN-DELTA consciente:** o canônico não previa a linha de crédito (é um mock
sem licença). A licença que autoriza exibir a oferta é a **mesma** que obriga
creditar — omitir o crédito para copiar o mock seria uso não licenciado. A faixa
passa de 63px para 84px quando há provider.

### Guards de streaming: por que a lista de tokens mudou

`WatchView` e `watch-presenter` **nunca existiram** no repositório — eram nomes
planejados. Com eles, a única forma de um componente citar "Onde assistir" era
conter a string `watch_availability`: na prática, o guard era impossível de
satisfazer mesmo com contrato real. A lista passou a incluir os identificadores
reais (`TickerProvider`, `WatchAvailabilityView`, `watch-availability-presenter`)
em `tests/governance/no-fake-streaming-in-ui.test.ts` **e** em
`scripts/audit/check-invariants.mjs` (novo campo `allowedWhen`, que substitui uma
allowlist por nome de arquivo — que não provava nada sobre o conteúdo).

Isso **não** relaxa a regra, e há **controle negativo** provando os dois
sentidos: um componente sintético que diz "Onde assistir Netflix" sem contrato
continua sendo reprovado; o mesmo texto com `TickerProvider` é aprovado.

---

## 11. Governança respeitada

| Invariante | Como |
| --- | --- |
| 3 — zero API externa no render | `audit:render` verde; ticker e hero só leem Prisma |
| 4 — zero Gemini no render | inalterado |
| 6 — licença antes de exibir | **Nenhuma oferta de produção foi lida, promovida ou exibida.** A integração do provedor foi comprovada exclusivamente com fixture local de QA, sujeita ao mesmo gate `licensedWatchWhere` usado em produção. O crédito exigido pela licença é renderizado junto da oferta |
| 8 — sem pirataria | nenhum link/embed introduzido; só as 4 modalidades legais |
| 9/10 — filme vermelho, série verde | `--c-accent-movie` / `--c-accent-series` nos dots e no `--nav-accent` de rota |
| 11 — nunca só cor | dot ativo também muda de largura e tem `aria-selected`; item de menu tem `aria-current`; vertical continua em label+badge+breadcrumb+schema+URL |
| 1/2 — fontes de rating | estrelas continuam exclusivas do Cinerie Score; nenhuma conversão de escala; guard varre `editorial-score` e reprova referência a fonte externa |
| Chaves só em env | nenhum segredo tocado; `.env` de produção nunca lido nem copiado; o QA injeta uma `DATABASE_URL` local e aborta se não for `127.0.0.1` |

---

## 12. Verificação executada

Estado **final** (head `73850de`; a 1ª rodada tinha 3772 testes, número superado
pelos 10 casos novos da 2ª):

| Gate | Resultado |
| --- | --- |
| `pnpm test` | **3782 passed** / 310 arquivos |
| `pnpm lint` | limpo |
| `pnpm typecheck` (root) | limpo |
| `pnpm typecheck:web` | limpo |
| `pnpm build` | sucesso |
| `pnpm audit:invariants` | 7 ok / 0 violação |
| `pnpm audit:render` | 2 ok / 0 violação |
| `qa:home-fold` (app real) | 25/25 checks |
| CI da PR #89 (head `73850de`) | 3/3 pass |
| CI pós-merge em `main` (`0b2481a`) | success |

Pré-requisito descoberto: o worktree novo precisa de `pnpm install` **e**
`pnpm --filter @screena/db db:generate` — sem o client Prisma gerado, o
`typecheck:web` falha com ~16 erros que parecem de código e são de setup.

### 12.1 QA visual — aplicação Next.js REAL

`pnpm --filter @screena/web qa:home-fold` — **25/25 checks OK**
([qa-home-first-fold-real-postgres.ts](../../apps/web/scripts/qa-home-first-fold-real-postgres.ts)).

O que ele exercita, que o harness estático **não** exercitava: o DOM emitido pelo
React em produção, dados atravessando loader → presenter → componente, hidratação,
fontes carregadas pelo Next, o carrossel trocando de slide de verdade, e o header
nos três estados (topo, após scroll, rota sem hero).

Ambiente: PostgreSQL 16 **efêmero** (`embedded-postgres`) + `migrate deploy` +
`db:seed` + fixtures de QA + `next start` real. Nenhuma linha de produção lida ou
escrita; a `DATABASE_URL` é sempre `127.0.0.1` e o script aborta se não for.
A URL de **imagem** do CDN do TMDB é interceptada no browser e servida por um
asset local gerado (céu claro à esquerda, silhueta escura à direita) — QA
determinístico e offline, capaz de julgar crop, scrim e contraste.

| # | Cenário verificado no app real | Resultado |
| --- | --- | --- |
| C1 | header transparente, 72px, menu na ordem canônica | bg `rgba(0,0,0,0)`, sem gradiente, h=72 |
| C1 | título sem sublinhado, 3 linhas | `decoration=none` |
| C1 | backdrop pelo `<img>` do hero via CDN governado | `image.tmdb.org/t/p/w1280/…` |
| C1 | **slide de filme**: nav vermelho + dot vermelho | `rgb(240,68,62)` / `rgb(240,68,62)` |
| C1 | sem score liberado: nenhuma estrela, classificação preservada | `estrelas=null cert=16` |
| C1 | faixa com episódio de hoje + provider + crédito | `NOVO` · `Onde assistir Max` · crédito |
| **C2** | **slide de série**: nav continua VERMELHO, dot fica VERDE | `rgb(240,68,62)` / `rgb(127,165,111)` |
| C3 | score liberado no banco → **estrelas reais** | `★★★★` + 1 apagada |
| C3 | série com score: estrelas + dot verde | ok |
| C4 | oferta perde `display_allowed` → CTA genérico | `Ver série`, sem crédito |
| C5 | sem episódio hoje → próxima estreia confirmada | `EM BREVE · estreia em 6 de agosto` |
| C6 | sem estreia nenhuma → faixa permanece, neutra | `AGENDA` · `Ver séries` · h=63 |
| C7 | header após scroll | sólido `rgba(253,253,253,.94)` |
| C7 | rota sem hero (`/pt/noticias/`) | sólido desde o topo |
| C8 | 5 viewports com o estado completo | zero overflow em todas |

### 12.2 O que os prints comprovam — e o que NÃO comprovam

Camadas distintas, nunca sinônimos:

| Camada | Neste QA | Significa |
| --- | --- | --- |
| **Fixture local de QA** | criada pelo script, em banco descartável | descreve um estado possível; não é dado real |
| **Aplicação Next.js real** | `next start` sobre o build de produção | o DOM, os presenters e a hidratação são os de verdade |
| **Banco efêmero (PG16)** | `embedded-postgres`, derrubado no fim | schema e triggers reais; conteúdo é fixture |
| **Dado de produção** | **não consultado** | este relatório não afirma nada sobre o banco real |
| **Screenshot de QA** | `apps/web/.qa-home-fold/` | prova o *comportamento* da UI para aquele estado |
| **Comportamento após deploy** | ver abaixo | depende de a produção ter o dado governado |

Os prints comprovam que a aplicação **se comporta corretamente** em cada estado:
estrelas disponíveis e indisponíveis, provedor licenciado e bloqueado, ticker
com episódio / próxima estreia / neutro, slide de filme e de série, desktop e
mobile. Eles **não** comprovam que esses dados já existem em produção.

### 12.3 O que esperar depois do deploy

Consequência direta do gate ser fail-closed — e não sinal de integração faltando:

- **Estrelas** só aparecem em títulos com cálculo persistido em
  `cinerie_score_calculations` (`status='calculated'`), coerente com a coluna, e
  com `screen_score_display=true` autorizado pelo trigger. Como a fórmula e a
  alimentação seguem no Prompt 11, é esperado que **vários títulos ainda não
  exibam estrelas** — e a composição continua honesta sem elas.
- **Provedor** só aparece quando a produção tiver oferta vigente e aprovada por
  todos os gates de `licensedWatchWhere`. Sem oferta aprovada, o CTA é
  `Ver série`.
- **Sem episódio** confirmado, a faixa mostra `AGENDA` — e permanece na tela.

A capacidade está implementada e validada; o que a produção ainda precisa é dos
**dados governados**.

### 12.4 Limitação declarada do ambiente

O cluster efêmero subiu com o **encoding padrão do SO**, não UTF8: no Windows o
`initdb` recusa UTF8 quando os binários do Postgres embarcado vivem sob um
caminho com caractere não-ASCII — e o caminho deste repositório contém "Área de
Trabalho". O script tenta UTF8 primeiro, cai para o padrão e **registra qual
usou**, em vez de fingir. Os textos das fixtures existem nos dois encodings, então
o cenário visual é idêntico; em CI (caminho ASCII) o QA roda em UTF8.

### 12.5 Harness estático (complementar, não evidência final)

| Viewport | Overflow | Header bg | Menu | Underline ativo | Título | Dot ativo |
| --- | --- | --- | --- | --- | --- | --- |
| 1126×799 | ok | `rgba(0,0,0,0)` | 6 itens na ordem | `rgb(240,68,62)` | 59,1 px · 3 linhas · `decoration: none` · `border: 0` | `rgb(240,68,62)` · 26 px |
| 1576×892 | ok | `rgba(0,0,0,0)` | idem | idem | 82,7 px · 3 linhas | idem |
| 1280×900 | ok | `rgba(0,0,0,0)` | idem | idem | 67,2 px · 3 linhas | idem |
| 768×1024 | ok | `rgba(0,0,0,0)` | idem | idem | 56 px · 2 linhas | idem |
| 390×844 | ok | `rgba(0,0,0,0)` | dialog | idem | 44 px · 3 linhas | idem |

Container do header a 1576 px: `x=98, w=1380` — bate com o canônico.
Container do ticker a 1576 px: `x=148, w=1280`.
`document.documentElement.scrollWidth <= clientWidth` em todos.

Variante `data-context="series"`: `dotActive` e `navUnderline` = `rgb(127,165,111)`.

O harness em `scratchpad/fold-harness.html` continua útil como teste rápido de
CSS, mas **não é evidência final** — foi substituído pelo QA do app real acima.

### 12.6 Esclarecimento sobre as capturas vermelha e verde (1ª rodada)

As duas capturas desktop mostram o mesmo filme com acentos diferentes. **Isso é
artefato do harness, não comportamento do app.** A segunda foi gerada com um
`sed` que força `data-context="series"` no header, só para exercitar o CSS da
rota de série. Em `/pt/`, `logoContextOf()` retorna sempre `neutral` (o pathname
não começa com `/pt/series`), logo `--nav-accent` é sempre o vermelho da marca —
independentemente do slide ativo. O dot, esse sim, segue o `data-vertical` do
slide.

**Posteriormente comprovado no app Next.js real pelo cenário C2:** a Home com
slide de série manteve `nav=rgb(240,68,62)` (vermelho) e `dot=rgb(127,165,111)`
(verde), na mesma asserção. Não havia contradição no código, e agora isso está
provado no runtime, não apenas por leitura.

---

## 13. Débitos — estado final

| # | Débito da 1ª rodada | Estado |
| --- | --- | --- |
| 1 | QA na aplicação Next.js real | **fechado** — `qa:home-fold`, 25/25, PG16 efêmero + `next start` |
| 2 | Estado *disponível* das estrelas | **fechado** — cadeia estava quebrada no loader; corrigida e provada nos dois estados |
| 3 | Provider licenciado no ticker | **fechado** — gate compartilhado, lote, escolha determinística, crédito visível, 3 estados |
| 4 | Teste combinado dos acentos | **fechado** — guard estático + checks C1/C2 no app real |
| 5 | `page-map.md` | **parcial** — navegação, acentos e QA documentados; as seções que ainda descrevem o reset neutro de julho/2026 continuam defasadas desde a PR #88 |
| 6 | Corpo da PR #89 | **fechado** — reescrito |

### Continua aberto (fora do escopo desta PR)

- **Fórmula e alimentação do Cinerie Score em produção** — Prompt 11. A UI e a
  cadeia estão prontas e provadas; falta o cálculo.
- **Promoção de ofertas reais** para `display_allowed` em produção — decisão
  humana de licença, registrada fora daqui.
- **Ratings externos** (IMDb/RT/Metacritic/Letterboxd/FilmAffinity) como blocos
  próprios nas fichas — outra superfície, outro escopo.
- **TMDB como sexta fonte pública de rating** — exige decisão registrada.
- **`page-map.md` completo** — reescrever as seções herdadas do reset de julho.

---

## 14. Anexos — capturas

Geradas por `pnpm --filter @screena/web qa:home-fold` em
`apps/web/.qa-home-fold/` (gitignored, regeráveis):

| Arquivo | Cenário |
| --- | --- |
| `01-movie-no-score-provider-1126x799.png` | filme sem score, faixa com provider |
| `02-series-slide-1126x799.png` | slide de série: nav vermelho + dot verde |
| `03-score-available-1126x799.png` | Cinerie Score liberado → estrelas |
| `04-score-available-series-1126x799.png` | série com score |
| `05-episode-without-provider-1126x799.png` | oferta sem autorização → `Ver série` |
| `06-ticker-upcoming-1126x799.png` | próxima estreia confirmada |
| `07-ticker-neutral-1126x799.png` | estado neutro honesto |
| `08-header-scrolled-1126x799.png` | header sólido após scroll |
| `09-no-hero-route-1126x799.png` | rota sem hero |
| `10-full-{1126x799,1576x892,1280x900,768x1024,390x844}.png` | estado completo nas 5 viewports |
