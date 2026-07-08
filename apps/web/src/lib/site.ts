/**
 * site.ts - Helpers de URL publica/canonica do Screen.
 *
 * Rotas puras vivem em `routes.ts` para poderem ser importadas no cliente.
 * Este modulo pode ler env porque monta metadata, canonical, sitemap e JSON-LD
 * no lado servidor.
 */

import { moviePath } from "./routes";

export {
  detailPath,
  EXPLORE_PATH,
  HOME_PATH,
  MOVIES_INDEX_PATH,
  NEWS_INDEX_PATH,
  PEOPLE_INDEX_PATH,
  PT_LOCALE_SEGMENT,
  SERIES_INDEX_PATH,
  moviePath,
} from "./routes";

/** Variavel de origem publica desta instalacao. */
export const PUBLIC_SITE_URL_ENV = "THE_SCREEN_PUBLIC_SITE_URL";

/** Flag explicita que permite indexacao somente na origem oficial. */
export const PUBLIC_INDEXING_ENABLED_ENV = "THE_SCREEN_PUBLIC_INDEXING_ENABLED";

/** Origin publico canonico oficial (sem barra final). */
export const OFFICIAL_SITE_URL = "https://thescreen.media";

/** Origin local usado em exemplos/dev quando configurado por env. */
export const LOCAL_SITE_URL = "http://localhost:3000";

export interface SiteUrlEnv {
  readonly THE_SCREEN_PUBLIC_SITE_URL?: string;
  readonly THE_SCREEN_PUBLIC_INDEXING_ENABLED?: string;
  readonly NODE_ENV?: string;
  readonly VERCEL_ENV?: string;
}

function readTrimmed(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Normaliza um origin publico seguro. Aceita apenas http/https e origin puro
 * (sem path, query, hash, usuario ou senha). Remove barra final via URL.origin.
 */
export function normalizeSiteOrigin(value: string | null | undefined): string | null {
  const raw = readTrimmed(value ?? undefined);
  if (raw === null) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username !== "" || url.password !== "") return null;
  if (url.search !== "" || url.hash !== "") return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;

  return url.origin;
}

export function configuredSiteUrl(env: SiteUrlEnv = process.env): string | null {
  return normalizeSiteOrigin(env.THE_SCREEN_PUBLIC_SITE_URL);
}

/**
 * Resolve a origem usada por canonical/metadata. Producao oficial deve definir
 * THE_SCREEN_PUBLIC_SITE_URL=https://thescreen.media; dev/staging/preview devem
 * definir sua propria origem para nao emitirem canonical falso de producao.
 */
export function resolveSiteUrl(env: SiteUrlEnv = process.env): string {
  return configuredSiteUrl(env) ?? OFFICIAL_SITE_URL;
}

/** Origin publico desta instalacao (sem barra final). */
export const SITE_URL = resolveSiteUrl(process.env);

export function isOfficialSiteUrl(siteUrl: string): boolean {
  return normalizeSiteOrigin(siteUrl) === OFFICIAL_SITE_URL;
}

/**
 * Robots so pode liberar indexacao quando a origem configurada e exatamente a
 * oficial, a flag explicita esta ligada e o ambiente nao se declara
 * preview/dev/test.
 */
export function isOfficialIndexableEnvironment(
  env: SiteUrlEnv = process.env,
): boolean {
  if (readTrimmed(env.THE_SCREEN_PUBLIC_INDEXING_ENABLED) !== "1") return false;
  if (configuredSiteUrl(env) !== OFFICIAL_SITE_URL) return false;

  const nodeEnv = readTrimmed(env.NODE_ENV)?.toLowerCase() ?? null;
  if (nodeEnv !== null && nodeEnv !== "production") return false;

  const vercelEnv = readTrimmed(env.VERCEL_ENV)?.toLowerCase() ?? null;
  if (vercelEnv !== null && vercelEnv !== "production") return false;

  return true;
}

/** URL canonica absoluta da pagina de um filme. */
export function movieCanonicalUrl(slug: string): string {
  return `${SITE_URL}${moviePath(slug)}`;
}

/**
 * URL canonica absoluta de um caminho publico interno.
 *
 * Regras:
 *  - rejeita path externo (`https://...`, `//host`) e path que nao comece em `/`;
 *  - colapsa barras duplicadas internas (`/pt//filmes/` -> `/pt/filmes/`);
 *  - garante barra final (padrao `trailingSlash: true` do app);
 *  - prefixa sempre a origem publica resolvida por env.
 *
 * Retorna `null` para entrada invalida; nunca gera URL fora do origin escolhido.
 */
export function canonicalPublicUrl(
  path: string,
  siteUrl: string = SITE_URL,
): string | null {
  const origin = normalizeSiteOrigin(siteUrl);
  if (origin === null) return null;

  const value = path.trim();
  if (value === "" || !value.startsWith("/")) return null;
  if (value.startsWith("//") || value.includes("://")) return null;

  const collapsed = value.replace(/\/{2,}/g, "/");
  const withTrailing = collapsed.endsWith("/") ? collapsed : `${collapsed}/`;
  return `${origin}${withTrailing}`;
}
