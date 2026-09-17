/**
 * container-healthcheck.test.ts — o HEALTHCHECK de cada imagem pergunta a porta
 * que o processo DAQUELE container serve.
 *
 * ============================================================================
 * O DEFEITO QUE ESTE TESTE TRAVA
 * ============================================================================
 * O `Dockerfile` da raiz roda dois servicos: `screen-app` (o CMD da imagem) e
 * `screen-cron` (a mesma imagem com o comando do agendador). O HEALTHCHECK era
 * um fetch FIXO na porta 3000, que so o site serve. No `screen-cron` o container
 * nunca ficava saudavel e era substituido em loop — 129 containers numa hora em
 * 16/09/2026 —, e as filas longas do agendador pararam de registrar execucao,
 * porque todo lote morria no meio.
 *
 * Tres coisas tem de continuar verdadeiras:
 *
 *   1. O comando do agendador leva ao `/healthz` dele; o CMD do site leva ao
 *      `/api/health/` — MESMO com o ambiente do agendador colado no site.
 *   2. So 200 do processo certo e saudavel: 503, redirect, porta fechada e
 *      silencio reprovam.
 *   3. Toda imagem de servico unico sonda a porta que ela mesma declara — o
 *      defeito, generalizado.
 *
 * A prova com a IMAGEM REAL (o Docker avaliando o HEALTHCHECK de um container do
 * agendador) mora na CI, job `docker-image`: este arquivo prova a DECISAO, aquele
 * prova a MONTAGEM.
 */

import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { resolveSchedulerConfig } from '../../services/sync/src/scheduler/config.js'
import {
  commentSyntaxFor,
  readSourceWithoutComments,
  REPO_ROOT,
  stripComments,
} from '../support/source-text.js'

import {
  APP_HEALTH_PATH,
  APP_HEALTH_PORT,
  APP_SERVICE,
  HEALTHCHECK_URL_ENV,
  SCHEDULER_DEFAULT_HEALTH_PORT,
  SCHEDULER_HEALTH_PATH,
  SCHEDULER_HEALTH_PORT_ENV,
  SCHEDULER_SERVICE,
  isSchedulerCommand,
  parseProcCmdline,
  resolveHealthTarget,
  runHealthcheck,
  // @ts-expect-error — modulo .mjs de tooling de container, sem tipos gerados.
} from '../../scripts/healthcheck/lib/health-target.mjs'

type Env = Record<string, string | undefined>

const ENTRY = path.join(REPO_ROOT, 'scripts', 'healthcheck', 'container-health.mjs')

const APP_URL = `http://127.0.0.1:${String(APP_HEALTH_PORT)}${APP_HEALTH_PATH}`
const SCHEDULER_URL = `http://127.0.0.1:${String(SCHEDULER_DEFAULT_HEALTH_PORT)}${SCHEDULER_HEALTH_PATH}`

/**
 * O CMD da imagem da raiz, como o PID 1 do `screen-app` o carrega: o
 * `docker-entrypoint.sh` da imagem node termina em `exec "$@"`.
 */
function rootImageCmd(): string[] {
  const dockerfile = readSourceWithoutComments('Dockerfile')
  const match = /^CMD\s+(\[.*\])\s*$/m.exec(dockerfile)
  if (match === null) throw new Error('o Dockerfile da raiz perdeu o CMD em forma exec')
  return JSON.parse(match[1] as string) as string[]
}

/** As formas que o comando do agendador toma no PID 1, conforme o painel o entrega. */
const SCHEDULER_PID1_FORMS: readonly (readonly string[])[] = [
  // O PID 1 MEDIDO no screen-cron em 17/09/2026 (`tr '\0' ' ' < /proc/1/cmdline`):
  // o EasyPanel embrulha o comando do painel em `/bin/sh -c`, como UM argumento.
  ['/bin/sh', '-c', 'corepack pnpm --filter @screena/sync scheduler:start'],
  // o `sh -c` fez exec do ultimo comando: o PID 1 vira o proprio corepack
  ['node', '/usr/local/bin/corepack', 'pnpm', '--filter', '@screena/sync', 'scheduler:start'],
  // o entrypoint da imagem node, antes do `exec "$@"`
  [
    '/bin/sh',
    '/usr/local/bin/docker-entrypoint.sh',
    'corepack',
    'pnpm',
    '--filter',
    '@screena/sync',
    'scheduler:start',
  ],
  // o binario chamado direto, sem o script do pacote
  ['node', '/app/node_modules/.bin/tsx', 'services/sync/bin/cinerie-scheduler.ts'],
]

