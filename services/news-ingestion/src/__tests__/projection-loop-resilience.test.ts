/**
 * projection-loop-resilience.test.ts — O worker de projecao NAO MORRE.
 *
 * Sobe o entrypoint de verdade (`bin/project-editorial.ts --loop`) contra um CMS
 * de mentira e observa o processo ao longo de varios ciclos. E a unica forma de
 * provar a afirmacao que interessa — "o processo continua vivo" — porque o
 * defeito vivia exatamente na costura que nenhum teste de unidade tocava.
 *
 * O DEFEITO. `runCycle` chamava `claim()` fora de qualquer `try`; o `try`
 * interno cobria so `processEvent`, e o `while` tinha `try/finally` sem `catch`.
 * Qualquer falha da chamada de claim escapava ate `main().catch`, que fazia
 * `process.exit(1)`. Em producao isso era um crash-loop com o painel verde: o
 * health server subia em cada encarnacao e respondia 200 antes de o processo
 * morrer de novo.
 *
 * Reproduzido antes da correcao, com este mesmo harness:
 *
 *   fila vazia   -> PROCESSO VIVO, 7 ciclos   (ja era o caminho ocioso normal)
 *   HTTP 500     -> EXIT 1  "erro fatal: Error"
 *   ECONNREFUSED -> EXIT 1  "erro fatal: TypeError"
 *   ECONNRESET   -> EXIT 1  "erro fatal: TypeError"
 *   timeout      -> EXIT 1  "erro fatal: TimeoutError"
 *
 * NAO TOCA BANCO. O caminho de claim (vazio ou falho) nunca chega ao Prisma;
 * `SCREEN_DATABASE_URL` aponta para uma porta onde ninguem escuta de proposito,
 * o que tambem prova que o worker nao abre conexao com banco para ficar ocioso.
 *
 * A logica de decisao esta coberta, pura e rapida, em `worker-loop-health.test.ts`.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { createConnection } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

const workerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Como o CMS de mentira responde ao `claim`. */
type ClaimBehavior = 'empty' | 'http500' | 'reset' | 'hang'

const POLL_MS = 1_000 // piso aceito por `resolveProjectionWorkerConfig`
const REQUEST_TIMEOUT_MS = 1_000
const CYCLES_REQUIRED = 3

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

interface FakeCms {
  readonly server: Server
  readonly port: number
  claims: () => number
}

async function startFakeCms(behavior: ClaimBehavior): Promise<FakeCms> {
  let claims = 0
  const server = createServer((request, response) => {
    if (request.url?.includes('/publication-outbox/claim') === true) {
      claims += 1
      if (behavior === 'reset') {
        request.socket.destroy() // ECONNRESET no meio da resposta
        return
      }
      if (behavior === 'hang') {
        return // nunca responde -> AbortSignal.timeout dispara
      }
      const status = behavior === 'http500' ? 500 : 200
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(behavior === 'http500' ? { error: 'boom' } : { events: [] }))
      return
    }
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end('{}')
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return { server, port, claims: () => claims }
}

/** Porta livre: abre, LE, fecha, devolve. Fechar antes de devolver e o ponto. */
async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const address = probe.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return port
}

interface RunningWorker {
  readonly child: ChildProcessWithoutNullStreams
  readonly healthPort: number
  output: () => string
  isAlive: () => boolean
}

async function startWorker(options: {
  readonly cmsPort: number
  readonly healthPort: number
}): Promise<RunningWorker> {
  // `node --import tsx` em vez do bin `.CMD`: `spawn` de `.CMD` sem shell falha
  // com EINVAL no Windows, e um `shell: true` nao repassaria o sinal ao filho.
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'bin/project-editorial.ts', '--loop'],
    {
      cwd: workerDir,
      env: {
        ...process.env,
        // Porta sem ninguem escutando. Se algum caminho ocioso tocasse o banco,
        // este teste falharia — o que e exatamente o que queremos saber.
        SCREEN_DATABASE_URL: 'postgresql://u:p@127.0.0.1:5999/cinerie_loop_test_screen',
        PAYLOAD_DATABASE_URL: 'postgresql://c:p@127.0.0.1:5999/cinerie_loop_test_cms',
        PAYLOAD_INTERNAL_SERVICE_URL: `http://127.0.0.1:${String(options.cmsPort)}`,
        PAYLOAD_PROJECTION_API_KEY: 'chave-de-teste-nao-real',
        PROJECTION_WORKER_ID: 'worker-de-teste',
        PROJECTION_POLL_INTERVAL_MS: String(POLL_MS),
        PROJECTION_REQUEST_TIMEOUT_MS: String(REQUEST_TIMEOUT_MS),
        EDITORIAL_MEDIA_STORAGE_DRIVER: 'local',
        EDITORIAL_MEDIA_LOCAL_ROOT: path.join(workerDir, 'var', 'loop-test-media'),
        PUBLICATION_WORKER_HEALTH_PORT: String(options.healthPort),
        // `local` e recusado sob `production` (disco efemero perde midia).
        NODE_ENV: 'development',
      },
    },
  )

  let output = ''
  let exited = false
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))
  child.on('exit', () => (exited = true))

  return {
    child,
    healthPort: options.healthPort,
    output: () => output,
    isAlive: () => !exited,
  }
}

