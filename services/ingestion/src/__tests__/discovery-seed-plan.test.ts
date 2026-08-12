/**
 * discovery-seed-plan.test.ts — Trava do defeito de CORTE DE PREFIXO.
 *
 * O Daily ID Export e publicado aproximadamente em ordem de id (data de
 * cadastro no TMDB). Cortar as N primeiras linhas devolve os N titulos mais
 * ANTIGOS, nao os mais populares — e a ordenacao por popularidade, se rodar
 * DEPOIS do corte, ordena um universo ja truncado e nao repara nada.
 *
 * O teste central prova o defeito NOS DOIS SENTIDOS, no mesmo export: o corte
 * de prefixo devolve `[11]` (id baixo, popularidade irrisoria) e a selecao
 * correta devolve `[9999]` (id alto, popularidade alta). Um controle positivo
 * garante que a assercao nao passaria com uma implementacao errada.
 */

import { describe, expect, it } from 'vitest'

import type { IdExportRecord } from '../discovery/id-exports.js'
import {
  buildSeedPlan,
  FALLBACK_AVG_BYTES_BY_KIND,
  formatBytes,
  resolveBytesPerEntity,
  SEED_KINDS,
  selectTopByPopularity,
} from '../discovery/seed-plan.js'

/**
 * Export minimo com a patologia real: o id BAIXO vem primeiro e e irrelevante;
 * o id ALTO vem por ultimo e e o titulo que o usuario procura.
 */
const EXPORT_WITH_LOW_ID_FIRST: readonly IdExportRecord[] = [
  { id: 11, popularity: 0.6, original_title: 'Filme antigo e obscuro' },
  { id: 12, popularity: 0.4, original_title: 'Outro antigo' },
  { id: 13, popularity: 0.2, original_title: 'Mais um antigo' },
  { id: 9999, popularity: 512.3, original_title: 'Lancamento que todo mundo procura' },
]

/** O defeito, reproduzido: parar de ler nas N primeiras linhas do arquivo. */
function prefixCut(records: readonly IdExportRecord[], limit: number): number[] {
  return records.slice(0, limit).map((r) => r.id)
}

describe('corte de prefixo vs selecao por popularidade — os dois sentidos', () => {
  it('a ORDEM ANTIGA (corte de prefixo) devolve [11] — o id mais antigo', () => {
    expect(prefixCut(EXPORT_WITH_LOW_ID_FIRST, 1)).toEqual([11])
  })

  it('a ORDEM NOVA (selectTopByPopularity) devolve [9999] — o mais popular', () => {
    const selection = selectTopByPopularity('movie', EXPORT_WITH_LOW_ID_FIRST, 1)
    expect(selection.candidates.map((c) => c.tmdbId)).toEqual([9999])
  })

  it('a selecao consome o export INTEIRO: o melhor pode ser a ULTIMA linha', () => {
    // Se a implementacao parasse cedo, este caso falharia — e a garantia
    // estrutural que impede o defeito de voltar.
    const tail: IdExportRecord[] = [
      ...Array.from({ length: 5_000 }, (_, i) => ({ id: i + 1, popularity: 0.1 })),
      { id: 777_777, popularity: 999 },
    ]
    const selection = selectTopByPopularity('movie', tail, 3)
    expect(selection.candidates[0]?.tmdbId).toBe(777_777)
    expect(selection.stats.considered).toBe(5_001)
  })

  it('respeita o limite e ordena por popularidade desc', () => {
    const selection = selectTopByPopularity('movie', EXPORT_WITH_LOW_ID_FIRST, 3)
    expect(selection.candidates.map((c) => c.tmdbId)).toEqual([9999, 11, 12])
  })

  it('desempata por id asc — o plano tem de ser reproduzivel', () => {
    const tied: IdExportRecord[] = [
      { id: 30, popularity: 5 },
      { id: 10, popularity: 5 },
      { id: 20, popularity: 5 },
    ]
    expect(selectTopByPopularity('movie', tied, 3).candidates.map((c) => c.tmdbId)).toEqual([
      10, 20, 30,
    ])
  })

  it('sem popularidade vai para o FIM, nunca para o inicio', () => {
    const mixed: IdExportRecord[] = [
      { id: 1 },
      { id: 2, popularity: Number.NaN },
      { id: 3, popularity: 0.01 },
      { id: 4, popularity: 'alta' as unknown as number },
    ]
    const selection = selectTopByPopularity('movie', mixed, 4)
    expect(selection.candidates[0]?.tmdbId).toBe(3)
    expect(selection.stats.missingPopularity).toBe(3)
  })
})

