# 39 — Foundation Consolidation Map

Para cada categoria: valores encontrados (D2) → canônicos → depreciados → migração. **Nenhum valor foi substituído nas 18 telas** (isso é D4). Todo valor da D2 recebeu decisão.

## Cores
- **Encontradas:** 176 hex + 115 rgba.
- **Canônicas:** ~35 tokens de sistema (background/text/border/accent/state/media).
- **Exceções:** ~13 marcas externas + 3 categorias de notícia (não são inconsistência).
- **Depreciadas:** ~120 de cauda → alias para o token canônico mais próximo (near-blacks→scrim/ink-deep; cinzas→text.secondary/muted; vermelhos escuros→movie-dark; etc.).
- **Migração:** D4. **Decisão de todas:** sim (núcleo=preserved, cauda=alias, externas=exception).

## Tipografia
- **Encontrados:** 41 tamanhos, 9 pesos.
- **Canônicos:** 24 estilos nomeados; pesos 800/750/700/650/600/500/400/300.
- **Depreciados:** 7 meios-pixels (8.5/9.5/10.5/11.5/12.5/13.5/14.5) → estilo mais próximo; pesos 900/400 sob decisão (F-10).
- **Migração:** D3B (componentes) + D4.

## Spacing / gaps
- **Encontrados:** 32 gaps + paddings/margens variados.
- **Canônicos:** 19 degraus (0–120px).
- **Depreciados:** ímpares e near-dupes (3,5,7,9,11,13,18,22,26,30,34,36,44,52,60,72,102) → snap documentado (`08`).
- **Migração:** D4.

## Radius
- **Encontrados:** 9 valores.
- **Canônicos:** 9 (todos preservados — sancionados por CLAUDE.md).
- **Depreciados:** nenhum. 12/14px são media (outlier 14 aceito).
- **Migração:** só nomeação; sem troca de valor.

## Bordas
- **Encontradas:** 1px (dominante), cores `#E3DED6`/`#E9E3D8`/`#F1EDE6`/`#D8D2C8`.
- **Canônicas:** widths none/1px/1.5px; 6 cores de borda.
- **Depreciadas:** cinzas de borda redundantes → alias.
- **Migração:** D4.

## Sombras
- **Encontradas:** 19.
- **Canônicas:** 7 tokens.
- **Depreciadas:** 12 → alias (`consolidates` no token JSON).
- **Migração:** D4.

## Breakpoints
- **Encontrados:** nenhum media query no canônico (desktop-first) + 1 tela mobile (08).
- **Canônicos:** 5 (390/480/768/1280/1440).
- **Migração:** unidade de responsividade.

## Ícones
- **Encontrados:** sprite `ic-*` stroke, currentColor, ~19 símbolos.
- **Canônicos:** 5 tamanhos (12/16/20/24/32).
- **Depreciados:** 15px→16, 18px→20 (alias).
- **Migração:** D3B/D3C.

## Alturas de controle
- **Encontradas:** ≥5 paddings de botão divergentes.
- **Canônicas:** 30/36/44/52px.
- **Migração:** D3B (família Button).

## Aspect ratios
- **Encontrados:** 2/3 (14×), 16/9 (6×).
- **Canônicos:** poster 2/3, backdrop/still/news 16/9, portrait 3/4, square 1/1, og 1.91/1, hero full-bleed.
- **Migração:** D3C (mídia).

## Z-index
- **Encontrados:** nav 60, switcher 90.
- **Canônicos:** escala 0–110 nomeada.
- **Migração:** D3B/D4 (sem 9999).

## Resumo
| Categoria | Encontrados | Canônicos | Depreciados | Migração |
|---|---|---|---|---|
| Cores | 176 | ~35 + 16 exceções | ~120 (alias) | D4 |
| Tipografia | 41 tam / 9 pesos | 24 estilos | 7 meios-px + 2 pesos | D3B/D4 |
| Spacing | 32 gaps | 19 degraus | 17 (snap) | D4 |
| Radius | 9 | 9 | 0 | nomeação |
| Sombras | 19 | 7 | 12 (alias) | D4 |
| Breakpoints | 0 (+1 mobile) | 5 | — | responsividade |
| Ícones | ~19 símbolos | 5 tamanhos | 2 (alias) | D3B/C |
| Controles | ≥5 paddings | 4 alturas | resto | D3B |
| Aspect | 2 | 7 | — | D3C |
| Z-index | 2 | 9 | — | D3B/D4 |

**Nenhum valor sem decisão.** Nenhuma tela migrada nesta unidade.
