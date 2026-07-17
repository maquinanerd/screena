# Regras de Ratings — Cinerie

> Regras de governanca para ratings externos (notas de fontes terceiras como
> IMDb, Rotten Tomatoes, Metacritic, Letterboxd e FilmAffinity). Este documento
> e normativo: qualquer codigo, dado ou teste que o contrarie esta errado e deve
> falhar.
>
> Fonte de verdade do codigo: `packages/schemas/src/ratings.ts`.
> Cobertura de governanca: `tests/governance/ratings.test.ts`.
> Constantes canonicas (`RATING_SOURCES`, `RATING_SCALES`): `@screena/config`
> (`packages/config/src/invariants.ts`).

Estado atual: os contratos, validadores e schema de suporte a ratings ja existem,
mas ratings externos ainda **nao** estao ativos como produto publico. Nao colete,
exiba, licencie ou publique ratings por inferencia; qualquer ativacao exige
escopo explicito, decisao humana de licenca e testes cobrindo a mudanca.

---

## 1. Principio inegociavel: IMDb != Rotten Tomatoes

Cada fonte de rating e um universo proprio. **Nunca** misture fontes, escalas,
icones ou linguagem entre elas. Tratar duas fontes como intercambiaveis e uma
violacao grave (invariante 1).

Distincoes que precisam ser preservadas em TODA camada (dado, validacao,
render, schema, UI):

| Dimensao   | Regra                                                                                  |
| ---------- | -------------------------------------------------------------------------------------- |
| Fonte      | A nota pertence a uma e somente uma fonte editorial (`rating_source`).                  |
| Escala     | Cada fonte tem sua escala (ver secao 3). Nunca reescalar entre fontes.                  |
| Icone/logo | O logo/icone exibido e o da fonte real; nunca o logo de outra fonte.                    |
| Linguagem  | Os rotulos (`Tomatometer`, `IMDb Rating`, `Metascore`) pertencem so a fonte de origem. |

### Cross-label proibido

Um rotulo (`rating_label`) que cite uma marca de fonte **forca** a fonte
correspondente. Exemplos do que `validateRating` rejeita:

- `rating_label` contendo `tomatometer`, `tomate` ou `popcornmeter` exige
  `rating_source = "rotten_tomatoes"`.
- `rating_label` contendo `imdb` exige `rating_source = "imdb"`.
- `rating_label` contendo `metacritic` ou `metascore` exige
  `rating_source = "metacritic"`.

Mostrar um "Tomatometer" atribuido ao IMDb e proibido. Esse caso e exatamente o
teste `(1)` de `tests/governance/ratings.test.ts` e DEVE falhar (`result.ok === false`).

### Tomatometer / Popcornmeter pertencem ao Rotten Tomatoes

`Tomatometer` e `Popcornmeter` sao marcas exclusivas do Rotten Tomatoes. Nunca
crie esses rotulos para outra fonte e nunca derive um "Tomatometer" a partir de
nota de outra fonte. A **nota do IMDb nunca vira Tomatometer** (e vice-versa).

---

## 2. Principio inegociavel: provider_api != rating_source

O fornecedor tecnico que entregou o dado (`provider_api`, ex.: `RapidAPI`,
`imdb236`) **nunca** e a fonte editorial (`rating_source`, ex.: `imdb`).
Confundir os dois e violacao da invariante 2.

- `provider_api` = quem transportou o dado pela rede (camada tecnica).
- `rating_source` = quem produziu/possui a nota (camada editorial).

`validateRating` aplica duas checagens:

1. `provider_api` nao pode ser **igual** a `rating_source`. (Teste `(2)` —
   `provider_api === rating_source` DEVE falhar.)
2. `provider_api` nao pode ser **um valor de `RATING_SOURCES`**. Um fornecedor
   tecnico jamais usa o identificador de uma fonte editorial como seu nome.

Corolario: a atribuicao exibida ao usuario e sempre da `rating_source`, nunca do
`provider_api`. O fornecedor tecnico nao aparece como fonte da nota em pagina
publica.

---

## 3. Escalas por fonte (canonicas)

As escalas vivem em `RATING_SCALES` (`@screena/config`) e sao a unica verdade.
`validateRating` exige `rating_scale === RATING_SCALES[rating_source]`.

