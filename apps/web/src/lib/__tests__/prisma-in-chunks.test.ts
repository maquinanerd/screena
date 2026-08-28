import { describe, expect, it } from 'vitest'

import {
  chunkForInClause,
  findManyInChunks,
  PRISMA_IN_CHUNK_SIZE,
} from '../prisma-in-chunks'

describe('chunkForInClause', () => {
  it('cabe no teto de bind variables do PostgreSQL (32.767 por consulta)', () => {
    // O lote precisa deixar folga para os escalares do mesmo `where`
    // (`entityType`, `languageCode`, datas de corte...). Um lote de 32.767
    // ids ja estouraria com UM escalar ao lado.
    expect(PRISMA_IN_CHUNK_SIZE).toBeLessThanOrEqual(5_000)
    expect(PRISMA_IN_CHUNK_SIZE).toBeGreaterThan(0)
  })

  it('lista vazia nao gera lote nenhum', () => {
    expect(chunkForInClause([])).toEqual([])
  })

  it('lista menor que o teto vira um unico lote', () => {
    expect(chunkForInClause([1n, 2n, 3n], 5)).toEqual([[1n, 2n, 3n]])
  })

  it('nenhum lote passa do teto, e nada se perde nem se repete', () => {
    const ids = Array.from({ length: 32_769 }, (_, i) => BigInt(i))
    const chunks = chunkForInClause(ids)

    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(PRISMA_IN_CHUNK_SIZE)
    expect(chunks.flat()).toEqual(ids)
  })

  it('preserva a ordem original dentro e entre os lotes', () => {
    expect(chunkForInClause([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('recusa tamanho invalido em vez de fatiar errado em silencio', () => {
    expect(() => chunkForInClause([1, 2], 0)).toThrow(RangeError)
    expect(() => chunkForInClause([1, 2], -5)).toThrow(RangeError)
    expect(() => chunkForInClause([1, 2], 1.5)).toThrow(RangeError)
  })
})

describe('findManyInChunks', () => {
  it('nao vai ao banco quando nao ha id', async () => {
    let calls = 0
    const rows = await findManyInChunks<number, number>([], async (chunk) => {
      calls += 1
      return chunk
    })
    expect(rows).toEqual([])
    expect(calls).toBe(0)
  })

  it('faz UMA consulta quando os ids cabem num lote', async () => {
    const seen: number[][] = []
    const rows = await findManyInChunks([1, 2, 3], async (chunk) => {
      seen.push(chunk)
      return chunk.map((id) => id * 10)
    })
    expect(seen).toHaveLength(1)
    expect(rows).toEqual([10, 20, 30])
  })

  it('quebra 32.769 ids em lotes que cabem no protocolo e concatena o resultado', async () => {
    const ids = Array.from({ length: 32_769 }, (_, i) => i)
    const sizes: number[] = []

    const rows = await findManyInChunks(ids, async (chunk) => {
      // O `+ 2` sao os escalares que acompanham o `IN (...)` no `where` real
      // (`entityType` e `languageCode`) — foi essa soma que estourou em
      // producao com 32.769.
      expect(chunk.length + 2).toBeLessThanOrEqual(32_767)
      sizes.push(chunk.length)
      return chunk
    })

    expect(sizes.length).toBeGreaterThan(1)
    expect(rows).toEqual(ids)
  })

  it('executa os lotes em sequencia, nunca em rajada concorrente', async () => {
    const ids = Array.from({ length: 25 }, (_, i) => i)
    let running = 0
    let maxConcurrent = 0

    await findManyInChunks(
      ids,
      async (chunk) => {
        running += 1
        maxConcurrent = Math.max(maxConcurrent, running)
        await Promise.resolve()
        running -= 1
        return chunk
      },
      10,
    )

    expect(maxConcurrent).toBe(1)
  })
})
