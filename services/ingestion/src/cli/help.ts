/**
 * help.ts — Texto de ajuda da CLI `pnpm catalog` (PURO).
 *
 * Cada comando traz um EXEMPLO REAL e copiavel. Ajuda que so lista flags obriga
 * o operador a adivinhar a combinacao valida — e a combinacao errada, num
 * comando que muta catalogo, custa cota ou dado.
 */

import type { CatalogCommand } from './args.js'

/** Cabecalho comum. */
const HEADER = `catalog — CLI offline do catalogo Cinerie (worker-only; NUNCA no render).

Uso: pnpm catalog <comando> [flags]

Comandos que MUTAM estado exigem --dry-run (calcula e exibe) ou --apply
(executa). Sem um dos dois, o comando falha — nunca ha default silencioso.`

/** Ajuda geral. */
export function renderGeneralHelp(): string {
  return `${HEADER}

Comandos:
  bootstrap         Orquestra o catalogo do zero (descoberta -> detalhes -> midia -> busca)
  enqueue           Enfileira UM job avulso
  worker            Processa a fila (shutdown gracioso via SIGINT/SIGTERM)
  sync              Sincroniza o detalhe de uma entidade (ou de um arquivo de ids)
  changes           Incremental TMDB /changes com checkpoint transacional
  discovery         Captura uma lista de descoberta e grava o snapshot
  media             Sincroniza imagens/videos de uma entidade
  episodes          Sincroniza episodios de uma serie/temporada
  search-reindex    Reprojeta search_documents (total, por tipo ou por entidade)
  search-status     Cobertura da projecao de busca (somente leitura)
  status            Estado da fila, checkpoints e snapshots (somente leitura)
  audit-database    Relatorio somente-leitura do banco
  dead-letter       list | replay dos jobs esgotados

Flags globais:
  --dry-run                  calcula e exibe, sem gravar
  --apply                    executa de fato
  --json | --human           formato de saida (default: human)
  --request-id <id>          correlaciona o ciclo nos logs
  -h, --help                 ajuda (geral ou do comando)

Exemplos:
  pnpm catalog bootstrap --strategy daily-exports --entity movie,tv,person --limit 1000 --apply
  pnpm catalog worker --concurrency 4 --poll-interval-ms 1000 --max-jobs 0
  pnpm catalog status --json
  pnpm catalog audit-database --json --confirm-production-read

Ajuda por comando: pnpm catalog <comando> --help`
}

