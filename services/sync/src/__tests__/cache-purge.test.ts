/**
 * cache-purge.test.ts — o expurgo de `api_cache`, sem banco.
 *
 * O que precisa ser verdade, e por que cada um importa:
 *  - linha SEM prazo (`expires_at IS NULL`) nunca entra no predicado;
 *  - o laco para quando o trabalho acaba, e nao adivinha que acabou;
 *  - "acabou" e "bati o teto" sao desfechos DISTINTOS;
 *  - o agregado por fornecedor sai do proprio `RETURNING`, nunca de um rotulo
 *    inventado (a FK de `api_sync_logs.provider_api` recusaria um).
 */

import { describe, expect, it } from 'vitest'

import {
  CACHE_PURGE_BATCH_SIZE,
  COUNT_EXPIRED_SQL,
  PURGE_BATCH_SQL,
  purgeExpiredCache,
  tallyByProvider,
  type PurgedRow,
} from '../cache-purge.js'

/** Um `runBatch` de mentira sobre uma fila finita de linhas. */
function fakeQueue(rows: readonly PurgedRow[]): {
  run: (limit: number) => Promise<readonly PurgedRow[]>
  calls: number[]
} {
  let cursor = 0
  const calls: number[] = []
  return {
    calls,
    run: (limit: number) => {
      calls.push(limit)
      const slice = rows.slice(cursor, cursor + limit)
      cursor += slice.length
      return Promise.resolve(slice)
    },
  }
}

const row = (provider: string): PurgedRow => ({ provider_api: provider })

describe('o predicado do expurgo', () => {
  it('EXIGE expires_at NAO NULO — linha sem prazo nunca e candidata', () => {
    // A regra vive no SQL, entao e o SQL que precisa afirma-la. Sem esta
    // clausula o `DELETE` continuaria correto por acidente (a comparacao com
    // NULL nunca da `true`), e a proxima pessoa a editar a consulta nao teria
    // como saber que a protecao dependia disso.
    expect(PURGE_BATCH_SQL).toContain('expires_at IS NOT NULL')
    expect(COUNT_EXPIRED_SQL).toContain('expires_at IS NOT NULL')
  })

  it('apaga em LOTE ordenado, nunca a tabela inteira de uma vez', () => {
    expect(PURGE_BATCH_SQL).toContain('ORDER BY id')
    expect(PURGE_BATCH_SQL).toContain('LIMIT $2')
    // `RETURNING` e o que permite dizer de quem era o lixo.
    expect(PURGE_BATCH_SQL).toContain('RETURNING provider_api')
  })

  it('usa o relogio INJETADO, nao o do banco', () => {
    // `now()` do servidor tornaria o teste nao-determinista e faria a janela
    // deslizar com o fuso da sessao.
    expect(PURGE_BATCH_SQL).toContain('$1::timestamptz')
    expect(PURGE_BATCH_SQL).not.toContain('now()')
  })
})

describe('o laco de lotes', () => {
  it('para quando a fila acaba, e reporta que ACABOU', () => {
    const q = fakeQueue([row('tmdb'), row('tmdb'), row('omdb')])
    return purgeExpiredCache(q.run, { batchSize: 10, maxBatches: 5 }).then((result) => {
      expect(result.deleted).toBe(3)
      expect(result.batches).toBe(1)
      expect(result.hitBatchCeiling).toBe(false)
    })
  })

  it('paginando: varios lotes cheios ate sobrar um parcial', async () => {
    const rows = Array.from({ length: 25 }, () => row('tmdb'))
    const q = fakeQueue(rows)

    const result = await purgeExpiredCache(q.run, { batchSize: 10, maxBatches: 10 })

    expect(result.deleted).toBe(25)
    expect(result.batches).toBe(3) // 10 + 10 + 5
    expect(result.hitBatchCeiling).toBe(false)
    expect(q.calls).toEqual([10, 10, 10])
  })

  it('bate o TETO e diz que bateu — "acabou" e "cansei" nao se confundem', async () => {
    // 100 linhas, lotes de 10, teto de 3: sobra trabalho.
    const q = fakeQueue(Array.from({ length: 100 }, () => row('tmdb')))

    const result = await purgeExpiredCache(q.run, { batchSize: 10, maxBatches: 3 })

    expect(result.deleted).toBe(30)
    expect(result.batches).toBe(3)
    // A REGRESSAO QUE ISTO PEGA: sem a flag, um passivo enorme apareceria como
    // uma fila de ciclos bem-sucedidos que nunca termina.
    expect(result.hitBatchCeiling).toBe(true)
  })

  it('CONTROLE NEGATIVO: nada vencido = zero lote util, e nao e "teto batido"', async () => {
    const q = fakeQueue([])

    const result = await purgeExpiredCache(q.run, { batchSize: 10, maxBatches: 5 })

    expect(result.deleted).toBe(0)
    expect(result.hitBatchCeiling).toBe(false)
    expect(result.byProvider.size).toBe(0)
  })
})

describe('o agregado por fornecedor', () => {
  it('conta por chave vinda do RETURNING', () => {
    const tally = tallyByProvider([row('tmdb'), row('omdb'), row('tmdb'), row('tmdb')])
    expect(tally.get('tmdb')).toBe(3)
    expect(tally.get('omdb')).toBe(1)
    expect(tally.size).toBe(2)
  })

  it('acumula entre lotes, nao so dentro de um', async () => {
    // Se o acumulador fosse reiniciado por lote, o log de `api_sync_logs`
    // reportaria so o ultimo lote e subestimaria o expurgo inteiro.
    const q = fakeQueue([row('tmdb'), row('omdb'), row('tmdb'), row('omdb'), row('tmdb')])

    const result = await purgeExpiredCache(q.run, { batchSize: 2, maxBatches: 10 })

    expect(result.deleted).toBe(5)
    expect(result.byProvider.get('tmdb')).toBe(3)
    expect(result.byProvider.get('omdb')).toBe(2)
  })
})

describe('os tetos declarados', () => {
  it('o lote e grande o bastante para ser util e pequeno para nao travar', () => {
    // 500 mil linhas / 5.000 = 100 lotes. Um lote de 100 mil seguraria a
    // transacao e disputaria lock com o worker de catalogo, que escreve em
    // `api_cache` continuamente.
    expect(CACHE_PURGE_BATCH_SIZE).toBeGreaterThanOrEqual(1_000)
    expect(CACHE_PURGE_BATCH_SIZE).toBeLessThanOrEqual(20_000)
  })
})
