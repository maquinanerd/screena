# @screena/schemas

Pacote de **validacao canonica** da Cinerie. `@screena/schemas` e namespace
tecnico legado. Reune as regras que protegem duas fronteiras criticas do produto:

1. **Integridade de ratings externos** (`src/ratings.ts`)
2. **Saida do Entity Writer** (`src/entity-writer-output.ts`)

Todo o codigo aqui e **puro**: sem rede, sem banco, sem IO, sem efeitos
colaterais. As constantes de fonte/escala vivem em `@screena/config` e sao a
unica fonte de verdade — este pacote nunca redefine literais soltos.

> Fase 0 / Fundacao: este pacote valida formas e regras. Nao implementa
> features de produto (sem banco real, sem client TMDB/Gemini, sem ratings
> reais).

## Por que existe

Duas invariantes inegociaveis exigem validacao automatica antes de qualquer
escrita ou exibicao:

- **Invariante 1** — `IMDb != Rotten Tomatoes`: nunca misturar fontes,
  escalas, icones ou linguagem.
- **Invariante 2** — `provider_api != rating_source`: o fornecedor tecnico
  (ex.: RapidAPI, `imdb236`) nunca e a fonte editorial.
- **Invariante 12** — o Entity Writer so escreve com base em payload
  controlado do PostgreSQL: nao inventa fatos.

## API

### Ratings — `src/ratings.ts`

- `RatingSource` — uniao das 5 fontes (`imdb`, `rotten_tomatoes`,
  `metacritic`, `letterboxd`, `filmaffinity`), reexportada de `@screena/config`.
- `RatingInput` — `{ ratingSource, ratingLabel, metric, ratingValue, ratingScale, providerApi }`.
- `validateRating(input): { ok, errors }` — aplica e exige:
  - **(a)** `ratingSource` pertence a `RATING_SOURCES`;
  - **(b)** `ratingScale === RATING_SCALES[ratingSource]` (escala correta da fonte);
  - **(c)** `providerApi` diferente de `ratingSource` **e** `providerApi` nao e
    uma fonte editorial de `RATING_SOURCES` (provider_api != rating_source);
  - **(d)** anti cross-label: se o label contem `tomatometer`/`tomate`/
    `popcornmeter` a fonte deve ser `rotten_tomatoes`; `imdb` -> `imdb`;
    `metacritic`/`metascore` -> `metacritic`.
- `assertRatingIntegrity(input)` — lanca `Error` se `!ok`.

Escalas canonicas (de `@screena/config`): `imdb=10`, `rotten_tomatoes=100`,
`metacritic=100`, `letterboxd=5`, `filmaffinity=10`.

### Entity Writer — `src/entity-writer-output.ts`

- `EntityWriterOutput` — `{ editorial_intro?, summary_without_spoilers?, ratings_explanation?, where_to_watch_text?, cast_intro?, similar_titles_intro?, faq?: {question,answer}[], warnings: string[] }`.
  Todos os blocos textuais sao opcionais; `warnings` e obrigatorio e sempre array.
- `validateEntityWriterOutput(output): { ok, errors }` — checa formas/tipos e
  que `warnings` e um array (de strings).
- `validateAgainstPayload(payload, output): { warnings }` — detecta alucinacao
  simples. Extrai nomes proprios citados em `cast_intro`/`editorial_intro` e
  verifica contra `payload.director` e `payload.cast`. Qualquer nome fora do
  payload vira `fato fora do payload: <nome>`. Baseado apenas em comparacao de
  strings; **nao substitui revisao humana**.

## Exemplo

```ts
import { validateRating, validateAgainstPayload } from '@screena/schemas'

// rating valido
validateRating({
  ratingSource: 'imdb',
  ratingLabel: 'IMDb Rating',
  metric: 'user_rating',
  ratingValue: 8.4,
  ratingScale: 10,
  providerApi: 'imdb236',
}) // => { ok: true, errors: [] }

// anti-alucinacao
validateAgainstPayload(
  { director: 'Denis Villeneuve', cast: ['Timothee Chalamet'] },
  { cast_intro: 'Com Timothee Chalamet e Zendaya.', warnings: [] },
) // => { warnings: ['fato fora do payload: Zendaya'] }
```

## Testes

Os testes de governanca vivem em `tests/governance/` na raiz do monorepo e
importam sempre via `@screena/schemas`:

- `tests/governance/ratings.test.ts`
- `tests/governance/entity-writer-output.test.ts`

Rode com `pnpm test` (vitest) na raiz.
