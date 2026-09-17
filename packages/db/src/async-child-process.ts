/**
 * async-child-process.ts — Roda um processo filho SEM congelar o laco de eventos.
 *
 * ============================================================================
 * O DEFEITO QUE ESTE MODULO EXISTE PARA IMPEDIR
 * ============================================================================
 * O `embedded-postgres` sobe o `postgres` como FILHO do script e le o stderr dele
 * — que e o LOG do servidor — por evento `data`, isto e, pelo laco de eventos.
 * `execFileSync`, `spawnSync` e `execSync` congelam esse laco enquanto o comando
 * roda. Ninguem esvazia o pipe (~64 KB), e o backend do Postgres que tentar logar
 * fica preso dentro do `write()`. Para sempre, e sem erro nenhum.
 *
 * Medido em 16/09/2026: `validate-route-cache-real-postgres.ts` ficou 6 h parado
 * na migration `20260716140000_catalog_entities_and_discovery` — backend
 * "active" em `pg_stat_activity`, sem wait_event, 0,97 s de CPU; o
 * `schema-engine` com 0,015 s. Reproduzido fora do validador: com o laco
 * bloqueado, um cliente gerando WARNINGs parou em ~100 (~56 KB, o buffer do pipe)
 * e nao terminou em 90 s; com o filho assincrono, 600 passaram em 215 ms.
 *
 * O sintoma aponta para o lugar errado com confianca: "a migration travou" parece
 * defeito da migration, do Prisma ou de lock — e nao e nenhum dos tres.
 *
 * ============================================================================
 * A REGRA
 * ============================================================================
 * Processo que hospeda um PostgreSQL embarcado nunca roda filho de forma
 * sincrona. As duas funcoes abaixo espelham a semantica do Node, trocando so a
 * espera:
 *
 *   runChild   — `execFileSync` assincrono. Codigo diferente de 0, sinal, falha
 *                de spawn ou `timeout` REJEITAM, com `Command failed: <comando>`
 *                (mais o stderr capturado) na mensagem.
 *   spawnChild — `spawnSync` assincrono. NUNCA rejeita: devolve status, sinal,
 *                saida capturada e o erro de spawn/timeout em `error`.
 *
 * Travado por `tests/governance/embedded-postgres-child-process.test.ts` (nenhum
 * hospedeiro de `embedded-postgres` usa a API sincrona) e por
 * `tests/unit/async-child-process.test.ts` (o experimento do pipe cheio, com
 * controle negativo).
 *
 * O CMS tem COPIA deste arquivo em `apps/cms/src/__tests__/async-child-process.ts`
 * — o ADR 0015 proibe o CMS de importar `@screena/db`. O teste de governanca
 * exige que o codigo das duas seja identico, e o teste unitario roda nas duas.
 */

import { spawn, type ChildProcess } from 'node:child_process'

/**
 * Destino da saida do filho.
 *
 * `'inherit'`: stdin, stdout e stderr sao os deste processo; nada e capturado.
 * `'pipe'`: stdout e stderr capturados; nada chega ao terminal.
 * Omitido: o default do Node de cada funcao — `runChild` captura o stdout e
 * REPASSA o stderr ao terminal (como `execFileSync`); `spawnChild` captura os
 * dois (como `spawnSync`).
 */
export type ChildStdio = 'inherit' | 'pipe'

export interface ChildOptions {
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
  readonly stdio?: ChildStdio
  /** Teto em ms. Estourado, o filho recebe SIGTERM e o erro sai com `code: 'ETIMEDOUT'`. */
  readonly timeout?: number
}

export interface ChildResult {
  readonly pid: number | undefined
  /** Codigo de saida; `null` quando o filho morreu por sinal ou nem chegou a subir. */
  readonly status: number | null
  readonly signal: NodeJS.Signals | null
  /** Saida capturada, em UTF-8. Vazia quando o destino e `'inherit'`. */
  readonly stdout: string
  readonly stderr: string
  /** Falha ao iniciar o processo (ex.: `ENOENT`) ou estouro de `timeout` (`ETIMEDOUT`). */
  readonly error?: NodeJS.ErrnoException
}

