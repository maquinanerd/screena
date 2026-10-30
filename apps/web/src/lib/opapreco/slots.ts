/**
 * slots.ts — o REGISTRO dos slots OpaPreco da Cinerie. PURO (sem rede, DB, env
 * ou IO): importavel por client component.
 *
 * Cada posicao de `OPAPRECO-SLOT-MAP.md` tem aqui um id, o componente que ela
 * aceita em cada faixa de viewport e a reserva de altura da SPEC (§5, §14). A
 * pagina NAO escolhe componente: ela diz o id; o registro diz o resto. Assim um
 * slot nunca reserva a altura de um componente e recebe outro (CLS).
 *
 * Faixas de viewport da SPEC (§6): mobile < 768, tablet 768–1023, desktop >= 1024.
 */

export const OP_SLOT_IDS = [
  "home-after-popular",
  "home-after-movies",
  "home-after-coming-soon",
  "news-top",
  "news-feed-01",
  "news-feed-inline",
  "news-sidebar",
  "news-cat-billboard",
  "news-cat-sidebar",
  "article-top",
  "article-inline-01",
  "article-inline-02",
  "article-bottom",
  "title-mid",
  "title-bottom",
  "person-bottom",
  "browse-01",
  "browse-02",
  "discover-top",
  "lists-top",
  "lists-billboard",
  "lists-collection",
  "lists-bottom",
  "auth-sidebar",
  "popup",
  "interstitial",
] as const;

export type OpSlotId = (typeof OP_SLOT_IDS)[number];

export type OpVertical = "home" | "movie" | "series" | "news" | "person" | "mixed";

/** O que a pagina sabe dizer sobre si ao ad server (nunca dado do leitor). */
export interface OpSlotTags {
  readonly vertical?: OpVertical;
  /** Slug da entidade da pagina (filme, serie, pessoa, materia). */
  readonly entity?: string;
  readonly genres?: readonly string[];
  /** Categoria editorial (noticias). */
  readonly category?: string;
}

export const OP_COMPONENTS = [
  "product_card_v1",
  "product_compact_v1",
  "product_hero_v1",
  "product_grid_v1",
  "price_drop_v1",
  "contextual_recommendation_v1",
] as const;

export type OpComponentName = (typeof OP_COMPONENTS)[number];

export type OpViewport = "mobile" | "tablet" | "desktop";

export const OP_VIEWPORTS: readonly OpViewport[] = ["mobile", "tablet", "desktop"];

/** Faixa de viewport pela largura da JANELA (so para escolher o slot; o componente responde ao container). */
export function viewportOf(windowWidth: number): OpViewport {
  if (windowWidth < 768) return "mobile";
  if (windowWidth < 1024) return "tablet";
  return "desktop";
}

/**
 * Reserva de altura (px) por componente, na largura que o slot tem naquela faixa.
 *
 *  - grade: SEM `min-height`. A altura da grade depende da largura do
 *    CONTAINER, nao do viewport (2 ou 4 colunas, cabecalho em 1 ou 2 linhas,
 *    preco ao lado ou embaixo do desconto), e nenhuma expressao por faixa de
 *    viewport acerta isso: medido em 30/10/2026, a formula por viewport
 *    reservava 824px no celular para uma grade de 742 e 372px em 768 para uma
 *    de 702. A reserva da grade e o proprio SKELETON, que usa as MESMAS
 *    container queries do componente (`opapreco.css`) e mede o que ela mede.
 *  - compacto 88 (dentro da faixa de 90 do topo de noticias), hero 344/642,
 *    card vertical 416, contextual 270/370, queda de preco 216/352.
 */
/** A grade reserva pela geometria do skeleton (ver acima), nao por `min-height`. */
const GRID_RESERVE_BY_SKELETON = "0px";

export interface OpSlotDefinition {
  readonly id: OpSlotId;
  /** Componente servido em cada faixa (o primeiro e o esperado). */
  readonly components: Readonly<Record<OpViewport, readonly OpComponentName[]>>;
  /** Reserva (valor CSS) por faixa. `null` = o slot nao existe nessa faixa. */
  readonly reserve: Readonly<Record<OpViewport, string | null>>;
  /** Lateral fixa: so >= 1024px, sticky no topo (SPEC §6). */
  readonly sidebar: boolean;
}

type Spec = {
  readonly component: OpComponentName;
  readonly reserve: string;
  readonly mobile?: { readonly component: OpComponentName; readonly reserve: string };
  readonly fallback?: OpComponentName;
};

