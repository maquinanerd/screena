/**
 * scheduler-argv-seam.test.ts — A COSTURA entre quem spawna e quem parseia.
 *
 * ============================================================================
 * POR QUE ESTA COSTURA PRECISA DE TESTE PROPRIO
 * ============================================================================
 * `runRatingsOmdb` (@screena/sync) monta um array de strings e spawna
 * `sync-omdb-ratings.ts` como PROCESSO FILHO. Entre os dois nao ha tipo: a
 * ligacao e por texto de linha de comando.
 *
 * Consequencia: renomear `--mode`, mudar o vocabulario de `OmdbRotationMode`, ou
 * apertar uma validacao do parser NAO quebra o typecheck e NAO quebra nenhum
 * teste de unidade dos dois lados — cada um continua correto sozinho. Quebra em
 * PRODUCAO, no primeiro ciclo, com o filho saindo em codigo != 0 e o agendador
 * registrando `omdb_child_failed`. A fila fica parada e o painel diz apenas que
 * um filho falhou.
 *
 * Este teste fecha a costura: monta o argv EXATAMENTE como o runner monta e
 * exige que o parser o aceite, com os valores certos do outro lado.
 *
 * Se `runRatingsOmdb` mudar a forma dos argumentos, mude AQUI junto — este
 * arquivo e a copia executavel daquela linha, e e de proposito que ele reproduza
 * a montagem em vez de importa-la: importar o runner traria `node:child_process`
 * e o Prisma para dentro de um teste puro, e um helper compartilhado deixaria os
 * dois lados concordarem entre si e discordarem do que roda.
 */

import { describe, expect, it } from 'vitest'

import { OMDB_BACKGROUND_DAILY_ENVELOPE, planOmdbRotation } from '@screena/config'

import { parseOmdbArgs } from '../args.js'

/**
 * A montagem de `runRatingsOmdb`, reproduzida literalmente.
 *
 * Ver `services/sync/src/scheduler/runtime/runners.ts`, dentro do laco
 * `for (const slice of plan.slices)`.
 */
function schedulerArgv(
  entityType: 'movie' | 'tv',
  mode: string,
  slots: number,
  apply: boolean,
): string[] {
  const args = ['--type', entityType, '--mode', mode, '--limit', String(slots)]
  if (apply) args.push('--apply')
  return args
}

describe('o argv que o agendador spawna e aceito pelo filho', () => {
  it('os QUATRO lotes do plano diario parseiam, com os valores certos', () => {
    const plan = planOmdbRotation(OMDB_BACKGROUND_DAILY_ENVELOPE)
    expect(plan.slices).toHaveLength(4)

    for (const slice of plan.slices) {
      const argv = schedulerArgv(slice.entityType, slice.mode, slice.slots, true)
      const parsed = parseOmdbArgs(argv)

      expect(parsed.ok, `${argv.join(' ')} -> ${parsed.ok ? '' : parsed.error}`).toBe(true)
      if (!parsed.ok) continue

      // Nao basta "parseou": o valor tem de CHEGAR. Um parser que engolisse
      // `--mode` sem erro e deixasse `mode` nulo passaria no `ok` acima e
      // rodaria o lote errado — cobertura viraria atualizacao em silencio.
      expect(parsed.args.type).toBe(slice.entityType)
      expect(parsed.args.mode).toBe(slice.mode)
      expect(parsed.args.limit).toBe(slice.slots)
      expect(parsed.args.apply).toBe(true)
    }
  })

  it('o ciclo sem --apply (dry-run do agendador) tambem parseia', () => {
    const plan = planOmdbRotation(OMDB_BACKGROUND_DAILY_ENVELOPE)
    for (const slice of plan.slices) {
      const parsed = parseOmdbArgs(schedulerArgv(slice.entityType, slice.mode, slice.slots, false))
      expect(parsed.ok).toBe(true)
      if (parsed.ok) expect(parsed.args.apply).toBe(false)
    }
  })

  it('CONTROLE NEGATIVO: um modo que o parser nao conhece e RECUSADO', () => {
    // Sem isto, o teste acima passaria com um parser que aceitasse qualquer
    // string em `--mode` — e um valor errado escolheria o conjunto errado de
    // candidatos sem que nada reclamasse.
    const parsed = parseOmdbArgs(schedulerArgv('movie', 'cobertura', 10, true))
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContain('--mode invalido')
  })

  it('CONTROLE NEGATIVO: a flag renomeada e RECUSADA, nao ignorada', () => {
    // O modo de falha que este arquivo existe para pegar: alguem renomeia a flag
    // de um lado so. FAIL-LOUD e o que transforma isso num erro visivel em vez
    // de um lote que roda o trabalho errado.
    const parsed = parseOmdbArgs(['--type', 'movie', '--modo', 'coverage', '--limit', '10'])
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContain('flag desconhecida')
  })

  it('um envelope pequeno pode zerar uma fatia — e o runner NAO deve spawna-la', () => {
    // `--limit 0` e recusado pelo parser (inteiro > 0). O runner pula fatias com
    // `slots <= 0` justamente por isso; se algum dia parar de pular, o filho sai
    // com erro e a fila registra falha. Este teste fixa as duas metades do
    // contrato: o parser recusa, logo o runner PRECISA continuar pulando.
    expect(parseOmdbArgs(schedulerArgv('tv', 'refresh', 0, true)).ok).toBe(false)

    const plan = planOmdbRotation(2)
    const zeradas = plan.slices.filter((slice) => slice.slots === 0)
    expect(zeradas.length).toBeGreaterThan(0)
  })
})
