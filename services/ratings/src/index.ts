/**
 * @screena/ratings — Worker offline de ratings externos.
 *
 * Superficie PURA (typecheckavel sem Prisma Client): tipos, ports, parser,
 * gate, reconhecedor de payload, orquestracao e relatorio. Os adapters de
 * persistencia vivem em `persistence/*` e NAO sao reexportados — sao montados
 * apenas no `bin/` em runtime.
 *
 * WORKER-ONLY: nunca importado pelo render publico (invariantes 3 e 4).
 *
 * Invariante 2 materializada: `provider_api` (rapidapi_film_show_ratings) e o
 * fornecedor TECNICO; a fonte editorial da nota e reatribuida a partir do
 * payload e validada por `validateRating`.
 */

export * from './ports.js'
export * from './film-show-ratings/types.js'
export * from './film-show-ratings/args.js'
export * from './film-show-ratings/gate.js'
export * from './film-show-ratings/mapping.js'
export * from './film-show-ratings/run.js'
export * from './film-show-ratings/report.js'
