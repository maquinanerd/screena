# CLI unificada `pnpm catalog`

> Operacional (pt-BR). Worker-only/offline — NUNCA no render. Nucleo puro em
> `services/ingestion/src/cli/` (parser/ajuda/exit codes/gate, testado sem
> banco); entrypoint `services/ingestion/bin/catalog.ts` (coberto por
> `pnpm typecheck:catalog-runtime`).

## Principio

Uma entrada unica para operar o catalogo. Os comandos diretos executam **os
mesmos handlers** que o worker roda em producao (`runHandlerInline`) — nao ha
caminho paralelo "so do CLI" que possa divergir.

## Comandos

| Comando | Faz | Muta? |
| --- | --- | --- |
| `bootstrap` | enfileira a cascata (descoberta -> detalhes -> midia -> busca) | sim |
| `enqueue <job_type>` | enfileira UM job (payload validado ANTES de gravar) | sim |
| `worker` | processa a fila (drain gracioso; reclaim periodico de orfaos) | — |
| `sync` | detalhe de uma entidade (`--id` ou `--ids-file`) | sim |
| `changes` | incremental `/changes` com checkpoint transacional | sim |
| `discovery` | captura lista -> snapshot (hash-noop) | sim |
| `media` | imagens/videos de movie/tv/person (`display_allowed=false`) | sim |
| `episodes` | episodios de uma serie/temporada | sim |
| `search-reindex` | reprojeta search_documents (total/por tipo/`--id` uma) | sim |
| `search-status` | cobertura da projecao de busca | nao |
| `status` | fila, checkpoints, snapshots, docs de busca | nao |
| `audit-database` | relatorio somente-leitura do banco | nao |
| `dead-letter list\|replay` | inspeciona/reprocessa poison | replay sim |

## Regras que o parser IMPOE (fail-loud)

- Comando que muta exige `--dry-run` (calcula, nao toca nada) OU `--apply`.
  O worker e a excecao documentada (a acao dele E processar).
- Flag desconhecida, valor faltante, inteiro invalido, data impossivel
  (`2026-02-31`), janela invertida (`--from > --to`) e combinacao invalida
  FALHAM — nunca caem em default silencioso.
- `--dry-run` nao monta o runtime: zero Prisma, zero TMDB, zero cota, por
  construcao.
- Producao (`NODE_ENV=production`): escrita exige `--force`; leitura exige
  `--confirm-production-read`. Sem `DATABASE_URL`, nada roda.
- Comandos so-de-banco (`status`, `search-status`, `audit-database`,
  `dead-letter`, `enqueue`) NAO exigem token TMDB.
- Toda saida passa por `redactSecrets` (a `DATABASE_URL` e senhas de connection
  string nunca aparecem, nem em erro de driver).

## Exit codes (contrato para automacao)

| Code | Significado |
| --- | --- |
| 0 | ok |
| 1 | erro inesperado |
| 2 | uso invalido (comando/flag/combinacao) |
| 3 | bloqueado por gate (producao sem confirmacao; sem DATABASE_URL) |
| 4 | rodou mas terminou com falha (ex.: dead-letter no ciclo) |

## Exemplos

```
pnpm catalog bootstrap --strategy daily-exports --entity movie,tv,person --limit 1000 --apply
pnpm catalog worker --concurrency 4 --poll-interval-ms 1000 --max-jobs 0
pnpm catalog changes --entity movie --from 2026-07-15 --to 2026-07-16 --resume --apply
pnpm catalog discovery --list trending --entity movie --window day --country BR --apply
pnpm catalog status --json
pnpm catalog audit-database --json --confirm-production-read
```
