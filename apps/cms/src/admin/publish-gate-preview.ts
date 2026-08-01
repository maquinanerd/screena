/**
 * publish-gate-preview.ts — Previsao do gate de publicacao, para a INTERFACE.
 * PURO: sem React, sem rede.
 *
 * O SERVIDOR continua sendo a autoridade. `hooks/articles.ts` roda
 * `evaluatePublishGate` sobre o estado lido do banco, dentro da transacao, e
 * recusa com 403 — isso nao muda e nao deve mudar.
 *
 * O que este modulo faz e outra coisa: antecipar a mesma resposta com os dados
 * que o formulario ja tem em maos, para que o redator descubra o que falta ANTES
 * de clicar e tomar uma recusa. Quando as duas discordam, quem vence e o
 * servidor — e a barra traduz a recusa dele (`explainServerRejection`).
 *
 * A DECISAO nao e reimplementada aqui: `evaluatePublishGate` e importada de
 * `workflow.ts`. Este arquivo so monta a entrada dela a partir do documento e
 * das colecoes relacionadas que a interface leu.
 */

import { evaluatePublishGate, type PublishGateResult } from '../workflow.js'

/** Documento do artigo como a interface o conhece (form state ou doc salvo). */
export type ArticleLike = Record<string, unknown>

/** O minimo que a previsao precisa saber de um autor. */
export interface AuthorFacts {
  readonly id: string
  readonly active: boolean
}

/** O minimo que a previsao precisa saber de uma midia. */
export interface MediaFacts {
  readonly id: string
  readonly licenseStatus: string
  readonly allowedForEditorial: boolean
  readonly allowedForHero: boolean
}

/* ------------------------------------------------------------------ */
/* Extracao de referencias                                             */
/* ------------------------------------------------------------------ */

/**
 * Ids de uma relacao do Payload.
 *
 * A mesma relacao chega em tres formas conforme a profundidade e o momento:
 * `3`, `"3"` ou `{ id: 3, ... }`. Tratar so uma delas faria a previsao perder
 * referencias reais e anunciar "nenhum autor" com autor preenchido na tela.
 */
export function relationIds(value: unknown): readonly string[] {
  if (value === null || value === undefined) return []
  const list = Array.isArray(value) ? value : [value]
  return list
    .map((item) =>
      item !== null && typeof item === 'object' && 'id' in item
        ? String((item as { id: unknown }).id)
        : String(item),
    )
    .filter((id) => id !== '' && id !== 'null' && id !== 'undefined')
}

/**
 * Ids de midia citados DENTRO dos blocos de imagem do corpo.
 *
 * O gate do servidor conta estes junto com capa e galeria: uma materia cujo
 * corpo aponta para midia proibida e recusada. A previsao precisa olhar o mesmo
 * conjunto, senao anunciaria "pode publicar" e o servidor recusaria.
 */
export function bodyMediaIds(body: unknown): readonly string[] {
  if (!Array.isArray(body)) return []
  return body.flatMap((raw) => {
    if (raw === null || typeof raw !== 'object') return []
    const block = raw as Record<string, unknown>
    if (String(block.blockType ?? block.type ?? '') !== 'image') return []
    return relationIds(block.media)
  })
}

/** Todas as midias que a materia referencia, sem repetir. */
export function referencedMediaIds(doc: ArticleLike): readonly string[] {
  return [
    ...new Set([
      ...relationIds(doc.heroMedia),
      ...relationIds(doc.gallery),
      ...bodyMediaIds(doc.body),
    ]),
  ]
}

/* ------------------------------------------------------------------ */
/* Autorizacao de midia                                                */
/* ------------------------------------------------------------------ */

/**
 * A midia esta liberada para o uso pretendido?
 *
 * FAIL-CLOSED, exatamente como o servidor: so conta como autorizada
 * `licenseStatus === 'approved'` E `allowedForEditorial`. Capa exige ainda
 * `allowedForHero`. Qualquer outra combinacao e recusa.
 */
export function mediaIsAuthorized(media: MediaFacts, asHero: boolean): boolean {
  const editorialOk = media.licenseStatus === 'approved' && media.allowedForEditorial
  return asHero ? editorialOk && media.allowedForHero : editorialOk
}

/**
 * Quantas midias referenciadas NAO estao autorizadas.
 *
 * Referencia para midia que a interface nao conseguiu ler tambem conta como nao
 * autorizada — nao se publica apontando para o que nao se consegue verificar.
 */
export function countUnauthorizedMedia(
  doc: ArticleLike,
  media: readonly MediaFacts[],
): number {
  const referenced = referencedMediaIds(doc)
  if (referenced.length === 0) return 0

  const heroId = relationIds(doc.heroMedia)[0] ?? null
  const byId = new Map(media.map((item) => [item.id, item]))

  let unauthorized = 0
  for (const id of referenced) {
    const found = byId.get(id)
    if (found === undefined || !mediaIsAuthorized(found, id === heroId)) unauthorized += 1
  }
  return unauthorized
}

/* ------------------------------------------------------------------ */
/* Previsao                                                            */
/* ------------------------------------------------------------------ */

export interface GatePreviewInput {
  readonly doc: ArticleLike
  readonly authors: readonly AuthorFacts[]
  readonly media: readonly MediaFacts[]
  /**
   * Estado a considerar como origem da publicacao.
   *
   * O gate do servidor avalia `workflowStatus` do documento SALVO (o `previous`
   * do hook), nao o destino. Por isso a previsao recebe o estado atual, e nao
   * `'published'`: passar o destino faria `not_ready_to_publish` desaparecer da
   * lista justamente quando ele e o unico bloqueio.
   */
  readonly currentStatus: string
}

/** A mesma resposta que o servidor daria, com os dados que a tela tem. */
export function previewPublishGate(input: GatePreviewInput): PublishGateResult {
  const { doc } = input
  const authorIds = new Set(relationIds(doc.authors))
  const activeAuthorCount = input.authors.filter(
    (author) => authorIds.has(author.id) && author.active,
  ).length

  return evaluatePublishGate({
    workflowStatus: input.currentStatus,
    slug: typeof doc.slug === 'string' ? doc.slug : null,
    title: typeof doc.title === 'string' ? doc.title : null,
    language: typeof doc.language === 'string' ? doc.language : null,
    activeAuthorCount,
    blockingErrors: Array.isArray(doc.blockingErrors) ? (doc.blockingErrors as string[]) : [],
    qaPassedAt:
      doc.qaPassedAt === undefined || doc.qaPassedAt === null ? null : String(doc.qaPassedAt),
    aiAssisted: doc.aiAssisted === true,
    externalSourceCount: Array.isArray(doc.externalSources) ? doc.externalSources.length : 0,
    unauthorizedMediaCount: countUnauthorizedMedia(doc, input.media),
    legalHold: doc.legalHold === true,
  })
}
