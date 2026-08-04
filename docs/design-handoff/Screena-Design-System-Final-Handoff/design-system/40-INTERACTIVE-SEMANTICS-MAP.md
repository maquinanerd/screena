# 40 — Interactive Semantics Map

Classificação semântica de **todos os 106 elementos clicáveis** do canônico (não só spans: 64 `span` + 40 `div` + 1 `h1` + 1 `article` com `onClick`). Base: nome do handler + tag. **Nada foi substituído nas telas** — isto é o contrato de migração (D4). Dados em `interactive-semantics-map.json`.

## Regra-mãe
Nenhum `<span onClick>`/`<div onClick>` sobrevive ao build: **navegação → `<a href>`**, **ação → `<button>`**, **aba → `role="tab"`**, **controle de carrossel → icon-button**. Funcionar com mouse não torna um `span` correto (sem foco/teclado/semântica).

## Classificação (106)
| Papel | Vira | Qtd | Handlers (principais) | Acessibilidade exigida |
|---|---|---|---|---|
| **LINK** | `<a href>` | **77** | goArticle 15, goBrowse 11, m.go 8, goHome 7, goSeries 7, goPerson 6, goNews 4, feat.go 3, goSerie 3, hero.go 2, goSettings 2, goCinema 2, +7 rotas | link nativo, foco visível, Enter ativa, nova aba quando aplicável |
| **TAB** | `<button role="tab">` em `role="tablist"` | **24** | t.onClick 10, n/s/r.t.onClick 3+3+3, d.onClick 2, f/p/ch.onClick | roving tabindex, `aria-selected`, setas do teclado, seleção não só por cor |
| **ICON_BUTTON** | `<button aria-label>` | **4** | movieRecsPrev/Next, scrollRecsLeft/Right | `aria-label`, toque 44, foco |
| **REMOVER** | — | **1** | toggleSwitcher | switcher de protótipo; remover no build |

Total: **77 + 24 + 4 + 1 = 106**. Sem itens `NECESSITA_DECISÃO`.

## Notas
- Os `div`/`article`/`h1` com `onClick` são majoritariamente **cards clicáveis inteiros** (m.go/feat.go/hero.go/goArticle) → no build, o card é um `<a>` envolvendo o conteúdo (ou título como link + área clicável acessível), não `div onClick`.
- Os handlers `*.onClick` de `mkTabs` já centralizam a lógica de seleção — mapear para o componente **Tabs** (D3B) mantém a lógica e adiciona semântica.
- Controles de carrossel (`*Recs*`, `scroll*`) → **IconButton** com `aria-label` "Anterior/Próximo".
