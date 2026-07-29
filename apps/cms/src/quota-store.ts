/**
 * quota-store.ts — Consumo TRANSACIONAL das quotas de autopublicacao.
 *
 * Tudo aqui roda com o `req` do Payload, portanto dentro da MESMA transacao que
 * cria o artigo, publica e grava a outbox. Isso e o contrato: publicacao
 * confirmada => contador confirmado; qualquer falha depois da reserva =>
 * rollback leva os contadores junto. Nao existe estado "contou e nao publicou".
 *
 * O INCREMENTO E UM UNICO STATEMENT, e isso nao e detalhe de performance.
 *
 * A versao obvia — ler, comparar, escrever — tem duas falhas debaixo de
 * concorrencia real:
 *
 * 1. `SELECT` seguido de `UPDATE` perde incremento. Duas transacoes leem 9,
 *    ambas concluem que cabe mais uma, e o dia fecha com 11 num teto de 10.
 * 2. Criar a primeira linha do dia com `INSERT` e capturar a violacao de unique
 *    e PIOR: no Postgres um erro dentro de transacao interativa a deixa em
 *    estado abortado (25P02), e todo comando seguinte falha com "current
 *    transaction is aborted". O `catch` nao recupera nada — so esconde de onde
 *    veio o estrago. Conflito ESPERADO nao pode virar excecao aqui.
 *
 * `INSERT ... ON CONFLICT DO UPDATE ... WHERE current_count < limite` resolve os
 * dois: cria a linha se ela nao existe, incrementa se existe e cabe, e devolve
 * ZERO linhas se o teto ja foi atingido — sem erro, sem laco de retry e sem
 * janela entre a checagem e a escrita. O `DO UPDATE` reavalia o `WHERE` DEPOIS
 * de travar a linha, entao ele enxerga o valor commitado mais recente, nao o do
 * snapshot em que a transacao comecou.
 *
 * Concorrentes nao competem: o segundo simplesmente espera o primeiro commitar.
 */

import type { PayloadRequest } from 'payload'

import {
  localDateIn,
  nextEligibleAt,
  planQuotaConsumption,
  QUOTA_LIMIT_CODES,
  type QuotaDimension,
  type QuotaPlanInput,
  type QuotaRequest,
} from './quota.js'

export interface QuotaWindow {
  readonly timeZone: string
  readonly localDate: string
  readonly windowStartUtcIso: string
  readonly windowEndUtcIso: string
}

export type QuotaConsumptionResult =
  | { readonly ok: true; readonly consumed: readonly QuotaRequest[] }
  | {
      readonly ok: false
      readonly dimension: QuotaDimension
      readonly code: string
      readonly nextEligibleAtIso: string | null
    }

/** Executor SQL ligado a transacao corrente, quando ha uma. */
interface SqlRunner {
  execute: (query: unknown) => Promise<{ rows?: unknown[] } | unknown[]>
}

/**
 * O handle da TRANSACAO, nao o do pool.
 *
 * O adapter guarda cada transacao aberta em `db.sessions[transactionID]`. Cair
 * no `drizzle` de cima quando ha transacao em curso seria pegar outra conexao:
 * o incremento commitaria sozinho e sobreviveria ao rollback da publicacao —
 * exatamente o estado "contou e nao publicou" que esta fase existe para impedir.
 */
function runnerFor(req: PayloadRequest): SqlRunner {
  const db = req.payload.db as unknown as {
    drizzle?: SqlRunner
    sessions?: Record<string, { db?: SqlRunner } | undefined>
  }
  const transactionId = req.transactionID
  if (transactionId !== undefined && transactionId !== null) {
    const session = db.sessions?.[String(transactionId)]
    if (session?.db !== undefined) return session.db
  }
  if (db.drizzle === undefined) throw new Error('adapter de banco sem executor SQL')
  return db.drizzle
}

function rowsOf(result: { rows?: unknown[] } | unknown[]): unknown[] {
  if (Array.isArray(result)) return result
  return result.rows ?? []
}

/**
 * Consome UMA dimensao. `true` = havia espaco e o contador subiu.
 *
 * Escrito em SQL cru de proposito: `payload.update` nao expressa
 * `ON CONFLICT DO UPDATE`, e qualquer decomposicao em duas chamadas reabre a
 * janela que este statement fecha.
 */
