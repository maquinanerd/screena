/**
 * force-requests.ts — PEDIDOS ao agendador vindos do painel. Modulo PURO.
 *
 * ============================================================================
 * O PAINEL ENFILEIRA; O AGENDADOR EXECUTA
 * ============================================================================
 * O painel operacional nunca roda CLI nem chama fornecedor. Quando o dono pede
 * "rode esta fila agora", "busque a nota deste titulo" ou "recalcule o Score",
 * o painel grava uma linha em `scheduler_force_requests` e o `screen-cron` a
 * atende no proximo tique, pelo MESMO caminho de execucao das filas:
 *
 *   `queue`          -> o runner da fila, sob a mesma trava, com o mesmo registro
 *                       em `api_sync_logs`. Um ciclo forcado e um ciclo de verdade.
 *   `title_ratings`  -> a CLI `sync-omdb-ratings` com `--id` (consumidor
 *                       `on_demand`: usa a reserva do leitor e para no teto).
 *   `title_score`    -> a CLI `compute-cinerie-score` com `--entity-id`.
 *
 * Por que a nota e o Score passam por AQUI e nao por `catalog_jobs`: nao ha tipo
 * de job para eles, e quem ja guarda a credencial da OMDb e ja roda essas CLIs e
 * o agendador. Leva-los ao worker de catalogo exigiria enum novo e a mesma
 * credencial em mais um servico.
 */

import { SCHEDULER_QUEUES, type SchedulerQueue } from './rhythms.js'

/** Os tipos de pedido. Espelha o CHECK da migration. */
export const FORCE_REQUEST_KINDS = ['queue', 'title_ratings', 'title_score'] as const

/** Um tipo de pedido. */
export type ForceRequestKind = (typeof FORCE_REQUEST_KINDS)[number]

/**
 * Um pedido `running` ha mais do que isto e dado como ABANDONADO (o agendador
 * morreu no meio). Duas horas cobrem o ciclo mais longo medido (a fila de midia
 * enfileira 12.000 jobs) com folga, e liberam o alvo para um novo pedido.
 */
export const FORCE_REQUEST_ABANDON_MS = 2 * 60 * 60 * 1000

/** Quantos pedidos um tique atende no maximo. O resto espera o tique seguinte. */
export const FORCE_REQUESTS_PER_TICK = 3

/** A linha crua, como o adapter a leu. */
export interface ForceRequestRow {
  readonly id: string
  readonly kind: string
  readonly queue: string | null
  readonly entityType: string | null
  readonly entityId: string | null
}

/** Um pedido valido, pronto para executar. */
export type ForceRequest =
  | { readonly id: string; readonly kind: 'queue'; readonly queue: SchedulerQueue }
  | {
      readonly id: string
      readonly kind: 'title_ratings' | 'title_score'
      readonly entityType: 'movie' | 'tv'
      readonly entityId: string
    }

/** Resultado da validacao: o pedido, ou o motivo de recusa (vira `failed`). */
export type ForceRequestValidation =
  | { readonly ok: true; readonly request: ForceRequest }
  | { readonly ok: false; readonly reason: string }

/**
 * Valida uma linha. Fila desconhecida e recusada com motivo — nunca "roda a mais
 * parecida". O CHECK do banco ja impede a maioria das formas erradas; esta
 * validacao pega o que o banco nao sabe (a lista de filas mora no codigo).
 */
export function validateForceRequest(row: ForceRequestRow): ForceRequestValidation {
  if (row.kind === 'queue') {
    const queue = row.queue ?? ''
    if (!(SCHEDULER_QUEUES as readonly string[]).includes(queue)) {
      return { ok: false, reason: `fila desconhecida no pedido: ${queue === '' ? '(vazia)' : queue}` }
    }
    return { ok: true, request: { id: row.id, kind: 'queue', queue: queue as SchedulerQueue } }
  }
  if (row.kind === 'title_ratings' || row.kind === 'title_score') {
    if (row.entityType !== 'movie' && row.entityType !== 'tv') {
      return { ok: false, reason: `tipo de titulo invalido no pedido: ${String(row.entityType)}` }
    }
    if (row.entityId === null || !/^[1-9]\d*$/.test(row.entityId)) {
      return { ok: false, reason: 'id de titulo invalido no pedido' }
    }
    return {
      ok: true,
      request: { id: row.id, kind: row.kind, entityType: row.entityType, entityId: row.entityId },
    }
  }
  return { ok: false, reason: `tipo de pedido desconhecido: ${row.kind}` }
}

/** IMDb id no formato que a OMDb aceita. */
const IMDB_ID = /^tt\d{7,10}$/

/**
 * Argumentos da CLI da OMDb para UM titulo. `null` quando o titulo nao tem
 * `imdb_id` valido — a OMDb nao alcanca titulo sem ele, e o pedido termina
 * `failed` com esse motivo em vez de gastar uma requisicao para ouvir "nao
 * encontrado".
 */
export function buildForcedRatingsArgs(
  entityType: 'movie' | 'tv',
  imdbId: string | null,
): readonly string[] | null {
  if (imdbId === null || !IMDB_ID.test(imdbId)) return null
  return ['--id', imdbId, '--type', entityType, '--apply']
}

/** Argumentos da CLI do Cinerie Score para UM titulo. */
export function buildForcedScoreArgs(entityType: 'movie' | 'tv', entityId: string): readonly string[] {
  return ['--type', entityType, '--entity-id', entityId, '--apply']
}

/**
 * A ultima linha util da saida de uma CLI, para o registro do pedido.
 *
 * So linhas que as CLIs deste repositorio escrevem como RESUMO (`status=` da OMDb,
 * `calculados=` do Score). Nunca a saida inteira: ela pode ter caminho de disco e
 * detalhe de payload, e o registro fica visivel no painel.
 */
export function summarizeChildOutput(stdout: string): string | null {
  const linhas = stdout
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter((linha) => linha.startsWith('status=') || linha.startsWith('calculados=') || linha.startsWith('Sem decisao'))
  const ultima = linhas[linhas.length - 1]
  if (ultima === undefined) return null
  return ultima.length > 300 ? `${ultima.slice(0, 297)}...` : ultima
}
