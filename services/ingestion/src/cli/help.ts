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
  plan-bootstrap    Estima o CUSTO de um bootstrap antes de persistir (nao usa banco)
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
  index-decisions   Produz page_indexability_decisions (nao liga indexacao)
  backfill-finalization  Cria slug/traducao de entidades presas pelo cache
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
  'plan-bootstrap': `catalog plan-bootstrap — estima o CUSTO de um bootstrap ANTES de persistir.

Existe porque \`--limit\` mede TITULO, e titulo nao e a unidade de custo. Medido
em execucao real: 3 series da lista \`popular\` produziram 639 temporadas e
33.178 episodios. Subir \`--limit\` de 10 para 100 pode multiplicar o trabalho por
muito mais que 10 — depende de QUAIS series cairem na lista.

Le as listas de descoberta e, para cada SERIE candidata, busca \`/tv/{id}\` (e
dali saem \`number_of_seasons\` e \`number_of_episodes\`, que sao o custo real).
Filme tem custo fixo e nao gasta cota de detalhe.

NAO usa banco: planejar tem que ser possivel de um host sem PostgreSQL.
NAO persiste nada: nem entidade, nem cache, nem job.

Flags:
  --strategy <s>              popular (default) | top_rated | now_playing | on_the_air
  --entity <lista>            movie,tv (default: ambos)
  --limit <n>                 candidatos por tipo (default 20)
  --max-pages <n>             paginas de lista lidas por tipo (default 5)
  --locale <l>                default pt-BR

Orcamento (dimensao sem teto declarado nunca viola):
  --max-titles <n>            teto de titulos
  --max-series <n>            teto de series
  --max-seasons <n>           teto de temporadas
  --max-episodes <n>          teto de episodios   <- o que --limit esconde
  --max-jobs <n>              teto de jobs enfileirados
  --max-api-calls <n>         teto de chamadas TMDB
  --max-media-items <n>       teto de itens de midia
  --max-duration-minutes <n>  teto de duracao estimada

Exit code 4 quando o orcamento estoura — o comando RECUSA, nao apenas informa.
A saida diz quantos titulos cabem, para nao ser tentativa e erro.

Exemplos:
  pnpm catalog plan-bootstrap --strategy popular --entity movie,tv --limit 20 --json
  pnpm catalog plan-bootstrap --limit 100 --max-episodes 20000 --max-duration-minutes 45`,

  'backfill-finalization': `catalog backfill-finalization — cria slug/traducao de entidades presas.

\`sync_details\` so finaliza quando houve upsert. No short-circuit de cache
(payload identico ao da ultima vez) o importador faz \`touch\` e nao devolve id —
entao nao ha o que finalizar. Uma entidade importada ANTES do wiring de
finalizacao existir, cujo payload nao mudou desde entao, fica presa: nunca ganha
slug, e sem slug nao ha rota publica, nem busca, nem sitemap.

Forcar chamada externa em todo sync consertaria — e seria pior: gastaria cota em
todas as entidades por causa de poucas. Este comando ataca so as presas.

NENHUMA chamada TMDB. Usa, nesta ordem: traducao existente -> linha canonica ->
dado local. Se o dado local nao basta, reporta \`missing_title\` em vez de gastar
cota em silencio.

GARANTIAS:
  - so toca entidade SEM slug canonico — slug valido nunca e alterado;
  - so cria traducao AUSENTE — nunca sobrescreve uma existente;
  - pessoa so e finalizada se passar na regra de elegibilidade;
  - reexecutar nao gera churn nem redirect.

Flags:
  --entity <lista>   movie,tv,season,episode,person (default: todos)
  --locale <l>       default pt-BR
  --limit <n>        candidatos por tipo (default 1000)
  --dry-run          conta e classifica, sem gravar
  --apply            grava

Exemplos:
  pnpm catalog backfill-finalization --dry-run --json
  pnpm catalog backfill-finalization --entity movie,tv --limit 500 --apply`,

  'index-decisions': `catalog index-decisions — PRODUZ page_indexability_decisions.

Essa tabela e LIDA pelo sitemap, pelos loaders publicos e pelo resolver de SEO —
e nunca foi ESCRITA por processo nenhum. Tabela lida e nao escrita nao e gate: e
decoracao. Este comando e o produtor.

A politica nao e reimplementada aqui: licenca -> idioma -> caso tecnico -> index
continua vindo de \`resolvePageSeo\` (fonte unica). O que se acrescenta sao os
gates por TIPO, todos DIRIGIDOS A DADO (nunca "tipo X nao indexa"):

  filme/serie  slug + titulo + traducao + sinopse + poster
  temporada    serie publicavel + sinopse OU pelo menos um episodio listado
  episodio     serie publicavel + sinopse propria
  pessoa       credito em obra publicavel + biografia EXIBIVEL + foto

Preencheu a sinopse/biografia que faltava? A pagina volta a indexar na proxima
execucao, sem deploy — e por isso que o gate pergunta pelo dado, e nao pelo tipo.

SEM CHURN: decisao igual a persistida (mesmo veredito, razao e versao de
politica) NAO grava. Uma execucao sobre catalogo estavel deve gravar zero.

NAO LIGA INDEXACAO: gravar \`index\` registra o que a politica diz. A chave
global \`CINERIE_PUBLIC_INDEXING_ENABLED\` continua desligada.

FREIO DE MUDANCA EM MASSA: este comando roda de hora em hora sem humano nenhum.
Antes de gravar, ele conta quantas entidades ENTRAM ou SAEM do sitemap. Passando
do teto (default 500 flips OU 5% das avaliadas), a execucao grava ZERO linhas,
imprime o censo por razao e sai com o code 5 — em dry-run tambem, porque o
dry-run e a pre-checagem do apply. A secao 6 do CLAUDE.md exige revisao HUMANA
para indexacao em massa; \`--confirm-mass-change\` e essa assinatura.

O que conta como FLIP: o sitemap trata AUSENCIA de decisao como "dentro". Logo
\`null -> index\` NAO e flip (crescimento normal do catalogo passa livre) e
\`null -> noindex\` E flip (a pagina sai). Trocar so a razao entre dois vereditos
nao-index tambem nao e flip.

Flags:
  --entity <lista>          movie,tv,season,episode,person (default: todos)
  --locale <l>              default pt-BR
  --limit <n>               teto de entidades por tipo
  --dry-run                 calcula e mostra o diff, sem gravar
  --apply                   grava
  --confirm-mass-change     assinatura humana: autoriza passar do teto do freio
  --max-flips <n>           teto absoluto de flips (default 500)
  --max-flip-percent <n>    teto proporcional, 0..100 (default 5)

Exit codes:
  0  ok
  5  freio de mudanca em massa — nada gravado, aguardando humano

Exemplos:
  pnpm catalog index-decisions --dry-run --json
  pnpm catalog index-decisions --entity person --apply
  pnpm catalog index-decisions --apply --confirm-mass-change
  pnpm catalog index-decisions --dry-run --max-flip-percent 100 --max-flips 50`,

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
