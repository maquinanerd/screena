/**
 * @screena/public-contracts — Contratos publicos serializaveis da Cinerie.
 *
 * A fronteira tipada entre os getters server-only (que leem o PostgreSQL) e o
 * render/consumidores. Tipos + validadores PUROS (sem zod, sem Prisma). Importe
 * sempre a partir de "@screena/public-contracts", nunca dos modulos internos.
 *
 * Cobre (Backend A, §11/§12/§13):
 *  - primitivos: EntityRef, PublicMediaAsset, PublicVideo, MediaPayload, Credit, SeoPayload;
 *  - detalhe: Movie/Tv/Season/Episode/Person DetailPayload;
 *  - home/descoberta: EntityCard, HomePayload, DiscoveryPayload;
 *  - busca: SearchResult, SearchPayload (sempre noindex);
 *  - fila: CatalogJobView, CatalogStatusPayload;
 *  - onde assistir: decomposicao DECLARADA marca/variante/vendido em (watch-brand).
 */

export * from './validation.js'
export * from './primitives.js'
export * from './detail.js'
export * from './home.js'
export * from './search.js'
export * from './catalog-job.js'
export * from './media-url.js'
export * from './image-authorization.js'
export * from './external-intelligence.js'
export * from './watch-brand.js'
