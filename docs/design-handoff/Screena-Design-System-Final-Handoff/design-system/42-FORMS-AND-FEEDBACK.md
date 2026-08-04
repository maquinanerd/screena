# 42 — Forms & Feedback (D3C)

Famílias **novas** (0 controles de formulário e 0 estados de feedback no canônico). Definidas como componentes reutilizáveis; **não** migradas às telas.

## Formulários
Elemento nativo real (`<input>/<select>/<textarea>/<button>`). **Label persistente acima do campo — nunca só placeholder.**

| Componente | Estados | Regras |
|---|---|---|
| Field (Label+Input+Description+Error) | default · hover · focus · filled · disabled · readonly · invalid · success · loading · autofill | label persistente; `aria-invalid`; erro em **texto** (não só cor); toque ≥44 |
| PasswordInput | default · focus · invalid · disabled | toggle mostrar/ocultar com `aria-label`; regra em texto |
| SearchInput | empty · typing · loading · clear · disabled | Escape limpa; Enter envia |
| Textarea | default · focus · filled · invalid · disabled | resize vertical |
| Select | default · focus · open · disabled · invalid | teclado nativo |
| Checkbox | unchecked · checked · indeterminate · focus · disabled | 44px; não só cor |
| Radio | unselected · selected · focus · disabled | `radiogroup` + setas |
| Switch | off · on · focus · disabled | `role="switch"` + `aria-checked` |
| FormActions | default · loading · disabled | Button canônico; loading não muda largura |

**Proibições:** placeholder como único label; erro sinalizado só por cor; campo obrigatório sem indicação textual.

## Feedback & Overlays
| Componente | Foco/Teclado | Nota |
|---|---|---|
| Alert (info/success/warning/error) | — | `role=status/alert`; ícone + texto |
| Toast | `aria-live=polite` | transitório; ação desfazer; respeita reduced-motion |
| Modal | **foco preso · Escape · retorno de foco** | `aria-modal`; overlay fecha |
| Drawer | foco preso · Escape · safe-area | reduced-motion |
| Dropdown | `aria-expanded/controls` · setas · Escape | menu de ações |
| Tooltip | acessível por foco | sem ação essencial só no hover |
| Popover | foco gerenciado · Escape | conteúdo rico |
| ConfirmationDialog | foco no botão seguro | consequência explícita (destrutivo) |
| EmptyState | — | mensagem + ação; **sem cards fantasma** |
| ErrorState | — | mensagem + “tentar de novo” |
| LoadingState / Skeleton | `aria-busy` / `aria-hidden` | respeita reduced-motion |
| OfflineState | — | aviso de sem conexão |

## Newsletter (honestidade)
Estados idle · submitting · **success = “confirme seu e-mail”** (double opt-in) · error. **Nunca** “inscrito!” sem confirmação real; nota de privacidade obrigatória; sem marketing genérico.
