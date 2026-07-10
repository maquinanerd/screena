/**
 * @screena/streaming — Worker offline de disponibilidade (onde assistir).
 *
 * Superficie PURA (typecheckavel sem Prisma Client): tipos, ports, parser, gate,
 * reconhecedor de payload, orquestracao e relatorio. Os adapters de persistencia
 * vivem em `persistence/*` e NAO sao reexportados.
 *
 * WORKER-ONLY: nunca importado pelo render publico (invariantes 3 e 4).
 * Somente disponibilidade LEGAL (invariante 8). Nada exibivel ate licenca.
 */

export * from './ports.js'
export * from './streaming-availability/types.js'
export * from './streaming-availability/args.js'
export * from './streaming-availability/gate.js'
export * from './streaming-availability/mapping.js'
export * from './streaming-availability/run.js'
export * from './streaming-availability/report.js'
