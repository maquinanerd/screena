/**
 * proc.mjs — execucao de processos da CI local, igual no Windows e no Linux.
 *
 * Tres armadilhas do Windows que este modulo resolve num lugar so:
 *   1. `corepack`/`pnpm` sao shims `.cmd`: desde o Node 20.12 `spawn` de
 *      `.cmd` sem shell e recusado (EINVAL). Eles vao pelo `cmd.exe`.
 *   2. O primeiro `bash.exe` do PATH costuma ser o do WSL (System32). Os
 *      scripts `.sh` sao checados pelo bash do Git for Windows, achado a
 *      partir do proprio `git`.
 *   3. O `.env` do checkout principal aponta para PRODUCAO. Nenhuma etapa
 *      herda variavel de banco/credencial do terminal: `sanitizedEnv` as tira.
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

export const IS_WINDOWS = process.platform === 'win32'

/**
 * Variaveis que nunca chegam a uma etapa. O workflow do GitHub rodava sem
 * nenhuma delas; aqui elas podem vir do terminal (ou de um `.env` carregado
 * nele) e apontar para producao.
 */
const SENSITIVE = [
  /DATABASE_URL$/,
  /^DIRECT_URL$/,
  /_API_KEY$/,
  /_TOKEN$/,
  /SECRET/,
  /PASSWORD/,
  /^MNSCR_/,
  /^EDITORIAL_AUTO_PUBLISH_/,
  /^NODE_ENV$/,
]

/** Copia do ambiente sem as variaveis sensiveis, com `CI=true` como no runner. */
export function sanitizedEnv({ keepEnv = false } = {}) {
  const env = { ...process.env }
  const removed = []
  if (!keepEnv) {
    for (const name of Object.keys(env)) {
      if (SENSITIVE.some((re) => re.test(name.toUpperCase()))) {
        delete env[name]
        removed.push(name)
      }
    }
  }
  env.CI = 'true'
  return { env, removed: removed.sort() }
}

/** Aspas para o `cmd.exe` (so usado com argumentos do proprio pipeline). */
function quoteForCmd(arg) {
  return /^[\w@:./=,+-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '\\"')}"`
}

/**
 * Roda um comando herdando o terminal. Resolve com o codigo de saida.
 * `useShell` so e necessario para shims `.cmd` no Windows.
 */
export function runInherit(cmd, args, { env, cwd, useShell = false } = {}) {
  return new Promise((resolve) => {
    const child =
      useShell && IS_WINDOWS
        ? spawn([cmd, ...args.map(quoteForCmd)].join(' '), { env, cwd, stdio: 'inherit', shell: true })
        : spawn(cmd, args, { env, cwd, stdio: 'inherit' })
    child.on('error', (err) => {
      console.error(`  nao foi possivel iniciar "${cmd}": ${err.message}`)
      resolve(127)
    })
    child.on('close', (code, signal) => resolve(code ?? (signal ? 1 : 0)))
  })
}

/** `corepack pnpm <args>` — o pnpm fixado em `packageManager`. */
export function runPnpm(args, opts) {
  return runInherit('corepack', ['pnpm', ...args], { ...opts, useShell: true })
}

/** Captura stdout de um comando curto (git, docker). Lanca se falhar. */
export function capture(cmd, args, { cwd, env, input, allowFail = false } = {}) {
  const res = spawnSync(cmd, args, { cwd, env, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (res.error) {
    if (allowFail) return { ok: false, stdout: '', stderr: res.error.message, status: 127 }
    throw new Error(`${cmd}: ${res.error.message}`)
  }
  const out = { ok: res.status === 0, stdout: res.stdout ?? '', stderr: res.stderr ?? '', status: res.status ?? 1 }
  if (!out.ok && !allowFail) {
    throw new Error(`${cmd} ${args.join(' ')} saiu ${out.status}: ${out.stderr.trim()}`)
  }
  return out
}

/** O comando existe no PATH? (sem shell; `where`/`command -v` nao sao portaveis) */
export function onPath(cmd) {
  const res = spawnSync(cmd, ['--version'], { encoding: 'utf8', shell: IS_WINDOWS && !cmd.endsWith('.exe') })
  return !res.error && res.status === 0
}

/**
 * Binario do Git for Windows (`usr/bin/<nome>.exe`), achado pelo `git`.
 * Nunca o `bash.exe` do WSL. No Linux, o do PATH.
 */
export function posixTool(name) {
  if (!IS_WINDOWS) return name
  const res = spawnSync('git', ['--exec-path'], { encoding: 'utf8' })
  if (res.status === 0) {
    // <Git>/mingw64/libexec/git-core -> <Git>
    const gitRoot = path.resolve(res.stdout.trim(), '..', '..', '..')
    const candidate = path.join(gitRoot, 'usr', 'bin', `${name}.exe`)
    if (existsSync(candidate)) return candidate
  }
  return null
}
