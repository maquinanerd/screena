/**
 * @screena/news-ingestion — Plataforma editorial da Cinerie.
 *
 * Ponto de entrada do NUCLEO PURO: identidade de item, deduplicacao,
 * ciclo de vida do artigo, slug/redirect, projecao de busca/indexabilidade,
 * metricas e sentinela. Tudo aqui e determinista: sem rede, sem banco, sem IO,
 * sem `Date.now()` e sem `Math.random()` — o instante e sempre injetado.
 *
 * Os adapters Prisma vivem em `src/persistence/` (cobertos por
 * `tsconfig.runtime.json`), e as CLIs em `bin/`.
 *
 * Governanca:
 *  - Worker-only. Invariantes 3 e 4: nada disto entra no caminho de render.
 *  - NAO reconstroi RSSPRIME nem MN26. Este pacote implementa o CONTRATO DE
 *    ENTRADA (fonte -> item -> proveniencia) e a camada editorial que o
 *    proprio produto precisa — nao um agregador de RSS concorrente.
 *  - Nunca publica sozinho: publicar e transicao editorial com gate e ator.
 */

export * from './identity.js'
export * from './dedup.js'
export * from './ingest.js'
export * from './lifecycle.js'
export * from './slug.js'
export * from './projection.js'
export * from './editorial-projection.js'
export * from './editorial-entity-links.js'
export * from './editorial-event-mapper.js'
export * from './projection-worker-config.js'
export * from './media/media-validation.js'
export * from './media/storage-port.js'
export * from './media/storage-config.js'
export * from './media/media-plan.js'
export * from './metrics.js'
export * from './ports.js'
