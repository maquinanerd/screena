# 20 — Accessibility (componentes D3B)

Meta: **WCAG 2.2 AA**. Evidência de contraste calculada (não por percepção). Migração às telas = D4.

## Matriz de contraste (Button/Link/Badge — verificada)
| Elemento | Fundo | Texto | Ratio | Resultado |
|---|---|---|---|---|
| Button primary | #101010 | #fff | 19.0 | AA |
| Button secondary | #fff | #101010 | 19.0 | AA |
| Button destructive | #C7382F | #fff | 5.2 | AA |
| Button editorial | #F5C518 | #101010 | 11.67 | AA |
| Button series (dark) | #395C42 | #fff | 7.54 | AA |
| Button movie (fill) | #D42A2E | #fff | 5.04 | AA (texto normal) |
| Movie accent (badge Filme) | #F0443E | #12100E | 4.98 | AA (tinta escura) |
| Button series (claro) | #7FA56F | #fff | 2.79 | **FAIL** → proibido |
| Link inline | #fff | #8A1E1A | 9.2 | AA |
| text.muted como corpo | #fff | #9A958C | 2.9 | **FAIL** → só texto grande |

> **Texto grande (WCAG 2.2):** ≥24px normal **ou** ≥18,66px (14pt) **bold** — só então vale o limite 3:1. Movie #F0443E + branco (3.75) é válido apenas nesse tamanho; em botão/label use o fill **#D42A2E** (≥4.5:1) ou tinta escura. Peso 800 em 15px **não** qualifica como texto grande.

## Matriz teclado/foco por componente
| Componente | Teclado | Foco | Nome acessível | Resultado |
|---|---|---|---|---|
| Button | Enter/Space ativa | ring 2px | label ou aria-label | PASS |
| Link | Enter ativa | ring | texto/aria-label | PASS |
| IconButton | Enter/Space | ring | **aria-label obrigatório** | PASS |
| Tabs | setas + roving tabindex | ring | aria-selected | PASS |
| ToggleSegmented | setas/Space | ring | radiogroup | PASS |
| MobileNav | Tab preso + Escape | ring | aria-expanded/controls | PASS |
| Search | Enter submit, Escape limpa | ring | label | PASS |
| Breadcrumb | Tab | ring | aria-current no atual | PASS |
| Pagination | Tab/Enter | ring | aria-current=page | PASS |

## Regras transversais
- **Nunca** `outline:none` sem substituto; foco = `FocusRing` (2px `#101010` + offset).
- **Não depender só de cor:** estado ativo/selecionado sempre com peso, sublinhado, indicador ou ícone.
- Toque ≥ **44×44** (control md); alvos textuais com exceção documentada.
- Ícone decorativo `aria-hidden`; funcional com nome acessível.
- Vermelho/verde de marca distinguíveis também por texto/badge (não só matiz).
- `prefers-reduced-motion`: desativar slide/shimmer.
- Hierarquia de headings: `h1` único por tela → `h2` seção (SectionHeader) → `h3` cards.

## Pendências (não-D3B)
Auditoria de acessibilidade **nas telas** (tabulação real, landmarks, alt text de imagens) ocorre na migração/unidade de acessibilidade — aqui validamos os **componentes**, não as 18 telas.


---

# D3C — Acessibilidade de conteúdo/forms/feedback

## Contraste (verificado)
| Elemento | Fundo | Texto | Ratio | Resultado |
|---|---|---|---|---|
| CTA movie (Ver detalhes/Watch) | #D42A2E | #fff | 5.04 | AA |
| Badge Filme | #F0443E | #12100E | 4.98 | AA |
| Badge Série | #7FA56F | #12100E | 6.67 | AA |
| CinerieScore | #fff | #101010 | 19.0 | AA |
| News/Trailer overlay | scrim escuro (base) | #fff | ≥ 7 | AA |
| Field label / valor | #fff | #101010 | 19.0 | AA |
| Field error | #fff | #8A1E1A | 9.2 | AA |
| Chip streaming (assinatura) | #EDF2EA | #395C42 | 7.3 | AA |

## Teclado / foco por componente
| Componente | Teclado | Foco | Nome acessível | Resultado |
|---|---|---|---|---|
| Card (link principal) | Tab/Enter no título | ring | título `<a>` | PASS |
| ContentRail | setas/Tab; controles | ring | prev/next aria-label | PASS |
| Field/Input/Select/Textarea | Tab/edição nativa | ring 2px | **label persistente** | PASS |
| Checkbox/Radio/Switch | Space/setas | ring | label; role switch/radiogroup | PASS |
| Modal/Drawer | **foco preso + Escape + retorno** | ring | aria-modal/labelledby | PASS |
| Dropdown/Popover | setas/Escape | ring | aria-expanded/controls | PASS |
| CinerieScore | — (não interativo) | — | estado em texto | PASS |
| MediaImage | — | — | `alt` (vazio se decorativo) | PASS |

## Regras D3C
- **Seleção/estado nunca só por cor** (badge tem texto; status tem ícone/ponto; erro tem texto).
- **Card não é `<div onClick>`**: link principal ou stretched-link acessível (sem links aninhados/foco duplicado).
- **Placeholder ≠ label**: todo campo tem label persistente.
- Overlay de mídia com scrim garante ≥4.5 no texto branco.
- Skeleton/shimmer e slides respeitam `prefers-reduced-motion`.
- `h1` único (hero/artigo) → `h2` seção → `h3` cards.
