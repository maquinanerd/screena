/**
 * entity-types.ts — contratos de rating NEUTROS de fornecedor.
 *
 * Vinham de `film-show-ratings/types.ts`, o diretorio do worker RapidAPI
 * REMOVIDO em 2026-09-02. O nome antigo era um acidente de origem: nada aqui e
 * especifico daquele fornecedor, e o caminho ATIVO (OMDb) sempre dependeu destes
 * tipos — `RatingsEntityType`, `RatingDraft`, `ExternalRatingRow` e as recusas
 * atravessam persistence, ports e o mapper da OMDb.
 *
 * Apagar junto com o worker teria derrubado o provedor que produz.
 */
/**
 * types.ts — Tipos do worker de ratings (Film/Show Ratings). Modulo PURO.
 */

import type { RatingScoreType, RatingSource } from '@screena/config'

/** Entidades suportadas nesta fase (nunca pessoa/temporada/episodio). */
export type RatingsEntityType = 'movie' | 'tv'

/** Identificadores externos lidos de um item do payload. */
export interface PopularEntityRef {
  /** `tt<digitos>`, quando presente e valido. */
  readonly imdbId: string | null
  /** Inteiro positivo, quando presente e valido. */
  readonly tmdbId: number | null
}

/** Rating ja validado na FORMA (fonte/escala/label/provider) e pronto para persistir. */
export interface RatingDraft {
  readonly ratingSource: RatingSource
  readonly ratingLabel: string
  readonly metric: string
  readonly ratingValue: number
  readonly ratingScale: number
  readonly ratingCount: number | null
  readonly ratingUrl: string | null
  /**
   * Natureza da nota (critics/audience/editorial). `null` quando a metrica nao
   * permite afirmar — a linha entra no banco assim mesmo (auditavel), mas o
   * trigger de exibicao a mantem fora da vitrine. Ver score-type.ts.
   */
  readonly scoreType: RatingScoreType | null
}

/**
 * Motivos de recusa. Sob payload desconhecido, RECUSAR e o caminho correto:
 * nenhuma nota entra em `external_ratings` por inferencia.
 */
export type RatingRejectionReason =
  | 'payload-shape-unrecognized'
  | 'item-not-object'
  | 'no-entity-id'
  | 'no-rating-descriptors'
  | 'descriptor-not-object'
  | 'unknown-rating-source'
  | 'missing-metric'
  | 'invalid-value'
  | 'missing-scale'
  | 'rating-validation-failed'
  | 'entity-not-found'
  /** Falha de rede/HTTP ao buscar UM item de `/item/` (nunca vaza a chave). */
  | 'item-fetch-failed'
  /**
   * Lote de candidatos interrompido cedo (falhas consecutivas ou circuito
   * aberto) para NAO queimar quota em loop; os ids restantes ficam sem consulta.
   */
  | 'batch-aborted'

/** Uma recusa, com detalhe legivel para o relatorio (sem segredo, sem payload cru). */
export interface RatingRejection {
  readonly reason: RatingRejectionReason
  readonly detail: string
}

/** Um item do payload apos o reconhecimento estrito. */
export interface MappedPopularItem {
  /** Posicao no array original (rastreabilidade no relatorio). */
  readonly index: number
  readonly ref: PopularEntityRef | null
  readonly ratings: readonly RatingDraft[]
  readonly rejections: readonly RatingRejection[]
}

/** Resultado do reconhecimento de um payload inteiro de `/popular/`. */
export interface PopularMapping {
  /** `false` quando nem a forma do payload foi reconhecida (nada a mapear). */
  readonly recognized: boolean
  readonly items: readonly MappedPopularItem[]
  readonly rejections: readonly RatingRejection[]
}

/** Resultado do reconhecimento de um payload de `/item/` (UM titulo). */
export interface ItemMapping {
  /** `false` quando a forma do payload nao foi reconhecida (nada a mapear). */
  readonly recognized: boolean
  /** O item reconhecido, ou `null` quando a forma nao foi reconhecida. */
  readonly item: MappedPopularItem | null
  readonly rejections: readonly RatingRejection[]
}

/** Uma linha pronta para `external_ratings` (entidade ja resolvida). */
export interface ExternalRatingRow extends RatingDraft {
  readonly entityType: RatingsEntityType
  /** Id local (BigInt serializado como string). */
  readonly entityId: string
  readonly providerApi: string
  readonly providerPayloadHash: string
  readonly fetchedAt: Date
  /**
   * Janela de re-sync derivada de RATING_STALE_POLICY (coleta +
   * refreshAfterHours). `null` quando a fonte nao tem politica declarada — e
   * nesse caso nao inventamos carimbo.
   */
  readonly staleAfter: Date | null
}
