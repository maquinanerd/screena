# 36 — Inconsistency Resolution Log

Log de resolução dos achados. Nesta unidade (D2) o mandato é **auditar, não corrigir** — logo, os itens de componente (F-01…F-09) ficam `AGUARDANDO` as unidades D3+ por design. Só itens técnicos impeditivos e de asset foram resolvidos.

## Resolvidos nesta sessão (D1+D2)

| ID | Item | Ação | Data | Evidência |
|---|---|---|---|---|
| R-01 | Marca antiga "The Screen"/"thescreen.media"/"Screen Score" em arquivos ativos | Rebrand textual completo → Cinerie/cinerie.com/Cinerie Score | 2026-07-21 | `38-REBRAND-VALIDATION.md` (zero ocorrências fora de legacy) |
| R-02 | 8 excertos `paginas/*.html` com marca antiga | Reaplicado rebrand direto | 2026-07-21 | `38` |
| R-03 | Pacote espelho `Screen-Design-Canonical/` desatualizado | Ressincronizado da raiz | 2026-07-21 | `38` |
| R-04 | 10 SVGs de logo órfãos, não referenciados, cor não conforme | **Arquivados** em `uploads/LEGACY-NAO-USAR/` (não apagados) | 2026-07-21 | `uploads/LEGACY-NAO-USAR/_LEGACY-NAO-USAR.md` |
| R-05 | Estado pós-rebrand sem snapshot | Criado `POST-REBRAND-SNAPSHOT/` (82 arquivos, hashes) | 2026-07-21 | `SNAPSHOT-MANIFEST.json` |

## Aguardando correção (D3 — Foundations/Tokens/Componentes e diante)

| ID | Severidade | Item | Bloqueado por | Status |
|---|---|---|---|---|
| F-01 | P1 | Família Button única (32 assinaturas) | definição de tokens + família (D3) | AGUARDANDO |
| F-02 | P1 | Cinerie Score sem estado vazio | design de estados (D3/D-estados) | AGUARDANDO |
| F-03 | P1 | Telas P0 sem mobile canônico | unidade responsividade | AGUARDANDO |
| F-04 | P1 | Estados interativos + foco visível ausentes | unidades estados + acessibilidade | AGUARDANDO |
| F-05 | P2 | 41 tamanhos de fonte | escala tipográfica (D3) | AGUARDANDO |
| F-06 | P2 | 32 valores de gap | escala de spacing (D3) | AGUARDANDO |
| F-07 | P2 | 19 sombras | tokens de sombra (D3) | AGUARDANDO |
| F-08 | P2 | 176 cores (cauda de ~120) | tokens de cor (D3) | AGUARDANDO |
| F-09 | P2 | Radius do primário misto | ligado a F-01 (D3) | AGUARDANDO |
| F-10 | P3 | Pesos 900/400 quase sem uso | decisão de escala (D3) | AGUARDANDO_DECISAO |
| F-11 | P3 | Radius 12/14px outliers | — | ACEITO (CLAUDE.md proíbe unificar) |
| F-12 | P3 | Switcher (tela 01) | build real | AGUARDANDO |
| F-13 | P3 | Ad screens 17/18 | — | ACEITO |

**Regra:** nenhum P1–P3 foi corrigido em D2 (proibido pelo escopo da unidade). Nenhum P0 técnico impeditivo restou.

## Atualização D3B (2026-07-21)
Componentes canônicos **definidos** (não migrados) que endereçarão os P1 na migração D4:
- **F-01** (32 assinaturas de botão) → família **Button** única definida (`13`/`component-contracts.json`). Status: AGUARDANDO_MIGRACAO (D4).
- **F-04** (106 clicáveis sem semântica/foco) → classificados em `40-INTERACTIVE-SEMANTICS-MAP` (77 Link · 24 Tab · 4 IconButton · 1 remover); componentes com foco/teclado definidos. Status: AGUARDANDO_MIGRACAO (D4).
- Novo **DD-17** (P1): botão de série preenchido usa `#395C42`/texto escuro (contraste). Status: AGUARDANDO_MIGRACAO.
- F-02 (Cinerie Score vazio) e estados de dado → **D3C**. F-03 (mobile) → unidade responsividade. F-05…F-09 (tokenização) resolvidos como tokens em D3A, aplicação em D4.


## Atualização D3C (2026-07-21)
- **F-02** (Cinerie Score sem estado vazio) → **RESOLVIDO no design**: 6 estados definidos (available/insufficient_data/not_calculated/unavailable/blocked/omitted) em `CinerieScore` (`24-EMPTY-LOADING-ERROR-STATES.md`, `component-contracts.json`, prova em `Components-Content-Forms-Feedback.dc.html`). Status: DEFINIDO — AGUARDANDO_MIGRACAO (D4).
- **Estados de dado** (empty/loading/error/partial) → definidos como componentes/estados reutilizáveis (Skeleton, EmptyState, ErrorState, LoadingState). Eram **ausentes no canônico** (0). Status: DEFINIDO — AGUARDANDO_MIGRACAO.
- **Formulários** (0 no canônico) → família nova (Field/Input/Select/Checkbox/Radio/Switch/Textarea/FormActions). Status: DEFINIDO.
- Novo **DD-19** (card não-clicável: link principal explícito, sem `<div onClick>`), **DD-20** (overlay escuro sancionado só em mídia/hero), **DD-21** (formulários/feedback são novos no sistema). Aplicação nas telas = D4.
- F-03 (mobile) permanece para a unidade de responsividade. F-01/F-04 seguem AGUARDANDO_MIGRACAO (D4).