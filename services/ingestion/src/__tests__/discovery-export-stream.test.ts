/**
 * O download do Daily ID Export em streaming (`discovery/export-stream.ts`).
 *
 * Substitui o `gunzipSync` + `toString` dos dois bins (29/10/2026). O que nao
 * pode regredir na troca: o gzip continua decidido pelos BYTES (o export chega
 * sem `content-encoding`), nenhuma linha se perde ou se parte na fronteira de
 * um pedaco — nem um caractere multibyte —, e erro de rede ou gzip corrompido
 * REJEITA em vez de terminar com "0 ids" e sucesso.
 */

import { gzipSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import {
  discoverIdsFromExportBatches,
  discoverIdsFromExportText,
} from '../discovery/export-discovery.js'
import { streamExportLines } from '../discovery/export-stream.js'

/** Nomes reais do export de pessoas cruzam a fronteira de pedaco em UTF-8. */
const TEXT = [
  { adult: false, id: 21684, name: 'Bong Joon-ho', popularity: 9.1 },
  { adult: false, id: 1, name: '봉준호', popularity: 3.5 },
  { adult: false, id: 608, name: '宮崎駿', popularity: 12.75 },
  { adult: true, id: 77, name: 'X', popularity: 999 },
  { adult: false, id: 5, name: 'Zoë Kravitz — ação', popularity: 40 },
]
  .map((record) => JSON.stringify(record))
  .join('\n')

/** Corpo em pedacos minusculos: forca linha e caractere partidos ao meio. */
function bodyOf(bytes: Uint8Array, chunkSize: number): ReadableStream<Uint8Array> {
  let offset = 0
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close()
        return
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize))
      offset += chunkSize
    },
  })
}

function fakeFetch(bytes: Uint8Array, chunkSize: number, status = 200): typeof fetch {
  return (async () => new Response(bodyOf(bytes, chunkSize), { status })) as typeof fetch
}

async function collect(lines: AsyncIterable<readonly string[]>): Promise<string[]> {
  const out: string[] = []
  for await (const batch of lines) out.push(...batch)
  return out
}

describe('streamExportLines', () => {
  it('descomprime gzip pelos bytes e preserva cada linha, em qualquer fronteira', async () => {
    const gz = gzipSync(Buffer.from(TEXT, 'utf8'))
    // 1 byte: o proprio numero magico chega partido em dois pedacos.
    for (const chunkSize of [1, 3, 7, 64, gz.length]) {
      const lines = await collect(
        streamExportLines('https://files.tmdb.org/p/exports/x.json.gz', {
          fetchImpl: fakeFetch(gz, chunkSize),
        }),
      )
      expect(lines).toEqual(TEXT.split('\n'))
    }
  })

  it('aceita o corpo ja descomprimido (export servido com content-encoding)', async () => {
    const plain = Buffer.from(`${TEXT}\n`, 'utf8')
    const lines = await collect(streamExportLines('https://x', { fetchImpl: fakeFetch(plain, 5) }))
    // A linha vazia depois do `\n` final nao e entregue — o parse a pularia.
    expect(lines).toEqual(TEXT.split('\n'))
  })

  it('HTTP de erro rejeita, nunca vira export vazio', async () => {
    await expect(
      collect(streamExportLines('https://x', { fetchImpl: fakeFetch(new Uint8Array(), 1, 404) })),
    ).rejects.toThrow('export HTTP 404')
  })

  it('gzip corrompido REJEITA em vez de terminar com sucesso e 0 linhas', async () => {
    const gz = gzipSync(Buffer.from(TEXT, 'utf8'))
    const broken = Buffer.concat([gz.subarray(0, 20), Buffer.from('lixo no meio do arquivo')])
    await expect(
      collect(streamExportLines('https://x', { fetchImpl: fakeFetch(broken, 4) })),
    ).rejects.toThrow()
  })

  it('o caminho inteiro da fila da o mesmo desfecho do texto em memoria', async () => {
    const gz = gzipSync(Buffer.from(TEXT, 'utf8'))
    const options = { kind: 'person' as const, hasAdultField: true, limit: 3 }
    const streamed = await discoverIdsFromExportBatches({
      ...options,
      batches: streamExportLines('https://x', { fetchImpl: fakeFetch(gz, 7) }),
    })
    expect(streamed).toEqual(discoverIdsFromExportText({ ...options, text: TEXT }))
    expect(streamed.ids).toEqual([5, 608, 21684])
    expect(streamed.rejectedAdult).toBe(1)
  })
})