describe('selectTopByPopularity — nenhum descarte e anonimo (B-H)', () => {
  it('conta id invalido, duplicata, sem-popularidade e abaixo do corte', () => {
    const messy: IdExportRecord[] = [
      { id: 0, popularity: 100 },
      { id: -5, popularity: 100 },
      { id: 1.5 as number, popularity: 100 },
      { id: 10, popularity: 9 },
      { id: 10, popularity: 9 },
      { id: 20 },
      { id: 30, popularity: 1 },
    ]
    const selection = selectTopByPopularity('movie', messy, 1)
    expect(selection.stats).toEqual({
      considered: 3,
      invalidId: 3,
      missingPopularity: 1,
      duplicate: 1,
      selected: 1,
      belowCut: 2,
      cutoffPopularity: 9,
      topPopularity: 9,
    })
  })

  it('limite zero seleciona nada mas AINDA conta o que viu', () => {
    const selection = selectTopByPopularity('movie', EXPORT_WITH_LOW_ID_FIRST, 0)
    expect(selection.candidates).toEqual([])
    expect(selection.stats.considered).toBe(4)
    expect(selection.stats.belowCut).toBe(4)
  })

  it('export vazio nao mente sobre corte', () => {
    const selection = selectTopByPopularity('movie', [], 100)
    expect(selection.stats.cutoffPopularity).toBeNull()
    expect(selection.stats.topPopularity).toBeNull()
    expect(selection.stats.considered).toBe(0)
  })

  it('memoria limitada ao teto: um universo grande nao materializa tudo', () => {
    const huge = (function* () {
      for (let i = 1; i <= 200_000; i += 1) yield { id: i, popularity: i % 1_000 }
    })()
    const selection = selectTopByPopularity('movie', huge, 10)
    expect(selection.candidates).toHaveLength(10)
    expect(selection.stats.considered).toBe(200_000)
    expect(selection.candidates.every((c) => c.popularity === 999)).toBe(true)
  })
})

describe('a semente nao inclui pessoas', () => {
  it('SEED_KINDS e exatamente movie e tv', () => {
    expect([...SEED_KINDS]).toEqual(['movie', 'tv'])
    expect(SEED_KINDS as readonly string[]).not.toContain('person')
  })
})

describe('dimensionamento do plano', () => {
  const selections = [
    selectTopByPopularity(
      'movie',
      Array.from({ length: 100 }, (_, i) => ({ id: i + 1, popularity: i })),
      40,
    ),
    selectTopByPopularity(
      'tv',
      Array.from({ length: 100 }, (_, i) => ({ id: i + 1, popularity: i })),
      10,
    ),
  ]

  it('requests = entidades x blocos de append (derivado, nao chutado)', () => {
    const plan = buildSeedPlan({ selections, appendChunksByKind: { movie: 1, tv: 1 } })
    expect(plan.totalEntities).toBe(50)
    expect(plan.totalRequests).toBe(50)

    const twoChunks = buildSeedPlan({ selections, appendChunksByKind: { movie: 1, tv: 2 } })
    expect(twoChunks.totalRequests).toBe(40 * 1 + 10 * 2)
  })

  it('sem medicao real usa o fallback e DECLARA que usou', () => {
    const plan = buildSeedPlan({ selections, appendChunksByKind: { movie: 1, tv: 1 } })
    expect(plan.usesFallbackBytes).toBe(true)
    expect(plan.kinds.every((k) => k.bytesPerEntity.basis === 'fallback')).toBe(true)
    expect(plan.totalRawBytes).toBe(
      40 * FALLBACK_AVG_BYTES_BY_KIND.movie + 10 * FALLBACK_AVG_BYTES_BY_KIND.tv,
    )
  })

  it('com medicao real usa a medicao e declara a amostra', () => {
    const plan = buildSeedPlan({
      selections,
      appendChunksByKind: { movie: 1, tv: 1 },
      measured: [
        { kind: 'movie', avgBytes: 120_000, sampleSize: 300 },
        { kind: 'tv', avgBytes: 900_000, sampleSize: 42 },
      ],
    })
    expect(plan.usesFallbackBytes).toBe(false)
    expect(plan.totalRawBytes).toBe(40 * 120_000 + 10 * 900_000)
    expect(plan.kinds[0]?.bytesPerEntity).toEqual({
      kind: 'movie',
      avgBytes: 120_000,
      basis: 'measured',
      sampleSize: 300,
    })
  })

  it('medicao com amostra zero NAO se disfarca de medicao', () => {
    const resolved = resolveBytesPerEntity('movie', [{ kind: 'movie', avgBytes: 1, sampleSize: 0 }])
    expect(resolved.basis).toBe('fallback')
  })

  it('formata bytes em base 1000 (a mesma que o provedor cobra)', () => {
    expect(formatBytes(999)).toBe('999 B')
    expect(formatBytes(1_000)).toBe('1.00 kB')
    expect(formatBytes(12_500_000_000)).toBe('12.50 GB')
  })
})
