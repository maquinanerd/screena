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
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
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
import {
  decideMigrationOutcome,
  describeDatabaseFailure,
  describeSchemaDiagnosis,
  diagnoseSchema,
  isDatabaseGoneError,
  type SchemaExpectation,
  type SchemaProbe,
} from './harness-diagnostics.js'

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

/**
 * Reserva um numero de porta livre e DEVOLVE A PORTA DESOCUPADA.
 *
 * O `close` antes do `resolve` nao e detalhe de higiene — e a correcao do
 * defeito. A primeira versao resolvia dentro do callback do `listen`, deixando
 * o socket de sondagem bound pelo resto do processo de teste. `unref()` so tira
 * o handle da contagem do event loop; a porta continua ocupada. Quem tentasse
 * bindar depois — o Postgres efemero e o `next start` — colidia com o proprio
 * harness.
 *
 * No Windows o sintoma nao aparecia; no runner Linux o `listen(0)` sem host
 * binda em `::` cobrindo o par IPv4+IPv6, e o Postgres falhava em `::1` E em
 * `127.0.0.1` ("could not create any TCP/IP sockets"). Por isso o bind agora e
 * explicito em `127.0.0.1`: sonda exatamente a interface que os servidores vao
 * usar, sem depender do comportamento dual-stack do sistema.
 */
/**
 * Diretorio-base dos uploads de teste, DENTRO da arvore do CMS.
 *
 * Nao pode ser `tmpdir()`. O harness sobe o `next start` com
 * `NODE_ENV=production`, e em production a guarda de storage
 * (`upload-storage-config.ts`) recusa raiz em filesystem efemero conhecido —
 * `/tmp/` entre eles. No Linux `tmpdir()` E `/tmp`, entao o CMS se recusava a
 * subir e toda requisicao virava 500; no Windows `tmpdir()` cai em
 * `AppData/Local/Temp`, que nao casa com nenhum prefixo da lista, e o defeito
 * ficava invisivel.
 *
 * A guarda esta CERTA: apontar uploads de producao para `/tmp` e um erro que so
 * aparece semanas depois. Quem estava errado era o harness. Aqui o caminho e
 * absoluto, persiste por todo o horizonte do teste e esta coberto pelo
 * `.gitignore` (`apps/cms/media/`), entao a declaracao de persistencia
 * continua sendo verdade, nao contorno.
 */
const uploadsBaseDir = path.join(cmsDir, 'media')

function createUploadRoot(): string {
  mkdirSync(uploadsBaseDir, { recursive: true })
  return mkdtempSync(path.join(uploadsBaseDir, 'integration-'))
}

/**
 * Remove SO a pasta exclusiva deste run — nunca a base compartilhada, que pode
 * guardar midia de outro harness rodando em paralelo ou de uso local.
 */
function removeUploadRoot(uploadRoot: string): void {
  try {
    rmSync(uploadRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch {
    // No Windows um handle preso por instantes nao pode transformar teste verde
    // em vermelho. A pasta e descartavel e esta fora do Git.
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0

      // Porta 0 aqui significa que o endereco nao veio como esperado. Devolver
      // esse zero adiante faria o Postgres escolher uma porta que o harness nao
      // conhece, e a falha apareceria longe da causa.
      if (port <= 0) {
        server.close(() => {
          reject(new Error('nao foi possivel reservar uma porta TCP valida'))
        })
        return
      }

      server.close((error) => {
        if (error !== undefined) {
          reject(error)
          return
        }
        resolve(port)
      })
    })
  })
}

/**
 * Sonda o banco PELA CONEXAO DO PAYLOAD e devolve uma observacao — ou a
 * constatacao de que nao houve resposta.
 *
 * A falha de conexao e CAPTURADA de proposito. Deixar a rejeicao subir daqui
 * produzia um `57P01` cru no relatorio do vitest, sem uma palavra sobre o que o
 * harness estava tentando provar. O veredito e a mensagem ficam em
 * `harness-diagnostics.ts`, que e puro e testado.
 */
