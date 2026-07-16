/**
 * store-port.ts — Porta de LEITURA de midia (PURO).
 *
 * O adapter Prisma real (`createPrismaMediaReader`) implementa isto em
 * services/ingestion/src/persistence/media-reader.ts (excluido do typecheck).
 * A escrita/upsert de tmdb_images/tmdb_videos NAO passa por aqui — vive em
 * MediaStorePort (catalog-sync/media-sync.ts). Esta porta so le.
 *
 * WORKER-ONLY: leitura de banco; nunca chamada no caminho de render.
 */

import type { MediaImageRow, MediaVideoRow } from './build.js'

/** Entidade dona da midia (subconjunto renderavel de TmdbEntityKind). */
export type MediaOwnerKind = 'movie' | 'tv' | 'season' | 'episode' | 'person'

/** Contagens de cobertura de midia de um tipo de entidade (metricas, secao 12). */
export interface MediaCoverageCounts {
  /** Total de entidades daquele tipo no catalogo. */
  readonly total: number
  /** Quantas entidades daquele tipo tem ao menos uma imagem. */
  readonly withImages: number
  /** Quantas entidades daquele tipo tem ao menos um trailer. */
  readonly withTrailer: number
}

/** Porta de leitura de midia. */
export interface MediaReaderPort {
  /** Imagens cruas de uma entidade (inclui nao liberadas; o filtro e do builder). */
  readImages(kind: MediaOwnerKind, tmdbId: number): Promise<MediaImageRow[]>
  /** Videos crus de uma entidade (inclui nao liberados; o filtro e do builder). */
  readVideos(kind: MediaOwnerKind, tmdbId: number): Promise<MediaVideoRow[]>
  /** Contagens para media_coverage_ratio / trailer_coverage_ratio. */
  coverage(kind: MediaOwnerKind): Promise<MediaCoverageCounts>
}
