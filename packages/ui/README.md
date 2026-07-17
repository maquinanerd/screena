# @screena/ui

Camada de apresentacao canonica da Cinerie. Centraliza os **tokens de cor** e a
**resolucao de vertical** (filme / serie / neutro) para que toda a aplicacao
diferencie conteudo de forma consistente — e nunca dependa apenas da cor.

`@screena/ui` e namespace tecnico legado. Labels neutros de runtime usam a marca
publica **Cinerie**; o prefixo `screena` permanece apenas em tokens/classes
tecnicas legadas.

> Fase 0 (fundacao): este pacote contem apenas utilitarios puros e tipados.
> Sem componentes React de produto, sem rede, sem DB, sem IO.

## Por que existe

A invariante **11** (inegociavel) determina que a diferenciacao entre filme e
serie **NUNCA** pode depender so da cor: ela precisa vir sempre acompanhada de
`label + badge + breadcrumb + schema + URL`. Este pacote garante isso na origem:
`resolveVertical` devolve cor de acento **junto com** label, badge e schema.org
type, e nunca emite label/badge vazios.

As invariantes **9** e **10** definem os acentos: filme usa o vermelho
(`--screena-movie-red`) e serie usa o verde (`--screena-series-green`).

## API

### Tokens de cor (`tokens.ts`)

- `COLOR_TOKENS` — objeto com os 6 tokens (reexportado de `@screena/config`):
  `black`, `white`, `movieRed`, `seriesGreen`, `bgDark`, `bgLight`.
- `CSS_VAR_NAMES` — mapeia cada token para o nome da CSS custom property
  (ex.: `movieRed` -> `--screena-movie-red`).
- `cssVar(token)` — devolve a expressao `var(--screena-...)` pronta para uso.
- `CSS_CUSTOM_PROPERTIES` — bloco de declaracoes `--screena-*: #hex;`.
- `ROOT_CSS_VARIABLES` — folha `:root { ... }` completa para injetar no CSS global.

```ts
import { cssVar, ROOT_CSS_VARIABLES } from "@screena/ui";

cssVar("seriesGreen"); // "var(--screena-series-green)"
```

### Vertical (`vertical.ts`)

- `resolveVertical(entityType, opts?)` — resolve `{ vertical, accent,
  accentToken, label, badge, schemaType }` a partir do tipo de entidade.
- `assertNotColorOnly(v)` — `true` quando `label` e `badge` estao presentes
  (checagem em runtime da invariante 11).

Mapeamento:

| entityType                         | vertical | accent  | accentToken               | label  | badge   | schemaType                         |
| ---------------------------------- | -------- | ------- | ------------------------- | ------ | ------- | ---------------------------------- |
| `movie` / `filme`                  | movie    | red     | `--screena-movie-red`     | Movie  | Filme   | `Movie`                            |
| `tv` / `series` / `serie`          | series   | green   | `--screena-series-green`  | Series | Serie   | `TVSeries` / `TVSeason` / `TVEpisode` |
| `person` / `pessoa`                | neutral  | neutral | `--screena-white`         | Person | Pessoa  | `Person`                           |
| `news` / `noticia`                 | neutral  | neutral | `--screena-white`         | News   | Noticia | `NewsArticle`                      |
| `home`                             | neutral  | neutral | `--screena-white`         | Home   | Cinerie  | `WebSite`                          |
| `mixed` / outro / default          | neutral  | neutral | `--screena-white`         | Cinerie | Cinerie  | `WebSite`                          |

Para series, use `opts` para refinar o schema:

```ts
import { resolveVertical } from "@screena/ui";

resolveVertical("filme").accent; // "red"
resolveVertical("serie", { isSeason: true }).schemaType; // "TVSeason"
resolveVertical("serie", { isEpisode: true }).schemaType; // "TVEpisode"
```

`entityType` e tratado de forma tolerante: espacos sao removidos e o valor e
comparado em minusculas. Tipos desconhecidos caem no neutro institucional.

## Dependencias

- `@screena/config` — fonte de verdade unica dos tokens de cor.
