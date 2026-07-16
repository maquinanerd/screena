# Projecao de busca (search_documents)

> pt-BR. Nucleo puro em `services/ingestion/src/search/` (fold/projecao/query) e
> `src/search-projection/` (backfill + incremental); adapters em
> `persistence/search-store.ts` e `persistence/search-projection-source.ts`.

## Modelo

`SearchDocument` = projecao denormalizada, 1 linha por
`(entity_type, entity_id, locale)`, so renderaveis (movie/tv/person).
`normalized_text` guarda a dobra (sem acento, minusculo) de titulo + aliases; o
termo de busca e dobrado DO MESMO JEITO em JS — casamento deterministico, sem
depender do `unaccent` do Postgres coincidir com o JS. `normalized_aliases`
('|'-delimitado) permite casamento EXATO de alias (inclusive titulos longos).

## Ranking

titulo exato > alias exato > prefixo > fuzzy (pg_trgm); desempate similaridade
-> popularidade -> ano -> id. Consulta PARAMETRIZADA ($1..$5), limite <= 50.

## Operacao

```
pnpm catalog search-reindex --apply                     # backfill total
pnpm catalog search-reindex --entity movie --apply      # por tipo
pnpm catalog search-reindex --entity movie --id 42 --apply  # UMA entidade (id interno)
pnpm catalog search-status --json                       # cobertura por tipo
```

- `reindexAll` pagina pelos SLUGS canonicos: o conjunto indexavel E o que tem
  slug — um resultado nunca aponta para 404.
- `reindexEntity` faz upsert quando a entidade existe e DELETE quando sumiu ou
  ficou sem titulo (limpeza de documento stale, sem a qual a busca devolveria
  link morto). O handler `sync_details` reprojeta automaticamente apos
  created/updated (unchanged nao reescreve).
- A rota tecnica `/pt/busca` e sempre **noindex** e nao toca TMDB no request; o
  contrato (`SearchPayload`) fixa `index: false`.
