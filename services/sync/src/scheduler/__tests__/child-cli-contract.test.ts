/**
 * O contrato entre o AGENDADOR e as CLIs que ele spawna.
 *
 * POR QUE ESTE TESTE EXISTE
 * ---------------------------------------------------------------------------
 * Duas filas falharam em producao **todo tique desde que nasceram**, por
 * desencontro de argumento entre chamador e CLI filho:
 *
 *   cinerie_score:     compute-cinerie-score saiu com codigo 1:
 *                      argumento desconhecido: "--type"
 *   search_projection: catalog search-reindex saiu com codigo 3:
 *                      escrita em producao exige --force explicito
 *
 * Nenhum teste podia pegar isso, porque nao havia teste que juntasse os dois
 * lados: o agendador montava `string[]`, a CLI parseava `string[]`, e ninguem
 * verificava que um casava com o outro. A auditoria concluiu que "o motor do
 * Score nunca rodou" — ele rodava, e morria no parse de argumento.
 *
 * COMO ESTE TESTE E DIFERENTE DE UM QUE COPIA A INVOCACAO
 * ---------------------------------------------------------------------------
 * Ele importa a funcao REAL que o agendador usa (`buildCinerieScoreArgs`) e
 * passa a saida pelo parser REAL do filho (`parseScoreArgs`). Um teste que
 * copiasse `['--type=all']` a mao continuaria verde no dia em que o agendador
 * mudasse a forma — que e exatamente como o defeito original sobreviveu.
 */

import { describe, expect, it } from 'vitest'

import { parseScoreArgs } from '../../../../ratings/src/score/args.js'
// De `child-args.js`, e nao de `runners.js`: aquele modulo e PURO, e este teste
// so precisa das duas funcoes. Importar `runners.js` arrastaria
// `@screena/db/server` e exigiria o client do Prisma gerado — foi exatamente o
// custo que manteve este contrato sem teste ate agora.
import { buildCinerieScoreArgs, buildSearchReindexArgs } from '../runtime/child-args.js'

describe('contrato agendador -> compute-cinerie-score', () => {
  it('o que o agendador monta, o parser do filho ACEITA (dry-run)', () => {
    const argv = [...buildCinerieScoreArgs(false)]
    const r = parseScoreArgs(argv)
    expect(r.ok, r.ok ? '' : `o filho recusaria \`${argv.join(' ')}\`: ${r.error}`).toBe(true)
    if (!r.ok) return
    expect(r.args).toEqual({ apply: false, type: 'all', limit: null })
  })

  it('o que o agendador monta, o parser do filho ACEITA (--apply)', () => {
    const argv = [...buildCinerieScoreArgs(true)]
    const r = parseScoreArgs(argv)
    expect(r.ok, r.ok ? '' : `o filho recusaria \`${argv.join(' ')}\`: ${r.error}`).toBe(true)
    if (!r.ok) return
    expect(r.args).toEqual({ apply: true, type: 'all', limit: null })
  })

  it('CONTROLE NEGATIVO: a forma que estava em producao seria pega hoje', () => {
    // Era literalmente `['--type', 'all']` + `--apply`. O parser aceita as duas
    // formas agora, entao o que prova o conserto e o OUTRO lado: o agendador
    // passou a mandar a forma explicita.
    expect(buildCinerieScoreArgs(true)).toContain('--type=all')
    expect(buildCinerieScoreArgs(true)).not.toContain('--type')
  })
})

describe('contrato agendador -> catalog search-reindex', () => {
  it('em --apply, manda TAMBEM --force', () => {
    // Sem `--force`, `evaluateCatalogGate` recusa com `production-write` e a
    // fila sai com codigo 3. Foi por isso que a projecao de busca ficou parada
    // desde 2026-08-20 e a busca cobria 107 dos 239 titulos.
    const argv = buildSearchReindexArgs(true)
    expect(argv).toContain('search-reindex')
    expect(argv).toContain('--apply')
    expect(argv, 'sem --force o gate de producao recusa a escrita').toContain('--force')
  })

  it('em dry-run, NAO manda --force nem --apply', () => {
    // Dry-run e leitura: pedir `--force` ali seria pedir autorizacao de escrita
    // para nao escrever nada.
    const argv = buildSearchReindexArgs(false)
    expect(argv).toContain('--dry-run')
    expect(argv).not.toContain('--apply')
    expect(argv).not.toContain('--force')
  })

  it('CONTROLE NEGATIVO: o par --apply sem --force e o defeito de producao', () => {
    const argv = buildSearchReindexArgs(true)
    const temApply = argv.includes('--apply')
    const temForce = argv.includes('--force')
    expect(
      temApply && !temForce,
      'esta e exatamente a combinacao que saia com codigo 3 em producao',
    ).toBe(false)
  })
})
