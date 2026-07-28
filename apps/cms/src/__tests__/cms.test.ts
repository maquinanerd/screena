/**
 * Testes do nucleo puro do CMS: isolamento de banco, RBAC, workflow,
 * idempotencia, entrada de drafts e outbox.
 *
 * Nenhum deles sobe Payload ou banco: a decisao toda vive em modulos puros, e e
 * exatamente por isso que ela e testavel aqui.
 */

import { describe, expect, it } from 'vitest'

import { validEditorialDraft, validPublicationEvent } from '@screena/editorial-contracts'

import {
  SERVICE_ACCOUNT_FORBIDDEN_FIELDS,
  articlesAccess,
  canPublish,
  identityAccess,
  outboxAccess,
  serviceAccountMayWriteField,
  type Actor,
} from '../access.js'
import { assertNoHumanDecisionFields, intakeEditorialDraft } from '../draft-intake.js'
import { validateCmsConfig } from '../env.js'
import { buildDraftIdentity, canonicalHash, decideIdempotency } from '../idempotency.js'
import { buildEventIdempotencyKey, buildOutboxRecord, shouldSkipDuplicateEvent } from '../outbox.js'
import { canTransition, evaluatePublishGate, publicationEventForTransition } from '../workflow.js'

const SAFE_DB = 'postgresql://cms:cms@127.0.0.1:5599/cinerie_cms_test'
const SECRET = 'a'.repeat(40)

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const admin: Actor = { kind: 'human', id: 'u1', role: 'administrator' }
const chief: Actor = { kind: 'human', id: 'u2', role: 'editor_in_chief' }
const editor: Actor = { kind: 'human', id: 'u3', role: 'editor' }
const reviewer: Actor = { kind: 'human', id: 'u4', role: 'reviewer' }
const writer: Actor = { kind: 'human', id: 'u5', role: 'writer' }
const service: Actor = { kind: 'service', id: 's1' }
const anon: Actor = { kind: 'anonymous' }

/* ------------------------------------------------------------------ */
/* Isolamento de banco                                                 */
/* ------------------------------------------------------------------ */

