# 03 — Design Principles

Princípios concretos e verificáveis da Cinerie. Cada um: regra · motivo · certo · errado · validação · componentes afetados.

## 3.1 Editorial antes de aplicativo
- **Regra:** a superfície pública se comporta como portal editorial (revista de cinema/TV), não dashboard.
- **Motivo:** o produto é base de dados + mídia; densidade com hierarquia, não painéis de métricas.
- **Certo:** home com hero cinematográfico + seções curadas alternando fundo claro/off-white. **Errado:** grid de "cards de KPI", sidebars de app, widgets.
- **Validação:** nenhuma tela pública com layout de dashboard; hero e seções editoriais presentes.
- **Afeta:** home, categoria, notícias, artigo.

## 3.2 Densidade organizada
- **Regra:** pode haver muito conteúdo desde que exista hierarquia clara (tamanho, peso, espaço).
- **Certo:** Top 10 com 4 grandes + 6 pequenos. **Errado:** 10 cards idênticos sem foco.
- **Validação:** cada seção tem 1 título + no máximo 1 ação; ritmo vertical de 56px.

## 3.3 Hierarquia por tipografia, espaço e composição
- **Regra:** hierarquia vem de peso (800/700/600), tamanho e espaço — não de excesso de caixas/sombras/cores.
- **Certo:** título 800 + meta 600 cinza. **Errado:** tudo em caixa com borda+sombra para "separar".
- **Validação:** sombra só onde há elevação real (ver `09`); ≤7 tokens de sombra.

## 3.4 Cor semântica
- **Regra:** vermelho=filme, verde=série, amarelo=informação/nota, neutros=estrutura. Ver `06`.
- **Certo:** badge FILME vermelho, SÉRIE verde. **Errado:** vermelho decorativo numa página mista, verde num botão genérico.
- **Validação:** `logoUnder`/badges só usam vermelho/verde em contexto exclusivo; auditoria de cor (`06`).
- **Afeta:** logo, badges, CTAs, barras de acento.

## 3.5 Interface clara
- **Regra:** sem seção escura estrutural; escuro só em hero/faixa de mídia/newsletter/anúncio. Logo branco só sobre imagem/contraste inevitável.
- **Certo:** ficha de título em card branco `#FFFFFF`. **Errado:** card de conteúdo com fundo preto sólido.
- **Validação:** nenhum card embutido com fundo escuro (regra CLAUDE.md); 68 superfícies claras confirmadas em D2.

## 3.6 UI honesta
- **Regra:** nenhum dado, nota, botão ou disponibilidade falsos. Sem score fictício.
- **Certo:** omitir Cinerie Score quando não há dado. **Errado:** mostrar "8.2" mock sempre (dívida F-02).
- **Validação:** cada componente de dado tem estado vazio/indisponível (a desenhar em D3C/estados).

## 3.7 Consistência antes de variedade
- **Regra:** elementos equivalentes usam a mesma fundação (token/componente).
- **Certo:** todo botão primário = mesma altura/padding/radius. **Errado:** 32 assinaturas de botão (F-01).
- **Validação:** matriz de migração (D4) reduz assinaturas; auditoria de tokens.

## 3.8 Exceções documentadas
- **Regra:** nenhum valor local recorrente novo sem token; exceção precisa de ID.
- **Certo:** cor de streaming = exceção `external` documentada (DD-11). **Errado:** hex solto novo repetido em 5 telas.
- **Validação:** governança de tokens (`05`); mapa de consolidação (`39`).

## 3.9 Responsividade composicional
- **Regra:** mobile não é desktop reduzido — é composição própria (ordem, colunas, navegação).
- **Certo:** tela 08 (série mobile) recomposta. **Errado:** só encolher o container 1280 (F-03).
- **Validação:** telas P0 com mobile canônico (unidade responsividade).

## 3.10 Acessibilidade estrutural
- **Regra:** contraste AA, foco visível, toque ≥44px, semântica (`button`/`a`/headings) fazem parte do design.
- **Certo:** CTA como `<button>` com foco visível. **Errado:** 106 `<span onClick>` sem foco/teclado (F-04).
- **Validação:** matriz de contraste (`06`); auditoria de acessibilidade (unidade própria).

## 3.11 Cabeçalho de seção da home é a referência
- **Regra:** o cabeçalho de seção canônico é o da **página início**: duas pesagens em caixa alta (1ª palavra 800–900 + resto 300–400, 26px, -0.01em). CTA da seção = pill "Ver tudo" contornado; toggle = pill Filmes/Séries.
- **Motivo:** a home define a identidade editorial; as demais telas seguem esse cabeçalho, não variações locais.
- **Certo:** **DESTAQUES** de hoje + "Ver tudo". **Errado:** título de seção em peso único sem caixa alta, ou barra de acento colorida ad-hoc por tela.
- **Validação:** `07` (section-header); toda seção de listagem usa o mesmo cabeçalho.
- **Afeta:** home, categoria, notícias, browse, discover — todos os cabeçalhos de seção.
