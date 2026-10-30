# OpaPreço Ads na Cinerie

Ofertas afiliadas (Shopee) servidas pelo ad server da OpaPreço. Substituiu o
Google AdSense em 2026-10-30: a metatag de verificação, o `/ads.txt` e o slot
antigo saíram (guarda: `tests/web/sem-adsense.test.ts`).

| Pasta | O que é |
|---|---|
| `spec/` | especificação de produção v1 e tokens (cópia do handoff) |
| `contracts/` | schemas da resposta do ad server e da oferta, CHANGELOG |
| `fixtures/` | ofertas de teste, incluindo `mustNotRender` e `mustHideDiscount` |
| `DECISIONS.md` | decisões e divergências, com as da implementação na Cinerie |

## Onde está no código

- `apps/web/src/lib/opapreco/` — puro: registro de slots (`slots.ts`), validação do contrato (`normalize.ts`), formatação (`format.ts`), ambiente (`config.ts`), fixtures de QA (`fixtures.ts`).
- `apps/web/app/_components/opapreco/` — `<AdSlot id tags className>` (servidor), o slot do navegador e os 6 componentes.
- `apps/web/app/api/opapreco/{ad,img,track}` — as rotas de mesma origem.
- `services/opapreco` (`@screena/opapreco`) — o único código que faz HTTP para a OpaPreço.

## Como ligar (runtime, nunca build-arg; nada é `NEXT_PUBLIC_`)

| Variável | Valor | Efeito |
|---|---|---|
| `OPAPRECO_AD_SERVER_URL` | `https://…` | origem do ad server (`GET {url}/v1/ad`) |
| `OPAPRECO_PUBLISHER_ID` | id do publisher | vai em `publisher=` |
| `OPAPRECO_IMAGE_HOSTS` | `a.com,*.b.com` | hosts de imagem que o proxy aceita; fora da lista, ícone neutro |
| `OPAPRECO_MODE` | `off` \| `fixtures` | `off` desliga tudo (emergência); `fixtures` serve as ofertas fictícias do canônico para QA e é **recusado** quando `CINERIE_PUBLIC_SITE_URL=https://cinerie.com` |

Sem `OPAPRECO_AD_SERVER_URL` + `OPAPRECO_PUBLISHER_ID` (e sem `fixtures`), nada
renderiza: as páginas saem como antes e as rotas respondem 204/404.

Antes de ligar em produção: o ad server precisa aceitar os ids de slot da
Cinerie (CHANGELOG, "Pendente").
