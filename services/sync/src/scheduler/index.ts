/**
 * scheduler/index.ts — Superficie PURA do agendador de ingestao.
 *
 * Tudo que este barril exporta e livre de rede, banco e relogio proprio. Os
 * adapters (advisory lock, leitura de `api_sync_logs`, execucao das filas) vivem
 * em `runtime/`, e nunca sao reexportados daqui —
 * importar o barril NAO pode arrastar Prisma para dentro de um teste puro.
 */

export * from './rhythms.js'
export * from './backlog.js'
export * from './config.js'
export * from './awards-window.js'
export * from './due.js'
export * from './stalled.js'
export * from './scope.js'
export * from './quota.js'
export * from './trending.js'
export * from './lock.js'
export * from './priority.js'
export * from './run-outcome.js'
export * from './status.js'
