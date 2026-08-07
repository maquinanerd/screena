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
 *   tsx bin/project-editorial.ts --loop --allow-production-url
 *
 * `--allow-production-url` e a autorizacao EXPLICITA para uma
 * `SCREEN_DATABASE_URL` com cara de producao (ver PRODUCTION_SHAPES). Ela vale
 * para o processo inteiro — inclusive para o `/readyz`, que reavalia a mesma
 * configuracao a cada batida do orquestrador.
 *
 * FALHA DE CICLO NAO E MORTE DE PROCESSO (modo `--loop`). O `claim()` ja ficou
 * fora de qualquer `try`: um 500 do CMS, um ECONNREFUSED durante o deploy do
 * CMS, um ECONNRESET ou um timeout escapavam do `while` ate `main().catch` e
 * matavam o processo com exit 1 — crash-loop com o painel verde, porque o
 * health server subia de novo a cada encarnacao. Hoje o ciclo inteiro roda
 * dentro de `try`, a falha e registrada e o loop espera `pollIntervalMs`.
 *
 * O preco disso e um worker que nunca morre — e um worker que nunca morre e
 * falha em todo ciclo seria PIOR do que um que morre, porque some do radar. Por
 * isso a saude do loop e observavel e as duas condicoes ficam separadas:
 *
 *   `/readyz`  — o loop esta FALHANDO. Reiniciar nao levanta o CMS: e caso de
 *                olhar, nao de reiniciar.
 *   `/healthz` — o loop esta TRAVADO (parou de bater). E a unica falha que
 *                reinicio resolve. Continua sem tocar banco, CMS ou storage.
 *
 * `--once` mantem a semantica fatal: um systemd timer precisa que a falha vire
 * exit != 0.
 *
 * NUNCA imprime credencial, URL de banco, header de autorizacao ou corpo de
 * materia. O que sai no log e: id do evento, tipo, desfecho e motivo.
 */

import process from 'node:process'

import { createPrismaClient, type PrismaClient } from '@screena/db/server'

import { mapPublicationEvent } from '../src/editorial-event-mapper.js'
import { parseClaimResponse } from '../src/outbox-claim-response.js'
import { isClassifiedFailure } from '../src/projection-failure.js'
import {
  projectionAuthHeader,
  resolveProjectionWorkerConfig,
  type ProjectionWorkerConfig,
} from '../src/projection-worker-config.js'
import { applyProjectionEvent } from '../src/persistence/editorial-projection-store.js'
import { planEventMedia } from '../src/media/media-plan.js'
import {
  MediaPipelineError,
  projectEventMedia,
  type ProjectedMediaAsset,
} from '../src/media/media-pipeline.js'
import { createLocalMediaStorage } from '../src/media/local-storage.js'
import { createS3MediaStorage } from '../src/media/s3-storage.js'
import { resolveMediaStorageConfig } from '../src/media/storage-config.js'
import { DEFAULT_MEDIA_LIMITS } from '../src/media/media-validation.js'
import type { MediaStoragePort } from '../src/media/storage-port.js'
import { startWorkerHealthServer } from '../src/worker-health-server.js'
import { collectWorkerReadiness } from '../src/persistence/worker-readiness.js'
import {
  applyShutdownSignal,
  hasLeaseBudget,
  mayClaimMore,
  INITIAL_SHUTDOWN,
  type ShutdownState,
} from '../src/worker-lifecycle.js'
import {
  classifyCycleError,
  evaluateLoopHealth,
  initialLoopHealth,
  isLoopStalled,
  recordCycleFailure,
  recordCycleSuccess,
  recordLoopProgress,
  resolveLoopHealthThresholds,
  type LoopHealthState,
} from '../src/worker-loop-health.js'

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
  const result = await callOutbox(config, '/internal/publication-outbox/claim', {
    workerId: config.workerId,
    batchSize: config.batchSize,
    leaseMs: config.leaseMs,
  })

  // FILA VAZIA E FALHA DEIXAM DE SER A MESMA COISA.
  //
  // Antes: `Array.isArray(result.events) ? result.events : []`. Toda resposta
  // que nao trouxesse uma lista virava lista vazia — corpo de erro com 200,
  // HTML de proxy, campo renomeado. O ciclo terminava "com sucesso", o
  // `/readyz` seguia verde e a projecao ficava parada sem sintoma nenhum.
  //
  // Agora a falha e RETENTAVEL e sobe: o `catch` do laco a registra em
  // `recordCycleFailure`, espera o intervalo cheio e denuncia no `/readyz`.
  // Fila vazia continua sendo `events: []` — uma lista com zero itens.
  const parsed = parseClaimResponse(result)
  if (!parsed.ok) throw new SafeError(parsed.code, parsed.detail, true)
  return parsed.events as ClaimedEvent[]
}

