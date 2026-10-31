/**
 * normalize.ts — o contrato do ad server conferido a mao. PURO (sem rede).
 *
 * Fonte: `docs/opapreco/contracts/ad-response.schema.json` e `offer.schema.json`,
 * mais as regras de exibicao da SPEC (§4). Sem dependencia nova: o schema e
 * pequeno e cada regra aqui tem um motivo que o leitor ve.
 *
 * A REGRA DE OURO E A DA SPEC §1.6: "falha silenciosa". Qualquer coisa fora do
 * contrato devolve `null` e o slot colapsa — nunca mensagem para o leitor, nunca
 * meia oferta. O que o leitor NAO ve, mas o contrato poderia deixar passar:
 *  - desconto sem prova (referencia <= preco, ou < 5%) — os DOIS campos somem e
 *    a oferta aparece so com o preco atual (fixtures `mustHideDiscount`);
 *  - oferta verificada ha mais de 6 h, sem titulo, ou com link que nao e https
 *    (titulo acima de 120 caracteres e cortado, nao recusado);
 *  - queda de preco que nao e queda (fixture `fakeDrop`) — o slot colapsa;
 *  - grade com menos de 2 ofertas validas.
 */

import { MAX_CHECK_AGE_MINUTES } from "./format";
import {
  isOpComponentName,
  slotAccepts,
  type OpComponentName,
  type OpSlotId,
  type OpViewport,
} from "./slots";
import type {
  AdDecision,
  AffiliateDisclosure,
  Offer,
  OfferEyebrow,
  OfferImageRatio,
  OfferPriceDrop,
} from "./types";

export interface NormalizeContext {
  readonly slot: OpSlotId;
  readonly viewport: OpViewport;
  /** Agora (ms), injetado para teste. */
  readonly now: number;
  /**
   * Converte a URL de imagem do ad server no caminho que o navegador vai pedir
   * (o proxy de mesma origem), ou `null` quando o host nao esta liberado.
   */
  readonly resolveImage: (src: string) => string | null;
}

const EYEBROWS: readonly OfferEyebrow[] = ["Oferta verificada", "Menor preço recente", "Boa oportunidade"];
const DISCLOSURES: readonly AffiliateDisclosure[] = ["Link de afiliado", "Oferta afiliada", "Links de afiliado"];
const RATIOS: readonly OfferImageRatio[] = ["square", "vertical", "horizontal"];

/** Tolerancia para relogio adiantado do ad server: verificacao "no futuro" vale como agora. */
const CLOCK_SKEW_MS = 5 * 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function boundedText(value: unknown, max: number, min = 1): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text.length >= min && text.length <= max ? text : null;
}

/**
 * Titulo: o backend ja deveria mandar no maximo 120 caracteres (SPEC §9). Se
 * passar, corta na ultima palavra inteira e poe reticencias — o card faz o
 * clamp de 2/3 linhas de qualquer jeito; recusar a oferta por isso seria punir
 * o leitor pelo erro do backend (a fixture `longTitle` tem 124).
 */
function productTitleOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length < 3) return null;
  if (text.length <= 120) return text;
  const cut = text.slice(0, 119);
  const space = cut.lastIndexOf(" ");
  return `${(space > 60 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/** So https e sem credencial embutida. `#`, `http:` e `javascript:` caem aqui. */
