/**
 * auto-publication.ts — O GATE da publicacao automatica. PURO.
 *
 * Este modulo decide o que acontece com um pedido do MNScr. Ele nao escreve
 * nada, nao consulta banco e nao chama rede: recebe fatos ja coletados e devolve
 * um dos quatro desfechos.
 *
 * OS CINCO DESFECHOS EXISTEM PARA NAO COLAPSAR CAUSAS DIFERENTES:
 *
 *   PUBLISHED         publicou.
 *   ROUTED_TO_REVIEW  conteudo bom, decisao humana necessaria. Fica PERSISTIDO
 *                     em `needs_review` — ha o que revisar.
 *   DEFERRED          conteudo bom, teto do dia esgotado. NADA foi persistido;
 *                     reenviar depois da janela publica.
 *   BLOCKED           erro permanente. Reenviar igual nao adianta.
 *   CONFLICT          o pedido nao encaixa no estado atual (revisao antiga,
 *                     idempotencia divergente, contrato incompativel).
 *
 * Transformar tudo em "vira draft" apagaria a diferenca entre "revise isto" e
 * "seu pipeline esta quebrado" — e o produtor ficaria reenviando para sempre.
 *
 * POR QUE `DEFERRED` NAO E `ROUTED_TO_REVIEW`.
 *
 * Os dois nasciam com o mesmo rotulo e significavam o oposto. `ROUTED_TO_REVIEW`
 * PERSISTE a materia em `needs_review`: existe algo na fila, um editor abre e
 * decide. Teto esgotado nao persiste nada — a reserva de quota falha DENTRO da
 * transacao e o rollback leva junto o artigo que ainda nem tinha sido criado.
 * Responder "encaminhado para revisao" ali era mandar o produtor esperar por uma
 * revisao que nunca apareceria numa fila vazia, e `shouldRetry` mandava nao
 * retentar. O conteudo evaporava em silencio, com 202 na resposta.
 *
 * `DEFERRED` diz a verdade: nao foi recusado, foi adiado; nada existe do nosso
 * lado; volte depois de `nextEligibleAt`.
 */

import {
  countKeyphraseOccurrences,
  SCHEMA_BY_CONTENT_TYPE,
  SEO_POLICY,
  type EditorialSeoProposal,
  type SchemaTypeRecommendation,
} from '@screena/editorial-contracts'

import { type AuthorAuthorization } from './author-automation.js'

export const PUBLICATION_OUTCOMES = [
  'PUBLISHED',
  'ROUTED_TO_REVIEW',
  'DEFERRED',
  'BLOCKED',
  'CONFLICT',
] as const
export type PublicationOutcome = (typeof PUBLICATION_OUTCOMES)[number]

export interface OutcomeReason {
  readonly code: string
  /** Motivo CURTO e de politica. Nunca conteudo, credencial ou caminho. */
  readonly detail: string
}

export interface PublicationDecision {
  readonly outcome: PublicationOutcome
  readonly reasons: readonly OutcomeReason[]
  /** Avisos que NAO impedem a publicacao, mas ficam registrados. */
  readonly warnings: readonly string[]
}

/* ------------------------------------------------------------------ */
/* Compatibilidade Schema.org x conteudo                               */
/* ------------------------------------------------------------------ */

export interface BodyShapeFacts {
  readonly hasSteps: boolean
  readonly hasList: boolean
  readonly hasRating: boolean
  readonly blockCount: number
}

/**
 * O tipo de Schema recomendado bate com o que o corpo REALMENTE tem?
 *
 * Marcar `HowTo` sem passos ou `Review` sem avaliacao e structured data falso —
 * o buscador confia, o leitor nao encontra o que foi prometido, e a penalidade
 * vem depois, difusa e dificil de rastrear. Melhor recusar na entrada.
 */
export type SchemaVerdict =
  | { readonly kind: 'ok' }
  /** Estrutura prometida NAO existe: structured data falso. Bloqueia. */
  | { readonly kind: 'blocked'; readonly reason: OutcomeReason }
  /** Classificacao ambigua, conteudo valido. Revisao humana. */
  | { readonly kind: 'review'; readonly reason: OutcomeReason }

