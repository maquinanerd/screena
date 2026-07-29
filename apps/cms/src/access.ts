/**
 * access.ts — Decisoes de RBAC do CMS. PURO.
 *
 * Toda decisao aqui e tomada a partir do usuario JA AUTENTICADO pelo Payload no
 * servidor. Nada nesta camada le o corpo da requisicao: o papel vem da sessao,
 * nunca do formulario. As funcoes de `access` das collections sao adaptadores
 * finos sobre estas regras, para que a politica seja testavel sem subir o CMS.
 */

import type { EditorialRole } from './workflow.js'
import type { ServiceAccountScope } from './outbox-api.js'

/** Identidade efetiva de quem esta agindo. */
export type Actor =
  | { readonly kind: 'human'; readonly id: string; readonly role: EditorialRole }
  | {
      readonly kind: 'service'
      readonly id: string
      /** Poderes EXPLICITOS. Sem escopo, a conta nao pode nada. */
      readonly scopes: readonly ServiceAccountScope[]
    }
  | { readonly kind: 'anonymous' }

/** Papeis que administram o proprio CMS (usuarios, politicas). */
const ADMIN_ROLES: readonly EditorialRole[] = ['administrator']

/** Papeis que podem publicar/despublicar/retratar. */
const PUBLISHER_ROLES: readonly EditorialRole[] = ['administrator', 'editor_in_chief']

/** Papeis que podem criar e editar conteudo. */
const CONTENT_ROLES: readonly EditorialRole[] = [
  'administrator',
  'editor_in_chief',
  'editor',
  'writer',
]

/** Papeis que podem revisar. */
const REVIEW_ROLES: readonly EditorialRole[] = [
  'administrator',
  'editor_in_chief',
  'editor',
  'reviewer',
]

function isHuman(actor: Actor): actor is Extract<Actor, { kind: 'human' }> {
  return actor.kind === 'human'
}

export function isAdministrator(actor: Actor): boolean {
  return isHuman(actor) && ADMIN_ROLES.includes(actor.role)
}

export function canPublish(actor: Actor): boolean {
  return isHuman(actor) && PUBLISHER_ROLES.includes(actor.role)
}

export function canReview(actor: Actor): boolean {
  return isHuman(actor) && REVIEW_ROLES.includes(actor.role)
}

export function canAuthorContent(actor: Actor): boolean {
  return isHuman(actor) && CONTENT_ROLES.includes(actor.role)
}

/** Service accounts leem/escrevem SOMENTE pelos endpoints internos. */
export function isServiceAccount(actor: Actor): boolean {
  return actor.kind === 'service'
}

/** A conta tecnica possui o escopo exigido? Ausencia de escopo e negacao. */
export function serviceHasScope(actor: Actor, scope: ServiceAccountScope): boolean {
  return actor.kind === 'service' && actor.scopes.includes(scope)
}

/* ------------------------------------------------------------------ */
/* Politicas por collection                                            */
/* ------------------------------------------------------------------ */

/**
 * `articles`.
 *
 * Nota deliberada sobre a service account: ela **cria** artigo (pelo endpoint) e
 * pode atualizar o proprio `automation_draft`, mas NAO le a colecao inteira —
 * um draft humano em revisao nao e assunto de um pipeline externo.
 */
export const articlesAccess = {
  create: (actor: Actor): boolean =>
    canAuthorContent(actor) || serviceHasScope(actor, 'draft_ingest'),
  read: (actor: Actor): boolean => isHuman(actor),
  update: (actor: Actor): boolean =>
    canAuthorContent(actor) || canReview(actor) || serviceHasScope(actor, 'draft_ingest'),
  delete: (actor: Actor): boolean => isAdministrator(actor),
} as const

/** `authors`, `media`: qualquer humano com papel de conteudo cria/edita. */
export const editorialAssetAccess = {
  create: (actor: Actor): boolean => canAuthorContent(actor),
  read: (actor: Actor): boolean => isHuman(actor),
  update: (actor: Actor): boolean => canAuthorContent(actor),
  delete: (actor: Actor): boolean => isAdministrator(actor),
} as const

/** `editorial-users` e `service-accounts`: so administrador. */
export const identityAccess = {
  create: (actor: Actor): boolean => isAdministrator(actor),
  read: (actor: Actor): boolean => isAdministrator(actor),
  update: (actor: Actor): boolean => isAdministrator(actor),
  delete: (actor: Actor): boolean => isAdministrator(actor),
} as const

/**
 * `publication-outbox`: NAO e superficie editorial.
 *
 * Ninguem cria, edita ou apaga evento pela UI — eventos nascem de hook de
 * publicacao. Service accounts nao tocam a outbox: o consumidor dela e o worker
 * de projecao, que nao existe nesta fase e tera credencial propria.
 */
export const outboxAccess = {
  create: (): boolean => false,
  read: (actor: Actor): boolean => isAdministrator(actor),
  update: (): boolean => false,
  delete: (): boolean => false,
} as const

/* ------------------------------------------------------------------ */
/* Campos que a service account NAO pode escrever                      */
/* ------------------------------------------------------------------ */

/**
 * Mesmo criando o artigo, a automacao nunca escreve nestes campos. Publicacao,
 * revisao e retencao legal sao decisoes humanas.
 */
export const SERVICE_ACCOUNT_FORBIDDEN_FIELDS = [
  'workflowStatus',
  'publishedAt',
  'scheduledFor',
  'correctedAt',
  'correctionNote',
  'retractionReason',
  'legalHold',
  'qaPassedAt',
  'authors',
  'primaryAuthor',
  '_status',
] as const

export function serviceAccountMayWriteField(field: string): boolean {
  return !(SERVICE_ACCOUNT_FORBIDDEN_FIELDS as readonly string[]).includes(field)
}
