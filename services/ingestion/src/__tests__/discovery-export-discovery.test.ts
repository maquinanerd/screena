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

import { discoverIdsFromExportText } from '../discovery/export-discovery.js'

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