async function stopWorker(worker: RunningWorker | null): Promise<void> {
  if (worker === null || !worker.isAlive()) return
  worker.child.kill('SIGKILL')
  await new Promise((resolve) => setTimeout(resolve, 200))
}

/** Espera `predicate` ou estoura. Devolve `false` no estouro (nunca lanca). */
async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return predicate()
}

async function readyzChecks(
  port: number,
): Promise<{ name: string; status: string; detail: string }[]> {
  const response = await fetch(`http://127.0.0.1:${String(port)}/readyz`)
  const body = (await response.json()) as {
    checks?: { name: string; status: string; detail: string }[]
  }
  return body.checks ?? []
}

async function healthzStatus(port: number): Promise<number> {
  const response = await fetch(`http://127.0.0.1:${String(port)}/healthz`)
  return response.status
}

/** O health server esta atendendo? Serve de sinal de "worker subiu". */
async function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ port, host: '127.0.0.1' })
      socket.once('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.once('error', () => resolve(false))
    })
    if (open) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}

/* ------------------------------------------------------------------ */
/* Os testes                                                           */
/* ------------------------------------------------------------------ */

let cms: FakeCms | null = null
let worker: RunningWorker | null = null

afterEach(async () => {
  await stopWorker(worker)
  worker = null
  if (cms !== null) {
    await new Promise<void>((resolve) => cms?.server.close(() => resolve()))
    cms = null
  }
})

describe('o loop de projecao sobrevive a fila vazia', () => {
  it(
    `${String(CYCLES_REQUIRED)} ciclos de fila vazia e o processo continua vivo`,
    async () => {
      // A fila vazia SEMPRE foi o caminho ocioso correto: o endpoint `claim` do
      // CMS responde 200 com `events: []` imediatamente — nao ha long-poll.
      // Este teste fixa isso como contrato para que ninguem o transforme em
      // erro fatal ao "endurecer" o worker depois.
      cms = await startFakeCms('empty')
      worker = await startWorker({ cmsPort: cms.port, healthPort: await freePort() })

      const ciclos = await waitFor(
        () => (cms?.claims() ?? 0) >= CYCLES_REQUIRED,
        20_000,
      )

      expect(ciclos, `so houve ${String(cms.claims())} ciclo(s):\n${worker.output()}`).toBe(true)
      expect(worker.isAlive(), `o processo morreu:\n${worker.output()}`).toBe(true)
      expect(worker.child.exitCode).toBeNull()
      // Ocioso e silencioso: fila vazia nao polui o log com falha.
      expect(worker.output()).not.toContain('ciclo FALHOU')
      expect(worker.output()).not.toContain('erro fatal')
    },
    30_000,
  )

  it(
    'ocioso, o /readyz reporta o loop como saudavel',
    async () => {
      cms = await startFakeCms('empty')
      const healthPort = await freePort()
      worker = await startWorker({ cmsPort: cms.port, healthPort })

      expect(await waitForPort(healthPort, 20_000)).toBe(true)
      await waitFor(() => (cms?.claims() ?? 0) >= 1, 10_000)

      const loop = (await readyzChecks(healthPort)).find(
        (check) => check.name === 'projection_loop',
      )
      expect(loop, 'o /readyz nao reporta o loop').toBeDefined()
      expect(loop?.status).toBe('ok')
    },
    30_000,
  )
})

