# CONTINUAÇÃO DO DESIGN SYSTEM DA CINERIE
# D4B — MIGRAÇÃO DAS 18 TELAS PARA OS COMPONENTES CANÔNICOS

Continue exatamente do estado registrado em:

CHECKPOINT-CURRENT.md

Use Opus 4.8 com esforço Alto.
Use no máximo 1 agente executor e 1 agente verificador.
Não faça auditoria multiagente extensa.

Esta é a primeira unidade que **altera o arquivo canônico**. Trate cada alteração como
cirúrgica, reversível e rastreável.

---

## 0. ESTADO APROVADO (NÃO REFAZER)

Concluídos: D1 · D2 · D3A · D3B · D3C · D4A.

- 104 componentes canônicos (24 D3B + 80 D3C) em `component-contracts.json`, status
  `CANONICAL_DEFINED_NOT_MIGRATED`;
- 13 templates + especificação das 18 telas em `page-templates.json` e
  `page-specifications.json` (autoridade por tela), status `SPECIFIED_NOT_MIGRATED`;
- 106 elementos interativos mapeados em `interactive-semantics-map.json`
  (64 span · 40 div · 1 h1 · 1 article) com destino semântico por ocorrência;
- 40 botões classificados em `component-migration-matrix.json`;
- contraste do botão movie corrigido (#D42A2E, 5.04 AA);
- Cinerie Score com 6 estados honestos;
- 21 ad slots e 39 image slots mapeados por tela.

Não reiniciar nenhuma dessas unidades. Não recontar o que já está aprovado; **usar** as
contagens como metas de verificação.

---

## 1. MISSÃO

Aplicar os componentes canônicos (D3B + D3C) ao arquivo canônico, migrando a semântica
e a estrutura das 18 telas **sem redesenhar** e **sem inventar conteúdo**.

Ao final da D4B:

- os 106 elementos interativos inadequados devem ser **0**;
- cada tela deve usar os componentes definidos em `page-specifications.json`;
- a aparência aprovada deve ser preservada (comparação antes/depois);
- todas as 18 telas devem passar em desktop, tablet e mobile.

Status-alvo dos componentes após a migração: `CANONICAL_APPLIED`.
Status-alvo das telas após a migração: `MIGRATED`.

---

## 2. ARQUIVOS — LEITURA E ALTERAÇÃO

### 2.1 Pode LER (autoridade — não alterar, salvo os marcados como atualizáveis)

- `CHECKPOINT-CURRENT.md` *(atualizável ao final)*
- `MANIFESTO-CANONICO.json`
- `CLAUDE.md`
- `cinerie-design-system-handoff/page-specifications.json`  **(autoridade por tela)**
- `cinerie-design-system-handoff/page-templates.json`
- `cinerie-design-system-handoff/component-contracts.json`
- `cinerie-design-system-handoff/data-visual-contracts.json`
- `cinerie-design-system-handoff/component-migration-matrix.json` *(atualizável: marcar aplicado)*
- `cinerie-design-system-handoff/interactive-semantics-map.json` *(atualizável: marcar migrado)*
- `cinerie-design-system-handoff/design-tokens.json`
- `cinerie-design-system-handoff/design-decisions.json` *(atualizável: DD novas da migração)*
- `cinerie-design-system-handoff/screen-inventory.json` *(atualizável: status por tela)*
- `cinerie-design-system-handoff/responsive-matrix.json` *(atualizável: resultado por breakpoint)*
- `cinerie-design-system-handoff/16-PAGE-TEMPLATES.md`
- `cinerie-design-system-handoff/17-PUBLIC-SCREENS.md`
- `cinerie-design-system-handoff/43-PUBLIC-SCREEN-SPECIFICATIONS.md`
- `cinerie-design-system-handoff/20-ACCESSIBILITY.md` *(atualizável: matriz pós-migração)*
- `Components-Primitives-Navigation.dc.html` (referência de componente)
- `Components-Content-Forms-Feedback.dc.html` (referência de componente)
- `paginas/01`–`18` (`.html` e `.md`, referência estrutural)

### 2.2 Pode ALTERAR

- `Screen Screens v4.dc.html`  **(único arquivo canônico editável — o alvo da migração)**
- `backups/` (criar backup técnico — ver gate 3)
- os JSON/MD marcados acima como *atualizável*
- **novo:** `cinerie-design-system-handoff/44-MIGRATION-LOG.md` (log por tela/lote)
- **novo:** `cinerie-design-system-handoff/migration-results.json` (resultado numérico por tela)

### 2.3 PROIBIDO tocar

- `POST-REBRAND-SNAPSHOT/` (imutável)
- qualquer arquivo em `paginas/` (referência, não edição)
- `Foundations.dc.html`, `AdSlot.dc.html`, `support.js`, `image-slot.js`
- qualquer `.dc.html` de biblioteca (D3B/D3C) — já aprovados
- GitHub, backend, schema

Nenhum arquivo fora da lista 2.2 pode ser modificado.

---

## 3. GATE 1 — PREFLIGHT (bloqueante)

Executar e registrar antes de qualquer alteração:

1. **Hash + tamanho inicial** do canônico `Screen Screens v4.dc.html`
   (algoritmo, valor do hash, bytes). Registrar em `44-MIGRATION-LOG.md`.
2. **Snapshot intacto**: confirmar que `POST-REBRAND-SNAPSHOT/` não foi alterado
   (listar e comparar contagem/hash de referência).
3. **Validar JSONs de entrada** (parse OK e coerência):
   - `page-specifications.json` → exatamente **18** telas, cada uma com template,
     árvore, seções, dataContracts, estados, adSlots, imageSlots;
   - `component-contracts.json` → **104** componentes;
   - `component-migration-matrix.json` → **40** botões + famílias de conteúdo;
   - `interactive-semantics-map.json` → **106** ocorrências (64/40/1/1).
4. **Confirmar contagem de origem no canônico** por script:
   - 106 elementos com `onClick` = 64 `span` + 40 `div` + 1 `h1` + 1 `article`.
   - Se divergir da baseline, **PARAR** e registrar divergência (não migrar sobre base
     inconsistente).
5. **Backup técnico**: copiar `Screen Screens v4.dc.html` para
   `backups/Screen Screens v4.PRE-D4B.dc.html` (cópia integral, verificada por
   hash/bytes). Nenhuma edição antes deste backup existir.

**Só prosseguir se todos os 5 itens = OK.** Registrar resultado do gate como
`PREFLIGHT: PASS` ou `PREFLIGHT: FAIL` com o motivo.

---

## 4. GATE 2 — LOTES DE EXECUÇÃO

Dividir as 18 telas em **6 lotes** por família de template (menor risco → maior),
migrando um lote por vez com checkpoint entre lotes:

- **Lote A (baixo risco / superfícies simples):** 01 Switcher (dev), 16 Entrar, 17 Ad pop, 18 Ad tela.
- **Lote B (formulários):** 13 Configurações, 14 Importar dados.
- **Lote C (índices/listas):** 03 Notícias, 10 Onde assistir, 11 Explorar, 12 Mais aguardados, 15 Listas.
- **Lote D (editorial):** 05 Artigo, 09 Pessoa.
- **Lote E (home):** 02 Home, 04 Categoria.
- **Lote F (detalhe — maior densidade):** 06 Filme, 07 Série, 08 Série mobile.

Regras de lote:
- migrar todas as telas do lote;
- rodar o QA do gate 6 **no lote inteiro** antes de abrir o próximo;
- **nenhuma tela pode ficar parcialmente migrada sem checkpoint explícito**: se um lote
  for interrompido, registrar em `44-MIGRATION-LOG.md` quais telas estão `MIGRATED`,
  `IN_PROGRESS` ou `PENDING`, com hash atual do canônico;
- se um lote falhar no QA, corrigir e revalidar **antes** de prosseguir (não acumular
  dívida entre lotes).

---

## 5. MIGRAÇÃO SEMÂNTICA (por ocorrência)

Autoridade: `interactive-semantics-map.json` (destino por ocorrência) +
`component-migration-matrix.json` (40 botões).

- Substituir exatamente os **106** elementos inadequados pelo destino já documentado
  (LINK→`<a>`, BUTTON→`<button>`, ICON_BUTTON, TAB, TOGGLE, FILTER_CHIP, MENU_TRIGGER,
  CAROUSEL_CONTROL, DISCLOSURE, REMOVER).
- **Preservar a contagem de origem como rastreio:** 64 span, 40 div, 1 h1, 1 article
  (a origem é histórica; o destino elimina o uso inadequado). Registrar, por ocorrência,
  origem → destino.
- Regras invioláveis:
  - **sem links aninhados** (nenhum `<a>` dentro de `<a>`);
  - **sem foco duplicado** (um alvo focável por ação; card usa link principal ou
    stretched-link acessível — DD-19);
  - **nenhum card inteiro com `onClick`**;
  - o `<h1>` clicável continua **heading** — seu controle vira `<a>`/`<button>`
    separado, sem transformar o heading em controle;
  - o `<article>` clicável vira card com **link principal explícito** (título `<a>`),
    sem `article onClick`.
- Toda interação deve apontar a um componente canônico (nenhum `span/div/h1/article
  onClick` remanescente). Meta final: **0** elementos inadequados.

---

## 6. MIGRAÇÃO VISUAL (por tela)

Autoridade: `page-specifications.json` (árvore, ordem de seções, componentes,
containers, tokens, dados, estados, ad/img slots por tela) + `data-visual-contracts.json`.

- Aplicar os componentes D3B/D3C definidos para cada seção da tela.
- **Não redesenhar**: preservar ordem de seções, ritmo editorial, SectionHeader de duas
  pesagens (sem barra), logos por contexto (vermelho=filme, verde=série, neutro=resto),
  CTA de filme `#D42A2E`, overlay escuro só em mídia/hero, footer claro.
- **Não inventar** conteúdo, notas, streaming, estados ou funcionalidades. Campo ausente
  é omitido (nunca “N/D”). Cinerie Score usa os 6 estados honestos.
- Preservar `data-comment-anchor`, `data-label`/`data-screen-label` e âncoras existentes
  ao reestruturar.
- Manter os 21 ad slots e 39 image slots nas posições especificadas (não criar/remover
  slot sem decisão registrada).

---

## 7. GATE 3 — F-03 (RESPONSIVIDADE, DURANTE A MIGRAÇÃO)

- Consolidar o comportamento mobile **por componente e breakpoint** enquanto migra cada
  tela — não deixar F-03 para depois nem limitar à tela 08.
- Breakpoints (de `design-tokens`/`responsive-matrix`): 390 · 480 · 768 · 1280 · 1440.
- Validar **todas as 18 telas** em **desktop, tablet e mobile**: colapso de grid,
  nav→mobile-navigation, touch ≥44px, sem overflow horizontal impeditivo, ordem de
  leitura preservada.
- Registrar resultado por tela/breakpoint em `responsive-matrix.json`.

---

## 8. GATE 4 — QA OBRIGATÓRIO (por lote e final)

Para cada lote e ao final:

- **HTML válido** (elementos fechados, atributos com aspas);
- **zero erro de console**;
- **zero asset quebrado** (image-slots/ad-slots resolvem ou mostram fallback honesto);
- **teclado e foco**: tab order lógico, foco visível, Escape/focus-trap em overlays;
- **WCAG 2.2 AA**: contraste (incl. #D42A2E 5.04, badges tinta escura, texto sobre
  scrim ≥4.5), sem seleção só por cor;
- **touch targets ≥44px**;
- **sem overflow impeditivo** em nenhum breakpoint;
- **comparação visual antes/depois** (screenshot da tela via `paginas/NN.html` como
  referência de layout vs. tela migrada) — layout equivalente, sem regressão;
- **contagem final de elementos inadequados = 0** (script: `span/div/h1/article` com
  `onClick` no canônico);
- **conteúdo e estrutura editorial preservados** (mesmas seções, mesma ordem, mesmo
  texto real).

Um verificador. Registrar `LOTE X: PASS/FAIL` e, no fim, `QA FINAL: PASS/FAIL`.

---

## 9. CHECKPOINTS INTERMEDIÁRIOS — FORMATO

Após cada lote, anexar a `44-MIGRATION-LOG.md` um bloco no formato:

```
### LOTE <A–F> — <data/hora>
- telas no lote: [IDs]
- status por tela: NN=MIGRATED | NN=IN_PROGRESS | NN=PENDING
- hash do canônico (antes → depois do lote): <hash> → <hash>
- bytes (antes → depois): <n> → <n>
- elementos inadequados restantes no canônico: <n> (meta final 0)
- ocorrências migradas neste lote: <n> (origem→destino resumido)
- responsivo validado: desktop/tablet/mobile = OK/ხPEND por tela
- QA do lote: PASS/FAIL (+ divergências e correções)
- divergências vs. page-specifications.json: [lista ou "nenhuma"]
```

E atualizar `migration-results.json` (uma entrada por tela):
`{ "screenId", "template", "occurrencesMigrated", "componentsApplied", "adSlots",
"imageSlots", "responsive": {"desktop","tablet","mobile"}, "qa", "status": "MIGRATED",
"divergences": [] }`.

---

## 10. CRITÉRIOS DE CONCLUSÃO

D4B só está concluída quando:

- PREFLIGHT = PASS e backup técnico existe;
- os 6 lotes estão `MIGRATED` (18/18 telas);
- elementos interativos inadequados no canônico = **0**;
- todas as interações apontam a componentes canônicos; sem link aninhado / foco duplicado
  / card com onClick;
- h1 permanece heading; article virou card com link principal;
- componentes D3B/D3C aplicados conforme `page-specifications.json` (sem redesenho);
- 21 ad slots e 39 image slots preservados;
- 18 telas validadas em desktop/tablet/mobile (F-03);
- QA FINAL = PASS (HTML válido, 0 console, 0 asset quebrado, AA, teclado/foco, touch,
  sem overflow, antes/depois sem regressão);
- conteúdo/estrutura editorial preservados;
- `44-MIGRATION-LOG.md`, `migration-results.json`, matrizes e CHECKPOINT atualizados.

---

## 11. PROIBIÇÕES

Não:
- criar telas autenticadas funcionais (13/14/15/16 mantêm só estrutura + estados);
- implementar backend, schema ou React;
- alterar GitHub, abrir PR, fazer merge;
- gerar ZIP;
- criar o prompt final do Claude Code;
- iniciar qualquer etapa posterior à D4B;
- redesenhar telas ou inventar conteúdo/nota/streaming/estado;
- editar o snapshot ou arquivos fora da lista 2.2.

---

## 12. SAÍDA FINAL (numérica)

1. hash + bytes inicial do canônico;
2. hash + bytes final do canônico;
3. snapshot intacto (sim/não);
4. backup técnico criado (caminho + hash);
5. telas migradas (obrigatório 18/18);
6. lotes concluídos (obrigatório 6/6);
7. elementos inadequados antes → depois (106 → 0);
8. contagem de origem preservada como rastreio (64 span · 40 div · 1 h1 · 1 article);
9. ocorrências por destino (LINK/BUTTON/ICON_BUTTON/TAB/TOGGLE/FILTER_CHIP/MENU_TRIGGER/CAROUSEL_CONTROL/DISCLOSURE/REMOVER);
10. componentes canônicos aplicados (contagem por família);
11. 40 botões aplicados;
12. ad slots preservados (obrigatório 21);
13. image slots preservados (obrigatório 39);
14. links aninhados restantes (obrigatório 0);
15. focos duplicados restantes (obrigatório 0);
16. cards com onClick restantes (obrigatório 0);
17. h1 ainda heading (sim/não); article como card com link principal (sim/não);
18. telas aprovadas em desktop / tablet / mobile (18/18 cada);
19. problemas de contraste / teclado / foco / overflow restantes;
20. resultado do QA por lote (A–F);
21. QA FINAL (PASS/FAIL);
22. divergências vs. page-specifications.json (lista ou nenhuma);
23. arquivos criados (`44-MIGRATION-LOG.md`, `migration-results.json`);
24. arquivos atualizados;
25. confirmação: nenhuma tela autenticada funcional criada;
26. confirmação: nenhum ZIP, nenhum React, GitHub intacto;
27. estado final do CHECKPOINT-CURRENT.md.

Próxima unidade: **D4C — REVISÃO FINAL E HANDOFF** (não iniciar).

PARE APÓS CONCLUIR D4B.