/**
 * O tipo de Schema recomendado cabe neste `contentType` e neste corpo?
 *
 * Duas perguntas, dois desfechos:
 *
 *  - fora da MATRIZ  -> ambiguidade de classificacao -> revisao humana;
 *  - dentro da matriz porem sem a ESTRUTURA prometida -> bloqueio.
 *
 * A segunda e mais grave: marcar `HowTo` sem passos faz o buscador prometer ao
 * leitor algo que a pagina nao entrega, e a penalidade vem difusa e dificil de
 * rastrear.
 */
export function evaluateSchemaChoice(
  recommendation: SchemaTypeRecommendation,
  body: BodyShapeFacts,
  contentType: string,
): SchemaVerdict {
  const allowed = SCHEMA_BY_CONTENT_TYPE[contentType]
  if (allowed === undefined) {
    return {
      kind: 'review',
      reason: { code: 'schema_unknown_content_type', detail: `contentType ${contentType} sem matriz` },
    }
  }
  if (!allowed.includes(recommendation)) {
    return {
      kind: 'review',
      reason: {
        code: 'schema_not_allowed_for_content_type',
        detail: `${recommendation} nao e previsto para ${contentType} (permitidos: ${allowed.join(', ')})`,
      },
    }
  }

  if (recommendation === 'HowTo' && !body.hasSteps) {
    return {
      kind: 'blocked',
      reason: { code: 'schema_howto_without_steps', detail: 'HowTo exige passos estruturados' },
    }
  }
  if (recommendation === 'ItemList' && !body.hasList) {
    return {
      kind: 'blocked',
      reason: { code: 'schema_itemlist_without_list', detail: 'ItemList exige itens estruturados' },
    }
  }
  if (recommendation === 'Review' && !body.hasRating) {
    return {
      kind: 'blocked',
      reason: { code: 'schema_review_without_rating', detail: 'Review exige conteudo avaliativo' },
    }
  }
  return { kind: 'ok' }
}

/* ------------------------------------------------------------------ */
/* SEO                                                                 */
/* ------------------------------------------------------------------ */

export interface SeoVerdict {
  /** Impede publicar E impede aceitar: o valor nao cabe nem para revisao. */
  readonly blocking: readonly OutcomeReason[]
  /** Aceito para revisao humana, porem NAO elegivel a publicacao automatica. */
  readonly review: readonly OutcomeReason[]
  readonly warnings: readonly string[]
}

/**
 * Revalida o SEO no SERVIDOR.
 *
 * O contrato ja validou forma e tamanho — mas o contrato roda com o que o
 * produtor mandou, e esta funcao roda com a politica canonica do momento. Se um
 * dia os limites mudarem, e aqui que a mudanca vale, sem depender de o produtor
 * atualizar o schema dele.
 */
