/**
 * runtime/advisory-lock.ts — A trava contra execucao dupla, sobre Postgres.
 * EXCLUIDO do typecheck principal (toca Prisma).
 *
 * ============================================================================
 * A ARMADILHA DO POOL, E ELA E FATAL SE IGNORADA
 * ============================================================================
 * `pg_try_advisory_lock` e `pg_advisory_unlock` sao de SESSAO. Um `PrismaClient`
 * normal mantem um POOL: o `lock` pode sair pela conexao A e o `unlock` pela
 * conexao B. O Postgres nao levanta erro nesse caso — ele apenas devolve
 * `false` e escreve um WARNING no log do servidor. Resultado: a trava fica
 * presa na conexao A ate ela morrer, e a fila para de rodar POR HORAS
 * parecendo "sem trabalho".
 *
 * Esse defeito nao aparece em teste com uma instancia so (o lock e reentrante
 * na MESMA sessao) nem em desenvolvimento (pool ocioso costuma reusar a mesma
 * conexao). Ele aparece em producao, sob carga, uma vez por semana.
 *
 * A CURA: este adapter exige um cliente com pool de UMA conexao
 * (`connection_limit=1`), criado por `createLockClient` a partir da propria
 * `DATABASE_URL`. Com uma conexao so, lock e unlock sao necessariamente a mesma
 * sessao. `createLockClient` NAO aceita um cliente pronto de fora justamente
 * para que ninguem passe o cliente compartilhado do servico por engano.
 *
 * O custo e uma conexao a mais por instancia do agendador. E o preco de uma
 * trava que funciona.
 */

import { PrismaClient } from '@prisma/client'

import { advisoryLockKey, type LockOutcome, type SchedulerLockPort } from '../lock.js'

/**
 * Acrescenta `connection_limit=1` a uma URL de conexao.
 *
 * Se o operador ja tiver declarado um `connection_limit` proprio, ele e
 * SUBSTITUIDO: um `connection_limit=10` herdado do ambiente reintroduziria
 * exatamente o defeito que este modulo existe para impedir, e respeitar a
 * configuracao do operador aqui seria respeitar um erro.
 */
export function singleConnectionUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl)
  url.searchParams.set('connection_limit', '1')
  // `pool_timeout=0` desliga a espera por conexao: com pool de 1, esperar seria
  // enfileirar statements do lock atras do proprio trabalho.
  url.searchParams.set('pool_timeout', '0')
  return url.toString()
}

/** Cria o cliente DEDICADO da trava. Nunca reuse o cliente do servico aqui. */
export function createLockClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: singleConnectionUrl(databaseUrl) } } })
}

/**
 * A porta de trava sobre `pg_try_advisory_lock`.
 *
 * `try`, e nao a versao bloqueante: quem nao pegou desiste e loga. Um agendador
 * que espera pela trava acumula ciclos e dispara tudo de uma vez quando ela
 * solta — trocando "duas execucoes simultaneas" por "uma rajada", que e o mesmo
 * problema com outro nome.
 */
export function createAdvisoryLockPort(client: PrismaClient): SchedulerLockPort {
  return {
    async tryAcquire(queue: string): Promise<LockOutcome> {
      const key = advisoryLockKey(queue)
      const rows = await client.$queryRawUnsafe<Array<{ locked: boolean }>>(
        'SELECT pg_try_advisory_lock($1::bigint) AS locked',
        key,
      )
      const locked = rows[0]?.locked === true
      return locked
        ? { acquired: true, key }
        : { acquired: false, key, reason: 'held_elsewhere' }
    },

    async release(queue: string): Promise<void> {
      const key = advisoryLockKey(queue)
      // O retorno (`false` = nao tinhamos a trava) e IGNORADO de proposito:
      // soltar o que nao se tem e no-op, e transformar isso em erro faria o
      // `finally` de `withQueueLock` mascarar a excecao original do trabalho.
      await client.$queryRawUnsafe('SELECT pg_advisory_unlock($1::bigint)', key)
    },
  }
}
