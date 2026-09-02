/**
 * @screena/streaming — Worker offline de disponibilidade (onde assistir).
 *
 * Superficie PURA (typecheckavel sem Prisma Client): identidade do fornecedor,
 * tipos de oferta, ports e a ferramenta governada de revisao/promocao. Os
 * adapters de persistencia vivem em `persistence/*` e NAO sao reexportados.
 *
 * O WORKER de ingestao (RapidAPI / Streaming Availability) foi REMOVIDO em
 * 2026-09-02 por decisao do dono. O que resta aqui e o que GOVERNA a oferta ja
 * gravada — que e o lado que decide o que o leitor ve.
 *
 * WORKER-ONLY: nunca importado pelo render publico (invariantes 3 e 4).
 * Somente disponibilidade LEGAL (invariante 8). Nada exibivel ate licenca.
 */

export * from './ports.js'
// A IDENTIDADE do fornecedor (chave em `api_providers`, pais default,
// atribuicao) sobrevive ao expurgo do client RapidAPI: ela e FK viva em
// `watch_availability`. Ver `provider-identity.ts`.
export * from './provider-identity.js'
export * from './offer-types.js'
export * from './safe-deep-link.js'

// Ferramenta governada de revisao/promocao de `watch_availability` (superficie
// PURA; o adapter Prisma vive em `persistence/*` e NAO e reexportado).
export * from './promotion/types.js'
export * from './promotion/guardrails.js'
export * from './promotion/args.js'
export * from './promotion/run.js'
export * from './promotion/report.js'