export function validateSeoForPublication(seo: EditorialSeoProposal): SeoVerdict {
  const blocking: OutcomeReason[] = []
  const review: OutcomeReason[] = []
  const warnings: string[] = []

  const title = seo.title.trim()
  const meta = seo.metaDescription.trim()

  // TITULO. Fora da faixa de TRANSPORTE bloqueia; dentro do transporte porem
  // fora da faixa de AUTO-PUBLICACAO vai para revisao. Publicar sozinho um
  // titulo de 100 caracteres seria aceitar que a SERP o corte pela metade.
  if (title === '') {
    blocking.push({ code: 'SEO_TITLE_MISSING', detail: 'titulo de SEO ausente' })
  } else if (title.length < SEO_POLICY.title.min || title.length > SEO_POLICY.title.max) {
    blocking.push({
      code: 'SEO_TITLE_OUT_OF_TRANSPORT_RANGE',
      detail: `titulo com ${String(title.length)} caracteres fora de ${String(SEO_POLICY.title.min)}-${String(SEO_POLICY.title.max)}`,
    })
  } else if (title.length > SEO_POLICY.title.autoMax) {
    review.push({
      code: 'SEO_TITLE_OUTSIDE_AUTO_PUBLISH_RANGE',
      detail: `titulo com ${String(title.length)} caracteres acima de ${String(SEO_POLICY.title.autoMax)} para publicacao automatica`,
    })
  }

  // META. Ausente bloqueia: sem ela o buscador inventa o resumo a partir do
  // corpo, e o resultado costuma ser um trecho sem contexto.
  if (meta === '') {
    blocking.push({ code: 'SEO_META_MISSING', detail: 'meta description ausente' })
  } else if (
    meta.length < SEO_POLICY.metaDescription.min ||
    meta.length > SEO_POLICY.metaDescription.max
  ) {
    blocking.push({
      code: 'SEO_META_OUT_OF_TRANSPORT_RANGE',
      detail: `meta com ${String(meta.length)} caracteres fora de ${String(SEO_POLICY.metaDescription.min)}-${String(SEO_POLICY.metaDescription.max)}`,
    })
  } else if (meta.length < SEO_POLICY.metaDescription.autoMin) {
    review.push({
      code: 'SEO_META_TOO_SHORT_FOR_AUTO_PUBLISH',
      detail: `meta com ${String(meta.length)} caracteres abaixo de ${String(SEO_POLICY.metaDescription.autoMin)}`,
    })
  } else if (meta.length > SEO_POLICY.metaDescription.autoMax) {
    review.push({
      code: 'SEO_META_TOO_LONG_FOR_AUTO_PUBLISH',
      detail: `meta com ${String(meta.length)} caracteres acima de ${String(SEO_POLICY.metaDescription.autoMax)}`,
    })
  } else if (
    meta.length < SEO_POLICY.metaDescription.editorialMin ||
    meta.length > SEO_POLICY.metaDescription.editorialMax
  ) {
    // Faixa preferencial da redacao: AVISO. Apertar aqui rejeitaria material bom.
    warnings.push(
      `meta fora da faixa preferencial ${String(SEO_POLICY.metaDescription.editorialMin)}-${String(SEO_POLICY.metaDescription.editorialMax)}`,
    )
  }

  if (seo.focusKeyphrase.trim().length < SEO_POLICY.focusKeyphrase.min) {
    blocking.push({ code: 'SEO_KEYPHRASE_INVALID', detail: 'focusKeyphrase curta demais' })
  }

  const repetitions = countKeyphraseOccurrences(seo)
  if (repetitions > SEO_POLICY.maxKeyphraseRepetition) {
    blocking.push({
      code: 'SEO_KEYWORD_STUFFING',
      detail: `keyphrase repetida ${String(repetitions)} vezes nos campos de SEO`,
    })
  }

  return { blocking, review, warnings }
}

/* ------------------------------------------------------------------ */
/* Limites e kill switch                                               */
/* ------------------------------------------------------------------ */

export interface AutoPublishLimits {
  readonly enabled: boolean
  readonly dailyLimit: number | null
  readonly perAuthorLimit: number | null
}

export interface UsageFacts {
  readonly publishedTodayGlobal: number
  readonly publishedTodayByAuthor: number
}

/* ------------------------------------------------------------------ */
/* Decisao                                                             */
/* ------------------------------------------------------------------ */

export interface PublicationGateInput {
  readonly limits: AutoPublishLimits
  readonly usage: UsageFacts
  readonly authorAuthorization: AuthorAuthorization
  readonly contractCompatible: boolean
  readonly qaPassed: boolean
  readonly qaBlockingErrors: readonly string[]
  readonly qaWarnings: readonly string[]
  readonly seo: EditorialSeoProposal
  readonly body: BodyShapeFacts
  readonly contentType: string
  /** Midia referenciada que o CMS NAO conseguiu autorizar. */
  readonly unauthorizedMediaCount: number
  /** `true` quando o pedido tenta atualizar com revisao <= a ja aplicada. */
  readonly staleRevision: boolean
  /** `true` quando a mesma idempotencyKey ja existe com conteudo diferente. */
  readonly idempotencyConflict: boolean
  readonly slugValid: boolean
  /**
   * `true` quando o update tenta trocar o autor de uma materia JA PUBLICADA.
   *
   * Nao e `CONFLICT`: pode ser um pedido editorial legitimo. E tambem nao e
   * `BLOCKED`: o conteudo esta bom. E exatamente o caso para o qual
   * `ROUTED_TO_REVIEW` existe.
   */
  readonly authorChangeRequiresHuman: boolean
}

