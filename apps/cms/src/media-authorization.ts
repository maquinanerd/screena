/**
 * media-authorization.ts — Quem pode receber os bytes de uma midia, e para que.
 * PURO.
 *
 * O worker de projecao NAO baixa de uma URL: ele pede um `mediaId` a este CMS, e
 * e aqui que se decide se aquele arquivo pode virar imagem publica. A checagem
 * mora no CMS porque so ele conhece a licenca — o worker nunca deve reimplementar
 * essa regra, sob pena de as duas copias divergirem no primeiro campo novo.
 *
 * FAIL-CLOSED em todos os eixos: ausencia de decisao e proibicao (invariante 6).
 */

/** Para que a midia foi pedida. Cada finalidade tem sua propria permissao. */
export const MEDIA_PURPOSES = ['editorial', 'hero', 'social'] as const
export type MediaPurpose = (typeof MEDIA_PURPOSES)[number]

export function isMediaPurpose(value: unknown): value is MediaPurpose {
  return typeof value === 'string' && (MEDIA_PURPOSES as readonly string[]).includes(value)
}

/**
 * Estados de licenca que autorizam exibicao publica.
 *
 * `restricted` fica de fora deliberadamente: ela existe para midia com uso
 * condicionado (janela, veiculo, contexto) e essa condicao nao esta modelada.
 * Enquanto nao estiver, tratar como permitida seria adivinhar um contrato.
 */
const PUBLISHABLE_LICENSE_STATUS = ['approved'] as const

export interface MediaDocumentFacts {
  readonly exists: boolean
  readonly licenseStatus: string | null
  readonly licenseExpiresAtIso: string | null
  readonly requiresAttribution: boolean
  readonly credit: string | null
  readonly allowedForEditorial: boolean
  readonly allowedForHero: boolean
  readonly allowedForSocial: boolean
  readonly mimeType: string | null
  readonly filesize: number | null
  readonly hasFile: boolean
}

export type MediaDenialCode =
  | 'media_not_found'
  | 'invalid_purpose'
  | 'license_not_approved'
  | 'license_expired'
  | 'purpose_not_allowed'
  | 'attribution_missing'
  | 'file_missing'
  | 'mime_not_allowed'
  | 'file_too_large'

export type MediaAuthorization =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly code: MediaDenialCode; readonly detail: string }

export interface AuthorizeMediaInput {
  readonly facts: MediaDocumentFacts
  readonly purpose: MediaPurpose
  readonly nowIso: string
  readonly allowedMimeTypes: readonly string[]
  readonly maxBytes: number
}

function permissionFor(facts: MediaDocumentFacts, purpose: MediaPurpose): boolean {
  if (purpose === 'hero') return facts.allowedForHero
  if (purpose === 'social') return facts.allowedForSocial
  return facts.allowedForEditorial
}

/**
 * A midia pode ser entregue para esta finalidade?
 *
 * A ordem das checagens e proposital: identidade, depois licenca, depois
 * finalidade, depois arquivo. Um editor que ve "licenca expirada" sabe o que
 * fazer; "MIME nao permitido" sobre uma midia cuja licenca ja tinha vencido
 * mandaria ele reprocessar o arquivo a toa.
 */
export function authorizeMediaDelivery(input: AuthorizeMediaInput): MediaAuthorization {
  const { facts } = input

  if (!facts.exists) {
    return { allowed: false, code: 'media_not_found', detail: 'documento inexistente' }
  }

  const status = (facts.licenseStatus ?? '').trim()
  if (!(PUBLISHABLE_LICENSE_STATUS as readonly string[]).includes(status)) {
    // Cobre `unknown`, `pending`, `prohibited`, `restricted` e qualquer valor
    // novo que apareca no enum: allowlist, nao denylist.
    return {
      allowed: false,
      code: 'license_not_approved',
      detail: status === '' ? 'sem licenca' : status,
    }
  }

  if (facts.licenseExpiresAtIso !== null && facts.licenseExpiresAtIso !== '') {
    const expiry = Date.parse(facts.licenseExpiresAtIso)
    const now = Date.parse(input.nowIso)
    // Data ilegivel conta como VENCIDA: uma licenca cuja validade nao sabemos
    // ler nao pode ser tratada como eterna.
    if (!Number.isFinite(expiry) || !Number.isFinite(now) || expiry <= now) {
      return { allowed: false, code: 'license_expired', detail: 'licenca vencida ou ilegivel' }
    }
  }

  if (!permissionFor(facts, input.purpose)) {
    return {
      allowed: false,
      code: 'purpose_not_allowed',
      detail: `midia nao autorizada para ${input.purpose}`,
    }
  }

  if (facts.requiresAttribution && (facts.credit ?? '').trim() === '') {
    // Invariante 6 na fronteira de entrega, nao so na UI.
    return {
      allowed: false,
      code: 'attribution_missing',
      detail: 'requiresAttribution sem credito preenchido',
    }
  }

  if (!facts.hasFile) {
    return { allowed: false, code: 'file_missing', detail: 'documento sem arquivo' }
  }

  const mime = (facts.mimeType ?? '').trim().toLowerCase()
  if (!input.allowedMimeTypes.includes(mime)) {
    return { allowed: false, code: 'mime_not_allowed', detail: mime === '' ? 'sem mime' : mime }
  }

  if (facts.filesize !== null && facts.filesize > input.maxBytes) {
    return { allowed: false, code: 'file_too_large', detail: String(facts.filesize) }
  }

  return { allowed: true }
}

/**
 * Uma recusa de midia vale a pena retentar?
 *
 * Todas as negativas aqui sao de POLITICA ou de dado: nenhuma se resolve
 * sozinha com o tempo. Retentar so gastaria tentativa e adiaria o dead-letter
 * que o editor precisa ver.
 */
export function isRetryableMediaDenial(): boolean {
  return false
}