describe('o loop de projecao sobrevive a falha do CMS', () => {
  // Cada um destes matava o processo com exit 1 antes da correcao.
  const modos: { behavior: ClaimBehavior; nome: string; codigo: string }[] = [
    { behavior: 'http500', nome: 'HTTP 500 da outbox', codigo: 'outbox_http_500' },
    { behavior: 'reset', nome: 'conexao derrubada (ECONNRESET)', codigo: 'cms_unreachable_' },
    { behavior: 'hang', nome: 'CMS que nao responde (TimeoutError)', codigo: 'cms_timeout' },
  ]

  for (const modo of modos) {
    it(
      `${modo.nome}: falha em ${String(CYCLES_REQUIRED)} ciclos e o processo continua vivo`,
      async () => {
        cms = await startFakeCms(modo.behavior)
        worker = await startWorker({ cmsPort: cms.port, healthPort: await freePort() })

        const ciclos = await waitFor(() => (cms?.claims() ?? 0) >= CYCLES_REQUIRED, 25_000)

        expect(ciclos, `so houve ${String(cms.claims())} ciclo(s):\n${worker.output()}`).toBe(true)
        expect(worker.isAlive(), `o processo morreu:\n${worker.output()}`).toBe(true)
        expect(worker.child.exitCode).toBeNull()
        // A falha e VISIVEL e com codigo estavel — nao o antigo `TypeError`
        // opaco, que era o mesmo para 500, ECONNREFUSED, ECONNRESET e DNS.
        expect(worker.output()).toContain('ciclo FALHOU')
        expect(worker.output()).toContain(modo.codigo)
        expect(worker.output()).not.toContain('erro fatal')
      },
      40_000,
    )
  }

  it(
    'CMS inalcancavel (ECONNREFUSED) nao mata o processo',
    async () => {
      // Sem CMS nenhum: e o cenario de deploy, quando o worker sobe antes do
      // CMS. Era ele que produzia o crash-loop logo apos cada publicacao.
      const portaMorta = await freePort()
      worker = await startWorker({ cmsPort: portaMorta, healthPort: await freePort() })

      const falhas = await waitFor(
        () =>
          (worker?.output().match(/ciclo FALHOU/g) ?? []).length >= CYCLES_REQUIRED,
        25_000,
      )

      expect(falhas, `log:\n${worker.output()}`).toBe(true)
      expect(worker.isAlive(), `o processo morreu:\n${worker.output()}`).toBe(true)
      expect(worker.output()).toContain('cms_unreachable_econnrefused')
    },
    40_000,
  )
})

describe('falha persistente aparece no /readyz em vez de matar o processo', () => {
  it(
    'apos falhas seguidas o /readyz marca projection_loop como blocked',
    async () => {
      // A metade que impede a correcao de virar "vive e nao trabalha, em
      // silencio". O worker sobrevive, mas DECLARA que nao esta projetando.
      cms = await startFakeCms('http500')
      const healthPort = await freePort()
      worker = await startWorker({ cmsPort: cms.port, healthPort })

      expect(await waitForPort(healthPort, 20_000)).toBe(true)
      await waitFor(() => (cms?.claims() ?? 0) >= 4, 25_000)

      const loop = (await readyzChecks(healthPort)).find(
        (check) => check.name === 'projection_loop',
      )
      expect(loop?.status, `checks:\n${worker.output()}`).toBe('blocked')
      expect(loop?.detail).toContain('outbox_http_500')

      // LIVENESS segue 200: o CMS caido nao e caso de reiniciar o worker —
      // reiniciar nao levanta o CMS. Confundir os dois transformaria uma queda
      // do CMS num crash-loop do worker.
      expect(await healthzStatus(healthPort)).toBe(200)
      expect(worker.isAlive()).toBe(true)
    },
    45_000,
  )

  it(
    'o /readyz nunca vaza credencial nem connection string',
    async () => {
      cms = await startFakeCms('http500')
      const healthPort = await freePort()
      worker = await startWorker({ cmsPort: cms.port, healthPort })

      expect(await waitForPort(healthPort, 20_000)).toBe(true)
      await waitFor(() => (cms?.claims() ?? 0) >= 2, 20_000)

      const body = JSON.stringify(await readyzChecks(healthPort))
      for (const secret of ['chave-de-teste-nao-real', 'postgresql://', 'API-Key']) {
        expect(body, `vazou "${secret}"`).not.toContain(secret)
      }
      expect(body).toContain('projection_loop') // controle positivo
    },
    40_000,
  )
})
