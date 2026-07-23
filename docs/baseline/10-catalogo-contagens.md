# 10 — Contagens do catálogo e distribuição por entidade

> **Regra deste documento: nenhum número inventado.** O que é contável a partir do repositório está
> contado com a evidência. O que exige um banco populado está marcado como *não medido*, com o
> comando exato para medir.

---

## 1. Resultado principal: o catálogo do repositório é ZERO

O seed do repositório **não insere nenhuma entidade de entretenimento**. Ele popula apenas tabelas
de referência.

Evidência — modelos efetivamente escritos por `packages/db/prisma/seed.ts`:

```bash
grep -oP "prisma\.\K\w+" packages/db/prisma/seed.ts | sort -u
# apiProvider  country  language  ratingSource  sourceLicense
```

```bash
grep -in "movie\|tvShow\|person" packages/db/prisma/seed.ts
# (nenhum resultado)
```

### 1.1 Distribuição real do seed

| Entidade | Quantidade | Evidência |
| --- | --- | --- |
| `languages` | **3** | `packages/db/src/seed-data.ts:72` (`LANGUAGE_SEED`) |
| `countries` | **13** | `packages/db/src/seed-data.ts:79` (`COUNTRY_SEED`) |
| `api_providers` | **5** | `packages/db/src/seed-data.ts:124` (`API_PROVIDER_SEED`) |
| `rating_sources` | **5** | `packages/db/src/seed-data.ts:108` — derivado de `RATING_SOURCES` |
| `source_licenses` | **5** | `packages/db/src/seed-data.ts:136` — derivado de `RATING_SOURCES` |
| **`movies`** | **0** | nenhum seed |
| **`tv_shows`** | **0** | nenhum seed |
| **`seasons`** | **0** | nenhum seed |
| **`episodes`** | **0** | nenhum seed |
| **`people`** | **0** | nenhum seed |
| **`articles`** | **0** | nenhum seed |
| **`content_blocks`** | **0** | nenhum seed |
| **`external_ratings`** | **0** | nenhum seed |
| **`watch_availability`** | **0** | nenhum seed |

`RATING_SOURCES` = `["imdb", "rotten_tomatoes", "metacritic", "letterboxd", "filmaffinity"]`
(`packages/config/src/invariants.ts:84-90`).

### 1.2 Confirmação empírica pelo smoke test

O smoke test desta auditoria subiu o build de produção contra um banco recém-migrado e semeado.
Todas as rotas de listagem responderam **HTTP 200** servindo o **estado vazio** (12–15 KB de
HTML honesto, sem placeholder simulado) — ver `11-validacao-execucoes.md` §5.

Isso é um sinal **positivo** de honestidade de UI (a aplicação não fabrica catálogo), e ao mesmo
tempo confirma: **não há catálogo neste baseline**.

---

## 2. Como o catálogo é realmente populado

O catálogo só existe depois de rodar a ingestão TMDB **offline**, que exige credencial real
(`TMDB_READ_ACCESS_TOKEN` ou `TMDB_API_KEY`, `.env.example:34-35`).

Pipeline documentado em `docs/runbooks/catalog-bootstrap.md` e
`docs/runbooks/catalog-incremental-sync.md`.

Nenhuma chamada real a TMDB foi feita nesta auditoria (proibido por escopo: a etapa 00 não ativa
feature nem consome cota externa).

---

## 3. Comandos para obter contagens reais (banco populado)

Executar contra a `DATABASE_URL` do ambiente alvo. **Somente leitura.**

### 3.1 Distribuição por entidade

```sql
SELECT 'movies'              AS entidade, count(*) FROM movies
UNION ALL SELECT 'tv_shows',            count(*) FROM tv_shows
UNION ALL SELECT 'seasons',             count(*) FROM seasons
UNION ALL SELECT 'episodes',            count(*) FROM episodes
UNION ALL SELECT 'people',              count(*) FROM people
UNION ALL SELECT 'articles',            count(*) FROM articles
UNION ALL SELECT 'content_blocks',      count(*) FROM content_blocks
UNION ALL SELECT 'external_ratings',    count(*) FROM external_ratings
UNION ALL SELECT 'watch_availability',  count(*) FROM watch_availability
UNION ALL SELECT 'slugs',               count(*) FROM slugs
ORDER BY 1;
```

### 3.2 Distribuição de indexabilidade (quantas páginas realmente indexam)

```sql
SELECT entity_type, index_status, count(*)
FROM page_indexability_decisions
WHERE is_current = true
GROUP BY 1, 2
ORDER BY 1, 2;
```

### 3.3 Saúde do pipeline de ingestão

```sql
-- nenhuma ingestao silenciosa: todo sync gera log
SELECT provider_api, status, count(*), max(created_at) AS ultimo
FROM api_sync_logs
GROUP BY 1, 2
ORDER BY 1, 2;

-- frescor: o que esta stale
SELECT count(*) FILTER (WHERE stale_after < now()) AS stale,
       count(*)                                    AS total
FROM movies;
```

### 3.4 Blocos editoriais por estado de revisão

```sql
SELECT block_type, review_status, language_code, count(*)
FROM content_blocks
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;
```

---

## 4. Capacidade estrutural (o que o schema comporta)

Embora o catálogo esteja vazio, a **estrutura** existe e está validada em PostgreSQL real:

| Dimensão | Valor | Evidência |
| --- | --- | --- |
| Modelos Prisma | **75** | `grep -c "^model " packages/db/prisma/schema.prisma` |
| Enums Prisma | **42** | `grep -c "^enum " packages/db/prisma/schema.prisma` |
| Linhas de schema | **2328** | `wc -l packages/db/prisma/schema.prisma` |
| Migrations | **12** (178.123 bytes) | `packages/db/prisma/migrations/` |
| Asserções em PG real | **636** verdes | `11-validacao-execucoes.md` §3 |

A estrutura de catálogo está **pronta e provada**; o que falta é **dado**.
Ver classificação em [`07-subsistemas-classificacao.md`](07-subsistemas-classificacao.md).
