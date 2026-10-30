/**
 * Medicao de audiencia do site publico: o que liga, com que identificador e
 * em que ambiente.
 *
 * ============================================================================
 * DUAS FERRAMENTAS, DOIS REGIMES — E SO UMA MORA AQUI
 * ============================================================================
 * - **Cloudflare Web Analytics** — beacon SEM cookie, sem armazenamento no
 *   navegador e sem identificador de visitante (Politica de Privacidade, item
 *   6.2). NAO e montado pelo app: a borda da Cloudflare o injeta em toda pagina
 *   ("configuracao automatica" do site `cinerie.com`, ligada desde jul/2026 —
 *   medido em 30/10/2026: o script esta no DOM e envia para `/cdn-cgi/rum`).
 *   Montar um segundo beacon aqui contaria cada visita DUAS vezes.
 * - **Google Analytics 4** — grava cookies (`_ga`, `_ga_<ID>`). So carrega
 *   DEPOIS de o visitante aceitar no aviso de cookies (`consent-banner.tsx`).
 *   Sem o identificador, nao ha aviso nem script: nao existe o que consentir.
 *
 * ============================================================================
 * POR QUE ENV DE RUNTIME, E POR QUE SO NA PRODUCAO OFICIAL
 * ============================================================================
 * O release constroi a imagem sem env publica (ver o `Dockerfile`), entao um
 * identificador lido no build nunca chegaria a producao. Lido aqui, por
 * requisicao, ele vale assim que o operador o define no painel — e sai do ar
 * do mesmo jeito, sem rebuild.
 *
 * A origem oficial + `NODE_ENV=production` vem de `isOfficialProductionSurface`,
 * a mesma condicao do gate de indexacao: um staging com a env de producao
 * copiada nao pode mandar visita para o painel real.
 *
 * Identificador malformado DESLIGA a ferramenta (fail-closed): um valor que
 * ninguem confere e um script de terceiro que ninguem audita.
 */

import { isOfficialProductionSurface, type SiteUrlEnv } from "./site";

export const GA4_MEASUREMENT_ID_ENV = "CINERIE_GA4_MEASUREMENT_ID";

export interface AnalyticsEnv extends SiteUrlEnv {
  /** `G-` seguido de letras maiusculas e digitos (fluxo de dados web do GA4). */
  readonly CINERIE_GA4_MEASUREMENT_ID?: string;
}

export interface AnalyticsConfig {
  /** `null` = GA4 desligado: sem aviso de cookies e sem script. */
  readonly ga4MeasurementId: string | null;
}

export const ANALYTICS_OFF: AnalyticsConfig = Object.freeze({ ga4MeasurementId: null });

const GA4_MEASUREMENT_ID = /^G-[A-Z0-9]{6,16}$/;

function readTrimmed(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function parseGa4MeasurementId(raw: string | undefined): string | null {
  const value = readTrimmed(raw)?.toUpperCase() ?? null;
  return value !== null && GA4_MEASUREMENT_ID.test(value) ? value : null;
}

export function analyticsConfig(env: AnalyticsEnv = process.env): AnalyticsConfig {
  if (!isOfficialProductionSurface(env)) return ANALYTICS_OFF;
  return { ga4MeasurementId: parseGa4MeasurementId(env.CINERIE_GA4_MEASUREMENT_ID) };
}

// Os enderecos do gtag.js moram num modulo sem import, que o aviso de cookies
// (cliente) pode carregar sem arrastar `site.ts` para o navegador.
export { GA4_COOKIE_MAX_AGE_SECONDS, GA4_SCRIPT_ORIGIN, ga4ScriptUrl } from "./analytics-scripts";
