# @screena/seo

Gate **anti-thin** e decisao de **indexabilidade** da Screena.

Este pacote concentra a logica que decide se uma pagina publica pode ser
indexada pelos buscadores. E composto apenas por funcoes **puras e
deterministas**: nao acessa rede, banco de dados, sistema de arquivos, `Date`
nem `Math.random`. O chamador resolve os dados (a partir do PostgreSQL) e passa
um payload ja agregado.

## Por que existe

Tres invariantes inegociaveis do CANON moram aqui:

- **Invariante 5 — pagina fina recebe noindex.** Sem pelo menos 2 blocos de
  valor proprios (alem de dado cru de API), estrutura confiavel e baixo
  thin score, a pagina nao indexa.
- **Invariante 6 — dados sem licenca clara nao aparecem em pagina indexavel.**
  Qualquer rating exibido com `display_allowed=false` torna a pagina `blocked`.
- **Invariante 7 — pt-BR publica primeiro.** `en`/`es` nascem em `draft`/noindex
  ate revisao humana.

## API

### `value-blocks.ts`

- `VALUE_BLOCK_TYPES` — lista canonica (`as const`) dos 15 tipos de bloco de
  valor aceitos pelo gate anti-thin.
- `ValueBlockType` — uniao de tipos derivada de `VALUE_BLOCK_TYPES`.
- `isValueBlockType(value)` — type guard para um tipo de bloco canonico.
- `countValueBlocks(blocks)` — conta blocos validos e **distintos** (duplicatas
  nao inflam a contagem; entradas desconhecidas sao ignoradas).

### `indexability.ts`

- `THIN_THRESHOLD = 0.5` — limiar de conteudo fino (`0` rico … `1` fino).
- `IndexabilityInput` — payload de entrada (idioma, dados estruturados,
  contagem de blocos de valor, ratings exibidos, thin score, review_status).
- `IndexabilityResult` — `{ decision, reason, hasUniqueValue, allRatingsLicensed }`.
- `IndexabilityDecision` — `'index' | 'noindex' | 'draft' | 'blocked'`.
- `evaluateIndexability(input)` — aplica as invariantes 5, 6 e 7.

### Precedencia de `evaluateIndexability`

1. Algum rating com licenca bloqueada → `blocked` (invariante 6).
2. Idioma fora de `pt-BR`/`pt` → `draft` (invariante 7).
3. Dados estruturados confiaveis **e** `>= 2` blocos de valor **e**
   `thinContentScore <= THIN_THRESHOLD` **e** `review_status` permitido →
   `index` (invariante 5).
4. Caso contrario → `noindex`, com `reason` apontando o requisito faltante.

## Uso

```ts
import { countValueBlocks, evaluateIndexability } from "@screena/seo";

const valueBlocksCount = countValueBlocks([
  "editorial_intro",
  "external_ratings_attributed",
]);

const result = evaluateIndexability({
  language: "pt-BR",
  hasReliableStructuredData: true,
  valueBlocksCount,
  displayedRatings: [{ licenseDisplayAllowed: true }],
  thinContentScore: 0.1,
  reviewStatusOk: true,
});

// result.decision === "index"
```

## Garantias

- Sem efeitos colaterais, sem IO, sem rede/DB.
- Determinista: a mesma entrada sempre produz a mesma decisao.
- Seguro para rodar no render (apenas leitura de payload local), embora a
  intencao seja decidir indexabilidade no pipeline editorial/offline.
