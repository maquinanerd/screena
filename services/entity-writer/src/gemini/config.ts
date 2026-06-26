/**
 * config.ts — Carregamento/validacao da configuracao do GeminiAdapter.
 *
 * INVARIANTE: a chave vive SO em env var (nunca no frontend/bundle/versionada).
 * `loadGeminiConfig` e PURO: recebe o ambiente como argumento (default
 * `process.env`) e nao faz IO/rede. Falha explicita se `GEMINI_API_KEY` ou
 * `GEMINI_MODEL` faltarem — o modelo NAO e hardcoded como verdade de produto
 * (D3.4); so a base URL e os tunables de resiliencia tem default seguro.
 *
 * Mensagens de erro NUNCA incluem o valor da chave.
 */

/** Identificador editorial do provedor (model_provider). */
export const GEMINI_PROVIDER = "gemini";

/** Base URL oficial da Generative Language API (sobrescrevivel por env). */
export const GEMINI_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/** Configuracao resolvida do GeminiAdapter. */
export interface GeminiConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly maxRps: number;
  readonly maxRetries: number;
  readonly breakerThreshold: number;
  readonly breakerCooldownMs: number;
}

/** Forma minima de ambiente aceita (subset de process.env). */
export type GeminiEnv = Record<string, string | undefined>;

/** Erro de configuracao (ex.: chave/modelo ausentes). Nunca expoe a chave. */
export class GeminiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiConfigError";
  }
}

/** Le uma string nao-vazia (trimada) de env; senao undefined. */
function readNonEmpty(raw: string | undefined): string | undefined {
  if (raw == null) return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Remove TODAS as barras finais da base URL (ex.: `.../v1beta/` -> `.../v1beta`)
 * para evitar `//models` ao concatenar o path. So mexe na(s) barra(s) final(is);
 * o esquema (`https://`) e o path interno ficam intactos.
 */
function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Le inteiro positivo (>= 1) de env; cai no default se ausente/invalido. */
function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === "") return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

/** Le inteiro nao-negativo (>= 0) de env; cai no default se ausente/invalido. */
function readNonNegativeInt(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === "") return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return value;
}

/**
 * Resolve a configuracao do Gemini a partir do ambiente.
 *
 * Obrigatorios: `GEMINI_API_KEY` e `GEMINI_MODEL` (lanca `GeminiConfigError` se
 * faltarem — nunca chama a rede sem chave; modelo nao tem default de produto).
 * Opcionais: `GEMINI_API_BASE_URL` (default oficial) e os tunables de
 * resiliencia `GEMINI_MAX_RPS`/`GEMINI_MAX_RETRIES`/`GEMINI_BREAKER_THRESHOLD`/
 * `GEMINI_BREAKER_COOLDOWN_MS`.
 */
export function loadGeminiConfig(env: GeminiEnv = process.env): GeminiConfig {
  const apiKey = readNonEmpty(env.GEMINI_API_KEY);
  if (apiKey === undefined) {
    throw new GeminiConfigError(
      "GEMINI_API_KEY ausente: defina em env var (worker-only; nunca no frontend/bundle).",
    );
  }

  const model = readNonEmpty(env.GEMINI_MODEL);
  if (model === undefined) {
    throw new GeminiConfigError(
      "GEMINI_MODEL ausente: defina o modelo em env var (nao ha modelo default de produto — D3.4).",
    );
  }

  return {
    apiKey,
    model,
    baseUrl: normalizeBaseUrl(readNonEmpty(env.GEMINI_API_BASE_URL) ?? GEMINI_DEFAULT_BASE_URL),
    maxRps: readPositiveInt(env.GEMINI_MAX_RPS, 1),
    maxRetries: readNonNegativeInt(env.GEMINI_MAX_RETRIES, 3),
    breakerThreshold: readPositiveInt(env.GEMINI_BREAKER_THRESHOLD, 5),
    breakerCooldownMs: readPositiveInt(env.GEMINI_BREAKER_COOLDOWN_MS, 30_000),
  };
}