describe('o comando do PID 1 decide o servico', () => {
  it('o CMD da imagem (o screen-app) sonda o /api/health/ do site', () => {
    const cmd = rootImageCmd()
    expect(isSchedulerCommand(cmd)).toBe(false)
    expect(resolveHealthTarget({ pid1Args: cmd, env: {} })).toEqual({
      ok: true,
      service: APP_SERVICE,
      via: 'padrao',
      url: APP_URL,
      display: APP_URL,
    })
    // Depois do `exec pnpm` do CMD, o PID 1 e o pnpm do site.
    const depoisDoExec = ['node', '/usr/local/bin/pnpm', '--filter', '@screena/web', 'start']
    expect(resolveHealthTarget({ pid1Args: depoisDoExec, env: {} })).toMatchObject({ url: APP_URL })
  })

  it('toda forma do comando do agendador sonda o /healthz dele', () => {
    for (const form of SCHEDULER_PID1_FORMS) {
      expect(resolveHealthTarget({ pid1Args: form, env: {} }), form.join(' ')).toEqual({
        ok: true,
        service: SCHEDULER_SERVICE,
        via: 'pid1',
        url: SCHEDULER_URL,
        display: SCHEDULER_URL,
      })
    }
  })

  it('CONTROLE NEGATIVO: o ambiente do agendador colado no site NAO desvia a sondagem do site', () => {
    // Uma deteccao por variavel ("so o agendador tem CINERIE_SCHEDULER_APPLY")
    // reprova aqui: o site passaria a ser sondado na 3005, onde nada escuta, e
    // seria substituido em loop.
    const ambienteDoAgendador: Env = {
      CINERIE_SCHEDULER_APPLY: 'true',
      [SCHEDULER_HEALTH_PORT_ENV]: '3005',
      CINERIE_SERVICE_KEY: 'screen-cron',
      TMDB_READ_ACCESS_TOKEN: 'token-de-teste',
    }
    expect(
      resolveHealthTarget({ pid1Args: rootImageCmd(), env: ambienteDoAgendador }),
    ).toMatchObject({
      ok: true,
      service: APP_SERVICE,
      url: APP_URL,
    })
  })

  it('sem /proc legivel o alvo e o do SITE — o comportamento anterior, nunca um alvo mais frouxo', () => {
    expect(resolveHealthTarget({ pid1Args: null, env: {} })).toMatchObject({
      ok: true,
      service: APP_SERVICE,
      via: 'pid1-ilegivel',
      url: APP_URL,
    })
  })

  it('parseProcCmdline separa por NUL e descarta o vazio e o preenchimento', () => {
    expect(
      parseProcCmdline('sh\0-c\0corepack pnpm --filter @screena/sync scheduler:start\0'),
    ).toEqual(['sh', '-c', 'corepack pnpm --filter @screena/sync scheduler:start'])
    expect(parseProcCmdline(Buffer.from('node\0x.mjs\0\0\0'))).toEqual(['node', 'x.mjs'])
    expect(parseProcCmdline(null)).toBeNull()
    expect(parseProcCmdline('')).toBeNull()
    expect(parseProcCmdline('\0\0')).toBeNull()
  })

  it('o script le SO o PID 1: um processo de `docker exec` nunca decide a saude do container', () => {
    // Varrer `/proc` atras de "algum agendador" deixaria um agendador rodado por
    // `exec` DENTRO do screen-app declarar o site saudavel com o Next fora do ar.
    const entry = readSourceWithoutComments('scripts/healthcheck/container-health.mjs')
    expect(entry).toContain("'/proc/1/cmdline'")
    expect(entry).not.toMatch(/readdir/)
    // A decisao nao faz IO: quem le o disco e so o script, e so o PID 1.
    const lib = readSourceWithoutComments('scripts/healthcheck/lib/health-target.mjs')
    expect(lib).not.toMatch(/node:fs|\/proc/)
  })
})

