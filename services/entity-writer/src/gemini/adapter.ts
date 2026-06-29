/**
 * adapter.ts — GeminiAdapter real (worker-only) atras do `GeminiPort`.
 *
 * Mesmo padrao de resiliencia da Fase 2 (api-clients/tmdb/http.ts), aplicado a
 * Generative Language API via REST + `fetch` — SEM SDK novo:
 *  - transporte INJETAVEL (`GeminiTransport`) → testes deterministas sem rede;
 *  - retry com backoff exponencial + jitter SO em transitorios (429 c/
 *    Retry-After, 5xx, falha de rede); 4xx (exceto 429) NUNCA retenta;
 *  - circuit breaker por fonte (abre apos N falhas, cooldown, half-open);
 *  - throttle por `maxRps`; `now`/`sleep`/`random` injetaveis.
 *
 * Seguranca: a chave vai SO no header `x-goog-api-key` (nunca na URL/log/erro);
 * o adapter NAO loga prompt nem chave. Faz parse apenas do ENVELOPE do provedor
 * (para extrair texto e tokens); o parse do JSON editorial do modelo fica em
 * `runGeneration` (retorna `raw` cru). Sem ratings/streaming/en-es.
 *
 * Tipos puros (fetch e global; sem Prisma/SDK). Worker-only por politica — a
 * guarda `audit:render` impede import por apps/web.
 */

import type { GeminiGenerateInput, GeminiGenerateOutput, GeminiPort } from "../ports.js";
import { GEMINI_PROVIDER, loadGeminiConfig, type GeminiConfig, type GeminiEnv } from "./config.js";

export {
  GEMINI_DEFAULT_BASE_URL,
  GEMINI_PROVIDER,
  GeminiConfigError,
  loadGeminiConfig,
  type GeminiConfig,
  type GeminiEnv,
} from "./config.js";

/** Requisicao HTTP de baixo nivel (POST). */
export interface GeminiHttpRequest {
  readonly url: string;
  readonly method: "POST";
  readonly headers: Record<string, string>;
  readonly body: string;
}

/** Resposta HTTP normalizada. `headers` deve ter chaves em minusculas. */
export interface GeminiHttpResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

/** Transporte injetavel: leva uma requisicao e devolve uma resposta. */
export type GeminiTransport = (request: GeminiHttpRequest) => Promise<GeminiHttpResponse>;

/** Erro de resposta HTTP. `permanent=true` para 4xx (exceto 429) — nao retenta. */
export class GeminiHttpError extends Error {
  readonly status: number;
  readonly body: string;
  readonly permanent: boolean;

  constructor(status: number, body: string, permanent: boolean) {
    super(`Gemini HTTP ${status}${permanent ? " (permanente)" : ""}`);
    this.name = "GeminiHttpError";
    this.status = status;
    this.body = body;
    this.permanent = permanent;
  }
}

/** Erro quando o circuito esta aberto (fonte degradada). */
export class GeminiCircuitOpenError extends Error {
  readonly openUntil: number;

  constructor(openUntil: number) {
    super("Gemini circuit breaker aberto: chamadas suspensas ate cooldown.");
    this.name = "GeminiCircuitOpenError";
    this.openUntil = openUntil;
  }
}

/** Erro de envelope 2xx invalido/sem texto (contrato do provedor). Nao retenta. */
export class GeminiResponseError extends Error {
  constructor(message: string) {
    super(`Gemini resposta invalida: ${message}`);
    this.name = "GeminiResponseError";
  }
}

/** Dependencias injetaveis (transporte + relogio + sleep + random). */
export interface GeminiAdapterDeps {
  readonly transport: GeminiTransport;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
}

const BACKOFF_BASE_MS = 250;
const BACKOFF_MAX_MS = 10_000;

/** Cria o transporte padrao usando o `fetch` global (Node 22). Nao usado em teste. */
export function createFetchTransport(): GeminiTransport {
  return async (request) => {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
    const body = await response.text();
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return { status: response.status, headers, body };
  };
}

/** 4xx (exceto 429) e erro permanente: requisicao invalida, nao retenta. */
function isPermanentStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 429;
}

