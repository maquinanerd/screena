# @screena/config

Constantes **canonicas** da Cinerie e leitura segura de variaveis de ambiente.
`@screena/config` e namespace tecnico legado.

Este e o pacote de fundacao mais baixo do monorepo: ele nao depende de nenhum
outro pacote `@screena/*` e e a **fonte de verdade unica** para regras
inegociaveis, fontes/escalas de rating, verticais, status de indexacao e
revisao e tokens de cor. Demais pacotes (`@screena/schemas`, `@screena/seo`,
`@screena/ui`, `@screena/db`) devem importar daqui em vez de redefinir literais.

## Principios

- **Puro, sem side effects.** Nenhum modulo le ambiente, rede, disco ou banco
  no momento do import. `invariants.ts` exporta apenas dados estaticos.
- **Tipos derivados das constantes.** Ex.: `RatingSource`, `Vertical`,
  `IndexStatus`, `ReviewStatus`, `ColorToken` saem dos arrays/objetos `as const`.
- **Segredos so em env vars.** `getEnv`/`requireEnv` leem `process.env` apenas
  quando chamados — nunca no carregamento do modulo, nunca no frontend.

## API

### Invariantes e enums (`invariants.ts`)

| Export           | Tipo                          | Descricao                                                                 |
| ---------------- | ----------------------------- | ------------------------------------------------------------------------- |
| `INVARIANTS`     | `readonly Invariant[]`        | As 13 invariantes inegociaveis (`{ id, text }`), texto fiel ao CANON.     |
| `RATING_SOURCES` | `readonly string[]` (`const`) | `imdb`, `rotten_tomatoes`, `metacritic`, `letterboxd`, `filmaffinity`.     |
| `RATING_SCALES`  | objeto (`const`)              | Escala maxima por fonte (`imdb:10`, `rotten_tomatoes:100`, ...).           |
| `VERTICALS`      | `readonly string[]` (`const`) | `movie`, `series`, `neutral`.                                              |
| `INDEX_STATUS`   | `readonly string[]` (`const`) | `index`, `noindex`, `draft`, `stale`, `blocked`.                          |
| `REVIEW_STATUS`  | `readonly string[]` (`const`) | Ciclo de revisao de `content_blocks` (`draft` ... `archived`).            |
| `COLOR_TOKENS`   | objeto (`const`)              | 6 tokens de cor (chaves camelCase, valores hex).                          |

Tipos exportados: `Invariant`, `RatingSource`, `Vertical`, `IndexStatus`,
`ReviewStatus`, `ColorToken`.

### Ambiente (`env.ts`)

| Funcao                                     | Comportamento                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| `getEnv(name: string): string \| undefined` | Retorna o valor ou `undefined` se ausente. Le `process.env` so na chamada. |
| `requireEnv(name: string): string`          | Retorna o valor; lanca `Error` se a variavel estiver ausente.             |

## Uso

```ts
import {
  INVARIANTS,
  RATING_SCALES,
  COLOR_TOKENS,
  requireEnv,
  type RatingSource,
} from "@screena/config";

const source: RatingSource = "imdb";
const scale = RATING_SCALES[source]; // 10

const accent = COLOR_TOKENS.movieRed; // "#F0443E"

// Segredos: somente via env var, nunca no frontend.
const dbUrl = requireEnv("DATABASE_URL");
```

## Lembretes de invariantes

- `IMDb != Rotten Tomatoes`: nunca converta uma nota entre escalas para fingir
  equivalencia. `RATING_SCALES` existe so para exibir corretamente cada fonte.
- A diferenciacao filme/serie **nunca** depende so da cor: use sempre
  label + badge + breadcrumb + schema + URL (alem do token de cor).
- Chaves de API **so** em variaveis de ambiente, nunca no frontend.
