/**
 * workflow.ts — FONTE UNICA do ciclo de vida editorial DO CMS. PURO.
 *
 * Por que uma fonte propria, e nao a de `services/news-ingestion`:
 * aquela maquina governa `article_translations`, o registro da PROJECAO PUBLICA,
 * e nao conhece os estados que so existem na redacao (`automation_draft`,
 * `in_review`, `changes_requested`, `ready_to_publish`). Reutiliza-la aqui
 * repetiria o erro ja corrigido no ADR 0016: mesmo vocabulario, dominio
 * diferente. As duas maquinas coexistem e se encontram no
 * `publication-event-v1`, nao no codigo.
 *
 * `_status` do Payload (draft|published) NAO e usado como estado editorial: ele
 * tem dois valores e o fluxo real tem doze. `workflowStatus` e a verdade.
 */

/* ------------------------------------------------------------------ */
/* Estados                                                             */
/* ------------------------------------------------------------------ */

export const WORKFLOW_STATUSES = [
  /** Criado por service account via editorial-draft-v1. Nunca por humano. */
  'automation_draft',
  'draft',
  'needs_review',
  'in_review',
  'changes_requested',
  'human_reviewed',
  'ready_to_publish',
  'published',
  'needs_update',
  'blocked',
  'archived',
  'retracted',
] as const

export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number]

/** Papeis humanos. `automation` NAO esta aqui: e outra collection. */
export const EDITORIAL_ROLES = [
  'administrator',
  'editor_in_chief',
  'editor',
  'reviewer',
  'writer',
] as const

export type EditorialRole = (typeof EDITORIAL_ROLES)[number]

/**
 * Ator de uma transicao.
 *
 * As duas contas tecnicas sao ATORES DIFERENTES, nao a mesma com permissoes a
 * mais:
 *
 *   `service`              — ingestao de rascunho (`draft_ingest`). Nunca
 *                            publica; confinada a `automation_draft`.
 *   `automation_publisher` — autopublicacao (`editorial_auto_publish`).
 *
 * Separar importa porque a alternativa seria afrouxar `service`, e ai a conta
 * que so deveria ingerir rascunho herdaria o poder de publicar por tabela.
 */
export type ActorKind = EditorialRole | 'service' | 'automation_publisher'

/* ------------------------------------------------------------------ */
/* Transicoes                                                          */
/* ------------------------------------------------------------------ */

/**
 * Allowlist de transicao. Tudo que nao esta aqui e recusado — a tabela e a lista
 * de permissoes, nunca de proibicoes.
 *
 * Pontos que NAO sao acidentais:
 *  - `automation_draft` alcanca `ready_to_publish` — e SO por ali chega a
 *    `published`, porque o gate de publicacao roda nessa aresta. O caminho e
 *    exclusivo do `automation_publisher` (ver `ROLES_ALLOWED_TO_REACH`);
 *  - a automacao NAO atravessa `in_review` nem `human_reviewed`: passar por
 *    esses estados gravaria que um humano revisou quando nenhum revisou;
 *  - `published` so vem de `ready_to_publish` (o gate de publicacao roda la);
 *  - `blocked`/`retracted` voltam so para `needs_review`: republicar sem nova
 *    revisao exatamente o que foi retirado e o pior desfecho possivel;
 *  - `archived` e terminal para o fluxo de publicacao.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<WorkflowStatus, readonly WorkflowStatus[]>> = {
  automation_draft: ['draft', 'needs_review', 'ready_to_publish', 'blocked', 'archived'],
  draft: ['needs_review', 'blocked', 'archived'],
  needs_review: ['in_review', 'changes_requested', 'draft', 'blocked', 'archived'],
  in_review: ['human_reviewed', 'changes_requested', 'needs_review', 'blocked', 'archived'],
  changes_requested: ['draft', 'needs_review', 'blocked', 'archived'],
  human_reviewed: ['ready_to_publish', 'changes_requested', 'needs_review', 'blocked', 'archived'],
  ready_to_publish: ['published', 'changes_requested', 'human_reviewed', 'blocked', 'archived'],
  published: ['needs_update', 'blocked', 'retracted', 'archived'],
  needs_update: ['needs_review', 'in_review', 'ready_to_publish', 'blocked', 'archived'],
  blocked: ['needs_review', 'archived'],
  archived: ['needs_review'],
  retracted: ['needs_review', 'archived'],
}

/**
 * Quem pode EXECUTAR a transicao para cada estado de destino.
 *
 * A regra decisiva: entre humanos, `published` so por `editor_in_chief` e
 * `administrator`. `editor` nao publica — a decisao ja esta documentada e nao e
 * reaberta aqui. `service` so alcanca `automation_draft`.
 *
 * `automation_publisher` alcanca `needs_review`, `ready_to_publish`,
 * `published` e `needs_update` — e mais nada. Fora dessa lista ficam
 * deliberadamente `in_review` e `human_reviewed` (afirmariam revisao humana
 * inexistente) e `blocked`, `archived` e `retracted` (tirar do ar e decisao
 * humana; uma automacao em loop nao pode despublicar sozinha).
 */
