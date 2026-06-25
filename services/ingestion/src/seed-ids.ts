/**
 * seed-ids.ts — Lista curada de TMDB ids para desenvolvimento/validacao.
 *
 * Pequena e deterministica (D2.2): valida o fluxo (cache, logs, upsert,
 * idempotencia) sem discovery nem import em massa. NAO e catalogo de producao.
 */

/** Conjunto curado de ids TMDB por tipo. */
export interface DevSeedIds {
  readonly movies: readonly number[]
  readonly tvShows: readonly number[]
  readonly people: readonly number[]
}

/** Ids curados de dev (titulos/pessoas conhecidos e estaveis no TMDB). */
export const DEV_SEED_IDS: DevSeedIds = {
  movies: [27205, 157336, 603],
  tvShows: [1399, 1396],
  people: [287, 6193],
}
