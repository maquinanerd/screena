/**
 * dry-run-precheck.test.ts — `catalog index-decisions --dry-run` PRE-CHECA de
 * verdade, e nao apenas anuncia a intencao do comando.
 *
 * O DEFEITO QUE ESTE ARQUIVO TRAVA (medido em producao em 2026-08-27):
 *
 *   $ pnpm catalog index-decisions --dry-run --json --confirm-production-read
 *   {"dryRun":true,"command":"index-decisions","subcommand":null,
 *    "plan":["index-decisions: sem efeito colateral"]}
 *   $ echo $?
 *   0
 *
 * Zero contagens, zero vereditos, zero freio — e exit 0, que le como "pode
 * aplicar". Causa: `bin/catalog.ts` tratava `--dry-run` num unico ponto ANTES do
 * dispatch; `index-decisions` nao tinha `case` em `describePlan` e caia no
 * `default:`. O handler `cmdIndexDecisions`, que ja recebia `dryRun: !apply` e ja
 * calculava o censo inteiro, NUNCA era chamado com essa flag.
 *
 * POR QUE ESTE TESTE NAO OLHA O FONTE. O defeito nao estava na politica nem no
 * produtor (os dois ja tinham teste verde — e por isso ninguem viu): estava no
 * ROTEAMENTO, dentro do `bin/`, onde nenhum teste chegava. Um teste que
 * afirmasse sobre `dryRunExecutesCommand` provaria o predicado e nao a fiacao;
 * um `grep` no fonte provaria a grafia. Entao este arquivo EXECUTA o binario de
 * verdade e afirma sobre a saida dele.
 *
 * A OBSERVACAO DISCRIMINANTE: apontar a CLI para um PostgreSQL que nao existe.
 *
 *   com o defeito  -> exit 0 e JSON de plano  (nunca falou com banco nenhum)
 *   consertado     -> exit != 0               (tentou ler, e nao havia banco)
 *
 * Uma pre-checagem que reporta sucesso contra um banco inalcancavel nao pode ter
 * calculado censo nenhum. E exatamente essa a assinatura de "sucesso medido em
 * proxy" que o comando exibia em producao.
 *
 * CONTROLE NEGATIVO: restaurar o curto-circuito (`if (flags.dryRun) {`, sem a
 * clausula `&& !dryRunExecutesCommand(command)`) faz (2) e (3) ficarem VERMELHOS
 * — verificado ao escrever este arquivo, nao apenas afirmado aqui.
 *
 * SEM REDE, SEM BANCO, SEM TMDB: o unico IO e um processo filho que tenta abrir
 * um socket TCP para uma porta local fechada e desiste.
 */

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { CATALOG_COMMANDS, dryRunExecutesCommand, requiresDryRunOrApply } from '../args.js'

const require = createRequire(import.meta.url)
const testDir = path.dirname(fileURLToPath(import.meta.url))
/** services/ingestion */
const ingestionDir = path.resolve(testDir, '..', '..', '..')
const catalogBin = path.join(ingestionDir, 'bin', 'catalog.ts')

/**
 * CLI RESOLVIDO do tsx (nao o `pnpm catalog`): neste layout pnpm o binario de
 * atalho nem sempre existe no PATH do processo de teste. Mesmo padrao de
 * `scripts/prove-catalog-worker-service.ts`.
 */
function tsxBin(): string {
  const pkgPath = require.resolve('tsx/package.json')
  return path.join(path.dirname(pkgPath), 'dist', 'cli.mjs')
}

/**
 * Porta local FECHADA. 59999 nao e reservada a nada e o `connect_timeout=2`
 * garante que o filho desista em segundos em vez de pendurar a suite.
 */
const UNREACHABLE_DATABASE_URL =
  'postgresql://precheck:precheck@127.0.0.1:59999/precheck?connect_timeout=2'

interface CliRun {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
}

function runCatalog(args: readonly string[]): CliRun {
  const result = spawnSync(process.execPath, [tsxBin(), catalogBin, ...args], {
    cwd: ingestionDir,
    encoding: 'utf8',
    timeout: 90_000,
    env: {
      ...process.env,
      DATABASE_URL: UNREACHABLE_DATABASE_URL,
      // NODE_ENV=production ligaria o gate que exige --confirm-production-read e
      // o comando sairia com code 3 (blocked) ANTES do dispatch — o que
      // esconderia exatamente a diferenca que este teste mede.
      NODE_ENV: 'test',
    },
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

describe('catalog index-decisions --dry-run pre-checa de verdade', () => {
  it('(1) CONTROLE POSITIVO: o binario roda e responde ao --help', () => {
    const run = runCatalog(['index-decisions', '--help'])

    // Sem isto, (2) e (3) passariam por vacuidade se o `spawnSync` falhasse em
    // achar o tsx ou o arquivo: um filho que nunca sobe tambem "nao sai 0".
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('index-decisions')
  }, 120_000)

  it('(2) contra um banco INALCANCAVEL, o dry-run NAO reporta sucesso', () => {
    const run = runCatalog(['index-decisions', '--dry-run', '--json'])

    // Um censo de indexabilidade so pode existir se o banco foi lido. Sair 0 aqui
    // significa que o comando decidiu "esta tudo bem" sem consultar nada.
    expect(run.status).not.toBe(0)
  }, 120_000)

  it('(3) o dry-run nunca devolve o plano generico de "sem efeito colateral"', () => {
    const run = runCatalog(['index-decisions', '--dry-run', '--json'])
    const saida = `${run.stdout}${run.stderr}`

    // A frase exata que producao imprimiu. Ela descreve a INTENCAO do comando
    // ("eu seria inofensivo"), nunca o efeito da execucao.
    expect(saida).not.toContain('sem efeito colateral')
    // E o envelope generico do curto-circuito: `{dryRun, command, subcommand,
    // plan}`. Se ele reaparecer, o dispatch voltou a ser desviado.
    expect(saida).not.toContain('"plan"')
  }, 120_000)

  it('(4) o roteamento cobre TODO comando de dry-run-executa-politica', () => {
    // Afirma a propriedade, nao a lista: se alguem acrescentar um comando a
    // `DRY_RUN_RUNS_REAL_POLICY`, ele tambem precisa ser um comando que exige
    // --dry-run/--apply — caso contrario a flag nem seria aceita e a entrada
    // seria letra morta.
    const executam = CATALOG_COMMANDS.filter((command) => dryRunExecutesCommand(command))

    expect(executam.length).toBeGreaterThan(0)
    for (const command of executam) {
      expect(requiresDryRunOrApply(command, null)).toBe(true)
    }
  })

  it('(5) index-decisions esta na lista; um comando de cota TMDB nao esta', () => {
    // O criterio da lista e "a pre-checagem e so-leitura de PostgreSQL local".
    // `bootstrap` le TMDB para planejar: para ele, "dry-run nao monta o runtime"
    // continua sendo a garantia certa, e entrar aqui gastaria cota.
    expect(dryRunExecutesCommand('index-decisions')).toBe(true)
    expect(dryRunExecutesCommand('bootstrap')).toBe(false)
    expect(dryRunExecutesCommand('sync')).toBe(false)
    expect(dryRunExecutesCommand('media')).toBe(false)
  })
})
