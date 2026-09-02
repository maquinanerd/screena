/**
 * plan-mode.test.ts — `--plan`: medir a selecao sem gastar cota.
 *
 * ============================================================================
 * A LACUNA QUE ISTO FECHA
 * ============================================================================
 * O dry-run puro do worker liga `NOOP_CANDIDATES` e NAO consulta o Postgres.
 * A saida dele — "ate N candidato(s)" — e a repeticao do `--limit`, nao uma
 * medicao. Medido em 2026-09-02:
 *
 *   [dry-run] plano: GET /?i=<IMDb> · alvo: ate 5 candidato(s) movie local(is)
 *   SEM nenhuma nota externa · nada foi chamado, nada foi gravado.
 *
 * Isso deixava sem instrumento a unica pergunta que importa quando a fila roda
 * todo dia, gasta zero e nao entrega nada: **quantos candidatos a selecao
 * devolve de fato?** Um ciclo real com zero candidatos sai `status='empty'`,
 * `quota_cost 0` e codigo de saida 0 — indistinguivel, para quem o chamou, de
 * um ciclo que trabalhou.
 *
 * `--plan` consulta os candidatos REAIS e para antes da rede.
 *
 * ============================================================================
 * POR QUE AS RECUSAS SAO A MAIOR PARTE DESTE ARQUIVO
 * ============================================================================
 * Uma flag que promete "nao toca a rede" so vale se ela nao puder ser
 * combinada com uma flag que toca. Sem essas recusas, `--plan --apply` gastaria
 * cota enquanto o nome diz plano — e o operador leria "plano" na linha de
 * comando e nao no que aconteceu.
 */

import { describe, expect, it } from 'vitest'

import { parseOmdbArgs } from '../args.js'

describe('--plan e aceito onde faz sentido', () => {
  it('com --type e --mode, parseia e nao liga rede nenhuma', () => {
    const r = parseOmdbArgs(['--plan', '--type', 'movie', '--mode', 'coverage', '--limit', '5'])

    expect(r.ok, r.ok ? '' : r.error).toBe(true)
    if (!r.ok) return
    expect(r.args.plan).toBe(true)
    expect(r.args.type).toBe('movie')
    expect(r.args.mode).toBe('coverage')
    expect(r.args.limit).toBe(5)
    // As duas flags que tocam a rede continuam desligadas.
    expect(r.args.apply).toBe(false)
    expect(r.args.sample).toBe(false)
  })

  it('vale para os dois tipos e os dois modos', () => {
    for (const type of ['movie', 'tv']) {
      for (const mode of ['coverage', 'refresh']) {
        const r = parseOmdbArgs(['--plan', '--type', type, '--mode', mode])
        expect(r.ok, `${type}/${mode}: ${r.ok ? '' : r.error}`).toBe(true)
      }
    }
  })

  it('CONTROLE NEGATIVO: sem --plan a flag nasce desligada', () => {
    // Sem isto, um parser que devolvesse `plan: true` por default passaria em
    // todos os testes acima — e todo dry-run viraria consulta ao banco.
    const r = parseOmdbArgs(['--type', 'movie'])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.args.plan).toBe(false)
  })
})

describe('--plan RECUSA tudo que o faria tocar a rede', () => {
  it('recusa --apply', () => {
    const r = parseOmdbArgs(['--plan', '--apply', '--type', 'movie'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('--plan nao se combina')
  })

  it('recusa --sample', () => {
    const r = parseOmdbArgs(['--plan', '--sample', '--type', 'movie'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('--plan nao se combina')
  })

  it('recusa --id (um id explicito nao passa pela selecao)', () => {
    // `--plan` mede o PREDICADO. Um id nominal pula o predicado inteiro, entao
    // "planejar" um id seria medir nada e dizer que mediu.
    const r = parseOmdbArgs(['--plan', '--id', 'tt0172495'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('--plan nao se aplica com --id')
  })

  it('exige --type: a selecao e por tabela', () => {
    const r = parseOmdbArgs(['--plan'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('--plan exige --type')
  })
})