/** Ajuda por comando. */
const COMMAND_HELP: Readonly<Record<CatalogCommand, string>> = {
  bootstrap: `catalog bootstrap — orquestra o catalogo do zero.

Nao baixa tudo de forma sincrona: ENFILEIRA as etapas e deixa a fila cascatear
(discover_ids -> sync_details -> credits/external_ids/media/seasons -> episodes),
alem dos snapshots de descoberta. Cada etapa e um job duravel, com retry e
dead-letter proprios — por isso o bootstrap e retomavel.

Flags:
  --strategy <s>       daily-exports (default) | popular | trending | top_rated |
                       upcoming | now_playing | airing_today | on_the_air |
                       discover | explicit-ids
  --entity <lista>     movie,tv,person (default: todos)
  --locale <l>         default pt-BR
  --country <c>        ex.: BR
  --limit <n>          teto de ids por tipo
  --mode <m>           enqueue-only (default) | resume | status
                       (o bootstrap so ENFILEIRA; quem processa e "catalog worker")
  --request-id <id>    reusar o MESMO id RETOMA a execucao sem duplicar. Omitido,
                       cada run ganha um id novo (= execucao nova e deliberada)
  --dry-run | --apply

Exemplos:
  pnpm catalog bootstrap --strategy daily-exports --entity movie,tv,person --limit 1000 --apply
  pnpm catalog worker --concurrency 4 --max-jobs 0     # processa o que foi enfileirado
  pnpm catalog bootstrap --request-id run-2026-07-16 --mode resume --apply`,

  enqueue: `catalog enqueue — enfileira UM job avulso.

Uso: pnpm catalog enqueue <job_type> [flags]

job_type: bootstrap | discover_ids | sync_details | sync_credits |
          sync_external_ids | sync_media | sync_seasons | sync_episodes |
          sync_lists | sync_changes | reprocess_raw

Flags:
  --entity <e>         tipo da entidade alvo
  --id <n>             tmdb id
  --season <n>         numero da temporada (sync_episodes)
  --locale <l>         default pt-BR
  --dry-run | --apply

Exemplos:
  pnpm catalog enqueue sync_details --entity movie --id 603 --apply
  pnpm catalog enqueue sync_episodes --entity tv --id 1399 --season 1 --apply`,

  worker: `catalog worker — processa a fila.

Excecao a regra do --apply/--dry-run: a acao do worker E processar; nao ha plano
a exibir. Shutdown gracioso: SIGINT/SIGTERM param de reivindicar e drenam o que
esta em voo (nenhum job e abandonado no meio).

Flags:
  --concurrency <n>        loops paralelos (default 4; o claim usa SKIP LOCKED)
  --poll-interval-ms <n>   espera quando a fila esvazia (default 1000)
  --max-jobs <n>           teto de jobs (0 = sem teto; fica pollando)
  --timeout-ms <n>         teto por job (default 120000)

Exemplos:
  pnpm catalog worker --concurrency 4 --poll-interval-ms 1000 --max-jobs 0
  pnpm catalog worker --max-jobs 50          # piloto: drena e sai`,

  sync: `catalog sync — sincroniza o detalhe de uma entidade.

Flags:
  --entity <e>         movie | tv | person | collection | company | network | keyword
  --id <n>             tmdb id
  --ids-file <arq>     arquivo com um id por linha (alternativa a --id)
  --locale <l>         default pt-BR
  --dry-run | --apply

Exemplos:
  pnpm catalog sync --entity movie --id 603 --apply
  pnpm catalog sync --entity tv --ids-file ./ids.txt --apply`,

  changes: `catalog changes — incremental TMDB /changes.

O checkpoint SO avanca depois do COMMIT do lote (jobs + checkpoint na MESMA
transacao). Morreu no meio de uma pagina? O checkpoint fica na anterior e a
retomada reprocessa aquela pagina — seguro, porque o enqueue e idempotente.
Janela maxima do provider: 14 dias.

Flags:
  --entity <lista>     movie,tv,person
  --from <YYYY-MM-DD>  inicio (default: to - 1 dia)
  --to <YYYY-MM-DD>    fim (default: hoje)
  --max-pages <n>      teto de paginas por tipo
  --resume             retoma do checkpoint (default do handler)
  --dry-run | --apply

Exemplos:
  pnpm catalog changes --entity movie --from 2026-07-15 --to 2026-07-16 --resume --apply
  pnpm catalog changes --entity movie,tv,person --apply`,

  discovery: `catalog discovery — captura uma lista e grava o snapshot.

Lista inalterada e hash-noop: nao cria snapshot novo. Itens de entidade ainda
nao promovida sao ignorados — snapshot nunca aponta para link morto.

Flags:
  --list <l>           trending | popular | top_rated | upcoming | now_playing |
                       airing_today | on_the_air | discover
  --entity <e>         movie | tv
  --window <w>         day | week (so trending)
  --locale <l>         default pt-BR
  --country <c>        ex.: BR
  --max-pages <n>      teto de paginas (default 5)
  --dry-run | --apply

Exemplos:
  pnpm catalog discovery --list trending --entity movie --window day --locale pt-BR --country BR --apply
  pnpm catalog discovery --list popular --entity tv --apply`,

  media: `catalog media — sincroniza imagens/videos.

Toda linha nasce display_allowed=false e este comando NUNCA liga a flag:
promover midia a exibivel e decisao humana registrada (invariante 6).

Flags:
  --entity <e>         movie | tv | season | episode | person
  --id <n>             tmdb id
  --season <n>         numero da temporada (season/episode)
  --locale <l>         default pt-BR
  --dry-run | --apply

Exemplo:
  pnpm catalog media --entity movie --id 603 --apply`,

  episodes: `catalog episodes — sincroniza episodios.

Episodio com tmdb_id nulo e PULADO e contado, sem derrubar a temporada: sem
chave natural nao ha o que sincronizar, e inventar id seria criar fato.

Flags:
  --id <n>             tmdb id da serie
  --season <n>         temporada (omitido = todas as reportadas)
  --locale <l>         default pt-BR
  --dry-run | --apply

Exemplos:
  pnpm catalog episodes --id 1399 --season 1 --apply
  pnpm catalog episodes --id 1399 --apply`,

  'search-reindex': `catalog search-reindex — reprojeta search_documents.

Reindexa pelos SLUGS canonicos: o conjunto indexavel E o que tem slug, entao o
resultado nunca aponta para 404. Entidade que sumiu tem o documento REMOVIDO.

Flags:
  --entity <e>         movie | tv | person (omitido = todos)
  --id <n>             reindexa UMA entidade (id INTERNO, nao tmdb id; exige um unico --entity)
  --locale <l>         default pt-BR
  --limit <n>          teto de linhas
  --dry-run | --apply

Exemplos:
  pnpm catalog search-reindex --apply
  pnpm catalog search-reindex --entity movie --apply`,

  'search-status': `catalog search-status — cobertura da projecao de busca (somente leitura).

Flags:
  --locale <l>         default pt-BR
  --json | --human

Exemplo:
  pnpm catalog search-status --json`,

  status: `catalog status — estado da fila (somente leitura).

Mostra jobs por status, running stale, retry_wait, dead-letter, checkpoints,
ultimos syncs, frescor de snapshot e contagem de documentos de busca.

Flags:
  --json | --human

Exemplo:
  pnpm catalog status --json`,

  'audit-database': `catalog audit-database — relatorio somente-leitura do banco.

Nunca executa UPDATE, cria tabela, aplica migration, chama API externa nem
revela DATABASE_URL. Em producao exige --confirm-production-read.

Flags:
  --json | --human
  --confirm-production-read    obrigatorio quando NODE_ENV=production

Exemplos:
  pnpm catalog audit-database --json
  pnpm catalog audit-database --human --confirm-production-read`,

  'dead-letter': `catalog dead-letter — inspeciona e reprocessa jobs esgotados.

Uso:
  pnpm catalog dead-letter list [--limit <n>] [--json]
  pnpm catalog dead-letter replay [--limit <n>] --apply

replay sem ids reprocessa TODOS os dead-letters; use --limit para um lote.
replay de lista vazia e noop (nao reprocessa tudo por engano).

Exemplos:
  pnpm catalog dead-letter list --limit 20 --json
  pnpm catalog dead-letter replay --limit 10 --apply`,
}

/** Ajuda do comando (ou a geral quando `command` e null). */
export function renderHelp(command: CatalogCommand | null): string {
  if (command === null) return renderGeneralHelp()
  return COMMAND_HELP[command]
}