async function probePayloadSchema(payload: Payload): Promise<SchemaProbe> {
  const pool = (
    payload.db as unknown as {
      pool?: { query?: (text: string) => Promise<{ rows: Record<string, unknown>[] }> }
    }
  ).pool
  if (pool?.query === undefined) {
    return { kind: 'unreachable', detail: 'pool do Payload indisponivel' }
  }

  try {
    const { rows } = await pool.query(
      "select current_database() as db, inet_server_port() as port, to_regclass('public.editorial_users')::text as rel",
    )
    const row: Record<string, unknown> = rows[0] ?? {}
    return {
      kind: 'observed',
      observation: {
        database: String(row.db ?? ''),
        port: Number(row.port ?? 0),
        editorialUsersPresent: row.rel !== null && row.rel !== undefined,
      },
    }
  } catch (error) {
    return { kind: 'unreachable', detail: describeDatabaseFailure(error) }
  }
}

/**
 * Prova que a Local API do Payload esta ligada ao MESMO banco que o harness
 * acabou de migrar, E que aquele banco tem o schema.
 *
 * Sem esta checagem, um Payload apontado para o banco errado (ou um `payload
 * migrate` que saiu 0 sem aplicar nada) so aparece dezenas de segundos depois,
 * como um `relation "..." does not exist` no meio de um teste — longe da causa
 * e sem dizer QUAL banco respondeu. A saida do `migrate` tambem e capturada e
 * so aparece aqui: no caminho feliz ela e descartada, e era justamente a
 * informacao que faltava para diagnosticar.
 */
async function assertPayloadSchema(
  payload: Payload,
  expected: SchemaExpectation & { migrationOutput: string },
): Promise<void> {
  const probe = await probePayloadSchema(payload)
  const diagnosis = diagnoseSchema(expected, probe)
  if (diagnosis === 'ok') return

  throw new Error(
    describeSchemaDiagnosis(diagnosis, {
      expected,
      probe,
      migrationOutput: expected.migrationOutput,
    }),
  )
}

/**
 * Quantas vezes tentar o `payload migrate` antes de desistir.
 *
 * Nao e paciencia com um banco lento — o CLI e SINCRONO e ja terminou quando
 * verificamos. E tolerancia a uma saida 0 que nao aplicou nada (ver
 * `applyCmsMigrations`). Tres tentativas: uma falha e o caso observado, duas
 * seguidas nunca foram, e um teto baixo mantem o custo do caminho ruim baixo.
 */
const MIGRATION_ATTEMPTS = 3

/**
 * O schema do CMS existe NESTE banco?
 *
 * Pergunta feita por uma conexao propria e curta, direto ao cluster efemero —
 * nao pela Local API, que so nasce depois do build. Verificar aqui, antes dos
 * ~2 minutos de `next build`, e o que transforma "falhou no fim do boot" em
 * "falhou onde a causa esta".
 */
async function cmsSchemaExists(pg: EmbeddedPostgres, database: string): Promise<boolean> {
  // Host EXPLICITO: o default de `getPgClient` e `localhost`, que em runner
  // dual-stack pode sair por `::1` enquanto o resto do harness fala `127.0.0.1`.
  // Sondar por outra interface responderia sobre outra conexao.
  const client = pg.getPgClient(database, '127.0.0.1')
  await client.connect()
  try {
    const { rows } = await client.query<{ migrations: boolean; users: boolean }>(
      "select to_regclass('public.payload_migrations') is not null as migrations," +
        " to_regclass('public.editorial_users') is not null as users",
    )
    const row = rows[0]
    return row !== undefined && row.migrations && row.users
  } finally {
    await client.end()
  }
}

/**
 * Aplica as migrations e PROVA que elas chegaram — nao confia no codigo de
 * saida.
 *
 * POR QUE NAO CONFIAR NO EXIT CODE. O `bin.js` do Payload dispara todo o corpo
 * do CLI com `void start()`: sem `await`, sem `catch` e sem propagar o
 * resultado para o codigo de saida do processo. O codigo de saida do `node`
 * fica, portanto, DESACOPLADO de a migration ter rodado. Em CI isso aparecia
 * como `payload migrate` saindo 0 com stdout E stderr vazios (nem o aviso de
 * email adapter, que e a primeira linha que o `payload.init()` emite) e nenhuma
 * tabela criada. O harness seguia em frente, gastava ~2 minutos de `next build`
 * e so descobria o problema no fim, com uma mensagem que apontava para o banco
 * errado. Era esta a flake que obrigava re-run em quase toda PR.
 *
 * Migrations REAIS pelo CLI REAL continuam sendo o certo: nao usamos
 * `payload.db.migrate()` porque o arquivo gerado importa
 * `MigrateUpArgs`/`MigrateDownArgs` como named imports e esses tipos nao existem
 * em runtime sob o loader do vitest. O que muda e a prova: o veredito passa a
 * ser o estado do BANCO, nao o do processo.
 */
