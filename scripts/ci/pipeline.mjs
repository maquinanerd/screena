#!/usr/bin/env node
/**
 * pipeline.mjs — CI LOCAL da Cinerie. Substitui o GitHub Actions.
 *
 * Uso:  node scripts/ci/pipeline.mjs [perfil] [opcoes]
 *       (ou .\scripts\ci.ps1, ou `corepack pnpm run ci`, ou os hooks de git)
 *
 * Perfis (definidos em steps.mjs, que e a fonte unica dos passos):
 *   pre-commit  eslint nos arquivos staged
 *   rapido      typecheck, lint, test, auditorias, build do web  (hook pre-push)
 *   padrao      rapido + o resto que roda no Windows             (default)
 *   completo    o job build inteiro, com PostgreSQL 16 efemero   (Linux)
 *   backup      backup + restore real                            (Linux)
 *   docker      imagens Docker reais                             (Linux)
 *   tudo        completo + backup + docker
 *
 * "Linux" quer dizer: no Windows o job roda num container local
 * (scripts/ci/linux/runner.Dockerfile) a partir de um snapshot LF do working
 * tree. Nao e runner do GitHub: nada aqui fala com o GitHub.
 *
 * Opcoes:
 *   --list               mostra os passos do perfil e sai
 *   --only a,b           roda so esses passos (ids de --list)
 *   --from a             comeca no passo a
 *   --skip a,b           pula esses passos
 *   --skip-install       pula `pnpm install --frozen-lockfile`
 *   --container          roda o job build num container Linux (Node 22), mesmo no rapido/padrao
 *   --native             roda o completo direto no host (no Windows: melhor esforco)
 *   --keep-env           nao remove as variaveis sensiveis do ambiente das etapas
 *
 * Sai 0 se tudo passou e 1 na primeira falha (o resto nao roda).
 */

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createSnapshot } from './lib/snapshot.mjs'
import { capture, posixTool, runInherit, runPnpm, sanitizedEnv } from './lib/proc.mjs'
import { JOBS, PROFILES, SHELL_SCRIPTS, STEPS, stepsFor } from './steps.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const RUNNER_IMAGE = 'cinerie-ci-runner:local'
const LINE = '========================================'

/**
 * Ctrl+C: o filho recebe o mesmo sinal do console e sai; o pipeline nao segue
 * para o passo seguinte e ainda limpa os containers do job.
 */
let interrupted = false
process.on('SIGINT', () => {
  interrupted = true
})

// ---------------------------------------------------------------- argumentos

function parseArgs(argv) {
  const opts = { profile: 'padrao', only: null, from: null, skip: [], skipInstall: false, container: false, native: false, keepEnv: false, list: false, job: null, inside: false, hook: null }
  const list = (v) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v === undefined) fail(`opcao ${a} precisa de um valor`)
      return v
    }
    if (a === '--only') opts.only = list(next())
    else if (a === '--from') opts.from = next()
    else if (a === '--skip') opts.skip.push(...list(next()))
    else if (a === '--skip-install') opts.skipInstall = true
    else if (a === '--container') opts.container = true
    else if (a === '--native') opts.native = true
    else if (a === '--keep-env') opts.keepEnv = true
    else if (a === '--list') opts.list = true
    else if (a === '--job') opts.job = next()
    else if (a === '--inside-container') opts.inside = true
    else if (a === '--hook') opts.hook = next()
    else if (a === '--help' || a === '-h') {
      printHelp()
      process.exit(0)
    } else if (!a.startsWith('-')) opts.profile = a
    else fail(`opcao desconhecida: ${a} (use --help)`)
  }
  if (!PROFILES[opts.profile]) fail(`perfil desconhecido: ${opts.profile}. Perfis: ${Object.keys(PROFILES).join(', ')}`)
  if (opts.container && opts.native) fail('--container e --native sao exclusivos')
  const ids = new Set(STEPS.map((s) => s.id))
  for (const id of [...(opts.only ?? []), ...opts.skip, ...(opts.from ? [opts.from] : [])]) {
    if (!ids.has(id)) fail(`passo desconhecido: ${id} (veja --list)`)
  }
  return opts
}

