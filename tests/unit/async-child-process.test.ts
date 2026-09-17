/**
 * async-child-process.test.ts — O experimento do pipe cheio, nas DUAS copias do
 * helper, com o padrao antigo como controle negativo.
 *
 * ============================================================================
 * O QUE O EXPERIMENTO REPRODUZ
 * ============================================================================
 * 16/09/2026: um validador ficou 6 h parado numa migration. O `embedded-postgres`
 * le o LOG do Postgres (stderr do filho) pelo laco de eventos; o validador rodava
 * `prisma migrate deploy` com `execFileSync`, que congela o laco. O pipe encheu e
 * o backend que foi logar travou dentro do `write()`.
 *
 * Aqui o Postgres e `tests/support/child-process/log-server.mjs`: escreve o log
 * no stderr ANTES de responder, e o teste le esse stderr por `data`, como o
 * `embedded-postgres`. O cliente (`log-client.mjs`) faz o papel do Prisma. Sem
 * binario de banco: a suite geral nao depende de Postgres (ver vitest.config.ts).
 *
 * ============================================================================
 * POR QUE O CONTROLE NEGATIVO TEM DOIS LADOS
 * ============================================================================
 * `execFileSync` com log ABAIXO do buffer termina: prova que o cenario funciona
 * de forma sincrona e que o que trava e o VOLUME, nao a rede nem o fixture.
 * `execFileSync` com log ACIMA do buffer estoura o teto — e, assim que o laco
 * volta, o log represado escoa: o servidor estava BLOQUEADO, nao morto. Sem os
 * dois lados, "estourou o tempo" poderia ser qualquer coisa.
 *
 * Os testes de semantica comparam com o `execFileSync`/`spawnSync` DE VERDADE
 * (em comandos que nao enchem pipe nenhum): "mesma semantica" e medida, nao
 * afirmada.
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import * as helperScreen from '@screena/db/async-child-process'

import * as helperCms from '../../apps/cms/src/__tests__/async-child-process.js'

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'support', 'child-process')
const LOG_SERVER = path.join(FIXTURES, 'log-server.mjs')
const LOG_CLIENT = path.join(FIXTURES, 'log-client.mjs')

const BYTES_POR_LINHA = 1024
/**
 * ~4 MB: acima do buffer em qualquer SO onde a CI ou o dev rodam — ~56-64 KB no
 * pipe nomeado do Windows (medido: o cliente parou em ~56 KB), algumas centenas
 * de KB no socketpair que o libuv usa no Linux.
 */
const LINHAS_ACIMA_DO_BUFFER = 4096
/** ~8 KB: abaixo de qualquer um desses buffers. */
const LINHAS_ABAIXO_DO_BUFFER = 8

interface LogServer {
  readonly port: string
  /** Bytes de log que o laco de eventos deste processo ja esvaziou do pipe. */
  drained(): number
  stop(): Promise<void>
}

const servidores: LogServer[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  while (servidores.length > 0) await servidores.pop()?.stop()
})

async function startLogServer(): Promise<LogServer> {
  const child = spawn(process.execPath, [LOG_SERVER, String(BYTES_POR_LINHA)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let drained = 0
  // O que o `embedded-postgres` faz com o log: le por evento, no laco de eventos.
  child.stderr.on('data', (chunk: Buffer) => {
    drained += chunk.length
  })
  const port = await new Promise<string>((resolve, reject) => {
    child.once('error', reject)
    child.stdout.once('data', (chunk: Buffer) => resolve(String(chunk).trim()))
  })
  const server: LogServer = {
    port,
    drained: () => drained,
    stop: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve()
          return
        }
        child.once('close', () => resolve())
        child.kill()
      }),
  }
  servidores.push(server)
  return server
}

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) return false
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return true
}

/** Captura o erro lancado por uma chamada SINCRONA do Node, para comparar. */
function thrownBy(run: () => unknown): NodeJS.ErrnoException & { status?: number | null; signal?: string | null } {
  try {
    run()
  } catch (error) {
    return error as NodeJS.ErrnoException
  }
  throw new Error('a chamada sincrona deveria ter lancado')
}

const node = process.execPath
const COMANDO_INEXISTENTE = 'cinerie-comando-que-nao-existe-4f1c'