describe('o alvo e o que cada processo SERVE', () => {
  it('os marcadores sao nomes REAIS: o script do pacote e o binario que ele executa', () => {
    const pkg = JSON.parse(readSourceWithoutComments('services/sync/package.json')) as {
      scripts: Record<string, string>
    }
    expect(pkg.scripts['scheduler:start']).toContain('bin/cinerie-scheduler.ts')
    expect(
      existsSync(path.join(REPO_ROOT, 'services', 'sync', 'bin', 'cinerie-scheduler.ts')),
    ).toBe(true)
  })

  it('o default e a rota do agendador sao os que ele serve', () => {
    expect(SCHEDULER_DEFAULT_HEALTH_PORT).toBe(resolveSchedulerConfig({}).healthPort)
    const http = readSourceWithoutComments('services/sync/src/scheduler/runtime/http.ts')
    expect(http).toContain(`route === '${SCHEDULER_HEALTH_PATH}'`)
  })

  it('a porta segue a MESMA regra de resolveSchedulerConfig: aceita e recusa os mesmos valores', () => {
    const valores = [undefined, '', '   ', '3005', '4105', ' 3006 ', '1', '65535', '3e3']
    const invalidos = ['0', '65536', '12.5', 'abc', '-1']
    for (const raw of [...valores, ...invalidos]) {
      const env: Env = { [SCHEDULER_HEALTH_PORT_ENV]: raw }
      let esperado: number | null
      try {
        esperado = resolveSchedulerConfig(env).healthPort
      } catch {
        esperado = null
      }
      const target = resolveHealthTarget({ pid1Args: SCHEDULER_PID1_FORMS[0], env })
      if (esperado === null) {
        expect(target.ok, `valor ${String(raw)}`).toBe(false)
        expect(target.service).toBe(SCHEDULER_SERVICE)
      } else {
        expect(target.url, `valor ${String(raw)}`).toBe(
          `http://127.0.0.1:${String(esperado)}${SCHEDULER_HEALTH_PATH}`,
        )
      }
    }
    // O controle da propria comparacao: os invalidos sao mesmo recusados.
    for (const raw of invalidos) {
      expect(() => resolveSchedulerConfig({ [SCHEDULER_HEALTH_PORT_ENV]: raw })).toThrow()
    }
  })

  it('o alvo do site e a rota que o Next serve, na porta que a imagem expoe', () => {
    expect(
      existsSync(path.join(REPO_ROOT, 'apps', 'web', 'app', 'api', 'health', 'route.ts')),
    ).toBe(true)
    const dockerfile = readSourceWithoutComments('Dockerfile')
    expect(dockerfile).toMatch(new RegExp(`^EXPOSE ${String(APP_HEALTH_PORT)}\\s*$`, 'm'))
    // `next start` le PORT; a imagem nao o define, entao o site escuta a 3000.
    expect(dockerfile).not.toMatch(/\bPORT=/)
  })
})

