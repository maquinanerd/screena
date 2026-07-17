# Cinerie Score — decisão de produto (PENDENTE)

> **Status: NÃO DECIDIDO.** Este documento é o lugar canônico onde a fórmula do
> Cinerie Score será registrada. Enquanto ele disser "PENDENTE", **não existe
> Cinerie Score em produção** — o engine devolve `BLOCKED_BY_DECISION`, o banco
> recusa marcar a nota como exibível, e nenhuma pipeline preenche `screen_score`.
>
> Nenhum agente pode preencher a fórmula abaixo por inferência. Escala, fontes,
> pesos, votos mínimos, tratamento de ausência e arredondamento são decisão
> **humana** de produto/editorial/jurídico. Este arquivo é o gate: ele é editado
> por uma pessoa, e só então o código pode registrar a fórmula correspondente.

## 1. O que é o Cinerie Score

O **Cinerie Score** é a nota **própria** da Cinerie — o único número que a casa
assina. Nome público: **Cinerie Score**. As colunas técnicas legadas continuam
sendo `movies.screen_score` / `tv_shows.screen_score` (o nome de coluna **não
muda** por compatibilidade); **"Screen Score" nunca aparece ao usuário**.

Ele é, por natureza, uma **obra derivada** de notas de terceiros. Isso tem duas
consequências que já estão codificadas:

- exibir o Cinerie Score exige uma `DataUsageDecision` vigente para o use case
  `cinerie_score_display` com **`derivative_allowed = true`** — não basta poder
  exibir cada nota-fonte; é preciso poder **derivar** delas;
- ele **nunca** é um `AggregateRating` de terceiro disfarçado. Quando existir,
  usa `Review`/nota própria com metodologia publicada — jamais se apresenta como
  a nota do IMDb, do Rotten Tomatoes ou de qualquer fonte (invariantes 1 e 2).

## 2. Por que está bloqueado (e por que isso é correto)

Uma nota própria que mistura fontes é uma **afirmação editorial**. Publicá-la sem
decisão significa:

- misturar escalas e públicos diferentes (IMDb/10 de público com Metacritic/100
  de crítica) num número só — exatamente o que a invariante 1 proíbe;
- assinar como Cinerie um cálculo que ninguém aprovou;
- expor a casa a um risco de licença (derivar de dado de terceiro sem direito de
  derivar).

Por isso o estado inicial é `BLOCKED_BY_DECISION`, e ele é um resultado de
**primeira classe**, não um erro nem um TODO. O sistema funciona bloqueado.

## 3. O que a decisão precisa definir (formulário a preencher pela pessoa)

Ao aprovar o Cinerie Score, preencha **todos** os campos abaixo e registre a
versão. Nada aqui tem valor default.

| Campo | Decisão | Preencher |
| --- | --- | --- |
| **Versão da fórmula** | identificador estável (ex.: `cinerie-score/v1`) | _pendente_ |
| **Escala** | denominador da nota Cinerie (ex.: 5, 10, 100) | _pendente_ |
| **Fontes de entrada** | quais `rating_source` entram | _pendente_ |
| **Pesos** | peso de cada fonte | _pendente_ |
| **Critics vs audience** | como (e se) combinar as duas naturezas | _pendente_ |
| **Votos mínimos** | mínimo de `rating_count` para a fonte contar | _pendente_ |
| **Ausência de fonte** | o que fazer quando uma fonte falta | _pendente_ |
| **Normalização** | como trazer escalas distintas a um eixo comum **sem** afirmar equivalência entre fontes na exibição | _pendente_ |
| **Arredondamento** | regra de arredondamento e casas | _pendente_ |
| **Licença** | qual `DataUsageDecision` (`cinerie_score_display`, `derivative_allowed`) autoriza | _pendente_ |
| **Explicação ao usuário** | texto público da metodologia (E-E-A-T) | _pendente_ |

## 4. Como ativar, depois de decidido (passo a passo)

Quando (e só quando) a tabela acima estiver preenchida e aprovada por uma pessoa:

1. Implementar a `CinerieScoreFormula` da versão decidida em
   `packages/cinerie-score/src/formulas/<versao>.ts` (ela recebe
   `CinerieScoreInput` + `inputsHash` e devolve `CinerieScoreResult`).
2. Registrá-la em `PRODUCTION_FORMULA_REGISTRY`
   ([`packages/cinerie-score/src/engine.ts`](../../packages/cinerie-score/src/engine.ts)).
   Até aqui esse registro está **vazio de propósito**.
3. Registrar uma `DataUsageDecision` com `use_case = 'cinerie_score_display'`,
   `stage = 'approved_for_display'`, `display_allowed = true`,
   `derivative_allowed = true` e `policy_version = <versao da fórmula>`.
4. Rodar o job de cálculo (offline). Cada resultado grava uma linha em
   `cinerie_score_calculations` com `version`, `inputs_hash` e `explanation`.
5. A promoção de `screen_score_display = true` continua sendo **decisão humana**
   registrada; o trigger `cinerie_score_display_guard` recusa qualquer atalho.

## 5. O que já existe (esqueleto, sem fórmula)

- **Engine** `@screena/cinerie-score`: contratos, `computeInputsHash` (hash
  estável das entradas, notas ordenadas por `(source, type)`), registro
  versionado de fórmulas e o estado `blocked_by_decision`. **Sem fórmula.**
- **Histórico** `cinerie_score_calculations`: uma linha por
  `(entidade, versão, inputs_hash)`, com CHECK que impede linha "calculada" sem
  valor ou "bloqueada" com valor.
- **Trigger** `cinerie_score_display_guard`: sem decisão vigente, o banco recusa
  `screen_score_display = true`.

Enquanto os três existem e a fórmula não, o sistema está no estado correto:
**pronto para calcular, proibido de inventar.**
