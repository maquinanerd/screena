#!/usr/bin/env node
/**
 * doctor.mjs — a maquina tem o que a CI local precisa?
 *
 * Nao instala nada: diz o que falta e como resolver.
 *   [OK]    presente e na versao certa
 *   [AVISO] funciona, mas difere do ambiente de producao/da antiga CI, ou so
 *           faz falta para os perfis Linux (completo, backup, docker)
 *   [ERRO]  o perfil padrao (`.\scripts\ci.ps1`) nao roda sem isto
 *   [INFO]  so para saber
 *
 * Sai 1 se houver algum [ERRO].
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { IS_WINDOWS, capture, posixTool } from './lib/proc.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'))
const PNPM_VERSION = pkg.packageManager.split('@')[1]

let errors = 0
let warnings = 0
const report = (level, label, detail = '') => {
  if (level === 'ERRO') errors++
  if (level === 'AVISO') warnings++
  console.log(`[${level}]${' '.repeat(6 - level.length)}${label}${detail ? ` - ${detail}` : ''}`)
}
/** `report(...ok)` se a condicao vale, senao `report(...bad)`. */
const either = (cond, ok, bad) => (cond ? report(...ok) : report(...bad))

/** Versao de um comando (`<cmd> --version`), ou null. `.cmd` vai pelo shell. */
function version(cmd, args = ['--version'], { shell = false } = {}) {
  const res = shell ? capture(IS_WINDOWS ? 'cmd.exe' : 'sh', IS_WINDOWS ? ['/d', '/s', '/c', [cmd, ...args].join(' ')] : ['-c', [cmd, ...args].join(' ')], { allowFail: true }) : capture(cmd, args, { allowFail: true })
  return res.ok ? (res.stdout || res.stderr).trim().split('\n')[0] : null
}

console.log('========================================')
console.log('DOCTOR - ambiente da CI local')
console.log('========================================')
console.log(`repo ${REPO_ROOT}`)
console.log(`${os.type()} ${os.release()} (${process.arch})\n`)

// ------------------------------------------------------------ obrigatorios
const git = version('git')
either(git, ['OK', 'Git', git], ['ERRO', 'Git nao encontrado', 'instale o Git for Windows (traz bash, dash e awk)'])

const nodeMajor = Number(process.versions.node.split('.')[0])
if (nodeMajor === 22) report('OK', `Node ${process.version}`)
else
  report('AVISO', `Node ${process.version}`, `o projeto declara ${pkg.engines.node} (.nvmrc = 22; producao e a antiga CI usam 22). ` + 'Instale o 22 (fnm/nvm-windows) ou rode a CI com --container')

const corepack = version('corepack', ['--version'], { shell: true })
either(corepack, ['OK', 'Corepack', corepack], ['ERRO', 'Corepack nao encontrado', 'vem com o Node 22; rode `npm install -g corepack` se tiver sido removido'])

const pnpm = corepack ? version('corepack', ['pnpm', '--version'], { shell: true }) : null
if (pnpm === PNPM_VERSION) report('OK', `pnpm ${pnpm}`, 'via corepack (packageManager)')
else report('ERRO', `pnpm ${pnpm ?? 'indisponivel'}`, `o packageManager fixa ${PNPM_VERSION}; rode \`corepack prepare pnpm@${PNPM_VERSION} --activate\``)

if (existsSync(path.join(REPO_ROOT, 'node_modules', '.modules.yaml'))) report('OK', 'Dependencias instaladas (node_modules)')
else report('ERRO', 'Dependencias nao instaladas', 'rode `corepack pnpm install --frozen-lockfile`')

const prismaGenerated = (() => {
  const pnpmDir = path.join(REPO_ROOT, 'node_modules', '.pnpm')
  if (!existsSync(pnpmDir)) return false
  return readdirSync(pnpmDir)
    .filter((d) => d.startsWith('@prisma+client@'))
    .some((d) => existsSync(path.join(pnpmDir, d, 'node_modules', '.prisma', 'client', 'client.js')))
})()
either(prismaGenerated, ['OK', 'Prisma Client gerado'], ['AVISO', 'Prisma Client nao gerado', 'a CI gera no passo `prisma`; para usar fora dela: `corepack pnpm --filter @screena/db db:generate`'])