describe('CINERIE_HEALTHCHECK_URL — a saida explicita', () => {
  it('vence a deteccao e aceita loopback http', () => {
    for (const url of [
      'http://127.0.0.1:4000/healthz',
      'http://localhost:4000/',
      'http://[::1]:4000/vivo',
    ]) {
      const target = resolveHealthTarget({
        pid1Args: SCHEDULER_PID1_FORMS[0],
        env: { [HEALTHCHECK_URL_ENV]: url },
      })
      expect(target, url).toMatchObject({ ok: true, via: 'override', service: HEALTHCHECK_URL_ENV })
    }
  })

  it('recusa outro host, https, credencial e lixo — sem repetir o valor na mensagem', () => {
    const casos = [
      'http://10.0.0.5:3000/healthz',
      'http://example.com/healthz',
      'https://127.0.0.1/healthz',
      'http://usuario:senha-secreta@127.0.0.1:4000/healthz',
      'nao-e-url',
    ]
    for (const raw of casos) {
      const target = resolveHealthTarget({ pid1Args: null, env: { [HEALTHCHECK_URL_ENV]: raw } })
      expect(target.ok, raw).toBe(false)
      expect(target.error).not.toContain('senha-secreta')
      expect(target.error).not.toContain('example.com')
      expect(target.error).not.toContain('10.0.0.5')
    }
  })

  it('a query nunca vai para a linha do log de saude', () => {
    const target = resolveHealthTarget({
      pid1Args: null,
      env: { [HEALTHCHECK_URL_ENV]: 'http://127.0.0.1:4000/healthz?token=abc' },
    })
    expect(target.display).toBe('http://127.0.0.1:4000/healthz')
  })

  it('vazio nao conta como presente', () => {
    expect(
      resolveHealthTarget({ pid1Args: null, env: { [HEALTHCHECK_URL_ENV]: '  ' } }),
    ).toMatchObject({
      service: APP_SERVICE,
    })
  })
})

describe('a sondagem: so 200 do processo certo e saudavel', () => {
  const servers: Server[] = []

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.closeAllConnections()
            server.close(() => resolve())
          }),
      ),
    )
  })

  async function serve(
    handler: (req: IncomingMessage, res: ServerResponse) => void,
  ): Promise<number> {
    const server = createServer(handler)
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    return (server.address() as AddressInfo).port
  }

  async function closedPort(): Promise<number> {
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    await new Promise<void>((resolve) => server.close(() => resolve()))
    return port
  }

  function probeScheduler(port: number, timeoutMs?: number) {
    return runHealthcheck({
      readPid1Cmdline: () => 'sh\0-c\0corepack pnpm --filter @screena/sync scheduler:start\0',
      env: { [SCHEDULER_HEALTH_PORT_ENV]: String(port) },
      fetch,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    })
  }

  it('200 no /healthz do agendador => saudavel, e a linha diz quem, como e onde', async () => {
    const vistos: string[] = []
    const port = await serve((req, res) => {
      vistos.push(req.url ?? '')
      res.writeHead(200).end('{"status":"ok"}')
    })
    expect(await probeScheduler(port)).toEqual({
      code: 0,
      line: `healthy screen-cron (pid1) http://127.0.0.1:${String(port)}/healthz -> HTTP 200`,
    })
    expect(vistos).toEqual(['/healthz'])
  })

  it('503 (agendador drenando) => nao saudavel', async () => {
    const port = await serve((_req, res) => res.writeHead(503).end())
    expect(await probeScheduler(port)).toMatchObject({
      code: 1,
      line: expect.stringContaining('HTTP 503'),
    })
  })

  it('redirect NAO e seguido: 3xx nao prova que ESTE processo esta vivo', async () => {
    const port = await serve((req, res) => {
      if (req.url === '/healthz') res.writeHead(308, { location: '/vivo' }).end()
      else res.writeHead(200).end()
    })
    expect(await probeScheduler(port)).toMatchObject({
      code: 1,
      line: expect.stringContaining('HTTP 308'),
    })
  })

  it('porta fechada (o defeito original: ninguem escuta ali) => nao saudavel', async () => {
    const port = await closedPort()
    expect(await probeScheduler(port)).toMatchObject({
      code: 1,
      line: expect.stringContaining('ECONNREFUSED'),
    })
  })

  it('processo que aceita e nao responde => nao saudavel dentro do prazo do script', async () => {
    const port = await serve(() => undefined)
    expect(await probeScheduler(port, 150)).toMatchObject({
      code: 1,
      line: expect.stringContaining('sem resposta em 150 ms'),
    })
  })

  it('/proc ilegivel => sonda o site, e a linha diz que o PID 1 nao foi lido', async () => {
    const urls: string[] = []
    const result = await runHealthcheck({
      readPid1Cmdline: () => {
        throw new Error('ENOENT: /proc/1/cmdline')
      },
      env: {},
      fetch: async (url: string) => {
        urls.push(url)
        return { status: 200, body: null }
      },
    })
    expect(urls).toEqual([APP_URL])
    expect(result).toEqual({
      code: 0,
      line: `healthy screen-app (pid1-ilegivel) ${APP_URL} -> HTTP 200`,
    })
  })

  it('porta invalida do agendador => nao saudavel SEM sondar nada', async () => {
    let chamadas = 0
    const result = await runHealthcheck({
      readPid1Cmdline: () => 'sh\0-c\0corepack pnpm --filter @screena/sync scheduler:start\0',
      env: { [SCHEDULER_HEALTH_PORT_ENV]: 'tres mil' },
      fetch: async () => {
        chamadas += 1
        return { status: 200, body: null }
      },
    })
    expect(chamadas).toBe(0)
    expect(result.code).toBe(1)
    expect(result.line).toContain(SCHEDULER_HEALTH_PORT_ENV)
    expect(result.line).not.toContain('tres mil')
  })

  it('falha de rede vira CODIGO, nunca a mensagem crua', async () => {
    const result = await runHealthcheck({
      readPid1Cmdline: () => null,
      env: {},
      fetch: async () => {
        throw new TypeError('fetch failed postgresql://u:segredo@db/x', {
          cause: { code: 'ECONNRESET' },
        })
      },
    })
    expect(result.code).toBe(1)
    expect(result.line).toContain('ECONNRESET')
    expect(result.line).not.toContain('segredo')
  })

  describe('o script de verdade: codigo de saida e linha em stdout', () => {
    function runEntry(extraEnv: Env): Promise<{ code: number | null; stdout: string }> {
      return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [ENTRY], {
          env: { ...process.env, ...extraEnv },
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        let stdout = ''
        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString('utf8')
        })
        child.on('error', reject)
        child.on('close', (code) => resolve({ code, stdout }))
      })
    }

    it('sai 0 com 200 e 1 com a porta fechada', async () => {
      const port = await serve((_req, res) => res.writeHead(200).end())
      const vivo = await runEntry({
        [HEALTHCHECK_URL_ENV]: `http://127.0.0.1:${String(port)}/healthz`,
      })
      expect(vivo.code).toBe(0)
      expect(vivo.stdout).toBe(
        `healthy ${HEALTHCHECK_URL_ENV} (override) http://127.0.0.1:${String(port)}/healthz -> HTTP 200\n`,
      )

      const fechada = await closedPort()
      const morto = await runEntry({
        [HEALTHCHECK_URL_ENV]: `http://127.0.0.1:${String(fechada)}/healthz`,
      })
      expect(morto.code).toBe(1)
      expect(morto.stdout).toContain('ECONNREFUSED')
    })

    it('sai 1 com URL explicita fora do loopback, sem sondar', async () => {
      const result = await runEntry({ [HEALTHCHECK_URL_ENV]: 'http://example.com/healthz' })
      expect(result.code).toBe(1)
      expect(result.stdout).toContain('loopback')
    })
  })
})

