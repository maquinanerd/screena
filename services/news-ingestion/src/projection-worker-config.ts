/**
 * projection-worker-config.ts — Fronteira de configuracao do worker de
 * projecao editorial. PURO (recebe o ambiente, nao le `process.env`).
 *
 * Este worker e o UNICO processo que fala com os dois lados, e a ponte e
 * ASSIMETRICA: le a outbox do CMS pela API interna (HTTP) e escreve no banco
 * publico por Prisma. Ele NAO abre conexao com o banco do CMS. Por isso a
 * fronteira e explicita e desconfiada:
 *
 *  - o banco publico vem de `SCREEN_DATABASE_URL`, nunca de `PAYLOAD_DATABASE_URL`;
 *  - as duas URLs NAO podem ser a mesma (seria o CMS escrevendo no banco publico
 *    direto, exatamente o acoplamento que a outbox existe para impedir);
 *  - nenhum valor e ecoado em erro, log ou mensagem — so o NOME da variavel.
 */

export interface ProjectionWorkerConfig {
  /** Banco publico (screen-db). */
  readonly screenDatabaseUrl: string
  /** Base do CMS para os endpoints internos da outbox. */
  readonly payloadInternalServiceUrl: string
  /** Credencial da service account com escopo `publication_projection`. */
  readonly projectionApiKey: string
  /** Slug da colecao de contas tecnicas (compoe o header do Payload). */
  readonly projectionApiKeyCollection: string
  /** Identidade deste processo — vai para `lockedBy` e para o recibo. */
  readonly workerId: string
  readonly batchSize: number
  readonly leaseMs: number
  /** Intervalo entre ciclos no modo continuo. */
  readonly pollIntervalMs: number
  readonly requestTimeoutMs: number
}

export type ConfigResult =
  | { readonly ok: true; readonly config: ProjectionWorkerConfig }
  | { readonly ok: false; readonly errors: readonly string[] }

/** Nomes de banco que NUNCA podem ser alvo de um worker rodado a mao. */
const PRODUCTION_SHAPES = /rss_prime|_prod\b|production/i

function intOr(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Valida o ambiente do worker.
 *
 * Nenhuma mensagem de erro carrega valor: uma configuracao errada nao pode
 * virar vazamento de credencial no log de um systemd timer.
 */
export function resolveProjectionWorkerConfig(
  env: Record<string, string | undefined>,
  options: { readonly allowProductionShapedUrl?: boolean } = {},
): ConfigResult {
  const errors: string[] = []

  const screenDatabaseUrl = (env.SCREEN_DATABASE_URL ?? '').trim()
  if (screenDatabaseUrl === '') {
    errors.push('SCREEN_DATABASE_URL ausente')
  } else if (
    options.allowProductionShapedUrl !== true &&
    PRODUCTION_SHAPES.test(screenDatabaseUrl)
  ) {
    // O `.env` local deste repositorio ja apontou para producao. Um worker que
    // projeta conteudo publico nao pode descobrir isso rodando.
    errors.push('SCREEN_DATABASE_URL parece apontar para producao; recusado')
  }

  // A separacao de bancos e o coracao do ADR 0015. Se as duas URLs coincidirem,
  // o isolamento do CMS ja nao existe e nada aqui deve rodar.
  const payloadDatabaseUrl = (env.PAYLOAD_DATABASE_URL ?? '').trim()
  if (payloadDatabaseUrl !== '' && payloadDatabaseUrl === screenDatabaseUrl) {
    errors.push('SCREEN_DATABASE_URL e PAYLOAD_DATABASE_URL sao o MESMO banco; recusado')
  }

  const payloadInternalServiceUrl = (env.PAYLOAD_INTERNAL_SERVICE_URL ?? '').trim()
  if (payloadInternalServiceUrl === '') {
    errors.push('PAYLOAD_INTERNAL_SERVICE_URL ausente')
  } else if (!isHttpUrl(payloadInternalServiceUrl)) {
    errors.push('PAYLOAD_INTERNAL_SERVICE_URL nao e uma URL http(s) valida')
  }

  const projectionApiKey = (env.PAYLOAD_PROJECTION_API_KEY ?? '').trim()
  if (projectionApiKey === '') errors.push('PAYLOAD_PROJECTION_API_KEY ausente')

  const workerId = (env.PROJECTION_WORKER_ID ?? '').trim()
  if (workerId === '') errors.push('PROJECTION_WORKER_ID ausente')

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    config: {
      screenDatabaseUrl,
      payloadInternalServiceUrl: payloadInternalServiceUrl.replace(/\/+$/, ''),
      projectionApiKey,
      projectionApiKeyCollection: (env.PAYLOAD_PROJECTION_API_KEY_COLLECTION ?? '')
        .trim() || 'service-accounts',
      workerId,
      batchSize: intOr(env.PROJECTION_BATCH_SIZE, 10, 1, 25),
      leaseMs: intOr(env.PROJECTION_LEASE_MS, 60_000, 5_000, 600_000),
      pollIntervalMs: intOr(env.PROJECTION_POLL_INTERVAL_MS, 15_000, 1_000, 600_000),
      requestTimeoutMs: intOr(env.PROJECTION_REQUEST_TIMEOUT_MS, 20_000, 1_000, 120_000),
    },
  }
}

/**
 * Header de autorizacao do Payload para chave de API.
 *
 * Formato exigido pelo Payload: `<collection-slug> API-Key <key>`. Fica isolado
 * numa funcao para que nenhum ponto do worker precise concatenar a credencial a
 * mao (e acabar loga-la por engano num template de erro).
 */
export function projectionAuthHeader(config: ProjectionWorkerConfig): string {
  return `${config.projectionApiKeyCollection} API-Key ${config.projectionApiKey}`
}
