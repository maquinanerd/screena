# @screena/cinerie-score

Engine **puro** do **Cinerie Score** — a nota propria da Cinerie.

> `@screena/*` e namespace tecnico legado. A marca publica e **Cinerie**, e o
> nome publico da nota e **Cinerie Score**. As colunas do banco continuam
> `screen_score*` por compatibilidade; **"Screen Score" nunca aparece ao
> usuario**.

## Este pacote NAO tem formula — e isso e o ponto

Escala, fontes, pesos, critics vs audience, votos minimos, ausencia de fonte,
arredondamento e explicacao sao **decisao de produto humana**, pendente em
[`docs/product/cinerie-score-decision.md`](../../docs/product/cinerie-score-decision.md).

`PRODUCTION_FORMULA_REGISTRY` esta **vazio de proposito**. Enquanto a decisao
nao for aprovada e registrada, `computeCinerieScore` devolve sempre
`blocked_by_decision`.

Se voce esta tentado a "so colocar uma media simples aqui": essa media seria uma
afirmacao editorial que nenhum humano aprovou, misturando escalas e publicos
diferentes (invariante 1), exibida ao usuario como a nota da casa. E exatamente
o que a governanca deste repositorio existe para impedir.

## O que ele faz

1. **Canonicaliza e hasheia** a entrada (`computeInputsHash`) — notas ordenadas
   por `(source, type)`, porque a ordem do `SELECT` nao e informacao. Sem isso o
   mesmo calculo entraria varias vezes no historico.
2. **Verifica a autorizacao humana**: exige `DataUsageDecision` vigente para
   `cinerie_score_display`, em `approved_for_display`, com `derivative_allowed`
   (o Cinerie Score e obra **derivada** de notas de terceiros) e dentro da
   vigencia.
3. **Exige decisao por nota**: qualquer entrada sem `licenseDecisionId` bloqueia
   o calculo inteiro.
4. **Delega** para a formula que **aquela decisao** aprovou
   (`decision.policyVersion` -> `registry.get(...)`). Trocar de formula exige
   nova decisao — nunca um deploy silencioso.

## Camadas de trava (nenhuma substitui a outra)

| Camada | O que impede |
| --- | --- |
| Engine (aqui) | Calcular sem decisao/formula aprovada. |
| `cinerie_score_calculations` (CHECK) | Linha "calculada" sem valor, ou "bloqueada" com valor. |
| Trigger `cinerie_score_display_guard` | `screen_score_display=true` sem decisao vigente. |

## Uso

```ts
import { computeCinerieScore, PRODUCTION_FORMULA_REGISTRY } from '@screena/cinerie-score'

const outcome = computeCinerieScore(input, {
  registry: PRODUCTION_FORMULA_REGISTRY,
  decision: null, // nao ha decisao aprovada
  now: new Date(),
})
// => { status: 'blocked_by_decision', reason: 'no-decision', ... }
```

Formula fake so em teste (`src/__tests__/`), nunca exportada daqui.
