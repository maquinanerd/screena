/**
 * worker-service — Nucleo do servico de longa duracao do espelho TMDB.
 *
 * `config.ts` e `readiness.ts` sao PUROS (testados sem banco); `health-server.ts`
 * e o unico com IO. O entrypoint fica em `bin/catalog-worker-service.ts`.
 */

export * from './config.js'
export * from './readiness.js'
export * from './health-server.js'