export function isSafeOfferHref(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

function normalizePriceDrop(value: unknown, currentPrice: number): OfferPriceDrop | null {
  if (!isRecord(value)) return null;
  const from = positiveNumber(value.from);
  const percent = value.percent;
  if (from === null || !(from > currentPrice)) return null;
  if (typeof percent !== "number" || !Number.isInteger(percent) || percent < 5) return null;
  return { from, percent, since: boundedText(value.since, 32) };
}

/**
 * Uma oferta do contrato -> `Offer`, ou `null` quando ela nao pode ser servida.
 */
export function normalizeOffer(raw: unknown, context: NormalizeContext): Offer | null {
  if (!isRecord(raw)) return null;

  const offerId = boundedText(raw.offerId, 200);
  const productTitle = productTitleOf(raw.productTitle);
  const currentPrice = positiveNumber(raw.currentPrice);
  if (offerId === null || productTitle === null || currentPrice === null) return null;
  if (raw.merchant !== "Shopee") return null;
  if (raw.currency !== undefined && raw.currency !== "BRL") return null;
  if (!isSafeOfferHref(raw.href)) return null;

  if (typeof raw.checkedAt !== "string") return null;
  const checkedAtMs = Date.parse(raw.checkedAt);
  if (!Number.isFinite(checkedAtMs)) return null;
  if (checkedAtMs > context.now + CLOCK_SKEW_MS) return null;
  if (context.now - checkedAtMs > MAX_CHECK_AGE_MINUTES * 60_000) return null;
  const checkedAt = new Date(Math.min(checkedAtMs, context.now)).toISOString();

  // Desconto: os dois campos andam juntos (dependentRequired) e so com prova.
  const reference = positiveNumber(raw.referencePrice);
  const percent = raw.discountPercent;
  const provenDiscount =
    reference !== null &&
    typeof percent === "number" &&
    Number.isInteger(percent) &&
    percent >= 5 &&
    percent <= 90 &&
    reference > currentPrice;

  let productImage: string | null = null;
  if (typeof raw.productImage === "string" && raw.productImage !== "") {
    productImage = context.resolveImage(raw.productImage);
  }

  const historical = isRecord(raw.historicalPrice) ? positiveNumber(raw.historicalPrice.lowest30d) : null;

  return {
    offerId,
    productTitle,
    productImage,
    imageRatio: oneOf(raw.imageRatio, RATIOS) ?? "square",
    currentPrice,
    referencePrice: provenDiscount ? reference : null,
    discountPercent: provenDiscount ? (percent as number) : null,
    merchant: "Shopee",
    checkedAt,
    href: raw.href,
    cta: boundedText(raw.cta, 28),
    ctaShort: boundedText(raw.ctaShort, 14),
    eyebrow: oneOf(raw.eyebrow, EYEBROWS),
    affiliateDisclosure: oneOf(raw.affiliateDisclosure, DISCLOSURES),
    priceDrop: normalizePriceDrop(raw.priceDrop, currentPrice),
    lowest30d: historical,
    isOfficialStore: raw.isOfficialStore === true,
  };
}

/**
 * A resposta inteira do ad server -> `AdDecision`, ou `null` (o slot colapsa).
 */
export function normalizeAdResponse(raw: unknown, context: NormalizeContext): AdDecision | null {
  if (!isRecord(raw)) return null;
  const requestId = boundedText(raw.requestId, 200);
  if (requestId === null) return null;
  // O enum do contrato v1 so lista as 5 posicoes da materia; os ids da Cinerie
  // vao alem (docs/opapreco/DECISIONS.md). O que se exige e que a resposta seja
  // PARA ESTE slot.
  if (raw.slot !== context.slot) return null;
  if (!isOpComponentName(raw.component)) return null;
  const component: OpComponentName = raw.component;
  if (!slotAccepts(context.slot, context.viewport, component)) return null;

  if (!isRecord(raw.tracking) || typeof raw.tracking.impressionUrl !== "string") return null;
  let impressionUrl: string;
  try {
    impressionUrl = new URL(raw.tracking.impressionUrl).toString();
  } catch {
    return null;
  }
  const expiresAt =
    typeof raw.expiresAt === "string" && Number.isFinite(Date.parse(raw.expiresAt)) ? raw.expiresAt : null;
  const base = { requestId, impressionUrl, expiresAt };

  const props = raw.props;
  if (!isRecord(props)) return null;

  if (component === "product_grid_v1") {
    if (!Array.isArray(props.offers)) return null;
    let offers = props.offers
      .map((item) => normalizeOffer(item, context))
      .filter((offer): offer is Offer => offer !== null)
      .slice(0, 4);
    // SPEC §5.4: com 3 itens no celular (2 colunas), servem-se os 2 primeiros —
    // uma terceira oferta sozinha numa linha parece sobra.
    if (context.viewport === "mobile" && offers.length === 3) offers = offers.slice(0, 2);
    if (offers.length < 2) return null;
    return { ...base, component, offers, heading: boundedText(props.heading, 48) };
  }

  const offer = normalizeOffer(props.offer, context);
  if (offer === null) return null;

  if (component === "contextual_recommendation_v1") {
    const contextText = boundedText(props.context, 90);
    if (contextText === null) return null;
    return { ...base, component, offer, context: contextText, contextNote: boundedText(props.contextNote, 140) };
  }

  // Queda de preco sem prova nao vira outro formato aqui: e oferta que o ad
  // server nao devia ter servido assim (fixture `fakeDrop`, "mustNotRender").
  if (component === "price_drop_v1" && offer.priceDrop === null) return null;

  return { ...base, component, offer };
}
