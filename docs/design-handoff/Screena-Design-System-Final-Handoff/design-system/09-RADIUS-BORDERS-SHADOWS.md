# 09 — Radius, Borders & Shadows

## Radius — 9 valores sancionados (NÃO unificar)
Conjunto fixado por `CLAUDE.md` (DD-09). A regra antiga "raio 0 em tudo" está **OBSOLETA**. Nomear ≠ reduzir: os 9 permanecem, cada um com uso definido. Valores em `design-tokens.json → radius`.

| Token | Valor | Uso (ocorrências D2) | Componentes |
|---|---|---|---|
| radius-none | 0 | 15× (barras) + telas de detalhe borderless | Top News, botão Entrar, fichas de detalhe |
| radius-hairline | 2px | 15× | barra de acento de seção |
| radius-xs | 5px | 5× | controle pequeno |
| radius-sm | 6px | 20× | controle |
| radius-control | 8px | 53× | chips, CTAs, badges, mini-pôster, botão + |
| radius-card | 10px | 63× (mais comum) | cards |
| radius-media | 12px (+14px) | 3× | pôsteres 2:3, thumbs 16:9 |
| radius-pill | 999px | 22× | pílulas/tags |
| radius-circle | 50% | 38× | avatar, play, setas circulares |

### Matriz componente → radius permitido
| Componente | Radius |
|---|---|
| Button (padrão) | radius-control (8) — ou radius-none em contexto editorial (news/entrar) |
| Chip / Badge | radius-control (8) |
| Card | radius-card (10) |
| Pôster / thumb de mídia | radius-media (12) |
| Avatar / play / seta circular | radius-circle |
| Tag / pílula de status | radius-pill (999) |
| Barra de acento | radius-hairline (2) |
| Bloco Top News / ficha de detalhe | radius-none (0) |
Regra: não arredondar tudo, não converter todos os cards ao mesmo raio, não remover pill onde é semântico. `radius-media` 14px (2×) é outlier aceito dentro de media.

## Bordas
| Token | Valor |
|---|---|
| border.width-hairline | 1px (único em uso real) |
| border.width-strong | 1.5px (tracejada/ênfase) |
| border.subtle | `#F1EDE6` |
| border.default | `#E3DED6` (108×) |
| border.strong | `#D8D2C8` |
| border.selected / focus | `#101010` |
| border.error | `#C7382F` |
Regra: **não** usar borda + sombra juntas sem finalidade. Card claro = borda default OU sombra-card, não ambos por padrão. Foco = borda 2px `#101010` + offset (não depender só de cor — 3.10).

## Sombras — 19 → 7 tokens (DD-10)
| Token | Valor | Uso |
|---|---|---|
| shadow-none | none | padrão |
| shadow-card | `0 3px 14px rgba(20,18,14,0.05)` | card em repouso (dominante 28×) |
| shadow-card-hover | `0 4px 16px rgba(20,18,14,0.12)` | card em hover |
| shadow-dropdown | `0 8px 24px rgba(0,0,0,0.06)` | menus/popovers |
| shadow-modal | `0 30px 70px rgba(0,0,0,0.18)` | modais/diálogos |
| shadow-editorial-image | `0 12px 28px rgba(0,0,0,0.5)` | pôster/imagem de destaque |
| shadow-sticky-header | `0 1px 3px rgba(20,18,14,0.12)` | nav sólida ao rolar |
Regra: sombra não é a única forma de hierarquia (3.3). As 12 sombras restantes da D2 mapeiam por alias (ver `design-tokens.json → shadow.*.consolidates`).
