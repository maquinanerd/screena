/**
 * runtime/http.ts — As tres rotas do agendador. COBERTO pelo typecheck da raiz (`pnpm
 * typecheck`).
 *
 *   GET /healthz  LIVENESS. Nao toca banco. Se tocasse, uma queda do PostgreSQL
 *                 faria o orquestrador reiniciar em loop um processo saudavel —
 *                 e reiniciar nao devolve o banco.
 *   GET /readyz   READINESS. Toca banco. Diz se o agendador pode trabalhar.
 *   GET /status   O PAINEL DO DONO. HTML por padrao, JSON com `?format=json`.
 *
 * ============================================================================
 * POR QUE FILA PARADA NAO DERRUBA `/readyz`
 * ============================================================================
 * E tentador: fila parada -> 503 -> o EasyPanel pinta de vermelho. Mas o
 * healthcheck do orquestrador REINICIA o container, e reiniciar um agendador
 * saudavel porque a OMDb esta fora do ar troca um problema visivel por um
 * crash-loop. Alem disso, o restart zera o `startedAt` e a carencia de
 * `never_ran` recomeca — o alerta se apagaria sozinho a cada reinicio.
 *
 * Entao a divisao e: `/readyz` responde sobre a CAPACIDADE de trabalhar
 * (banco alcancavel, credencial presente, autorizacao de producao); o alerta de
 * fila parada sai por `/status` (semaforo `degraded`) e por uma linha de log
 * `error` — que e o que chega ao dono pelo painel de logs do EasyPanel sem
 * abrir terminal. O payload de `/readyz` CARREGA a contagem de filas paradas,
 * para quem monitora por JSON, sem transformar isso em 503.
 *
 * SUPERFICIE MINIMA: so GET, so tres rotas, nenhum verbo de escrita. Um botao
 * "rodar agora" exposto aqui seria um console de administracao sem autenticacao
 * dentro da rede interna — e este processo escreve no mesmo banco que serve o
 * site.
 */

import { createServer, type Server } from 'node:http'

import { renderStatusHtml, renderStatusText, type StatusReport } from '../status.js'

const SERVICE_NAME = 'cinerie-scheduler'

/** Readiness ja avaliada pelo servico. */
export interface SchedulerReadiness {
  readonly ready: boolean
  readonly checks: readonly { readonly name: string; readonly status: string; readonly detail: string }[]
}

export interface SchedulerHttpDeps {
  readonly port: number
  readonly workerId: string
  readonly isAlive: () => boolean
  readonly checkReadiness: () => Promise<SchedulerReadiness>
  readonly buildStatus: () => Promise<StatusReport>
}

export interface SchedulerHttpHandle {
  readonly server: Server
  readonly port: number
  close(): Promise<void>
}

export async function startSchedulerHttp(deps: SchedulerHttpDeps): Promise<SchedulerHttpHandle> {
  const server = createServer((request, response) => {
    const send = (status: number, body: string, contentType: string): void => {
      response.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' })
      response.end(body)
    }
    const json = (status: number, body: unknown): void =>
      send(status, JSON.stringify(body), 'application/json; charset=utf-8')

    if (request.method !== 'GET') {
      json(405, { error: 'method_not_allowed' })
      return
    }

    const [route, query = ''] = (request.url ?? '/').split('?')

    if (route === '/healthz') {
      const alive = deps.isAlive()
      json(alive ? 200 : 503, {
        status: alive ? 'ok' : 'degraded',
        service: SERVICE_NAME,
        workerId: deps.workerId,
        timestamp: new Date().toISOString(),
      })
      return
    }

    if (route === '/readyz') {
      void deps
        .checkReadiness()
        .then((report) => {
          json(report.ready ? 200 : 503, {
            status: report.ready ? 'ready' : 'not_ready',
            service: SERVICE_NAME,
            workerId: deps.workerId,
            checks: report.checks,
            timestamp: new Date().toISOString(),
          })
        })
        .catch(() => {
          // Falhar ao COLETAR e "nao pronto", nunca 500 com stack: a stack
          // poderia ecoar a connection string vinda do driver.
          json(503, { status: 'not_ready', service: SERVICE_NAME })
        })
      return
    }

    if (route === '/status') {
      void deps
        .buildStatus()
        .then((report) => {
          const format = new URLSearchParams(query).get('format')
          if (format === 'json') {
            json(200, report)
            return
          }
          if (format === 'text') {
            send(200, renderStatusText(report), 'text/plain; charset=utf-8')
            return
          }
          send(200, renderStatusHtml(report), 'text/html; charset=utf-8')
        })
        .catch(() => {
          json(503, { status: 'unavailable', service: SERVICE_NAME })
        })
      return
    }

    json(404, { error: 'not_found' })
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
        server.closeAllConnections?.()
      })
    },
  }
}
