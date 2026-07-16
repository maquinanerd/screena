/**
 * public-payloads — Producao dos contratos publicos a partir do catalogo.
 *
 * Barrel do lado PURO: source rows (a fronteira com o banco) e os mappers que
 * as transformam nos payloads de @screena/public-contracts, cada um validado
 * pelo proprio contrato antes de sair. Os getters reais (Prisma) vivem em
 * persistence/public-payload-reader.ts (coberto por typecheck:catalog-runtime).
 *
 * WORKER/SERVER-ONLY: nada daqui roda no cliente; o render consome apenas o
 * payload ja serializado.
 */

export * from './source-rows.js'
export * from './map.js'
