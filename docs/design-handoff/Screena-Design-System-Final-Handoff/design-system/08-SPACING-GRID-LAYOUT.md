# 08 — Spacing, Grid & Layout

## Escala de espaçamento (19 degraus)
Derivada dos valores reais (DD-08). O design usa muito 7/9/10/14/18px (ritmo editorial denso) — uma escala pura 4/8 apagaria a identidade, então a canônica inclui 10/14/20 e faz *snap* documentado dos ímpares. Valores em `design-tokens.json → spacing`.

`0 · 2 · 4 · 6 · 8 · 10 · 12 · 14 · 16 · 20 · 24 · 32 · 40 · 48 · 56 · 64 · 80 · 96 · 120` (space-0…space-18)

- **spacing interno de controles:** xs `6px v / 12px h`, sm `8/16`, md `12/22`, lg `15/28` (ver `09`/control tokens).
- **spacing interno de card:** 16–24px (space-8…10).
- **entre elementos:** 8–14px (space-4…7).
- **grid gap:** 16–24px (space-8…10).
- **entre seções:** 56px topo (space-14).
- **página:** 80px lateral desktop (space-16), 20px mobile (space-9).
- **hero:** 70px base (space entre 64 e 80).
- **editorial compacto:** 6–10px (space-3…5).

### Tabela de migração (gaps deprecados → token)
| Atual | Token | Ocorrências | Decisão |
|---|---|---|---|
| 3px | space-2/4 | 6 | snap |
| 5px | space-4 (8) ou space-3 (6) | 16 | snap por contexto |
| 7px | space-4 (8) | 22 | snap |
| 9px | space-4/5 | 34 | snap |
| 11px | space-6 (12) | 3 | snap |
| 13px | space-6/7 | 3 | snap |
| 18px | space-9 (20) ou space-8 (16) | 14 | snap |
| 22/26/30/34/36px | space-10/11/12 | 24 | snap |
| 44/52/60/72/102px | space-12…18 | 8 | snap |
Valores mantidos como degraus: 2,4,6,8,10,12,14,16,20,24,32,40,48,56,64,80,96,120. **Não substituir nas telas nesta unidade** (é D4).

## Breakpoints oficiais
| Nome | Largura | Intervalo |
|---|---|---|
| mobile-small | 390px | ≤ 479 |
| mobile | 480px | 480–767 |
| tablet | 768px | 768–1279 |
| desktop | 1280px | 1280–1439 |
| desktop-wide | 1440px | ≥ 1440 |

## Containers
| Container | max-width | padding | Uso |
|---|---|---|---|
| editorial | 1280px | 0 80px (desktop) / 0 20px (mobile) | conteúdo geral |
| nav | 1380px | 0 80px | barra de navegação |
| reading | 720px | 0 40px | corpo de artigo |
| full-bleed | 100% | 0 | hero, faixas de mídia |
Regra: conteúdo nunca encosta na borda (padding mínimo space-9 no mobile).

## Grids
| Grid | Colunas (desktop) | Gap | Colapso |
|---|---|---|---|
| poster | repeat(6,1fr) → auto-fill minmax(150px) | 16px | 3 (tablet) → 2 (mobile) |
| top10 | repeat(4,1fr) | 24px | 2 → scroll horizontal |
| news | 1.25fr 1fr | 18px | 1 coluna (mobile) |
| detail-media | 1fr 3fr 2fr | 4px | empilha (mobile) |
| pessoas/elenco | repeat(4,1fr) | 20px 36px | 3 → 2 |

## Regras de layout
- Grids não dependem de largura fixa de tela (usar `fr`/`minmax`/`auto-fill`).
- Pôster e texto respeitam proporção (ver `media` em tokens).
- Sidebars/rails colapsam de forma definida; rails com overflow horizontal documentado.
- **Anúncios não quebram o grid:** AdSlot ocupa faixa própria entre seções, largura de container, nunca dentro de uma coluna de card.
- Não redesenhar telas nesta unidade — exemplos isolados vivem na página de foundations (`Foundations.dc.html`).
