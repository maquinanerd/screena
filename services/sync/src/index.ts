/**
 * @screena/sync — Orquestracao de sincronizacao (Fase 2).
 *
 * Superficie PURA: politica de frescor (stale) e o AGENDADOR (tabela de ritmos,
 * selecao do que venceu, alerta de fila parada, trava contra execucao dupla,
 * painel de estado). Os adapters que tocam Prisma/ingestao vivem em `bin/` e em
 * `src/scheduler/runtime/`. WORKER-ONLY:
 * nunca importado pelo render publico.
 */

export * from './stale-policy.js'
export * from './scheduler/index.js'
