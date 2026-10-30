/**
 * fixtures.ts — as ofertas FICTICIAS do canonico, no formato do contrato. PURO.
 *
 * So existe para QA visual (`OPAPRECO_MODE=fixtures`, recusado na origem
 * oficial — ver `config.ts`). Os produtos, precos e titulos sao os `opa.*` de
 * `Screen Screens v4.dc.html` (bloco de logica): nao sao ofertas reais, nao
 * apontam para afiliado real e nunca vao ao ar.
 *
 * Cada fixture sai como RESPOSTA DO AD SERVER (`ad-response.schema.json`) e
 * passa pelo MESMO `normalizeAdResponse` da producao — assim o QA visual
 * exercita a validacao, e nao um atalho.
 */

import type { OpSlotId, OpSlotTags, OpViewport } from "./slots";

type Ratio = "square" | "vertical" | "horizontal";

interface FixtureExtra {
  readonly ratio?: Ratio;
  readonly ref?: number;
  readonly pct?: number;
  readonly minutes: number;
  readonly eyebrow?: "Menor preço recente";
  readonly lowest30d?: number;
  readonly official?: boolean;
  readonly drop?: { readonly from: number; readonly percent: number; readonly since: string };
  readonly noImage?: boolean;
}

/** Placeholders neutros em `public/media/demo/opapreco/` (silhueta cinza, sem marca). */
const IMAGE: Record<Ratio, string> = {
  square: "/media/demo/opapreco/produto-quadrado.svg",
  vertical: "/media/demo/opapreco/produto-vertical.svg",
  horizontal: "/media/demo/opapreco/produto-horizontal.svg",
};

/** Id estavel por titulo: a mesma fixture tem o mesmo id em toda requisicao. */
function fixtureId(title: string): string {
  return `fixture-${title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)}`;
}

function offer(title: string, price: number, extra: FixtureExtra, now: number): Record<string, unknown> {
  const ratio = extra.ratio ?? "square";
  const id = fixtureId(title);
  return {
    offerId: id,
    productTitle: title,
    productImage: extra.noImage === true ? null : IMAGE[ratio],
    imageRatio: ratio,
    currentPrice: price,
    ...(extra.ref !== undefined && extra.pct !== undefined
      ? { referencePrice: extra.ref, discountPercent: extra.pct }
      : {}),
    currency: "BRL",
    merchant: "Shopee",
    ...(extra.official === true ? { isOfficialStore: true } : {}),
    ...(extra.eyebrow !== undefined ? { eyebrow: extra.eyebrow } : {}),
    ...(extra.lowest30d !== undefined ? { historicalPrice: { lowest30d: extra.lowest30d } } : {}),
    ...(extra.drop !== undefined ? { priceDrop: extra.drop } : {}),
    checkedAt: new Date(now - extra.minutes * 60_000).toISOString(),
    href: `https://example.com/aff/${id}`,
  };
}

type OfferFactory = (now: number) => Record<string, unknown>;
const o =
  (title: string, price: number, extra: FixtureExtra): OfferFactory =>
  (now) =>
    offer(title, price, extra, now);

interface GridFixture {
  readonly heading: string;
  readonly offers: readonly OfferFactory[];
}

