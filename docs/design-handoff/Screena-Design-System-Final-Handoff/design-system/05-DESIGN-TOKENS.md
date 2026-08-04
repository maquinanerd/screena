# 05 — Design Tokens (governança)

Os valores vivem em `design-tokens.json` (legível por máquina) e `design-decisions.json` (justificativas). Este documento define **como** os tokens são governados.

## Estrutura de um token
Cada token traz: `value` · `type` · `description` · `status` · (opcional) `aliases` / `consolidates` / `use`.

**status:**
- `preserved` — valor já em uso no canônico, mantido como referência.
- `canonical` — valor de referência que consolida quase-duplicatas (a aplicar em D4).
- `deprecated` — valor antigo; migra para um alias (só existe no snapshot/legacy após D4).
- `exception` — fora do sistema (marca de terceiros, categoria), documentado e isolado.

## Categorias (14)
`color · typography · spacing · grid · breakpoint · radius · border · shadow · motion · icon · control · media · zIndex` (+ `meta`).

## Regras de governança
1. Nenhum valor recorrente novo sem token.
2. Nenhum token novo sem descrição/uso documentado.
3. Token sem uso não entra no sistema.
4. Exceção precisa de ID (DD-xx em `design-decisions.json`).
5. Componentes **não** redefinem a paleta — consomem tokens.
6. Páginas **não** criam cores locais recorrentes (uma cor repetida ≥3× vira token ou exceção).
7. Páginas **não** criam escala tipográfica própria — usam `typography.styles`.
8. Breakpoints são globais (5 fixos); nenhum breakpoint local.
9. Valores legacy permanecem só em `POST-REBRAND-SNAPSHOT/` e `uploads/LEGACY-NAO-USAR/`.
10. Alteração de foundation exige entrada no changelog (`30-CHANGELOG.md`, a criar) + nova decisão DD-xx.

## Escopo desta unidade (D3A)
Tokens **definidos**, **não aplicados** às 18 telas. Aplicação = D3B (componentes) e D4 (migração de telas). O canônico `Screen Screens v4.dc.html` permanece inalterado (SHA `0cc8fcd6…`, 367827 bytes) — confirmado intacto no diagnóstico de abertura.

## Como consumir (no build Next.js futuro)
`design-tokens.json` → gerar CSS custom properties / theme object. Nomes de token são a fonte da verdade; hexes/px podem mudar num só lugar. Marca (movie/series) por contexto de rota, nunca hardcode espalhado.
