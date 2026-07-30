/**
 * ephemeral-postgres.ts — Sobe um PostgreSQL 16 DESCARTAVEL e roda um comando do
 * Payload contra ele.
 *
 * Existe para que `migrate:create`/`migrate` nunca precisem de um banco real. O
 * alvo e criado, usado e destruido no `finally`; a URL vive so em memoria e
 * nunca e impressa. `DATABASE_URL` do ambiente e REMOVIDA do processo filho —
 * o CMS nao pode nem por acidente enxergar o banco publico.
 *
 * Uso: tsx scripts/ephemeral-postgres.ts <comando payload...>
 *   ex.: tsx scripts/ephemeral-postgres.ts migrate:create initial
 */

import { spawnSync } from 'node:child_process'
import net from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import EmbeddedPostgres from 'embedded-postgres'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const cmsDir = path.resolve(scriptDir, '..')

/** Porta livre: evita colidir com outro Postgres na maquina do dev. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    throw new Error('informe o comando do payload (ex.: migrate:create initial)')
  }

  const port = await freePort()
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cinerie-cms-pg-'))
  const database = 'cinerie_cms_ephemeral'

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
  })

  console.log(`[cms] PostgreSQL 16 efemero em 127.0.0.1:${port} (descartavel)`)

  try {
    await pg.initialise()
    await pg.start()
    await pg.createDatabase(database)

    // A URL nunca e impressa: ela e montada aqui e passada so ao filho.
    const url = `postgresql://postgres:postgres@127.0.0.1:${port}/${database}`

    // `DATABASE_URL` sai do ambiente do filho de proposito. Se algum dia o CMS
    // ganhar um fallback por descuido, este teste deixa de mascarar o erro.
    const childEnv = { ...process.env }
    delete childEnv.DATABASE_URL
    childEnv.PAYLOAD_DATABASE_URL = url
    childEnv.PAYLOAD_SECRET = 'ephemeral-secret-for-migrations-only-0123456789'
    // Storage EXPLICITO: desde a FASE 2E o CMS recusa subir sem driver
    // declarado, e essa recusa e o comportamento desejado. O script declara em
    // vez de o codigo adivinhar. O diretorio e descartavel como o banco.
    childEnv.PAYLOAD_UPLOAD_STORAGE_DRIVER = 'local'
    childEnv.PAYLOAD_UPLOAD_LOCAL_ROOT = path.join(dataDir, 'uploads')
    childEnv.PAYLOAD_CONFIG_PATH = path.join(cmsDir, 'src', 'payload.config.ts')
    childEnv.NODE_OPTIONS = `${childEnv.NODE_OPTIONS ?? ''} --no-deprecation`.trim()

    // O proprio `bin.js` do Payload cuida da transpilacao do config TypeScript;
    // por isso nao injetamos loader aqui.
    const result = spawnSync('node', [
      '--no-warnings',
      path.join(cmsDir, 'node_modules', 'payload', 'bin.js'),
      ...args,
    ], {
      cwd: cmsDir,
      env: childEnv,
      stdio: 'inherit',
      shell: false,
    })

    if (result.status !== 0) {
      throw new Error(`comando do payload falhou (exit ${String(result.status)})`)
    }
    console.log('[cms] comando concluido com sucesso')
  } finally {
    try {
      await pg.stop()
    } catch {
      /* o processo ja pode ter morrido; nao ha o que salvar aqui */
    }
    // No Windows o Postgres ainda segura handles por alguns instantes depois do
    // stop, e o `rm` falha com EPERM. Isso e limpeza, nao resultado: nao pode
    // derrubar um comando que ja concluiu. Tentamos algumas vezes e, se ainda
    // assim falhar, avisamos o caminho para limpeza manual.
    let removed = false
    for (let attempt = 0; attempt < 5 && !removed; attempt += 1) {
      try {
        rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
        removed = true
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 400))
      }
    }
    console.log(
      removed
        ? '[cms] PostgreSQL efemero derrubado e diretorio removido'
        : `[cms] PostgreSQL efemero derrubado; diretorio temporario ficou para tras: ${dataDir}`,
    )
  }
}

main().catch((error: unknown) => {
  console.error('[cms]', error instanceof Error ? error.message : 'falha desconhecida')
  process.exit(1)
})