/** As linhas HEALTHCHECK de um Dockerfile JA SEM comentarios, com as continuacoes juntadas. */
function healthcheckLines(dockerfile: string): string[] {
  return dockerfile
    .replace(/\\\r?\n/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^HEALTHCHECK\b/.test(line))
}

/**
 * O defeito, generalizado: a porta sondada e a porta que a imagem declara?
 *
 * PURA, para ter controle negativo — um detector que so roda sobre os arquivos
 * do repositorio nao tem como ser provado errado. Devolve o problema, ou `null`.
 */
function healthcheckPortProblem(dockerfile: string): string | null {
  const checks = healthcheckLines(dockerfile)
  if (checks.length !== 1) return `esperado 1 HEALTHCHECK, achados ${String(checks.length)}`
  const probed = /127\.0\.0\.1:(\d+)/.exec(checks[0] as string)
  if (probed === null) return 'HEALTHCHECK sem porta de loopback explicita'
  const port = probed[1] as string

  const lines = dockerfile.replace(/\\\r?\n/g, ' ').split(/\r?\n/)
  const declared = new Set<string>()
  const exposed = new Set<string>()
  for (const line of lines) {
    if (/^\s*ENV\s/.test(line)) {
      for (const match of line.matchAll(/\b[A-Z0-9_]*PORT=(\d+)/g)) declared.add(match[1] as string)
    }
    const expose = /^\s*EXPOSE\s+(\d+)/.exec(line)
    if (expose !== null) exposed.add(expose[1] as string)
  }
  if (!declared.has(port)) return `HEALTHCHECK sonda a ${port}, que nenhum ENV de porta declara`
  if (!exposed.has(port)) return `HEALTHCHECK sonda a ${port}, que a imagem nao expoe`
  return null
}

