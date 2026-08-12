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
 * Invariante 2 materializada: `provider_api` (`omdb` hoje;
 * `rapidapi_film_show_ratings` no adapter legado) e o fornecedor TECNICO; a
 * fonte editorial da nota e reatribuida a partir do payload e validada por
 * `validateRating`.
 *
 * DOIS adapters convivem aqui, e so um esta ativo:
 *  - `omdb/**` — ATIVO. Um payload rende ate tres notas (IMDb, Rotten Tomatoes,
 *    Metacritic).
 *  - `film-show-ratings/**` — DESLIGADO por configuracao desde 2026-08-12 (a
 *    API responde 403 por falta de assinatura). Preservado intacto para voltar
 *    sem reescrita. Ver `film-show-ratings/gate.ts`.
 */

export * from './ports.js'
export * from './score-type.js'
export * from './metrics.js'
export * from './cli/index.js'
export * from './promotion/types.js'
export * from './promotion/guardrails.js'
export * from './film-show-ratings/types.js'
export * from './film-show-ratings/args.js'
export * from './film-show-ratings/gate.js'
export * from './film-show-ratings/mapping.js'
export * from './film-show-ratings/run.js'
export * from './film-show-ratings/report.js'
export * from './omdb/types.js'
export * from './omdb/value.js'
export * from './omdb/sources.js'
export * from './omdb/freshness.js'
export * from './omdb/args.js'
export * from './omdb/gate.js'
export * from './omdb/mapping.js'
export * from './omdb/run.js'
export * from './omdb/report.js'
