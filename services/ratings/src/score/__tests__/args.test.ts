/**
 * Contrato de argumentos do `compute-cinerie-score`.
 *
 * O teste que importa e o (1): ele parseia a invocacao EXATA que o agendador
 * monta. Enquanto ele nao existiu, a fila `cinerie_score` falhou todo tique
 * desde que nasceu — e a auditoria concluiu que "o motor nunca rodou".
 */

import { describe, expect, it } from 'vitest'

import { parseScoreArgs } from '../args.js'

/**
 * O que `runCinerieScore` monta em
 * `services/sync/src/scheduler/runtime/runners.ts`.
 *
 * Copia deliberada, e nao import: o teste tem de falhar se o agendador mudar a
 * forma sem que ninguem revise este contrato. Importar de la faria os dois se
 * moverem juntos e o teste nunca reprovaria nada.
 */
const INVOCACAO_DO_AGENDADOR = ['--type=all', '--apply'] as const

/** A forma que o agendador usava ANTES, e que o parser antigo recusava. */
const FORMA_SEPARADA = ['--type', 'all', '--apply'] as const

describe('parseScoreArgs', () => {
  it('(1) parseia a invocacao EXATA do agendador', () => {
    const r = parseScoreArgs([...INVOCACAO_DO_AGENDADOR])
    expect(r.ok, r.ok ? '' : `o agendador seria recusado: ${r.error}`).toBe(true)
    if (!r.ok) return
    expect(r.args).toEqual({ apply: true, type: 'all', limit: null })
  })

  it('(2) aceita TAMBEM a forma separada, como os dois CLIs irmaos', () => {
    // Era isto que produzia `argumento desconhecido: "--type"` em producao.
    const r = parseScoreArgs([...FORMA_SEPARADA])
    expect(r.ok, r.ok ? '' : `forma separada recusada: ${r.error}`).toBe(true)
    if (!r.ok) return
    expect(r.args).toEqual({ apply: true, type: 'all', limit: null })
  })

  it('(3) as duas formas produzem o MESMO resultado', () => {
    const comIgual = parseScoreArgs(['--type=movie', '--limit=200', '--apply'])
    const separada = parseScoreArgs(['--type', 'movie', '--limit', '200', '--apply'])
    expect(comIgual).toEqual(separada)
    expect(comIgual.ok && comIgual.args).toEqual({ apply: true, type: 'movie', limit: 200 })
  })

  it('(4) default e dry-run em escopo total', () => {
    const r = parseScoreArgs([])
    expect(r.ok && r.args).toEqual({ apply: false, type: 'all', limit: null })
  })

  it('(5) flag desconhecida FALHA, e diz qual', () => {
    const r = parseScoreArgs(['--nao-existe'])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('--nao-existe')
  })

  it('(6) valor faltante FALHA em vez de engolir a proxima flag', () => {
    // `--type --apply` NAO pode virar `type = "--apply"`. Silencio aqui, sob
    // `--apply`, calcularia o escopo errado sem ninguem notar.
    for (const argv of [['--type'], ['--type', '--apply'], ['--limit'], ['--limit', '--apply']]) {
      const r = parseScoreArgs(argv)
      expect(r.ok, `deveria recusar: ${argv.join(' ')}`).toBe(false)
      if (!r.ok) expect(r.error).toContain('exige um valor')
    }
  })

  it('(7) valor invalido FALHA, nas duas formas', () => {
    for (const argv of [['--type=serie'], ['--type', 'serie'], ['--limit=0'], ['--limit', '-3']]) {
      expect(parseScoreArgs(argv).ok, `deveria recusar: ${argv.join(' ')}`).toBe(false)
    }
  })

  it('(8) CONTROLE NEGATIVO: um parser que so aceitasse `=` reprovaria o agendador', () => {
    // Reproduz o parser ANTIGO, para deixar registrado o que ele fazia.
    const parserAntigo = (argv: readonly string[]): boolean =>
      argv.every((t) => t === '--apply' || t.startsWith('--type=') || t.startsWith('--limit='))

    expect(parserAntigo(FORMA_SEPARADA)).toBe(false)
    expect(parserAntigo(INVOCACAO_DO_AGENDADOR)).toBe(true)
    // E o novo aceita os dois — que e o ponto.
    expect(parseScoreArgs([...FORMA_SEPARADA]).ok).toBe(true)
    expect(parseScoreArgs([...INVOCACAO_DO_AGENDADOR]).ok).toBe(true)
  })
})
