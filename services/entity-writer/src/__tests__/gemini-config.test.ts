/**
 * Testes da configuracao do GeminiAdapter (puro, sem rede).
 */

import { describe, expect, it } from "vitest";
import {
  GEMINI_DEFAULT_BASE_URL,
  GeminiConfigError,
  loadGeminiConfig,
} from "../gemini/config.js";

describe("loadGeminiConfig", () => {
  it("lanca GeminiConfigError quando GEMINI_API_KEY ausente", () => {
    expect(() => loadGeminiConfig({ GEMINI_MODEL: "gemini-x" })).toThrow(GeminiConfigError);
  });

  it("lanca GeminiConfigError quando GEMINI_MODEL ausente (sem default de produto)", () => {
    expect(() => loadGeminiConfig({ GEMINI_API_KEY: "k" })).toThrow(GeminiConfigError);
  });

  it("usa GEMINI_MODEL e GEMINI_API_KEY definidos + base URL default", () => {
    const config = loadGeminiConfig({ GEMINI_API_KEY: "k", GEMINI_MODEL: "gemini-pro-x" });
    expect(config.apiKey).toBe("k");
    expect(config.model).toBe("gemini-pro-x");
    expect(config.baseUrl).toBe(GEMINI_DEFAULT_BASE_URL);
    expect(config.maxRetries).toBe(3);
    expect(config.maxRps).toBe(1);
  });

  it("permite sobrescrever base URL e tunables por env", () => {
    const config = loadGeminiConfig({
      GEMINI_API_KEY: "k",
      GEMINI_MODEL: "m",
      GEMINI_API_BASE_URL: "https://example.test/v1",
      GEMINI_MAX_RPS: "5",
      GEMINI_MAX_RETRIES: "1",
      GEMINI_BREAKER_THRESHOLD: "3",
      GEMINI_BREAKER_COOLDOWN_MS: "1000",
    });
    expect(config.baseUrl).toBe("https://example.test/v1");
    expect(config.maxRps).toBe(5);
    expect(config.maxRetries).toBe(1);
    expect(config.breakerThreshold).toBe(3);
    expect(config.breakerCooldownMs).toBe(1000);
  });

  it("a mensagem de erro NUNCA inclui o valor da chave", () => {
    try {
      loadGeminiConfig({ GEMINI_MODEL: "m" });
      expect.unreachable("deveria ter lancado");
    } catch (error) {
      expect(String(error)).not.toContain("GEMINI_API_KEY=");
    }
  });
});
