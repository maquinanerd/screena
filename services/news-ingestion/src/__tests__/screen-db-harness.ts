/**
 * screen-db-harness.ts — PostgreSQL 16 efemero com o schema REAL do banco
 * publico (screen-db), para o teste de integracao da projecao editorial.
 *
 * SEGUNDO banco do teste. O primeiro (Payload) sobe pelo harness do CMS. Sao
 * dois processos Postgres distintos de proposito: a separacao dos bancos e a
 * tese do ADR 0015, e um teste que rodasse os dois lados sobre a mesma base
 * nao provaria nada sobre ela.
 *
 * DESCARTAVEL. Nenhum segredo, URL so em memoria, PG derrubado no `stop()` — e
 * tambem quando o boot falha no meio, pelo MESMO teardown (ver `startScreenDbHarness`).
 */

import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import net from 'node:net'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import EmbeddedPostgres from 'embedded-postgres'
import { PrismaClient } from '@prisma/client'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const dbDir = path.join(repoRoot, 'packages', 'db')
const schemaPath = path.join(dbDir, 'prisma', 'schema.prisma')

export interface ScreenDbHarness {
  readonly prisma: PrismaClient
  /** URL do banco efemero. NAO deve ser impressa em log de teste. */
  readonly url: string
  stop(): Promise<void>
}

/**
 * Reserva um numero de porta livre e DEVOLVE A PORTA DESOCUPADA.
 *
 * O `close` antes do `resolve` nao e higiene — e a correcao de um defeito. A
 * versao anterior resolvia dentro do callback do `listen` e so entao chamava
 * `close()`: quem recebia a porta podia tentar bindar antes de o socket de
 * sondagem ter saido, e o Postgres efemero colidia com o proprio harness.
 * `unref()` nao ajuda — ele tira o handle da contagem do event loop, mas a
 * porta continua ocupada.
 *
 * E o mesmo defeito ja documentado e corrigido em
 * `apps/cms/src/__tests__/harness.ts`; aqui ele havia sobrevivido. O `host`
 * explicito ja estava certo e permanece: sem ele, `listen(0)` binda em `::`
 * cobrindo o par IPv4+IPv6, e no runner Linux o Postgres falhava em `::1` E em
 * `127.0.0.1`.
 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.once('error', reject)
    srv.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0

      // Porta 0 aqui significa que o endereco nao veio como esperado. Devolver
      // esse zero adiante faria o Postgres escolher uma porta que o harness nao
      // conhece, e a falha apareceria longe da causa.
      if (port <= 0) {
        srv.close(() => {
          reject(new Error('nao foi possivel reservar uma porta TCP valida'))
        })
        return
      }

      srv.close((error) => {
        if (error !== undefined) {
          reject(error)
          return
        }
        resolve(port)
      })
    })
  })
}

function prismaBin(): string {
  const pkgPath = require.resolve('prisma/package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { bin: string | Record<string, string> }
  const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.prisma
  if (rel === undefined) throw new Error('binario do prisma nao encontrado')
  return path.join(path.dirname(pkgPath), rel)
}

export async function startScreenDbHarness(): Promise<ScreenDbHarness> {
  const port = await freePort()
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cinerie-screendb-'))
  const database = 'cinerie_projection_it'
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
  })

  await pg.initialise()
  await pg.start()

  // O cliente so nasce no fim do boot, mas o teardown precisa enxerga-lo desde
  // ja: e o MESMO teardown que roda quando o boot falha no meio, e nesse
  // momento ele pode existir ou nao.
  let prisma: PrismaClient | null = null

  /**
   * Desligamento UNICO — usado pelo `stop()` devolvido E pelo caminho de falha.
   *
   * Uma copia so, porque a ORDEM e o que importa. `pg.stop()` executa
   * `pg_ctl stop -m fast`, que manda SIGTERM aos backends: qualquer conexao
   * ainda aberta recebe `57P01 terminating connection due to administrator
   * command`. Desconectar o Prisma ANTES faz as conexoes terminarem por decisao
   * nossa, nao por morte do servidor. Duas copias desta sequencia divergiriam.
   *
   * Cada passo e isolado: falhar ao desconectar nao pode impedir derrubar o
   * banco, e falhar ao derrubar o banco nao pode impedir remover o `dataDir`.
   */
  const teardown = async (): Promise<void> => {
    try {
      await prisma?.$disconnect()
    } catch {
      /* pode ja estar desconectado */
    }
    try {
      await pg.stop()
    } catch {
      /* o processo pode ja ter morrido */
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        rmSync(dataDir, { recursive: true, force: true })
        return
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 300))
      }
    }
  }

  try {
    await pg.createDatabase(database)
    const url = `postgresql://postgres:postgres@127.0.0.1:${String(port)}/${database}`

    // Migration REAL, nao SQL sintetico: o teste tem que falhar se a migration
    // que vai para producao estiver errada.
    const env = { ...process.env, DATABASE_URL: url }
    execFileSync('node', [prismaBin(), 'migrate', 'deploy', '--schema', schemaPath], {
      env,
      stdio: 'pipe',
      cwd: dbDir,
    })
    // O seed traz `languages` (pt-BR/en/es), sem o qual a FK da traducao recusa.
    execFileSync('node', [prismaBin(), 'db', 'seed', '--schema', schemaPath], {
      env,
      stdio: 'pipe',
      cwd: dbDir,
    })

    const client = new PrismaClient({ datasources: { db: { url } } })
    prisma = client

    return { prisma: client, url, stop: teardown }
  } catch (error) {
    // Sem este teardown o `stop()` nunca chega ao chamador e o cluster efemero
    // fica de pe. Quem o derruba entao e o gancho de saida do proprio
    // `embedded-postgres` — DEPOIS que o ambiente de teste ja foi desmontado. O
    // `57P01` resultante chega ao vitest como excecao NAO TRATADA e esconde o
    // erro real (migration quebrada, seed falhando) atras de um sintoma de banco.
    await teardown()
    throw error
  }
}