const ROLES_ALLOWED_TO_REACH: Readonly<Record<WorkflowStatus, readonly ActorKind[]>> = {
  automation_draft: ['service', 'administrator', 'automation_publisher'],
  draft: ['administrator', 'editor_in_chief', 'editor', 'writer'],
  needs_review: ['administrator', 'editor_in_chief', 'editor', 'writer', 'reviewer', 'automation_publisher'],
  in_review: ['administrator', 'editor_in_chief', 'editor', 'reviewer'],
  changes_requested: ['administrator', 'editor_in_chief', 'editor', 'reviewer'],
  human_reviewed: ['administrator', 'editor_in_chief', 'editor', 'reviewer'],
  ready_to_publish: ['administrator', 'editor_in_chief', 'editor', 'automation_publisher'],
  published: ['administrator', 'editor_in_chief', 'automation_publisher'],
  needs_update: ['administrator', 'editor_in_chief', 'editor', 'automation_publisher'],
  blocked: ['administrator', 'editor_in_chief'],
  archived: ['administrator', 'editor_in_chief'],
  retracted: ['administrator', 'editor_in_chief'],
}

export type TransitionRejection =
  | 'same_state'
  | 'unknown_state'
  | 'forbidden_transition'
  | 'forbidden_for_role'

export type TransitionVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: TransitionRejection; readonly detail: string }

function isWorkflowStatus(value: string): value is WorkflowStatus {
  return (WORKFLOW_STATUSES as readonly string[]).includes(value)
}

/** A transicao e legitima PARA ESTE ATOR? */
export function canTransition(from: string, to: string, actor: ActorKind): TransitionVerdict {
  if (!isWorkflowStatus(from)) {
    return { allowed: false, reason: 'unknown_state', detail: `estado de origem invalido: ${from}` }
  }
  if (!isWorkflowStatus(to)) {
    return { allowed: false, reason: 'unknown_state', detail: `estado de destino invalido: ${to}` }
  }
  if (from === to) {
    return { allowed: false, reason: 'same_state', detail: 'transicao para o mesmo estado' }
  }
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    return { allowed: false, reason: 'forbidden_transition', detail: `transicao proibida: ${from} -> ${to}` }
  }
  if (!ROLES_ALLOWED_TO_REACH[to].includes(actor)) {
    return {
      allowed: false,
      reason: 'forbidden_for_role',
      detail: `papel "${actor}" nao pode levar um artigo a "${to}"`,
    }
  }
  return { allowed: true }
}

/* ------------------------------------------------------------------ */
/* Gate de publicacao                                                  */
/* ------------------------------------------------------------------ */

/** Fatos exigidos para PUBLICAR (nao para salvar rascunho). */
export interface PublishGateInput {
  readonly workflowStatus: string
  readonly slug: string | null
  readonly title: string | null
  readonly language: string | null
  /** Autores ATIVOS ligados ao artigo. Autor inativo nao conta. */
  readonly activeAuthorCount: number
  /** Erros bloqueantes do QA. Qualquer um impede a publicacao. */
  readonly blockingErrors: readonly string[]
  readonly qaPassedAt: string | null
  readonly aiAssisted: boolean
  readonly externalSourceCount: number
  /** Itens de midia anexados que NAO estao autorizados para o uso pretendido. */
  readonly unauthorizedMediaCount: number
  readonly legalHold: boolean
}

export type PublishBlockReason =
  | 'not_ready_to_publish'
  | 'missing_slug'
  | 'missing_title'
  | 'missing_language'
  | 'missing_active_author'
  | 'qa_not_passed'
  | 'has_blocking_errors'
  | 'ai_assisted_without_sources'
  | 'unauthorized_media'
  | 'legal_hold'

export interface PublishGateResult {
  readonly canPublish: boolean
  readonly reasons: readonly PublishBlockReason[]
}

/**
 * Gate de publicacao. Roda no SERVIDOR, sobre o estado lido do banco — nunca
 * sobre o que o formulario afirma.
 */
export function evaluatePublishGate(input: PublishGateInput): PublishGateResult {
  const reasons: PublishBlockReason[] = []

  if (input.workflowStatus !== 'ready_to_publish') reasons.push('not_ready_to_publish')
  if ((input.slug ?? '').trim() === '') reasons.push('missing_slug')
  if ((input.title ?? '').trim() === '') reasons.push('missing_title')
  if ((input.language ?? '').trim() === '') reasons.push('missing_language')
  if (!Number.isFinite(input.activeAuthorCount) || input.activeAuthorCount < 1) {
    reasons.push('missing_active_author')
  }
  if ((input.qaPassedAt ?? '').trim() === '') reasons.push('qa_not_passed')
  if (input.blockingErrors.length > 0) reasons.push('has_blocking_errors')
  // Materia assistida por IA sem nenhuma fonte declarada e parafrase sem lastro.
  if (input.aiAssisted && input.externalSourceCount < 1) {
    reasons.push('ai_assisted_without_sources')
  }
  if (input.unauthorizedMediaCount > 0) reasons.push('unauthorized_media')
  if (input.legalHold) reasons.push('legal_hold')

  return { canPublish: reasons.length === 0, reasons }
}

