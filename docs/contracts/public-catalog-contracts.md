# Contratos publicos do catalogo (`@screena/public-contracts`)

> Referencia (pt-BR). O pacote `@screena/public-contracts` e a **fronteira tipada**
> entre os getters server-only (que leem o PostgreSQL) e o render/consumidores.
> Decisao: [ADR 0012](../adr/0012-complete-catalog-platform.md).

## Principios

1. **Serializavel (JSON-safe).** Ids sao `string` (nunca `BigInt`); datas sao ISO
   `string`; nada de tipos gerados pelo Prisma no contrato.
2. **Sem zod.** O repo nao usa zod. Cada payload tem um validador PURO no estilo
   de `@screena/schemas`: `validateX(input): { ok, errors, value }`.
3. **Fonte unica de literais.** Locales/enums vem de `@screena/config`
   (reexportados) — nunca re-listados.
4. **Governanca de midia (invariante 6).** `PublicMediaAsset.displayAllowed` e a
   flag-mestra; `filterDisplayAllowedMedia` remove o que nao pode ser exibido; o
   `file_path` cru nunca aparece (so a `url` final).
5. **Busca e sempre noindex** (`SearchPayload.index === false`).

## Catalogo de contratos

### Primitivos (`primitives`)

| Tipo | Papel |
| --- | --- |
| `EntityRef` | referencia leve `{ kind, id, title, canonicalUrl }` |
| `PublicMediaAsset` | imagem publica com `displayAllowed`, `url` final, `source:'tmdb'` |
| `PublicVideo` | video (metadados; nunca embed pirata) |
| `MediaPayload` | `{ poster, backdrop, images[], videos[] }` |
| `Credit` | credito (elenco/equipe) referenciando uma pessoa |
| `SeoPayload` | `{ canonicalUrl, index, robots, metaTitle, metaDescription, locale }` |

Validadores: `validateMediaPayload`, `filterDisplayAllowedMedia`, e os `*Errors`
compostos pelos payloads maiores.

### Detalhe (`detail`)

`MovieDetailPayload`, `TvDetailPayload`, `SeasonDetailPayload`,
`EpisodeDetailPayload`, `PersonDetailPayload` +
`validateMovieDetail`/`validateTvDetail`/`validateSeasonDetail`/
`validateEpisodeDetail`/`validatePersonDetail`.

Refletem a forma **realmente renderizada** hoje (os `*PageView` dos getters). Os
campos de valor ainda inativos como feature publica — `ratings:
RatingProjection[]`, `streaming: StreamingProjection[]` — existem como arrays
OPCIONAIS/vazios: o contrato descreve o presente sem forcar dado que nao
renderiza (ratings/streaming ainda nao sao feature publica).

### Home e descoberta (`home`)

| Tipo | Papel |
| --- | --- |
| `EntityCard` | cartao reutilizavel; `screenScore` e a nota PROPRIA do Screen (escala 5), nunca de terceiro |
| `HomePayload` | `{ locale, hero[], trending[], upcoming[] }` |
| `DiscoveryPayload` | projecao de um snapshot de descoberta (trending/popular/...) |

### Busca (`search`)

| Tipo | Papel |
| --- | --- |
| `SearchResult` | `{ entityId, type, title, subtitle, year, image, canonicalUrl, matchReason, score }` |
| `SearchPayload` | `{ query, locale, results[], total, limit, offset, index: false }` |

`matchReason ∈ exact | alias | prefix | fuzzy` espelha o ranking do worker de
busca (titulo exato > alias exato > prefixo > fuzzy trgm).

### Fila (`catalog-job`)

| Tipo | Papel |
| --- | --- |
| `CatalogJobView` | visao serializavel de um job (status/type/attempts/erro seguro) |
| `CatalogStatusPayload` | `{ counts: Record<status, number>, deadLetter[] }` |

## Uso

```ts
import { validateMovieDetail, filterDisplayAllowedMedia } from '@screena/public-contracts'

const result = validateMovieDetail(payload)
if (!result.ok) throw new Error(result.errors.join('; '))
const safeMedia = filterDisplayAllowedMedia(result.value.media)
```

O getter server-only monta o payload a partir do Postgres; o validador e a rede de
seguranca na fronteira; o render consome so o `value` validado.
