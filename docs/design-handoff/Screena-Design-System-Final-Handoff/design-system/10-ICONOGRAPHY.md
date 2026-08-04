# 10 — Iconography

## Origem e estilo
- **Sprite SVG inline** no topo do body: `<symbol id="ic-*" viewBox="0 0 24 24">`, consumido via `<svg><use href="#ic-*"></use></svg>`.
- **Estilo:** traço (stroke) uniforme `1.8–2`, `fill:none`, `stroke-linecap/linejoin:round`, `currentColor` (herda a cor do contexto). Família única e coerente — **não** misturar com ícones preenchidos de outra biblioteca.
- Exceção: `ic-star` (nota) pode ser preenchido com `rating-gold #F5C84B`.

## Ícones inventariados (D2)
`ic-star`, `ic-star-o`, `ic-play`, `ic-arrow`, `ic-cl`, `ic-cr` (setas circulares), `ic-cal`, `ic-cal2`, `ic-clock`, `ic-id`, `ic-user`, `ic-mail`, `ic-crown`, `ic-bookmark`, `ic-globe`, `ic-lock`, `ic-layers`, `ic-eye`, `ic-tv`. Todos herdam `currentColor`.

## Tokens de tamanho
| Token | Valor | Uso |
|---|---|---|
| icon-xs | 12px | inline em label/meta |
| icon-sm | 16px | inline em texto/botão (15px legado → 16) |
| icon-md | 20px | ação padrão (18px legado → 20) |
| icon-lg | 24px | destaque/nav |
| icon-xl | 32px | vazio/estado/hero |

## Regras
- **Funcional** (botão-ícone, ação): precisa de `aria-label`; alvo ≥ 44px (usar `control-height`).
- **Decorativo** (junto de texto que já nomeia): `aria-hidden="true"`.
- Ícone + texto: `gap` space-2/3 (4–6px), alinhamento por baseline/center.
- Correção óptica: ícones circulares (play) podem precisar de +1–2px vs. quadrados.
- **Não** redesenhar o logo como ícone; **não** usar emoji.
- Contraste: ícone funcional segue o mínimo de texto (AA) da sua cor/fundo.

## Estados
default (currentColor) · hover (herda cor do controle) · disabled (`text.disabled`) · em botão de acento, cor = `text.inverse` respeitando as regras de contraste do `06`.

> Sistema de **badges de conquista/rank** (`uploads/the_screen_badges_v3_1_official_identity/`) é um conjunto visual **separado** dos ícones de UI — documentar à parte quando entrar em escopo; não misturar com o sprite `ic-*`.
