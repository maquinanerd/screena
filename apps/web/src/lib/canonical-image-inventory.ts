/**
 * Inventário das 31 categorias de `<image-slot>` do HTML canônico.
 *
 * O protótipo repete alguns slots dentro de loops. Cada entrada abaixo representa
 * a categoria declarada no template, não a quantidade de cards renderizados.
 * A tabela não carrega mídia nem promove os mocks do pacote a conteúdo público.
 */

export type CanonicalImageScreen =
  | "movie"
  | "series-desktop"
  | "series-mobile"
  | "discover"
  | "anticipated"
  | "settings";

export type CanonicalImageRole =
  | "poster"
  | "backdrop"
  | "gallery"
  | "news"
  | "awards"
  | "critique"
  | "cast"
  | "episode"
  | "recommendation"
  | "continue-watching"
  | "release"
  | "avatar";

export type CanonicalImageImplementation =
  | "active"
  | "conditional"
  | "deferred";

export interface CanonicalImageSlot {
  readonly id: string;
  readonly canonicalId: string;
  readonly screen: CanonicalImageScreen;
  readonly role: CanonicalImageRole;
  readonly implementation: CanonicalImageImplementation;
}

export const CANONICAL_IMAGE_SLOTS = [
  {
    id: "movie-poster",
    canonicalId: "movie-poster",
    screen: "movie",
    role: "poster",
    implementation: "active",
  },
  {
    id: "movie-trailer",
    canonicalId: "movie-trailer",
    screen: "movie",
    role: "backdrop",
    implementation: "conditional",
  },
  {
    id: "movie-gallery",
    canonicalId: "movie-fotos",
    screen: "movie",
    role: "gallery",
    implementation: "deferred",
  },
  {
    id: "movie-news-tile",
    canonicalId: "movie-noticias",
    screen: "movie",
    role: "news",
    implementation: "conditional",
  },
  {
    id: "movie-awards",
    canonicalId: "movie-premios",
    screen: "movie",
    role: "awards",
    implementation: "deferred",
  },
  {
    id: "movie-critique",
    canonicalId: "movie-critica",
    screen: "movie",
    role: "critique",
    implementation: "conditional",
  },
  {
    id: "movie-cast-loop",
    canonicalId: "mcast-{{ c.initials }}",
    screen: "movie",
    role: "cast",
    implementation: "conditional",
  },
  {
    id: "movie-news-loop",
    canonicalId: "{{ a.slotId }}",
    screen: "movie",
    role: "news",
    implementation: "conditional",
  },
  {
    id: "movie-recommendations-loop",
    canonicalId: "{{ m.slotId }}",
    screen: "movie",
    role: "recommendation",
    implementation: "deferred",
  },
  {
    id: "series-desktop-poster",
    canonicalId: "series-poster",
    screen: "series-desktop",
    role: "poster",
    implementation: "active",
  },
  {
    id: "series-desktop-trailer",
    canonicalId: "media-trailer",
    screen: "series-desktop",
    role: "backdrop",
    implementation: "conditional",
  },
  {
    id: "series-desktop-gallery",
    canonicalId: "media-fotos",
    screen: "series-desktop",
    role: "gallery",
    implementation: "deferred",
  },
  {
    id: "series-desktop-news-tile",
    canonicalId: "media-noticias",
    screen: "series-desktop",
    role: "news",
    implementation: "conditional",
  },
  {
    id: "series-desktop-awards",
    canonicalId: "media-premios",
    screen: "series-desktop",
    role: "awards",
    implementation: "deferred",
  },
  {
    id: "series-desktop-critique",
    canonicalId: "series-critica",
    screen: "series-desktop",
    role: "critique",
    implementation: "conditional",
  },
  {
    id: "series-desktop-episodes-loop",
    canonicalId: "ep-{{ e.slotId }}",
    screen: "series-desktop",
    role: "episode",
    implementation: "conditional",
  },
  {
    id: "series-desktop-cast-loop",
    canonicalId: "cast-{{ c.initials }}",
    screen: "series-desktop",
    role: "cast",
    implementation: "conditional",
  },
  {
    id: "series-desktop-news-loop",
    canonicalId: "{{ a.slotId }}",
    screen: "series-desktop",
    role: "news",
    implementation: "conditional",
  },
  {
    id: "series-desktop-recommendations-loop",
    canonicalId: "{{ m.slotId }}",
    screen: "series-desktop",
    role: "recommendation",
    implementation: "deferred",
  },
  {
    id: "series-mobile-backdrop",
    canonicalId: "series-backdrop",
    screen: "series-mobile",
    role: "backdrop",
    implementation: "conditional",
  },
  {
    id: "series-mobile-episodes-loop",
    canonicalId: "ep-{{ e.slotId }}",
    screen: "series-mobile",
    role: "episode",
    implementation: "conditional",
  },
  {
    id: "series-mobile-recommendations-loop",
    canonicalId: "{{ m.slotId }}",
    screen: "series-mobile",
    role: "recommendation",
    implementation: "deferred",
  },
  {
    id: "discover-feature-backdrop",
    canonicalId: "{{ discFeature.slot }}",
    screen: "discover",
    role: "backdrop",
    implementation: "deferred",
  },
  {
    id: "discover-feature-poster",
    canonicalId: "{{ discFeature.posterSlot }}",
    screen: "discover",
    role: "poster",
    implementation: "deferred",
  },
  {
    id: "discover-catalog-loop",
    canonicalId: "{{ m.slot }}",
    screen: "discover",
    role: "poster",
    implementation: "deferred",
  },
  {
    id: "discover-continue-watching-loop",
    canonicalId: "{{ m.slot }}",
    screen: "discover",
    role: "continue-watching",
    implementation: "deferred",
  },
  {
    id: "discover-releases-loop",
    canonicalId: "{{ m.slot }}",
    screen: "discover",
    role: "release",
    implementation: "conditional",
  },
  {
    id: "discover-anticipated-loop",
    canonicalId: "{{ m.slot }}",
    screen: "discover",
    role: "poster",
    implementation: "deferred",
  },
  {
    id: "discover-popular-loop",
    canonicalId: "{{ m.slot }}",
    screen: "discover",
    role: "poster",
    implementation: "deferred",
  },
  {
    id: "anticipated-poster-loop",
    canonicalId: "{{ c.posterSlot }}",
    screen: "anticipated",
    role: "poster",
    implementation: "deferred",
  },
  {
    id: "settings-avatar",
    canonicalId: "v3-settings-avatar",
    screen: "settings",
    role: "avatar",
    implementation: "deferred",
  },
] as const satisfies readonly CanonicalImageSlot[];
