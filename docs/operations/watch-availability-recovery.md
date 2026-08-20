# Disponibilidade ("onde assistir") pelo caminho normal de sync — operação

> Documento operacional. Explica **por que** o `catalog sync` não trazia
> disponibilidade, **o que mudou**, e **como recuperar** as entidades que já
> existem sem oferta. Não trata de licença, crédito nem acendimento de exibição:
> toda linha escrita aqui nasce `display_allowed = false` (invariante 6) e
> acender continua sendo decisão humana, por outro comando.

---

## 1. O defeito (medido em 2026-08-19)

`catalog sync --apply` sincronizou 10 séries e 29 filmes. Todos responderam
`ok`. Nenhum ganhou uma única oferta em `watch_availability`.

A causa **não** era o `append_to_response`. A requisição real já pedia
`watch/providers`:

| Tipo | Sub-recursos no append real | Requisições | `watch/providers` |
| --- | --- | --- | --- |
| `movie` | 13 | 1 | **sim** |
| `tv` | 16 | 1 | **sim** |
| `tv_season` | 7 | 1 | **sim** |
| `person` | 6 | 1 | não (o endpoint não oferece) |

Fonte: [`api-clients/tmdb/src/append-to-response.ts`](../../api-clients/tmdb/src/append-to-response.ts),
medido por `partitionAppend`.

A string `'external_ids,credits'` de
[`services/ingestion/src/import/import-movie.ts`](../../services/ingestion/src/import/import-movie.ts)
**nunca foi o append da requisição**. Ela é o rótulo de `params` da **chave** de
`api_cache`: `buildCacheKey`
([`src/utils/cache-key.ts`](../../services/ingestion/src/utils/cache-key.ts))
usa `params` só para montar `requestKey`/`paramsHash`, e o `fetcher` é chamado
**sem argumentos** — quem monta a URL é `getMovie`/`getTvShow`, com o append
rico.

O byte da disponibilidade chegava, era gravado em `api_cache` e **o
normalizador de detalhe o descartava**: `normalizeMovie` lê apenas `credits`,
`external_ids` e os campos base.

> **Consequência prática, e a armadilha a evitar:** "acrescentar
> `watch/providers` ao append do `catalog sync`" não faria o TMDB devolver nada
> de novo — e ainda invalidaria **toda** linha de `api_cache` (a chave mudaria),
> forçando um refetch do catálogo inteiro em troca de **zero** oferta.

---

## 2. O que mudou

[`services/ingestion/src/watch-providers/from-detail.ts`](../../services/ingestion/src/watch-providers/from-detail.ts)
reconhece o bloco `watch/providers` do payload de detalhe **que o import já tem
em mãos** e grava o snapshot pelo **mesmo** `WatchOfferStore` que o
reprocessamento do bruto já usa em produção.

- **Custo em cota: zero.** Nenhuma chamada nova ao TMDB.
- Roda no caminho de upsert **e** no short-circuit de cache (payload inalterado,
  onde o import não tem id em mãos e o sink resolve pelo `tmdbId`). Sem isso, uma
  passada de recuperação sobre o catálogo já sincronizado devolveria `ok` e
  gravaria zero oferta — o mesmo defeito, uma camada mais fundo.
- Territórios ingeridos: `DEFAULT_WATCH_TERRITORIES` (`['BR']`). Oferta de país
  fora do escopo é **descartada e contada**, nunca gravada.
- Frescor da oferta: 1 dia (`watchStaleWindowMs`), deliberadamente menor que os
  7 dias do detalhe — "onde assistir" é o dado volátil da tabela de
  periodicidades de [`.claude/rules/ingestion.md`](../../.claude/rules/ingestion.md).

### Desfechos nomeados

Nenhum colapsa no outro. `sync` os imprime; a fila os emite como métrica
`catalog_detail_watch_total{watch_outcome=...}`.

| Desfecho | Significado |
| --- | --- |
| `applied` | ofertas reconhecidas no escopo e gravadas |
| `empty` | payload reconhecido, zero oferta — **o título** não tem oferta |
| `out-of-scope` | tem oferta, mas nenhuma nos territórios ingeridos |
| `unrecognized` | bloco ausente/anômalo — **nós** é que não sabemos; snapshot preservado |
| `unresolved` | entidade ainda não promovida: sem id interno, sem FK |
| `failed` | erro na escrita (classe + mensagem sanitizada) |
| `not-configured` | o runtime não tem sink de ofertas ligado |
| `not-applicable` | pessoa / entidade de referência: não existe "onde assistir" |

---

## 3. Recuperação das entidades que já existem sem oferta

**Não precisa de flag nova.** Depois da mudança, `catalog sync --ids-file` basta
— inclusive com o cache quente, porque o short-circuit também materializa.

### 3.1 A consulta que produz os ids

Entidades do catálogo **sem nenhuma oferta de origem TMDB**. Roda por tipo
porque `catalog sync` recebe um `--entity` por execução.