/** Converte Retry-After (segundos) em ms; ignora formato de data. */
function parseRetryAfterMs(value: string | undefined): number | undefined {
  if (value == null) return undefined;
  const seconds = Number.parseInt(value, 10);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return seconds * 1000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Extrai o texto concatenado de `candidates[0].content.parts[].text`. */
function extractText(envelope: unknown): string | undefined {
  if (!isRecord(envelope)) return undefined;
  const candidates = envelope.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return undefined;
  const first = candidates[0];
  if (!isRecord(first)) return undefined;
  const content = first.content;
  if (!isRecord(content)) return undefined;
  const parts = content.parts;
  if (!Array.isArray(parts)) return undefined;
  const text = parts
    .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
    .join("");
  return text.length > 0 ? text : undefined;
}

/** Le tokens de `usageMetadata`; ausentes => undefined (nunca fabrica metrica). */
function extractTokens(envelope: unknown): {
  tokenInput: number | undefined;
  tokenOutput: number | undefined;
} {
  if (!isRecord(envelope)) return { tokenInput: undefined, tokenOutput: undefined };
  const usage = envelope.usageMetadata;
  if (!isRecord(usage)) return { tokenInput: undefined, tokenOutput: undefined };
  const input = usage.promptTokenCount;
  const output = usage.candidatesTokenCount;
  return {
    tokenInput: typeof input === "number" && Number.isFinite(input) ? input : undefined,
    tokenOutput: typeof output === "number" && Number.isFinite(output) ? output : undefined,
  };
}

/**
 * GeminiAdapter: implementa `GeminiPort` chamando `:generateContent` com
 * resiliencia. Retorna `raw` (texto cru do modelo) + provider/model + tokens
 * quando disponiveis. NAO faz parse do JSON editorial (isso e do runGeneration).
 */
export class GeminiAdapter implements GeminiPort {
  private readonly config: GeminiConfig;
  private readonly transport: GeminiTransport;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly minIntervalMs: number;

  private nextAllowedAt = 0;
  private consecutiveFailures = 0;
  private openUntil: number | null = null;

  constructor(config: GeminiConfig, deps: GeminiAdapterDeps) {
    this.config = config;
    this.transport = deps.transport;
    this.now = deps.now ?? (() => Date.now());
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = deps.random ?? (() => Math.random());
    this.minIntervalMs = Math.ceil(1000 / config.maxRps);
  }

  /** Estado atual do circuito (observabilidade). */
  isCircuitOpen(): boolean {
    return this.openUntil !== null && this.now() < this.openUntil;
  }

  async generate(input: GeminiGenerateInput): Promise<GeminiGenerateOutput> {
    this.assertCircuitClosed();

    const url = this.buildUrl();
    const headers = this.buildHeaders();
    const body = this.buildBody(input);
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      await this.throttle();

      let response: GeminiHttpResponse;
      try {
        response = await this.transport({ url, method: "POST", headers, body });
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < this.config.maxRetries) {
          await this.backoff(attempt, undefined);
          continue;
        }
        break;
      }

      if (response.status >= 200 && response.status < 300) {
        const output = this.extractOutput(response.body);
        this.onSuccess();
        return output;
      }

      if (isPermanentStatus(response.status)) {
        // 4xx (exceto 429): nao retenta e NAO conta para o breaker.
        throw new GeminiHttpError(response.status, response.body, true);
      }

      // Transitorio (429/5xx): retenta com backoff (respeita Retry-After em 429).
      lastError = new GeminiHttpError(response.status, response.body, false);
      if (attempt < this.config.maxRetries) {
        const retryAfterMs =
          response.status === 429 ? parseRetryAfterMs(response.headers["retry-after"]) : undefined;
        await this.backoff(attempt, retryAfterMs);
        continue;
      }
    }

    // Retries transitorios esgotados: degradacao da fonte -> conta para o breaker.
    this.onFailure();
    throw lastError ?? new Error("Gemini request falhou sem erro capturado.");
  }

  private assertCircuitClosed(): void {
    if (this.openUntil !== null && this.now() < this.openUntil) {
      throw new GeminiCircuitOpenError(this.openUntil);
    }
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0;
    this.openUntil = null;
  }

  private onFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.config.breakerThreshold) {
      this.openUntil = this.now() + this.config.breakerCooldownMs;
    }
  }

  private async throttle(): Promise<void> {
    const wait = this.nextAllowedAt - this.now();
    if (wait > 0) await this.sleep(wait);
    this.nextAllowedAt = this.now() + this.minIntervalMs;
  }

  private async backoff(attempt: number, retryAfterMs: number | undefined): Promise<void> {
    if (retryAfterMs !== undefined) {
      await this.sleep(retryAfterMs);
      return;
    }
    const exponential = BACKOFF_BASE_MS * 2 ** attempt;
    const jitter = this.random() * BACKOFF_BASE_MS;
    await this.sleep(Math.min(exponential + jitter, BACKOFF_MAX_MS));
  }

  /** URL do endpoint generateContent. A chave NAO vai na URL (so no header). */
  private buildUrl(): string {
    return `${this.config.baseUrl}/models/${this.config.model}:generateContent`;
  }

  /** Headers: content-type + a chave em `x-goog-api-key` (nunca logada). */
  private buildHeaders(): Record<string, string> {
    return {
      "content-type": "application/json",
      "x-goog-api-key": this.config.apiKey,
    };
  }

  /**
   * Corpo do request: prompt versionado + payload controlado em JSON, num unico
   * turno de usuario. O payload e a UNICA fonte de fatos permitida ao modelo.
   */
  private buildBody(input: GeminiGenerateInput): string {
    const userText = `${input.prompt}\n\n## Payload controlado (JSON)\n${JSON.stringify(input.payload)}`;
    return JSON.stringify({ contents: [{ role: "user", parts: [{ text: userText }] }] });
  }

  /** Parseia o ENVELOPE do provedor e extrai `raw` + tokens. */
  private extractOutput(envelopeText: string): GeminiGenerateOutput {
    let envelope: unknown;
    try {
      envelope = JSON.parse(envelopeText);
    } catch {
      throw new GeminiResponseError("envelope 2xx com JSON invalido.");
    }
    const raw = extractText(envelope);
    if (raw === undefined) {
      throw new GeminiResponseError("envelope sem texto de candidato.");
    }
    const { tokenInput, tokenOutput } = extractTokens(envelope);
    return {
      raw,
      modelProvider: GEMINI_PROVIDER,
      modelName: this.config.model,
      tokenInput,
      tokenOutput,
    };
  }
}

/**
 * Monta um GeminiAdapter real a partir do ambiente (transporte `fetch`).
 * Worker-only; lanca `GeminiConfigError` se faltar `GEMINI_API_KEY`/`GEMINI_MODEL`.
 */
export function createGeminiAdapterFromEnv(env: GeminiEnv = process.env): GeminiAdapter {
  return new GeminiAdapter(loadGeminiConfig(env), { transport: createFetchTransport() });
}
