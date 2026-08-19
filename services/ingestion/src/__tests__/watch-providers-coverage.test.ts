/**
 * watch-providers-coverage.test.ts — O veredito de cobertura NAO pode ser
 * derivado do proprio deposito.
 *
 * Este arquivo trava o 14o caso de falha silenciosa catalogado no projeto — e o
 * unico que nao perde dado: ele CERTIFICA cobertura falsa. Em producao, com o
 * deposito congelado em 100 linhas e o catalogo com 129 filmes e 110 series, o
 * comando imprimiu "corpus INTEIRO" e "falhas 0".
 *
 * As asercoes sao sobre o VEREDITO (objeto tipado), nunca sobre substring de
 * saida: este repositorio ja teve quatro testes passando pelo motivo errado.
 */

import { describe, expect, it } from 'vitest'

import {
  CorpusCoverageInputError,
  coverageDemandsAttention,
  describeCorpusCoverage,
  renderCorpusCoverage,
} from '../watch-providers/coverage.js'

describe('describeCorpusCoverage — o denominador vem do catalogo', () => {
  it('RECRIA A PRODUCAO: deposito com 100, catalogo com 139 => INCOMPLETA', () => {
    // Estes sao os numeros medidos: 129 filmes + 110 series no catalogo, 100 por
    // tipo no deposito. Aqui, o recorte de um tipo com 139 no catalogo.
    const verdict = describeCorpusCoverage({
      catalogTotal: 139,
      scanned: 100,
      missingFromDepot: 0,
    })
    expect(verdict.complete).toBe(false)
    if (verdict.complete) throw new Error('inalcancavel')
    expect(verdict.gap).toBe('limit-truncated')
    expect(verdict.notScanned).toBe(39)
    expect(verdict.missingFromDepot).toBe(0)
  })

  it('CONTROLE NEGATIVO DA FORMULA ANTIGA: com o deposito como denominador, o mesmo ciclo diria completo', () => {
    // A formula antiga era `rows.length < source.count()`. Com o deposito
    // respondendo 100 para as duas pontas, ela concluia completude. Este teste
    // existe para que a diferenca entre os dois denominadores seja EXECUTAVEL:
    // se alguem reconectar `catalogTotal` a contagem do deposito, o primeiro
    // teste deste bloco passa a devolver `complete: true` e reprova.
    const comDenominadorDoDeposito = describeCorpusCoverage({
      catalogTotal: 100,
      scanned: 100,
      missingFromDepot: 0,
    })
    const comDenominadorDoCatalogo = describeCorpusCoverage({
      catalogTotal: 139,
      scanned: 100,
      missingFromDepot: 0,
    })
    expect(comDenominadorDoDeposito.complete).toBe(true)
    expect(comDenominadorDoCatalogo.complete).toBe(false)
  })

  it('separa a lacuna de --limit da lacuna de deposito: curas diferentes', () => {
    const soLimite = describeCorpusCoverage({ catalogTotal: 10, scanned: 4, missingFromDepot: 0 })
    const soDeposito = describeCorpusCoverage({ catalogTotal: 10, scanned: 10, missingFromDepot: 3 })
    const ambas = describeCorpusCoverage({ catalogTotal: 10, scanned: 6, missingFromDepot: 2 })

    if (soLimite.complete || soDeposito.complete || ambas.complete) {
      throw new Error('nenhum destes pode ser completo')
    }
    expect(soLimite.gap).toBe('limit-truncated')
    expect(soDeposito.gap).toBe('depot-gap')
    expect(ambas.gap).toBe('both')
    expect(soDeposito.notScanned).toBe(0)
    expect(soDeposito.missingFromDepot).toBe(3)
  })

  it('so declara completo quando as DUAS lacunas sao zero', () => {
    const verdict = describeCorpusCoverage({ catalogTotal: 12, scanned: 12, missingFromDepot: 0 })
    expect(verdict.complete).toBe(true)
    expect(coverageDemandsAttention(verdict)).toBe(false)
  })

  it('escaneou tudo mas 1 sem bruto => NAO e completo (foi este o caso invisivel)', () => {
    const verdict = describeCorpusCoverage({ catalogTotal: 12, scanned: 12, missingFromDepot: 1 })
    expect(verdict.complete).toBe(false)
    expect(coverageDemandsAttention(verdict)).toBe(true)
  })

  it('catalogo VAZIO nao e cobertura total — e sinal de fonte errada', () => {
    const verdict = describeCorpusCoverage({ catalogTotal: 0, scanned: 0, missingFromDepot: 0 })
    expect(verdict.complete).toBe(false)
    expect(coverageDemandsAttention(verdict)).toBe(true)
  })

  it('medida incoerente LANCA em vez de virar veredito plausivel', () => {
    expect(() =>
      describeCorpusCoverage({ catalogTotal: 10, scanned: 5, missingFromDepot: 6 }),
    ).toThrow(CorpusCoverageInputError)
    expect(() =>
      describeCorpusCoverage({ catalogTotal: 5, scanned: 10, missingFromDepot: 0 }),
    ).toThrow(CorpusCoverageInputError)
    expect(() =>
      describeCorpusCoverage({ catalogTotal: 10, scanned: -1, missingFromDepot: 0 }),
    ).toThrow(CorpusCoverageInputError)
  })
})

describe('renderCorpusCoverage — a frase de completude e inalcancavel para veredito com lacuna', () => {
  /**
   * Asercao pelo ENDERECO da afirmacao, nao pela palavra: varremos TODOS os
   * vereditos incompletos possiveis na grade e exigimos que nenhum produza a
   * marca de completude. Um `not.toContain` sobre uma unica string diria muito
   * menos.
   */
  it('nenhuma combinacao incompleta emite a marca "(corpus INTEIRO)"', () => {
    const MARK = '(corpus INTEIRO)'
    let incompletosVistos = 0
    for (let catalogTotal = 0; catalogTotal <= 6; catalogTotal += 1) {
      for (let scanned = 0; scanned <= catalogTotal; scanned += 1) {
        for (let missing = 0; missing <= scanned; missing += 1) {
          const verdict = describeCorpusCoverage({
            catalogTotal,
            scanned,
            missingFromDepot: missing,
          })
          const line = renderCorpusCoverage(verdict)
          if (verdict.complete) {
            expect(line.includes(MARK)).toBe(true)
            continue
          }
          incompletosVistos += 1
          expect(line.includes(MARK)).toBe(false)
        }
      }
    }
    // Prova que a grade exercitou o caso que importa (senao o loop poderia estar
    // vazio e o teste passaria pelo motivo errado).
    expect(incompletosVistos).toBeGreaterThan(10)
  })
})