async function processEvent(
  prisma: PrismaClient,
  config: ProjectionWorkerConfig,
  storage: MediaStoragePort,
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

  // MIDIA ANTES DA TRANSACAO. Baixar e gravar arquivo com uma transacao aberta
  // seguraria conexao e travas de linha pelo tempo da rede.
  const plan = planEventMedia(mapping.event)
  for (const blockId of plan.malformedBlockIds) {
    console.warn(`[projecao] aviso ${claimed.eventId}: bloco de imagem ${blockId} sem mediaRef`)
  }

  let media = new Map<string, ProjectedMediaAsset>()
  if (plan.requests.length > 0 && !dryRun) {
    try {
      const projected = await projectEventMedia(
        {
          fetch: {
            baseUrl: config.payloadInternalServiceUrl,
            authorization: projectionAuthHeader(config),
            requestTimeoutMs: config.requestTimeoutMs,
            maxBytes: DEFAULT_MEDIA_LIMITS.maxBytes,
          },
          storage,
        },
        plan.requests,
      )
      media = projected.assets
      for (const warning of projected.warnings) {
        console.warn(`[projecao] aviso ${claimed.eventId}: ${warning}`)
      }
    } catch (error) {
      if (error instanceof MediaPipelineError) {
        // A causa decide o destino: licenca/MIME/hash sao permanentes; rede e
        // storage sao transitorios. Nunca projetamos a materia PARCIALMENTE
        // sem a capa que o editor escolheu.
        throw new SafeError(error.code, `midia ${error.mediaId}: ${error.message}`, error.retryable)
      }
      throw error
    }
  }

  const result = await applyProjectionEvent(prisma, {
    event: mapping.event,
    media,
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
  storage: MediaStoragePort,
  dryRun: boolean,
  shutdown: () => ShutdownState,
  onProgress: () => void = () => undefined,
): Promise<number> {
  // Depois do SIGTERM nao se reclama NADA novo: eventos reclamados na janela de
  // encerramento morreriam com lease aberta e ficariam presos ate ela expirar.
  if (!mayClaimMore(shutdown())) return 0

  // Batida ANTES do claim. Um lote grande com midia pode levar minutos; sem
  // batida aqui e por evento, o watchdog de liveness leria "travado" em cima de
  // um worker que esta justamente trabalhando.
  onProgress()
  const events = await claim(config)
  if (events.length === 0) return 0
  const claimedAtIso = new Date().toISOString()

  for (const claimed of events) {
    // O lote inteiro ja foi reclamado — abandona-lo seria pior. Mas COMECAR um
    // item sem tempo de lease sobrando e como convidar outro worker a projetar
    // o mesmo evento em paralelo.
    if (
      !hasLeaseBudget({
        claimedAtIso,
        nowIso: new Date().toISOString(),
        budget: { leaseMs: config.leaseMs, safetyMarginMs: 10_000 },
      })
    ) {
      console.warn(
        `[projecao] ${claimed.eventId}: lease sem folga; devolvido para o proximo ciclo`,
      )
      break
    }
    onProgress()
    try {
      await processEvent(prisma, config, storage, claimed, dryRun)
    } catch (error) {
      // Reconhecimento ESTRUTURAL: a persistencia vive em `src/` e nao pode
      // importar o `SafeError` daqui, mas emite a mesma forma
      // (`ProjectionFailure`). Sem isto, uma falha ja classificada — como
      // `projection_target_missing` — chegaria a outbox como "nao
      // classificada" e perderia o motivo.
      const safe = error instanceof SafeError || isClassifiedFailure(error)
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
    console.error(
      'uso: project-editorial.ts (--once | --loop) [--dry-run] [--allow-production-url]',
    )
    process.exit(2)
  }

  // UMA decisao, lida uma vez. O readiness reavalia a MESMA configuracao; se
  // cada ponto relesse a flag por conta propria, um deles poderia divergir do
  // outro — que foi exatamente o bug: o processo subia autorizado e o `/readyz`
  // reprovava a URL que o processo ja tinha aceitado.
  const allowProductionShapedUrl = args.has('--allow-production-url')

  const resolved = resolveProjectionWorkerConfig(process.env, {
    allowProductionShapedUrl,
  })
  if (!resolved.ok) {
    // So os NOMES das variaveis saem daqui.
    console.error(`[projecao] configuracao invalida: ${resolved.errors.join('; ')}`)
    process.exit(2)
  }
  const config = resolved.config

  const storageResolved = resolveMediaStorageConfig(process.env)
  if (!storageResolved.ok) {
    // Sem storage valido nao ha projecao de midia — e em producao NAO ha
    // fallback para disco: efemero significa publicar hoje e perder a imagem no
    // proximo deploy, com o banco ainda apontando para ela.
    console.error(`[projecao] storage invalido: ${storageResolved.errors.join('; ')}`)
    process.exit(2)
  }
  const storage: MediaStoragePort =
    storageResolved.config.driver === 'local'
      ? createLocalMediaStorage(storageResolved.config)
      : createS3MediaStorage(storageResolved.config)

  const prisma = createPrismaClient({ datasourceUrl: config.screenDatabaseUrl })

  let shutdown: ShutdownState = INITIAL_SHUTDOWN
  const stop = (): void => {
    shutdown = applyShutdownSignal(shutdown, new Date().toISOString())
    console.log('[projecao] sinal recebido: terminando o lote atual e parando de reclamar')
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)

  // SAUDE DO LOOP, separada da saude do processo. Ate aqui as duas eram a mesma
  // coisa: o loop morria, o processo morria junto, e a unica evidencia era o
  // exit 1. Agora o loop sobrevive as falhas e precisa DECLARAR que esta
  // falhando — senao a correcao apenas troca crash-loop visivel por worker
  // parado e invisivel.
  const loopThresholds = resolveLoopHealthThresholds(config)
  let loopHealth: LoopHealthState = initialLoopHealth(new Date().toISOString())
  const noteProgress = (): void => {
    loopHealth = recordLoopProgress(loopHealth, new Date().toISOString())
  }

  // Servidor de health SO no modo continuo: um `--once` de systemd timer vive
  // segundos e nao tem o que expor.
  const healthPort = Number.parseInt(process.env.PUBLICATION_WORKER_HEALTH_PORT ?? '', 10)
  const health =
    loop && Number.isFinite(healthPort) && healthPort > 0
      ? await startWorkerHealthServer({
          port: healthPort,
          workerId: config.workerId,
          // LIVENESS. Continua sem tocar banco, CMS ou storage — uma queda de
          // dependencia externa nao pode virar reinicio, porque reinicio nao
          // levanta a dependencia. O que ENTROU e o watchdog de loop travado:
          // um loop que parou de bater e a unica falha que reinicio resolve, e
          // era invisivel aqui (`phase !== 'stopped'` responde 200 com o loop
          // parado ha horas).
          isAlive: () =>
            shutdown.phase !== 'stopped' &&
            !isLoopStalled(loopHealth, new Date().toISOString(), loopThresholds.stallAfterMs),
          checkReadiness: () =>
            collectWorkerReadiness({
              prisma,
              storage,
              allowProductionShapedUrl,
              // READINESS: "falhando" mora aqui, nao na liveness.
              loopHealth: () =>
                evaluateLoopHealth(loopHealth, new Date().toISOString(), loopThresholds),
            }),
        })
      : null
  if (health !== null) {
    console.log(`[projecao] health em 0.0.0.0:${String(health.port)} (/healthz, /readyz)`)
  }

  console.log(
    `[projecao] worker=${config.workerId} modo=${loop ? 'loop' : 'once'}${dryRun ? ' (dry-run)' : ''}`,
  )

  try {
    if (!loop) {
      // `--once` MANTEM a semantica fatal: um systemd timer precisa que a falha
      // vire exit != 0, senao o ciclo perdido some do journal. Quem nao pode
      // morrer e o processo CONTINUO.
      const processed = await runCycle(prisma, config, storage, dryRun, () => shutdown)
      console.log(`[projecao] ciclo unico concluido: ${String(processed)} evento(s)`)
      return
    }
    while (shutdown.phase === 'running') {
      // O CICLO INTEIRO DENTRO DO try. Antes, o `claim()` ficava fora de
      // qualquer captura: um 500 do CMS, um ECONNREFUSED durante o deploy, um
      // ECONNRESET ou um timeout escapavam do `while`, chegavam ao
      // `main().catch` e matavam o processo com exit 1. O orquestrador
      // reiniciava, o health server subia de novo, e o painel mostrava verde
      // sobre um crash-loop.
      //
      // FALHA DE CICLO NAO E MORTE DE PROCESSO. O CMS estar fora do ar e um
      // estado esperado (ele reinicia em todo deploy); a resposta certa e
      // esperar e tentar de novo, nao suicidar. Quem denuncia a falha
      // persistente e o `/readyz`.
      let processed = 0
      try {
        processed = await runCycle(prisma, config, storage, dryRun, () => shutdown, noteProgress)
        loopHealth = recordCycleSuccess(loopHealth, new Date().toISOString())
      } catch (error) {
        const classified = classifyCycleError(error)
        loopHealth = recordCycleFailure(loopHealth, new Date().toISOString(), classified.code)
        console.error(
          `[projecao] ciclo FALHOU (${classified.code}): ${classified.message}` +
            ` — ${String(loopHealth.consecutiveFailures)} seguida(s); nova tentativa em ${String(
              Math.round(config.pollIntervalMs / 1000),
            )}s`,
        )
        // Falha espera o intervalo cheio antes de tentar de novo. Sem a espera,
        // um CMS fora do ar viraria um laco apertado de ECONNREFUSED queimando
        // CPU e enchendo o log.
        if (shutdown.phase !== 'running') break
        await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs))
        continue
      }

      if (shutdown.phase !== 'running') break
      // Fila vazia espera o intervalo cheio; fila com trabalho volta na hora,
      // para nao arrastar um acumulo em passos de 15s.
      if (processed === 0) {
        await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs))
      }
    }
  } finally {
    shutdown = { phase: 'stopped', signalledAtIso: shutdown.signalledAtIso }
    if (health !== null) await health.close()
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  // No modo `--loop` este caminho passou a ser EXCEPCIONAL: o ciclo trata as
  // proprias falhas. Chegar aqui significa falha de subida (config, storage,
  // health server) ou um defeito de verdade.
  //
  // O log deixou de ser `error.name`. `TypeError` era o que saia para
  // ECONNREFUSED, ECONNRESET, DNS e corpo malformado — quatro causas
  // diferentes com a mesma palavra, e o operador sem como distinguir. O
  // classificador devolve um codigo estavel sem vazar mensagem crua (que
  // carregaria connection string ou header de autorizacao).
  const classified = classifyCycleError(error)
  console.error(`[projecao] erro fatal (${classified.code}): ${classified.message}`)
  process.exit(1)
})