async function consumeDimension(
  req: PayloadRequest,
  window: QuotaWindow,
  entry: QuotaRequest,
): Promise<boolean> {
  const limit = entry.limit
  // Sem teto nao ha o que reservar.
  if (limit === null) return true
  // Teto zero recusa antes de tocar o banco: o `INSERT` criaria a linha com
  // `current_count = 1`, que ja estouraria o limite.
  if (limit < 1) return false

  const { sql } = await import('@payloadcms/db-postgres')
  const runner = runnerFor(req)

  const result = await runner.execute(sql`
    INSERT INTO "autopublish_quota_counters"
      ("time_zone", "local_date", "dimension_type", "dimension_key",
       "current_count", "limit_snapshot", "window_start_utc", "window_end_utc",
       "created_at", "updated_at")
    VALUES (
      ${window.timeZone},
      ${window.localDate},
      ${entry.dimension}::"public"."enum_autopublish_quota_counters_dimension_type",
      ${entry.key},
      1,
      ${limit},
      ${window.windowStartUtcIso}::timestamptz,
      ${window.windowEndUtcIso}::timestamptz,
      now(),
      now()
    )
    ON CONFLICT ("time_zone", "local_date", "dimension_type", "dimension_key")
    DO UPDATE SET
      "current_count" = "autopublish_quota_counters"."current_count" + 1,
      -- O teto VIGENTE fica gravado: um dia auditado precisa saber contra que
      -- limite aquele contador corria, nao contra o limite de hoje.
      "limit_snapshot" = EXCLUDED."limit_snapshot",
      "updated_at" = now()
    WHERE "autopublish_quota_counters"."current_count" < ${limit}
    RETURNING "current_count"
  `)

  // Zero linhas = o teto ja estava atingido. Nao e erro: e a recusa.
  return rowsOf(result).length > 0
}

/**
 * Consome TODAS as dimensoes do pedido, na ordem canonica.
 *
 * Se uma delas nao couber, devolvemos a recusa e NAO desfazemos as anteriores a
 * mao: quem desfaz e o rollback da transacao, que o chamador dispara ao abortar.
 * Compensacao manual aqui abriria a janela exata que a transacao existe para
 * fechar.
 */
export async function consumeQuotas(
  req: PayloadRequest,
  window: QuotaWindow,
  plan: QuotaPlanInput,
): Promise<QuotaConsumptionResult> {
  const entries = planQuotaConsumption(plan)
  const consumed: QuotaRequest[] = []

  for (const entry of entries) {
    const fits = await consumeDimension(req, window, entry)
    if (!fits) {
      return {
        ok: false,
        dimension: entry.dimension,
        code: QUOTA_LIMIT_CODES[entry.dimension],
        nextEligibleAtIso: nextEligibleAt(entry.dimension, window.windowEndUtcIso),
      }
    }
    consumed.push(entry)
  }

  return { ok: true, consumed }
}

/* ------------------------------------------------------------------ */
/* Registro de consumo                                                 */
/* ------------------------------------------------------------------ */

export interface ConsumptionRecordInput {
  readonly requestId: string
  readonly idempotencyKey: string
  readonly sourceClusterId: string
  readonly sourceRevision: number
  readonly articleId: string | null
  readonly publicAuthorId: string
  readonly publicationIntent: 'publish' | 'update'
  readonly window: QuotaWindow
  readonly dimensionsConsumed: readonly QuotaRequest[]
  readonly serviceAccountId: string
  readonly pipelineVersion: string
  readonly consumedAtIso: string
}

/**
 * Grava a prova de QUEM consumiu as quotas.
 *
 * A unique em `requestId` e a segunda linha de defesa da idempotencia: se dois
 * envios do mesmo pedido chegarem juntos e ambos passarem pela consulta previa,
 * a colisao aqui aborta a transacao inteira e nenhum contador sobrevive. Os
 * contadores dizem QUANTO foi usado; este registro diz POR QUE — e sem ele um
 * numero divergente seria impossivel de reconstruir.
 */
export async function recordConsumption(
  req: PayloadRequest,
  input: ConsumptionRecordInput,
): Promise<void> {
  await req.payload.create({
    collection: 'autopublish-quota-usage',
    data: {
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
      sourceClusterId: input.sourceClusterId,
      sourceRevision: input.sourceRevision,
      ...(input.articleId === null ? {} : { articleId: input.articleId }),
      publicAuthorId: input.publicAuthorId,
      publicationIntent: input.publicationIntent,
      localDate: input.window.localDate,
      timeZone: input.window.timeZone,
      dimensionsConsumed: input.dimensionsConsumed.map(
        (entry) => `${entry.dimension}:${entry.key}`,
      ),
      consumedAt: input.consumedAtIso,
      serviceAccountId: input.serviceAccountId,
      pipelineVersion: input.pipelineVersion,
    } as never,
    overrideAccess: true,
    req,
  })
}

/** Um pedido com este `requestId` ja consumiu quota? */
export async function findPreviousConsumption(
  req: PayloadRequest,
  requestId: string,
): Promise<Record<string, unknown> | null> {
  const found = await req.payload.find({
    collection: 'autopublish-quota-usage',
    where: { requestId: { equals: requestId } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    req,
  })
  return (found.docs[0] ?? null) as Record<string, unknown> | null
}

export function localDateForWindow(instantIso: string, timeZone: string): string {
  return localDateIn(instantIso, timeZone)
}
