/**
 * O teto do `--max-per-type` e TOP-N por POPULARIDADE — nunca corte de prefixo.
 *
 * A prova nos DOIS sentidos: os registros mais populares chegam no FIM do
 * arquivo (o export vem em ordem de id, aproximadamente cronologica); um corte
 * de prefixo devolveria os ids ANTIGOS do comeco, e a amostra correta devolve
 * os POPULARES do fim.
 */

import { describe, expect, it } from 'vitest'

import { createTopRecordSampler } from '../discovery/export-sample.js'
import type { IdExportRecord } from '../discovery/id-exports.js'

/** Export sintetico em ordem de id: os POPULARES estao no fim do arquivo. */
const FILE_ORDER: IdExportRecord[] = [
  { id: 11, adult: false, popularity: 0.6 }, // o "curta obscuro de 1913"
  { id: 12, adult: false, popularity: 0.7 },
  { id: 13, adult: false, popularity: 1.1 },
  { id: 9998, adult: false, popularity: 88.4 },
  { id: 9999, adult: false, popularity: 97.3 },
]

function sample(records: readonly IdExportRecord[], limit: number | null, required = true) {
  const sampler = createTopRecordSampler({ limit, adultFieldRequired: required })
  for (const record of records) sampler.offer(record)
  return sampler.finish()
}

describe('top-N por popularidade, nunca prefixo', () => {
  it('SENTIDO 1 — com o teto, a amostra e o TOP por popularidade (o fim do arquivo)', () => {
    const result = sample(FILE_ORDER, 2)
    expect(result.kept.map((r) => r.id)).toEqual([9999, 9998])
  })

  it('SENTIDO 2 — a amostra NUNCA e o prefixo do arquivo', () => {
    const result = sample(FILE_ORDER, 2)
    // O corte de prefixo devolveria [11, 12] — exatamente o defeito.
    expect(result.kept.map((r) => r.id)).not.toEqual([11, 12])
  })

  it('sem teto (null): mantem TUDO, ainda assim ordenado por popularidade', () => {
    const result = sample(FILE_ORDER, null)
    expect(result.kept.map((r) => r.id)).toEqual([9999, 9998, 13, 12, 11])
  })

  it('sem popularidade vai para o FIM; empate desempata por id asc (ordem total)', () => {
    const result = sample(
      [
        { id: 30, adult: false },
        { id: 20, adult: false, popularity: 5 },
        { id: 10, adult: false, popularity: 5 },
        { id: 40, adult: false },
      ],
      null,
    )
    expect(result.kept.map((r) => r.id)).toEqual([10, 20, 30, 40])
  })

  it('teto maior que o universo devolve o universo inteiro ordenado', () => {
    const result = sample(FILE_ORDER, 50)
    expect(result.kept).toHaveLength(FILE_ORDER.length)
    expect(result.kept[0]?.id).toBe(9999)
  })
})

describe('as duas camadas anti-adulto continuam FAIL-CLOSED na amostra', () => {
  it('adult === true e descartado mesmo sendo o mais popular', () => {
    const result = sample(
      [
        { id: 1, adult: true, popularity: 999 },
        { id: 2, adult: false, popularity: 1 },
      ],
      1,
    )
    expect(result.kept.map((r) => r.id)).toEqual([2])
    expect(result.counts.adultDropped).toBe(1)
  })

  it('adult malformado/ausente (quando obrigatorio) cai como unsafe, nunca presumido seguro', () => {
    const result = sample(
      [
        { id: 1, popularity: 999 } as IdExportRecord, // ausente em export que exige
        { id: 2, adult: 'true' as unknown as boolean, popularity: 500 },
        { id: 3, adult: false, popularity: 1 },
      ],
      3,
      true,
    )
    expect(result.kept.map((r) => r.id)).toEqual([3])
    expect(result.counts.unsafeDropped).toBe(2)
  })

  it('em export SEM campo adult (collection/network/...), ausencia e segura', () => {
    const result = sample([{ id: 1, popularity: 2 } as IdExportRecord], 5, false)
    expect(result.kept.map((r) => r.id)).toEqual([1])
  })

  it('id invalido e duplicata sao contados, nunca descartados em silencio', () => {
    const result = sample(
      [
        { id: 0, adult: false, popularity: 9 },
        { id: 5, adult: false, popularity: 3 },
        { id: 5, adult: false, popularity: 8 },
      ],
      5,
    )
    expect(result.kept.map((r) => r.id)).toEqual([5])
    expect(result.counts.invalidDropped).toBe(1)
    expect(result.counts.duplicate).toBe(1)
  })
})