describe('CONTROLE NEGATIVO: o padrao antigo trava no mesmo experimento', () => {
  it('execFileSync com log ABAIXO do buffer termina — o cenario funciona sincrono', async () => {
    const server = await startLogServer()
    execFileSync(node, [LOG_CLIENT, server.port, String(LINHAS_ABAIXO_DO_BUFFER)], {
      stdio: 'pipe',
      timeout: 30_000,
    })
    const total = LINHAS_ABAIXO_DO_BUFFER * BYTES_POR_LINHA
    expect(await waitFor(() => server.drained() >= total, 10_000)).toBe(true)
  }, 60_000)

  it('execFileSync com log ACIMA do buffer estoura o teto; o log so escoa quando o laco volta', async () => {
    const server = await startLogServer()
    const total = LINHAS_ACIMA_DO_BUFFER * BYTES_POR_LINHA

    const error = thrownBy(() =>
      execFileSync(node, [LOG_CLIENT, server.port, String(LINHAS_ACIMA_DO_BUFFER)], {
        stdio: 'pipe',
        timeout: 4_000,
      }),
    )
    expect(error.code).toBe('ETIMEDOUT')
    // Durante a chamada nada foi esvaziado: o laco estava congelado.
    expect(server.drained()).toBeLessThan(total)

    // Bloqueado, nao morto: com o laco livre, o log represado sai inteiro.
    expect(await waitFor(() => server.drained() >= total, 30_000)).toBe(true)
  }, 90_000)
})