async function applyCmsMigrations(
  pg: EmbeddedPostgres,
  database: string,
  childEnv: NodeJS.ProcessEnv,
): Promise<string> {
  const binJs = path.join(cmsDir, 'node_modules', 'payload', 'bin.js')
  const silentAttempts: string[] = []

  for (let attempt = 1; attempt <= MIGRATION_ATTEMPTS; attempt += 1) {
    const migration = spawnSync('node', ['--no-warnings', binJs, 'migrate'], {
      cwd: cmsDir,
      env: childEnv,
      stdio: 'pipe',
      shell: false,
    })
    const output = `${migration.stdout?.toString() ?? ''}\n${migration.stderr?.toString() ?? ''}`

    // A pergunta e feita ao BANCO, nao ao processo. `decideMigrationOutcome` e
    // pura e esta coberta por teste: a regra nao mora nesta glue.
    let schemaPresent = false
    if (migration.status === 0) {
      try {
        schemaPresent = await cmsSchemaExists(pg, database)
      } catch (error) {
        // Nao ha o que retentar contra um cluster que morreu, e chamar isso de
        // "migration ausente" repetiria o defeito que esta correcao desfaz:
        // atribuir a schema uma falha que e de conexao.
        if (isDatabaseGoneError(error)) {
          throw new Error(
            [
              'harness do CMS: o PostgreSQL efemero caiu durante a verificacao das migrations.',
              `detalhe: ${describeDatabaseFailure(error)}`,
            ].join('\n'),
          )
        }
        throw error
      }
    }
    const decision = decideMigrationOutcome({
      attempt,
      maxAttempts: MIGRATION_ATTEMPTS,
      exitStatus: migration.status,
      schemaPresent,
    })

    if (decision === 'accept') {
      if (attempt > 1) {
        console.warn(
          `[cms-it] 'payload migrate' saiu 0 sem aplicar nada ${String(attempt - 1)}x; ` +
            `o schema so apareceu na tentativa ${String(attempt)}.`,
        )
      }
      return output
    }

    if (decision === 'fail_reported') {
      throw new Error(
        `migrations do CMS falharam (exit ${String(migration.status)}, sinal ${String(
          migration.signal,
        )}): ${migration.stderr?.toString() ?? ''}`,
      )
    }

    silentAttempts.push(
      `tentativa ${String(attempt)}: exit 0, ${String(output.trim().length)} bytes de saida, ` +
        'schema ainda ausente',
    )

    if (decision === 'fail_silent') {
      throw new Error(
        [
          `harness do CMS: 'payload migrate' saiu 0 em ${String(MIGRATION_ATTEMPTS)} tentativas`,
          'sem criar o schema no banco efemero.',
          'O codigo de saida do CLI do Payload NAO prova que a migration rodou (`bin.js` dispara',
          '`void start()`, sem await e sem catch), por isso o harness verifica o BANCO.',
          ...silentAttempts,
        ].join('\n'),
      )
    }
  }

  // Inalcancavel: `decideMigrationOutcome` devolve `fail_silent` na ultima
  // tentativa. Existe para o TypeScript e como rede se o teto mudar.
  throw new Error("harness do CMS: 'payload migrate' nao produziu veredito")
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

/**
 * Tudo que o boot cria e que PRECISA morrer, em qualquer desfecho.
 *
 * Os campos sao opcionais porque o boot falha em qualquer ponto: o que ja
 * nasceu e desligado, o que nao nasceu e ignorado.
 */
interface HarnessResources {
  readonly uploadRoot: string
  dataDir?: string
  pg?: EmbeddedPostgres
  server?: ChildProcess
  payload?: Payload
}

/**
 * Desliga o harness na ordem certa. UNICO caminho de teardown — o `stop()` e o
 * caminho de boot falho chamam este mesmo codigo.
 *
 * A ORDEM e a correcao. Antes, um boot que falhava so removia o diretorio de
 * upload: o `next start`, o pool do Payload e o PostgreSQL efemero ficavam de
 * pe. Quem os derrubava era o gancho de saida de processo do proprio
 * `embedded-postgres` ("automatically shut down when the script exits"), que
 * manda um `pg_ctl stop -m fast` — e o fast shutdown derruba os backends com
 * `57P01`. Como o pool do Payload nunca fora fechado, o erro chegava ao vitest
 * como excecao NAO TRATADA, DEPOIS do ambiente de teste ter sido desmontado.
 * O resultado eram duas mensagens para uma unica falha: a real (schema) e um
 * `57P01` barulhento que parecia a causa e nao era.
 *
 * Alem disso, `afterAll(() => harness?.stop())` NAO cobria esse caso: quando o
 * boot lanca, `harness` continua `undefined` e o `?.` faz o teardown virar
 * no-op. Por isso a limpeza mora aqui, e nao no teste.
 */
async function shutdownHarness(resources: HarnessResources): Promise<void> {
  // 1. O servidor primeiro: enquanto ele vive, continua emitindo consultas.
  if (resources.server !== undefined) {
    try {
      resources.server.kill()
    } catch {
      /* pode ja ter morrido */
    }
  }

  // 2. `destroy()` do adapter NAO fecha o pool: ele so limpa schema, tabelas e
  // relations em memoria. O pool sobrevive, ve o PostgreSQL cair e emite
  // "Connection terminated unexpectedly" — que o vitest reporta como erro
  // NAO TRATADO. O resultado era 33 testes verdes com o processo saindo em
  // codigo 1: CI vermelho sem teste vermelho, o pior tipo de sinal.
  //
  // Fechar o pool ANTES de derrubar o banco resolve na ordem certa: as
  // conexoes terminam por decisao nossa, nao por morte do servidor.
  if (resources.payload !== undefined) {
    try {
      const pool = (resources.payload.db as unknown as { pool?: { end?: () => Promise<void> } })
        .pool
      // COM TETO. `pool.end()` espera cada cliente em uso ser devolvido, e um
      // cliente que nunca volta — transacao abortada, por exemplo — trava o
      // teardown para sempre (o hook estourava os 300s). O teto de 5s tenta o
      // fechamento gracioso e segue em frente quando ele nao vem: o processo
      // esta terminando de qualquer forma, e derrubar o banco depois de
      // tentar fechar e melhor do que nao tentar.
      await Promise.race([
        pool?.end?.() ?? Promise.resolve(),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ])
    } catch {
      /* pool pode ja estar fechado */
    }
    try {
      await resources.payload.db.destroy?.()
    } catch {
      /* estado em memoria: falhar aqui nao impede derrubar o banco */
    }
  }

  // 3. So agora o banco. Se algum cliente escapou dos passos acima, e aqui que
  // ele levaria `57P01` — e a essa altura ninguem mais esta ouvindo.
  if (resources.pg !== undefined) {
    try {
      await resources.pg.stop()
    } catch {
      /* idem */
    }
  }

  // No Windows o Postgres segura handles por instantes apos o stop.
  if (resources.dataDir !== undefined) {
    const dataDir = resources.dataDir
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
        break
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 400))
      }
    }
  }

  removeUploadRoot(resources.uploadRoot)
}

