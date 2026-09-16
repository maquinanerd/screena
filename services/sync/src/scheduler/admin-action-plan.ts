/**
 * admin-action-plan.ts — O QUE cada botao do painel operacional enfileira. PURO.
 *
 * ============================================================================
 * O PAINEL NAO EXECUTA NADA
 * ============================================================================
 * Nenhum botao chama API, roda CLI ou espera trabalho. Ele ENFILEIRA, e quem
 * executa e quem ja executa hoje:
 *
 *   detalhe | midia | temporadas -> `catalog_jobs`             -> screen-catalog-worker
 *   nota | score | forcar fila   -> `scheduler_force_requests` -> screen-cron
 *
 * Nota e Score nao entram em `catalog_jobs` porque nao ha tipo de job para eles,
 * e quem ja guarda a credencial da OMDb e ja roda essas CLIs e o `screen-cron`.
 *
 * ============================================================================
 * POR QUE O ESCOPO E `admin:<token>`
 * ============================================================================
 * A chave de idempotencia de um job de catalogo e
 * `<tipo>:<entidade>:<id>:<discriminador>`. Sem escopo proprio, o botao
 * "atualizar detalhe" do painel teria a MESMA chave do job que o agendador ja
 * enfileirou hoje — o INSERT viraria noop e o botao nao faria nada, com cara de
 * sucesso. E o defeito que congelou o catalogo em 2026-08 (ver
 * `scopedChildDiscriminator`), agora na ponta do dono.
 *
 * O token e o NONCE do formulario de confirmacao, gerado a cada tela de
 * confirmacao. Ele e propriedade da DECISAO do dono, nao da tentativa: a
 * retentativa do worker reusa a mesma chave (idempotente), e o mesmo formulario
 * confirmado duas vezes e barrado pelo unique de `admin_action_audits`. Dois
 * formularios distintos sao duas decisoes, e cada uma cria trabalho novo.
 *
 * Os filhos HERDAM o escopo (o `window` do payload), entao a cascata inteira do
 * titulo refaz — e e isso que a estimativa de custo mostra antes do clique.
 *
 * ============================================================================
 * O `sync_details` NAO E MONTADO AQUI
 * ============================================================================
 * Ele sai de `buildCoverageJob`, a porta unica de cobertura, com motivo
 * `on_demand` (prioridade 10: ha uma pessoa esperando). O validador do worker
 * confere o payload ANTES de gravar: um job malformado so falharia depois de
 * reivindicado.
 */

import { buildCoverageJob, COVERAGE_PRIORITY } from '@screena/ingestion/coverage-entry'
import { buildIdempotencyKey, scopedChildDiscriminator } from '@screena/ingestion/job-idempotency'
import {
  EPISODE_MEDIA_SEASONS_FIELD,
  JOB_SCOPE_FIELD,
  validateJobPayload,
} from '@screena/ingestion/job-payload'

import { SCHEDULER_QUEUES, type SchedulerQueue } from './rhythms.js'

/** O nonce do formulario de confirmacao. Espelha o CHECK de `admin_action_audits`. */
export const ADMIN_REQUEST_TOKEN_PATTERN = /^[0-9a-f]{24}$/

/** O idioma das acoes do painel (o idioma publicado). */
export const ADMIN_FORCE_LOCALE = 'pt-BR'

/** Prefixo do escopo e do `run_id` de tudo que o painel enfileira. */
export const ADMIN_SCOPE_PREFIX = 'admin:'

/** As acoes sobre UM titulo, na ordem da tela. */
export const ADMIN_TITLE_ACTIONS = ['detalhe', 'midia', 'temporadas', 'nota', 'score'] as const

/** Uma acao sobre um titulo. */
export type AdminTitleAction = (typeof ADMIN_TITLE_ACTIONS)[number]

/** As acoes que viram job de catalogo. */
export type AdminCatalogAction = Extract<AdminTitleAction, 'detalhe' | 'midia' | 'temporadas'>

/** Os valores de `admin_action_audits.action_kind`. Espelha o CHECK da migration. */
export const ADMIN_ACTION_KINDS = [
  'force_title_detail',
  'force_title_media',
  'force_title_seasons',
  'force_title_ratings',
  'force_title_score',
  'force_queue',
] as const

/** Um tipo de acao auditada. */
export type AdminActionKind = (typeof ADMIN_ACTION_KINDS)[number]

/** A acao auditada de cada botao de titulo. */
export const ADMIN_ACTION_KIND_BY_TITLE_ACTION: Readonly<Record<AdminTitleAction, AdminActionKind>> = {
  detalhe: 'force_title_detail',
  midia: 'force_title_media',
  temporadas: 'force_title_seasons',
  nota: 'force_title_ratings',
  score: 'force_title_score',
}

/** O tipo de job de cada acao de catalogo. */
export const ADMIN_CATALOG_JOB_TYPE = {
  detalhe: 'sync_details',
  midia: 'sync_media',
  temporadas: 'sync_seasons',
} as const satisfies Readonly<Record<AdminCatalogAction, string>>

/** Os titulos que o painel sabe forcar. */
export type AdminTitleKind = 'movie' | 'tv'

/** O token e um nonce valido? */
export function isAdminRequestToken(value: unknown): value is string {
  return typeof value === 'string' && ADMIN_REQUEST_TOKEN_PATTERN.test(value)
}

/** A acao e uma acao de titulo conhecida? */
export function isAdminTitleAction(value: unknown): value is AdminTitleAction {
  return typeof value === 'string' && (ADMIN_TITLE_ACTIONS as readonly string[]).includes(value)
}

