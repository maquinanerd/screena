# 21 — Motion

Movimento funcional, discreto, editorial. Nada decorativo, contínuo ou parallax. Valores em `design-tokens.json → motion`.

## Durações
| Token | Valor | Uso |
|---|---|---|
| duration-instant | 0ms | mudança imediata |
| duration-fast | 120ms | hover, pressed, seleção de chip |
| duration-standard | 240ms | dropdown, fade, troca de estado |
| duration-slow | 350ms | nav transparente→sólida (preservado do canônico) |

## Easing
| Token | Curva | Uso |
|---|---|---|
| easing-standard | cubic-bezier(0.4,0,0.2,1) | maioria |
| easing-enter | cubic-bezier(0,0,0.2,1) | entrada (modal/dropdown abrindo) |
| easing-exit | cubic-bezier(0.4,0,1,1) | saída (fechando) |
| easing-emphasized | cubic-bezier(0.2,0,0,1) | destaque pontual |

## Aplicação por padrão
- **hover:** `duration-fast` + `easing-standard` (cor/sombra/borda).
- **pressed:** `duration-fast`, leve escurecimento/scale ≤0.99.
- **dropdown/popover:** `duration-standard`, `easing-enter`/`exit`, opacity + translateY 4–8px.
- **modal:** backdrop fade `duration-standard`; painel `easing-emphasized`.
- **drawer:** slide `duration-standard`.
- **troca de slide/carousel:** `duration-standard`; sem autoplay agressivo (se houver, ≥6s + pausável).
- **skeleton:** shimmer suave ~1.2s loop (única animação contínua permitida, só em loading).
- **progress/loading:** linear, funcional.

## Regras
- **Reduced motion:** respeitar `@media (prefers-reduced-motion: reduce)` — desativar shimmer/translate, manter fade instantâneo/curto.
- Sem parallax, sem movimento contínuo decorativo, sem autoplay de vídeo com som.
- Movimento nunca é a única indicação de mudança de estado (acompanhar de cor/texto).