| Fonte (`rating_source`) | Escala (denominador) | Exemplo de valor valido |
| ----------------------- | -------------------- | ----------------------- |
| `imdb`                  | `10`                 | `8.4`                   |
| `rotten_tomatoes`       | `100`                | `92`                    |
| `metacritic`            | `100`                | `78`                    |
| `letterboxd`            | `5`                  | `4.2`                   |
| `filmaffinity`          | `10`                 | `7.6`                   |

Regras:

- A escala **e propriedade da fonte**, nao do consumidor. Um IMDb declarado com
  escala `100` esta errado e DEVE falhar (teste `(3)`).
- Nunca normalize escalas entre fontes para "comparar". Cada nota e exibida na
  escala da sua fonte.
- Novas fontes so existem se adicionadas a `RATING_SOURCES` e `RATING_SCALES` em
  `@screena/config`. Nao introduza literais soltos em outros modulos.

---

## 4. Colunas de `external_ratings`

Toda nota externa persiste em `external_ratings` com estas colunas-chave
(referencia do schema atual; produto de ratings ainda inativo publicamente):

| Coluna                  | Significado                                                              |
| ----------------------- | ----------------------------------------------------------------------- |
| `rating_source`         | Fonte editorial (pertence a `RATING_SOURCES`).                          |
| `rating_label`          | Rotulo humano exibido (coerente com a fonte; ver cross-label).          |
| `metric`                | Nome tecnico da metrica (ex.: `user_rating`, `tomatometer`).            |
| `rating_value`          | Valor numerico na escala da fonte.                                      |
| `rating_scale`          | Escala/denominador (deve casar com `RATING_SCALES[rating_source]`).     |
| `rating_count`          | Quantidade de votos/criticas que compoem a nota, quando disponivel.     |
| `rating_url`            | URL canonica da nota na fonte.                                          |
| `provider_api`          | Fornecedor tecnico que entregou o dado (NUNCA igual a `rating_source`). |
| `provider_payload_hash` | Hash do payload bruto recebido do fornecedor (rastreabilidade).         |
| `fetched_at`            | Timestamp da coleta (obrigatorio para atribuicao e frescor).            |
| `attribution_text`      | Texto de atribuicao obrigatorio quando a licenca exige.                 |
| `attribution_url`       | Link de atribuicao/linkback obrigatorio quando a licenca exige.         |
| `license_status`        | Status de licenca (ver secao 5).                                        |
| `display_allowed`       | Flag-mestra: se `false`, a nota NAO aparece em pagina indexavel.        |

`RatingInput` em `packages/schemas/src/ratings.ts` cobre o subconjunto validavel
de forma pura: `ratingSource`, `ratingLabel`, `metric`, `ratingValue`,
`ratingScale`, `providerApi`. As demais colunas (licenca, atribuicao, frescor)
sao validadas na fronteira de exibicao/indexabilidade, nao neste modulo puro.

---

## 5. Licencas (`source_licenses`) e o gate `display_allowed` / `license_status`

Cada fonte tem um registro em `source_licenses` que decide o que pode ser
exibido. Os estados de `license_status` sao:

| `license_status` | Significado                                            | Pode exibir em pagina indexavel? |
| ---------------- | ----------------------------------------------------- | -------------------------------- |
| `official`       | Acordo/licenca oficial da propria fonte.              | Sim (respeitando flags).         |
| `licensed`       | Licenca de terceiro com direito de exibicao.          | Sim (respeitando flags).         |
| `third_party`    | Origem de terceiro com direito limitado.              | Somente se flags permitirem.     |
| `unknown`        | Licenca nao confirmada.                               | **Nao.**                         |
| `blocked`        | Exibicao proibida.                                    | **Nao.**                         |

Flags de `source_licenses` (cada uma e um gate independente):
`display_allowed`, `logo_allowed`, `score_allowed`, `review_quote_allowed`,
`requires_attribution`, `requires_linkback`.

### Gate inegociavel (invariante 6)

Uma nota com `license_status` em `unknown` ou `blocked`, **ou** com
`display_allowed = false`, **nao aparece em nenhuma pagina indexavel**. Sem
excecao. O mesmo dado pode existir no banco (para auditoria/sync), mas nunca e
renderizado em pagina que pode ser indexada.

Regras derivadas das flags:

- `logo_allowed = false` → exibir o nome da fonte em texto, nunca o logo.
- `score_allowed = false` → nao exibir o numero da nota (somente, no maximo,
  link para a fonte se permitido).