const GRIDS: readonly GridFixture[] = [
  {
    heading: "Ofertas para o seu cinema em casa",
    offers: [
      o("Smart TV 55 polegadas 4K QLED com Google TV", 2899, { ref: 3499, pct: 17, ratio: "horizontal", minutes: 9 }),
      o("Soundbar JBL Cinema SB190 2.1", 899, { ref: 1099, pct: 18, ratio: "horizontal", minutes: 9 }),
      o("Fire TV Stick 4K com Alexa", 379.9, { ref: 474.9, pct: 20, minutes: 6 }),
      o("Projetor portátil Full HD 1080p com Wi-Fi", 1299, { minutes: 12 }),
    ],
  },
  {
    heading: "Para montar sua coleção",
    offers: [
      o("Box Blu-ray Trilogia O Senhor dos Anéis, versão estendida", 279.9, { ref: 349.9, pct: 20, ratio: "vertical", minutes: 10 }),
      o("Blu-ray 4K Oppenheimer (Steelbook)", 159.9, { ratio: "vertical", minutes: 8 }),
      o("Box Blu-ray Coleção Studio Ghibli, 8 filmes", 399.9, { ref: 499.9, pct: 20, ratio: "vertical", minutes: 14 }),
      o("Estante de parede para mídias físicas", 189.9, { ratio: "horizontal", minutes: 12 }),
    ],
  },
  {
    heading: "Para maratonar no fim de semana",
    offers: [
      o("Fone Bluetooth com cancelamento de ruído", 449.9, { ref: 599.9, pct: 25, minutes: 8 }),
      o("Suporte articulado para TV de 32 a 65 polegadas", 119.9, { ratio: "horizontal", minutes: 13 }),
      o("Almofada de encosto ergonômica para sofá", 89.9, { minutes: 6 }),
      o("Luminária de mesa LED com regulagem de luz", 74.9, { ref: 99.9, pct: 25, ratio: "vertical", minutes: 11 }),
    ],
  },
  {
    heading: "Colecionáveis em oferta",
    offers: [
      o("Funko Pop! Star Wars Grogu com xícara", 99.9, { ref: 129.9, pct: 23, ratio: "vertical", minutes: 7 }),
      o("Action figure Marvel Legends Homem-Aranha 15 cm", 229.9, { ratio: "vertical", minutes: 10 }),
      o("LEGO Harry Potter Castelo de Hogwarts, 878 peças", 649.9, { ref: 799.9, pct: 19, minutes: 12 }),
      o("Réplica do sabre de luz Luke Skywalker com LED", 349.9, { ratio: "horizontal", minutes: 9 }),
    ],
  },
  {
    heading: "Streaming na sua TV",
    offers: [
      o("Chromecast com Google TV 4K", 349.9, { ref: 429.9, pct: 19, minutes: 5 }),
      o("Roku Express 4K com controle remoto", 299.9, { ref: 379.9, pct: 21, minutes: 7 }),
      o("Fire TV Stick Lite com Alexa", 249.9, { minutes: 6 }),
      o("Cabo HDMI 2.1 8K 2 m", 49.9, { ratio: "horizontal", minutes: 14 }),
    ],
  },
  {
    heading: "Livros que viraram filme",
    offers: [
      o("Duna, Frank Herbert (edição especial capa dura)", 89.9, { ref: 119.9, pct: 25, ratio: "vertical", minutes: 11 }),
      o("O Senhor dos Anéis, volume único", 119.9, { ratio: "vertical", minutes: 9 }),
      o("Oppenheimer: O Triunfo e a Tragédia do Prometeu Americano", 99.9, { ref: 129.9, pct: 23, ratio: "vertical", minutes: 13 }),
      o("Box Jogos Vorazes, 4 livros", 139.9, { ratio: "horizontal", minutes: 8 }),
    ],
  },
];

const HEROES: readonly OfferFactory[] = [
  o("Smart TV 65 polegadas 4K OLED com Dolby Vision", 5999, { ref: 6999, pct: 14, ratio: "horizontal", eyebrow: "Menor preço recente", lowest30d: 5999, official: true, minutes: 10 }),
  o("Projetor 4K com Android TV e alto-falante integrado", 2499, { ref: 2999, pct: 17, ratio: "horizontal", official: true, minutes: 12 }),
  o("Box Blu-ray 4K Coleção Christopher Nolan, 8 filmes", 599.9, { ref: 749.9, pct: 20, ratio: "horizontal", eyebrow: "Menor preço recente", lowest30d: 599.9, minutes: 9 }),
];

