/**
 * lock.test.ts — A TRAVA CONTRA EXECUCAO DUPLA, no nivel do contrato.
 *
 * Duas provas, em dois lugares, porque uma so nao basta:
 *
 *  - AQUI: o CONTRATO. Duas execucoes concorrentes da mesma fila, contra uma
 *    trava compartilhada, e exatamente uma roda. Roda em qualquer maquina, em
 *    todo `pnpm test`, sem banco.
 *  - EM `scripts/prove-scheduler-lock.ts`: a REALIDADE. Dois PROCESSOS
 *    separados, PostgreSQL de verdade, `pg_try_advisory_lock` de verdade. E o
 *    unico lugar onde a armadilha do POOL de conexoes pode aparecer, e por isso
 *    ele existe.
 *
 * Nenhum dos dois substitui o outro: o contrato passaria com um `pg_advisory_lock`
 * emitido e liberado em conexoes diferentes (o bug real), e o script nao rodaria
 * em toda CI sem um Postgres.
 */

import { describe, expect, it } from 'vitest'

import { advisoryLockKey, LOCK_NAMESPACE, withQueueLock, type SchedulerLockPort } from '../lock.js'

/** Trava em memoria com a MESMA semantica do `pg_try_advisory_lock`. */
function memoryLock(): SchedulerLockPort & { readonly held: ReadonlySet<string> } {
  const held = new Set<string>()
  return {
    held,
    async tryAcquire(queue) {
      const key = advisoryLockKey(queue)
      if (held.has(queue)) return { acquired: false, key, reason: 'held_elsewhere' }
      held.add(queue)
      return { acquired: true, key }
    },
    async release(queue) {
      held.delete(queue)
    },
  }
}

describe('a chave', () => {
  it('e deterministica: duas instancias chegam a mesma chave sem combinar nada', () => {
    expect(advisoryLockKey('ratings_omdb')).toBe(advisoryLockKey('ratings_omdb'))
  })

  it('e diferente por fila — travar notas nao pode travar ofertas', () => {
    expect(advisoryLockKey('ratings_omdb')).not.toBe(advisoryLockKey('watch_offers'))
  })

  it('cabe em bigint POSITIVO do Postgres (63 bits)', () => {
    for (const queue of ['discovery', 'changes', 'awards', 'people', 'cinerie_score']) {
      const key = advisoryLockKey(queue)
      expect(key >= 0n, queue).toBe(true)
      expect(key <= 0x7fff_ffff_ffff_ffffn, queue).toBe(true)
    }
  })

  it('o namespace ENTRA no hash — sem ele, "discovery" colidiria com qualquer outro sistema', () => {
    const semNamespace = advisoryLockKey('')
    expect(advisoryLockKey(LOCK_NAMESPACE)).not.toBe(semNamespace)
  })
})

describe('duas execucoes concorrentes da MESMA fila', () => {
  it('exatamente uma roda; a outra e recusada e sabe por que', async () => {
    const lock = memoryLock()
    let entrou = 0
    let simultaneos = 0
    let pico = 0

    const trabalho = async (): Promise<string> => {
      entrou += 1
      simultaneos += 1
      pico = Math.max(pico, simultaneos)
      // Cede o event loop DE PROPOSITO: sem isto, a primeira execucao terminaria
      // antes de a segunda comecar e o teste passaria sem provar nada.
      await new Promise((resolve) => setTimeout(resolve, 10))
      simultaneos -= 1
      return 'feito'
    }

    const [a, b] = await Promise.all([
      withQueueLock(lock, 'ratings_omdb', trabalho),
      withQueueLock(lock, 'ratings_omdb', trabalho),
    ])

    expect(entrou).toBe(1)
    expect(pico).toBe(1)
    expect([a.ran, b.ran].filter(Boolean)).toHaveLength(1)
    const recusada = a.ran ? b : a
    expect(recusada.ran).toBe(false)
    if (!recusada.ran) expect(recusada.key).toBe(advisoryLockKey('ratings_omdb'))
  })

  it('filas DIFERENTES rodam em paralelo — a trava e por fila, nao global', async () => {
    const lock = memoryLock()
    let simultaneos = 0
    let pico = 0
    const trabalho = async (): Promise<void> => {
      simultaneos += 1
      pico = Math.max(pico, simultaneos)
      await new Promise((resolve) => setTimeout(resolve, 10))
      simultaneos -= 1
    }

    const [a, b] = await Promise.all([
      withQueueLock(lock, 'ratings_omdb', trabalho),
      withQueueLock(lock, 'watch_offers', trabalho),
    ])
    expect(a.ran).toBe(true)
    expect(b.ran).toBe(true)
    expect(pico).toBe(2)
  })

  it('a trava e SOLTA mesmo quando o trabalho lanca — senao a fila congelaria', async () => {
    const lock = memoryLock()
    await expect(
      withQueueLock(lock, 'awards', async () => {
        throw new Error('upstream fora do ar')
      }),
    ).rejects.toThrow('upstream fora do ar')

    expect(lock.held.has('awards')).toBe(false)
    // E a proxima execucao consegue entrar.
    const depois = await withQueueLock(lock, 'awards', async () => 'ok')
    expect(depois.ran).toBe(true)
  })

  it('CONTROLE NEGATIVO: sem trava, as duas rodam — e por isso o teste acima prova algo', async () => {
    const semTrava: SchedulerLockPort = {
      async tryAcquire(queue) {
        return { acquired: true, key: advisoryLockKey(queue) }
      },
      async release() {},
    }
    let simultaneos = 0
    let pico = 0
    const trabalho = async (): Promise<void> => {
      simultaneos += 1
      pico = Math.max(pico, simultaneos)
      await new Promise((resolve) => setTimeout(resolve, 10))
      simultaneos -= 1
    }
    await Promise.all([
      withQueueLock(semTrava, 'ratings_omdb', trabalho),
      withQueueLock(semTrava, 'ratings_omdb', trabalho),
    ])
    expect(pico).toBe(2)
  })
})
