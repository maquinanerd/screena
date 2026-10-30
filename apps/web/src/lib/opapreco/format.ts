/**
 * format.ts — como preco, desconto e verificacao viram texto. PURO.
 *
 * As regras de exibicao da SPEC (§4, §10, §12) num lugar so: componente nenhum
 * formata preco por conta propria.
 */

import type { Offer } from "./types";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** `R$ 299,90` — `Intl` pt-BR. O espaco que o Intl devolve e NBSP (nao quebra a linha). */
export function formatBRL(value: number): string {
  return BRL.format(value);
}

/** Sinal de menos tipografico (U+2212), nunca hifen. */
export const MINUS_SIGN = "−";

/** Ha desconto COMPROVADO? (referencia acima do preco E pelo menos 5%) */
export function hasProvenDiscount(
  offer: Pick<Offer, "currentPrice" | "referencePrice" | "discountPercent">,
): offer is Offer & { referencePrice: number; discountPercent: number } {
  return (
    offer.referencePrice !== null &&
    offer.discountPercent !== null &&
    offer.discountPercent >= 5 &&
    offer.referencePrice > offer.currentPrice
  );
}

/** `−17%` */
export function discountLabel(percent: number): string {
  return `${MINUS_SIGN}${percent}%`;
}

/** `17% de desconto` — o desconto nunca e so cor (SPEC §10). */
export function discountAria(percent: number): string {
  return `${percent}% de desconto`;
}

/** Minutos inteiros desde a verificacao (nunca negativo). */
export function minutesSince(checkedAt: string, now: number): number {
  const at = Date.parse(checkedAt);
  if (!Number.isFinite(at)) return 0;
  return Math.max(0, Math.floor((now - at) / 60_000));
}

/** Teto da SPEC: oferta verificada ha mais de 6 h nao e servida. */
export const MAX_CHECK_AGE_MINUTES = 6 * 60;

/**
 * `Preço verificado agora` (< 1 min), `há X min` (< 60), `há X h` (< 6 h).
 * `capitalized=false` devolve a frase em minuscula, para o meio de uma linha.
 */
export function checkedLabel(minutes: number, capitalized = true): string {
  const head = capitalized ? "Preço verificado" : "preço verificado";
  if (minutes < 1) return `${head} agora`;
  if (minutes < 60) return `${head} há ${minutes} min`;
  // Arredonda como a referencia do componente (`Math.round(m / 60)`).
  return `${head} há ${Math.round(minutes / 60)} h`;
}

/** `{titulo} por {preco} na Shopee. {disclosure}` — o nome acessivel do link (SPEC §5). */
export function offerAriaLabel(offer: Offer, disclosure: string): string {
  return `${offer.productTitle} por ${formatBRL(offer.currentPrice)} na ${offer.merchant}. ${disclosure}`;
}

/** `currentPrice <= lowest30d` — so entao "Menor preço recente" (SPEC §12). */
export function isLowestRecent(offer: Pick<Offer, "currentPrice" | "lowest30d">): boolean {
  return offer.lowest30d !== null && offer.currentPrice <= offer.lowest30d;
}