for (const tool of ['bash', 'dash', 'awk']) {
  const bin = posixTool(tool)
  if (bin) report('OK', `${tool} (scripts .sh)`, IS_WINDOWS ? bin : 'PATH')
  else report('ERRO', `${tool} nao encontrado`, IS_WINDOWS ? 'vem com o Git for Windows (usr/bin); o bash do WSL nao serve' : 'instale pelo gerenciador de pacotes')
}

const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || (IS_WINDOWS ? path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright') : path.join(os.homedir(), '.cache', 'ms-playwright'))
const hasChromium = existsSync(browsersRoot) && readdirSync(browsersRoot).some((d) => d.startsWith('chromium'))
either(hasChromium, ['OK', 'Chromium do Playwright', browsersRoot], ['AVISO', 'Chromium do Playwright ausente', 'a CI baixa no passo `browsers` (precisa de internet na primeira vez)'])

// ----------------------------------------------------- perfis Linux (Docker)
const dockerCli = version('docker')
if (!dockerCli) report('AVISO', 'Docker nao encontrado', 'necessario para os perfis completo, backup e docker (Docker Desktop)')
else {
  report('OK', 'Docker CLI', dockerCli)
  const server = capture('docker', ['version', '--format', '{{.Server.Version}}'], { allowFail: true })
  if (server.ok) report('OK', `Docker daemon ${server.stdout.trim()}`)
  else report('AVISO', 'Docker daemon nao responde', 'abra o Docker Desktop antes dos perfis completo, backup e docker')
  const compose = version('docker', ['compose', 'version'])
  either(compose, ['OK', 'Docker Compose', compose], ['AVISO', 'Docker Compose ausente', 'so o docker-compose.dev.yml (Postgres de desenvolvimento) usa'])
}

// ------------------------------------------------------------- do checkout
if (/[^\x20-\x7e]/.test(REPO_ROOT)) {
  report('AVISO', 'Caminho do repo com acento', 'o embedded-postgres com --encoding=UTF8 morre em caminho acentuado no Windows; os validadores PG16 rodam no perfil completo (container), nao aqui')
}
if (IS_WINDOWS && REPO_ROOT.length > 80) {
  report('INFO', `Caminho do repo com ${REPO_ROOT.length} caracteres`, 'pnpm no Windows esbarra no limite de 260; prefira um caminho curto (ex.: C:\\dev\\screena)')
}
const autocrlf = capture('git', ['config', '--get', 'core.autocrlf'], { cwd: REPO_ROOT, allowFail: true }).stdout.trim()
if (autocrlf === 'true') {
  report('INFO', 'core.autocrlf=true', 'o working tree esta em CRLF; os perfis Linux usam um snapshot LF (igual ao GitHub)')
}
if (existsSync(path.join(REPO_ROOT, '.env'))) {
  report('INFO', '.env presente', 'a CI local tira DATABASE_URL, tokens e segredos do ambiente das etapas')
}
const hooksPath = capture('git', ['config', '--get', 'core.hooksPath'], { cwd: REPO_ROOT, allowFail: true }).stdout.trim()
either(
  hooksPath === '.githooks',
  ['OK', 'Hooks de git instalados', '.githooks (pre-commit e pre-push)'],
  ['INFO', 'Hooks de git nao instalados', 'opcional: `corepack pnpm run hooks:install`'],
)

// ---------------------------------------------------------------- opcionais
const gh = version('gh')
either(gh, ['INFO', 'GitHub CLI', gh], ['INFO', 'GitHub CLI ausente', 'opcional, so para abrir PR pelo terminal'])
if (IS_WINDOWS) {
  const pwsh = version('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'])
  either(pwsh, ['OK', `PowerShell ${pwsh}`], ['INFO', 'PowerShell 7 ausente', 'os scripts .ps1 tambem rodam no Windows PowerShell 5.1'])
}

console.log('')
if (errors > 0) {
  console.log(`DOCTOR: ${errors} erro(s), ${warnings} aviso(s). Corrija os [ERRO] antes de rodar a CI.`)
  process.exit(1)
}
console.log(`DOCTOR: nenhum erro, ${warnings} aviso(s).`)
