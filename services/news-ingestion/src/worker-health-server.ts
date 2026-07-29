/**
 * worker-health-server.ts — Servidor HTTP MINIMO de health do worker.
 *
 * O worker nao serve conteudo; este servidor existe unicamente para o
 * orquestrador saber se o processo esta vivo e se ele pode trabalhar.
 *
 * SUPERFICIE MINIMA de proposito: duas rotas GET, nenhum verbo de escrita,
 * nenhum endpoint administrativo. Qualquer outro caminho responde 404. Um worker
 * que expusesse "reprocessar evento" ou "listar fila" por HTTP viraria um painel
 * de controle sem autenticacao dentro da rede interna.
 */

import { createServer, type Server } from 'node:http'

import type { ReadinessReport } from './media/worker-readiness-types.js'

export interface HealthServerDeps {
  readonly port: number
  /** `true` enquanto o loop principal esta saudavel. */
  readonly isAlive: () => boolean
  readonly checkReadiness: () => Promise<ReadinessReport>
  readonly workerId: string
}

export interface HealthServerHandle {
  readonly server: Server
  readonly port: number
  close(): Promise<void>
}

function json(body: unknown, status: number): { body: string; status: number } {
  return { body: JSON.stringify(body), status }
}

export async function startWorkerHealthServer(
  deps: HealthServerDeps,
): Promise<HealthServerHandle> {
  const server = createServer((request, response) => {
    const respond = (payload: { body: string; status: number }): void => {
      response.writeHead(payload.status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      response.end(payload.body)
    }

    if (request.method !== 'GET') {
      respond(json({ error: 'method_not_allowed' }, 405))
      return
    }

    const url = request.url ?? '/'
    const route = url.split('?')[0] ?? '/'

    if (route === '/healthz') {
      // LIVENESS: nao toca banco, nao toca CMS, nao toca storage. Se dependesse
      // deles, uma queda do Postgres faria o orquestrador reiniciar em loop um
      // worker saudavel — e reiniciar nao devolve o banco.
      const alive = deps.isAlive()
      respond(
        json(
          {
            status: alive ? 'ok' : 'degraded',
            service: 'cinerie-publication-worker',
            workerId: deps.workerId,
            timestamp: new Date().toISOString(),
          },
          alive ? 200 : 503,
        ),
      )
      return
    }

    if (route === '/readyz') {
      void deps
        .checkReadiness()
        .then((report) => {
          respond(
            json(
              {
                status: report.ready ? 'ready' : 'not_ready',
                service: 'cinerie-publication-worker',
                workerId: deps.workerId,
                checks: report.checks,
                timestamp: new Date().toISOString(),
              },
              report.ready ? 200 : 503,
            ),
          )
        })
        .catch(() => {
          // Falha ao COLETAR readiness e "nao pronto", nunca 500 com stack.
          respond(json({ status: 'not_ready', service: 'cinerie-publication-worker' }, 503))
        })
      return
    }

    respond(json({ error: 'not_found' }, 404))
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    // `0.0.0.0`: dentro do container, `127.0.0.1` seria invisivel para o
    // healthcheck do orquestrador, que bate de fora do namespace de rede.
    server.listen(deps.port, '0.0.0.0', () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : deps.port

  return {
    server,
    port,
    close: async (): Promise<void> => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        // Conexoes keep-alive do healthcheck seguram o `close` por ate um
        // intervalo inteiro. Encerra-las e o que faz o desligamento caber na
        // janela de drenagem.
        server.closeAllConnections?.()
      })
    },
  }
}
