/**
 * A escolha do visitante sobre o Google Analytics: como ela e guardada, lida e
 * desfeita. Puro — nada aqui toca `window` sem recebe-lo por parametro.
 *
 * ============================================================================
 * ONDE A ESCOLHA MORA, E POR QUE NAO E COOKIE
 * ============================================================================
 * Em `localStorage`, no proprio navegador. Um cookie iria ao servidor em toda
 * requisicao sem que o servidor precise dele (quem decide carregar o script e o
 * navegador), e a Politica de Privacidade promete que quem navega sem conta nao
 * recebe cookie nenhum enquanto nao autorizar. A RECUSA tambem e guardada: sem
 * ela, o aviso voltaria a cada pagina, e insistir ate o visitante ceder nao e
 * consentimento.
 *
 * A escolha vence em `CONSENT_MAX_AGE_DAYS` (item 6.3 da Politica). Depois disso,
 * ou se `CONSENT_SCHEMA_VERSION` subir (porque a lista de ferramentas mudou),
 * a pergunta volta.
 *
 * ============================================================================
 * FAIL-CLOSED
 * ============================================================================
 * Valor ausente, malformado, de outra versao, vencido ou datado no futuro le
 * como "sem escolha" — nunca como "aceitou". Armazenamento indisponivel (aba
 * privada, cota cheia) tambem: o GA4 so carrega com um "sim" que se consegue
 * ler.
 */

export type AnalyticsChoice = "granted" | "denied";

export const CONSENT_STORAGE_KEY = "cinerie:consentimento-analise";

/** Suba quando o CONJUNTO de ferramentas mudar: toda escolha anterior expira. */
export const CONSENT_SCHEMA_VERSION = 1;

export const CONSENT_MAX_AGE_DAYS = 180;

/** Pedido de reabrir o aviso (o botao "Preferencias de cookies" do rodape). */
export const OPEN_CONSENT_PREFERENCES_EVENT = "cinerie:abrir-preferencias-de-cookies";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Tolerancia para relogio adiantado do proprio dispositivo. */
const FUTURE_SKEW_MS = 5 * 60 * 1000;

interface StoredConsent {
  readonly v: number;
  readonly choice: AnalyticsChoice;
  readonly at: string;
}

export function serializeConsent(choice: AnalyticsChoice, now: Date): string {
  const stored: StoredConsent = { v: CONSENT_SCHEMA_VERSION, choice, at: now.toISOString() };
  return JSON.stringify(stored);
}

export function parseStoredConsent(raw: string | null, now: Date): AnalyticsChoice | null {
  if (raw === null || raw === "") return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { v, choice, at } = value as Record<string, unknown>;
  if (v !== CONSENT_SCHEMA_VERSION) return null;
  if (choice !== "granted" && choice !== "denied") return null;
  if (typeof at !== "string") return null;
  const savedAt = Date.parse(at);
  if (Number.isNaN(savedAt)) return null;
  const age = now.getTime() - savedAt;
  if (age < -FUTURE_SKEW_MS) return null;
  if (age > CONSENT_MAX_AGE_DAYS * DAY_MS) return null;
  return choice;
}

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

export function readConsent(storage: ReadableStorage | null, now: Date): AnalyticsChoice | null {
  if (storage === null) return null;
  try {
    return parseStoredConsent(storage.getItem(CONSENT_STORAGE_KEY), now);
  } catch {
    return null;
  }
}

/** `false` quando o navegador recusou gravar — a escolha vale so nesta pagina. */
export function writeConsent(
  storage: WritableStorage | null,
  choice: AnalyticsChoice,
  now: Date,
): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(CONSENT_STORAGE_KEY, serializeConsent(choice, now));
    return true;
  } catch {
    return false;
  }
}

/** Nomes dos cookies do GA4 presentes em `document.cookie`. */
export function ga4CookieNames(cookieHeader: string): string[] {
  return cookieHeader
    .split(";")
    .map((part) => part.split("=")[0]?.trim() ?? "")
    .filter((name) => name === "_ga" || name.startsWith("_ga_"));
}

/**
 * Atribuicoes de `document.cookie` que apagam um cookie em todos os escopos
 * onde o GA4 costuma grava-lo: sem dominio, no host e no dominio-pai com ponto
 * (`cookie_domain: 'auto'` grava em `.cinerie.com`).
 */
export function cookieDeletionAssignments(name: string, hostname: string): string[] {
  const expired = `${name}=; Max-Age=0; Path=/`;
  const parent = hostname.replace(/^www\./, "");
  const scopes = new Set([expired, `${expired}; Domain=${hostname}`, `${expired}; Domain=.${parent}`]);
  return [...scopes];
}
