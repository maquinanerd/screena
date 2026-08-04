# 13 — Component Specs

Especificações canônicas (D3B). Valores vêm de `design-tokens.json`; contratos completos em `component-contracts.json`; prova visual em `Components-Primitives-Navigation.dc.html`. **Não migrado às telas** (D4).

## Button
- **Elemento:** `<button>` (ação) — nunca `<span>/<div> onClick`. Navegação = `Link`.
- **Altura/padding:** xs 30/`0 12` · sm 36/`0 16` · md 44/`0 22` (toque) · lg 52/`0 28`.
- **Radius:** `radius-control 8` (padrão) ou `0` (contexto editorial: Top News, Entrar).
- **Tipografia:** `typography.button` (14/700) em todas as variantes — movie não precisa mais de tamanho especial (o fill #D42A2E passa AA em texto normal).
- **Variantes → cor:** primary `#101010`/branco · secondary branco/borda `#E3DED6`/ink · tertiary transparente/ink · ghost transparente (sobre imagem) · text sublinhado · destructive `#C7382F`/branco · editorial `#F5C518`/ink · movie fill `#D42A2E`/branco (5.04 AA em texto normal; `#F0443E` fica como acento/badge com tinta escura `#12100E`) · series `#395C42`/branco · inverse contorno branco (sobre escuro) · icon-only ver IconButton.
- **fullWidth** e **compact** são propriedade/tamanho, não componentes.

## Link
- `<a href>`. Variantes: inline (sublinhado `#8A1E1A`), navigation (ink 700), editorial ("Ver tudo ›"), card-title, metadata, breadcrumb, footer, external (ícone + nome acessível), destructive-text.
- Não parece botão sem motivo; ícone externo só quando relevante.

## IconButton
- `<button aria-label>`. Ícone stroke currentColor (`icon-sm/md`). Toque ≥44. Formas: circular (play/setas) ou control-radius. Tooltip quando o rótulo não é óbvio.

## Badge / Chip
- **Badge** = informativo, não interativo (`typography.badge` 10/800 UPPER). Content-type usa `accent.movie`/`accent.series` só com semântica real.
- **Chip** = interativo (filtro/removível), `radius-pill`. Removable com `aria-label` de remoção.

## ToggleSegmented
- Trilho `#EFEBE3` pill; opção ativa branca + `shadow-sticky-header` + peso 700. Seleção sinalizada por fundo+peso+sombra (não só cor). `role="radiogroup"`.

## SectionHeader
- 26px UPPERCASE, 1ª palavra 900 + resto 400, `-0.01em`. CTA "Ver tudo" (Link editorial pill) à direita. Variantes neutral/movie/series/inverse/compact. **Sem traço/barra de cor** (o traço vermelho do print não faz parte do sistema).

## Header
- Altura 64–72; `container-nav` 1380; `z-header 60`. Variantes: default-light (fundo `rgba(253,253,253,.9)` + borda), transparent-on-image (sobre hero, itens brancos → sólida ao rolar, `duration-slow`), mobile. Logo contextual (neutra/vermelha/verde/branca). Nunca escuro só para logo branca.

## MainNavigation
- Início · Filmes · Séries · Notícias · Onde assistir. Ativo = ink + sublinhado no acento do contexto + `aria-current="page"`.

## MobileNavigation
- Trigger (icon-button) → drawer + overlay; header do drawer com fechar; itens toque 44; foco preso; Escape fecha; `aria-expanded/controls`; reduced motion; safe-area. Editorial, não dashboard.

## Search
- Campo `radius-card 10`, borda `#E3DED6`, ícone à esquerda, atalho "/". Estados empty/typing/loading/results/zero/error. Sem histórico/resultados falsos.

## Breadcrumb
- `nav[aria-label=breadcrumb]`; itens Link; separador `›`; atual `aria-current` e não-link; truncação no mobile.

## Tabs
- `role=tablist/tab/tabpanel`; roving tabindex; setas; indicador ativo (borda 2px) além de cor. Distinguir de segmented/filter/links.

## Pagination
- prev/page/current/ellipsis/next. Link quando muda URL; button quando client. `aria-current=page`.

## Footer
- Sempre claro (`background.muted #F1EEE8`). Logo **neutra**. Colunas Filmes/Séries/Cinerie + copyright "© 2026 Cinerie · cinerie.com". Sem redes/contatos inventados; nunca logo contextual.

## Primitivos
Surface (page/section/elevated/subtle/editorial-dark/image-overlay) · Container (editorial/wide/narrow/reading/full-bleed/media) · Stack/Inline/Grid (gap por token) · Divider (subtle/default/strong/editorial-accent) · AspectRatio · VisuallyHidden · FocusRing (outline 2px `#101010` + offset).


---

# Content Specs (D3C)

## MediaImage / Avatar
Proporções: poster 2/3 · backdrop/still 16/9 · portrait 3/4 · news 16/9|1/1. `object-fit:cover` + `focalPoint`. Fallback neutro rotulado; Avatar → iniciais. Caption/atribuição quando a fonte exigir.

## Cards de entidade
`radius-card 10`, borda `#E3DED6`, sombra `0 3px 14px rgba(20,18,14,0.05)`. **Título = link principal** (não `<div onClick>`). Badge Filme `#F0443E`+tinta `#12100E` · Série `#7FA56F`+tinta. HighlightRailCard: `radius-14`, ★+ano/plataforma no topo, CTA `#D42A2E`.

## NewsOverlayCard / TrailerCard
Imagem + scrim gradiente + texto branco (contexto de mídia sancionado). Sombra `0 3px 14px rgba(20,18,14,0.14)`. Feature 26px/800 · standard 17–19px/800. Trailer: `#0E0E10`, duração+data, `Watch` `#D42A2E`.

## Hero
Scrim só sobre imagem; sem imagem → fundo neutro claro. Título `typography.hero`; contraste do texto ≥4.5.

## CinerieScore
Selo `radius-12`, borda ink; número 34px/800 + rótulo “CINERIE SCORE” 9px. 6 estados (ver 24). Nunca cor de filme/série (marca própria neutra).

## Formulários
`control` 44px, `radius-control 8`, borda `#C9C2B6` (default) → 2px `#101010` (focus) → `#C7382F` (invalid). Label persistente 12px/700 acima. Erro 11px `#8A1E1A`.

## Feedback
Alert borda-esquerda 3px por tom; Toast `#101010` flutuante; Modal/Drawer com overlay + foco preso; Skeleton shimmer (estático em reduced-motion).
