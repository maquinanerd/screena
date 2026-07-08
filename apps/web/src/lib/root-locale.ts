/**
 * Locale da raiz publica. PURO: sem Next runtime, rede, DB ou IO.
 */

export const SUPPORTED_LOCALES = ["pt", "en", "es"] as const;
export const DEFAULT_LOCALE = "pt" as const;
export const PUBLISHED_LOCALES = ["pt"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];
export type PublishedLocale = (typeof PUBLISHED_LOCALES)[number];

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
