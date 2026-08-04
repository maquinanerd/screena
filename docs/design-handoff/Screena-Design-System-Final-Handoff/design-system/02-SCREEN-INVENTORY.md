# 02 — Screen Inventory

18 telas canônicas (`paginas/01`–`18`), todas renderizadas por uma máquina de estados de tela na classe `Component` do canônico `Screen Screens v4.dc.html`. Chrome (nav + footer) é compartilhado (`_compartilhado-chrome.html`). Contagens de elementos derivam da análise programática do canônico (ver `12-COMPONENT-INVENTORY.md`).

## Matriz de telas

| ID | Nome | Rota prevista | Contexto | Logo esperada | Logo encontrada | Hero | Publicidade | Prioridade |
|---|---|---|---|---|---|---|---|---|
| 01 | Switcher (overlay) | — | dev | n/a | n/a (overlay de protótipo, remover no build) | não | não | P3 |
| 02 | Home | `/pt` | neutro | branca-branco (hero) / preta-preto (scroll) | ✅ igual | sim | 4 | **P0** |
| 03 | Notícias | `/pt/noticias` | notícia | noticias (neutro) | ✅ igual | não | 6 | P1 |
| 04 | Categoria (Filmes/Séries) | `/pt/filmes`, `/pt/series` | filme \| série | cinema (red) \| serie (green) | ✅ igual | sim | 0 | **P0** |
| 05 | Artigo | `/pt/noticias/[slug]` | notícia | noticias (neutro) | ✅ igual | sim | 1 | P1 |
| 06 | Detalhe de Filme | `/pt/filmes/[slug]` | filme | cinema (red) | ✅ igual | não* | 2 | **P0** |
| 07 | Detalhe de Série | `/pt/series/[slug]` | série | serie (green) | ✅ igual | não* | 2 | **P0** |
| 08 | Série (mobile) | `/pt/series/[slug]` @390 | série | serie (green) | ✅ igual | não | 0 | P1 |
| 09 | Pessoa | `/pt/pessoas/[slug]` | pessoa | pessoas (neutro) | ✅ igual | sim | 1 | P1 |
| 10 | Onde assistir (Browse) | `/pt/onde-assistir` | neutro | branca-branco/preta-preto | ✅ igual | sim | 2 | P1 |
| 11 | Explorar (Discover) | `/pt/explorar` | neutro | preta-preto | ✅ igual | não | 1 | P1 |
| 12 | Mais aguardados | `/pt/em-breve` | neutro/misto | preta-preto | ✅ igual | não | 0 | P2 |
| 13 | Configurações | `/pt/configuracoes` | neutro | preta-preto | ✅ igual | não | 0 | P1 |
| 14 | Importar dados | `/pt/configuracoes/dados` | neutro | preta-preto | ✅ igual | não | 0 | P2 |
| 15 | Listas | `/pt/listas` | neutro/misto | preta-preto | ✅ igual | não | 3 | P1 |
| 16 | Entrar | `/pt/entrar` | neutro | preta-preto | ✅ igual | não | 1 | P1 |
| 17 | Anúncio · pop-up | — | publicidade | neutro | ✅ igual | não | 1 | P3 |
| 18 | Anúncio · tela cheia | — | publicidade | neutro | ✅ igual | não | 1 | P3 |

\* Detalhe de Filme/Série: hero grande foi **removido** por decisão do usuário em sessão anterior (top-info-bar branca em vez de hero cover). A nav é sólida nessas telas.

## Observações
- **Logo esperada = encontrada em 100% das telas.** A seleção contextual (`logoUnder`) já respeita a regra: vermelho só em filme, verde só em série, neutro em pessoas/notícias/institucional/misto. Nenhuma correção necessária.
- **Contextos duais:** a tela 04 (Categoria) é o mesmo template para filme e série, alternando dataset + acento — logo muda corretamente por branch (`catRed`/`catGreen`).
- **Telas P0** (identidade/uso crítico): Home, Categoria, Detalhe de Filme, Detalhe de Série.
- **Ad screens (17/18)** e **switcher (01)** não são telas de produto plenas — P3.
- Total de rotas/flags distintas no código: **20**; blocos `<sc-if>`: 28; loops `<sc-for>`: 81.