function timeoutError(command: string, args: readonly string[]): NodeJS.ErrnoException {
  return Object.assign(new Error(`spawn ${command} ETIMEDOUT`), {
    code: 'ETIMEDOUT',
    syscall: `spawn ${command}`,
    path: command,
    spawnargs: [...args],
  })
}

function runAsync(
  command: string,
  args: readonly string[],
  options: ChildOptions,
  forwardStderrByDefault: boolean,
): Promise<ChildResult> {
  return new Promise((resolve) => {
    const inherit = options.stdio === 'inherit'
    const forwardStderr = options.stdio === undefined && forwardStderrByDefault
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let child: ChildProcess | undefined
    let spawnError: NodeJS.ErrnoException | undefined
    let timedOut = false
    let timer: NodeJS.Timeout | undefined
    let settled = false

    const settle = (status: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      const error = spawnError ?? (timedOut ? timeoutError(command, args) : undefined)
      resolve({
        pid: child?.pid,
        status,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        ...(error === undefined ? {} : { error }),
      })
    }

    try {
      child = spawn(command, [...args], {
        cwd: options.cwd,
        env: options.env,
        stdio: inherit ? 'inherit' : 'pipe',
      })
    } catch (error) {
      spawnError = error as NodeJS.ErrnoException
      settle(null, null)
      return
    }
    const started = child

    started.stdout?.on('data', (chunk: Buffer) => {
      stdout.push(chunk)
    })
    started.stderr?.on('data', (chunk: Buffer) => {
      stderr.push(chunk)
      if (forwardStderr) process.stderr.write(chunk)
    })
    // Sem `input`, o stdin do filho FECHA na hora — como no `spawnSync`. Um filho
    // que lesse stdin esperaria para sempre por um pipe que ninguem escreve. O
    // `error` do stdin (EPIPE de um filho que ja saiu) nao e desfecho do comando.
    started.stdin?.on('error', () => undefined)
    started.stdin?.end()

    started.on('error', (error: NodeJS.ErrnoException) => {
      spawnError ??= error
      // Nem chegou a subir: nao havera `close` com saida para esperar.
      if (started.pid === undefined) settle(null, null)
    })
    // `close`, e nao `exit`: so depois dele a saida capturada esta completa.
    started.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      settle(code, signal)
    })

    if (options.timeout !== undefined && options.timeout > 0) {
      timer = setTimeout(() => {
        timedOut = true
        started.kill('SIGTERM')
      }, options.timeout)
    }
  })
}

/**
 * `spawnSync` sem congelar o laco de eventos. NUNCA rejeita: codigo de saida,
 * sinal, falha de spawn e `timeout` voltam no resultado, para quem precisa ler o
 * desfecho (inclusive o de um comando que deve falhar).
 */
export function spawnChild(
  command: string,
  args: readonly string[],
  options: ChildOptions = {},
): Promise<ChildResult> {
  return runAsync(command, args, options, false)
}

/**
 * `execFileSync` sem congelar o laco de eventos. Resolve com o stdout capturado
 * (vazio quando `stdio: 'inherit'`). Rejeita — como o `execFileSync` lanca —
 * quando o filho sai com codigo diferente de 0, morre por sinal, nao sobe ou
 * estoura o `timeout`; o erro carrega `status`, `signal`, `stdout` e `stderr`.
 */
export async function runChild(
  command: string,
  args: readonly string[],
  options: ChildOptions = {},
): Promise<string> {
  const result = await runAsync(command, args, options, true)
  const details = {
    pid: result.pid,
    status: result.status,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
  }
  if (result.error !== undefined) throw Object.assign(result.error, details)
  if (result.status !== 0) {
    const captured = result.stderr.length > 0 ? `\n${result.stderr}` : ''
    throw Object.assign(
      new Error(`Command failed: ${[command, ...args].join(' ')}${captured}`),
      details,
    )
  }
  return result.stdout
}
