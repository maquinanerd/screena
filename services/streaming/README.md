# services/streaming

Servico de **disponibilidade de streaming** (onde assistir). Mantem `watch_availability`,
`platforms` e `providers`, mapeando em quais plataformas, paises e modalidades (assinatura,
aluguel, compra, gratis com anuncios) cada entidade esta disponivel.

## O que faz
- Consulta os **api-clients** de disponibilidade (`streaming_availability` como primario;
  `kaso` apenas como fallback) para obter ofertas por pais. Contrato real (v4):
  `GET /shows/{imdbId}?series_granularity=episode&output_language=en`.
- **Matching por IMDb id real** (vindo de `entity_external_ids`): a chave da chamada e o
  IMDb id da entidade local, nunca o titulo nem o TMDB id. O payload devolve
  `streamingOptions` agrupado por pais; o worker filtra **apenas `br`** (sem fallback
  internacional).
- Grava cada oferta LEGAL em `watch_availability` com `display_allowed=false`. Nesta fase
  nao mexe em `platforms`/`providers` (modelagem futura).
- Mantem a oferta por **pais**, base do bloco de valor "onde assistir por pais".

Nesta fase o worker grava **apenas** `watch_availability` (nao mexe em `platforms`/
`providers`, que seguem como modelagem futura).

## Como roda
- **Worker TypeScript/Node, sempre offline** (`@screena/streaming`). Python 3.12 segue como
  roadmap/shim, nao como implementacao atual (CLAUDE.md secao 4); agendamento por
  **systemd timers** e roadmap.
- **NUNCA e chamado no render publico.** A pagina `/pt/.../onde-assistir/` le apenas o que
  foi persistido no PostgreSQL.

### CLI

```bash
TSX="$(ls node_modules/.pnpm/tsx@*/node_modules/tsx/dist/cli.mjs | head -1)"

# dry-run (default): so o plano (quais URLs seriam chamadas). Zero rede, zero escrita.
node "$TSX" services/streaming/bin/sync-streaming-availability.ts --kind=movie --country=BR --limit=5

# sample: busca o payload real, grava api_cache + api_sync_logs e escreve um
# sample SANITIZADO em services/streaming/.data/ (gitignored).
node "$TSX" services/streaming/bin/sync-streaming-availability.ts --kind=movie --country=BR --limit=5 --sample

# apply: replace transacional do snapshot de ofertas daquela entidade/pais.
node "$TSX" services/streaming/bin/sync-streaming-availability.ts --kind=tv --country=BR --limit=5 --apply
```

Flags: `--kind=movie|tv` (obrigatorio), `--country=BR` (default), `--limit=N`,
`--tmdb-id=ID` / `--imdb-id=ID` (mutuamente exclusivos), `--sample`, `--apply`,
`--report=<arquivo>`. Note que `--sample` tambem exige `DATABASE_URL`: as entidades a
consultar vem do PostgreSQL.

### Revisao e promocao governada (`display_allowed`)

A ingestao grava **tudo** como `display_allowed=false` (invariante 6). Levar uma oferta ao
ar e uma **decisao humana** separada, feita por dois CLIs **offline, so-banco** (zero rede,
zero RapidAPI, zero schema novo). O nucleo puro vive em
[`src/promotion/`](src/promotion) (guardrails, parsers, orquestracao, relatorio); o acesso
Prisma em [`src/persistence/watch-review-store.ts`](src/persistence/watch-review-store.ts).

**Revisao (read-only)** — lista as candidatas e mostra se cada uma passaria nos guardrails,
sem alterar nada:

```bash
# listar candidatas
node "$TSX" services/streaming/bin/review-watch-availability.ts --kind=movie --country=BR --limit=20
# filtrar por entidade
node "$TSX" services/streaming/bin/review-watch-availability.ts --kind=movie --entity-id=1 --country=BR
# exportar relatorio markdown em .data/ (gitignored)
node "$TSX" services/streaming/bin/review-watch-availability.ts --kind=movie --entity-id=1 --country=BR --report
```

