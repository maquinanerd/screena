/**
 * media — Leitura e montagem do bloco de midia publico (Backend A, secao 8).
 *
 * Barrel dos modulos PUROS: construtores do MediaPayload (URLs, tipos de video,
 * ordenacao, cobertura) e a porta de leitura. O adapter Prisma vive em
 * services/ingestion/src/persistence/media-reader.ts.
 *
 * Invariante 6: o builder descarta toda linha com `displayAllowed === false`.
 */

export * from './build.js'
export * from './store-port.js'
