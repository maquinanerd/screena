import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Middleware de locale do app publico @screena/web.
 *
 * Objetivo (FASE 0 - apenas placeholder, sem logica real):
 *   - Detectar o locale a partir do prefixo da URL: pt | en | es.
 *   - Default de publicacao: pt (pt-BR publica primeiro - invariante 7).
 *   - en/es nascem em draft/noindex ate revisao humana.
 *
 * REGRA CRITICA (invariante 7 + SEO):
 *   - NAO fazer redirect automatico de idioma em URL indexavel. Cada locale
 *     tem sua propria URL canonica (ex.: /pt/filmes/..., /en/movies/...).
 *     Redirecionar por Accept-Language quebraria a indexacao e o hreflang.
 *   - A deteccao aqui serve para resolver o locale do request e (no futuro)
 *     injetar headers internos, nunca para reescrever a URL publica.
 *
 * Fase 0: resolve o locale a partir do primeiro segmento da URL e injeta um
 * header interno (x-screena-locale). NAO redireciona nem reescreve a URL
 * publica — cada locale tem sua propria URL canonica (invariante 7 + hreflang).
 */

export const SUPPORTED_LOCALES = ["pt", "en", "es"] as const;
export const DEFAULT_LOCALE = "pt" as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Resolve o locale do request pelo primeiro segmento do pathname, caindo em
 * DEFAULT_LOCALE quando ausente/desconhecido. Pura, sem efeitos de rede.
 */
export function resolveLocale(pathname: string): Locale {
  const segment = pathname.split("/")[1] ?? "";
  return (SUPPORTED_LOCALES as readonly string[]).includes(segment)
    ? (segment as Locale)
    : DEFAULT_LOCALE;
}

export function middleware(request: NextRequest): NextResponse {
  // Apenas resolve o locale e o expoe como header interno; sem redirect de
  // idioma em URL indexavel (invariante 7).
  const locale = resolveLocale(request.nextUrl.pathname);
  const response = NextResponse.next();
  response.headers.set("x-screena-locale", locale);
  return response;
}

/**
 * matcher: aplica o middleware a todas as rotas exceto assets internos do
 * Next, arquivos estaticos e a API interna.
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api).*)"],
};
