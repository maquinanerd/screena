# Dicionario de generos: por que ele derrubou o catalogo e como popula-lo

> Incidente de 25/08/2026. Leia antes de mexer em `genres`, em
> `movie_genres`/`tv_show_genres`, ou de investigar `P2003` na fila de catalogo.

## O que aconteceu

`genres` estava com **ZERO linhas** em producao. `movie_genres` e
`tv_show_genres` tem FK **composta** para `genres(media_type, tmdb_id)`
(migration `20260820120000_person_biography_and_title_genres`).

Uma FK violada ali **nao pula a linha**: ela estoura `P2003` e **aborta a
transacao inteira** de `upsertMovie`/`upsertTvShow`. O titulo nao entra, os
creditos nao entram, os ids externos nao entram — tudo por causa de um
dicionario vazio.

O log do PostgreSQL nomeava as duas constraints:

```
movie_genres_genre_media_type_genre_tmdb_id_fkey
  Key (genre_media_type, genre_tmdb_id)=(movie, 28) is not present in table "genres"
tv_show_genres_genre_media_type_genre_tmdb_id_fkey
  Key (genre_media_type, genre_tmdb_id)=(tv, 18) is not present in table "genres"
```

Estado da fila no momento da medicao: `pending` 80.442 · `retry_wait` 8.366 ·
`succeeded` 5.475 · `dead_letter` 509.

### O sintoma que nomeou o defeito

`/pt/series/` listava so titulo obscuro e sem poster. **Nao era aleatorio**: eram
os unicos titulos **sem genero** — os unicos que passavam na FK. Toda serie
conhecida tem genero, batia no `P2003` e era rejeitada inteira.

O banco filtrava ao contrario: guardava o obscuro e recusava o popular. Nenhum
contador dizia isso; a pagina dizia.

## Por que "rodar o seed" nao era a resposta

`genres` **nao tinha nenhum portador que chegasse em producao**:

| Portador | Existe? |
| --- | --- |
| `packages/db/src/seed-data.ts` (`db:seed`) | nao |
| migration data-only idempotente | nao |
| fila no agendador (`services/sync/src/scheduler/rhythms.ts`) | nao — sao 12 filas, nenhuma de taxonomia |
| CLI `bin/sync-tmdb.ts genres --apply` | sim, mas **abortava em producao** sem escape hatch |

Nao era "faltou rodar o seed". **Nao havia caminho autorizado para roda-lo la.**

Compare com o caso `tmdb-exports` (migration `20260821130000_api_provider_tmdb_exports`):
toda invariante de dado-semente precisa de **DOIS portadores** — seed para banco
novo, migration para banco existente. `genres` tinha zero.

## Como popular (producao)

O gate agora tem uma excecao **estreita**, decidida por
[`production-authorization.ts`](../../services/ingestion/src/config-sync/production-authorization.ts):
`--apply` em producao continua proibido, **exceto** para os subcomandos de
dicionario — `configuration`, `taxonomies`, `genres`.

```bash
CINERIE_SYNC_TMDB_PRODUCTION_CONFIRMED=true corepack pnpm --filter @screena/ingestion exec tsx bin/sync-tmdb.ts genres --apply
```

| Variavel | Valor | Obrigatoria? |
| --- | --- | --- |
| `CINERIE_SYNC_TMDB_PRODUCTION_CONFIRMED` | `true` | **sim** — sem ela o comando recusa |
| `DATABASE_URL` | conexao do banco publico | sim |
| `TMDB_READ_ACCESS_TOKEN` (ou `TMDB_API_KEY`) | credencial TMDB | sim |
| `TMDB_DEFAULT_LANGUAGE` | default `pt-BR` | nao |

Notas de operacao:

- **Custo: 8 requisicoes**, nao 2. `runTaxonomySync` percorre os 8 endpoints de
  `TAXONOMY_ENDPOINTS` sempre; so 2 deles (`/genre/movie/list` e
  `/genre/tv/list`) escrevem em `genres`. Os outros 6 sao capturados em
  `api_cache` e logados, como qualquer sync.
- **Os nomes vem em pt-BR** pelo `defaultLanguage` do client (`TMDB_DEFAULT_LANGUAGE`,
  default `pt-BR`). Proveniencia real da fonte — nao lista digitada a mao.
- **Idempotente**: o upsert de `genres` so reescreve o que mudou; rodar duas
  vezes nao duplica nem bumpa linha igual.
- **Gera log**, como todo sync externo: uma linha por endpoint em
  `api_sync_logs` (regra de `.claude/rules/ingestion.md`).

`lists`, `discover`, `trending` e `media` escrevem catalogo em massa e **mantem o
veto duro** em producao: a env var nao os libera, e a mensagem de recusa diz
isso explicitamente em vez de sugerir uma variavel que nao resolveria.

## Conferindo

```bash
psql -U screena -d screena -c "SELECT media_type, count(*) FROM genres GROUP BY 1;"
```

Esperado: `movie` 19 · `tv` 16 (a taxonomia do TMDB muda raramente; conferir a
contagem, nao decorar).

## A segunda metade do conserto

Popular o dicionario resolve o incidente. **Nao** resolve a fragilidade: um
genero novo criado pelo TMDB depois do ultimo sync de taxonomia voltaria a
derrubar o titulo inteiro.

Por isso `replaceTitleGenres`
([`store.ts`](../../services/ingestion/src/persistence/store.ts)) agora filtra
contra o dicionario antes de inserir (`keepKnownGenres`). O comentario que
morava ali **afirmava** que esse filtro existia — e ele nao existia em lugar
nenhum do repositorio. Contrato escrito e nao implementado.

Com o filtro, dicionario incompleto degrada para "o titulo entra sem vinculo de
genero" em vez de "o titulo nao entra". `skipDuplicates` **nao** cobre isso: ele
resolve conflito de PK, nunca FK.

Travado por
[`store-genres.test.ts`](../../services/ingestion/src/persistence/__tests__/store-genres.test.ts)
e
[`production-authorization.test.ts`](../../services/ingestion/src/config-sync/__tests__/production-authorization.test.ts).

## Depois de popular

Os jobs em `retry_wait` **voltam sozinhos**: o claim e
`WHERE status IN ('pending','retry_wait') AND available_at <= now`
([`catalog-job-store.ts`](../../services/ingestion/src/persistence/catalog-job-store.ts)).
Nao ha nada a reagendar.

Os `dead_letter` **nao** voltam sozinhos — mas confira a causa antes de
reprocessar. Em 25/08 os 509 `dead_letter` eram todos `upstream_not_found` (404
do TMDB, falha PERMANENTE que vai direto para dead-letter sem gastar tentativa),
e **nenhum** era do `P2003` de genero. Reprocessa-los gastaria 509 requisicoes
para colher 509 novos 404.

```bash
corepack pnpm --filter @screena/ingestion exec tsx bin/catalog.ts dead-letter list --limit 20
```

O `replay` usa **limite padrao de 50**; para lotes maiores, passe `--limit`
explicitamente.

## Relacionado

- [`drenar-a-fila-2026-08-21.md`](./drenar-a-fila-2026-08-21.md) — operacao do worker de catalogo.
- [`ingestion-scheduler.md`](./ingestion-scheduler.md) — as 12 filas e o relogio.
- [`.claude/rules/ingestion.md`](../../.claude/rules/ingestion.md) — regras de ingestao (log obrigatorio, worker-only).