- `review_quote_allowed = false` → nao citar trechos de critica da fonte.
- `requires_attribution = true` → `attribution_text` obrigatorio (ver secao 6).
- `requires_linkback = true` → `attribution_url` obrigatorio e renderizado como
  link para a fonte.

---

## 6. Atribuicao obrigatoria

Quando a licenca exige atribuicao/linkback, a nota so pode ser exibida com:

- `attribution_text` — texto de credito a fonte (ex.: "Nota fornecida por IMDb").
- `attribution_url` — link canonico para a fonte (`requires_linkback`).
- `fetched_at` — quando o dado foi coletado, para indicar frescor ("atualizado
  em ...") e habilitar invalidacao de cache.

Regras:

- Atribuicao credita sempre a `rating_source`, nunca o `provider_api`.
- Sem `attribution_text` (quando `requires_attribution = true`) ou sem
  `attribution_url` (quando `requires_linkback = true`), a nota nao e exibida em
  pagina indexavel.
- `fetched_at` ausente ou impreciso impede afirmacoes de frescor; nesse caso nao
  alegue "atualizado em".

---

## 7. Politica de `AggregateRating` (Schema.org)

`AggregateRating` so pode aparecer no JSON-LD quando:

1. A nota tem licenca que permite exibicao (`display_allowed = true`,
   `score_allowed = true`, `license_status` em `official`/`licensed`/permitido).
2. A nota e **explicitamente atribuida** a sua fonte real. O `AggregateRating`
   reflete a nota de uma fonte externa identificada — nunca uma nota "propria"
   inventada.

Proibido:

- **Nada de `AggregateRating` fingindo nota propria.** Cinerie nao publica nota
  agregada propria como se fosse autoral.
- Misturar notas de fontes diferentes em um unico `AggregateRating` (cada
  agregado pertence a uma fonte).
- Emitir `AggregateRating` para nota com `score_allowed = false` ou licenca
  `unknown`/`blocked`.

Nota propria da Cinerie, quando existir, usa `Review` proprio — nunca se disfarca
de `AggregateRating` de terceiro.

---

## 8. Transformacoes proibidas

As seguintes transformacoes sao terminantemente proibidas (qualquer uma falha a
governanca):

- **Reescalar entre fontes** (ex.: IMDb `8.4/10` → `84/100` para parecer
  Rotten Tomatoes). Cada nota fica na escala da sua fonte.
- **Converter nota do IMDb em Tomatometer/Popcornmeter** (ou qualquer
  cross-conversion entre marcas de fontes). A nota do IMDb nunca vira
  Tomatometer.
- **Trocar o rotulo** para o de outra fonte (cross-label da secao 1).
- **Usar `provider_api` como fonte** ou exibir o fornecedor tecnico como autor da
  nota.
- **Agregar notas de fontes distintas** em um valor unico apresentado como nota.
- **Exibir nota sem licenca clara** (`unknown`/`blocked` ou `display_allowed =
  false`) em pagina indexavel.
- **Inventar `AggregateRating` proprio** a partir de notas de terceiros.

---

## 9. Regra de falha obrigatoria (testes e codigo)

> Qualquer codigo ou teste que permita **IMDb virar Tomatometer** (ou qualquer
> cross-conversion/cross-label entre fontes) **ou** que permita **`provider_api`
> substituir `rating_source`** DEVE FALHAR.

Isso e garantido na fronteira pura por `validateRating` em
`packages/schemas/src/ratings.ts` e travado por
`tests/governance/ratings.test.ts`:

- Teste `(1)` — `rating_source = "imdb"` com `rating_label = "Tomatometer"` →
  falha por cross-label.
- Teste `(2)` — `provider_api === rating_source` (`"imdb"`/`"imdb"`) → falha por
  `provider_api`.
- Teste `(3)` — `imdb` com `rating_scale = 100` (deveria ser `10`) → falha por
  escala.
- Teste `(4)` — `imdb`, valor `8.4`, escala `10`, label `"IMDb Rating"`,
  provider `"imdb236"` → passa (caso valido de referencia).

Consequencias:

- Nenhuma nota externa pode ser persistida ou exibida sem passar por
  `validateRating` / `assertRatingIntegrity`.
- Se um teste de governanca de ratings ficar verde para um caso proibido aqui,
  o teste esta errado — corrija o teste, nunca relaxe a regra.
- Estas regras espelham as invariantes 1 e 2 de `@screena/config`; divergencia
  entre este documento e `RATING_SOURCES`/`RATING_SCALES` e bug — alinhe pelo
  `@screena/config`.
