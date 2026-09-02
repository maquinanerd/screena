/**
 * child-args.ts — os ARGUMENTOS que o agendador passa a cada CLI filho.
 *
 * MODULO PURO, sem imports: nem Prisma, nem rede, nem IO. Isto nao e higiene —
 * e o que torna o contrato testavel. Enquanto estas funcoes viviam dentro de
 * `runners.ts`, testa-las exigia carregar `@screena/db/server` e gerar o client
 * do Prisma; nenhum teste fazia isso, e por isso os dois defeitos abaixo
 * sobreviveram em producao.
 *
 * OS DOIS DEFEITOS QUE ISTO FECHA (medidos em 2026-08-25 03:35 UTC)
 * ---------------------------------------------------------------------------
 * As filas `cinerie_score` e `search_projection` falhavam **todo tique desde que
 * nasceram**, por desencontro de argumento entre chamador e filho:
 *
 *   cinerie_score:     compute-cinerie-score saiu com codigo 1:
 *                      argumento desconhecido: "--type"
 *   search_projection: catalog search-reindex saiu com codigo 3:
 *                      escrita em producao exige --force explicito
 *
 * Nenhum teste podia pegar: o agendador montava `string[]`, a CLI parseava
 * `string[]`, e nao havia nada que juntasse os dois lados. A auditoria concluiu
 * que "o motor do Score nunca rodou" — ele rodava, e morria no parse.
 *
 * O teste que fecha a classe do defeito esta em
 * `../__tests__/child-cli-contract.test.ts`: ele importa ESTAS funcoes e passa a
 * saida pelo parser REAL do filho. Um teste que copiasse `['--type=all']` a mao
 * continuaria verde no dia em que estas funcoes mudassem — que e exatamente como
 * o defeito original sobreviveu.
 */

/**
 * Argumentos de `services/ratings/bin/compute-cinerie-score.ts`.
 *
 * `--type=all` COM o sinal de igual. O parser do filho recusava a forma separada
 * (`['--type', 'all']`) e saia com codigo 1. O parser do filho passou a aceitar
 * as duas formas — como os dois CLIs irmaos ja aceitavam —, mas o chamador nao
 * deve depender de o filho ser tolerante.
 */
export function buildCinerieScoreArgs(apply: boolean): readonly string[] {
  const args = ['--type=all']
  if (apply) args.push('--apply')
  return args
}

/**
 * Argumentos de `services/ingestion/bin/catalog.ts search-reindex`.
 *
 * `--force` JUNTO com `--apply`: `evaluateCatalogGate` recusa escrita em
 * producao sem ele, e a fila saia com codigo 3 —
 *
 *   "escrita em producao exige --force explicito (um --apply de runbook de
 *    staging nao muta producao por descuido)"
 *
 * O gate esta CERTO: ele existe exatamente para isso. O que faltava era o
 * agendador declarar que a deliberacao ja aconteceu UMA camada acima — ele so
 * roda com `apply` quando `CINERIE_SCHEDULER_APPLY=true` esta na configuracao do
 * servico.
 *
 * Sem isto a projecao de busca ficou parada desde 2026-08-20 03:19, e a busca
 * cobria 107 dos 239 titulos.
 *
 * Em dry-run NAO manda `--force`: pedir autorizacao de escrita para nao escrever
 * nada treinaria o gate a ser ignorado.
 */
export function buildSearchReindexArgs(apply: boolean): readonly string[] {
  return apply ? ['search-reindex', '--apply', '--force'] : ['search-reindex', '--dry-run']
}

/**
 * Argumentos de `services/ratings/bin/sync-omdb-ratings.ts`, um lote por fatia.
 *
 * `--apply` E INCONDICIONAL, e essa e a mudanca de 2026-09-01.
 * ---------------------------------------------------------------------------
 * Antes o runner fazia `if (deps.apply) args.push('--apply')`. Sem a flag, o
 * filho cai no ramo `touchesNetwork === false`: imprime o PLANO, usa
 * `NOOP_CANDIDATES` (nao consulta o banco), nao toca rede, nao grava — e sai
 * com codigo 0. O runner lia esse 0 como sucesso e somava `slice.slots` a
 * `processed`, reportando centenas de titulos "processados" num ciclo que nao
 * consultou nenhum.
 *
 * O ciclo sem escrita agora nao spawna nada: `runRatingsOmdb` devolve antes,
 * contando as fatias em `skipped` com o motivo `dry_run` — do mesmo jeito que
 * os runners `enqueue` e `watch_offers` ja faziam. Logo, todo filho que chega a
 * ser spawnado E um filho que escreve, e a flag nao depende mais de condicao.
 *
 * Esta funcao existe (em vez de o array ficar inline no runner) porque o teste
 * de costura `services/ratings/src/omdb/__tests__/scheduler-argv-seam.test.ts`
 * precisava COPIAR a montagem a mao — e uma copia a mao continua verde no dia em
 * que o original muda, que e precisamente o modo de falha descrito no cabecalho
 * deste arquivo.
 */
export function buildOmdbChildArgs(
  entityType: 'movie' | 'tv',
  mode: string,
  slots: number,
): readonly string[] {
  return ['--type', entityType, '--mode', mode, '--limit', String(slots), '--apply']
}
