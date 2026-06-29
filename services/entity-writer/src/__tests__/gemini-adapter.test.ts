/**
 * Testes do GeminiAdapter: request shape, parsing do envelope, tokens, retry,
 * backoff, circuit breaker, throttle e nao-vazamento de chave. 100% sem rede —
 * transporte, relogio, sleep e random sao injetados.
 */

import { describe, expect, it } from "vitest";
import type { EntityPayload } from "@screena/schemas";
import { loadGeminiConfig } from "../gemini/config.js";
import {
  GeminiAdapter,
  GeminiCircuitOpenError,
  GeminiHttpError,
  GeminiResponseError,
  type GeminiAdapterDeps,
  type GeminiHttpRequest,
  type GeminiHttpResponse,
} from "../gemini/adapter.js";

const API_KEY = "super-secret-key-XYZ";
const payload: EntityPayload = {
  director: "Denis Villeneuve",
  cast: ["Timothee Chalamet"],
};
const input = { prompt: "PROMPT-3A", payload };

type Scripted = GeminiHttpResponse | Error;

function makeAdapter(responses: Scripted[], env: Record<string, string> = {}) {
  const queue: Scripted[] = [...responses];
  const calls: GeminiHttpRequest[] = [];
  const slept: number[] = [];
  let nowMs = 0;

  const transport: GeminiAdapterDeps["transport"] = (request) => {
    calls.push(request);
    const next = queue.shift();
    if (next === undefined) return Promise.reject(new Error("teste: sem resposta scriptada"));
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next);
  };

  const deps: GeminiAdapterDeps = {
    transport,
    now: () => nowMs,
    sleep: (ms) => {
      slept.push(ms);
      nowMs += ms;
      return Promise.resolve();
    },
    random: () => 0,
  };

  const config = loadGeminiConfig({ GEMINI_API_KEY: API_KEY, GEMINI_MODEL: "gemini-test", ...env });
  return { adapter: new GeminiAdapter(config, deps), calls, slept, advance: (ms: number) => (nowMs += ms) };
}

function envelope(text: string, withTokens = true): GeminiHttpResponse {
  const obj: Record<string, unknown> = {
    candidates: [{ content: { role: "model", parts: [{ text }] } }],
  };
  if (withTokens) obj.usageMetadata = { promptTokenCount: 11, candidatesTokenCount: 22 };
  return { status: 200, headers: {}, body: JSON.stringify(obj) };
}

function fail(status: number, headers: Record<string, string> = {}): GeminiHttpResponse {
  return { status, headers, body: `status ${status}` };
}

