/**
 * runtime/run-script.ts — Como o agendador sobe uma CLI filha. COBERTO pelo
 * typecheck da raiz (`pnpm typecheck`).
 *
 * Mora fora de `runners.ts` para ser testavel sozinho: aquele modulo arrasta o
 * Prisma e o catalogo; este so precisa de `node:child_process`.
 *
 * ============================================================================
 * `node --import <loader do tsx>`, E NUNCA A CLI `tsx`
 * ============================================================================
 * Ate 17/09/2026 o filho era a CLI `tsx` (`tsx/dist/cli.mjs`), e ela roda o
 * script num SEGUNDO processo. No desligamento, o SIGTERM daqui chegava a CLI, e
 * nao ao script: ela o repassa, espera 30 ms a confirmacao do neto e, sem
 * confirmacao, manda SIGKILL (`relaySignalToChild`, tsx 4.22.4 — medido em
 * `docs/operations/sigterm-e-pid1.md`). Um script com o laco de eventos ocupado
 * nesses 30 ms morria sem ver o sinal, e a parada cooperativa dele nunca rodava.
 *
 * Com `node --import <loader>` o script roda NO processo spawnado: o sinal chega
 * direto ao ouvinte dele, sem corrida. E o mesmo formato dos scripts `*:start`.
 *
 * O loader vai por URL ABSOLUTA, resolvido a partir DESTE pacote (que declara
 * `tsx`): o `cwd` do filho e a raiz do repositorio, e la o especificador `tsx`
 * nu nao resolve — o pnpm nao o coloca em `node_modules/` da raiz.
 */

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

/** Saida de um comando spawnado. */
export interface SpawnResult {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
}

/** O loader do `tsx` por URL absoluta (o `exports["."]` do pacote). */
export function tsxLoaderUrl(): string {
  return pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href
}

/**
 * Roda um script do repositorio com o `tsx` ja instalado, sem shell.
 *
 * `shell: false` (o default do `spawn` com array de args) e obrigatorio aqui: um
 * argumento vindo de configuracao nunca pode virar comando. E o `env` e herdado
 * inteiro de proposito — a CLI filha precisa da `DATABASE_URL` e das chaves, que
 * NUNCA transitam por argumento de linha de comando (onde apareceriam em `ps`).
 *
 * `shutdownSignal` abortado manda SIGTERM ao filho, e e o filho que decide como
 * parar: `sync-omdb-ratings` para entre requisicoes e grava a linha da cota; as
 * CLIs sem ouvinte morrem no sinal.
 */
export async function runScript(
  repoRoot: string,
  script: string,
  args: readonly string[],
  shutdownSignal?: AbortSignal,
): Promise<SpawnResult> {
  // Ja desligando: nem spawna. Subir um processo para mata-lo em seguida so
  // atrasaria a drenagem.
  if (shutdownSignal?.aborted === true) {
    return { code: null, stdout: '', stderr: 'desligando: comando nao iniciado' }
  }

  return await new Promise<SpawnResult>((resolve) => {
    const child = spawn(process.execPath, ['--import', tsxLoaderUrl(), script, ...args], {
      cwd: repoRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''

    const onAbort = (): void => {
      stderr += ' | desligando: SIGTERM enviado ao processo filho'
      child.kill('SIGTERM')
    }
    shutdownSignal?.addEventListener('abort', onAbort, { once: true })
    const cleanup = (): void => shutdownSignal?.removeEventListener('abort', onAbort)

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      cleanup()
      resolve({ code: null, stdout, stderr: `${stderr}${String(error)}` })
    })
    child.on('exit', (code) => {
      cleanup()
      resolve({ code, stdout, stderr })
    })
  })
}
