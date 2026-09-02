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
 * Este teste fecha a costura: pega o argv que o runner monta e exige que o
 * parser o aceite, com os valores certos do outro lado.
 *
 * ============================================================================
 * ELE IMPORTA A MONTAGEM REAL — E ANTES NAO IMPORTAVA
 * ============================================================================
 * Ate 2026-09-01 este arquivo COPIAVA a montagem a mao, com a justificativa de
 * que importar o runner traria `node:child_process` e o Prisma para dentro de um
 * teste puro. A justificativa era boa e a conclusao estava errada: uma copia a
 * mao continua VERDE no dia em que o original muda — que e literalmente o modo
 * de falha descrito no cabecalho de `child-args.ts`, e o motivo de duas filas
 * terem falhado em producao todo tique desde que nasceram.
 *
 * A montagem foi extraida para `child-args.ts`, que e PURO (zero imports).
 * Importar de la nao arrasta Prisma nem `child_process`, e a copia deixa de
 * existir: se o runner mudar a forma, este teste muda junto por construcao.
 */

import { describe, expect, it } from 'vitest'

import { OMDB_BACKGROUND_DAILY_ENVELOPE, planOmdbRotation } from '@screena/config'

// A funcao REAL que `runRatingsOmdb` usa. Import relativo entre servicos, como
// `services/sync/.../child-cli-contract.test.ts` ja faz na direcao oposta.
import { buildOmdbChildArgs } from '../../../../sync/src/scheduler/runtime/child-args.js'
import { parseOmdbArgs } from '../args.js'

/** Adapta a saida (readonly) para o `string[]` que o parser recebe. */
function schedulerArgv(entityType: 'movie' | 'tv', mode: string, slots: number): string[] {
  return [...buildOmdbChildArgs(entityType, mode, slots)]
}

describe('o argv que o agendador spawna e aceito pelo filho', () => {
  it('os QUATRO lotes do plano diario parseiam, com os valores certos', () => {
    const plan = planOmdbRotation(OMDB_BACKGROUND_DAILY_ENVELOPE)
    expect(plan.slices).toHaveLength(4)

    for (const slice of plan.slices) {
      const argv = schedulerArgv(slice.entityType, slice.mode, slice.slots)
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

  it('TODO filho spawnado escreve: `--apply` esta sempre no argv', () => {
    // O defeito que isto trava: enquanto a flag era condicional, um ciclo sem
    // escrita spawnava o filho, ele fazia um dry-run PURO (sem banco, sem rede),
    // saia com codigo 0, e o runner somava `slice.slots` a `processed`. A fila
    // reportava centenas de titulos processados sem ter consultado nenhum.
    //
    // Hoje o ciclo sem escrita nao spawna: `runRatingsOmdb` devolve antes, com
    // as fatias em `skipped` e motivo `dry_run`. Logo, se um filho foi spawnado,
    // ele escreve — e o argv precisa dizer isso incondicionalmente.
    const plan = planOmdbRotation(OMDB_BACKGROUND_DAILY_ENVELOPE)
    for (const slice of plan.slices) {
      const argv = schedulerArgv(slice.entityType, slice.mode, slice.slots)
      expect(argv, `fatia ${slice.entityType}/${slice.mode}`).toContain('--apply')

      const parsed = parseOmdbArgs(argv)
      expect(parsed.ok).toBe(true)
      if (parsed.ok) expect(parsed.args.apply).toBe(true)
    }
  })

  it('CONTROLE NEGATIVO: um modo que o parser nao conhece e RECUSADO', () => {
    // Sem isto, o teste acima passaria com um parser que aceitasse qualquer
    // string em `--mode` — e um valor errado escolheria o conjunto errado de
    // candidatos sem que nada reclamasse.
    const parsed = parseOmdbArgs(schedulerArgv('movie', 'cobertura', 10))
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
    expect(parseOmdbArgs(schedulerArgv('tv', 'refresh', 0)).ok).toBe(false)

    const plan = planOmdbRotation(2)
    const zeradas = plan.slices.filter((slice) => slice.slots === 0)
    expect(zeradas.length).toBeGreaterThan(0)
  })
})
