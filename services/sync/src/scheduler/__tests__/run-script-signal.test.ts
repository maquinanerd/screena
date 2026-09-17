/**
 * run-script-signal.test.ts — O SIGTERM do agendador chega a CLI filha.
 *
 * ============================================================================
 * O DEFEITO
 * ============================================================================
 * `runScript` spawnava a CLI `tsx`, que roda o script num SEGUNDO processo. No
 * desligamento o SIGTERM ia a CLI; ela o repassa, espera 30 ms a confirmacao do
 * neto e, sem ela, manda SIGKILL. Um script com o laco de eventos ocupado nesses
 * 30 ms morria sem ver o sinal — e a parada cooperativa de `sync-omdb-ratings`
 * (que grava a linha da cota gasta) nunca rodaria.
 *
 * ============================================================================
 * O QUE SE MEDE
 * ============================================================================
 * Com processos de verdade: quem e o pai do script (o agendador, ou a CLI no
 * meio) e se ele DRENOU com o laco ocupado no instante do sinal. A fixture ocupa
 * o laco por 2 s, entao o desfecho nao depende de sorte na janela de 30 ms.
 *
 * SO EM POSIX. O Windows nao tem SIGTERM: `kill('SIGTERM')` vira
 * `TerminateProcess` e ouvinte nenhum roda. O container e Linux; a CI roda isto.
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { runScript } from '../runtime/run-script.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..', '..', '..', '..')
const FIXTURE = path.join(here, 'fixtures', 'busy-until-sigterm.ts')

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function readyDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'cinerie-run-script-'))
  dirs.push(dir)
  return dir
}

/**
 * Espera a fixture criar `<pid>-<ppid>.pronta` — o ouvinte ja esta instalado. Os
 * numeros vem no NOME do arquivo: criar e atomico, e nada precisa ser lido.
 */
async function waitReady(dir: string): Promise<{ readonly pid: number; readonly ppid: number }> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    for (const name of readdirSync(dir)) {
      const match = /^(\d+)-(\d+)\.pronta$/.exec(name)
      if (match !== null) return { pid: Number(match[1]), ppid: Number(match[2]) }
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('a fixture nao ficou pronta em 20 s')
}

describe.skipIf(process.platform === 'win32')(
  'runScript entrega o SIGTERM direto a CLI filha',
  () => {
    it('o script e FILHO DIRETO do agendador e drena mesmo com o laco ocupado', async () => {
      const ready = readyDir()
      const shutdown = new AbortController()

      const pending = runScript(repoRoot, FIXTURE, [ready], shutdown.signal)
      const info = await waitReady(ready)
      shutdown.abort()
      const result = await pending

      expect(info.ppid, 'nenhum processo entre o agendador e o script').toBe(process.pid)
      expect(result.stdout).toContain('DRENOU')
      expect(result.code).toBe(0)
    }, 40_000)

    it('CONTROLE NEGATIVO: pela CLI `tsx` (o spawn anterior) o script e NETO e morre sem drenar', async () => {
      const ready = readyDir()
      const require = createRequire(import.meta.url)
      const tsxCli = path.join(path.dirname(require.resolve('tsx/package.json')), 'dist', 'cli.mjs')

      const child = spawn(process.execPath, [tsxCli, FIXTURE, ready], {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = ''
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8')
      })
      const exited = new Promise<number | null>((resolve) => {
        child.on('exit', (code) => resolve(code))
      })

      const info = await waitReady(ready)
      child.kill('SIGTERM')
      const code = await exited

      expect(info.ppid, 'a CLI tsx fica entre o agendador e o script').not.toBe(process.pid)
      expect(stdout).not.toContain('DRENOU')
      expect(code).not.toBe(0)
    }, 40_000)
  },
)
