/**
 * Locale da rota raiz publica. PURO: sem Next runtime, rede, DB ou IO.
 *
 * FONTE UNICA: os locales de rota vêm de `@screena/config` (`*_URL_LOCALES`),
 * derivados de `SUPPORTED_LOCALES`/`PUBLISHED_LOCALES` via `LOCALE_URL_SEGMENT`.
 * Este módulo NÃO redeclara a lista de locales — antes redeclarava
 * (`["pt"]` vs `["pt-BR","pt"]` no config), o que fazia ligar um idioma no
 * config não habilitar sua rota (baseline R-07). Aqui ficam apenas os helpers
 * de PARSING de request (segmento do pathname, Accept-Language), que são
 * responsabilidade da rota.
 */

import {
  DEFAULT_URL_LOCALE,
  PUBLISHED_URL_LOCALES,
  SUPPORTED_URL_LOCALES,
  type UrlLocale,
} from "@screena/config";

/** Locale de rota (segmento de URL). Alias de `UrlLocale` do config. */
export type Locale = UrlLocale;
/** Locale de rota publicado. Alias de `UrlLocale` do config. */
export type PublishedLocale = UrlLocale;

/** Segmentos de rota suportados, na ordem de prioridade do config. */
export const SUPPORTED_LOCALES: readonly Locale[] = SUPPORTED_URL_LOCALES;
/** Segmento de rota default (locale-base). */
export const DEFAULT_LOCALE: Locale = DEFAULT_URL_LOCALE;
/** Segmentos de rota publicados e elegiveis a `index`. */
export const PUBLISHED_LOCALES: readonly PublishedLocale[] = PUBLISHED_URL_LOCALES;

/**
 * Resolve o locale do request pelo primeiro segmento do pathname, caindo em
 * DEFAULT_LOCALE quando ausente/desconhecido.
 */
export function resolveLocale(pathname: string): Locale {
  const segment = pathname.split("/")[1] ?? "";
  return (SUPPORTED_LOCALES as readonly string[]).includes(segment)
    ? (segment as Locale)
    : DEFAULT_LOCALE;
}

function parseLanguageWeight(part: string): number {
  const [, ...params] = part.split(";").map((value) => value.trim());
  const q = params.find((param) => param.toLowerCase().startsWith("q="));
  if (q === undefined) return 1;
  const value = Number.parseFloat(q.slice(2));
  return Number.isFinite(value) ? value : 0;
}

/**
 * Detecta a preferencia de idioma do navegador. pt/pt-BR -> pt; es/es-* -> es;
 * en, vazio, wildcard e demais idiomas globais -> en.
 */
export function resolvePreferredLocale(
  acceptLanguage: string | null,
): Locale {
  const raw = acceptLanguage?.trim();
  if (!raw) return "en";

  const candidates = raw
    .split(",")
    .map((part, index) => ({
      language: part.split(";")[0]?.trim().toLowerCase() ?? "",
      weight: parseLanguageWeight(part),
      index,
    }))
    .filter((candidate) => candidate.language !== "" && candidate.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);

  for (const candidate of candidates) {
    const language = candidate.language;
    if (language === "*" || language.startsWith("en")) return "en";
    if (language === "pt" || language.startsWith("pt-")) return "pt";
    if (language === "es" || language.startsWith("es-")) return "es";
  }

  return "en";
}

export function resolveRootRedirectLocale(
  acceptLanguage: string | null,
): PublishedLocale {
  const preferred = resolvePreferredLocale(acceptLanguage);
  return (PUBLISHED_LOCALES as readonly string[]).includes(preferred)
    ? (preferred as PublishedLocale)
    : DEFAULT_LOCALE;
}

export function rootRedirectPath(acceptLanguage: string | null): string {
  return `/${resolveRootRedirectLocale(acceptLanguage)}/`;
}
