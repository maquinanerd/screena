/**
 * types.ts — a oferta e a decisao de anuncio JA VALIDADAS. PURO.
 *
 * O contrato de rede (`docs/opapreco/contracts/*.schema.json`) chega como
 * `unknown` e so vira estes tipos depois de `normalize.ts`. Os componentes nunca
 * veem o formato cru: o que esta aqui ja passou pelas regras de exibicao da SPEC
 * (desconto so com prova, verificacao ate 6 h, link https).
 */

import type { OpComponentName } from "./slots";

export type OfferImageRatio = "square" | "vertical" | "horizontal";

export type OfferEyebrow = "Oferta verificada" | "Menor preço recente" | "Boa oportunidade";

export type AffiliateDisclosure = "Link de afiliado" | "Oferta afiliada" | "Links de afiliado";

export interface OfferPriceDrop {
  readonly from: number;
  readonly percent: number;
  readonly since: string | null;
}

export interface Offer {
  readonly offerId: string;
  readonly productTitle: string;
  /** Caminho de mesma origem (proxy ou placeholder de QA) ou `null` = icone neutro. */
  readonly productImage: string | null;
  readonly imageRatio: OfferImageRatio;
  readonly currentPrice: number;
  /** Os dois existem juntos ou nenhum: desconto so com prova (SPEC §4). */
  readonly referencePrice: number | null;
  readonly discountPercent: number | null;
  readonly merchant: "Shopee";
  /** ISO 8601 da ultima verificacao (ja garantida < 6 h na validacao). */
  readonly checkedAt: string;
  readonly href: string;
  readonly cta: string | null;
  readonly ctaShort: string | null;
  readonly eyebrow: OfferEyebrow | null;
  readonly affiliateDisclosure: AffiliateDisclosure | null;
  readonly priceDrop: OfferPriceDrop | null;
  readonly lowest30d: number | null;
  readonly isOfficialStore: boolean;
}

interface DecisionBase {
  readonly requestId: string;
  readonly impressionUrl: string;
  /** Depois disso a oferta pode estar vencida: o clique revalida (estado disabled). */
  readonly expiresAt: string | null;
}

export type SingleOfferComponent = Exclude<
  OpComponentName,
  "product_grid_v1" | "contextual_recommendation_v1"
>;

export interface SingleOfferDecision extends DecisionBase {
  readonly component: SingleOfferComponent;
  readonly offer: Offer;
}

export interface ContextualDecision extends DecisionBase {
  readonly component: "contextual_recommendation_v1";
  readonly offer: Offer;
  readonly context: string;
  readonly contextNote: string | null;
}

export interface GridDecision extends DecisionBase {
  readonly component: "product_grid_v1";
  readonly offers: readonly Offer[];
  readonly heading: string | null;
}

export type AdDecision = SingleOfferDecision | ContextualDecision | GridDecision;
