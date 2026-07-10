/**
 * @screena/film-show-ratings-client — Client Film/Show Ratings (RapidAPI).
 *
 * WORKER-ONLY: nunca importado pelo render publico (invariante 3).
 *
 * Papel: fornecedor TECNICO (`provider_api = rapidapi_film_show_ratings`,
 * kind = ratings). Transporta notas; NUNCA e a fonte editorial (`rating_source`)
 * — invariante 2. A reatribuicao de cada nota a sua fonte real, na escala dela,
 * acontece em `services/ratings`, e so quando o payload permitir mapping seguro.
 */

export * from './provider.js'
export * from './config.js'
export * from './client.js'
