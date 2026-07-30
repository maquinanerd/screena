/**
 * @screena/editorial-contracts — Contratos versionados da cadeia editorial.
 *
 * PURO: sem rede, sem banco, sem IO, sem `Date.now()` e sem `Math.random()`.
 * Consumido pelo CMS (`@screena/cms`) e, no futuro, pelo Cinerie Context Service
 * e pelo worker de projecao. Fronteiras em `docs/adr/0015-editorial-boundaries.md`.
 *
 *   RSS Prime  --rss-prime-event-v1----------------> MNScr   (definido FORA daqui)
 *   Cinerie    --cinerie-editorial-context-v1------> MNScr
 *   MNScr      --editorial-draft-v1---------------> Payload   (revisao humana)
 *   MNScr      --editorial-publication-request-v1-> Payload   (publicacao automatica governada)
 *   Payload    --publication-event-v1-------------> projecao publica
 */

export * from './common.js'
export * from './blocks.js'
export * from './editorial-draft-v1.js'
export * from './publication-event-v1.js'
export * from './cinerie-editorial-context-v1.js'
export * from './seo-proposal.js'
export * from './editorial-publication-request-v1.js'
export * from './manifest.js'
export * from './publication-fixtures.js'
export * from './fixtures.js'
