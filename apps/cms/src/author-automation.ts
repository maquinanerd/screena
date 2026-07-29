/**
 * author-automation.ts — Quem pode assinar uma materia publicada por automacao.
 * PURO.
 *
 * A SEPARACAO QUE DA NOME A FASE:
 *
 *   AUTOR PUBLICO  — entidade `Author`, aparece na ficha, no JSON-LD e no site.
 *   ATOR TECNICO   — a service account do MNScr, aparece SO na auditoria.
 *
 * Colapsar os dois teria uma de duas consequencias, ambas ruins: a automacao
 * viraria "autor" na ficha publica (falso), ou quem operou sumiria do registro
 * (pior). Por isso o pedido traz `publicAuthorId` e o servidor guarda os dois.
 *
 * E a autorizacao e do AUTOR, nao do pipeline. Uma redatora pode aceitar
 * assinatura automatica em `news` e recusar em `review` — quem decide como o
 * proprio nome e usado e ela, e essa decisao mora no documento dela.
 */

export const ATTRIBUTION_MODES = ['byline', 'newsroom', 'assisted'] as const
export type AttributionMode = (typeof ATTRIBUTION_MODES)[number]

/** Fatos do documento `Author` que a politica consulta. */
export interface AuthorAutomationFacts {
  readonly exists: boolean
  readonly active: boolean
  readonly automationPublishingAllowed: boolean
  /** Vazio = qualquer contentType permitido. */
  readonly allowedAutomationContentTypes: readonly string[]
  /** Vazio = qualquer secao permitida. */
  readonly allowedAutomationSections: readonly string[]
  /** `null` = sem teto proprio (o teto global continua valendo). */
  readonly automationDailyLimit: number | null
  /** Modos de assinatura que este autor aceita. Vazio = nenhum. */
  readonly automationAttributionModes: readonly AttributionMode[]
}

export type AuthorDenialCode =
  | 'author_not_found'
  | 'author_inactive'
  | 'automation_not_allowed'
  | 'content_type_not_allowed'
  | 'section_not_allowed'
  | 'attribution_mode_not_allowed'
  | 'author_daily_limit_reached'

export type AuthorAuthorization =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly code: AuthorDenialCode; readonly detail: string }

export interface AuthorizeAuthorInput {
  readonly facts: AuthorAutomationFacts
  readonly contentType: string
  readonly section: string | null
  readonly attributionMode: AttributionMode
  /** Publicacoes automaticas ja feitas hoje com este autor. */
  readonly publishedTodayByAuthor: number
}

/**
 * O autor pode assinar ESTA publicacao automatica?
 *
 * FAIL-CLOSED em todos os eixos. A ordem das checagens e proposital: existencia,
 * atividade, permissao geral, depois as restricoes finas. Dizer "secao nao
 * permitida" sobre um autor que nem aceita automacao mandaria o pipeline
 * ajustar a secao a toa.
 */
export function authorizeAutomationAuthor(input: AuthorizeAuthorInput): AuthorAuthorization {
  const { facts } = input

  if (!facts.exists) {
    return { allowed: false, code: 'author_not_found', detail: 'autor inexistente' }
  }
  if (!facts.active) {
    return { allowed: false, code: 'author_inactive', detail: 'autor inativo' }
  }
  if (!facts.automationPublishingAllowed) {
    return {
      allowed: false,
      code: 'automation_not_allowed',
      detail: 'autor nao aceita publicacao automatica',
    }
  }

  // Lista VAZIA significa "sem restricao", nao "nada permitido". A alternativa
  // faria todo autor recem-autorizado precisar enumerar os seis contentTypes —
  // e o esquecimento apareceria como recusa incompreensivel.
  if (
    facts.allowedAutomationContentTypes.length > 0 &&
    !facts.allowedAutomationContentTypes.includes(input.contentType)
  ) {
    return {
      allowed: false,
      code: 'content_type_not_allowed',
      detail: `contentType ${input.contentType} fora da politica do autor`,
    }
  }

  if (facts.allowedAutomationSections.length > 0) {
    const section = (input.section ?? '').trim()
    if (section === '' || !facts.allowedAutomationSections.includes(section)) {
      return {
        allowed: false,
        code: 'section_not_allowed',
        detail: 'secao fora da politica do autor',
      }
    }
  }

  // O modo de assinatura e uma decisao do autor sobre o proprio nome.
  if (!facts.automationAttributionModes.includes(input.attributionMode)) {
    return {
      allowed: false,
      code: 'attribution_mode_not_allowed',
      detail: `modo ${input.attributionMode} nao aceito por este autor`,
    }
  }

  if (
    facts.automationDailyLimit !== null &&
    input.publishedTodayByAuthor >= facts.automationDailyLimit
  ) {
    return {
      allowed: false,
      code: 'author_daily_limit_reached',
      detail: `limite diario do autor atingido (${String(facts.automationDailyLimit)})`,
    }
  }

  return { allowed: true }
}

/**
 * Uma recusa de autoria vale a pena retentar?
 *
 * O limite diario, sim — ele passa a valer de novo amanha, e o pipeline pode
 * reenfileirar. As demais sao de POLITICA e nao se resolvem sozinhas: insistir
 * so gastaria tentativa.
 */
export function isRetryableAuthorDenial(code: AuthorDenialCode): boolean {
  return code === 'author_daily_limit_reached'
}
