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

### URL de imagem (`media-url`)

`buildTmdbImageUrl(filePath, size)` — a implementacao CANONICA (unica no repo;
audit repo-wide + `tests/governance/image-host-single-source.test.ts`). Devolve
a URL final do CDN ou `null` para entrada invalida (sem `/`, protocolo-relativo,
asset local legado, `..`, query/hash/backslash/espaco). O `file_path` cru nunca
entra em contrato. O helper de `apps/web/src/lib/tmdb-image-url.ts` e reexport.

## Producao dos payloads (getters reais)

`createPublicPayloadReader(prisma, options)` em
`services/ingestion/src/persistence/public-payload-reader.ts` implementa os 10
getters: `getMovieDetailPayload`, `getTvDetailPayload`,
`getSeasonDetailPayload`, `getEpisodeDetailPayload`, `getPersonDetailPayload`,
`getHomePayload`, `getDiscoveryPayload`, `getSearchPayload`, `getMediaPayload`,
`getCatalogStatusPayload`. Os mappers PUROS (`src/public-payloads/`) terminam
no validador do proprio contrato — payload invalido lanca perto da origem.

Garantias (provadas por contract tests puros + checks em PostgreSQL real):
- midia/oferta `display_allowed=false` e rating de licenca bloqueada NUNCA
  chegam (gates no WHERE + fail-closed do builder);
- ids `string`, datas de obra `YYYY-MM-DD` (UTC), instantes ISO — JSON-safe;
- entidade que nao resolve (sem linha/slug canonico pt) => getter devolve
  `null` (404 tecnico), nunca payload pela metade;
- GOVERNANCA: `services/ingestion` nao referencia ratings (inv. 1/2) — o reader
  recebe `ApprovedRatingsSource` injetada (default vazio); o adapter pertence ao
  dominio de ratings.

### Indexabilidade no contrato (FAIL-CLOSED)

`SeoPayload.index`/`robots` NAO sao derivados de "a entidade tem slug". Slug e
resolucao de ROTA; indexabilidade e decisao REGISTRADA em
`page_indexability_decisions`. O reader le a decisao VIGENTE
(`is_current = true`) da entidade+locale e a projeta com
`projectPublicIndexability` (`@screena/seo`):

| decisao vigente | `index` | `robots` |
| --- | --- | --- |
| `index` | `true` | `index,follow` |
| `noindex` | `false` | `noindex,nofollow` (exclusao registrada) |
| `blocked` | `false` | `noindex,nofollow` |
| `draft` | `false` | `noindex,follow` |
| `stale` | `false` | `noindex,follow` |
| **ausente** | `false` | `noindex,follow` |

Ausencia de decisao e **fail-closed**: o silencio nunca autoriza indexar. Isso e
mais restritivo que `mergePersistedDecision` (que devolve a resolucao viva
quando nao ha persistida) de proposito — aquela fusao recebe os FATOS vivos
(licenca, idioma, validade tecnica) e pode decidir com eles; um contrato sem
esses fatos, nao. Quem tem os fatos vivos usa `resolvePageSeo` +
`mergePersistedDecision`; quem so tem a entidade usa a projecao.

Este getter **nao** decide indexabilidade, nao cria decisao e nao inclui nada em
sitemap — apenas PROJETA a decisao ja registrada.

### Prioridade de locale

`pt-BR` vence `pt`, resolvido em codigo por `pickByLocale`
(`src/public-payloads/locale-priority.ts`), nunca pela ordem que o banco
devolver — `findMany` sem `orderBy` nao tem ordem garantida (depende do plano),
e reduzir com `new Map(rows.map(...))` deixaria a ultima linha vencer. Vale para
os caminhos individuais E em lote (`personSlugs`, cards de home/discovery).

## Uso

```ts
import { validateMovieDetail, filterDisplayAllowedMedia } from '@screena/public-contracts'

const result = validateMovieDetail(payload)
if (!result.ok) throw new Error(result.errors.join('; '))
const safeMedia = filterDisplayAllowedMedia(result.value.media)
```

O getter server-only monta o payload a partir do Postgres; o validador e a rede de
seguranca na fronteira; o render consome so o `value` validado.
