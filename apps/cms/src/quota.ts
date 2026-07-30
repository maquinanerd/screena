/**
 * quota.ts — Politica dos limites diarios de autopublicacao. PURO.
 *
 * POR QUE UMA TABELA DE CONTADORES, E NAO `SELECT COUNT`.
 *
 * `contar -> comparar -> publicar` tem uma janela entre a contagem e a escrita.
 * Duas requisicoes simultaneas contam 9, ambas veem "cabe mais uma", e o dia
 * fecha com 11 num teto de 10. Nao e uma corrida rara: e o caso NORMAL quando um
 * pipeline dispara um lote.
 *
 * O contador resolve porque o incremento e a checagem viram UMA operacao: a
 * segunda transacao so consegue escrever depois que a primeira commitou, e ai ela
 * ja enxerga o valor novo. E, por ser linha de banco, o teto vale para N
 * instancias do CMS — um contador em memoria protegeria uma so.
 *
 * Este modulo decide; `quota-store.ts` executa dentro da transacao do `req`.
 */

/**
 * As cinco dimensoes de limite.
 *
 * A ORDEM da lista e a ordem de aquisicao, e ela e deterministica de proposito:
 * duas transacoes que travem as mesmas linhas em ordens diferentes formam um
 * ciclo e o Postgres mata uma por deadlock. Do mais generico ao mais especifico
 * tambem falha cedo — quando o teto global estourou, nem tocamos nas outras
 * quatro linhas.
 */
export const QUOTA_DIMENSIONS = [
  'global',
  'content_type',
  'section',
  'author',
  'article_update',
] as const
export type QuotaDimension = (typeof QUOTA_DIMENSIONS)[number]

/** Codigo devolvido quando cada dimensao esgota. */
export const QUOTA_LIMIT_CODES: Readonly<Record<QuotaDimension, string>> = {
  global: 'AUTO_PUBLISH_GLOBAL_DAILY_LIMIT_REACHED',
  content_type: 'AUTO_PUBLISH_CONTENT_TYPE_DAILY_LIMIT_REACHED',
  section: 'AUTO_PUBLISH_SECTION_DAILY_LIMIT_REACHED',
  author: 'AUTO_PUBLISH_AUTHOR_DAILY_LIMIT_REACHED',
  article_update: 'AUTO_PUBLISH_ARTICLE_UPDATE_LIMIT_REACHED',
}

export interface QuotaRequest {
  readonly dimension: QuotaDimension
  /** Chave dentro da dimensao. `global` usa a constante `all`. */
  readonly key: string
  /** Teto vigente. `null` = dimensao sem teto (nao consome linha). */
  readonly limit: number | null
}

export const GLOBAL_QUOTA_KEY = 'all'

export interface QuotaPlanInput {
  readonly publicationIntent: 'publish' | 'update'
  readonly contentType: string
  readonly section: string | null
  readonly publicAuthorId: string
  /** Id do artigo alvo. So existe em `update`. */
  readonly targetArticleId: string | null
  readonly limits: {
    readonly dailyLimit: number | null
    readonly perAuthorLimit: number | null
    readonly perSectionLimit: number | null
    readonly perContentTypeLimit: number | null
    readonly perArticleUpdateLimit: number | null
  }
}

/**
 * Quais dimensoes este pedido consome, e em que ordem.
 *
 * `create` e `update` consomem global, contentType, section e author — decisao
 * explicita: uma atualizacao automatica tambem publica bytes no site e tambem
 * assina em nome do autor, entao contar so o `create` deixaria a automacao
 * reescrever o dia inteiro sem tocar em nenhum teto.
 *
 * `article_update` e a protecao SEPARADA: limita quantas vezes UM artigo pode ser
 * reescrito automaticamente, independentemente dos tetos do dia.
 */
export function planQuotaConsumption(input: QuotaPlanInput): QuotaRequest[] {
  const plan: QuotaRequest[] = [
    { dimension: 'global', key: GLOBAL_QUOTA_KEY, limit: input.limits.dailyLimit },
    {
      dimension: 'content_type',
      key: input.contentType,
      limit: input.limits.perContentTypeLimit,
    },
  ]

  // Sem secao declarada nao ha o que limitar por secao: inventar uma chave
  // `sem-secao` criaria um balde artificial que mistura materias sem relacao.
  if (input.section !== null && input.section.trim() !== '') {
    plan.push({
      dimension: 'section',
      key: input.section.trim(),
      limit: input.limits.perSectionLimit,
    })
  }

  plan.push({
    dimension: 'author',
    key: input.publicAuthorId,
    limit: input.limits.perAuthorLimit,
  })

  if (input.publicationIntent === 'update' && input.targetArticleId !== null) {
    plan.push({
      dimension: 'article_update',
      key: input.targetArticleId,
      limit: input.limits.perArticleUpdateLimit,
    })
  }

  // Dimensao sem teto nao vira linha: contar sem limite so gastaria escrita e
  // criaria contencao numa linha que nunca recusa nada.
  const effective = plan.filter((entry) => entry.limit !== null)

  // Ordem canonica + chave ordenada dentro da dimensao. Duas transacoes que
  // peguem as mesmas linhas em ordens diferentes formam ciclo de lock.
  return effective.sort((a, b) => {
    const byDimension =
      QUOTA_DIMENSIONS.indexOf(a.dimension) - QUOTA_DIMENSIONS.indexOf(b.dimension)
    if (byDimension !== 0) return byDimension
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  })
}

/** Identidade da linha de contador. */
export function quotaRowKey(input: {
  readonly timeZone: string
  readonly localDate: string
  readonly dimension: QuotaDimension
  readonly key: string
}): string {
  return `${input.timeZone}|${input.localDate}|${input.dimension}|${input.key}`
}

/**
 * Data civil `YYYY-MM-DD` no fuso da redacao.
 *
 * Faz parte da CHAVE do contador junto com o proprio fuso: mudar o fuso da
 * operacao nao pode reaproveitar os baldes do fuso antigo, porque eles cobrem
 * intervalos diferentes de tempo real.
 */
export function localDateIn(instantIso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(instantIso))
}

export type QuotaVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly dimension: QuotaDimension; readonly code: string }

/**
 * Momento em que a dimensao volta a ter espaco.
 *
 * So para as dimensoes DIARIAS: `article_update` nao e diario — o teto de
 * reescritas de um artigo nao se renova a meia-noite, e prometer um horario ali
 * mandaria o produtor reenviar para sempre.
 */
export function nextEligibleAt(
  dimension: QuotaDimension,
  windowEndUtcIso: string,
): string | null {
  return dimension === 'article_update' ? null : windowEndUtcIso
}