describe("GeminiAdapter", () => {
  it("sucesso retorna raw + provider/model + tokens; monta request correto", async () => {
    const { adapter, calls } = makeAdapter([envelope('{"editorial_intro":"x","warnings":[]}')], {
      GEMINI_MAX_RPS: "1000",
    });
    const out = await adapter.generate(input);

    expect(out.raw).toBe('{"editorial_intro":"x","warnings":[]}');
    expect(out.modelProvider).toBe("gemini");
    expect(out.modelName).toBe("gemini-test");
    expect(out.tokenInput).toBe(11);
    expect(out.tokenOutput).toBe(22);

    expect(calls).toHaveLength(1);
    const req = calls[0];
    expect(req?.method).toBe("POST");
    expect(req?.url).toContain("/models/gemini-test:generateContent");
    expect(req?.headers["x-goog-api-key"]).toBe(API_KEY);
    expect(req?.headers["content-type"]).toBe("application/json");
    expect(req?.url).not.toContain(API_KEY); // chave nunca na URL
    expect(req?.body).toContain("PROMPT-3A");
    expect(req?.body).toContain("Denis Villeneuve"); // payload embutido
  });

  it("tokens ausentes no envelope => undefined (sem fabricar metrica)", async () => {
    const { adapter } = makeAdapter([envelope('{"warnings":[]}', false)], { GEMINI_MAX_RPS: "1000" });
    const out = await adapter.generate(input);
    expect(out.tokenInput).toBeUndefined();
    expect(out.tokenOutput).toBeUndefined();
  });

  it("envelope 2xx invalido (JSON) lanca GeminiResponseError", async () => {
    const { adapter } = makeAdapter([{ status: 200, headers: {}, body: "nao-json {" }], {
      GEMINI_MAX_RPS: "1000",
    });
    await expect(adapter.generate(input)).rejects.toBeInstanceOf(GeminiResponseError);
  });

  it("envelope 2xx sem texto de candidato lanca GeminiResponseError", async () => {
    const { adapter } = makeAdapter([{ status: 200, headers: {}, body: '{"candidates":[]}' }], {
      GEMINI_MAX_RPS: "1000",
    });
    await expect(adapter.generate(input)).rejects.toBeInstanceOf(GeminiResponseError);
  });

  it("retenta erro transitorio (500) e tem sucesso na segunda tentativa", async () => {
    const { adapter, calls } = makeAdapter([fail(500), envelope('{"ok":true}')], {
      GEMINI_MAX_RPS: "1000",
    });
    const out = await adapter.generate(input);
    expect(out.raw).toBe('{"ok":true}');
    expect(calls).toHaveLength(2);
  });

  it("NAO retenta erro permanente (400) e lanca GeminiHttpError permanente", async () => {
    const { adapter, calls } = makeAdapter([fail(400)], { GEMINI_MAX_RPS: "1000" });
    await expect(adapter.generate(input)).rejects.toMatchObject({
      name: "GeminiHttpError",
      status: 400,
      permanent: true,
    });
    expect(calls).toHaveLength(1);
  });

  it("respeita Retry-After (segundos) em 429", async () => {
    const { adapter, slept } = makeAdapter([fail(429, { "retry-after": "2" }), envelope("{}")], {
      GEMINI_MAX_RPS: "1000",
    });
    await adapter.generate(input);
    expect(slept).toContain(2000);
  });

  it("abre o circuito apos N falhas consecutivas e suspende chamadas", async () => {
    const { adapter, calls } = makeAdapter([fail(500), fail(500)], {
      GEMINI_MAX_RETRIES: "0",
      GEMINI_BREAKER_THRESHOLD: "2",
      GEMINI_MAX_RPS: "1000",
    });
    await expect(adapter.generate(input)).rejects.toBeInstanceOf(GeminiHttpError);
    await expect(adapter.generate(input)).rejects.toBeInstanceOf(GeminiHttpError);
    await expect(adapter.generate(input)).rejects.toBeInstanceOf(GeminiCircuitOpenError);
    expect(calls).toHaveLength(2);
    expect(adapter.isCircuitOpen()).toBe(true);
  });

  it("half-open apos cooldown: uma prova de sucesso fecha o circuito", async () => {
    const { adapter, calls, advance } = makeAdapter([fail(500), fail(500), envelope('{"ok":1}')], {
      GEMINI_MAX_RETRIES: "0",
      GEMINI_BREAKER_THRESHOLD: "2",
      GEMINI_BREAKER_COOLDOWN_MS: "1000",
      GEMINI_MAX_RPS: "1000",
    });
    await expect(adapter.generate(input)).rejects.toBeInstanceOf(GeminiHttpError);
    await expect(adapter.generate(input)).rejects.toBeInstanceOf(GeminiHttpError);
    expect(adapter.isCircuitOpen()).toBe(true);
    advance(2000);
    const out = await adapter.generate(input);
    expect(out.raw).toBe('{"ok":1}');
    expect(calls).toHaveLength(3);
    expect(adapter.isCircuitOpen()).toBe(false);
  });

  it("aplica throttle entre requisicoes conforme maxRps", async () => {
    const { adapter, slept } = makeAdapter([envelope("{}"), envelope("{}")], { GEMINI_MAX_RPS: "2" });
    await adapter.generate(input);
    await adapter.generate(input);
    expect(slept).toContain(500);
  });

  it("erro de rede (transport rejeita) e transitorio: aciona retry/backoff e tem sucesso", async () => {
    const { adapter, calls, slept } = makeAdapter([new Error("ECONNRESET"), envelope('{"ok":1}')], {
      GEMINI_MAX_RPS: "1000",
    });
    const out = await adapter.generate(input);
    expect(out.raw).toBe('{"ok":1}');
    expect(calls).toHaveLength(2); // retentou apos a falha de rede
    expect(slept.length).toBeGreaterThan(0); // houve backoff entre as tentativas
  });

  it("erro de rede persistente: propaga, registra falha no breaker e nao vaza a chave", async () => {
    const { adapter, calls } = makeAdapter([new Error("ETIMEDOUT"), new Error("ETIMEDOUT")], {
      GEMINI_MAX_RETRIES: "0",
      GEMINI_BREAKER_THRESHOLD: "1",
      GEMINI_MAX_RPS: "1000",
    });
    let thrown: unknown;
    try {
      await adapter.generate(input);
      expect.unreachable("deveria ter lancado");
    } catch (error) {
      thrown = error;
    }
    expect(String(thrown)).not.toContain(API_KEY); // erro de rede nao expoe a chave
    expect(adapter.isCircuitOpen()).toBe(true); // breaker registrou a falha
    // circuito aberto: a proxima chamada e suspensa antes de tocar o transporte.
    await expect(adapter.generate(input)).rejects.toBeInstanceOf(GeminiCircuitOpenError);
    expect(calls).toHaveLength(1);
  });

  it("monta o body estruturalmente: contents[0].parts[0].text com prompt + payload", async () => {
    const { adapter, calls } = makeAdapter([envelope("{}")], { GEMINI_MAX_RPS: "1000" });
    await adapter.generate(input);

    const req = calls[0];
    expect(req).toBeDefined();
    const body = JSON.parse(req?.body ?? "{}") as {
      contents?: Array<{ role?: string; parts?: Array<{ text?: string }> }>;
    };
    expect(Array.isArray(body.contents)).toBe(true);
    const text = body.contents?.[0]?.parts?.[0]?.text;
    expect(text).toBeDefined();
    expect(text).toContain("PROMPT-3A"); // inclui o prompt
    expect(text).toContain(JSON.stringify(payload)); // inclui o payload serializado
    // a chave NAO vai no body nem na URL; vai SO no header.
    expect(req?.body).not.toContain(API_KEY);
    expect(req?.url).not.toContain(API_KEY);
    expect(req?.headers["x-goog-api-key"]).toBe(API_KEY);
  });

  it("a chave NUNCA aparece no erro lancado (mas e enviada no header)", async () => {
    const { adapter, calls } = makeAdapter([fail(500)], {
      GEMINI_MAX_RETRIES: "0",
      GEMINI_MAX_RPS: "1000",
    });
    try {
      await adapter.generate(input);
      expect.unreachable("deveria ter lancado");
    } catch (error) {
      const serialized = `${String(error)} ${JSON.stringify(error instanceof GeminiHttpError ? { body: error.body, message: error.message } : {})}`;
      expect(serialized).not.toContain(API_KEY);
    }
    // a chave FOI enviada no header (so nao vaza no erro/log)
    expect(calls[0]?.headers["x-goog-api-key"]).toBe(API_KEY);
  });
});
