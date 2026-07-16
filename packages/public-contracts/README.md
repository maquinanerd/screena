# @screena/public-contracts

Contratos publicos **serializaveis** do Screen: a fronteira tipada entre os
getters server-only (que leem o PostgreSQL) e o render/consumidores. Namespace
tecnico legado `@screena/public-contracts`; a marca publica e **Screen**.

## Principios

- **Sem Prisma no contrato.** Ids sao `string` (nunca `BigInt`), datas sao ISO
  `string`, nada de tipos gerados pelo Prisma. Um payload e sempre JSON-safe.
- **Sem zod.** O repo nao usa zod (ver `docs/adr/0012-complete-catalog-platform.md`).
  Cada payload tem um validador PURO no estilo de `@screena/schemas`
  (`validateX(input): { ok, errors, value }`), sem rede/DB/IO.
- **Fonte unica de literais.** Locales e enums vem de `@screena/config`
  (reexportados), nunca re-listados aqui.
- **Governanca de midia (invariante 6).** `PublicMediaAsset.displayAllowed` e a
  flag-mestra; `filterDisplayAllowedMedia` remove o que nao pode ser exibido. O
  contrato nunca carrega `file_path` cru — so a `url` final.
- **Busca e sempre noindex.** `SearchPayload.index` e o literal `false`.

## Conteudo

| Modulo | Contratos |
| --- | --- |
| `primitives` | `EntityRef`, `PublicMediaAsset`, `PublicVideo`, `MediaPayload`, `Credit`, `SeoPayload` |
| `detail` | `MovieDetailPayload`, `TvDetailPayload`, `SeasonDetailPayload`, `EpisodeDetailPayload`, `PersonDetailPayload` |
| `home` | `EntityCard`, `HomePayload`, `DiscoveryPayload` |
| `search` | `SearchResult`, `SearchPayload` |
| `catalog-job` | `CatalogJobView`, `CatalogStatusPayload` |

Os campos de valor ainda inativos como feature publica (ratings/streaming)
existem como arrays OPCIONAIS/vazios: o contrato descreve o presente sem forcar
dado que nao renderiza.
