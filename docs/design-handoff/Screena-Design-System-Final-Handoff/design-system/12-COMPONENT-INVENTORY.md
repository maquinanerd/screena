# 12 — Component Inventory

Catálogo dos componentes visuais reais do canônico `Screen Screens v4.dc.html`, com contagens obtidas por análise programática (regex sobre estilos inline). Como o design é 100% inline-styled (sem classes CSS), "componente" aqui = padrão visual recorrente, não uma classe/instância nomeada.

## Resumo quantitativo

| Métrica | Valor | Observação |
|---|---|---|
| Famílias tipográficas | **1** (`'Montserrat',sans-serif`, 682 usos) | ✅ nenhuma outra fonte |
| Pesos de fonte | 9 (800·221, 700·135, 600·64, 300·32, 650·15, 750·12, 500·5, 900·2, 400·1) | escala definida; 900/400 quase não usados |
| Tamanhos de fonte | **41 distintos** | ⚠️ sprawl (ver findings) |
| Valores de radius | 9 (10,8,50%,999,6,2,5,14,12px) | dentro do conjunto sancionado (CLAUDE.md) |
| Sombras | **19 distintas** | ⚠️ 1 dominante + 18 quase-únicas |
| Valores de gap | **32 distintos** | ⚠️ sprawl |
| Cores hex | **176 distintas** | ⚠️ ~15 sistema + ~40 externas + ~120 cauda |
| Elementos clicáveis | onClick 106 · cursor:pointer 196 | |
| Botões (bg+padding+cursor) | 40 instâncias · **32 assinaturas** | ⚠️ inconsistência-chave (ver §Botões) |
| Pôsteres 2:3 | 14 | |
| Cards 16:9 | 6 | |
| Superfícies borda `#E3DED6` | 68 | padrão de card/box claro consistente |

## Famílias de componentes

### Branding
- **Logo contextual** — 1 componente, 10 slots (`5a`–`5j`), seleção por `logoTone × logoUnder`. ✅ conforme. Ver `37-LOGO-ASSET-MAPPING.md`.

### Navegação (compartilhada — `_compartilhado-chrome.html`)
- **Header/nav fixa** (1) — estados transparente (sobre hero) + sólida (scroll >80px). Componente único, reutilizado em todas as telas. ✅ consistente por ser compartilhado.
- **Footer** (1) — newsletter + 4 colunas + barra legal. Compartilhado. ✅
- **Busca, avatar, botão Entrar** — dentro do header.

### Ações / Botões — ⚠️ INCONSISTENTE
40 elementos botão-like, **32 assinaturas visuais distintas**. Agrupando por função:
- **Primário vermelho** (`#F0443E`): ao menos 5 variações de padding/radius — `13px 28px/rad8`, `11px 20px/rad8`, `13px/rad8`, `12px/rad0`, `12px 26px/rad0`.
- **Escuro** (`#101010`): padding `12px18px`, `8px16px`, `9px18px`, `12px`, `11px20px`, `12px26px` × radius `0`/`8px`/`999px` — muito divergente.
- **Branco/outline** (`#FFFFFF`): padding `14px20px`, `12px`, `7px20px`, `7px12px`, `9px12px` × radius `8px`/`0`/`999px`.
- **Chips/tabs** (data-driven `{{ t.bg }}`, `{{ ch.bg }}`): família à parte, aceitável por serem estados de seleção.
- **Verde série** (`#7FA56F`): `14px/rad0`.
Não há uma família Button única — cada tela improvisou padding/radius. **Consolidar em D3.**

### Cards
- **Pôster 2:3** (14) — Top10/streaming/relacionados. Estrutura recorrente (badge tipo + nota estrela).
- **Card 16:9** (6) — trailers/em breve.
- **Linha de bilheteria** — rank + mini-pôster + métrica.
- **Card de notícia** — featured (grande) + grid (2×2), blocos retos.
- **Superfície clara** (68 com borda `#E3DED6`) — boxes de ficha, avaliação, bilheteria. Padrão consistente (fundo claro, nunca preto — conforme CLAUDE.md).

### Superfícies / conteúdo
- **Cinerie Score box** — nota grande + label uppercase (movie/series detail). ⚠️ sem estado vazio (dívida).
- **Badges** (tipo Filme/Série, rank, plataforma, categoria de notícia), **eyebrows**, **metadata**, **estrelas** (`#F5C84B`).

### Formulários
- **Input de newsletter** (footer), **inputs de settings**, **busca**. Poucos; a padronizar em D3.

### Feedback / publicidade
- **AdSlot** (`dc-import name="AdSlot"`) — 1 componente real reutilizável, 4 variantes (leaderboard/billboard/rectangle/skyscraper). ✅ já componentizado.
- **Modais/empty/loading/skeleton** — em grande parte **ausentes** (ver `32-INITIAL-AUDIT-FINDINGS.md` §Estados).