const CARDS: readonly OfferFactory[] = [
  o("Box Blu-ray 4K Duna: Parte Dois (Steelbook)", 149.9, { ref: 199.9, pct: 25, ratio: "vertical", minutes: 10 }),
  o("Chromecast com Google TV 4K", 349.9, { ref: 429.9, pct: 19, minutes: 5 }),
  o("Fone Bluetooth com cancelamento de ruído", 449.9, { ref: 599.9, pct: 25, minutes: 8 }),
  o("Fire TV Stick 4K com Alexa", 379.9, { ref: 474.9, pct: 20, minutes: 6 }),
];

/** g1..g14 do canonico percorrem as 6 grades em ciclo. */
function g(n: number): GridFixture {
  return GRIDS[(n - 1) % GRIDS.length] as GridFixture;
}
function h(n: number): OfferFactory {
  return HEROES[(n - 1) % HEROES.length] as OfferFactory;
}
function c(n: number): OfferFactory {
  return CARDS[(n - 1) % CARDS.length] as OfferFactory;
}

const NEWS_TOP = o("Fire TV Stick 4K com controle remoto por voz Alexa", 379.9, { ref: 474.9, pct: 20, minutes: 6 });
const MOVIE_HERO = o("Soundbar JBL Cinema SB190 2.1 com subwoofer sem fio", 899, { ref: 1099, pct: 18, ratio: "horizontal", eyebrow: "Menor preço recente", lowest30d: 899, official: true, minutes: 9 });
const SERIES_HERO = o("Roku Express 4K com controle remoto", 299.9, { ref: 379.9, pct: 21, eyebrow: "Menor preço recente", lowest30d: 299.9, minutes: 7 });
const ARTICLE_HERO = o("Demolidor: A Queda de Murdock, Edição Definitiva (Panini, capa dura)", 129.9, { ref: 169.9, pct: 24, ratio: "vertical", eyebrow: "Menor preço recente", lowest30d: 129.9, official: true, minutes: 12 });
const ARTICLE_CONTEXT = {
  context: "Para quem vai assistir Daredevil: Born Again",
  note: "Reproduz Disney+ em 4K com Dolby Vision e HDR10+ pela entrada HDMI da TV.",
  offer: o("Fire TV Stick 4K com controle remoto por voz Alexa", 379.9, { ref: 474.9, pct: 20, minutes: 6 }),
};
const ARTICLE_DROP = o("Funko Pop! Marvel Demolidor Born Again", 89.9, { ratio: "vertical", drop: { from: 119.9, percent: 25, since: "nas últimas 24 h" }, minutes: 4 });
const ARTICLE_GRID: GridFixture = {
  heading: "Ofertas para fãs do Demolidor",
  offers: [
    o("Action figure Marvel Legends Demolidor 15 cm", 249.9, { ratio: "vertical", minutes: 9 }),
    o("Demolidor por Frank Miller Omnibus (Panini)", 299.9, { ref: 379.9, pct: 21, ratio: "vertical", minutes: 14 }),
    o("Caneca de porcelana Demolidor 350 ml", 49.9, { minutes: 11 }),
    o("Luminária LED Demolidor logo DD", 69.9, { ref: 89.9, pct: 22, ratio: "horizontal", minutes: 7 }),
  ],
};
const MOVIE_GRID: GridFixture = {
  heading: "Para sua sessão em casa",
  offers: [
    o("Projetor portátil Full HD 1080p com Wi-Fi", 1299, { ref: 1599, pct: 19, minutes: 12 }),
    o("Chromecast com Google TV 4K", 349.9, { minutes: 5 }),
    o("Pipoqueira elétrica sem óleo 1200 W", 129.9, { ref: 159.9, pct: 19, minutes: 15 }),
    o("Manta de sofá microfibra 1,5 × 2 m", 79.9, { ratio: "horizontal", minutes: 10 }),
  ],
};
const SERIES_GRID: GridFixture = g(3);
const LIST_GRID: GridFixture = g(2);

type FixtureShape =
  | { readonly kind: "grid"; readonly grid: GridFixture }
  | { readonly kind: "single"; readonly component: string; readonly offer: OfferFactory }
  | { readonly kind: "context" };

