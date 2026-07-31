/**
 * worker-readiness.ts — Coleta os fatos de readiness do worker de projecao.
 *
 * Fora do typecheck puro (mesma disciplina de `editorial-store.ts`). Aqui so se
 * COLETA; quem decide e `../media/worker-readiness-types.js`, que e puro.
 *
 * Toda coleta e defensiva: falha vira fato negativo, nunca excecao. Um readiness
 * que estoura tira o servico do ar sem dizer por que.
 *
 * SOMENTE LEITURA. Nenhuma checagem consome evento da outbox, cria documento ou
 * escreve no banco — um readiness batido a cada 10s que consumisse um evento
 * "para testar" drenaria a fila sozinho.
 */

import type { PrismaClient } from '@screena/db/server'

import { inspectScreenSchema } from '../media/screen-schema-preflight.js'
import {
  evaluateWorkerReadiness,
  type ReadinessReport,
} from '../media/worker-readiness-types.js'
import {
  projectionAuthHeader,
  resolveProjectionWorkerConfig,
} from '../projection-worker-config.js'
import { resolveMediaStorageConfig } from '../media/storage-config.js'
import type { MediaStoragePort } from '../media/storage-port.js'

export interface WorkerReadinessDeps {
  readonly prisma: PrismaClient
  readonly storage: MediaStoragePort | null
  readonly env?: Record<string, string | undefined>
  readonly fetchImpl?: (url: string, init: RequestInit) => Promise<Response>
  readonly timeoutMs?: number
  /**
   * Mesma autorizacao explicita que o processo principal usou para subir
   * (`--allow-production-url` no entrypoint).
   *
   * Sem repassa-la, o readiness reavalia a configuracao SEM a decisao que ja foi
   * tomada e reprova a mesma URL que o worker aceitou: `/healthz` 200 com
   * `/readyz` 503 dizendo "SCREEN_DATABASE_URL parece apontar para producao".
   * O default continua `false` — quem nao passa nada segue protegido.
   */
  readonly allowProductionShapedUrl?: boolean
}

/**
 * O CMS responde E aceita a credencial de projecao?
 *
 * Usa o `claim` com lote ZERO: prova autenticacao e escopo sem tirar um unico
 * evento da fila. Pedir um evento de verdade "so para testar" faria o readiness
 * competir com o proprio worker.
 */
async function probePayload(
  baseUrl: string,
  authorization: string,
  workerId: string,
  doFetch: (url: string, init: RequestInit) => Promise<Response>,
  timeoutMs: number,
): Promise<{ reachable: boolean; authAccepted: boolean }> {
  try {
    const response = await doFetch(`${baseUrl}/api/internal/publication-outbox/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization },
      body: JSON.stringify({ workerId: `${workerId}-readiness`, batchSize: 0, leaseMs: 5_000 }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    // 401/403 sao respostas VALIDAS do servidor: ele esta de pe, e quem foi
    // recusada foi a credencial. Distinguir isso de "inalcancavel" e o que faz
    // o diagnostico apontar para a chave em vez de para a rede.
    if (response.status === 401 || response.status === 403) {
      return { reachable: true, authAccepted: false }
    }
    return { reachable: response.ok, authAccepted: response.ok }
  } catch {
    return { reachable: false, authAccepted: false }
  }
}

export async function collectWorkerReadiness(deps: WorkerReadinessDeps): Promise<ReadinessReport> {
  const env = deps.env ?? process.env
  const timeoutMs = deps.timeoutMs ?? 5_000

  const configResult = resolveProjectionWorkerConfig(env, {
    allowProductionShapedUrl: deps.allowProductionShapedUrl === true,
  })
  const storageResult = resolveMediaStorageConfig(env)
  const configValid = configResult.ok && storageResult.ok
  const configErrors = [
    ...(configResult.ok ? [] : configResult.errors),
    ...(storageResult.ok ? [] : storageResult.errors),
  ]

  if (!configValid) {
    // Sem configuracao valida nao se tenta conectar em nada: uma tentativa so
    // produziria um segundo erro derivado, escondendo a causa real.
    return evaluateWorkerReadiness({
      configValid: false,
      configErrors,
      screenDatabaseReachable: false,
      missingSchemaObjects: [],
      payloadReachable: false,
      payloadAuthAccepted: false,
      storageReady: false,
      storageDriver: 'desconhecido',
    })
  }

  let screenDatabaseReachable = false
  let missingSchemaObjects: string[] = []
  try {
    missingSchemaObjects = await inspectScreenSchema({
      queryTables: () =>
        deps.prisma.$queryRawUnsafe<{ table_name: string }[]>(
          "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
        ),
      queryColumns: () =>
        deps.prisma.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
          "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'",
        ),
    })
    screenDatabaseReachable = true
  } catch {
    screenDatabaseReachable = false
  }

  const doFetch = deps.fetchImpl ?? ((url, init) => fetch(url, init))
  const payload = configResult.ok
    ? await probePayload(
        configResult.config.payloadInternalServiceUrl,
        projectionAuthHeader(configResult.config),
        configResult.config.workerId,
        doFetch,
        timeoutMs,
      )
    : { reachable: false, authAccepted: false }

  let storageReady = false
  try {
    if (deps.storage !== null) {
      // `exists` de uma chave que nao existe: prova que o driver responde sem
      // gravar nada e sem depender de nenhum arquivo especifico.
      await deps.storage.exists('editorial/00/' + '0'.repeat(64) + '.jpg')
      storageReady = true
    }
  } catch {
    storageReady = false
  }

  return evaluateWorkerReadiness({
    configValid: true,
    configErrors: [],
    screenDatabaseReachable,
    missingSchemaObjects,
    payloadReachable: payload.reachable,
    payloadAuthAccepted: payload.authAccepted,
    storageReady,
    storageDriver: storageResult.ok ? storageResult.config.driver : 'desconhecido',
  })
}
