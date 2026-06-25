# @screena/types

Unioes de **string literais** compartilhadas por todo o monorepo Screena.

Este e um pacote de fundacao puro: contem **apenas tipos** (`type`), sem nenhum
codigo de runtime, sem side effects e sem dependencias de outros pacotes
`@screena/*`. Ele define o vocabulario canonico das entidades e dos fluxos
editoriais/de indexacao, para que `@screena/schemas`, `@screena/seo`,
`@screena/ui`, `@screena/db` e os apps importem daqui em vez de redeclarar
strings soltas.

> Diferenca para `@screena/config`: aqui ficam **tipos** (uniao de literais,
> apagados no build). Em `@screena/config` ficam as **constantes** com valor em
> runtime (arrays/objetos `as const`, invariantes, tokens de cor). Os dois devem
> permanecer coerentes.

## API

| Export          | Literais                                                                                            | Descricao                                              |
| --------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `EntityType`    | `movie` `tv` `season` `episode` `person` `franchise`                                                 | Tipo de entidade de catalogo.                          |
| `LanguageCode`  | `pt-BR` `en` `es`                                                                                    | Idioma de conteudo (pt-BR publica primeiro).           |
| `CountryCode`   | `string`                                                                                             | Codigo de pais (ISO 3166-1 alpha-2 esperado).          |
| `ReviewStatus`  | `draft` `ai_generated` `needs_review` `human_reviewed` `published` `needs_update` `blocked` `archived` | Ciclo de revisao de `content_blocks`.                  |
| `IndexStatus`   | `index` `noindex` `draft` `stale` `blocked`                                                          | Decisao de indexabilidade de pagina.                   |
| `OfferType`     | `subscription` `rent` `buy` `free` `ads` `cinema`                                                    | Tipo de oferta de "onde assistir".                     |
| `LicenseStatus` | `official` `licensed` `third_party` `unknown` `blocked`                                              | Status de licenca de uma fonte de dados.               |
| `JobStatus`     | `queued` `claimed` `running` `completed` `failed` `blocked` `cancelled`                              | Status de job do pipeline offline.                     |

## Uso

```ts
import type {
  EntityType,
  LanguageCode,
  IndexStatus,
  ReviewStatus,
} from "@screena/types";

const entity: EntityType = "movie";
const lang: LanguageCode = "pt-BR";

// Pagina fina sem >=2 blocos de valor proprios recebe noindex.
const decision: IndexStatus = "noindex";

const status: ReviewStatus = "needs_review";
```

## Lembretes de invariantes

- `pt-BR` publica primeiro; `en`/`es` nascem em `draft`/`noindex` ate revisao
  humana.
- Dados com `LicenseStatus` `unknown`/`blocked` (ou `display_allowed = false`)
  nao aparecem em pagina indexavel.
- `OfferType` cobre apenas oferta **legal** de onde assistir: sem pirataria,
  torrent, IPTV, player ilegal, link de download ou embed pirata.