describe('toda imagem sonda a porta que ela mesma declara', () => {
  it('a raiz roda DOIS servicos e sonda pelo script, nunca por URL fixa', () => {
    const dockerfile = readSourceWithoutComments('Dockerfile')
    expect(dockerfile).toMatch(/^WORKDIR \/app\s*$/m)
    const checks = healthcheckLines(dockerfile)
    expect(checks).toHaveLength(1)
    expect(checks[0]).toMatch(/\bCMD node \/app\/scripts\/healthcheck\/container-health\.mjs$/)
    expect(checks[0]).not.toMatch(/127\.0\.0\.1|localhost|fetch\(/)
    expect(existsSync(ENTRY)).toBe(true)
  })

  it('o script entra na imagem: o .dockerignore nao exclui scripts/', () => {
    const padroes = readSourceWithoutComments('.dockerignore')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'))
    expect(padroes.length).toBeGreaterThan(0)
    for (const padrao of padroes) {
      const semBarra = padrao.replace(/^\/+/, '')
      expect(semBarra.startsWith('scripts'), padrao).toBe(false)
      expect(padrao.includes('healthcheck'), padrao).toBe(false)
      expect(['*', '**', '*.mjs', '**/*.mjs'].includes(padrao), padrao).toBe(false)
    }
  })

  it('as imagens de servico unico: HEALTHCHECK, ENV da porta e EXPOSE batem', () => {
    const imagens = readdirSync(REPO_ROOT)
      .filter((name) => /^Dockerfile\..+$/.test(name))
      .sort()
    expect(imagens).toEqual(
      expect.arrayContaining([
        'Dockerfile.admin',
        'Dockerfile.catalog-worker',
        'Dockerfile.cms',
        'Dockerfile.publication-worker',
      ]),
    )
    for (const imagem of imagens) {
      expect(healthcheckPortProblem(readSourceWithoutComments(imagem)), imagem).toBeNull()
    }
  })

  it('CONTROLE NEGATIVO: o detector reprova porta divergente, porta sem ENV e porta nao exposta', () => {
    const imagem = (sondada: string, env: string, expose: string): string =>
      [
        'FROM node',
        `ENV ${env}`,
        `EXPOSE ${expose}`,
        'HEALTHCHECK --interval=30s \\',
        `  CMD node -e "fetch('http://127.0.0.1:${sondada}/healthz')"`,
        '',
      ].join('\n')
    expect(healthcheckPortProblem(imagem('3004', 'X_HEALTH_PORT=3004', '3004'))).toBeNull()
    // O defeito do screen-cron, em miniatura: sonda uma porta, serve outra.
    expect(healthcheckPortProblem(imagem('3000', 'X_HEALTH_PORT=3004', '3004'))).toContain('3000')
    expect(healthcheckPortProblem(imagem('3004', 'NODE_ENV=production', '3004'))).toContain('ENV')
    expect(healthcheckPortProblem(imagem('3004', 'X_HEALTH_PORT=3004', '3000'))).toContain('expoe')
    // Comentario nao vale como HEALTHCHECK: a porta unica de leitura entrega o
    // Dockerfile SEM comentario, e um HEALTHCHECK so citado em comentario some.
    const soNoComentario = stripComments(
      `# HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:3004/healthz')"\nFROM node\n`,
      commentSyntaxFor('Dockerfile'),
    )
    expect(healthcheckPortProblem(soNoComentario)).toContain('achados 0')
  })
})
