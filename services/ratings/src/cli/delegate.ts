/**
 * delegate.ts — Mapeamento PURO de `ratings sample|sync` para o entrypoint
 * dedicado (`bin/sync-film-show-ratings.ts`). Sem IO.
 *
 * Por que delegar em vez de reimplementar (achado A5 da revisao adversarial):
 * o comando canonico da missao (`pnpm ratings sample --source imdb ...`) tem de
 * EXECUTAR a amostra, mas a orquestracao de rede (client, cache, backoff,
 * circuit breaker, log em api_sync_logs) ja vive no bin dedicado — duplica-la
 * criaria dois caminhos de rede divergentes, o pior resultado possivel para a
 * regra "todo sync externo gera log". O wrapper mapeia flags e repassa o exit
 * code; este modulo decide O QUE passar (testavel sem processo).
 */

import type { SampleArgs, SyncArgs } from './args.js'

/** Resultado do mapeamento: argv do bin dedicado + avisos ao operador. */
export interface DelegationPlan {
  readonly argv: readonly string[]
  readonly warnings: readonly string[]
}

/**
 * Monta o argv do bin dedicado.
 *
 * Semantica dos modos:
 *  - `sample`  -> `--sample` (payload REAL; grava api_cache + api_sync_logs;
 *    NUNCA grava external_ratings — e o "sample" da missao, e exige chave).
 *  - `sync` sem `--apply` -> dry-run do bin (SO o plano; zero rede, zero DB).
 *  - `sync --apply` -> `--apply` (persiste em external_ratings, fail-closed).
 *
 * `--source` NAO e repassado: o fornecedor (`/item/`) devolve TODAS as fontes
 * num payload so; nao existe filtro upstream. Silenciar a flag seria mentir —
 * o plano devolve um AVISO explicito e o relatorio cobre todas as fontes.
 */
export function planDelegation(args: SampleArgs | SyncArgs): DelegationPlan {
  const argv: string[] = []
  const warnings: string[] = []

  argv.push(`--type=${args.entity === 'movie' ? 'film' : 'show'}`)
  if (args.id !== null) argv.push(`--id=${args.id}`)
  argv.push(`--limit=${args.limit}`)

  if (args.command === 'sample') {
    argv.push('--sample')
    if (args.source !== null) {
      warnings.push(
        `--source=${args.source}: o fornecedor devolve TODAS as fontes num payload so (nao ha filtro upstream); o relatorio cobre todas — leia a secao da fonte pedida.`,
      )
    }
  } else if (args.apply) {
    argv.push('--apply')
  }

  if (args.json) {
    warnings.push('--json: o entrypoint dedicado emite relatorio proprio (texto + arquivo em .data/); a flag nao se aplica aqui.')
  }

  return { argv, warnings }
}
