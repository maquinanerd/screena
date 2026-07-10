/**
 * @screena/streaming-availability-client — Client Streaming Availability (RapidAPI).
 *
 * WORKER-ONLY: nunca importado pelo render publico (invariante 3).
 *
 * Papel: fornecedor TECNICO (`provider_api = streaming_availability`,
 * kind = streaming) de disponibilidade LEGAL por pais. Nunca e fonte editorial
 * de nota (invariante 2) e nunca transporta link pirata (invariante 8).
 */

export * from './provider.js'
export * from './config.js'
export * from './client.js'
