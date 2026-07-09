/**
 * Testes da leitura/selecao do piloto (P0-00d): parse defensivo da linha NDJSON e
 * o seletor (limite por tipo, split suportado/unsupported, scan inteiro para
 * contar unsupportedSkipped honestamente, memoria limitada). Sem rede, sem DB.
 */

import { describe, expect, it } from 'vitest'
import type { QueueItem } from '../discovery/sync-queue.js'
import {
  createPilotSelector,
  parseRawQueueLine,
  selectPilotItems,
  totalLimit,
} from '../raw-sync/queue.js'

describe('parseRawQueueLine', () => {
  it('parseia linha valida', () => {
    expect(parseRawQueueLine('{"kind":"movie","tmdbId":27205,"popularity":9.1}')).toEqual({
      kind: 'movie',
      tmdbId: 27205,
      popularity: 9.1,
    })
  })

  it('popularity ausente/nao-finita vira null', () => {
    expect(parseRawQueueLine('{"kind":"tv","tmdbId":1399}')?.popularity).toBeNull()
    expect(parseRawQueueLine('{"kind":"tv","tmdbId":1399,"popularity":null}')?.popularity).toBeNull()
  })

  it('descarta linha vazia, JSON invalido, kind desconhecido ou tmdbId invalido', () => {
    expect(parseRawQueueLine('')).toBeNull()
    expect(parseRawQueueLine('   ')).toBeNull()
    expect(parseRawQueueLine('{nao json')).toBeNull()
    expect(parseRawQueueLine('{"kind":"banana","tmdbId":1}')).toBeNull()
    expect(parseRawQueueLine('{"kind":"movie","tmdbId":0}')).toBeNull()
    expect(parseRawQueueLine('{"kind":"movie","tmdbId":-3}')).toBeNull()
    expect(parseRawQueueLine('{"kind":"movie","tmdbId":1.5}')).toBeNull()
    expect(parseRawQueueLine('[1,2,3]')).toBeNull()
  })
})

/** Helper: monta itens de fila rapidamente. */
function item(kind: QueueItem['kind'], tmdbId: number): QueueItem {
  return { kind, tmdbId, popularity: null }
}

describe('selectPilotItems / createPilotSelector', () => {
  it('limita por tipo e separa suportados de nao-suportados', () => {
    const queue: QueueItem[] = [
      item('movie', 1),
      item('movie', 2),
      item('movie', 3),
      item('tv', 10),
      item('person', 100),
      item('collection', 500),
      item('network', 600),
      item('company', 700),
      item('keyword', 800),
    ]
    const selection = selectPilotItems(queue, { movie: 2, tv: 5, person: 5 })

    expect(selection.selected.map((q) => `${q.kind}:${q.tmdbId}`)).toEqual([
      'movie:1',
      'movie:2', // movie:3 fica de fora (limite 2)
      'tv:10',
      'person:100',
    ])
    expect(selection.perKindSelected).toEqual({ movie: 2, tv: 1, person: 1 })
  })

  it('faz scan INTEIRO: conta TODOS os unsupported, mesmo apos atingir limites', () => {
    const queue: QueueItem[] = [
      item('movie', 1),
      item('collection', 500),
      item('collection', 501),
      item('network', 600),
      item('company', 700),
      item('keyword', 800),
      item('keyword', 801),
    ]
    const selection = selectPilotItems(queue, { movie: 1, tv: 1, person: 1 })

    expect(selection.unsupportedSkipped).toBe(6)
    expect(selection.unsupportedByKind).toEqual({
      collection: 2,
      network: 1,
      company: 1,
      keyword: 2,
    })
    expect(selection.scanned).toBe(7)
  })

  it('excedente de tipo suportado NAO conta como unsupported (apenas fora do piloto)', () => {
    const queue: QueueItem[] = [item('movie', 1), item('movie', 2), item('movie', 3)]
    const selection = selectPilotItems(queue, { movie: 1, tv: 1, person: 1 })
    expect(selection.selected).toHaveLength(1)
    expect(selection.unsupportedSkipped).toBe(0)
    expect(selection.scanned).toBe(3)
  })

  it('dedup: (kind,tmdbId) repetido na fila e selecionado UMA vez (sem payload duplicado)', () => {
    // A mesma (movie,1) tres vezes + (tv,1) que NAO colide com (movie,1) por tipo.
    const queue: QueueItem[] = [
      item('movie', 1),
      item('movie', 1),
      item('movie', 1),
      item('tv', 1),
      item('person', 2),
      item('person', 2),
    ]
    const selection = selectPilotItems(queue, { movie: 5, tv: 5, person: 5 })
    expect(selection.selected.map((q) => `${q.kind}:${q.tmdbId}`)).toEqual([
      'movie:1',
      'tv:1',
      'person:2',
    ])
    expect(selection.perKindSelected).toEqual({ movie: 1, tv: 1, person: 1 })
    // scan honesto: TODAS as linhas contam, mesmo as repetidas.
    expect(selection.scanned).toBe(6)
    expect(selection.unsupportedSkipped).toBe(0)
  })

  it('dedup nao "gasta" a vaga do limite com repetidos: id distinto seguinte ainda entra', () => {
    const queue: QueueItem[] = [item('movie', 1), item('movie', 1), item('movie', 2)]
    const selection = selectPilotItems(queue, { movie: 2, tv: 1, person: 1 })
    expect(selection.selected.map((q) => q.tmdbId)).toEqual([1, 2])
    expect(selection.perKindSelected.movie).toBe(2)
  })

  it('o seletor incremental equivale a selecao em array (memoria limitada)', () => {
    const queue: QueueItem[] = [item('movie', 1), item('collection', 9), item('person', 2)]
    const selector = createPilotSelector({ movie: 10, tv: 10, person: 10 })
    for (const it of queue) selector.offer(it)
    expect(selector.result()).toEqual(selectPilotItems(queue, { movie: 10, tv: 10, person: 10 }))
  })

  it('totalLimit soma os limites dos tipos suportados', () => {
    expect(totalLimit({ movie: 100, tv: 100, person: 100 })).toBe(300)
  })
})