export async function startCmsHarness(): Promise<CmsHarness> {
  // O diretorio nasce ANTES do boot justamente para poder ser removido quando o
  // boot falhar: sem isto, cada migration quebrada ou servidor que nao sobe
  // deixaria uma pasta orfa em `apps/cms/media/`, porque o `stop()` — unico
  // lugar que limpava — so existe depois do `return`.
  const resources: HarnessResources = { uploadRoot: createUploadRoot() }
  try {
    return await bootCmsHarness(resources)
  } catch (error) {
    // Limpeza COMPLETA, nao so o diretorio de upload: ver `shutdownHarness`.
    await shutdownHarness(resources)
    throw error
  }
}

async function bootCmsHarness(resources: HarnessResources): Promise<CmsHarness> {
  const { uploadRoot } = resources
  const pgPort = await freePort()
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cinerie-cms-it-'))
  resources.dataDir = dataDir
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
  // Registrado SO depois do `start()`: parar um cluster que nunca subiu falha e
  // esconderia o erro real do boot atras de um erro de teardown.
  resources.pg = pg
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
  // Caminho ABSOLUTO e proprio deste run (ver `createUploadRoot`): o
  // `staticDir` resolve contra ele, e dois harnesses simultaneos nao disputam o
  // mesmo diretorio.
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

  // Migrations aplicadas e VERIFICADAS contra o banco (ver `applyCmsMigrations`).
  // Roda antes do `next build` de proposito: falhar aqui custa segundos, falhar
  // depois do build custava ~2 minutos e apontava para a causa errada.
  const migrationOutput = await applyCmsMigrations(pg, database, childEnv)

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
  // Registrado JA: se o `waitForServer` ou a guarda de schema falharem daqui em
  // diante, este processo precisa morrer junto — um `next start` orfao segura a
  // porta e conexoes com o banco que esta prestes a cair.
  resources.server = server

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
  // Registrado ANTES da guarda: se a guarda reprovar, o pool precisa ser fechado
  // pelo teardown. Era exatamente este pool orfao que recebia o `57P01` quando o
  // gancho de saida do `embedded-postgres` derrubava o cluster.
  resources.payload = payload
  await assertPayloadSchema(payload, { database, port: pgPort, migrationOutput })

  return {
    payload,
    baseUrl,
    // Ate agora a saida do servidor so aparecia quando o BOOT falhava. Um 500
    // depois do boot (config valida, servidor de pe, requisicao quebrando)
    // ficava invisivel — e era exatamente o caso mais dificil de diagnosticar.
    serverLog: () => serverLog,
    stop: () => shutdownHarness(resources),
  }
}