/** A acao vira job de catalogo? */
export function isAdminCatalogAction(action: AdminTitleAction): action is AdminCatalogAction {
  return action === 'detalhe' || action === 'midia' || action === 'temporadas'
}

/** O escopo (e `run_id`) de uma decisao do dono. */
export function adminScope(token: string): string {
  return `${ADMIN_SCOPE_PREFIX}${token}`
}

/** O job planejado. */
export type PlannedCatalogJob = ReturnType<typeof buildCoverageJob>

/** O plano de uma acao de catalogo: o job, ou o motivo da recusa. */
export type CatalogJobPlan =
  | { readonly ok: true; readonly job: PlannedCatalogJob }
  | { readonly ok: false; readonly reason: string }

/**
 * Monta o job de UMA acao de catalogo. Recusa com motivo — nunca devolve um job
 * que o worker recusaria.
 */
export function planAdminCatalogJob(input: {
  readonly action: AdminCatalogAction
  readonly kind: AdminTitleKind
  readonly tmdbId: number
  readonly token: string
}): CatalogJobPlan {
  if (!isAdminRequestToken(input.token)) {
    return { ok: false, reason: 'token de confirmacao invalido' }
  }
  if (input.kind !== 'movie' && input.kind !== 'tv') {
    return { ok: false, reason: 'o painel so forca filme ou serie' }
  }
  if (!Number.isInteger(input.tmdbId) || input.tmdbId <= 0) {
    return { ok: false, reason: 'titulo sem tmdb_id valido' }
  }

  const scope = adminScope(input.token)
  const externalId = String(input.tmdbId)
  let job: PlannedCatalogJob

  switch (input.action) {
    case 'detalhe':
      // A porta unica: o pai da cascata inteira (detalhe -> midia -> temporadas).
      job = buildCoverageJob({
        kind: input.kind,
        tmdbId: input.tmdbId,
        locale: ADMIN_FORCE_LOCALE,
        reason: 'on_demand',
        scope,
        runId: scope,
      })
      break
    case 'midia':
      job = {
        jobType: ADMIN_CATALOG_JOB_TYPE.midia,
        entityType: input.kind,
        externalId,
        idempotencyKey: buildIdempotencyKey({
          jobType: ADMIN_CATALOG_JOB_TYPE.midia,
          entityType: input.kind,
          externalId,
          discriminator: scopedChildDiscriminator(ADMIN_FORCE_LOCALE, scope),
        }),
        payload: {
          entityType: input.kind,
          tmdbId: input.tmdbId,
          locale: ADMIN_FORCE_LOCALE,
          [JOB_SCOPE_FIELD]: scope,
        },
        priority: COVERAGE_PRIORITY.on_demand,
        runId: scope,
      }
      break
    case 'temporadas':
      if (input.kind !== 'tv') return { ok: false, reason: 'filme nao tem temporadas' }
      job = {
        jobType: ADMIN_CATALOG_JOB_TYPE.temporadas,
        entityType: 'tv',
        externalId,
        idempotencyKey: buildIdempotencyKey({
          jobType: ADMIN_CATALOG_JOB_TYPE.temporadas,
          entityType: 'tv',
          externalId,
          discriminator: scopedChildDiscriminator(ADMIN_FORCE_LOCALE, scope),
        }),
        payload: {
          tmdbId: input.tmdbId,
          locale: ADMIN_FORCE_LOCALE,
          enqueueEpisodes: true,
          enqueueSeasonMedia: true,
          // O dono pediu AS temporadas: todas, com a midia de cada episodio. O
          // recorte `latest` e da cascata automatica, nao de quem clicou.
          [EPISODE_MEDIA_SEASONS_FIELD]: 'all',
          [JOB_SCOPE_FIELD]: scope,
        },
        priority: COVERAGE_PRIORITY.on_demand,
        runId: scope,
      }
      break
  }

  try {
    validateJobPayload(job.jobType, job.payload)
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'payload invalido'
    return { ok: false, reason: `o validador do worker recusaria o payload: ${reason}` }
  }
  return { ok: true, job }
}

/** O plano de um pedido ao agendador. */
export type SchedulerRequestPlan =
  | { readonly ok: true; readonly kind: 'queue'; readonly queue: SchedulerQueue }
  | {
      readonly ok: true
      readonly kind: 'title_ratings' | 'title_score'
      readonly entityType: AdminTitleKind
      readonly entityId: string
    }
  | { readonly ok: false; readonly reason: string }

const ENTITY_ID_PATTERN = /^[1-9]\d{0,18}$/

/** Valida um pedido ao agendador antes de grava-lo. */
export function planAdminSchedulerRequest(
  input:
    | { readonly kind: 'queue'; readonly queue: string }
    | { readonly kind: 'title_ratings' | 'title_score'; readonly entityType: string; readonly entityId: string },
): SchedulerRequestPlan {
  if (input.kind === 'queue') {
    if (!(SCHEDULER_QUEUES as readonly string[]).includes(input.queue)) {
      return { ok: false, reason: `fila desconhecida: ${input.queue.slice(0, 40)}` }
    }
    return { ok: true, kind: 'queue', queue: input.queue as SchedulerQueue }
  }
  if (input.entityType !== 'movie' && input.entityType !== 'tv') {
    return { ok: false, reason: 'o painel so forca nota e score de filme ou serie' }
  }
  if (!ENTITY_ID_PATTERN.test(input.entityId)) {
    return { ok: false, reason: 'id de titulo invalido' }
  }
  return { ok: true, kind: input.kind, entityType: input.entityType, entityId: input.entityId }
}
