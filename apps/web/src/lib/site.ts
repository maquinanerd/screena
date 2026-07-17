/**
 * site.ts - Helpers de URL publica/canonica do Cinerie.
 *
 * Rotas puras vivem em `routes.ts` para poderem ser importadas no cliente.
 * Este modulo pode ler env porque monta metadata, canonical, sitemap e JSON-LD
 * no lado servidor.
 */

import { episodePath, moviePath, seasonPath, seriesPath } from "./routes";

export {
  detailPath,
  episodePath,
  EPISODES_SEGMENT,
  EXPLORE_PATH,
  HOME_PATH,
  MOVIES_INDEX_PATH,
  NEWS_INDEX_PATH,
  parseRouteNumber,
  PEOPLE_INDEX_PATH,
  PT_LOCALE_SEGMENT,
  SEASONS_SEGMENT,
  SERIES_INDEX_PATH,
  moviePath,
  seasonPath,
  seriesPath,
} from "./routes";

/** Variavel de origem publica desta instalacao. */
export const PUBLIC_SITE_URL_ENV = "CINERIE_PUBLIC_SITE_URL";

/** Flag explicita que permite indexacao somente na origem oficial. */
export const PUBLIC_INDEXING_ENABLED_ENV = "CINERIE_PUBLIC_INDEXING_ENABLED";

/**
 * Nomes LEGADOS das mesmas variaveis (marca anterior).
 *
 * Continuam sendo lidos como FALLBACK: renomear a env quebraria todo deploy ja
 * configurado (EasyPanel/Dockerfile) no instante do merge — e o gate de
 * rebranding nao pode alterar comportamento. Precedencia: o nome novo vence; o
 * antigo so vale enquanto o nome novo nao estiver definido. Remover apos migrar
 * a configuracao dos ambientes (gate de infraestrutura).
 */
export const LEGACY_PUBLIC_SITE_URL_ENV = "THE_SCREEN_PUBLIC_SITE_URL";
export const LEGACY_PUBLIC_INDEXING_ENABLED_ENV = "THE_SCREEN_PUBLIC_INDEXING_ENABLED";

/** Origin publico canonico oficial (sem barra final). */
export const OFFICIAL_SITE_URL = "https://cinerie.com";

/** Origin local usado em exemplos/dev quando configurado por env. */
export const LOCAL_SITE_URL = "http://localhost:3000";

export interface SiteUrlEnv {
  readonly CINERIE_PUBLIC_SITE_URL?: string;
  readonly CINERIE_PUBLIC_INDEXING_ENABLED?: string;
  /** Legado (marca anterior) — lido so como fallback. */
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
  // Nome novo vence; o legado so vale enquanto o novo nao estiver definido.
  return normalizeSiteOrigin(env.CINERIE_PUBLIC_SITE_URL ?? env.THE_SCREEN_PUBLIC_SITE_URL);
}

/**
 * Resolve a origem usada por canonical/metadata. Producao oficial deve definir
 * CINERIE_PUBLIC_SITE_URL=https://cinerie.com; dev/staging/preview devem
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
  // Nome novo vence; legado como fallback (ver LEGACY_PUBLIC_INDEXING_ENABLED_ENV).
  const indexingFlag = readTrimmed(
    env.CINERIE_PUBLIC_INDEXING_ENABLED ?? env.THE_SCREEN_PUBLIC_INDEXING_ENABLED,
  );
  if (indexingFlag !== "1") return false;
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

/** URL canonica absoluta da pagina de uma serie, ou `null` para slug invalido. */
export function seriesCanonicalUrl(slug: string): string | null {
  const path = seriesPath(slug);
  return path === null ? null : `${SITE_URL}${path}`;
}

/** URL canonica absoluta da pagina de uma temporada, ou `null` se invalida. */
export function seasonCanonicalUrl(
  seriesSlug: string,
  seasonNumber: number,
): string | null {
  const path = seasonPath(seriesSlug, seasonNumber);
  return path === null ? null : `${SITE_URL}${path}`;
}

/** URL canonica absoluta da pagina de um episodio, ou `null` se invalida. */
export function episodeCanonicalUrl(
  seriesSlug: string,
  seasonNumber: number,
  episodeNumber: number,
): string | null {
  const path = episodePath(seriesSlug, seasonNumber, episodeNumber);
  return path === null ? null : `${SITE_URL}${path}`;
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