/** Header de API key no formato exigido pelo Payload: `<slug> API-Key <chave>`. */
export function apiKeyAuthorization(collectionSlug: string, apiKey: string): string {
  return `${collectionSlug} API-Key ${apiKey}`
}

/* ------------------------------------------------------------------ */
/* Bytes de imagem DECODIFICAVEIS                                      */
/* ------------------------------------------------------------------ */

/**
 * POR QUE ISTO EXISTE, e por que cabecalho valido deixou de bastar.
 *
 * Ate a coleccao `media` ganhar `imageSizes`, os testes subiam um JPEG montado
 * a mao — SOI + JFIF + SOF0 + EOI, sem SOS e sem dados de varredura. Aquilo era
 * suficiente para o proposito da epoca: provar que a midia era aceita pelos
 * BYTES e nao pela extensao do nome do arquivo.
 *
 * Com `imageSizes`, o Payload passa a gerar uma miniatura, e para isso o sharp
 * precisa DECODIFICAR a imagem, nao apenas ler a dimensao do cabecalho. Um
 * arquivo so-cabecalho e rejeitado ja no `metadata()` — `Input buffer has
 * corrupt header` — e o upload morre com `FileUploadError` 400, longe do
 * codigo que causou a mudanca. O mesmo vale para o PNG de 64 bytes que so
 * tinha IHDR.
 *
 * Estas funcoes usam o proprio sharp (dependencia declarada de `apps/cms`)
 * para produzir imagens REAIS na dimensao pedida. Sao a fonte unica das quatro
 * superficies que sobem midia — os dois testes de integracao do CMS, o
 * `global-setup` do E2E e o canario de `apps/web` —, porque a licao que trouxe
 * este comentario foi corrigir UMA fixture e deixar tres iguais para tras.
 *
 * `salt` muda a cor de fundo: bytes diferentes, hash diferente, mesma dimensao.
 * Serve para os casos que precisam distinguir midias sem distinguir formato.
 */
export async function decodableJpegBytes(
  width: number,
  height: number,
  salt = 0,
): Promise<Buffer> {
  const { default: sharp } = await import('sharp')
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: (salt * 37) % 256, g: (salt * 73) % 256, b: (salt * 151) % 256 },
    },
  })
    .jpeg()
    .toBuffer()
}

/** Contraparte PNG de {@link decodableJpegBytes}. */
export async function decodablePngBytes(width: number, height: number, salt = 0): Promise<Buffer> {
  const { default: sharp } = await import('sharp')
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: (salt * 37) % 256, g: (salt * 73) % 256, b: (salt * 151) % 256 },
    },
  })
    .png()
    .toBuffer()
}
