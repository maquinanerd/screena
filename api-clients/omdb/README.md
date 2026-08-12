# @screena/omdb-client

Client **offline** da [OMDb API](https://www.omdbapi.com/) — fornecedor
**tecnico** (`provider_api = "omdb"`) de ratings externos.

> **Worker-only.** Nunca importe este pacote no render publico
> (invariantes 3 e 4). Ele so e usado por `services/ratings`.

## O que ele faz

Um `GET /?i=<imdbID>` devolve, num unico payload, as notas de **tres fontes
editoriais distintas**:

| `Ratings[].Source`       | fonte editorial   | formato   | natureza |
| ------------------------ | ----------------- | --------- | -------- |
| `Internet Movie Database` | `imdb`            | `7.6/10`  | publico  |
| `Rotten Tomatoes`         | `rotten_tomatoes` | `85%`     | critica  |
| `Metacritic`              | `metacritic`      | `67/100`  | critica  |

**Este pacote nao interpreta nada disso.** Ele devolve o payload cru como
`unknown`. Separar as tres fontes, reatribuir cada nota a sua fonte editorial na
sua propria escala e recusar o que for ambiguo e responsabilidade de
[`services/ratings/src/omdb/mapping.ts`](../../services/ratings/src/omdb/mapping.ts)
— invariante 2: `provider_api` nunca e `rating_source`.

## `Response: "False"` vem com HTTP 200

A OMDb sinaliza erro (id inexistente, chave invalida, cota estourada) com
**HTTP 200** e um corpo `{ "Response": "False", "Error": "..." }`. Para o
executor HTTP isso e sucesso. O reconhecimento desse caso vive no mapper, de
proposito: assim ele e testavel sem rede e nunca vira "0 notas" silencioso.

## Configuracao

| Variavel                  | Obrigatoria | Default              |
| ------------------------- | ----------- | -------------------- |
| `OMDB_API_KEY`            | **sim**     | —                    |
| `OMDB_BASE_URL`           | nao         | `https://www.omdbapi.com` |
| `OMDB_MAX_RPS`            | nao         | `1`                  |
| `OMDB_MAX_RETRIES`        | nao         | `3`                  |
| `OMDB_BREAKER_THRESHOLD`  | nao         | `5`                  |
| `OMDB_BREAKER_COOLDOWN_MS`| nao         | `30000`              |
| `OMDB_TIMEOUT_MS`         | nao         | `15000`              |
| `OMDB_CACHE_TTL_MS`       | nao         | `86400000` (24h)     |

A chave vive **so** em variavel de ambiente — nunca no frontend, nunca
versionada.

### Por que a chave vai na querystring

A OMDb **nao aceita** a chave em header: `?apikey=` e o unico mecanismo. Por
isso `@screena/rapidapi-core` ganhou o modo de auth `query-param` (o default
continua sendo o header RapidAPI, e nenhum client existente mudou).

O segredo continua fora de erro, log, relatorio e `api_cache`, e isso e
**estrutural**:

- `RapidApiHttpError` carrega o **path** (`endpoint`), nunca a URL montada;
- falha de transporte vira mensagem sintetica — o erro cru do `fetch`, que
  carrega a URL em `cause`, nunca propaga;
- a chave e injetada em `buildUrl` e **nunca** entra no `params` que vira
  `api_cache.request_key`.

Travado por [`__tests__/secret-handling.test.ts`](src/__tests__/secret-handling.test.ts).

## Cota

O plano gratuito da OMDb sao **1.000 requisicoes por dia**. Como uma requisicao
devolve as tres notas, o teto vale em **entidades por dia**, nao em notas. O
worker conta e reporta o consumo (`quota_cost` em `api_sync_logs`); a protecao
real e o `--limit` mais a selecao por frescor (`RATING_STALE_POLICY`), que nao
reconsulta quem foi visto ha pouco.
