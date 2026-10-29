/**
 * discovery-export-discovery.test.ts — Ordem da fila de descoberta.
 *
 * O teste central e o de REGRESSAO: `--limit` e um corte de prefixo, entao a
 * ordem tem que existir ANTES do corte. Com a ordem de arquivo (que o TMDB
 * entrega, aproximadamente por id/data de cadastro), `--limit 2` traria os dois
 * ids mais ANTIGOS e deixaria o titulo popular de fora — o defeito que este
 * modulo existe para impedir.
 */

import { describe, expect, it } from 'vitest'

import { filterAdult } from '../discovery/adult-filter.js'
import {
  EXPORT_LINES_PER_YIELD,
  discoverIdsFromExportBatches,
  discoverIdsFromExportText,
} from '../discovery/export-discovery.js'
import { parseIdExport } from '../discovery/id-exports.js'
import { buildSyncQueue } from '../discovery/sync-queue.js'

/** Monta um export JSONL a partir de objetos (uma linha por registro). */
function jsonl(records: readonly Record<string, unknown>[]): string {
  return records.map((r) => JSON.stringify(r)).join('\n')
}

describe('discoverIdsFromExportText', () => {
  it('ordena por popularidade decrescente, nao pela ordem do arquivo', () => {
    // Ordem de ARQUIVO: id 11 (antigo, impopular) vem primeiro; id 9999 (novo,
    // popular) vem por ultimo — exatamente o layout real de um export do TMDB.
    const text = jsonl([
      { id: 11, original_title: 'Curta obscuro de 1913', adult: false, popularity: 0.6 },
      { id: 42, original_title: 'Medio', adult: false, popularity: 12.5 },
      { id: 9999, original_title: 'Lancamento do momento', adult: false, popularity: 880.4 },
    ])

    const outcome = discoverIdsFromExportText({
      text,
      kind: 'movie',
      hasAdultField: true,
      limit: null,
    })

    expect(outcome.ids).toEqual([9999, 42, 11])
  })

  it('REGRESSAO: o corte do --limit acontece DEPOIS da ordenacao', () => {
    const text = jsonl([
      { id: 11, adult: false, popularity: 0.6 },
      { id: 12, adult: false, popularity: 0.4 },
      { id: 9999, adult: false, popularity: 880.4 },
    ])

    const outcome = discoverIdsFromExportText({
      text,
      kind: 'movie',
      hasAdultField: true,
      limit: 1,
    })

    // Com corte de prefixo sobre a ordem de arquivo, isto seria [11].
    expect(outcome.ids).toEqual([9999])
    expect(outcome.accepted).toBe(1)
    // `discovered` conta o arquivo inteiro, nao o que sobrou apos o corte:
    // o operador precisa ver o universo, nao so a fatia que pediu.
    expect(outcome.discovered).toBe(3)
  })

  it('e deterministico: popularidade ausente vai por ultimo, desempate por id asc', () => {
    const text = jsonl([
      { id: 300, adult: false },
      { id: 100, adult: false },
      { id: 200, adult: false, popularity: 5 },
      { id: 50, adult: false, popularity: 5 },
    ])

    const outcome = discoverIdsFromExportText({
      text,
      kind: 'movie',
      hasAdultField: true,
      limit: null,
    })

    // popularidade 5 primeiro (id asc entre empatados), depois os sem popularidade.
    expect(outcome.ids).toEqual([50, 200, 100, 300])
  })

  it('mantem as duas camadas anti-adulto apos a mudanca de ordem', () => {
    const text = jsonl([
      { id: 1, adult: true, popularity: 999 }, // adulto explicito: nunca entra
      { id: 2, adult: 'false', popularity: 998 }, // malformado: fail-closed
      { id: 3, popularity: 997 }, // ausente num export que deveria traze-lo
      { id: 4, adult: false, popularity: 1 }, // unico seguro
    ])

    const outcome = discoverIdsFromExportText({
      text,
      kind: 'movie',
      hasAdultField: true,
      limit: null,
    })

    // O id 1 tem a MAIOR popularidade: se a ordenacao rodasse antes do filtro,
    // ele seria o primeiro da fila. Ordenar nunca pode reabrir o filtro.
    expect(outcome.ids).toEqual([4])
    expect(outcome.rejectedAdult).toBe(3)
  })

  it('nao descarta tv por ausencia de `adult` (o export de tv nao traz o campo)', () => {
    const text = jsonl([
      { id: 1399, original_name: 'Serie popular', popularity: 300 },
      { id: 1400, original_name: 'Serie obscura', popularity: 0.2 },
    ])

    const outcome = discoverIdsFromExportText({
      text,
      kind: 'tv',
      hasAdultField: false,
      limit: null,
    })

    // Se `buildSyncQueue` tratasse `adult` ausente como unsafe, a fila de series
    // sairia VAZIA — falha silenciosa que zera o espelho de TV inteiro.
    expect(outcome.ids).toEqual([1399, 1400])
    expect(outcome.rejectedAdult).toBe(0)
  })

  it('conta duplicata de id dentro do proprio export', () => {
    const text = jsonl([
      { id: 7, adult: false, popularity: 1 },
      { id: 7, adult: false, popularity: 50 },
      { id: 8, adult: false, popularity: 2 },
    ])

    const outcome = discoverIdsFromExportText({
      text,
      kind: 'movie',
      hasAdultField: true,
      limit: null,
    })

    expect(outcome.duplicate).toBe(1)
    // Dedup deterministico mantem a MAIOR popularidade, entao 7 fica na frente.
    expect(outcome.ids).toEqual([7, 8])
  })
})