function shapeFor(slot: OpSlotId, viewport: OpViewport, tags: OpSlotTags): FixtureShape {
  const series = tags.vertical === "series";
  switch (slot) {
    case "home-after-popular":
      return { kind: "grid", grid: g(1) };
    case "home-after-movies":
      return { kind: "grid", grid: g(2) };
    case "home-after-coming-soon":
      return { kind: "grid", grid: g(3) };
    case "news-top":
      return { kind: "single", component: "product_compact_v1", offer: NEWS_TOP };
    case "news-feed-01":
      return { kind: "grid", grid: g(6) };
    case "news-feed-inline":
      return { kind: "grid", grid: g(7) };
    case "news-sidebar":
      return { kind: "single", component: "product_card_v1", offer: c(1) };
    case "news-cat-billboard":
      return { kind: "single", component: "product_hero_v1", offer: h(1) };
    case "news-cat-sidebar":
      return { kind: "single", component: "product_card_v1", offer: c(2) };
    case "article-top":
      return {
        kind: "single",
        component: viewport === "mobile" ? "product_compact_v1" : "product_hero_v1",
        offer: ARTICLE_HERO,
      };
    case "article-inline-01":
      return { kind: "context" };
    case "article-inline-02":
      return { kind: "single", component: "price_drop_v1", offer: ARTICLE_DROP };
    case "article-bottom":
      return { kind: "grid", grid: ARTICLE_GRID };
    case "title-mid":
      return { kind: "single", component: "product_hero_v1", offer: series ? SERIES_HERO : MOVIE_HERO };
    case "title-bottom":
      return { kind: "grid", grid: series ? SERIES_GRID : MOVIE_GRID };
    case "person-bottom":
      return { kind: "grid", grid: g(9) };
    case "browse-01":
      return { kind: "grid", grid: g(10) };
    case "browse-02":
      return { kind: "grid", grid: g(11) };
    case "discover-top":
      return { kind: "grid", grid: g(12) };
    case "lists-top":
      return { kind: "grid", grid: g(13) };
    case "lists-billboard":
      return { kind: "single", component: "product_hero_v1", offer: h(2) };
    case "lists-collection":
      return { kind: "grid", grid: LIST_GRID };
    case "lists-bottom":
      return { kind: "grid", grid: g(14) };
    case "auth-sidebar":
      return { kind: "single", component: "product_card_v1", offer: c(3) };
    case "popup":
      return { kind: "single", component: "product_card_v1", offer: c(4) };
    case "interstitial":
      return { kind: "single", component: "product_hero_v1", offer: h(3) };
  }
}

/** URL de impressao de fixture: dominio `.invalid`, que a rota de tracking nunca dispara. */
const FIXTURE_IMPRESSION = "https://fixtures.opapreco.invalid/impression";

/**
 * A resposta de ad server que o slot receberia, montada a partir do canonico.
 * Sai no formato do CONTRATO; quem valida e `normalizeAdResponse`.
 */
export function buildFixtureAdResponse(
  slot: OpSlotId,
  viewport: OpViewport,
  tags: OpSlotTags,
  now: number,
): Record<string, unknown> {
  const shape = shapeFor(slot, viewport, tags);
  const requestId = `fixture-${slot}-${viewport}`;
  const tracking = { impressionUrl: `${FIXTURE_IMPRESSION}/${encodeURIComponent(requestId)}` };
  if (shape.kind === "grid") {
    return {
      requestId,
      slot,
      component: "product_grid_v1",
      props: { heading: shape.grid.heading, offers: shape.grid.offers.map((make) => make(now)) },
      tracking,
    };
  }
  if (shape.kind === "context") {
    return {
      requestId,
      slot,
      component: "contextual_recommendation_v1",
      props: {
        offer: ARTICLE_CONTEXT.offer(now),
        context: ARTICLE_CONTEXT.context,
        contextNote: ARTICLE_CONTEXT.note,
      },
      tracking,
    };
  }
  return { requestId, slot, component: shape.component, props: { offer: shape.offer(now) }, tracking };
}
