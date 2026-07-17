---
name: schema-validate
description: >-
  Valida o JSON-LD (Schema.org) de uma pagina da Cinerie por tipo de entidade:
  Movie, TVSeries, TVSeason, TVEpisode, Person, NewsArticle, BreadcrumbList,
  FAQPage, Review e AggregateRating. Garante que o tipo corresponde a rota, que
  `AggregateRating` nunca finge nota propria (sempre atribuido a uma fonte real
  e permitido por licenca), que a atribuicao (fonte, escala, url, data) e
  preservada, que `FAQPage` so aparece quando ha FAQ visivel e que IMDb e
  Rotten Tomatoes nunca se misturam. Use ao revisar o structured data de uma
  pagina, ao adicionar/alterar JSON-LD, ou como etapa da auditoria `seo-audit`.
---

# Skill: schema-validate — Validacao de JSON-LD por tipo de entidade

Esta skill valida o **structured data (JSON-LD)** de uma pagina da Cinerie
contra o tipo de entidade correto e contra as regras de atribuicao de ratings.
O objetivo e impedir dois erros graves: **tipo de schema errado** e
**`AggregateRating` fingindo nota propria** / atribuicao perdida.

A fonte editorial das regras esta em [`.claude/rules/seo.md`](../../rules/seo.md)
(secao 9) e [`.claude/rules/ratings.md`](../../rules/ratings.md) (secoes 1, 2, 7).
A fonte executavel de ratings e
[`packages/schemas/src/ratings.ts`](../../../packages/schemas/src/ratings.ts)
(`validateRating`), travada por
[`tests/governance/ratings.test.ts`](../../../tests/governance/ratings.test.ts).

> Esta skill **valida e relata**. Nao gera schema final, nao acessa rede/banco,
> nao chama Gemini nem APIs externas e nao publica. Trabalha sobre um JSON-LD ja
> montado a partir de payload do PostgreSQL.

Estado atual: ratings externos e reviews proprias ainda nao estao ativos como
produto publico. Esta skill valida `AggregateRating`/`Review` quando eles forem
explicitamente emitidos por uma feature licenciada e revisada; nao exige nem
cria esses blocos por inferencia.

---

## Quando usar

- Ao revisar o JSON-LD de uma pagina nova ou alterada.
- Ao adicionar `AggregateRating`, `Review`, `FAQPage` ou `BreadcrumbList`.
- Como etapa de structured data dentro da auditoria conduzida por `seo-audit`.

## Entrada esperada

- O **JSON-LD** emitido pela pagina.
- A **rota** e o **tipo de entidade** esperado.
- Para ratings: o registro de `external_ratings`/`source_licenses` que originou o
  bloco (fonte, escala, url, `fetched_at`, flags de licenca).

---

## Mapa de tipo por rota (invariante 9)

| Rota / pagina                                  | `@type` principal |
| ---------------------------------------------- | ----------------- |
| `/pt/filmes/{slug}/`                           | `Movie`           |
| `/pt/series/{slug}/`                           | `TVSeries`        |
| `/pt/series/{slug}/temporada-{n}/`             | `TVSeason`        |
| Episodio                                       | `TVEpisode`       |
| `/pt/pessoas/{slug}/`                          | `Person`          |
| `/pt/noticias/{slug}/`                         | `NewsArticle`     |

Complementos (condicionais):

- `BreadcrumbList` — em **todas** as paginas principais.
- `FAQPage` — **somente** se houver FAQ visivel na pagina.
- `Review` — apenas para **review propria** da Cinerie; nao emitir enquanto
  reviews proprias estiverem inativas como produto.
- `AggregateRating` — **somente quando permitido e atribuido** a sua fonte.

---

## Passos da validacao

### 1. Tipo correto e coerente com a rota

- Confirme que `@type` principal bate com a rota (tabela acima). `Movie` numa
  rota de serie (ou vice-versa) e **falha imediata**.
- O tipo precisa ser coerente com os demais sinais de vertical (label, badge,
  breadcrumb, URL) — schema e **um dos cinco** sinais da invariante 11; nunca
  contradiz os outros.
- Campos minimos por tipo presentes e coerentes (ex.: `Movie.name`,
  `TVSeries.name`, `TVSeason.seasonNumber`, `TVEpisode.episodeNumber`,
  `Person.name`, `NewsArticle.headline`/`datePublished`).

### 2. BreadcrumbList

- Presente em toda pagina principal, refletindo a hierarquia real da URL
  (`/pt/filmes/...` vs `/pt/series/...`).
- Itens em ordem, com `position`, `name` e `item` (URL absoluta) coerentes com a
  rota canonica.

### 3. FAQPage (so com FAQ visivel)

- `FAQPage` so pode existir se houver **FAQ realmente visivel** na pagina. JSON-LD
  de FAQ sem conteudo visivel correspondente e **falha** (schema fantasma).
- Cada `Question` tem um `acceptedAnswer` cujo texto corresponde ao que o usuario
  ve. Sem invencao de perguntas/respostas.

### 4. Review (so review propria)

- `Review` apenas quando o Cinerie tem **review propria** sobre a entidade.
- `author` e o Cinerie (ou o autor editorial real), nunca uma fonte de terceiro.
- Review propria usa `Review` — **nunca** se disfarca de `AggregateRating` de
  terceiro.