/**
 * O pipeline ANTERIOR a 29/10/2026, literal: texto inteiro -> `parseIdExport`
 * -> `filterAdult` -> `buildSyncQueue` -> corte. E a referencia de semantica:
 * a troca para streaming nao pode mudar um id, uma posicao ou uma contagem.
 */
function referencePipeline(text: string, hasAdultField: boolean, limit: number | null) {
  const records = parseIdExport(text)
  const filtered = filterAdult(records, { adultFieldRequired: hasAdultField })
  const queue = buildSyncQueue([{ kind: 'movie', records: filtered.kept }])
  const ordered = limit === null ? queue : queue.slice(0, limit)
  return {
    discovered: records.length,
    accepted: ordered.length,
    rejectedAdult: filtered.adultDropped + filtered.unsafeDropped,
    duplicate: filtered.kept.length - queue.length,
    ids: ordered.map((item) => item.tmdbId),
  }
}

/** PRNG deterministico (mulberry32): o mesmo caso em toda execucao. */
function prng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Export sintetico com empates, repetidos, adulto, malformado e id invalido. */
function randomExport(random: () => number, lines: number): string {
  const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)]!
  const ids: readonly unknown[] = [0, -3, 1.5, 'x', ...Array.from({ length: 40 }, (_, i) => i + 1)]
  const adults: readonly unknown[] = [false, false, false, false, true, 'false', null, undefined]
  const pops: readonly unknown[] = [undefined, 0, 1, 1, 2.5, 7, 7, 30.25, '9']
  const out: string[] = []
  for (let i = 0; i < lines; i += 1) {
    if (random() < 0.03) {
      out.push(pick(['', '   ', '{nao e json', '[1,2]', 'null']))
      continue
    }
    const record: Record<string, unknown> = { id: pick(ids) }
    const adult = pick(adults)
    if (adult !== undefined) record.adult = adult
    const popularity = pick(pops)
    if (popularity !== undefined) record.popularity = popularity
    out.push(JSON.stringify(record))
  }
  return out.join('\n')
}

/** Fonte em lotes SEM IO real: so microtarefas, nunca devolve a thread sozinha. */
async function* inBatches(text: string, size: number): AsyncGenerator<readonly string[]> {
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i += size) yield lines.slice(i, i + size)
}

describe('discoverIdsFromExportBatches — o caminho da fila (29/10/2026)', () => {
  it('e o MESMO desfecho do pipeline anterior em 400 exports aleatorios', async () => {
    const random = prng(20261029)
    for (let round = 0; round < 400; round += 1) {
      const text = randomExport(random, 1 + Math.floor(random() * 120))
      const hasAdultField = random() < 0.5
      const limit = [null, 0, 1, 2, 3, 10, 500][Math.floor(random() * 7)]!
      const expected = referencePipeline(text, hasAdultField, limit)
      const options = { kind: 'movie' as const, hasAdultField, limit }

      expect(discoverIdsFromExportText({ ...options, text })).toEqual(expected)
      const batchSize = 1 + Math.floor(random() * 9)
      expect(
        await discoverIdsFromExportBatches({ ...options, batches: inBatches(text, batchSize) }),
      ).toEqual(expected)
    }
  })

  it('repetido mais popular que chega DEPOIS, com teto, toma o lugar do anterior', async () => {
    // 7 entra na fila com 1; 9 e 8 o expulsam; 7 volta com 50 e tem de ser o 1o.
    // Manter a primeira ocorrencia (o sampler antes de 29/10) deixaria 7 de fora.
    const text = jsonl([
      { id: 7, adult: false, popularity: 1 },
      { id: 9, adult: false, popularity: 20 },
      { id: 8, adult: false, popularity: 10 },
      { id: 7, adult: false, popularity: 50 },
      { id: 9, adult: false, popularity: 2 },
    ])
    const outcome = await discoverIdsFromExportBatches({
      batches: inBatches(text, 1),
      kind: 'movie',
      hasAdultField: true,
      limit: 2,
    })
    expect(outcome.ids).toEqual([7, 9])
    expect(outcome.duplicate).toBe(2)
  })

  it('REGRESSAO: devolve o event loop no meio do export, mesmo de uma fonte sem IO', async () => {
    // O defeito de 29/10: o export inteiro num trecho sincrono — sem `/healthz`
    // e sem heartbeat do job ate o fim. Aqui a fonte so usa microtarefas; quem
    // abre espaco para o timer e a propria descoberta.
    const lines = EXPORT_LINES_PER_YIELD * 5
    const text = Array.from({ length: lines }, (_, i) =>
      JSON.stringify({ id: i + 1, adult: false, popularity: i % 97 }),
    ).join('\n')

    for (const batchSize of [500, lines]) {
      let turns = 0
      let running = true
      const spin = (): void => {
        if (!running) return
        turns += 1
        setImmediate(spin)
      }
      setImmediate(spin)
      const outcome = await discoverIdsFromExportBatches({
        batches: inBatches(text, batchSize),
        kind: 'person',
        hasAdultField: true,
        limit: 3,
      })
      running = false
      expect(outcome.discovered).toBe(lines)
      // Um lote do tamanho do arquivo nao pode virar de novo o trecho unico.
      expect(turns).toBeGreaterThanOrEqual(4)
    }
  })

  it('para entre dois lotes quando o job e abortado (shutdown ou timeout)', async () => {
    const text = Array.from({ length: EXPORT_LINES_PER_YIELD * 3 }, (_, i) =>
      JSON.stringify({ id: i + 1, adult: false, popularity: 1 }),
    ).join('\n')
    const controller = new AbortController()
    setImmediate(() => controller.abort())
    await expect(
      discoverIdsFromExportBatches({
        batches: inBatches(text, 1_000),
        kind: 'movie',
        hasAdultField: true,
        limit: 10,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