function printHelp() {
  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  const doc = src.split('*/')[0].split('\n').slice(2).map((l) => l.replace(/^ \* ?/, ''))
  console.log(doc.join('\n'))
}

function fail(msg) {
  console.error(`ERRO: ${msg}`)
  process.exit(1)
}

// ------------------------------------------------------------------ formato

function fmtDuration(ms) {
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  // Arredonda o TOTAL antes de dividir: senao 359,6 s viraria "5min 60s".
  const total = Math.round(s)
  return `${Math.floor(total / 60)}min ${total % 60}s`
}

function banner(text) {
  console.log(`\n${LINE}\n${text}\n${LINE}`)
}

// ------------------------------------------------------ selecao de passos

function selectSteps(steps, opts) {
  let out = steps
  if (opts.from) {
    const idx = out.findIndex((s) => s.id === opts.from)
    out = idx === -1 ? [] : out.slice(idx)
  }
  if (opts.only) out = out.filter((s) => opts.only.includes(s.id))
  const skip = new Set(opts.skip)
  if (opts.skipInstall) for (const s of STEPS) if (s.pnpm?.[0] === 'install') skip.add(s.id)
  return out.filter((s) => !skip.has(s.id))
}

/** Os jobs do perfil e onde cada um roda: no host ou num container Linux. */
function planJobs(opts) {
  const profile = PROFILES[opts.profile]
  if (opts.inside) return [{ job: opts.job, where: 'host' }]
  return Object.keys(profile.jobs).map((job) => {
    const linuxOnly = job !== 'build' || profile.linux
    let where = 'host'
    if (opts.container) where = 'container'
    else if (linuxOnly && process.platform !== 'linux' && !(opts.native && job === 'build')) where = 'container'
    if (opts.native && job !== 'build' && process.platform !== 'linux') {
      fail(`o job ${job} so roda em Linux; no Windows ele usa o container (tire --native)`)
    }
    return { job, where }
  })
}

// --------------------------------------------------------- passos especiais

/**
 * Sintaxe dos `.sh`/`.awk`. O conteudo vai pelo stdin com o `\r` removido:
 * em producao os arquivos chegam do git em LF, e e essa forma que se checa
 * (o working tree do Windows esta em CRLF por `core.autocrlf`).
 */