const GRID: Spec = {
  component: "product_grid_v1",
  reserve: GRID_RESERVE_BY_SKELETON,
  mobile: { component: "product_grid_v1", reserve: GRID_RESERVE_BY_SKELETON },
};
const HERO: Spec = {
  component: "product_hero_v1",
  reserve: "344px",
  mobile: { component: "product_hero_v1", reserve: "642px" },
};
const CARD_VERTICAL: Spec = { component: "product_card_v1", reserve: "416px" };

function slot(id: OpSlotId, spec: Spec, sidebar = false): OpSlotDefinition {
  const wide = spec.fallback ? [spec.component, spec.fallback] : [spec.component];
  const mobileComponent = spec.mobile?.component ?? spec.component;
  const narrow = spec.fallback ? [mobileComponent, spec.fallback] : [mobileComponent];
  return {
    id,
    sidebar,
    components: { mobile: narrow, tablet: wide, desktop: wide },
    reserve: sidebar
      ? { mobile: null, tablet: null, desktop: spec.reserve }
      : { mobile: spec.mobile?.reserve ?? spec.reserve, tablet: spec.reserve, desktop: spec.reserve },
  };
}

export const OP_SLOTS: Readonly<Record<OpSlotId, OpSlotDefinition>> = {
  "home-after-popular": slot("home-after-popular", GRID),
  "home-after-movies": slot("home-after-movies", GRID),
  "home-after-coming-soon": slot("home-after-coming-soon", GRID),
  // Faixa 728x90 a direita das abas: compacto de 88 numa caixa de 90.
  "news-top": slot("news-top", { component: "product_compact_v1", reserve: "90px" }),
  "news-feed-01": slot("news-feed-01", GRID),
  "news-feed-inline": slot("news-feed-inline", GRID),
  "news-sidebar": slot("news-sidebar", CARD_VERTICAL, true),
  "news-cat-billboard": slot("news-cat-billboard", HERO),
  "news-cat-sidebar": slot("news-cat-sidebar", CARD_VERTICAL, true),
  // SPEC §6 / DECISIONS B-04: no celular o topo da materia serve o compacto.
  "article-top": slot("article-top", {
    component: "product_hero_v1",
    reserve: "344px",
    mobile: { component: "product_compact_v1", reserve: "88px" },
  }),
  "article-inline-01": slot("article-inline-01", {
    component: "contextual_recommendation_v1",
    reserve: "270px",
    mobile: { component: "contextual_recommendation_v1", reserve: "370px" },
  }),
  // Queda de preco comprovada; sem ela o ad server serve o compacto.
  "article-inline-02": slot("article-inline-02", {
    component: "price_drop_v1",
    reserve: "216px",
    mobile: { component: "price_drop_v1", reserve: "352px" },
    fallback: "product_compact_v1",
  }),
  "article-bottom": slot("article-bottom", GRID),
  "title-mid": slot("title-mid", HERO),
  "title-bottom": slot("title-bottom", GRID),
  "person-bottom": slot("person-bottom", GRID),
  "browse-01": slot("browse-01", GRID),
  "browse-02": slot("browse-02", GRID),
  "discover-top": slot("discover-top", GRID),
  "lists-top": slot("lists-top", GRID),
  "lists-billboard": slot("lists-billboard", HERO),
  "lists-collection": slot("lists-collection", GRID),
  "lists-bottom": slot("lists-bottom", GRID),
  "auth-sidebar": slot("auth-sidebar", CARD_VERTICAL, true),
  // Pop-up (tela 17): card vertical num cartao de 300px.
  popup: slot("popup", CARD_VERTICAL),
  // Interstitial (tela 18): hero no centro da tela escura.
  interstitial: slot("interstitial", HERO),
};

export function isOpSlotId(value: unknown): value is OpSlotId {
  return typeof value === "string" && (OP_SLOT_IDS as readonly string[]).includes(value);
}

export function isOpComponentName(value: unknown): value is OpComponentName {
  return typeof value === "string" && (OP_COMPONENTS as readonly string[]).includes(value);
}

/** O componente que o slot espera no desktop — o `data-ad-component` do HTML do servidor. */
export function primaryComponentOf(id: OpSlotId): OpComponentName {
  return OP_SLOTS[id].components.desktop[0] ?? "product_card_v1";
}

/** O componente recebido e aceito por este slot nesta faixa? */
export function slotAccepts(id: OpSlotId, viewport: OpViewport, component: OpComponentName): boolean {
  return OP_SLOTS[id].components[viewport].includes(component);
}
