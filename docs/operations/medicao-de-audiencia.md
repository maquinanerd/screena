# Medição de audiência — Cloudflare Web Analytics e Google Analytics 4

> Desde 30/10/2026. Código em `apps/web/src/lib/analytics-config.ts`,
> `apps/web/src/lib/analytics-consent.ts` e `apps/web/app/_components/consent-banner.tsx`.
> Texto legal correspondente: Política de Privacidade, versão `2026-10`
> (itens 2.3, 3, 5.6, 5.7, 6, 6.2, 6.3 e 7).

## O que cada ferramenta faz

| | Cloudflare Web Analytics | Google Analytics 4 |
|---|---|---|
| Cookie | nenhum; nada no navegador | `_ga`, `_ga_<ID>` (13 meses) |
| Quando carrega | em toda página | só depois do "Aceitar" no aviso de cookies |
| Base legal declarada | legítimo interesse | consentimento |
| O que entrega | visitas por página, origem, país, navegador, Core Web Vitals de campo | aquisição, engajamento, páginas, eventos |

## As duas variáveis (serviço `screen-app`, runtime)

| Variável | Formato | Sem ela |
|---|---|---|
| `CINERIE_GA4_MEASUREMENT_ID` | `G-` + letras/dígitos (fluxo de dados web do GA4) | sem aviso de cookies, sem botão no rodapé, sem script do Google |
| `CINERIE_CF_WEB_ANALYTICS_TOKEN` | 32 caracteres hexadecimais (site no Cloudflare Web Analytics) | sem beacon |

- São lidas **por requisição**. **Nunca** passe como build-arg: o release
  constrói sem env pública, e o valor do build nunca chegaria à produção.
- Só valem na **produção oficial** (`CINERIE_PUBLIC_SITE_URL=https://cinerie.com`
  e `NODE_ENV` de produção). Staging com a env copiada não envia nada.
- Valor malformado **desliga** a ferramenta. Para desligar de emergência, apague a
  variável e reinicie o serviço: não há rebuild.

## Ordem obrigatória do deploy

1. A versão `2026-10` da Política de Privacidade precisa estar **no ar antes** de
   qualquer uma das variáveis existir. Antes dela, o texto publicado dizia "Não há
   Google Analytics".
2. Se `CINERIE_PRIVACY_POLICY_VERSION` estiver definida no EasyPanel, ela sobe
   para `2026-10` no mesmo deploy (a versão exibida tem de bater com a gravada no
   aceite). Os usuários logados verão o pedido de novo aceite da Privacidade.
3. Só então defina as duas variáveis e reinicie o `screen-app`.

## Configuração da propriedade GA4 (o texto legal depende dela)

- Retenção de dados: **14 meses**.
- **Google Signals desligado**; personalização de anúncios desligada.
- Sem vínculo com Google Ads nem com AdSense.
- O código já força `allow_google_signals: false`,
  `allow_ad_personalization_signals: false` e `cookie_expires` de 13 meses.

Mudou algum desses números? Mude o texto da Política junto, suba a versão e rode
`tests/web/analytics-consent-gate.test.ts`, que confere código e texto.

## Como conferir em produção

- Página qualquer, aba anônima: o HTML tem `static.cloudflareinsights.com` e
  **não** tem `googletagmanager`. O aviso aparece embaixo.
- "Recusar": recarregue; nenhuma requisição a `google-analytics.com`.
- "Aceitar": surge o `gtag/js?id=G-…` e os cookies `_ga`. No GA4, o relatório
  "Tempo real" mostra a visita.
- Rodapé → "Preferências de cookies" → "Recusar": os cookies `_ga` somem.
