/**
 * lifecycle.ts — Ciclo de vida editorial de um artigo. PURO.
 *
 * O ciclo NAO inventa uma maquina de estados nova: usa o `review_status` que
 * `article_translations` ja tem (`ReviewStatus`), e apenas define quais
 * transicoes sao legitimas e o que cada uma exige. Uma maquina paralela seria
 * uma segunda verdade sobre o mesmo campo.
 *
 * `scheduled` tambem NAO e um estado novo: uma materia agendada e uma materia
 * `published` com `published_at` no futuro. O embargo e aplicado pelo gate de
 * publicacao (`@screena/seo`), consultado por todas as superficies publicas.
 * Nao ha scheduler proprio nesta etapa — ver docs/editorial/README.md.
 */

import {
  evaluateArticlePublication,
  type ArticleUnpublishableReason,
} from '@screena/seo'

/** Estados de revisao usados pelo fluxo editorial (subset de `ReviewStatus`). */
export type EditorialReviewStatus =
  | 'draft'
  | 'ai_generated'
  | 'needs_review'
  | 'human_reviewed'
  | 'published'
  | 'needs_update'
  | 'blocked'
  | 'archived'

/** Acoes editoriais expressas como transicao de estado. */
export type EditorialAction =
  | 'submit_for_review'
  | 'approve'
  | 'publish'
  | 'request_update'
  | 'unpublish'
  | 'retract'
  | 'restore_to_draft'

/**
 * Transicoes permitidas. Tudo que nao esta aqui e recusado — a tabela e a
 * allowlist, nao uma lista de proibicoes.
 *
 * `blocked`/`archived` (retratacao) so voltam para `needs_review`: uma materia
 * retratada nunca volta direto para `published`, porque isso republicaria sem
 * nova revisao humana exatamente o conteudo que foi retirado.
 */
const ALLOWED_TRANSITIONS: Readonly<
  Record<EditorialReviewStatus, readonly EditorialReviewStatus[]>
> = {
  draft: ['needs_review', 'ai_generated', 'blocked', 'archived'],
  ai_generated: ['needs_review', 'draft', 'blocked', 'archived'],
  needs_review: ['human_reviewed', 'draft', 'blocked', 'archived'],
  human_reviewed: ['published', 'needs_update', 'draft', 'blocked', 'archived'],
  published: ['needs_update', 'human_reviewed', 'blocked', 'archived'],
  needs_update: ['needs_review', 'human_reviewed', 'blocked', 'archived'],
  blocked: ['needs_review'],
  archived: ['needs_review'],
}

export interface TransitionResult {
  readonly allowed: boolean
  readonly reason: string | null
}

/** Uma transicao de estado editorial e legitima? */
export function canTransition(
  from: EditorialReviewStatus,
  to: EditorialReviewStatus,
): TransitionResult {
  if (from === to) return { allowed: false, reason: 'transicao para o mesmo estado' }
  const allowed = ALLOWED_TRANSITIONS[from]
  if (allowed === undefined) return { allowed: false, reason: `estado de origem invalido: ${from}` }
  if (!allowed.includes(to)) {
    return { allowed: false, reason: `transicao proibida: ${from} -> ${to}` }
  }
  return { allowed: true, reason: null }
}

/** Estado alvo de cada acao editorial. */
export function targetStatusOf(action: EditorialAction): EditorialReviewStatus {
  switch (action) {
    case 'submit_for_review':
      return 'needs_review'
    case 'approve':
      return 'human_reviewed'
    case 'publish':
      return 'published'
    case 'request_update':
      return 'needs_update'
    case 'unpublish':
      return 'blocked'
    case 'retract':
      return 'archived'
    case 'restore_to_draft':
      return 'draft'
  }
}

/** Fatos exigidos para PUBLICAR (nao para salvar rascunho). */
export interface PublishGateInput {
  readonly reviewStatus: EditorialReviewStatus
  readonly licenseStatus: string
  readonly displayAllowed: boolean
  readonly slug: string | null
  readonly title: string | null
  readonly body: string | null
  readonly languageCode: string | null
  readonly publishedAtIso: string | null
  readonly requiresAttribution: boolean
  readonly requiresLinkback: boolean
  readonly sourceName: string | null
  readonly sourceUrl: string | null
  /** Numero de fontes ligadas ao artigo (`article_source_links`). */
  readonly provenanceCount: number
}

