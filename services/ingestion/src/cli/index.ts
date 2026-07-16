/**
 * cli — Nucleo PURO da CLI `pnpm catalog` (Backend A, Parte B).
 *
 * Parser, ajuda, exit codes e o gate de producao. Sem IO: o entrypoint
 * `bin/catalog.ts` (fora do typecheck) faz o wiring com Prisma/TMDB e chama
 * estas funcoes. Assim a regra de "o que a CLI aceita" e testavel sem banco.
 */

export * from './args.js'
export * from './help.js'
export * from './exit.js'
