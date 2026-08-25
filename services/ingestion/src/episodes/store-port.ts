/**
 * store-port.ts — Porta de persistencia das referencias de episodio (PURO).
 *
 * O adapter Prisma (`createPrismaEpisodeStore`) implementa isto em
 * services/ingestion/src/persistence/episode-store.ts.
 * A porta fala na chave natural do payload (id TMDB da serie + numero da
 * temporada + numero do episodio); o adapter resolve para os ids internos.
 */

import type {
  EpisodeCreditRow,
  EpisodeCrewRow,
  EpisodeExternalIdRow,
  EpisodeStillRow,
} from './normalize.js'

/** Entrada do sync de referencias de UM episodio. */
export interface EpisodeReferencesInput {
  readonly tvShowTmdbId: number
  readonly seasonNumber: number
  readonly episodeNumber: number
  readonly cast: readonly EpisodeCreditRow[]
  readonly guestStars: readonly EpisodeCreditRow[]
  readonly crew: readonly EpisodeCrewRow[]
  readonly externalIds: readonly EpisodeExternalIdRow[]
  readonly stills: readonly EpisodeStillRow[]
}

/** Contagens de um ciclo de sync de referencias de episodio. */
export interface EpisodeReferencesResult {
  readonly cast: number
  readonly guestStars: number
  readonly crew: number
  readonly externalIds: number
  readonly stills: number
}

/** Porta de persistencia das referencias de episodio. Idempotente por natureza. */
export interface EpisodeStorePort {
  /**
   * Persiste elenco, guest stars, equipe, ids externos e stills de UM episodio.
   * Idempotente: reexecutar nao duplica. Se a serie/temporada/episodio nao
   * estiver promovido, retorna zeros — NUNCA cria a entidade dona.
   */
  syncEpisodeReferences(input: EpisodeReferencesInput): Promise<EpisodeReferencesResult>
}