describe.each([
  ['@screena/db/async-child-process', helperScreen],
  ['apps/cms (copia do ADR 0015)', helperCms],
] as const)('%s', (_rotulo, helper) => {
  describe('o experimento do pipe cheio', () => {
    it('runChild termina enquanto o "Postgres" escreve ~4 MB de log', async () => {
      const server = await startLogServer()
      await helper.runChild(node, [LOG_CLIENT, server.port, String(LINHAS_ACIMA_DO_BUFFER)], {
        stdio: 'pipe',
        timeout: 60_000,
      })
      expect(server.drained()).toBeGreaterThanOrEqual(LINHAS_ACIMA_DO_BUFFER * BYTES_POR_LINHA)
    }, 90_000)

    it('spawnChild termina enquanto o "Postgres" escreve ~4 MB de log', async () => {
      const server = await startLogServer()
      const result = await helper.spawnChild(
        node,
        [LOG_CLIENT, server.port, String(LINHAS_ACIMA_DO_BUFFER)],
        { stdio: 'inherit', timeout: 60_000 },
      )
      expect(result.status).toBe(0)
      expect(result.error).toBeUndefined()
      expect(server.drained()).toBeGreaterThanOrEqual(LINHAS_ACIMA_DO_BUFFER * BYTES_POR_LINHA)
    }, 90_000)
  })

  describe('runChild tem a semantica de erro do execFileSync', () => {
    it('resolve com o stdout capturado', async () => {
      expect(await helper.runChild(node, ['-e', "process.stdout.write('saida')"])).toBe('saida')
    }, 30_000)

    it('codigo != 0 com stdio pipe: mesma mensagem (comando + stderr) e mesmo status', async () => {
      const args = ['-e', "process.stderr.write('motivo'); process.exit(3)"]
      const esperado = thrownBy(() => execFileSync(node, args, { stdio: 'pipe' }))
      const recebido = (await helper.runChild(node, args, { stdio: 'pipe' }).catch(
        (error: unknown) => error,
      )) as Error & { status: number | null; stderr: string }
      expect(recebido).toBeInstanceOf(Error)
      expect(recebido.message).toBe(esperado.message)
      expect(recebido.message.startsWith(`Command failed: ${node} -e`)).toBe(true)
      expect(recebido.status).toBe(3)
      expect(recebido.stderr).toBe('motivo')
    }, 30_000)

    it('codigo != 0 com stdio inherit: mesma mensagem, sem saida capturada', async () => {
      const args = ['-e', 'process.exit(4)']
      const esperado = thrownBy(() => execFileSync(node, args, { stdio: 'inherit' }))
      const recebido = (await helper.runChild(node, args, { stdio: 'inherit' }).catch(
        (error: unknown) => error,
      )) as Error & { status: number | null }
      expect(recebido.message).toBe(esperado.message)
      expect(recebido.status).toBe(4)
      expect(await helper.runChild(node, ['-e', 'process.exit(0)'], { stdio: 'inherit' })).toBe('')
    }, 30_000)

    it('comando que nao sobe: rejeita com o mesmo code do execFileSync (ENOENT)', async () => {
      const esperado = thrownBy(() => execFileSync(COMANDO_INEXISTENTE, [], { stdio: 'pipe' }))
      const recebido = (await helper
        .runChild(COMANDO_INEXISTENTE, [], { stdio: 'pipe' })
        .catch((error: unknown) => error)) as NodeJS.ErrnoException
      expect(esperado.code).toBe('ENOENT')
      expect(recebido.code).toBe(esperado.code)
    }, 30_000)

    it('timeout: rejeita com ETIMEDOUT e o filho morre por SIGTERM, como no execFileSync', async () => {
      const args = ['-e', 'setTimeout(() => {}, 60000)']
      const esperado = thrownBy(() => execFileSync(node, args, { stdio: 'pipe', timeout: 500 }))
      const recebido = (await helper
        .runChild(node, args, { stdio: 'pipe', timeout: 500 })
        .catch((error: unknown) => error)) as NodeJS.ErrnoException & { signal: string | null }
      expect(esperado.code).toBe('ETIMEDOUT')
      expect(recebido.code).toBe('ETIMEDOUT')
      expect(recebido.signal).toBe(esperado.signal)
    }, 30_000)

    it('stdio omitido: repassa o stderr ao terminal, como o execFileSync', async () => {
      const escrito: string[] = []
      vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
        escrito.push(String(chunk))
        return true
      })
      const saida = await helper.runChild(node, [
        '-e',
        "process.stderr.write('aviso'); process.stdout.write('dado')",
      ])
      expect(saida).toBe('dado')
      expect(escrito.join('')).toContain('aviso')
    }, 30_000)

    it('respeita cwd e env', async () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'cinerie-child-cwd-'))
      try {
        writeFileSync(path.join(dir, 'marcador.txt'), 'x')
        const saida = await helper.runChild(
          node,
          [
            '-e',
            "process.stdout.write(require('node:fs').existsSync('marcador.txt') + ':' + process.env.CINERIE_TESTE_FILHO)",
          ],
          { cwd: dir, env: { ...process.env, CINERIE_TESTE_FILHO: 'valor' }, stdio: 'pipe' },
        )
        expect(saida).toBe('true:valor')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }, 30_000)

    it('fecha o stdin do filho, como o execFileSync sem input (filho que le stdin nao trava)', async () => {
      const saida = await helper.runChild(
        node,
        ['-e', "process.stdin.resume(); process.stdin.on('end', () => process.stdout.write('eof'))"],
        { stdio: 'pipe', timeout: 20_000 },
      )
      expect(saida).toBe('eof')
    }, 30_000)

    it('preserva UTF-8 que atravessa a fronteira entre pedacos do pipe', async () => {
      const saida = await helper.runChild(
        node,
        ['-e', "process.stdout.write('ção'.repeat(100000))"],
        { stdio: 'pipe' },
      )
      expect(saida).toBe('ção'.repeat(100_000))
    }, 30_000)
  })

  describe('spawnChild tem a semantica do spawnSync (nunca rejeita)', () => {
    it('codigo != 0: devolve status, sinal e saidas iguais aos do spawnSync', async () => {
      const args = ['-e', "process.stdout.write('o'); process.stderr.write('e'); process.exit(5)"]
      const esperado = spawnSync(node, args, { encoding: 'utf8' })
      const recebido = await helper.spawnChild(node, args)
      expect(recebido.status).toBe(esperado.status)
      expect(recebido.signal).toBe(esperado.signal)
      expect(recebido.stdout).toBe(esperado.stdout)
      expect(recebido.stderr).toBe(esperado.stderr)
      expect(recebido.error).toBeUndefined()
    }, 30_000)

    it('comando que nao sobe: resolve com status null e error ENOENT', async () => {
      const esperado = spawnSync(COMANDO_INEXISTENTE, [], { encoding: 'utf8' })
      const recebido = await helper.spawnChild(COMANDO_INEXISTENTE, [])
      expect(recebido.status).toBe(esperado.status)
      expect((esperado.error as NodeJS.ErrnoException | undefined)?.code).toBe('ENOENT')
      expect(recebido.error?.code).toBe('ENOENT')
    }, 30_000)

    it('timeout: resolve com status null, SIGTERM e error ETIMEDOUT', async () => {
      const args = ['-e', 'setTimeout(() => {}, 60000)']
      const esperado = spawnSync(node, args, { encoding: 'utf8', timeout: 500 })
      const recebido = await helper.spawnChild(node, args, { timeout: 500 })
      expect(recebido.status).toBe(esperado.status)
      expect(recebido.signal).toBe(esperado.signal)
      expect((esperado.error as NodeJS.ErrnoException | undefined)?.code).toBe('ETIMEDOUT')
      expect(recebido.error?.code).toBe('ETIMEDOUT')
    }, 30_000)
  })
})

describe('as duas copias expoem a MESMA API', () => {
  it('mesmos nomes exportados', () => {
    expect(Object.keys(helperCms).sort()).toEqual(Object.keys(helperScreen).sort())
  })
})
