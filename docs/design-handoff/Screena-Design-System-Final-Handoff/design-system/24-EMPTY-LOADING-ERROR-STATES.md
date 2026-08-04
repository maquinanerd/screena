# 24 — Empty / Loading / Error States (D3C)

Todo componente de conteúdo trata **quatro caminhos além do ideal**: loading, empty, error, partialData. “Não desenhar só o happy path.”

## Padrões
- **Loading:** Skeleton com a forma do conteúdo (poster + linhas), shimmer que **respeita `prefers-reduced-motion`** (vira estático). `aria-busy`.
- **Empty:** mensagem digna + ação sugerida. **Sem cards fantasma, sem dado falso.** Ex.: “Sua watchlist está vazia”.
- **Error:** mensagem clara + “tentar de novo”. Ex.: “Não foi possível carregar as recomendações”.
- **Partial:** renderiza o que existe; **campo ausente é omitido** (nunca “N/D”).

## Cinerie Score — 6 estados (lacuna F-02 resolvida)
| Estado | Quando | Renderização |
|---|---|---|
| available | há valor calculado | selo com número 0–100 + rótulo “Cinerie Score” |
| insufficient_data | < 5 avaliações | “Dados insuficientes” (sem número) |
| not_calculated | ainda não processado | “Ainda não calculado” |
| unavailable | indisponível | “Indisponível” |
| blocked | licença/política | ícone de cadeado + “Bloqueado” |
| omitted | não se aplica | **componente não renderiza** |

**Proibido:** nota mock · valor fixo · **zero como ausência** · “em breve” sem contrato · score inventado.

## Streaming
region-unavailable (sem oferta na região) · no-data (sem informação) — **nenhum provedor sugerido por inferência**; sempre com data de atualização e fonte.

## Episódios
future (sem still/sinopse) · spoiler-hidden (revelável por ação) · partial (código+título mínimos).
