/**
 * Inventário das 23 posições de publicidade do HTML canônico.
 *
 * Esta tabela não ativa rede nem publicidade. Ela preserva o contrato visual
 * integral, inclusive as posições de superfícies que o produto real ainda não
 * pode renderizar sem autenticação, comunidade ou configuração publicitária.
 */

export type CanonicalAdScreen =
  | "home"
  | "news-all"
  | "news-category"
  | "category-home"
  | "article"
  | "person"
  | "browse"
  | "discover"
  | "lists"
  | "sign-in"
  | "ad-popup"
  | "ad-interstitial";

export type CanonicalAdImplementation = "active" | "conditional" | "deferred";
export type CanonicalAdVariant =
  | "leaderboard"
  | "billboard"
  | "skyscraper"
  | "rectangle";

export interface CanonicalAdPlacement {
  readonly id: string;
  readonly screen: CanonicalAdScreen;
  readonly variant: CanonicalAdVariant;
  readonly margin: string;
  readonly hintWidth: "100%" | "300px";
  readonly hintHeight: number;
  readonly implementation: CanonicalAdImplementation;
  readonly label?: "";
}

export const CANONICAL_AD_PLACEMENTS = [
  {
    id: "home-after-top-10",
    screen: "home",
    variant: "leaderboard",
    margin: "56px 0 56px",
    hintWidth: "100%",
    hintHeight: 120,
    implementation: "active",
  },
  {
    id: "home-before-series",
    screen: "home",
    variant: "leaderboard",
    margin: "56px 0 0",
    hintWidth: "100%",
    hintHeight: 120,
    implementation: "active",
  },
  {
    id: "home-before-news",
    screen: "home",
    variant: "leaderboard",
    margin: "56px 0 0",
    hintWidth: "100%",
    hintHeight: 120,
    implementation: "active",
  },
  {
    id: "news-all-header",
    screen: "news-all",
    variant: "leaderboard",
    margin: "0",
    hintWidth: "100%",
    hintHeight: 110,
    implementation: "active",
  },
  {
    id: "news-all-after-magazine",
    screen: "news-all",
    variant: "leaderboard",
    margin: "56px 0 0",
    hintWidth: "100%",
    hintHeight: 130,
    implementation: "active",
  },
  {
    id: "news-all-feed-inline",
    screen: "news-all",
    variant: "leaderboard",
    margin: "0 0 4px",
    hintWidth: "100%",
    hintHeight: 130,
    implementation: "conditional",
  },
  {
    id: "news-all-sidebar",
    screen: "news-all",
    variant: "skyscraper",
    margin: "0",
    hintWidth: "100%",
    hintHeight: 640,
    implementation: "conditional",
  },
  {
    id: "news-category-billboard",
    screen: "news-category",
    variant: "billboard",
    margin: "52px 0 0",
    hintWidth: "100%",
    hintHeight: 290,
    implementation: "deferred",
  },
  {
    id: "news-category-sidebar",
    screen: "news-category",
    variant: "skyscraper",
    margin: "0",
    hintWidth: "100%",
    hintHeight: 600,
    implementation: "deferred",
  },
  {
    id: "category-before-catalog",
    screen: "category-home",
    variant: "leaderboard",
    margin: "56px 0 0",
    hintWidth: "100%",
    hintHeight: 120,
    implementation: "active",
  },
  {
    id: "category-before-coming",
    screen: "category-home",
    variant: "billboard",
    margin: "72px 0 0",
    hintWidth: "100%",
    hintHeight: 290,
    implementation: "active",
  },
  {
    id: "category-before-news",
    screen: "category-home",
    variant: "leaderboard",
    margin: "56px 0 0",
    hintWidth: "100%",
    hintHeight: 120,
    implementation: "active",
  },
  {
    id: "article-mid-body",
    screen: "article",
    variant: "leaderboard",
    margin: "0",
    hintWidth: "100%",
    hintHeight: 130,
    implementation: "conditional",
  },
  {
    id: "person-before-filmography",
    screen: "person",
    variant: "leaderboard",
    margin: "56px 0 0",
    hintWidth: "100%",
    hintHeight: 130,
    implementation: "active",
  },
  {
    id: "browse-after-streaming",
    screen: "browse",
    variant: "leaderboard",
    margin: "52px 0 0",
    hintWidth: "100%",
    hintHeight: 120,
    implementation: "deferred",
  },
  {
    id: "browse-after-recommendations",
    screen: "browse",
    variant: "leaderboard",
    margin: "52px 0 0",
    hintWidth: "100%",
    hintHeight: 120,
    implementation: "deferred",
  },
  {
    id: "discover-before-heading",
    screen: "discover",
    variant: "leaderboard",
    margin: "0 0 36px",
    hintWidth: "100%",
    hintHeight: 120,
    implementation: "active",
  },
  {
    id: "lists-before-heading",
    screen: "lists",
    variant: "leaderboard",
    margin: "0 0 44px",
    hintWidth: "100%",
    hintHeight: 120,
    implementation: "deferred",
  },
  {
    id: "lists-before-featured",
    screen: "lists",
    variant: "billboard",
    margin: "44px 0 0",
    hintWidth: "100%",
    hintHeight: 290,
    implementation: "deferred",
  },
  {
    id: "lists-footer",
    screen: "lists",
    variant: "leaderboard",
    margin: "52px 0 0",
    hintWidth: "100%",
    hintHeight: 120,
    implementation: "deferred",
  },
  {
    id: "sign-in-sidebar",
    screen: "sign-in",
    variant: "skyscraper",
    margin: "0",
    hintWidth: "300px",
    hintHeight: 600,
    implementation: "deferred",
  },
  {
    id: "ad-popup-rectangle",
    screen: "ad-popup",
    variant: "rectangle",
    margin: "0",
    hintWidth: "300px",
    hintHeight: 250,
    implementation: "deferred",
  },
  {
    id: "ad-interstitial-billboard",
    screen: "ad-interstitial",
    variant: "billboard",
    margin: "0",
    hintWidth: "100%",
    hintHeight: 320,
    implementation: "deferred",
    label: "",
  },
] as const satisfies readonly CanonicalAdPlacement[];
