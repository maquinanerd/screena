# @screena/opapreco

Cliente HTTP **server-only** do ad server da OpaPreço (ofertas afiliadas da
Shopee). `@screena/*` é namespace técnico legado; a marca pública é **Cinerie**.

## Por que mora fora de `apps/web`

A invariante 3 (zero API externa no render) é travada por guardas que leem o
texto de `apps/web` (`scripts/audit/check-render-purity.mjs` e
`tests/governance/no-render-external-api.test.ts`): todo `fetch(` ali precisa
ter destino comprovadamente de mesma origem. As três chamadas externas do
sistema de anúncios moram aqui, como o envio de e-mail mora em
`@screena/user-platform`:

| Função | Quem chama | O que faz |
|---|---|---|
| `requestAdDecision` | `GET /api/opapreco/ad` | `GET {base}/v1/ad?publisher=…&slot=…` com teto de 1,5 s; 204/erro/timeout → `null` |
| `fetchAllowedImage` | `GET /api/opapreco/img` | baixa a imagem do produto de um host da lista, `image/*` sem SVG, até 2 MB, sem seguir redirect |
| `fireImpression` | `POST /api/opapreco/track` | dispara a URL de impressão só se a origem for a do ad server |

Nenhuma página chama este pacote. A página renderiza a reserva de altura; o
navegador pede o anúncio à rota da própria Cinerie, e é a rota que fala com a
OpaPreço. Assim o leitor não contata terceiro antes de clicar numa oferta (a
Política de Privacidade, item 6, diz que o único conteúdo de terceiro é o
player de vídeo depois do clique).

Validação do contrato e regras de exibição ficam em
`apps/web/src/lib/opapreco/` (puro, testado). Este pacote só transporta bytes.
Contratos e decisões: `docs/opapreco/`.
