/**
 * Endereços e parâmetros dos scripts de medição de audiência.
 *
 * Separado de `analytics-config.ts` porque o aviso de cookies roda no
 * navegador: este módulo não importa nada, e pode ir para o bundle do cliente.
 * `analytics-config.ts` lê env e o gate de ambiente de `site.ts`, que é do
 * servidor (`site.ts`: "Rotas puras vivem em `routes.ts` para poderem ser
 * importadas no cliente").
 */

/** Script oficial do beacon. Não leva nada do visitante na URL. */
export const CLOUDFLARE_BEACON_SRC = "https://static.cloudflareinsights.com/beacon.min.js";

/**
 * Valor de `data-cf-beacon`. `spa: true` conta as navegações do App Router,
 * que trocam a página sem recarregar o documento.
 */
export function cloudflareBeaconConfig(token: string): string {
  return JSON.stringify({ token, spa: true });
}

export const GA4_SCRIPT_ORIGIN = "https://www.googletagmanager.com";

export function ga4ScriptUrl(measurementId: string): string {
  return `${GA4_SCRIPT_ORIGIN}/gtag/js?id=${encodeURIComponent(measurementId)}`;
}

/**
 * Validade dos cookies do GA4: 13 meses, e não os 2 anos do padrão. A Política
 * de Privacidade (item 6) declara este número; mudou aqui, muda lá.
 */
export const GA4_COOKIE_MAX_AGE_SECONDS = 395 * 24 * 60 * 60;