describe('isolamento do banco do CMS', () => {
  it('aceita uma configuracao isolada valida', () => {
    const result = validateCmsConfig({ PAYLOAD_DATABASE_URL: SAFE_DB, PAYLOAD_SECRET: SECRET })
    expect(result.ok).toBe(true)
  })

  it('recusa PAYLOAD_DATABASE_URL ausente — DATABASE_URL nunca e fallback', () => {
    const result = validateCmsConfig({
      PAYLOAD_SECRET: SECRET,
      DATABASE_URL: 'postgresql://x:y@host/screen',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.map((e) => e.code)).toContain('missing_payload_database_url')
    }
  })

  it('recusa segredo ausente ou fraco', () => {
    expect(validateCmsConfig({ PAYLOAD_DATABASE_URL: SAFE_DB }).ok).toBe(false)
    const weak = validateCmsConfig({ PAYLOAD_DATABASE_URL: SAFE_DB, PAYLOAD_SECRET: 'curto' })
    expect(weak.ok).toBe(false)
    if (!weak.ok) expect(weak.errors.map((e) => e.code)).toContain('weak_payload_secret')
  })

  it('recusa PAYLOAD_DATABASE_URL identica a DATABASE_URL', () => {
    const result = validateCmsConfig({
      PAYLOAD_DATABASE_URL: SAFE_DB,
      DATABASE_URL: SAFE_DB,
      PAYLOAD_SECRET: SECRET,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.map((e) => e.code)).toContain(
        'payload_database_url_equals_database_url',
      )
    }
  })

  it('recusa URL que aparenta ser banco publico do Cinerie', () => {
    for (const url of [
      'postgresql://u:p@db/rss_prime_screen-db',
      'postgresql://u:p@screen-db:5432/app',
      'postgresql://u:p@host/cinerie_db_prod',
      'postgresql://u:p@production-host/x',
    ]) {
      const result = validateCmsConfig({ PAYLOAD_DATABASE_URL: url, PAYLOAD_SECRET: SECRET })
      expect(result.ok, `deveria recusar: ${url}`).toBe(false)
    }
  })

  it('nunca ecoa a URL nem o segredo nas mensagens de erro', () => {
    const result = validateCmsConfig({
      PAYLOAD_DATABASE_URL: 'postgresql://user:SENHA-SECRETA@screen-db/app',
      PAYLOAD_SECRET: 'SEGREDO-LITERAL',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const joined = JSON.stringify(result.errors)
      expect(joined).not.toContain('SENHA-SECRETA')
      expect(joined).not.toContain('SEGREDO-LITERAL')
    }
  })
})

/* ------------------------------------------------------------------ */
/* RBAC                                                                */
/* ------------------------------------------------------------------ */

describe('RBAC', () => {
  it('so editor_in_chief e administrator publicam', () => {
    expect(canPublish(admin)).toBe(true)
    expect(canPublish(chief)).toBe(true)
    expect(canPublish(editor)).toBe(false)
    expect(canPublish(reviewer)).toBe(false)
    expect(canPublish(writer)).toBe(false)
    expect(canPublish(service)).toBe(false)
    expect(canPublish(anon)).toBe(false)
  })

  it('anonimo e bloqueado em todas as collections', () => {
    expect(articlesAccess.read(anon)).toBe(false)
    expect(articlesAccess.create(anon)).toBe(false)
    expect(identityAccess.read(anon)).toBe(false)
    expect(outboxAccess.read(anon)).toBe(false)
  })

  it('service account cria artigo mas NAO le a colecao', () => {
    expect(articlesAccess.create(service)).toBe(true)
    expect(articlesAccess.read(service)).toBe(false)
    expect(articlesAccess.delete(service)).toBe(false)
  })

  it('identidade (usuarios e service accounts) e so do administrador', () => {
    expect(identityAccess.read(admin)).toBe(true)
    expect(identityAccess.read(chief)).toBe(false)
    expect(identityAccess.create(editor)).toBe(false)
  })

  it('a outbox nao e superficie editorial: ninguem cria, edita ou apaga', () => {
    expect(outboxAccess.create()).toBe(false)
    expect(outboxAccess.update()).toBe(false)
    expect(outboxAccess.delete()).toBe(false)
    expect(outboxAccess.read(admin)).toBe(true)
    expect(outboxAccess.read(service)).toBe(false)
  })

  it('a automacao nunca escreve campo de decisao humana', () => {
    for (const field of SERVICE_ACCOUNT_FORBIDDEN_FIELDS) {
      expect(serviceAccountMayWriteField(field), `${field} deveria ser proibido`).toBe(false)
    }
    expect(serviceAccountMayWriteField('title')).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* Workflow                                                            */
/* ------------------------------------------------------------------ */

describe('workflow do CMS', () => {
  it('automation_draft NAO vai direto para published', () => {
    expect(canTransition('automation_draft', 'published', 'administrator').allowed).toBe(false)
  })

  it('automation_draft -> needs_review funciona', () => {
    expect(canTransition('automation_draft', 'needs_review', 'editor').allowed).toBe(true)
  })

  it('ready_to_publish -> published funciona para quem pode publicar', () => {
    expect(canTransition('ready_to_publish', 'published', 'editor_in_chief').allowed).toBe(true)
    expect(canTransition('ready_to_publish', 'published', 'administrator').allowed).toBe(true)
  })

  it('writer, reviewer e editor NAO publicam', () => {
    for (const role of ['writer', 'reviewer', 'editor'] as const) {
      const verdict = canTransition('ready_to_publish', 'published', role)
      expect(verdict.allowed, `${role} nao deveria publicar`).toBe(false)
      if (!verdict.allowed) expect(verdict.reason).toBe('forbidden_for_role')
    }
  })

  it('blocked e retracted NAO voltam direto a published', () => {
    expect(canTransition('blocked', 'published', 'administrator').allowed).toBe(false)
    expect(canTransition('retracted', 'published', 'administrator').allowed).toBe(false)
    expect(canTransition('blocked', 'needs_review', 'administrator').allowed).toBe(true)
  })

  it('service account so alcanca automation_draft', () => {
    expect(canTransition('draft', 'needs_review', 'service').allowed).toBe(false)
    expect(canTransition('automation_draft', 'draft', 'service').allowed).toBe(false)
  })

  it('estado desconhecido e recusado', () => {
    expect(canTransition('inventado', 'published', 'administrator').allowed).toBe(false)
  })

  it('publicar de needs_update emite `updated`, nao `published`', () => {
    expect(publicationEventForTransition('needs_update', 'published')).toBe('article.updated')
    expect(publicationEventForTransition('ready_to_publish', 'published')).toBe('article.published')
    expect(publicationEventForTransition('published', 'retracted')).toBe('article.retracted')
    expect(publicationEventForTransition('published', 'blocked')).toBe('article.unpublished')
    expect(publicationEventForTransition('draft', 'needs_review')).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* Gate de publicacao                                                  */
/* ------------------------------------------------------------------ */

describe('gate de publicacao', () => {
  const base = {
    workflowStatus: 'ready_to_publish',
    slug: 'materia',
    title: 'Materia',
    language: 'pt-BR',
    activeAuthorCount: 1,
    blockingErrors: [] as readonly string[],
    qaPassedAt: '2026-07-28T10:00:00Z',
    aiAssisted: false,
    externalSourceCount: 0,
    unauthorizedMediaCount: 0,
    legalHold: false,
  }

  it('passa no caso completo', () => {
    expect(evaluatePublishGate(base).canPublish).toBe(true)
  })

  it('falha sem QA', () => {
    expect(evaluatePublishGate({ ...base, qaPassedAt: null }).reasons).toContain('qa_not_passed')
  })

  it('falha com erro bloqueante', () => {
    expect(evaluatePublishGate({ ...base, blockingErrors: ['x'] }).reasons).toContain(
      'has_blocking_errors',
    )
  })

  it('falha sem autor ativo', () => {
    expect(evaluatePublishGate({ ...base, activeAuthorCount: 0 }).reasons).toContain(
      'missing_active_author',
    )
  })

  it('falha com midia nao autorizada', () => {
    expect(evaluatePublishGate({ ...base, unauthorizedMediaCount: 1 }).reasons).toContain(
      'unauthorized_media',
    )
  })

  it('falha se aiAssisted sem fonte externa', () => {
    expect(evaluatePublishGate({ ...base, aiAssisted: true }).reasons).toContain(
      'ai_assisted_without_sources',
    )
    expect(
      evaluatePublishGate({ ...base, aiAssisted: true, externalSourceCount: 2 }).canPublish,
    ).toBe(true)
  })

  it('falha sob retencao juridica e fora de ready_to_publish', () => {
    expect(evaluatePublishGate({ ...base, legalHold: true }).reasons).toContain('legal_hold')
    expect(
      evaluatePublishGate({ ...base, workflowStatus: 'automation_draft' }).reasons,
    ).toContain('not_ready_to_publish')
  })
})

/* ------------------------------------------------------------------ */
/* Idempotencia                                                        */
/* ------------------------------------------------------------------ */

describe('idempotencia', () => {
  const identity = buildDraftIdentity(validEditorialDraft)

  it('hash canonico ignora ordem de chaves', () => {
    expect(canonicalHash({ a: 1, b: 2 })).toBe(canonicalHash({ b: 2, a: 1 }))
    expect(canonicalHash({ a: 1 })).not.toBe(canonicalHash({ a: 2 }))
  })

  it('sem artigo existente e create', () => {
    expect(decideIdempotency(identity, null, 'create').outcome).toBe('create')
  })

  it('mesma entrada nao duplica', () => {
    const existing = {
      articleId: 'a1',
      idempotencyKey: identity.idempotencyKey,
      sourceClusterId: identity.sourceClusterId,
      sourceRevision: identity.sourceRevision,
      draftPayloadHash: identity.draftPayloadHash,
      workflowStatus: 'automation_draft',
      humanAuthored: false,
    }
    expect(decideIdempotency(identity, existing, 'create').outcome).toBe('duplicate_noop')
  })

  it('mesma chave com corpo diferente e conflito', () => {
    const existing = {
      articleId: 'a1',
      idempotencyKey: identity.idempotencyKey,
      sourceClusterId: identity.sourceClusterId,
      sourceRevision: identity.sourceRevision,
      draftPayloadHash: 'outro-hash',
      workflowStatus: 'automation_draft',
      humanAuthored: false,
    }
    expect(decideIdempotency(identity, existing, 'create').outcome).toBe(
      'conflict_same_key_different_body',
    )
  })

  it('revisao superior atualiza o automation_draft', () => {
    const existing = {
      articleId: 'a1',
      idempotencyKey: 'outra-chave',
      sourceClusterId: identity.sourceClusterId,
      sourceRevision: identity.sourceRevision - 1,
      draftPayloadHash: 'hash-antigo',
      workflowStatus: 'automation_draft',
      humanAuthored: false,
    }
    expect(decideIdempotency(identity, existing, 'update').outcome).toBe('update_automation_draft')
  })

  it('revisao inferior e recusada (retry atrasado)', () => {
    const existing = {
      articleId: 'a1',
      idempotencyKey: 'outra-chave',
      sourceClusterId: identity.sourceClusterId,
      sourceRevision: identity.sourceRevision + 5,
      draftPayloadHash: 'hash-novo',
      workflowStatus: 'automation_draft',
      humanAuthored: false,
    }
    expect(decideIdempotency(identity, existing, 'update').outcome).toBe('stale_revision')
  })

  it('artigo com autoria humana NUNCA e sobrescrito', () => {
    const existing = {
      articleId: 'a1',
      idempotencyKey: identity.idempotencyKey,
      sourceClusterId: identity.sourceClusterId,
      sourceRevision: identity.sourceRevision,
      draftPayloadHash: identity.draftPayloadHash,
      workflowStatus: 'in_review',
      humanAuthored: true,
    }
    expect(decideIdempotency(identity, existing, 'update').outcome).toBe('refuse_human_authored')
  })

  it('artigo publicado vira PROPOSTA, nunca alteracao silenciosa', () => {
    const existing = {
      articleId: 'a1',
      idempotencyKey: 'outra-chave',
      sourceClusterId: identity.sourceClusterId,
      sourceRevision: identity.sourceRevision - 1,
      draftPayloadHash: 'hash-antigo',
      workflowStatus: 'published',
      humanAuthored: false,
    }
    expect(decideIdempotency(identity, existing, 'update').outcome).toBe(
      'propose_update_to_published',
    )
  })
})

/* ------------------------------------------------------------------ */
/* Entrada de drafts                                                   */
/* ------------------------------------------------------------------ */

describe('entrada de drafts (endpoint interno)', () => {
  const auth = { authenticated: true, isServiceAccount: true, accountId: 's1' }

  it('aceita um draft valido e cria SEMPRE automation_draft', () => {
    const result = intakeEditorialDraft({ auth, rawBodyBytes: 500, body: validEditorialDraft, existing: null })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.acceptance.outcome).toBe('create')
      expect(result.acceptance.status).toBe(201)
      expect(result.acceptance.document?.workflowStatus).toBe('automation_draft')
    }
  })

  it('recusa anonimo e recusa humano autenticado', () => {
    expect(
      intakeEditorialDraft({
        auth: { authenticated: false, isServiceAccount: false, accountId: null },
        rawBodyBytes: 10,
        body: validEditorialDraft,
        existing: null,
      }).ok,
    ).toBe(false)

    const human = intakeEditorialDraft({
      auth: { authenticated: true, isServiceAccount: false, accountId: 'u1' },
      rawBodyBytes: 10,
      body: validEditorialDraft,
      existing: null,
    })
    expect(human.ok).toBe(false)
    if (!human.ok) expect(human.rejection.status).toBe(403)
  })

  it('recusa corpo acima do teto ANTES de validar o contrato', () => {
    const result = intakeEditorialDraft({
      auth,
      rawBodyBytes: 5_000_000,
      body: validEditorialDraft,
      existing: null,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.rejection.code).toBe('payload_too_large')
  })

  it('recusa tentativa de publicacao embutida no draft', () => {
    const draft = clone(validEditorialDraft) as Record<string, unknown>
    draft.autoPublish = true
    const result = intakeEditorialDraft({ auth, rawBodyBytes: 500, body: draft, existing: null })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.rejection.code).toBe('contract_violation')
  })

  it('o documento produzido nao contem NENHUM campo de decisao humana', () => {
    const result = intakeEditorialDraft({ auth, rawBodyBytes: 500, body: validEditorialDraft, existing: null })
    expect(result.ok).toBe(true)
    if (result.ok && result.acceptance.document !== null) {
      expect(assertNoHumanDecisionFields(result.acceptance.document)).toEqual([])
    }
  })

  it('entidades sugeridas chegam sempre como NAO verificadas', () => {
    const result = intakeEditorialDraft({ auth, rawBodyBytes: 500, body: validEditorialDraft, existing: null })
    expect(result.ok).toBe(true)
    if (result.ok) {
      for (const ref of result.acceptance.document?.entityReferences ?? []) {
        expect((ref as { verified: boolean }).verified).toBe(false)
      }
    }
  })

  it('midia chega como CANDIDATA, nunca aprovada', () => {
    const result = intakeEditorialDraft({ auth, rawBodyBytes: 500, body: validEditorialDraft, existing: null })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.acceptance.mediaCandidates.length).toBeGreaterThan(0)
      // O documento do artigo nao ganha heroMedia nem gallery a partir do draft.
      expect(Object.keys(result.acceptance.document ?? {})).not.toContain('heroMedia')
      expect(Object.keys(result.acceptance.document ?? {})).not.toContain('gallery')
    }
  })
})

/* ------------------------------------------------------------------ */
/* Outbox                                                              */
/* ------------------------------------------------------------------ */

describe('publication outbox', () => {
  const envelope = {
    eventType: 'article.published' as const,
    articleId: 'article-991',
    articleVersionId: 'article-991-v3',
    availableAtIso: '2026-07-28T15:00:00Z',
  }

  it('monta um item valido a partir de um evento valido', () => {
    const built = buildOutboxRecord({ ...envelope, event: validPublicationEvent })
    expect(built.ok, built.ok ? '' : JSON.stringify(built.issues)).toBe(true)
    if (built.ok) {
      expect(built.record.status).toBe('pending')
      expect(built.record.attempts).toBe(0)
      expect(built.record.aggregateType).toBe('article')
    }
  })

  it('recusa evento que nao valida contra o contrato', () => {
    const event = clone(validPublicationEvent) as Record<string, unknown>
    delete event.publishedContent
    expect(buildOutboxRecord({ ...envelope, event }).ok).toBe(false)
  })

  it('recusa divergencia entre envelope e payload', () => {
    const built = buildOutboxRecord({
      ...envelope,
      articleId: 'article-OUTRO',
      event: validPublicationEvent,
    })
    expect(built.ok).toBe(false)
  })

  it('a chave de idempotencia segue articleId:versionId:eventType', () => {
    expect(buildEventIdempotencyKey('a', 'v', 'article.published')).toBe('a:v:article.published')
    expect(validPublicationEvent.idempotencyKey).toBe(
      buildEventIdempotencyKey('article-991', 'article-991-v3', 'article.published'),
    )
  })

  it('repeticao nao cria evento duplicado', () => {
    const key = validPublicationEvent.idempotencyKey
    expect(shouldSkipDuplicateEvent(key, [key])).toBe(true)
    expect(shouldSkipDuplicateEvent(key, [])).toBe(false)
  })
})