### 5. AggregateRating — nunca fingir nota propria

`AggregateRating` so pode aparecer quando **todas** as condicoes valem:

1. A nota tem licenca que permite exibicao: `display_allowed = true`,
   `score_allowed = true`, `license_status` em `official`/`licensed`/permitido
   (ver [`.claude/rules/ratings.md`](../../rules/ratings.md), secao 5).
2. A nota e **explicitamente atribuida** a sua fonte real (`rating_source`). O
   `AggregateRating` reflete a nota de uma fonte externa identificada.

Proibido (cada um e falha):

- **`AggregateRating` fingindo nota propria.** Cinerie nao publica nota
  agregada propria como se fosse autoral.
- Misturar notas de **fontes diferentes** em um unico `AggregateRating` (cada
  agregado pertence a uma fonte; IMDb != Rotten Tomatoes).
- Emitir `AggregateRating` para nota com `score_allowed = false` ou licenca
  `unknown`/`blocked`.
- Apresentar `provider_api` (fornecedor tecnico, ex.: RapidAPI) como fonte da
  nota — a fonte e sempre `rating_source` (invariante 2).

### 6. Atribuicao preservada (fonte, escala, url, data)

Para todo bloco de rating no JSON-LD, confirme que a atribuicao **nao se perde**:

- **Fonte** (`rating_source`): identificada e correta. O `rating_label`/marca
  deve casar com a fonte — `Tomatometer`/`Popcornmeter` so para
  `rotten_tomatoes`; nunca IMDb virando Tomatometer (invariante 1, cross-label).
- **Escala** (`rating_scale`): igual a escala canonica da fonte
  (`imdb`=10, `rotten_tomatoes`=100, `metacritic`=100, `letterboxd`=5,
  `filmaffinity`=10). Nunca reescalar entre fontes. Use `validateRating` de
  [`packages/schemas/src/ratings.ts`](../../../packages/schemas/src/ratings.ts)
  para checar fonte/escala/label/`provider_api`.
- **URL** (`rating_url` / `attribution_url`): link canonico para a nota na fonte,
  preservado e renderizado como link quando `requires_linkback = true`.
- **Data** (`fetched_at`): preservada para indicar frescor. Sem `fetched_at`, nao
  afirme "atualizado em".
- Quando `requires_attribution = true`, `attribution_text` e obrigatorio e credita
  a `rating_source` — nunca o `provider_api`.

### 7. Consistencia com a politica de fontes

- IMDb != Rotten Tomatoes em **toda** dimensao do schema (fonte, escala, rotulo,
  logo, linguagem). Nunca misture.
- Nenhuma transformacao proibida: sem reescalar entre fontes, sem cross-label,
  sem agregar fontes distintas, sem `AggregateRating` proprio inventado a partir
  de nota de terceiro (ver [`.claude/rules/ratings.md`](../../rules/ratings.md),
  secao 8).

---

## Saida da validacao

Relate, por bloco de JSON-LD:

- `@type` encontrado vs esperado (aprovado/reprovado).
- Para `AggregateRating`/`Review`: fonte atribuida, escala, url e data presentes?
  Licenca permite? (aprovado/reprovado, com motivo).
- Para `FAQPage`: existe FAQ visivel correspondente? (aprovado/reprovado).
- Lista de violacoes em ordem de gravidade, citando a invariante/regra ferida.

Checklist resumido:

- [ ] `@type` principal correto para a rota.
- [ ] `BreadcrumbList` presente e coerente.
- [ ] `FAQPage` apenas com FAQ visivel.
- [ ] `Review` apenas para review propria da Cinerie.
- [ ] `AggregateRating` so permitido e atribuido; nunca nota propria fingida.
- [ ] Atribuicao preservada: fonte, escala, url e data.
- [ ] IMDb e Rotten Tomatoes nunca misturados; `provider_api` != `rating_source`.

---

## Referencias

- Regras de schema: [`.claude/rules/seo.md`](../../rules/seo.md) (secao 9).
- Regras de ratings/atribuicao: [`.claude/rules/ratings.md`](../../rules/ratings.md).
- Validacao executavel de ratings:
  [`packages/schemas/src/ratings.ts`](../../../packages/schemas/src/ratings.ts)
  (`validateRating`), testes em
  [`tests/governance/ratings.test.ts`](../../../tests/governance/ratings.test.ts).
- Constantes canonicas (`RATING_SOURCES`, `RATING_SCALES`): `@screena/config`.
- Auditoria da pagina inteira: skill `seo-audit`.

---

## Nota de governanca

Esta skill **nao** implementa produto, **nao** acessa rede/banco, **nao** chama
Gemini nem APIs externas e **nao** publica. Ela valida JSON-LD ja montado a partir
de payload controlado do PostgreSQL e relata violacoes. A regra inegociavel:
`AggregateRating` **nunca** finge nota propria — sempre reflete a nota de uma
fonte real, atribuida e licenciada, com fonte, escala, url e data preservadas.
IMDb nunca vira Tomatometer e o `provider_api` nunca aparece como fonte. Na
duvida sobre exibir um rating, ele **nao** entra no schema.
