# 15 — Patterns (D3C)

Padrões de composição do sistema, derivados da home (referência editorial). **Não migrados** às 18 telas.

## Ritmo de seção
Seção = `SectionHeader` (26px, 1ª palavra 800–900 + resto 300–400, UPPERCASE) + conteúdo + `Ver tudo` opcional. Faixas alternam superfície clara (`#FDFDFD`/`#FFFFFF`) e, quando a imagem é protagonista, faixa escura de mídia/hero. **Máx. 1–2 fundos escuros** por página.

## Rail “em alta”
Trilho horizontal de `HighlightRailCard` (196px): topo com ★ rating + ano/plataforma, poster 2:3, título, `Ver detalhes` (#D42A2E) + bookmark, `Ver trailer`. Controle de avanço (IconButton). Snap + teclado + `prefers-reduced-motion`.

## Mosaico de notícias (overlay)
Grid `1.25fr 1fr`: 1 `NewsOverlayCard` grande (min-height 430) + 4 pequenos (2×2, min-height 200). Texto branco sobre scrim gradiente + sombra. **Overlay escuro é contexto sancionado de mídia** (não card embutido claro).

## Trailer “em breve”
Faixa escura (`#0E0E10`) com `TrailerCard` 16:10: still + scrim + bookmark, duração (relógio), título, data, `Watch ▶` (#D42A2E). Paginação `01 / 06` + prev/next.

## Card clicável acessível (regra-mãe)
Card **nunca** é `<div onClick>`. Padrões válidos:
1. **Link principal explícito** — o título é `<a href>`; demais elementos não são links aninhados.
2. **Stretched link** — um `<a>` cobre o card via pseudo-elemento; controles internos (bookmark) ficam acima com `position:relative`. Documentado sem links aninhados nem foco duplicado.

## Coluna de leitura
Artigo em ~720px: `ArticleHeader` → `ArticleBody` (parágrafos 16px/1.7) com `PullQuote`, `FactBox`, `InlineMedia`, `CorrectionNotice`, `AIDisclosure`.

## Grid responsivo
Poster grid colapsa por breakpoint (390/480/768/1280/1440). Gap da escala de spacing. Empty e loading (skeleton) sempre previstos.
