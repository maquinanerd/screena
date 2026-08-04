# 32 — Initial Audit Findings

Auditoria inicial (unidade D2) do canônico `Screen Screens v4.dc.html`. **Nenhuma correção de componente foi feita** (exceto o já resolvido: rebrand + arquivamento de logos órfãs). Achados classificados P0–P3. Dados quantitativos em `component-inventory.json`; registro estruturado em `inconsistency-register.json`.

## P0 — impeditivo (marca/uso/render)
**Nenhum P0 técnico em aberto.**
- Marca: zero ocorrências de marca antiga em arquivos ativos (ver `38`). ✅
- Render: canônico carrega sem erros de console. ✅
- Logos: seleção contextual correta em 100% das telas. ✅
- Assets: os 10 SVGs órfãos não conformes foram **arquivados** em `uploads/LEGACY-NAO-USAR/` (não referenciados; sem impacto de render). ✅

## P1 — inconsistência importante
- **F-01 · Botões sem família única.** 40 botões, **32 assinaturas** distintas. O primário vermelho `#F0443E` aparece com ≥5 combinações de padding/radius; o escuro `#101010` e o branco variam padding e radius (0 / 8px / 999px) sem regra. Classe: `INCONSISTENTE` / `ESTILO_LOCAL_INDEVIDO`. Correção: definir família Button (D3) e migrar (D-telas).
- **F-02 · Cinerie Score sem estado vazio.** 2 ocorrências (Detalhe Filme "8.2", Detalhe Série "8.6"), ambas com nota **mock fixa**. Não há estado "sem nota / aguardando avaliação / não autorizado". Risco de UI desonesta (mostra número mesmo sem dado real). Classe: `CONFLITO_DE_UI_HONESTA`. Correção: desenhar estados de omissão (D3/D-estados).
- **F-03 · Telas P0 sem mobile canônico.** Só a tela **08 (Série mobile)** tem composição mobile explícita. Home (02), Categoria (04), Detalhe Filme (06), Detalhe Série (07) são desktop-first (container 1280, sem media queries). Classe: `SEM_RESPONSIVIDADE`. Correção: mobile canônico (D-responsivo).
- **F-04 · Estados interativos ausentes.** A maioria dos componentes não declara `hover`/`focus-visible`/`loading`/`skeleton`/`empty`/`error` explícitos (protótipo usa estilos estáticos). Acessibilidade: foco visível ausente em `<span onClick>` (106 handlers não são `<button>`/`<a>` reais). Classe: `SEM_ESTADO` / `SEM_ACESSIBILIDADE`. Correção: D-estados + D-acessibilidade.

## P2 — inconsistência visual relevante (tokenização)
- **F-05 · 41 tamanhos de fonte.** Meios-pixels redundantes (`8.5/9.5/10.5/11.5/12.5/13.5/14.5px`) inflam a escala. Classe: `INCONSISTENTE`. Correção: escala tipográfica tokenizada (D3), sem normalizar ainda.
- **F-06 · 32 valores de gap.** `7/8/9/10px` coexistem massivamente; faltam degraus canônicos. Classe: `INCONSISTENTE`.
- **F-07 · 19 sombras.** 1 dominante (`0 3px 14px rgba(20,18,14,0.05)`, 28×) + 18 quase-únicas. Consolidar em ~5 tokens (card/dropdown/modal/imagem-hero/overlay).
- **F-08 · 176 cores hex.** ~15 são sistema (corretas), ~40 são marcas externas legítimas (streaming/rating/categoria de notícia — **não** normalizar), e ~120 são cauda de quase-duplicatas (near-blacks de scrim/gradiente de hero, cinzas redundantes tipo `#6E6E6E`/`#6E6A61`/`#6b6b6b`). Classe: `INCONSISTENTE` (só a cauda). Correção: tokenizar sistema + documentar externas como exceção.
- **F-09 · Radius do primário misto (0/8px/999px).** Ligado a F-01.

## P3 — dívida menor / documentável
- **F-10 · Pesos 900 (2×) e 400 (1×)** quase não usados — candidatos a remoção da escala.
- **F-11 · Radius 12px (1×) e 14px (2×)** — outliers dentro do conjunto sancionado; manter (CLAUDE.md proíbe unificar raios).
- **F-12 · Switcher (tela 01)** — overlay de protótipo, remover no build.
- **F-13 · Ad screens (17/18)** — comportamento correto; baixa prioridade.

## Regra de radius (não é achado — é restrição)
Os 9 valores de radius (2/5/6/8/10/12/14px, 50%, 999px) são o **conjunto canônico sancionado** por `CLAUDE.md`. **NÃO** classificar como inconsistência a corrigir nem unificar — apenas os *outliers de uso* (F-09, F-11) entram como observação.

## Contagem-resumo
P0 em aberto: **0** · P1: **4** (F-01…F-04) · P2: **5** (F-05…F-09) · P3: **4** (F-10…F-13).
