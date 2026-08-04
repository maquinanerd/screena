# 06 — Color System

Paleta canônica **derivada** das 176 cores reais da D2 (não inventada). Valores e status em `design-tokens.json → color`. Regra de origem: `preserved` = já em uso, mantido; `canonical` = valor de referência que consolida quase-duplicatas; `exception` = fora do sistema, documentado.

## Consolidação (176 → sistema + exceções)
- **~15 cores de núcleo** (dominantes, corretas): `#101010`(240), `#6E6E6E`(125), `#E3DED6`(108), `#FFFFFF`(106), `#F0443E`(87), `#9A958C`(74), `#12100E`(69), `#7FA56F`(63)…
- **~40 cores externas** (streaming/rating/categoria de notícia) → **exceções** (DD-11), não tokens de sistema.
- **~120 cores de cauda** → quase-duplicatas de near-black (scrims/gradientes de hero) e cinzas redundantes; consolidadas por alias nos tokens.

## Famílias

### Background
| Token | Hex | Uso | Proibido |
|---|---|---|---|
| background.page | `#FDFDFD` | fundo global | — |
| background.surface | `#FFFFFF` | cards, boxes, fichas | — |
| background.subtle | `#F6F3EE` | faixa off-white de seção | como cor de texto |
| background.muted | `#F1EDE6` | superfície secundária | — |
| background.skeleton | `#EAE4D9` | placeholder de load | conteúdo real |
| background.scrim | `rgba(0,0,0,0.5)` | sobre imagem p/ legibilidade | como fundo de card |

**Regra CLAUDE.md:** cards embutidos **nunca** com fundo escuro. Escuro só em hero/mídia/newsletter/anúncio.

### Text (com contraste WCAG verificado)
| Token | Hex | Contraste (sobre page/surface) | Uso |
|---|---|---|---|
| text.primary | `#101010` | **18.7 / 19.0 AA** | títulos, corpo forte |
| text.secondary | `#6E6E6E` | **5.0 AA** | metadados, apoio |
| text.muted | `#9A958C` | **2.9 FALHA AA** | ⚠️ só texto grande/decorativo, NUNCA corpo (DD-02) |
| text.disabled | `#B7B0A5` | — | desabilitado |
| text.inverse | `#FFFFFF` | — | sobre hero/scrim |
| text.link | `#8A1E1A` | **9.2 AA** | link em texto (filme); série usa `#395C42` (7.5 AA) |

### Accent (semântica de marca)
| Token | Hex | Regra de contraste |
|---|---|---|
| accent.movie | `#F0443E` | texto branco só **≥18px/bold** (3.75 AA-large) — DD-05 |
| accent.movie-hover / -pressed | `#E0392F` / `#C7322A` | — |
| accent.movie-dark | `#8A1E1A` | links/scrims de filme (9.2 AA) |
| accent.series | `#7FA56F` | ⚠️ **nunca texto branco** (2.79 FALHA) — usar texto escuro ou `series-dark` — DD-03 |
| accent.series-dark | `#395C42` | texto/links de série (7.5 AA) |
| accent.editorial | `#F5C518` | ⚠️ **sempre texto escuro** (branco = 1.63 FALHA; preto = 11.67 AA) — DD-04 |

**Marca:** filme→vermelho, série→verde, **só em contexto exclusivo**. Página neutra/mista não escolhe vermelho/verde. Amarelo é informação/nota — não substitui `state.warning` sem decisão.

### State
`success #1F8A5B` · `warning #B26A00` (texto; `#E8A31E` só ícone/fundo) · `danger #C7382F` · `information #2A6FDB` · `disabled #B7B0A5` · `focus #101010`.
Vermelho/verde de estado **não** se confundem com accent de marca: estado sempre acompanhado de ícone/texto (não depender só de cor — 3.10).

### Media
`rating-gold #F5C84B` (só estrela/nota) · `poster-fallback` gradiente placeholder (trocar por `<img>` real) · `scrim rgba(0,0,0,0.5)` · `caption-bg rgba(0,0,0,0.6)`.

### Exceções (NÃO tokenizar como sistema)
- **Streaming/rating:** Netflix `#E50914`, Prime `#1399FF`, Max `#002BE7`, Rotten `#FA320A`/`#3CB54A`, TMDB `#0D253F`/`#01B4E4`, Crunchyroll `#F47521`, IMDb `#F5C518`.
- **Categoria de notícia:** Prêmios `#C9A24B`, Entrevista `#9A57C9`, Streaming `#2A6FDB`.
- Regra: cores de logo/marca de terceiros **não** alimentam controles genéricos (DD-11).

## Matriz de contraste (WCAG 2.1, verificada em D3A)
| Par | Ratio | Resultado |
|---|---|---|
| #101010 / #FDFDFD | 18.71 | AA |
| #101010 / #FFFFFF | 19.03 | AA |
| #6E6E6E / #FDFDFD | 5.01 | AA |
| #6E6E6E / #F6F3EE | 4.61 | AA |
| #9A958C / #FDFDFD | 2.93 | **FALHA** |
| #FFFFFF / #F0443E | 3.75 | AA-large |
| #FFFFFF / #7FA56F | 2.79 | **FALHA** |
| #395C42 / #FFFFFF | 7.54 | AA |
| #8A1E1A / #FFFFFF | 9.21 | AA |
| #101010 / #F5C518 | 11.67 | AA |
| #FFFFFF / #F5C518 | 1.63 | **FALHA** |

**Reprovados (3):** muted como corpo, branco/verde, branco/amarelo — regras DD-02/03/04 endereçam cada um.

## Dispositivos da home (referência de fundação)
Seguindo a página **início** como referência:
- **Banda escura estabelecida** (`#0E0E10`): a seção "Popular essa semana" da home roda sobre banda escura — é um bloco escuro **sancionado** (como hero/mídia/newsletter), não uma seção-dashboard. Cards embutidos nela continuam com pôster/imagem (nunca card de conteúdo com fundo preto sólido).
- **Toggle pill Filmes/Séries** (fundo `#EFEBE3`, pill ativo branco + `shadow-sticky-header`) e **CTA "Ver tudo"** (pill contornado: `border #E3DED6`/`rgba(255,255,255,0.28)` no escuro) são os controles canônicos de seção — formalizados como componentes em D3B.
