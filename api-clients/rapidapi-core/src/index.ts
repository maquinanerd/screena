/**
 * @screena/rapidapi-core — Nucleo HTTP resiliente dos clients RapidAPI.
 *
 * WORKER-ONLY: nunca importado pelo render publico (invariantes 3 e 4). Nao
 * conhece dominio: nao sabe o que e rating, fonte editorial ou disponibilidade.
 * Cada client concreto (`@screena/film-show-ratings-client`,
 * `@screena/streaming-availability-client`) monta sua config e seus endpoints.
 *
 * O segredo (`x-rapidapi-key`) viaja SO em header e nunca aparece em URL, erro,
 * log, relatorio ou cache.
 */

export * from './errors.js'
export * from './env.js'
export * from './hash.js'
export * from './cache-key.js'
export * from './sanitize.js'
export * from './http.js'
