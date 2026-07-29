/**
 * harness.ts — Sobe o CMS REAL (Next + Payload) sobre PostgreSQL 16 efemero.
 *
 * POR QUE HTTP DE VERDADE, E NAO `payload.auth` + `req` montado a mao.
 * A primeira versao deste harness construia um `PayloadRequest` manualmente e
 * chamava o handler do endpoint direto. Isso escondia dois defeitos ao mesmo
 * tempo: o `req` sintetico nao carregava `transactionID`, e cada
 * `payload.auth()` abria uma transacao que ninguem encerrava — o pool esgotava e
 * o erro que aparecia era `Connection terminated unexpectedly`, que nao diz nada
 * sobre a causa. Um teste que monta o proprio `req` nao consegue provar que o
 * `req` de producao esta certo.
 *
 * Agora: `next build` + `next start` numa porta livre, e as asercoes vao por
 * `fetch`. A requisicao atravessa servidor Next real, route handler real,
 * autenticacao real do Payload e o endpoint real.
 *
 * A Local API continua sendo usada — SO para montar fixtures (usuarios, autores,
 * midia). Setup nao e a coisa sob teste; o caminho sob teste e o HTTP.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import net from 'node:net'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import EmbeddedPostgres from 'embedded-postgres'
import type { Payload } from 'payload'

import {
  evaluateBuildFreshness,
  serializeSourceStamps,
  skipBuildAllowed,
  type SourceFileStamp,
} from '../build-fingerprint.js'

const cmsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Carimbos de todos os `.ts`/`.tsx` do fonte do CMS, recursivamente. */
function collectSourceStamps(root: string): SourceFileStamp[] {
  const stamps: SourceFileStamp[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue
      const stat = statSync(full)
      stamps.push({ path: path.relative(root, full), mtimeMs: stat.mtimeMs, size: stat.size })
    }
  }
  walk(root)
  return stamps
}

function readFingerprint(file: string): string | null {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

export interface CmsHarness {
  /** Saida acumulada do servidor. Diagnostico de falha DEPOIS do boot. */
  serverLog(): string
  /** Local API — SO para fixtures e para inspecionar o banco nas asercoes. */
  readonly payload: Payload
  /** Base do servidor HTTP real (ex.: `http://127.0.0.1:3456`). */
  readonly baseUrl: string
  stop(): Promise<void>
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, () => {
      const address = server.address()
      resolve(typeof address === 'object' && address !== null ? address.port : 0)
    })
  })
}

