/**
 * promotion-batch-args.test.ts — a selecao em LOTE, e os limites dela.
 *
 * ============================================================================
 * POR QUE O LOTE PRECISOU EXISTIR
 * ============================================================================
 * Sao **70.036 ofertas com `display_allowed = false`** (de 70.869), e "onde
 * assistir" aparece em 147 de 83.314 titulos. A CLI de promocao exigia `--ids`
 * EXPLICITO e nao tinha modo em massa — entao a decisao humana de licenca, mesmo
 * tomada, nao tinha como virar produto: ninguem digita 70 mil ids.
 *
 * ============================================================================
 * POR QUE A MAIOR PARTE DESTE ARQUIVO SAO RECUSAS
 * ============================================================================
 * "Nao escala" nao pode virar "sem limite". O lote toca o gate que a invariante
 * 6 governa, e um `--limit` digitado errado acenderia o catalogo inteiro numa
 * tecla — sem revisor, sem conferencia. As recusas SAO a feature:
 *
 *   - `--limit` obrigatorio com `--provider` (nao ha default);
 *   - teto duro por invocacao;
 *   - `--ids` e `--provider` nunca convivem (precedencia inventada promove o
 *     conjunto que ninguem pediu);
 *   - `--confirm` continua exigindo `--reviewer`, como sempre exigiu.
 */

import { describe, expect, it } from 'vitest'

import { parsePromoteArgs, PROMOTE_BATCH_MAX_LIMIT } from '../promotion/args.js'

describe('o lote seleciona por fornecedor, com teto', () => {
  it('aceita --provider com --limit e nao preenche --ids', () => {
    const r = parsePromoteArgs(['--provider=tmdb', '--country=BR', '--limit=100'])

    expect(r.ok, r.ok ? '' : r.error).toBe(true)
    if (!r.ok) return
    expect(r.args.batch).toEqual({ providerApi: 'tmdb', limit: 100 })
    // Quem resolve os ids e o banco: o parser nao inventa lista nenhuma.
    expect(r.args.ids).toEqual([])
    // Dry-run continua sendo o default — o lote nao muda isso.
    expect(r.args.confirm).toBe(false)
  })

  it('aceita o teto exato, e recusa um a mais', () => {
    const noTeto = parsePromoteArgs([
      `--provider=tmdb`,
      `--limit=${String(PROMOTE_BATCH_MAX_LIMIT)}`,
    ])
    expect(noTeto.ok).toBe(true)

    const acima = parsePromoteArgs([
      `--provider=tmdb`,
      `--limit=${String(PROMOTE_BATCH_MAX_LIMIT + 1)}`,
    ])
    expect(acima.ok).toBe(false)
    if (!acima.ok) expect(acima.error).toContain('acima do teto')
  })

  it('o teto e pequeno o bastante para caber numa revisao humana', () => {
    // Um teto de 70.000 satisfaria "tem teto" e nao protegeria nada. O numero
    // e parte do contrato, entao ele fica travado.
    expect(PROMOTE_BATCH_MAX_LIMIT).toBeLessThanOrEqual(1000)
    expect(PROMOTE_BATCH_MAX_LIMIT).toBeGreaterThan(0)
  })
})

describe('o que o lote RECUSA', () => {
  it('--provider sem --limit: o lote nunca e ilimitado', () => {
    const r = parsePromoteArgs(['--provider=tmdb', '--country=BR'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('--limit e obrigatorio com --provider')
  })

  it('--ids junto de --provider: duas selecoes concorrentes', () => {
    const r = parsePromoteArgs(['--ids=1,2,3', '--provider=tmdb', '--limit=10'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('selecoes concorrentes')
  })

  it('--limit sem --provider: com --ids a lista ja e o limite', () => {
    const r = parsePromoteArgs(['--ids=1,2,3', '--limit=10'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('--limit so se aplica com --provider')
  })

  it('nenhuma selecao: a mensagem ensina os DOIS caminhos', () => {
    const r = parsePromoteArgs(['--country=BR'])
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('--ids e obrigatorio')
      expect(r.error).toContain('--provider')
    }
  })

  it('--limit nao inteiro positivo e recusado', () => {
    for (const bad of ['0', '-5', 'abc', '1.5']) {
      const r = parsePromoteArgs(['--provider=tmdb', `--limit=${bad}`])
      expect(r.ok, `--limit=${bad} deveria ser recusado`).toBe(false)
    }
  })
})

describe('o lote NAO afrouxa o que ja existia', () => {
  it('--confirm em lote continua exigindo --reviewer', () => {
    // A REGRESSAO QUE ISTO PEGA: um caminho novo que escapasse da exigencia de
    // identidade humana gravaria `reviewed_by` vazio em centenas de linhas.
    const r = parsePromoteArgs(['--provider=tmdb', '--limit=10', '--confirm'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('--reviewer e obrigatorio')
  })

  it('--confirm em lote COM --reviewer passa', () => {
    const r = parsePromoteArgs(['--provider=tmdb', '--limit=10', '--confirm', '--reviewer=pablo'])
    expect(r.ok, r.ok ? '' : r.error).toBe(true)
    if (r.ok) expect(r.args.reviewer).toBe('pablo')
  })

  it('CONTROLE NEGATIVO: --ids sozinho continua funcionando como antes', () => {
    // O caminho historico nao pode ter sido quebrado pela adicao do lote.
    const r = parsePromoteArgs(['--ids=1,2,3', '--country=BR'])
    expect(r.ok, r.ok ? '' : r.error).toBe(true)
    if (!r.ok) return
    expect(r.args.ids).toEqual([1, 2, 3])
    expect(r.args.batch).toBeNull()
  })
})