async function shellSyntax() {
  const tracked = capture('git', ['ls-files', '*.sh'], { cwd: REPO_ROOT }).stdout.split('\n').map((s) => s.trim()).filter(Boolean)
  const declared = [...SHELL_SCRIPTS.bash, ...SHELL_SCRIPTS.dash]
  const missing = tracked.filter((f) => !declared.includes(f))
  if (tracked.length !== declared.length || missing.length > 0) {
    console.error(`  ha ${tracked.length} script(s) .sh versionado(s), mas este gate cobre ${declared.length}.`)
    console.error('  Adicione o novo script a SHELL_SCRIPTS em scripts/ci/steps.mjs.')
    for (const f of tracked) console.error(`    ${f}`)
    return 1
  }
  const tools = { bash: posixTool('bash'), dash: posixTool('dash'), awk: posixTool('awk') }
  for (const [name, bin] of Object.entries(tools)) {
    if (!bin) {
      console.error(`  ${name} nao encontrado. No Windows ele vem com o Git for Windows (usr/bin/${name}.exe).`)
      return 1
    }
  }
  const lf = (file) => readFileSync(path.join(REPO_ROOT, file), 'utf8').replace(/\r\n/g, '\n')
  for (const shell of ['bash', 'dash']) {
    for (const file of SHELL_SCRIPTS[shell]) {
      const res = capture(tools[shell], ['-n'], { input: lf(file), allowFail: true })
      if (!res.ok) {
        console.error(`  ${shell} -n ${file} FALHOU:\n${res.stderr}`)
        return 1
      }
      console.log(`  ${shell} -n ${file}: ok`)
    }
  }
  const tmpDir = path.join(os.tmpdir(), `cinerie-ci-awk-${process.pid}`)
  mkdirSync(tmpDir, { recursive: true })
  try {
    for (const file of SHELL_SCRIPTS.awk) {
      const tmp = path.join(tmpDir, path.basename(file)).replace(/\\/g, '/')
      writeFileSync(tmp, lf(file))
      const vars = ['tables_out', 'rows_out', 'indexes_out', 'constraints_out'].flatMap((v) => ['-v', `${v}=/dev/null`])
      const res = capture(tools.awk, [...vars, '-f', tmp], { input: '', allowFail: true })
      if (!res.ok) {
        console.error(`  awk -f ${file} FALHOU:\n${res.stderr}`)
        return 1
      }
      console.log(`  awk -f ${file}: ok`)
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
  return 0
}

/** eslint so nos arquivos staged: e o que cabe num pre-commit. */
async function preCommit(env) {
  const staged = capture('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], { cwd: REPO_ROOT })
    .stdout.split('\0')
    .filter((f) => /\.(c|m)?(j|t)sx?$/.test(f))
  if (staged.length === 0) {
    console.log('  nenhum arquivo JS/TS staged')
    return 0
  }
  console.log(`  ${staged.length} arquivo(s) JS/TS staged`)
  // Lotes: a linha de comando do cmd.exe tem teto de 8191 caracteres.
  for (let i = 0; i < staged.length; i += 40) {
    const code = await runPnpm(['exec', 'eslint', '--no-warn-ignored', ...staged.slice(i, i + 40)], { env, cwd: REPO_ROOT })
    if (code !== 0) return code
  }
  return 0
}

// ------------------------------------------------------------ host (nativo)

function describe(step) {
  if (step.pnpm) return `corepack pnpm ${step.pnpm.join(' ')}`
  if (step.bash) return `bash ${step.bash.join(' ')}`
  return `(${step.special})`
}

async function runStep(step, baseEnv, jobEnv) {
  const env = { ...baseEnv, ...jobEnv, ...(step.env ?? {}) }
  if (step.special === 'shell-syntax') return shellSyntax()
  if (step.special === 'pre-commit') return preCommit(env)
  if (step.pnpm) return runPnpm(step.pnpm, { env, cwd: REPO_ROOT })
  if (step.bash) {
    const bash = posixTool('bash')
    if (!bash) {
      console.error('  bash nao encontrado')
      return 127
    }
    return runInherit(bash, step.bash, { env, cwd: REPO_ROOT })
  }
  throw new Error(`passo sem comando: ${step.id}`)
}

/** Roda passos em sequencia, para na primeira falha. Devolve o resumo. */
async function runStepsHere(steps, { env, jobEnv = {}, label }) {
  const results = []
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    console.log(`\n[${i + 1}/${steps.length}] ${step.title}`)
    console.log(`      > ${describe(step)}`)
    const started = Date.now()
    const code = interrupted ? 130 : await runStep(step, env, jobEnv)
    const ms = Date.now() - started
    results.push({ id: step.id, title: step.title, ok: code === 0 && !interrupted, ms, label })
    if (code !== 0 || interrupted) {
      console.log(interrupted ? 'INTERROMPIDO (Ctrl+C)' : `FALHOU (codigo ${code}, ${fmtDuration(ms)})`)
      return { ok: false, results }
    }
    console.log(`OK (${fmtDuration(ms)})`)
  }
  return { ok: true, results }
}

// ---------------------------------------------------------- container Linux

function dockerReady() {
  const res = capture('docker', ['version', '--format', '{{.Server.Version}}'], { allowFail: true })
  return res.ok ? res.stdout.trim() : null
}

function playwrightVersion() {
  const lock = readFileSync(path.join(REPO_ROOT, 'pnpm-lock.yaml'), 'utf8')
  const m = lock.match(/\n {2}playwright-core@(\d+\.\d+\.\d+):/)
  if (!m) fail('versao do playwright-core nao encontrada no pnpm-lock.yaml')
  return m[1]
}

/**
 * A imagem do executor so e reconstruida quando a receita muda (Dockerfile ou
 * versao do Playwright). Mesmo com cache de camada, um `docker build` consulta
 * o Docker Hub pelos metadados das imagens base — medido em 2026-10-14: de 3 s a
 * 78 s, conforme o registro. Com o hash no rotulo, a execucao seguinte nem
 * precisa de rede para comecar.
 */
async function buildRunnerImage(env) {
  const dir = path.join(REPO_ROOT, 'scripts', 'ci', 'linux')
  const dockerfile = path.join(dir, 'runner.Dockerfile')
  const pw = playwrightVersion()
  const recipe = createHash('sha256').update(readFileSync(dockerfile)).update(`\0${pw}`).digest('hex').slice(0, 16)
  const current = capture('docker', ['image', 'inspect', RUNNER_IMAGE, '--format', '{{index .Config.Labels "cinerie-ci.recipe"}}'], { allowFail: true })
  if (current.ok && current.stdout.trim() === recipe) {
    console.log(`\n-- imagem do executor ${RUNNER_IMAGE} em dia (receita ${recipe})`)
    return
  }
  console.log(`\n-- construindo a imagem do executor ${RUNNER_IMAGE} (receita ${recipe}; a primeira vez leva minutos)`)
  const code = await runInherit(
    'docker',
    ['build', '-t', RUNNER_IMAGE, '-f', dockerfile, '--build-arg', `PLAYWRIGHT_VERSION=${pw}`, '--label', `cinerie-ci.recipe=${recipe}`, dir],
    { env },
  )
  if (code !== 0) fail('nao foi possivel construir a imagem do executor')
}

async function waitService(container, cmd) {
  for (let i = 0; i < 60; i++) {
    if (capture('docker', ['exec', container, ...cmd], { allowFail: true }).ok) return true
    await new Promise((r) => setTimeout(r, 2000))
  }
  return false
}

/**
 * Restos de execucoes MORTAS. O `finally` de `runJobInContainer` limpa o que a
 * execucao criou — mas so se o processo chegar ate ele. Medido em 2026-10-14: a
 * maquina dormiu no meio de um job `backup` e sobraram o container do PostgreSQL
 * e a rede. O rotulo e `<horario>-<pid>`; se o pid nao existe mais, ninguem vai
 * limpar aquilo. Execucao VIVA (outro terminal, outro worktree) nao e tocada.
 */
function cleanupOrphans() {
  const alive = (runId) => {
    const pid = Number(runId.split('-').pop())
    if (!Number.isInteger(pid) || pid <= 0) return true // rotulo estranho: nao mexe
    try {
      process.kill(pid, 0)
      return true
    } catch (err) {
      return err.code === 'EPERM' // existe, so nao e nosso
    }
  }
  const list = (kind) =>
    capture('docker', [...kind, '--filter', 'label=cinerie-ci.run', '--format', '{{.ID}} {{.Label "cinerie-ci.run"}}'], { allowFail: true })
      .stdout.split('\n')
      .map((l) => l.trim().split(' '))
      .filter(([id, run]) => id && run && !alive(run))
  const containers = list(['ps', '-a'])
  const networks = list(['network', 'ls'])
  if (containers.length === 0 && networks.length === 0) return
  console.log(`-- removendo restos de execucoes interrompidas: ${containers.length} container(s), ${networks.length} rede(s)`)
  if (containers.length) capture('docker', ['rm', '-f', '-v', ...containers.map(([id]) => id)], { allowFail: true })
  for (const [id] of networks) capture('docker', ['network', 'rm', id], { allowFail: true })
}

function forwardedArgs(opts) {
  const args = []
  if (opts.only) args.push('--only', opts.only.join(','))
  if (opts.from) args.push('--from', opts.from)
  if (opts.skip.length) args.push('--skip', opts.skip.join(','))
  if (opts.skipInstall) args.push('--skip-install')
  return args
}

/**
 * Um job inteiro dentro do executor Linux: snapshot LF do working tree,
 * servicos do job (como o `services:` do workflow), e o MESMO pipeline.mjs
 * rodando la dentro com `--inside-container`.
 */
async function runJobInContainer(job, opts, env) {
  const version = dockerReady()
  if (!version) {
    console.error('  O daemon do Docker nao responde. Abra o Docker Desktop e rode .\\scripts\\doctor.ps1.')
    return { ok: false, results: [{ id: job, title: `job ${job} (container)`, ok: false, ms: 0 }] }
  }
  const started = Date.now()
  const runId = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${process.pid}`
  const label = `cinerie-ci.run=${runId}`
  const tmpDir = path.join(os.tmpdir(), 'cinerie-ci')
  mkdirSync(tmpDir, { recursive: true })
  const tarFile = path.join(tmpDir, `snapshot-${runId}.tar`)
  const network = `cinerie-ci-${runId}`
  const spec = JOBS[job]
  // Cada fase de preparo com o tempo decorrido: quando o job demora, da para ver onde.
  const phase = (text) => console.log(`-- [${fmtDuration(Date.now() - started)}] ${text}`)
  let ok = false
  try {
    cleanupOrphans()
    await buildRunnerImage(env)
    phase('snapshot LF do working tree (inclui alteracoes nao commitadas)')
    const tree = createSnapshot(REPO_ROOT, tarFile)
    const sha = capture('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT }).stdout.trim()
    console.log(`   arvore ${tree.slice(0, 12)} sobre HEAD ${sha.slice(0, 12)}`)
    capture('docker', ['network', 'create', '--label', label, network])
    for (const svc of spec.services) {
      const name = `cinerie-ci-${runId}-${svc.alias}`
      phase(`servico ${svc.alias} (${svc.image})`)
      capture('docker', ['run', '-d', '--name', name, '--label', label, '--network', network, '--network-alias', svc.alias, ...Object.entries(svc.env).flatMap(([k, v]) => ['-e', `${k}=${v}`]), svc.image])
      if (!(await waitService(name, svc.ready))) throw new Error(`servico ${svc.alias} nao ficou pronto`)
    }
    const inner = [opts.profile, '--job', job, '--inside-container', ...forwardedArgs(opts)].join(' ')
    const bootstrap = [
      'set -euo pipefail',
      'mkdir -p /work && cd /work && tar -xf /snapshot.tar',
      // O checkout do runner tinha .git: testes de governanca usam `git ls-files`.
      "git config --global --add safe.directory '*'",
      'git init -q && git add -A && git -c user.name=cinerie-ci -c user.email=ci@localhost commit -q --no-verify -m snapshot',
      `exec node scripts/ci/pipeline.mjs ${inner}`,
    ].join('; ')
    const runArgs = [
      'run', '--rm', '--init', '--name', `cinerie-ci-${runId}-runner`, '--label', label, '--network', network,
      '--shm-size', '2g', '-u', spec.user,
      '--mount', `type=bind,source=${tarFile},target=/snapshot.tar,readonly`,
      '-v', 'cinerie-ci-pnpm-store:/cache/pnpm-store', '-v', 'cinerie-ci-playwright:/cache/ms-playwright',
      '-e', `CINERIE_CI_RUN_ID=${runId}`, '-e', `CINERIE_CI_NETWORK=${network}`, '-e', `CINERIE_CI_SHA=${sha}`,
      ...Object.entries(spec.env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
      ...(spec.dockerSocket ? ['-v', '/var/run/docker.sock:/var/run/docker.sock'] : []),
      RUNNER_IMAGE, 'bash', '-c', bootstrap,
    ]
    phase(`executando o job ${job} no container (Docker ${version})`)
    ok = (await runInherit('docker', runArgs, { env })) === 0
    phase(`job ${job} terminou no container; limpando`)
  } catch (err) {
    console.error(`  ${err.message}`)
    ok = false
  } finally {
    const ids = capture('docker', ['ps', '-aq', '--filter', `label=${label}`], { allowFail: true }).stdout.split(/\s+/).filter(Boolean)
    if (ids.length) capture('docker', ['rm', '-f', '-v', ...ids], { allowFail: true })
    capture('docker', ['network', 'rm', network], { allowFail: true })
    rmSync(tarFile, { force: true })
    phase('limpeza concluida')
  }
  return { ok, results: [{ id: job, title: `job ${job} (container Linux)`, ok, ms: Date.now() - started }] }
}

// ---------------------------------------------------------------------- main

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const profile = PROFILES[opts.profile]

  if (opts.list) {
    console.log(`Perfil ${opts.profile}: ${profile.description}`)
    if (profile.special) return
    for (const { job, where } of planJobs(opts)) {
      console.log(`\njob ${job}${where === 'container' ? '  [container Linux]' : ''}`)
      for (const s of selectSteps(stepsFor(opts.profile, job), opts)) console.log(`  ${s.id.padEnd(26)} ${s.title}`)
    }
    return
  }

  const { env, removed } = sanitizedEnv({ keepEnv: opts.keepEnv })
  const started = Date.now()
  const where = opts.inside ? `container Linux, job ${opts.job}` : `${process.platform}`
  banner(`CI LOCAL - perfil ${opts.profile} (${where})\n${profile.description}`)
  console.log(`Node ${process.version}  repo ${REPO_ROOT}`)
  // So importa para o que roda no host: o container ja e Node 22.
  const someJobOnHost = profile.special || planJobs(opts).some((j) => j.where === 'host')
  if (someJobOnHost && Number(process.versions.node.split('.')[0]) !== 22) {
    console.log(`AVISO: o projeto declara Node >=22 <23 (producao usa 22). Este host roda ${process.version}.`)
    console.log('       Para equivalencia exata, use --container (Node 22 no Linux).')
  }
  if (removed.length) console.log(`Ambiente: ${removed.length} variavel(is) sensivel(is) fora das etapas: ${removed.join(', ')}`)
  if (opts.hook === 'pre-push') {
    const dirty = capture('git', ['status', '--porcelain'], { cwd: REPO_ROOT, allowFail: true }).stdout.trim()
    if (dirty) console.log('AVISO: ha alteracoes nao commitadas; o pre-push valida o working tree, nao so os commits enviados.')
  }

  const all = []
  let ok = true
  if (profile.special) {
    const r = await runStepsHere([{ id: opts.profile, title: profile.description, special: profile.special }], { env })
    all.push(...r.results)
    ok = r.ok
  } else {
    for (const { job, where: place } of planJobs(opts)) {
      const steps = selectSteps(stepsFor(opts.profile, job), opts)
      if (steps.length === 0) continue
      banner(`JOB ${job} (${place === 'container' ? 'container Linux' : 'host'}, ${steps.length} passo(s))`)
      const r = place === 'container' ? await runJobInContainer(job, opts, env) : await runStepsHere(steps, { env, jobEnv: JOBS[job].env, label: job })
      all.push(...r.results)
      if (!r.ok) {
        ok = false
        break
      }
    }
  }

  banner('RESUMO')
  for (const r of all) console.log(`  ${r.ok ? 'OK   ' : 'FALHA'} ${r.id.padEnd(26)} ${fmtDuration(r.ms)}`)
  const total = fmtDuration(Date.now() - started)
  if (ok) banner(`CI LOCAL CONCLUIDO COM SUCESSO (perfil ${opts.profile}, ${total})`)
  else banner(`CI LOCAL FALHOU (perfil ${opts.profile}, ${total}) - corrija e rode de novo`)
  process.exit(ok ? 0 : 1)
}

main().catch((err) => {
  console.error(err?.stack ?? String(err))
  process.exit(1)
})
