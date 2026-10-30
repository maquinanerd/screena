# Medição de audiência — Cloudflare Web Analytics e Google Analytics 4

> GA4 desde 30/10/2026; Cloudflare desde jul/2026, pela borda. Código em `apps/web/src/lib/analytics-config.ts`,
> `apps/web/src/lib/analytics-consent.ts` e `apps/web/app/_components/consent-banner.tsx`.
> Texto legal correspondente: Política de Privacidade, versão `2026-10`
> (itens 2.3, 3, 5.6, 5.7, 6, 6.2, 6.3 e 7).

## O que cada ferramenta faz

| | Cloudflare Web Analytics | Google Analytics 4 |
|---|---|---|
| Cookie | nenhum; nada no navegador | `_ga`, `_ga_<ID>` (13 meses) |
| Quando carrega | em toda página | só depois do "Aceitar" no aviso de cookies |
| Quem carrega | **a borda da Cloudflare** (injeção automática) | o app, pelo aviso de cookies |
| Base legal declarada | legítimo interesse | consentimento |
| O que entrega | visitas por página, origem, país, navegador, Core Web Vitals de campo | aquisição, engajamento, páginas, eventos |

## Cloudflare Web Analytics: já está no ar, e fica na borda

Medido em 30/10/2026: o site `cinerie.com` existe no Web Analytics da conta
Cloudflare desde **julho de 2026**, em **configuração automática**. A borda
injeta `static.cloudflareinsights.com/beacon.min.js` em toda página, e ele envia
para `cinerie.com/cdn-cgi/rum`. Eram ~4,8 mil visualizações por dia.

Até a Política `2026-10`, o texto publicado dizia que não havia nenhum script de
medição, e havia este. A `2026-10` passa a declará-lo (itens 5.6 e 6.2).

**O app não monta um segundo beacon**, de propósito: contaria cada visita duas
vezes. A guarda `tests/web/analytics-consent-gate.test.ts` (4b) reprova se o host
aparecer fora do CSP. Para trocar a injeção automática pela manual, a decisão
inclui desligar a automática no painel no mesmo dia.

Painel: Cloudflare → conta do dono → Análise → **Web Analytics** → `cinerie.com`.

## A variável do GA4 (serviço `screen-app`, runtime)

| Variável | Formato | Sem ela |
|---|---|---|
| `CINERIE_GA4_MEASUREMENT_ID` | `G-` + letras/dígitos (fluxo de dados web do GA4) | sem aviso de cookies, sem botão no rodapé, sem script do Google |

- É lida **por requisição**. **Nunca** passe como build-arg: o release
  constrói sem env pública, e o valor do build nunca chegaria à produção.
- Só vale na **produção oficial** (`CINERIE_PUBLIC_SITE_URL=https://cinerie.com`
  e `NODE_ENV` de produção). Staging com a env copiada não envia nada.
- Valor malformado **desliga** o GA4. Para desligar de emergência, apague a
  variável e reinicie o serviço: não há rebuild.

## Ordem obrigatória do deploy

1. A versão `2026-10` da Política de Privacidade precisa estar **no ar antes** da
   variável existir. Antes dela, o texto publicado dizia "Não há Google
   Analytics".
2. Se `CINERIE_PRIVACY_POLICY_VERSION` estiver definida no EasyPanel, ela sobe
   para `2026-10` no mesmo deploy (a versão exibida tem de bater com a gravada no
   aceite). Os usuários logados verão o pedido de novo aceite da Privacidade.
3. Só então defina `CINERIE_GA4_MEASUREMENT_ID=G-WSY1DB68ZS` e reinicie o `screen-app`.

## Configuração da propriedade GA4 (o texto legal depende dela)

Criada em 30/10/2026 na conta Google do dono:

| | |
|---|---|
| Conta | **Cinerie** (`a414148410`) |
| Propriedade | **Cinerie - Site** (`561681744`), fuso de São Paulo, reais |
| Fluxo web | `https://cinerie.com` (`16238773190`) |
| **ID de medição** | **`G-WSY1DB68ZS`** — o valor de `CINERIE_GA4_MEASUREMENT_ID` |

Existe uma segunda conta "Cinerie" (`a414129111`, propriedade `561688142`),
**vazia e sem fluxo**, criada por engano na mesma data. Não é usada.

- Retenção de dados: **14 meses** (eventos e usuários), conferida após recarregar.
- Compartilhamento de dados da conta com o Google: tudo desmarcado.
- **Google Signals desligado**; personalização de anúncios desligada.
- Sem vínculo com Google Ads nem com AdSense.
- O código já força `allow_google_signals: false`,
  `allow_ad_personalization_signals: false` e `cookie_expires` de 13 meses.

Mudou algum desses números? Mude o texto da Política junto, suba a versão e rode
`tests/web/analytics-consent-gate.test.ts`, que confere código e texto.

## Como conferir em produção

- Página qualquer, aba anônima: o DOM tem `static.cloudflareinsights.com` (injetado
  pela borda) e **não** tem `googletagmanager`. O aviso aparece embaixo.
- "Recusar": recarregue; nenhuma requisição a `google-analytics.com`.
- "Aceitar": surge o `gtag/js?id=G-…` e os cookies `_ga`. No GA4, o relatório
  "Tempo real" mostra a visita.
- Rodapé → "Preferências de cookies" → "Recusar": os cookies `_ga` somem.
