/**
 * project-editorial.ts — Worker de projecao editorial (CMS -> banco publico).
 *
 * OFFLINE. Roda fora do render (invariantes 3 e 4): reclama eventos da outbox
 * do Payload por HTTP, projeta no screen-db por Prisma e confirma. Nenhuma
 * pagina publica depende deste processo estar de pe — se ele parar, o site
 * continua servindo o que ja foi projetado.
 *
 * Uso:
 *   tsx bin/project-editorial.ts --once
 *   tsx bin/project-editorial.ts --once --dry-run
 *   tsx bin/project-editorial.ts --loop
 *
 * NUNCA imprime credencial, URL de banco, header de autorizacao ou corpo de
 * materia. O que sai no log e: id do evento, tipo, desfecho e motivo.
 */

import process from 'node:process'

import { PrismaClient } from '@screena/db/server'

import { mapPublicationEvent } from '../src/editorial-event-mapper.js'
import {
  projectionAuthHeader,
  resolveProjectionWorkerConfig,
  type ProjectionWorkerConfig,
} from '../src/projection-worker-config.js'
import { applyProjectionEvent } from '../src/persistence/editorial-projection-store.js'

interface ClaimedEvent {
  readonly eventId: string
  readonly idempotencyKey: string
  readonly eventType: string
  readonly aggregateId: string
  /** Ordem de emissao (id serial da linha na outbox). */
  readonly emissionSequence: number
  /** Hash do conteudo publicado, calculado pelo CMS. */
  readonly contentVersion: string
  readonly attempts: number
  readonly leaseToken: string
  readonly leaseExpiresAt: string
  readonly payload: unknown
}

/** Erro cujo `message` ja foi considerado seguro para log. */
class SafeError extends Error {
  readonly retryable: boolean
  readonly code: string
  constructor(code: string, message: string, retryable: boolean) {
    super(message)
    this.code = code
    this.retryable = retryable
  }
}

async function callOutbox(
  config: ProjectionWorkerConfig,
  path: string,
  body: unknown,
): Promise<unknown> {
  const response = await fetch(`${config.payloadInternalServiceUrl}/api${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: projectionAuthHeader(config),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  })

  if (!response.ok) {
    // O corpo da resposta NAO entra na mensagem: ele pode ecoar o payload do
    // evento. Status e caminho bastam para diagnosticar.
    throw new SafeError(
      `outbox_http_${String(response.status)}`,
      `outbox respondeu ${String(response.status)} em ${path}`,
      response.status >= 500 || response.status === 429,
    )
  }
  return (await response.json()) as unknown
}

async function claim(config: ProjectionWorkerConfig): Promise<ClaimedEvent[]> {
  const result = (await callOutbox(config, '/internal/publication-outbox/claim', {
    workerId: config.workerId,
    batchSize: config.batchSize,
    leaseMs: config.leaseMs,
  })) as { events?: ClaimedEvent[] }
  return Array.isArray(result.events) ? result.events : []
}

async function processEvent(
  prisma: PrismaClient,
  config: ProjectionWorkerConfig,
  claimed: ClaimedEvent,
  dryRun: boolean,
): Promise<void> {
  const mapping = mapPublicationEvent(claimed.payload, claimed.emissionSequence)
  if (!mapping.ok) {
    // Evento que nao passa no contrato NUNCA vira pagina publica, e nao adianta
    // retentar: o corpo nao vai mudar sozinho. Vai direto para dead-letter, com
    // os caminhos dos campos invalidos (nunca os valores).
    throw new SafeError(
      'contract_invalid',
      `evento fora do contrato: ${mapping.issues.slice(0, 5).join('; ')}`,
      false,
    )
  }

  const result = await applyProjectionEvent(prisma, {
    event: mapping.event,
    // O hash vem do CMS (`aggregateVersion` da outbox), nao e recalculado aqui:
    // duas implementacoes do mesmo hash divergiriam no primeiro campo novo.
    contentVersion: claimed.contentVersion,
    workerId: config.workerId,
    dryRun,
  })

  for (const warning of result.warnings) {
    console.warn(`[projecao] aviso ${claimed.eventId}: ${warning}`)
  }
  console.log(
    `[projecao] ${claimed.eventId} (${claimed.eventType}) -> ${result.outcome}: ${result.reason}`,
  )

  if (dryRun) return

  await callOutbox(config, '/internal/publication-outbox/ack', {
    eventId: claimed.eventId,
    leaseToken: claimed.leaseToken,
    workerId: config.workerId,
    projectionReceiptId: result.articleId ?? claimed.eventId,
    projectedAt: new Date().toISOString(),
  })
}

async function runCycle(
  prisma: PrismaClient,
  config: ProjectionWorkerConfig,
  dryRun: boolean,
): Promise<number> {
  const events = await claim(config)
  if (events.length === 0) return 0

  for (const claimed of events) {
    try {
      await processEvent(prisma, config, claimed, dryRun)
    } catch (error) {
      const safe = error instanceof SafeError
      const code = safe ? error.code : 'projection_failed'
      const retryable = safe ? error.retryable : true
      const message = safe
        ? error.message
        : // Erro nao classificado pode carregar connection string ou header. Nao
          // repassamos a mensagem original: so o tipo.
          `falha nao classificada (${error instanceof Error ? error.name : 'desconhecida'})`

      console.error(`[projecao] ${claimed.eventId} FALHOU (${code}): ${message}`)
      if (dryRun) continue
      try {
        await callOutbox(config, '/internal/publication-outbox/fail', {
          eventId: claimed.eventId,
          leaseToken: claimed.leaseToken,
          workerId: config.workerId,
          errorCode: code,
          message,
          retryable,
          failedAt: new Date().toISOString(),
        })
      } catch {
        // Nao conseguimos nem reportar a falha: a lease expira sozinha e outro
        // ciclo recupera o evento. Preso para sempre nao fica.
        console.error(`[projecao] ${claimed.eventId}: falha ao reportar; lease expira sozinha`)
      }
    }
  }
  return events.length
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2))
  const dryRun = args.has('--dry-run')
  const loop = args.has('--loop')
  if (!loop && !args.has('--once')) {
    console.error('uso: project-editorial.ts (--once | --loop) [--dry-run]')
    process.exit(2)
  }

  const resolved = resolveProjectionWorkerConfig(process.env, {
    allowProductionShapedUrl: args.has('--allow-production-url'),
  })
  if (!resolved.ok) {
    // So os NOMES das variaveis saem daqui.
    console.error(`[projecao] configuracao invalida: ${resolved.errors.join('; ')}`)
    process.exit(2)
  }
  const config = resolved.config

  const prisma = new PrismaClient({ datasourceUrl: config.screenDatabaseUrl })
  let stopping = false
  const stop = (): void => {
    stopping = true
    console.log('[projecao] encerrando apos o ciclo atual')
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)

  console.log(
    `[projecao] worker=${config.workerId} modo=${loop ? 'loop' : 'once'}${dryRun ? ' (dry-run)' : ''}`,
  )

  try {
    if (!loop) {
      const processed = await runCycle(prisma, config, dryRun)
      console.log(`[projecao] ciclo unico concluido: ${String(processed)} evento(s)`)
      return
    }
    while (!stopping) {
      const processed = await runCycle(prisma, config, dryRun)
      if (stopping) break
      // Fila vazia espera o intervalo cheio; fila com trabalho volta na hora,
      // para nao arrastar um acumulo em passos de 15s.
      if (processed === 0) {
        await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs))
      }
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error('[projecao] erro fatal:', error instanceof Error ? error.name : 'desconhecido')
  process.exit(1)
})