/**
 * Decide o desfecho de um pedido de publicacao automatica.
 *
 * A ORDEM e a parte importante desta funcao:
 *
 *  1. CONFLICT primeiro — se o pedido nao encaixa no estado atual, avaliar o
 *     conteudo dele nao ajuda ninguem;
 *  2. BLOCKED depois — erro permanente, reenviar igual nao muda nada;
 *  3. ROUTED_TO_REVIEW — conteudo aceitavel, decisao humana necessaria;
 *  4. PUBLISHED por ultimo, so quando nada acima se aplica.
 *
 * Inverter isso produziria mensagens enganosas: "meta description ausente" para
 * um pedido que, na verdade, chegou com revisao antiga.
 */
export function decideAutoPublication(input: PublicationGateInput): PublicationDecision {
  const warnings: string[] = [...input.qaWarnings]

  // 1. CONFLITO
  if (!input.contractCompatible) {
    return {
      outcome: 'CONFLICT',
      reasons: [
        { code: 'contract_incompatible', detail: 'versao ou hash de contrato divergente' },
      ],
      warnings,
    }
  }
  if (input.idempotencyConflict) {
    return {
      outcome: 'CONFLICT',
      reasons: [
        {
          code: 'idempotency_conflict',
          detail: 'mesma idempotencyKey com conteudo diferente',
        },
      ],
      warnings,
    }
  }
  if (input.staleRevision) {
    // Evento antigo NUNCA sobrescreve versao nova — a mesma regra que o worker
    // aplica com a sequencia de emissao, aqui aplicada com a revisao da fonte.
    return {
      outcome: 'CONFLICT',
      reasons: [{ code: 'stale_revision', detail: 'revisao anterior a ja aplicada' }],
      warnings,
    }
  }

  // 2. BLOQUEIO PERMANENTE
  const blocking: OutcomeReason[] = []

  if (!input.authorAuthorization.allowed) {
    blocking.push({
      code: input.authorAuthorization.code,
      detail: input.authorAuthorization.detail,
    })
  }
  if (!input.slugValid) {
    blocking.push({ code: 'slug_invalid', detail: 'slug nao pode ser derivada da sugestao' })
  }
  if (input.unauthorizedMediaCount > 0) {
    // Invariante 6: midia sem licenca clara nao vira pagina publica.
    blocking.push({
      code: 'unauthorized_media',
      detail: `${String(input.unauthorizedMediaCount)} midia(s) sem autorizacao`,
    })
  }

  const seoVerdict = validateSeoForPublication(input.seo)
  blocking.push(...seoVerdict.blocking)
  warnings.push(...seoVerdict.warnings)

  const schemaVerdict = evaluateSchemaChoice(
    input.seo.schemaTypeRecommendation,
    input.body,
    input.contentType,
  )
  if (schemaVerdict.kind === 'blocked') blocking.push(schemaVerdict.reason)

  if (blocking.length > 0) {
    return { outcome: 'BLOCKED', reasons: blocking, warnings }
  }

  // 3. REVISAO HUMANA
  //
  // O conteudo E aceitavel; o que falta e julgamento. Comeca pelos motivos de
  // SEO e de classificacao, porque sao os que o produtor consegue corrigir.
  const review: OutcomeReason[] = [...seoVerdict.review]
  if (schemaVerdict.kind === 'review') review.push(schemaVerdict.reason)
  if (input.authorChangeRequiresHuman) {
    review.push({
      code: 'AUTHOR_CHANGE_REQUIRES_HUMAN',
      detail: 'troca de autor em materia publicada exige decisao humana',
    })
  }
  if (review.length > 0) {
    return { outcome: 'ROUTED_TO_REVIEW', reasons: review, warnings }
  }

  // Kill switch DESLIGADO nao e erro: e uma decisao operacional. O conteudo
  // chegou bom e fica esperando — jogar fora seria perder trabalho valido.
  if (!input.limits.enabled) {
    return {
      outcome: 'ROUTED_TO_REVIEW',
      reasons: [
        { code: 'auto_publish_disabled', detail: 'publicacao automatica desabilitada' },
      ],
      warnings,
    }
  }

  if (!input.qaPassed) {
    return {
      outcome: 'ROUTED_TO_REVIEW',
      reasons: [
        {
          code: 'qa_not_passed',
          detail: `QA reprovou: ${input.qaBlockingErrors.slice(0, 3).join('; ')}`,
        },
      ],
      warnings,
    }
  }

  if (
    input.limits.dailyLimit !== null &&
    input.usage.publishedTodayGlobal >= input.limits.dailyLimit
  ) {
    return {
      outcome: 'ROUTED_TO_REVIEW',
      reasons: [
        {
          code: 'daily_limit_reached',
          detail: `limite diario global atingido (${String(input.limits.dailyLimit)})`,
        },
      ],
      warnings,
    }
  }

  if (
    input.limits.perAuthorLimit !== null &&
    input.usage.publishedTodayByAuthor >= input.limits.perAuthorLimit
  ) {
    return {
      outcome: 'ROUTED_TO_REVIEW',
      reasons: [
        {
          code: 'author_limit_reached',
          detail: `limite diario por autor atingido (${String(input.limits.perAuthorLimit)})`,
        },
      ],
      warnings,
    }
  }

  // 4. PUBLICA
  return { outcome: 'PUBLISHED', reasons: [], warnings }
}