**Promocao/reversao (por ids EXPLICITOS)** — sem `--confirm` e sempre **dry-run**; com
`--confirm` so as linhas **elegiveis** viram `display_allowed=true`. `--revoke` volta para
`false`:

```bash
# dry-run: mostra o que SERIA promovido, nada muda
node "$TSX" services/streaming/bin/promote-watch-availability.ts --ids=1,2,3 --country=BR
# promocao real (so as elegiveis)
node "$TSX" services/streaming/bin/promote-watch-availability.ts --ids=1,2,3 --country=BR --confirm
# reversao
node "$TSX" services/streaming/bin/promote-watch-availability.ts --ids=1,2,3 --country=BR --revoke --confirm
```

Guardrails de promocao (a primeira violacao e reportada): `wrong-provider` (so
`streaming_availability`), `wrong-country` (so BR), `already-display-allowed`,
`invalid-offer-type` (so `subscription|free|rent|buy`; nunca `ads`/`cinema`/`addon`),
`missing-provider` (exige `provider_key` **e** `provider_name`), `missing-link`,
`unsafe-link` (so `http(s)`, sem marcador de pirataria) e `expired` (`available_until` no
passado). O `updateMany` reafirma provider/pais/estado no `WHERE` (defesa em profundidade) e
toca **apenas** a coluna `display_allowed` — nunca `screen_score`/`external_ratings`. Cada
acao efetiva registra 1 linha tecnica em `api_sync_logs` (`promote:watch_availability` /
`revoke:watch_availability`).

### Idempotencia sem unique

`watch_availability` **nao tem chave natural unica**. Reexecutar `--apply` nao pode
duplicar linha, entao a escrita e um **replace transacional do snapshot**:

```
BEGIN
  DELETE FROM watch_availability
   WHERE entity_type=$1 AND entity_id=$2 AND country_code=$3
     AND provider_api='streaming_availability'
  INSERT ... (ofertas novas)
COMMIT
```

O `DELETE` e **escopado pelo `provider_api` deste worker**: linhas de outros fornecedores
(inclusive o seed demo, e qualquer curadoria humana futura sob outra chave) permanecem
intactas.

### `addon` nao vira `subscription`

O upstream devolve `type` em `free|subscription|buy|rent|addon`. O enum `OfferType` e
`subscription|rent|buy|free|ads|cinema` — **nao existe `addon`**. Um addon e uma camada
**paga** dentro de outro servico (ex.: um canal via Prime): mapea-lo para `subscription`
afirmaria ao usuario uma modalidade comercial **falsa**. Por isso o worker o **descarta** e
o conta como `unmapped-offer-type` no relatorio. Modelar `addon` corretamente exige
migration propria e decisao de produto — fase futura.

## Resiliencia obrigatoria
- **Cache** (`api_cache`), **retry** com **backoff**, **rate-limit**, **circuit-breaker**
  e **logs** de sync em `api_sync_logs` — via
  [`api-clients/rapidapi-core`](../../api-clients/rapidapi-core).
- `fetched_at` e `stale_after` (24h; a doc indica atualizacao diaria) em toda linha.

## Invariantes aplicaveis
- **Nada nasce exibivel.** Toda oferta recebe `display_allowed = false`
  **estruturalmente**. Os termos do provider exigem atribuicao visivel
  ("Streaming Availability API by Movie of the Night" + link); enquanto ela nao existir na
  UI, nada aparece publicamente.
- **`screen_score` e `external_ratings` nao sao tocados** por este worker.
- **Sem pirataria** — somente plataformas legais e links oficiais. Nada de torrent, IPTV,
  player ilegal, link de download ou embed pirata. `deep_link` so aceita `http(s)`.
- **Zero API externa no render** — disponibilidade vem do banco, nunca de chamada ao vivo.
- **kaso e apenas fallback** — nao usar no MVP se `streaming_availability` ja resolver.
- **Dados sem licenca clara nao aparecem** em pagina indexavel.
- **provider_api != rating_source** — disponibilidade nao se confunde com nota editorial.
- **API keys so em env vars.**
