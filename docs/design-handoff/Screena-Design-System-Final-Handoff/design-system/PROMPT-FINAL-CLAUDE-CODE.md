# PROMPT FINAL — IMPLEMENTAÇÃO DO FRONTEND CINERIE (Claude Code)

Implemente o frontend real da Cinerie com **fidelidade máxima** ao design canônico aprovado. Este pacote é a fonte de verdade. Não redesenhe, não reinterprete, não simplifique.

## AUTORIDADES (fonte de verdade — obedecer literalmente)
- `Screen Screens v4.dc.html` — **canônico visual e comportamental das 18 telas** (SHA `6936a341…296ca770`, 380.309 bytes)
- `Foundations.dc.html` — fundações
- `Components-Primitives-Navigation.dc.html` — primitivas, botões, navegação
- `Components-Content-Forms-Feedback.dc.html` — cards, conteúdo, formulários, feedback
- `Templates-And-Public-Screens.dc.html` — templates e estrutura das 18 telas
- `cinerie-design-system-handoff/design-tokens.json` — cores, tipografia, espaçamento, radius, sombras, motion, z-index
- `cinerie-design-system-handoff/component-contracts.json` — 104 contratos de componente
- `cinerie-design-system-handoff/page-specifications.json` — árvore/seções/ordem/dados/estados por tela
- `cinerie-design-system-handoff/responsive-matrix.json` — breakpoints 390/768/1280 e colapso de grid
- `cinerie-design-system-handoff/migration-results.json` — resultado da migração semântica
- `cinerie-design-system-handoff/data-visual-contracts.json` — required/optional/forbidden/fallback por componente
- `cinerie-design-system-handoff/FINAL-HANDOFF-MANIFEST.json` — índice de autoridade + checksums + legados
- `cinerie-design-system-handoff/final-reference-screenshots/` — referências visuais desktop
- assets originais: `duna-*.webp`, `oppen-*.webp`, `uploads/5a–5j-logo-*.svg`, `image-slot.js`, `support.js`, `AdSlot.dc.html`

## MARCA
Marca pública = **Cinerie** (cinerie.com). Barra vermelha `#F0443E`=filmes, verde `#7FA56F`=séries, neutra no restante. CTA de filme preenchido usa `#D42A2E` (5.04 AA). "Screena"/"The Screen"/"thescreen.media" são **legado** — não devem aparecer em nenhuma superfície visível.

## PROIBIÇÕES (não fazer)
- redesenhar, reinterpretar ou simplificar seções;
- remover ou inventar conteúdo, notas (Cinerie Score), disponibilidade de streaming;
- substituir imagens/posters/backdrops;
- alterar tipografia (Montserrat), cores, espaçamentos ou radius (reproduzir os tokens exatos — sem regra global de radius 0);
- criar UI genérica de SaaS;
- implementar tudo em um componente monolítico;
- usar fundo escuro sólido em cards embutidos de conteúdo (só mídia/hero/newsletter);
- recriar a barra vermelha do SectionHeader (SectionHeader = 26px uppercase, 1ª palavra 800–900 + resto 300–400, sem barra);
- transformar card inteiro em `onClick`, criar link aninhado ou `<a>` sem href;
- declarar conclusão sem comparação visual contra as referências.

## SEQUÊNCIA OBRIGATÓRIA
1. **Auditar** o projeto/repo real (stack, arquitetura, convenções) antes de escrever código.
2. **Mapear** o design para a arquitetura existente (não impor estrutura nova sem necessidade).
3. **Implementar tokens** a partir de `design-tokens.json` (fonte única; sem valores mágicos onde há token).
4. **Implementar componentes** conforme `component-contracts.json` (semântica: navegação=`<a>`, ação/aba/controle=`<button>`, switch=`role="switch"`+`aria-checked`, IconButton com `aria-label`).
5. **Implementar templates** conforme `page-templates.json`.
6. **Implementar as 18 telas** conforme `page-specifications.json` (árvore, ordem de seções, 21 AdSlots, 39 image-slots nas posições especificadas).
7. **Conectar dados reais** sem alterar a apresentação aprovada; campo ausente é omitido (nunca "N/D"); Cinerie Score com os 6 estados honestos; sem streaming/nota inventados.
8. **Validar** 390px, 768px e 1280px (as 54 combinações — a validação pixel a 390/768 ficou pendente no design por limitação de ferramenta; faça-a aqui com navegador real/Playwright).
9. **Gerar screenshots** da implementação nos 3 breakpoints.
10. **Comparar** contra `final-reference-screenshots/` e a estrutura de `page-specifications.json`.
11. **Corrigir divergências** (fidelidade primeiro; correções cirúrgicas).
12. **Executar** lint, typecheck, testes e build; tudo verde.
13. **Registrar** diferenças inevitáveis (com justificativa).
14. **Não alterar backend** além do necessário para conectar dados.
15. **Não tocar em GitHub** (PR/merge/push) sem ordem explícita.

## ACESSIBILIDADE (WCAG 2.2 AA)
Foco visível; ordem de tabulação lógica; Enter/Space/Escape; `aria-current`/`aria-selected`/`aria-checked`/`aria-expanded`/`aria-controls`; nomes acessíveis; touch target ≥44px; seleção/estado nunca só por cor; contraste AA (incl. `#D42A2E` 5.04, badges com tinta escura, texto sobre scrim ≥4.5).

## CRITÉRIO DE PRONTO
18 telas fiéis nos 3 breakpoints; 0 elementos inadequados; 21 AdSlots + 39 image-slots presentes; comparação visual feita; lint/typecheck/testes/build verdes; divergências documentadas. Só então declarar conclusão.
