# 45 — Final QA & Handoff (D4C)

Última unidade no Claude Design. Estado do canônico validado e pacote consolidado para o Claude Code.

## Estado final
- Canônico: `Screen Screens v4.dc.html` · SHA `6936a3416d9d008d46c0e88b87127817e7cc30a3acd5829da86e8b61296ca770` · **380.309 bytes**
- D4B: 106 elementos inadequados → 0 · 77 `<a>` · 29 `<button>`.
- D4C: 3 toggles de Settings reclassificados de `role="tab"` → **`role="switch"` + `aria-checked`** (14 instâncias renderizadas, estado true/false não dependente só de cor). 21 `role="tab"` restantes = abas/segmented legítimos.

## Contagens finais
18 telas · 77 anchors (todos com href) · 29 buttons (todos type=button) · 21 role=tab · 3 role=switch · 5 aria-label (4 IconButton + 1 switcher) · **21 AdSlots** · **39 image-slots** · 0 inadequados · 0 ids duplicados · tags balanceadas (a 77/77, button 29/29, article 2/2, h1 12/12).

## Validações
- **QA estrutural: PASS** — HTML válido, tags balanceadas, 0 inadequados, 0 `<a>` sem href, 0 links/controles aninhados, 0 âncora-invólucro, 0 dup ids.
- **Sweep visual: PASS (18/18)** — todas as telas abrem, conteúdo presente, `badHref/nested/wrapper=0`, rótulo PUBLICIDADE presente.
- **Teclado/foco: PASS** — `<a>`/`<button>` nativos; `role=tab`; `role=switch`+`aria-checked`; `aria-label`; navegação SPA via interceptor `navGuard` (URL não muda).
- **Referências visuais desktop:** home, notícias, detalhe-filme (logo/contexto vermelho, Score 82), detalhe-série (verde, Score 86) capturadas em `final-reference-screenshots/`.

## Limitações (honestas)
- **Viewport real 390/768:** as ferramentas de screenshot não capturam conteúdo de `<iframe>` e não permitem redimensionar o viewport do navegador. Não foi possível produzir captura pixel a 390px/768px nem as 54 renderizações. Evidência responsiva: desktop verificado ao vivo nas 18 telas; screen 08 (mobile nativo) confirmado sem overflow; CSS responsivo do canônico intacto (migração puramente semântica). **Recomenda-se validação pixel dedicada a 390/768 no ambiente do Claude Code** (navegador real com DevTools/Playwright).
- Screenshots mobile/tablet ausentes por essa limitação — registrado no manifesto.

## Problemas corrigidos (D4B+D4C)
1. Fechamento de tags não pareado (1ª transformação) → parser balanceado.
2. Hrefs nulos em cards de recomendação → factories `go`/`href` (deck, discFeature, movieRecs, knownFor, catDetail).
3. Toggles de Settings como `role=tab` → `role=switch` + `aria-checked`.

## Problemas/decisões restantes
- Segmented controls (tema/densidade/pôster) permanecem `role=tab` (padrão tablist aceitável). Refinamento opcional para `role=radiogroup` fica a critério do Claude Code.
- Validação pixel 390/768 pendente (limitação de ferramenta, não do canônico).

## Arquivos de autoridade
Ver `FINAL-HANDOFF-MANIFEST.json` → `authorityFiles`. Resumo: canônico + 4 páginas de biblioteca; `design-tokens.json`, `component-contracts.json`, `page-specifications.json`, `responsive-matrix.json`, `migration-results.json`; docs 13–45; screenshots de referência; assets originais.

## Instruções de implementação
Seguir `PROMPT-FINAL-CLAUDE-CODE.md`. Fidelidade máxima ao canônico; nenhum redesenho; dados reais sem alterar apresentação aprovada; validar 390/768/1280; comparar contra as referências.
