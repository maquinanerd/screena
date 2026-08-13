/**
 * types.ts — Contratos do promotor de premiacao. Modulo PURO.
 *
 * ESTE WORKER NAO CHAMA A OMDb. O literal `Awards` ja esta em `api_cache` desde
 * o primeiro sync de ratings; promove-lo para o dominio nao gasta um byte de
 * cota. Ler a rede aqui seria pagar duas vezes pelo mesmo dado.
 */

import type { AwardsOutcome } from '@screena/schemas'

import type { RatingsEntityType } from '../omdb/types.js'

export type { RatingsEntityType }

/** Uma linha de `api_cache` do provedor OMDb, ja lida. */
export interface CachedOmdbPayload {
  /** `api_cache.request_key` — diagnostico; nunca carrega a chave. */
  readonly requestKey: string
  readonly payload: unknown
  readonly payloadHash: string | null
  readonly fetchedAt: Date | null
}

/**
 * O credito resolvido a partir da LICENCA vigente de premiacao.
 *
 * `sourceKey` e a FONTE EDITORIAL do fato — quem contou os premios —, e vem da
 * propria licenca. O worker nao conhece nenhuma fonte de premio por nome, de
 * proposito: quem nomeia e a decisao registrada em `services/legal`.
 */
export interface AwardsCredit {
  readonly sourceKey: string
  readonly licenseStatus: string
  readonly licenseDisplayAllowed: boolean
  readonly requiresAttribution: boolean
  readonly requiresLinkback: boolean
  readonly attributionText: string | null
  readonly attributionUrl: string | null
  readonly usageDecisionId: string | null
}

/**
 * Resolucao da licenca de premiacao. Cada variante e uma ACAO diferente do
 * operador — nunca um `null` mudo.
 */
export type AwardsCreditResolution =
  /** Nao ha licenca de premiacao vigente: a fonte editorial nao foi decidida. */
  | { readonly kind: 'no-license' }
  /**
   * Ha MAIS DE UMA licenca de premiacao vigente. Escolher uma seria sortear de
   * quem e o credito; recusamos e nomeamos as candidatas.
   */
  | { readonly kind: 'ambiguous'; readonly sourceKeys: readonly string[] }
  | { readonly kind: 'credit'; readonly credit: AwardsCredit }

/** Por que um payload em cache nao virou linha de premiacao. */
export type AwardsRejectionReason =
  /** O payload nao e objeto, ou a OMDb respondeu `Response: "False"`. */
  | 'payload-unusable'
  /** Sem `imdbID` valido: nao da para saber de que titulo a frase fala. */
  | 'no-imdb-id'
  /** Nenhuma entidade local casa com aquele IMDb id. */
  | 'entity-not-found'
  /** O campo `Awards` esta ausente, vazio ou nulo. */
  | 'awards-absent'
  /** A OMDb escreveu `"N/A"`: ela nao conhece premio para o titulo. */
  | 'awards-not-available'
  /** A frase existe e nao casa com nenhum formato conhecido. */
  | 'awards-unrecognized'
  /** A licenca de premiacao nao resolveu (ver `AwardsCreditResolution`). */
  | 'no-license'
  /** O banco recusou a escrita (trigger de governanca). */
  | 'write-refused'

/** Uma recusa, com o detalhe que permite agir. */
export interface AwardsRejection {
  readonly reason: AwardsRejectionReason
  readonly detail: string
}

/** A linha a gravar em `entity_awards`. */
export interface EntityAwardRow {
  readonly entityType: RatingsEntityType
  readonly entityId: string
  /** O literal INTEGRO da fonte — o que permite reprocessar sem nova chamada. */
  readonly awardsRaw: string
  readonly outcome: AwardsOutcome | null
  readonly highlightCount: number | null
  /** VERBATIM da fonte ("Oscars", "Primetime Emmys"). Nunca traduzido. */
  readonly awardName: string | null
  readonly wins: number | null
  readonly nominations: number | null
  readonly providerApi: string
  readonly providerPayloadHash: string | null
  readonly fetchedAt: Date | null
  readonly sourceKey: string | null
  readonly attributionText: string | null
  readonly attributionUrl: string | null
  readonly requiresAttribution: boolean
  readonly requiresLinkback: boolean
  readonly licenseStatus: string
  readonly displayAllowed: boolean
  readonly dataUsageDecisionId: string | null
}

/** Resultado de um upsert em `entity_awards`. */
export interface EntityAwardUpsertOutcome {
  readonly created: boolean
  /** `false` quando a linha ja existia identica (nada reescrito). */
  readonly changed: boolean
  readonly displayAllowed: boolean
}
