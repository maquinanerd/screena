/**
 * cli — Nucleo PURO da CLI `pnpm ratings`.
 *
 * Parser, ajuda, exit codes e relatorios. Sem IO: o entrypoint `bin/ratings.ts`
 * (coberto por `pnpm typecheck:catalog-runtime`) faz o wiring com Prisma/RapidAPI
 * e chama estas funcoes. Assim a regra de "o
 * que a CLI aceita e o que ela reporta" e testavel sem banco e sem chave.
 *
 * Mesmo desenho de services/ingestion/src/cli (Backend A).
 */

export * from './args.js'
export * from './help.js'
export * from './exit.js'
export * from './report.js'
export * from './delegate.js'