/* ------------------------------------------------------------------ */
/* Eventos derivados de transicao                                      */
/* ------------------------------------------------------------------ */

import type { PublicationEventType } from '@screena/editorial-contracts'

/**
 * Fatos alem do par de estados que a decisao de evento precisa conhecer.
 *
 * `alreadyPublishedOnce` existe porque o par de estados NAO basta para
 * distinguir primeira publicacao de atualizacao. O caminho de reedicao real e
 * `published -> needs_update -> ... -> ready_to_publish -> published`: quando a
 * transicao final acontece, `from` e `ready_to_publish` — exatamente igual ao
 * de uma estreia. Decidir so por `from === 'needs_update'` deixava a regra
 * inalcancavel na pratica (a allowlist nao permite `needs_update -> published`
 * direto), e toda reedicao anunciava "publicado pela primeira vez" de novo para
 * a mesma URL.
 *
 * O fato vem de fora porque so quem tem o historico sabe responde-lo; o modulo
 * puro nao consulta banco nem fila.
 */
export interface PublicationEventContext {
  readonly alreadyPublishedOnce?: boolean
}

/**
 * Uma transicao gera evento de publicacao? Qual?
 *
 * `null` significa "movimento interno da redacao": o lado publico nao precisa
 * saber que um texto saiu de `draft` para `needs_review`.
 */
export function publicationEventForTransition(
  from: WorkflowStatus,
  to: WorkflowStatus,
  context: PublicationEventContext = {},
): PublicationEventType | null {
  if (to === 'published') {
    // Materia que JA foi publica alguma vez: e atualizacao, nao estreia.
    // Emitir `published` de novo criaria um segundo "publicado pela primeira
    // vez" para a mesma URL.
    const republication = from === 'needs_update' || context.alreadyPublishedOnce === true
    return republication ? 'article.updated' : 'article.published'
  }
  if (from === 'published' && to === 'retracted') return 'article.retracted'
  if (to === 'blocked' || to === 'archived') {
    // Saindo DIRETO de `published`, a remocao e obvia. Mas a materia continua
    // NO AR durante toda a reedicao (`published -> needs_update -> needs_review
    // -> ...`): so um evento de remocao a tira de la. Decidir apenas por
    // `from === 'published'` deixava o caminho `needs_update -> blocked` mudo —
    // o CMS dizia "blocked" e o lado publico continuava servindo a materia
    // para sempre. Por isso: bloquear/arquivar QUALQUER artigo que ja foi
    // publicado emite `article.unpublished`. Emissao redundante (artigo ja
    // rebaixado no lado publico) e inofensiva — a remocao na projecao e
    // idempotente e a fila dedupa por idempotencyKey; remocao FALTANDO e uma
    // materia orfa no ar.
    if (from === 'published') return 'article.unpublished'
    return context.alreadyPublishedOnce === true ? 'article.unpublished' : null
  }
  return null
}

/** Estados em que a redacao considera a materia NO AR (ou voltando ao ar). */
const ON_AIR_STATUSES: readonly WorkflowStatus[] = ['published', 'needs_update']

export type ArticleDeleteVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly detail: string }

/**
 * Excluir um artigo do CMS e permitido neste estado?
 *
 * Excluir NAO despublica: o documento some do Payload, mas a projecao no banco
 * publico continua servindo a materia — e sem documento nao ha mais transicao
 * de workflow capaz de emitir o evento de remocao. Foi exatamente o caso do
 * article 41: apagado no admin, orfao no ar.
 *
 * Regra: materia em estado de ar (`published`, `needs_update`) nao pode ser
 * excluida — o operador precisa antes retratar/bloquear/arquivar (transicoes
 * que emitem `article.retracted`/`article.unpublished`). Nos demais estados a
 * exclusao segue permitida (rascunho nunca publicado nao tem projecao; artigo
 * ja retratado/bloqueado/arquivado ja teve a remocao anunciada — e o
 * `afterDelete` ainda emite a rede de seguranca para qualquer artigo que ja
 * foi publicado um dia).
 */
export function articleDeleteVerdict(status: WorkflowStatus): ArticleDeleteVerdict {
  if (ON_AIR_STATUSES.includes(status)) {
    return {
      allowed: false,
      detail:
        `excluir nao despublica: a materia esta "${status}" e continuaria no ar, orfa, no lado publico. ` +
        'Retrate (retracted), bloqueie (blocked) ou arquive (archived) antes — essas transicoes emitem o evento que tira a materia do ar.',
    }
  }
  return { allowed: true }
}
