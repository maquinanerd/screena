/**
 * @screena/sync — Orquestracao de sincronizacao (Fase 2).
 *
 * Superficie PURA: politica de frescor (stale). O runner de refresh que toca
 * Prisma/ingestao vive em `bin/run.ts` (excluido do typecheck). WORKER-ONLY:
 * nunca importado pelo render publico.
 */

export * from './stale-policy.js'