/** Codigo HTTP de cada desfecho. */
export function outcomeHttpStatus(outcome: PublicationOutcome): number {
  if (outcome === 'PUBLISHED') return 201
  // 202: aceito e GUARDADO, aguardando decisao humana. Nao e erro do produtor.
  if (outcome === 'ROUTED_TO_REVIEW') return 202
  // 429: o pedido estava certo; o que faltou foi cota. E literalmente o caso que
  // "Too Many Requests" descreve, e e o unico status que o produtor ja sabe ler
  // como "reduza o ritmo e volte", com `Retry-After` junto.
  if (outcome === 'DEFERRED') return 429
  if (outcome === 'CONFLICT') return 409
  return 422
}

/**
 * O produtor deve tentar de novo com o MESMO pedido?
 *
 * So `DEFERRED`. Ali nada foi persistido e nada foi consumido: a janela vira
 * sozinha e o reenvio publica. Sem isto o produtor trataria "adiado" como
 * "resolvido" e a materia sumiria — foi exatamente o que acontecia enquanto teto
 * esgotado respondia `ROUTED_TO_REVIEW`.
 *
 * `BLOCKED` nunca: o pedido tem defeito e reenviar igual repete o defeito.
 * `CONFLICT` tampouco sem mudar algo — mas a mudanca e do lado dele (revisao
 * nova, contrato atualizado). `ROUTED_TO_REVIEW` nao e falha: o conteudo ESTA
 * guardado, nao ha o que retentar, ha o que esperar. `PUBLISHED` ja terminou.
 */
export function shouldRetry(outcome: PublicationOutcome): boolean {
  return outcome === 'DEFERRED'
}

/**
 * `Retry-After`, em segundos, a partir do instante em que a resposta foi montada.
 *
 * Deriva do MESMO `nextEligibleAt` que vai no corpo: dois relogios independentes
 * na mesma resposta se contradiriam, e o produtor nao teria como saber em qual
 * acreditar.
 *
 * Arredonda para CIMA: um segundo a menos devolveria o produtor antes da virada,
 * e ele levaria outro 429 imediato. Piso de 1s pelo mesmo motivo — `0` convida a
 * um laco quente contra a mesma parede.
 *
 * `null` quando nao ha horario a prometer (`article_update`) ou quando a data e
 * ilegivel: nesses casos o header simplesmente nao e emitido. Emitir um
 * `Retry-After` invalido e pior do que nao emitir nenhum.
 */
export function retryAfterSeconds(
  nextEligibleAtIso: string | null,
  nowIso: string,
): number | null {
  if (nextEligibleAtIso === null) return null
  const target = Date.parse(nextEligibleAtIso)
  const now = Date.parse(nowIso)
  if (!Number.isFinite(target) || !Number.isFinite(now)) return null
  return Math.max(1, Math.ceil((target - now) / 1000))
}