/** Motivos de bloqueio de publicacao (superset dos motivos do gate publico). */
export type PublishBlockReason =
  | ArticleUnpublishableReason
  | 'missing_body'
  | 'missing_language'
  | 'missing_required_provenance'

export interface PublishGateResult {
  readonly canPublish: boolean
  readonly reasons: readonly PublishBlockReason[]
}

/** Corpo minimo para um artigo nao ser considerado vazio. */
export const MIN_PUBLISHABLE_BODY_CHARS = 200

/**
 * Gate de PUBLICACAO. Alem do gate publico (licenca/atribuicao/data/embargo),
 * exige o que so faz sentido no momento de publicar:
 *
 *  - corpo proprio real (a Cinerie publica texto proprio, nao ficha vazia);
 *  - idioma declarado;
 *  - PROVENIENCIA: pelo menos uma fonte ligada. Um artigo sem nenhuma fonte
 *    registrada nao consegue responder "o que sustenta isto?" — e essa
 *    pergunta e a diferenca entre reportagem e afirmacao sem lastro.
 */
export function evaluatePublishGate(
  input: PublishGateInput,
  nowIso: string,
): PublishGateResult {
  const publication = evaluateArticlePublication(
    {
      // O gate publico pergunta pelo estado FINAL pretendido; publicar leva a
      // `published`, entao avaliamos contra ele e nao contra o estado atual.
      reviewStatus: 'published',
      licenseStatus: input.licenseStatus,
      displayAllowed: input.displayAllowed,
      slug: input.slug,
      title: input.title,
      publishedAtIso: input.publishedAtIso,
      requiresAttribution: input.requiresAttribution,
      requiresLinkback: input.requiresLinkback,
      sourceName: input.sourceName,
      sourceUrl: input.sourceUrl,
    },
    nowIso,
  )

  const reasons: PublishBlockReason[] = publication.reasons.filter(
    // `future_scheduled` NAO bloqueia o ato de publicar: agendar e legitimo.
    // O embargo e aplicado na leitura publica, nao na escrita editorial.
    (reason) => reason !== 'future_scheduled',
  )

  const body = (input.body ?? '').trim()
  if (body.length < MIN_PUBLISHABLE_BODY_CHARS) reasons.push('missing_body')
  if ((input.languageCode ?? '').trim() === '') reasons.push('missing_language')
  if (!Number.isFinite(input.provenanceCount) || input.provenanceCount < 1) {
    reasons.push('missing_required_provenance')
  }

  return { canPublish: reasons.length === 0, reasons }
}

/**
 * Uma materia esta AGENDADA: publicada editorialmente, mas com data futura.
 * Nao e um estado no banco — e a leitura de dois campos.
 */
export function isScheduled(
  reviewStatus: EditorialReviewStatus,
  publishedAtIso: string | null,
  nowIso: string,
): boolean {
  if (reviewStatus !== 'published') return false
  if (publishedAtIso === null) return false
  const publishedMs = Date.parse(publishedAtIso)
  const nowMs = Date.parse(nowIso)
  if (Number.isNaN(publishedMs) || Number.isNaN(nowMs)) return false
  return publishedMs > nowMs
}

/**
 * Plano de ATUALIZACAO de um artigo publicado.
 *
 * Regra: atualizacao normal preserva id, slug e `published_at`; so `updated_at`
 * anda. Trocar a URL de uma materia publicada a cada edicao de titulo quebraria
 * links e o historico de indexacao — por isso o slug NAO segue o titulo depois
 * de publicado.
 */
export interface UpdatePlan {
  readonly preservesSlug: boolean
  readonly preservesPublishedAt: boolean
  readonly touchesUpdatedAt: boolean
  readonly isMaterialCorrection: boolean
}

export function planArticleUpdate(input: {
  readonly correctionNote: string | null
}): UpdatePlan {
  const note = (input.correctionNote ?? '').trim()
  return {
    preservesSlug: true,
    preservesPublishedAt: true,
    touchesUpdatedAt: true,
    // Correcao MATERIAL: exige nota explicita. Sem nota e atualizacao normal —
    // nunca inferimos "isto foi uma correcao" a partir do diff.
    isMaterialCorrection: note !== '',
  }
}
