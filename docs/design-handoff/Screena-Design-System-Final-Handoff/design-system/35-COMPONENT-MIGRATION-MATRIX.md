# 35 — Component Migration Matrix

Destino canônico de cada elemento atual. **Nenhuma substituição foi feita** (migração = D4). Mapeamento por **assinatura** (D2 não gerou IDs por instância; o casamento instância-a-instância acontece na migração). Dados: `component-migration-matrix.json`, `interactive-semantics-map.json`.

## Botões (40 instâncias / 32 assinaturas → família Button)
| Grupo atual (assinatura) | Qtd | Componente | Variante | Tamanho | Status |
|---|---|---|---|---|---|
| `#F0443E` + padding/radius variados (5 assinaturas) | 6 | Button | movie *(ou primary se ação neutra)* | md/lg | MAPEADO |
| `#101010` + padding/radius variados (6 assinaturas) | 8 | Button | primary | sm/md | MAPEADO |
| `#FFFFFF` + borda + padding variados (5) | 7 | Button | secondary | sm/md | MAPEADO |
| `#7FA56F` (série) | 1 | Button | series *(usar verde-escuro #395C42 se texto branco)* | md | MAPEADO + NECESSITA_DECISÃO (contraste) |
| `transparent` + borda | 1 | Button | ghost/tertiary | md | MAPEADO |
| data-driven `{{ t.bg }}`/`{{ n.bg }}`/`{{ f.bg }}`/`{{ s.bg }}`/`{{ ch.bg }}`/`{{ p.bg }}` (chips/tabs/plataforma) | 12 | Chip / Tabs / ToggleSegmented | filter/selected | — | NÃO_DEVERIA_SER_BUTTON |
| `{{ c.primaryBg }}` (card CTA) | 1 | Button | primary | sm | MAPEADO |
| `#F0443E`/`#101010` "Ver tudo"/"Continuar" | 4 | Button/Link editorial | editorial | sm | MAPEADO |

**Distribuição (exata, soma 40):** Button 23 · editorial Button/Link ("Ver tudo"/"Continuar", vira Link ao navegar) 4 · NÃO_DEVERIA_SER_BUTTON (chip/tab/toggle) 12 · NECESSITA_DECISÃO (contraste série — regra já decidida em DD-17, escolha por instância em D4) 1 = **40**. Nenhum item sem destino.

## Clicáveis com onClick (106 → semântica real)
Resumo (detalhe em `40-INTERACTIVE-SEMANTICS-MAP.md`):
| Papel | Vira | Qtd |
|---|---|---|
| LINK | `<a href>` | 77 |
| TAB | `role="tab"` | 24 |
| ICON_BUTTON | `<button aria-label>` | 4 |
| REMOVER | — (switcher protótipo) | 1 |

## Chrome compartilhado
| Atual | Componente canônico | Status |
|---|---|---|
| Nav fixa (`_compartilhado-chrome`) | Header (default-light + transparent-on-image + mobile) | MAPEADO |
| Footer claro | Footer canônico | MAPEADO |
| Logo `LOGOS` map (10 slots) | Header logo contextual | MAPEADO (já conforme) |
| AdSlot (dc-import, 4 variantes) | AdvertisementSlot | JÁ COMPONENTIZADO |

## Regra
Nenhum componente antigo equivalente fica sem status. `NECESSITA_DECISÃO` restante: 1 (contraste do botão de série — resolver com verde-escuro `#395C42` ou texto escuro). Migração efetiva nas 18 telas = **D4**.


## Conteúdo (D3C) — famílias → componentes
Mapeamento por família (casamento por instância = D4). Dados: `component-migration-matrix.json.contentFamilies`, `41-CONTENT-COMPONENTS.md`.

| Família | Sinal no canônico | Componente D3C | Decisão |
|---|---|---|---|
| Mídia/Poster | 39 image-slots | MediaImage/Avatar | CONSOLIDAR |
| Publicidade | 21 (4 formatos) | AdSlot | JÁ COMPONENTIZADO |
| Cards filme/série | data-driven | Movie/SeriesCard + HighlightRailCard | CONSOLIDAR |
| Notícias overlay | home + news | NewsOverlayCard | CONSOLIDAR |
| Trailer “em breve” | comingSoon | TrailerCard | CONSOLIDAR |
| Hero / Rail | 75 / 26 menções | 5 heroes / ContentRail | CONSOLIDAR |
| Rating/Score | 141 / Cinerie Score | CinerieScore (6 estados) / ExternalRating | CONSOLIDAR |
| Streaming | providers | StreamingAvailability | CONSOLIDAR |
| Temporada/Episódio · Elenco · Notícia · Newsletter | presentes | Season*/Episode* · CastList · Article* · NewsletterCard | CONSOLIDAR |
| **Formulários** | **0 controles** | Field/Input/Select/… | **DEFINIR NOVO** |
| **Feedback/skeleton/empty** | **0** | Alert/Modal/Toast/Skeleton/… | **DEFINIR NOVO** |

**Total:** 15 famílias → 12 consolidar · 1 já componentizada · 2 novas. Nenhuma família sem destino. Migração às telas = **D4**.