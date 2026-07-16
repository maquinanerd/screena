# Snapshots de descoberta (discovery_snapshots)

> pt-BR. Nucleo puro em `services/ingestion/src/discovery-snapshots/`; adapter
> em `persistence/discovery-snapshot-store.ts`; captura pelo handler
> `sync_lists` (fila ou `pnpm catalog discovery`).

## Modelo

Uma lista do TMDB (trending/popular/top_rated/upcoming/now_playing/
airing_today/on_the_air/discover) vira um SNAPSHOT imutavel + itens ordenados
(`position` densa 0-based — a ordem da lista E o dado). O render NUNCA chama o
TMDB: le o ultimo snapshot VALIDO (`captured_at`/`expires_at`, TTL por tipo de
lista — trending 6h, popular 12h, top_rated/upcoming/now_playing 24h...).

## Propriedades

- **hash-noop**: o hash cobre o CONTEUDO paginado (ids+posicoes+scores), nao a
  resposta crua (`page`/`total_pages` oscilam sem a lista mudar). Lista igual e
  ainda valida => `created=false`, nenhum snapshot novo.
- **so entidade promovida**: item cujo tmdbId nao resolve para uma entidade
  interna e IGNORADO — snapshot nunca aponta para link morto.
- **identidade** = (listType, entityType, locale, country, window). A identidade
  canonica que os getters de home/descoberta consomem e SEM country/window
  (null/null) — quem captura para consumo do site usa essa forma.

## Operacao

```
pnpm catalog discovery --list trending --entity movie --window day --apply
pnpm catalog discovery --list popular --entity tv --apply
pnpm catalog status --json     # inclui frescor (ageSeconds/expired) dos snapshots
```

Consumo: `getHomePayload()` (hero/trending/upcoming) e
`getDiscoveryPayload(listType, entityType)` leem o ultimo snapshot valido e
montam `EntityCard[]` — sem snapshot, listas VAZIAS (nunca mock).