```sql
-- FILMES sem oferta de origem TMDB
SELECT m."tmdb_id"
  FROM "movies" m
 WHERE NOT EXISTS (
         SELECT 1
           FROM "watch_availability" w
          WHERE w."entity_type" = 'movie'
            AND w."entity_id"   = m."id"
            AND w."provider_api" = 'tmdb'
       )
 ORDER BY m."tmdb_id";

-- SERIES sem oferta de origem TMDB
SELECT t."tmdb_id"
  FROM "tv_shows" t
 WHERE NOT EXISTS (
         SELECT 1
           FROM "watch_availability" w
          WHERE w."entity_type" = 'tv'
            AND w."entity_id"   = t."id"
            AND w."provider_api" = 'tmdb'
       )
 ORDER BY t."tmdb_id";
```

`provider_api = 'tmdb'` no `WHERE` não é detalhe: uma entidade pode ter oferta
vinda da RapidAPI e mesmo assim nunca ter passado por esta cadeia. Sem o filtro
de proveniência, a consulta esconderia exatamente as que precisam da passada.

Para gerar o arquivo de ids (uma linha por id, o formato que `--ids-file` lê):

```bash
psql "$DATABASE_URL" -At -c "<consulta acima>" > /tmp/ids-movie.txt
```

### 3.2 O comando

```bash
# NUNCA use `--` isolado: no pnpm 9.15.4 ele chega como argumento literal.
pnpm --filter @screena/ingestion catalog sync --entity movie --ids-file /tmp/ids-movie.txt --apply
pnpm --filter @screena/ingestion catalog sync --entity tv --ids-file /tmp/ids-tv.txt --apply
```

A saída passa a dizer o que **não** trouxe. O FORMATO (números aqui são
ilustrativos, não medidos):

```
sync movie: <N> ok · <F> falhou
onde assistir: <a> com oferta · <b> sem oferta · <c> nao reconhecida (+<k> ofertas)
  27205: inalterado (+1 jobs) · onde assistir: com oferta (+3)
```

E quando nada é materializado, o lote grita em vez de calar — esta linha só
aparece se **nenhuma** entidade do lote ficou `applied`:

```
ATENCAO: nenhuma oferta de disponibilidade foi gravada neste lote
(39 de 39 entidades sem oferta materializada).
```

### 3.3 Custo em chamadas TMDB

| Cenário | Requisições ao TMDB |
| --- | --- |
| **Antes** da mudança, por filme | 1 (detalhe) + 2 (`sync_media`: `images` + `videos`) = **3** |
| **Antes**, por série de _S_ temporadas | 1 (detalhe) + _S_ (temporadas) + 2 (`sync_media`) = **3 + S** |
| **Depois**, mesmos cenários | **idêntico** — a disponibilidade sai do payload já baixado |
| Recuperação das entidades órfãs | 1 por entidade cujo cache esteja frio; **0** para as que estiverem dentro do TTL de 24 h de `api_cache` |
| Semente de ~10 000 títulos | **0 chamadas a mais** do que o plano já previa |

O detalhe cabe em **uma** requisição em todos os tipos: nenhum append passa do
teto de 20 sub-requests (`TMDB_APPEND_LIMIT`), então `partitionAppend` devolve um
único bloco. Foi medido, não estimado.

---

## 4. O que continua faltando (declarado, não silenciado)

Sub-recursos que **já são baixados** no append de detalhe e **não têm
normalizador** hoje. Não estão no escopo desta mudança; ficam registrados para
que ninguém os "descubra" de novo como se fossem custo novo:

| Sub-recurso | Situação |
| --- | --- |
| `release_dates` (movie) | baixado, descartado — sem consumidor |
| `content_ratings` (tv) | baixado, descartado — sem consumidor |
| `episode_groups`, `screened_theatrically` (tv) | baixados, descartados |
| `tagged_images` (person) | baixado, descartado |
| `images`, `videos` | baixados no detalhe **e** rebaixados por `sync_media` |

O caso de `images`/`videos` merece nota: o `sync_media` **não** é redundante por
acidente. Os endpoints dedicados (`/movie/{id}/images`, `/movie/{id}/videos`) são
chamados **sem** `language` (`buildUrl` não injeta idioma nenhum), então devolvem
todos os idiomas; o bloco do append herda o `language=pt-BR` da requisição de
detalhe e vem filtrado. São conjuntos diferentes — trocar um pelo outro perderia
imagem. `watch/providers` não tem essa ressalva: o bloco do append é o dado
completo por país.

---

## 5. Relação com o reprocessamento do bruto

`bin/reprocess-watch-providers` continua existindo e continua sendo o caminho
para materializar oferta a partir do **depósito do bruto** (`tmdb_raw`/R2), sem
rede. As duas cadeias são complementares e não se atropelam:

- ambas escrevem pelo **mesmo** `WatchOfferStore`, com `provider_api = 'tmdb'`;
- o `replaceSnapshot` é por `(entidade, país, provider_api)` e revoga o que
  sumiu do snapshot pelo `fetched_at` daquela execução — a passada mais recente
  vence, seja qual for a cadeia que a produziu;
- `bin/sync-tmdb-raw` continua recusando rodar em produção. Esta mudança **não**
  fura esse portão: ela não lê nem escreve o depósito do bruto.

Relacionado: [`docs/backend/streaming-platform.md`](../backend/streaming-platform.md),
[`.claude/rules/ingestion.md`](../../.claude/rules/ingestion.md).
