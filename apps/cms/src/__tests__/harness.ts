/**
 * harness.ts — Sobe Payload REAL sobre PostgreSQL 16 efemero.
 *
 * Nao e um mock. A suite que usa este harness exercita a configuracao real de
 * `apps/cms`: migrations reais, collections reais, hooks reais, access control
 * real e autenticacao real por API key. E por isso que ela consegue provar o que
 * os testes puros nao conseguiam — que o codigo esta LIGADO.
 *
 * `DATABASE_URL` e removida do processo antes de qualquer import do Payload: se
 * um fallback aparecer por descuido, o teste falha em vez de mascarar.
 */

import { spawnSync } from 'node:child_process'
import net from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import EmbeddedPostgres from 'embedded-postgres'
import type { Payload } from 'payload'

const cmsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export interface CmsHarness {
  readonly payload: Payload
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

/**
 * Inicializa o CMS contra um banco descartavel.
 *
 * O import do `payload.config.js` acontece DEPOIS de configurar o ambiente
 * porque o config chama `requireCmsConfig()` no topo do modulo — importar antes
 * derrubaria o processo com "configuracao invalida", que e exatamente o
 * comportamento desejado em producao.
 */
export async function startCmsHarness(): Promise<CmsHarness> {
  const port = await freePort()
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cinerie-cms-it-'))
  const database = 'cinerie_cms_integration'

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
  })

  await pg.initialise()
  await pg.start()
  await pg.createDatabase(database)

  delete process.env.DATABASE_URL
  process.env.PAYLOAD_DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/${database}`
  process.env.PAYLOAD_SECRET = 'integration-secret-0123456789abcdefghijklmno'
  process.env.PAYLOAD_PUBLIC_SERVER_URL = `http://127.0.0.1:${String(port)}`

  // Migrations REAIS, aplicadas pelo CLI REAL do Payload, em processo filho.
  //
  // Nao usamos `payload.db.migrate()` in-process de proposito: o arquivo de
  // migration GERADO importa `MigrateUpArgs`/`MigrateDownArgs` como named
  // imports, e sob o loader do vitest esses tipos nao existem em runtime — o
  // import quebra. O `bin.js` do Payload transpila do jeito certo. Como bonus,
  // este e literalmente o mesmo caminho que roda em producao.
  const migration = spawnSync(
    'node',
    ['--no-warnings', path.join(cmsDir, 'node_modules', 'payload', 'bin.js'), 'migrate'],
    {
      cwd: cmsDir,
      env: {
        ...process.env,
        PAYLOAD_CONFIG_PATH: path.join(cmsDir, 'src', 'payload.config.ts'),
      },
      stdio: 'pipe',
      shell: false,
    },
  )
  if (migration.status !== 0) {
    throw new Error(
      `migrations do CMS falharam (exit ${String(migration.status)}): ${migration.stderr?.toString() ?? ''}`,
    )
  }

  const [{ getPayload }, configModule] = await Promise.all([
    import('payload'),
    import('../payload.config.js'),
  ])

  const payload = await getPayload({ config: configModule.default })

  return {
    payload,
    async stop() {
      try {
        await payload.db.destroy?.()
      } catch {
        /* o pool pode ja ter sido fechado */
      }
      try {
        await pg.stop()
      } catch {
        /* idem */
      }
      // No Windows o Postgres segura handles por alguns instantes apos o stop.
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

/** Header de API key no formato exigido pelo Payload. */
export function apiKeyHeaders(collectionSlug: string, apiKey: string): Headers {
  return new Headers({
    Authorization: `${collectionSlug} API-Key ${apiKey}`,
    'content-type': 'application/json',
  })
}
