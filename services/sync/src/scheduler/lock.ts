/**
 * lock.ts — A TRAVA CONTRA EXECUCAO DUPLA. Parte PURA.
 *
 * ============================================================================
 * O PROBLEMA CONCRETO
 * ============================================================================
 * Duas replicas do agendador acordam ao mesmo tempo, leem "a fatia mais velha
 * da fila de notas" e recebem A MESMA LISTA. Sem trava, as duas consultam os
 * mesmos titulos: cota gasta em dobro, `api_sync_logs` com duas execucoes
 * simultaneas da mesma fila e — o pior — duas escritas concorrentes na mesma
 * entidade.
 *
 * Um redeploy do EasyPanel tambem produz esse cenario, e sem intencao: durante a
 * troca, a instancia velha ainda nao morreu quando a nova ja subiu.
 *
 * ============================================================================
 * POR QUE ADVISORY LOCK, E NAO TABELA DE LEASE
 * ============================================================================
 * As duas serviriam. `pg_advisory_lock` ganha por tres motivos concretos:
 *
 *  1. NAO EXIGE MIGRATION. Uma tabela de lease exigiria schema novo — e schema
 *     novo em producao e um passo a mais entre o dono e o agendador funcionando.
 *  2. LIBERA SOZINHO NA QUEDA. O lock de sessao morre com a conexao. Uma tabela
 *     de lease precisa de expiracao, e expiracao precisa de um relogio confiavel
 *     dos dois lados; um container morto por OOM deixaria a lease presa ate o
 *     TTL vencer.
 *  3. E NAO-BLOQUEANTE POR PADRAO AQUI. Usamos `pg_try_advisory_lock`: quem nao
 *     pegou NAO espera — desiste e loga. Um agendador que fica bloqueado
 *     esperando o lock acumula ciclos e dispara tudo de uma vez quando ele solta.
 *
 * A fila de `catalog_jobs` ja tem a sua propria trava por LINHA
 * (`FOR UPDATE SKIP LOCKED`), e as duas convivem em niveis diferentes: o
 * advisory lock impede dois AGENDADORES de decidir; o SKIP LOCKED impede dois
 * WORKERS de pegar o mesmo job. Nenhuma substitui a outra.
 *
 * ============================================================================
 * A CHAVE
 * ============================================================================
 * `pg_try_advisory_lock` aceita um `bigint`. A chave e derivada do NOME da fila
 * por SHA-256 truncado em 63 bits (positivo), de forma deterministica: duas
 * instancias que leem a mesma tabela de ritmos chegam a mesma chave sem
 * combinar nada.
 *
 * O namespace `cinerie/scheduler/` entra no hash de proposito: sem ele, uma fila
 * chamada `discovery` colidiria com qualquer outro sistema que travasse por um
 * nome igual no MESMO banco.
 */

import { createHash } from 'node:crypto'

/** Prefixo do namespace. Entra no hash — nao e enfeite. */
export const LOCK_NAMESPACE = 'cinerie/scheduler/'

/**
 * A chave de advisory lock de uma fila.
 *
 * 63 bits (e nao 64): `bigint` do Postgres e SINALIZADO. Usar os 64 bits
 * produziria chaves negativas — validas, mas ilegiveis no log e faceis de
 * confundir com codigo de erro. Zerar o bit de sinal e o unico ajuste.
 */
export function advisoryLockKey(queue: string): bigint {
  const digest = createHash('sha256').update(`${LOCK_NAMESPACE}${queue}`, 'utf8').digest()
  const raw = digest.readBigUInt64BE(0)
  return raw & 0x7fff_ffff_ffff_ffffn
}

/** O que uma tentativa de trava pode devolver. */
export type LockOutcome =
  /** Pegamos a trava. So esta instancia roda a fila agora. */
  | { readonly acquired: true; readonly key: bigint }
  /**
   * Outra instancia esta com a trava. NAO e erro e NAO e "nada a fazer": e uma
   * execucao pulada, e ela e logada — pular em silencio faria duas replicas
   * parecerem uma so.
   */
  | { readonly acquired: false; readonly key: bigint; readonly reason: 'held_elsewhere' }

/** A porta de trava. O adapter Postgres a implementa; os testes, com fake. */
export interface SchedulerLockPort {
  /** Tenta pegar SEM esperar. */
  tryAcquire(queue: string): Promise<LockOutcome>
  /** Solta. Idempotente: soltar o que nao se tem nao e erro. */
  release(queue: string): Promise<void>
}

/**
 * Roda `work` com a trava da fila, ou devolve `skipped` se outra instancia ja
 * esta rodando.
 *
 * `finally` SEMPRE solta — inclusive quando `work` lanca. Sem isso, um erro de
 * rede numa fila deixaria a trava presa ate a conexao cair, e a fila ficaria
 * parada por horas parecendo "sem trabalho".
 */
export async function withQueueLock<T>(
  lock: SchedulerLockPort,
  queue: string,
  work: () => Promise<T>,
): Promise<{ readonly ran: true; readonly value: T } | { readonly ran: false; readonly key: bigint }> {
  const outcome = await lock.tryAcquire(queue)
  if (!outcome.acquired) return { ran: false, key: outcome.key }
  try {
    return { ran: true, value: await work() }
  } finally {
    await lock.release(queue)
  }
}
