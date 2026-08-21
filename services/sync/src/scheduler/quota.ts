/**
 * quota.ts — O TAMANHO do lote da fila de fundo. Modulo PURO.
 *
 * ============================================================================
 * DOIS PONTOS DE CONTROLE, E NENHUM SUBSTITUI O OUTRO
 * ============================================================================
 * `checkOmdbBudget` (@screena/config) e o PORTEIRO: ele decide item a item,
 * dentro do worker, imediatamente antes de cada requisicao. E ele que garante
 * que a cota nunca e estourada, mesmo com duas replicas ou com um lote que
 * comecou grande.
 *
 * Esta funcao e o TETO: ela decide o tamanho do lote ANTES de o processo subir.
 * Sem ela, o agendador spawnaria um processo por ciclo para descobrir, no
 * primeiro item, que nao havia cota — desperdicio pequeno, mas o log ficaria
 * cheio de execucoes que nunca fizeram nada, e "rodou e nao fez nada" e
 * indistinguivel de "quebrou" no painel.
 *
 * Os dois usam a MESMA politica. Duplicar a regra aqui (por exemplo, uma reserva
 * propria) criaria dois numeros que divergem no primeiro ajuste.
 *
 * ============================================================================
 * A FILA DE FUNDO NUNCA CONSOME 100%
 * ============================================================================
 * O teto subtrai a reserva do leitor SEMPRE, inclusive quando ha cota de sobra.
 * E o requisito explicito: "nunca deixe a fila de fundo consumir 100%".
 */

import { checkOmdbBudget, OMDB_DAILY_LIMIT, ON_DEMAND_RESERVE } from '@screena/config'

/**
 * Quantas requisicoes a fila de FUNDO pode gastar neste ciclo.
 *
 * `0` significa "nao spawne nada": ou a cota acabou, ou o que resta e do leitor.
 * O chamador reporta o motivo — zero silencioso seria um ciclo que "rodou" sem
 * explicar por que nao fez nada.
 */
export function backgroundOmdbSlots(
  spentToday: number,
  batchLimit: number,
  limits: { readonly dailyLimit?: number; readonly reserve?: number } = {},
): number {
  const dailyLimit = limits.dailyLimit ?? OMDB_DAILY_LIMIT
  const reserve = limits.reserve ?? ON_DEMAND_RESERVE

  const verdict = checkOmdbBudget('seed', { spentToday, dailyLimit, reserve })
  if (!verdict.granted) return 0

  // A reserva sai SEMPRE, nao so quando o saldo encosta nela.
  const usable = Math.max(0, dailyLimit - Math.max(0, spentToday) - reserve)
  return Math.max(0, Math.min(Math.trunc(batchLimit), usable))
}