/** Espera o servidor responder. Falha com mensagem util em vez de travar. */
async function waitForServer(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError = 'sem resposta'
  while (Date.now() < deadline) {
    try {
      // Sonda uma rota INEXISTENTE de proposito: o Next responde 404 sem tocar
      // o Payload nem o banco. Sondar `/api/service-accounts/me` misturava duas
      // perguntas — "o servidor atende?" e "o banco responde?" — e um banco
      // lento aparecia como servidor morto (UND_ERR_HEADERS_TIMEOUT).
      // `AbortSignal` evita ficar preso no timeout de headers do undici.
      const response = await fetch(`${baseUrl}/__cms_readiness__`, {
        signal: AbortSignal.timeout(5_000),
      })
      if (response.status > 0) return
    } catch (error) {
      // `fetch failed` do undici e um wrapper generico: a razao real (ECONNREFUSED,
      // ENOTFOUND, EAI_AGAIN...) mora em `cause`. Sem isso o diagnostico para aqui.
      if (error instanceof Error) {
        const cause = error.cause as { message?: string; code?: string } | undefined
        lastError = `${error.message}${
          cause === undefined ? '' : ` | cause: ${cause.message ?? ''} (${cause.code ?? 'sem code'})`
        }`
      } else {
        lastError = 'erro desconhecido'
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`servidor do CMS nao respondeu em ${String(timeoutMs)}ms: ${lastError}`)
}

export async function startCmsHarness(): Promise<CmsHarness> {
  const pgPort = await freePort()
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cinerie-cms-it-'))
  const database = 'cinerie_cms_integration'

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port: pgPort,
    persistent: false,
  })

  await pg.initialise()
  await pg.start()
  await pg.createDatabase(database)

  // `DATABASE_URL` sai do ambiente: se um fallback aparecer por descuido no
  // codigo do CMS, o teste falha em vez de mascarar.
  delete process.env.DATABASE_URL
  const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${String(pgPort)}/${database}`
  process.env.PAYLOAD_DATABASE_URL = databaseUrl
  process.env.PAYLOAD_SECRET = 'integration-secret-0123456789abcdefghijklmno'

  const childEnv: NodeJS.ProcessEnv = { ...process.env }
  delete childEnv.DATABASE_URL
  childEnv.PAYLOAD_DATABASE_URL = databaseUrl
  childEnv.PAYLOAD_CONFIG_PATH = path.join(cmsDir, 'src', 'payload.config.ts')

  // Storage de upload EXPLICITO. Desde a FASE 2E nao ha default: o CMS recusa
  // subir sem driver declarado, e essa recusa e o comportamento desejado — o
  // harness declara em vez de o codigo adivinhar.
  //
  // Caminho ABSOLUTO e proprio deste run: o `staticDir` resolve contra ele, e
  // dois harnesses simultaneos nao disputam o mesmo diretorio.
  const uploadRoot = mkdtempSync(path.join(tmpdir(), 'cinerie-cms-uploads-'))
  childEnv.PAYLOAD_UPLOAD_STORAGE_DRIVER = 'local'
  childEnv.PAYLOAD_UPLOAD_LOCAL_ROOT = uploadRoot
  // `next start` roda com `NODE_ENV=production`, e la o driver local exige a
  // confirmacao de persistencia. Aqui a declaracao e VERDADEIRA: o diretorio
  // temporario sobrevive por toda a vida do teste, que e o unico horizonte que
  // importa. Nao e um contorno da regra — e a regra sendo respondida.
  childEnv.PAYLOAD_UPLOAD_LOCAL_PERSISTENT_CONFIRMED = 'true'
  // O processo de TESTE tambem grava pela Local API: sem isto ele depositaria
  // os arquivos noutro diretorio e o servidor responderia 404 (o defeito da
  // FASE 2D, agora impossivel de repetir em silencio).
  process.env.PAYLOAD_UPLOAD_STORAGE_DRIVER = 'local'
  process.env.PAYLOAD_UPLOAD_LOCAL_ROOT = uploadRoot
  process.env.PAYLOAD_UPLOAD_LOCAL_PERSISTENT_CONFIRMED = 'true'

  // Migrations REAIS pelo CLI REAL. Nao usamos `payload.db.migrate()` porque o
  // arquivo gerado importa `MigrateUpArgs`/`MigrateDownArgs` como named imports
  // e esses tipos nao existem em runtime sob o loader do vitest.
  const migration = spawnSync(
    'node',
    ['--no-warnings', path.join(cmsDir, 'node_modules', 'payload', 'bin.js'), 'migrate'],
    { cwd: cmsDir, env: childEnv, stdio: 'pipe', shell: false },
  )
  if (migration.status !== 0) {
    throw new Error(
      `migrations do CMS falharam (exit ${String(migration.status)}): ${migration.stderr?.toString() ?? ''}`,
    )
  }

  const nextBin = path.join(cmsDir, 'node_modules', 'next', 'dist', 'bin', 'next')
  const fingerprintFile = path.join(cmsDir, '.next', 'cms-it-source-fingerprint.txt')
  // O fingerprint cobre `src/` E `app/`. Cobrir so `src/` era uma LACUNA real:
  // adicionar uma rota em `app/` (foi o caso de `/healthz` e `/readyz`) nao
  // invalidava o carimbo, e o atalho de build rodava a suite contra um build sem
  // aquelas rotas — o sintoma era um 404 em HTML no lugar de JSON.
  const currentFingerprint = serializeSourceStamps([
    ...collectSourceStamps(path.join(cmsDir, 'src')),
    ...collectSourceStamps(path.join(cmsDir, 'app')).map((stamp) => ({
      ...stamp,
      path: `app/${stamp.path}`,
    })),
  ])

  // Build de producao: a MESMA pipeline que rodaria no servico implantado.
  //
  // `CMS_IT_SKIP_BUILD=1` pula o build para iterar localmente — mas SO se o
  // fonte nao mudou desde o build carimbado. Sem essa trava o atalho mente em
  // silencio: a suite roda contra codigo antigo, passa, e a correcao recem
  // escrita nunca chega a ser exercitada (aconteceu na FASE 2B). Em CI o atalho
  // e ignorado por completo.
  let skipped = false
  if (skipBuildAllowed(process.env)) {
    const recorded = readFingerprint(fingerprintFile)
    const freshness = evaluateBuildFreshness(recorded, currentFingerprint)
    if (freshness.fresh) {
      skipped = true
      console.warn('[cms-it] build pulado: fonte inalterado desde o ultimo build')
    } else {
      console.warn(
        `[cms-it] CMS_IT_SKIP_BUILD ignorado (${freshness.reason}): reconstruindo`,
      )
    }
  }

  if (!skipped) {
    const build = spawnSync('node', [nextBin, 'build'], {
      cwd: cmsDir,
      env: childEnv,
      stdio: 'pipe',
      shell: false,
    })
    if (build.status !== 0) {
      throw new Error(
        `build do CMS falhou (exit ${String(build.status)}): ${build.stdout?.toString().slice(-3000) ?? ''}`,
      )
    }
    // Carimbo gravado SO apos build bem-sucedido: um build que falhou nao pode
    // autorizar o atalho da proxima rodada.
    try {
      writeFileSync(fingerprintFile, currentFingerprint, 'utf8')
    } catch {
      /* sem carimbo, a proxima rodada simplesmente reconstroi */
    }
  }

  // A porta e alocada AGORA, imediatamente antes de ligar o servidor.
  // Alocar antes do build significaria segurar um numero por varios minutos ate
  // tentar bindar — tempo de sobra para outro processo tomar a porta, e o
  // sintoma seria um `EADDRINUSE` invisivel virando "fetch failed" no
  // `waitForServer`. Foi exatamente esse o defeito da primeira versao.
  const httpPort = await freePort()
  const baseUrl = `http://127.0.0.1:${String(httpPort)}`

  // `next start` roda com o config JA COMPILADO no build. Deixar
  // `PAYLOAD_CONFIG_PATH` apontando para o `.ts` faz o servidor de producao
  // tentar carregar TypeScript em runtime.
  const serverEnv: NodeJS.ProcessEnv = {
    ...childEnv,
    NODE_ENV: 'production',
    PAYLOAD_PUBLIC_SERVER_URL: baseUrl,
  }
  delete serverEnv.PAYLOAD_CONFIG_PATH

  const server: ChildProcess = spawn(
    'node',
    [nextBin, 'start', '--port', String(httpPort), '--hostname', '127.0.0.1'],
    { cwd: cmsDir, env: serverEnv, stdio: 'pipe', shell: false },
  )

  // A saida do servidor e GUARDADA, nao descartada. Sem isso, uma falha de
  // boot vira apenas "fetch failed" no `waitForServer` — que nao diz nada sobre
  // a causa e foi exatamente o que travou o diagnostico da primeira tentativa.
  let serverLog = ''
  const capture = (chunk: unknown) => {
    serverLog = `${serverLog}${String(chunk)}`.slice(-8_000)
  }
  server.stdout?.on('data', capture)
  server.stderr?.on('data', capture)
  let serverExit: string | null = null
  server.on('exit', (code, signal) => {
    serverExit = `code=${String(code)} signal=${String(signal)}`
  })

  try {
    await waitForServer(baseUrl, 120_000)
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'erro desconhecido'
    throw new Error(
      `${reason}\n[saida do servidor${serverExit === null ? '' : ` — encerrou com ${serverExit}`}]\n${serverLog || '(sem saida)'}`,
    )
  }

  // Local API para FIXTURES. Importada depois do ambiente estar pronto porque o
  // `payload.config.ts` valida a configuracao no topo do modulo.
  const [{ getPayload }, configModule] = await Promise.all([
    import('payload'),
    import('../payload.config.js'),
  ])
  const payload = await getPayload({ config: configModule.default })

  return {
    payload,
    baseUrl,
    // Ate agora a saida do servidor so aparecia quando o BOOT falhava. Um 500
    // depois do boot (config valida, servidor de pe, requisicao quebrando)
    // ficava invisivel — e era exatamente o caso mais dificil de diagnosticar.
    serverLog: () => serverLog,
    async stop() {
      try {
        server.kill()
      } catch {
        /* pode ja ter morrido */
      }
      try {
        await payload.db.destroy?.()
      } catch {
        /* pool pode ja estar fechado */
      }
      try {
        await pg.stop()
      } catch {
        /* idem */
      }
      // No Windows o Postgres segura handles por instantes apos o stop.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
          break
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 400))
        }
      }
    },
  }
}

/** Header de API key no formato exigido pelo Payload: `<slug> API-Key <chave>`. */
export function apiKeyAuthorization(collectionSlug: string, apiKey: string): string {
  return `${collectionSlug} API-Key ${apiKey}`
}
