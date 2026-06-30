/**
 * smoke-gemini.test.ts — Testes do nucleo do smoke do Gemini.
 *
 * NUNCA chama o Gemini real: usa `FakeGeminiPort` deterministico e um
 * PayloadSource fake. Cobre parse/guard (incl. `--confirm-live`), o caminho
 * feliz com fake, a ausencia de persistencia (estrutural: o smoke nem recebe
 * portas de persistencia), e a formatacao SEGURA de erros (sem vazar chave).
 */

import { describe, expect, it } from "vitest";
import type { EntityPayload } from "@screena/schemas";
import { FakeGeminiPort } from "../gemini/fake.js";
import { GeminiConfigError, GeminiHttpError } from "../gemini/adapter.js";
import {
  formatSmokeError,
  parseSmokeGeminiArgs,
  resolveSmokeGeminiOptions,
  runSmokeGemini,
  type SmokeGeminiOptions,
} from "../smoke/smoke-gemini.js";
import type { BuildPayloadRequest, PayloadSourcePort } from "../ports.js";

const PAYLOAD: EntityPayload = {
  entityType: "movie",
  director: "Ana Lima",
  cast: ["Carlos Souza", "Bruna Dias"],
  title: "Filme de Teste",
};

const selectPrompt = () => ({ promptVersion: "0.2.0", content: "PROMPT" });
const OK_OPTIONS: SmokeGeminiOptions = { entityType: "movie", entityId: "42", languageCode: "pt-BR" };

/** PayloadSource fake que registra as chamadas e devolve um payload fixo. */
function recordingPayloadSource(payload: EntityPayload = PAYLOAD) {
  const calls: BuildPayloadRequest[] = [];
  const port: PayloadSourcePort = {
    buildPayload: async (request) => {
      calls.push(request);
      return payload;
    },
  };
  return { port, calls };
}

describe("parseSmokeGeminiArgs", () => {
  it("default de idioma e pt-BR; confirmLive false sem a flag", () => {
    const args = parseSmokeGeminiArgs(["--entity-type", "movie", "--entity-id", "42"]);
    expect(args).toEqual({ entityType: "movie", entityId: "42", language: "pt-BR", confirmLive: false });
  });

  it("captura --confirm-live e --language", () => {
    const args = parseSmokeGeminiArgs(["--entity-type", "tv", "--entity-id", "7", "--language", "pt-BR", "--confirm-live"]);
    expect(args.confirmLive).toBe(true);
    expect(args.entityType).toBe("tv");
  });
});

describe("resolveSmokeGeminiOptions", () => {
  const base = { entityType: "movie", entityId: "42", language: "pt-BR", confirmLive: true };

  it("happy path resolve ok", () => {
    const res = resolveSmokeGeminiOptions(base);
    expect(res).toEqual({ kind: "ok", options: { entityType: "movie", entityId: "42", languageCode: "pt-BR" } });
  });

  it("sem --confirm-live => erro (aborta antes de qualquer chamada externa)", () => {
    const res = resolveSmokeGeminiOptions({ ...base, confirmLive: false });
    expect(res.kind).toBe("error");
    if (res.kind === "error") expect(res.message).toContain("--confirm-live");
  });

  it("sem --entity-id => erro", () => {
    const res = resolveSmokeGeminiOptions({ ...base, entityId: undefined });
    expect(res.kind).toBe("error");
    if (res.kind === "error") expect(res.message).toContain("--entity-id");
  });

  it("sem --entity-type => erro", () => {
    const res = resolveSmokeGeminiOptions({ ...base, entityType: undefined });
    expect(res.kind).toBe("error");
    if (res.kind === "error") expect(res.message).toContain("--entity-type");
  });

  it("language != pt-BR => erro", () => {
    const res = resolveSmokeGeminiOptions({ ...base, language: "en" });
    expect(res.kind).toBe("error");
    if (res.kind === "error") expect(res.message).toContain("pt-BR");
  });

  it.each(["person", "season", "episode"])("entityType '%s' nao suportado => erro", (entityType) => {
    const res = resolveSmokeGeminiOptions({ ...base, entityType });
    expect(res.kind).toBe("error");
  });
});

describe("runSmokeGemini (fake Gemini, sem persistencia)", () => {
  it("happy path: monta resumo esperado e usa o payload source uma vez", async () => {
    const payloadSource = recordingPayloadSource();
    const report = await runSmokeGemini(
      { payloadSource: payloadSource.port, gemini: new FakeGeminiPort({ mode: "success" }), selectPrompt },
      OK_OPTIONS,
    );

    expect(payloadSource.calls).toEqual([{ entityType: "movie", entityId: "42", languageCode: "pt-BR" }]);
    expect(report.entityType).toBe("movie");
    expect(report.entityId).toBe("42");
    expect(report.language).toBe("pt-BR");
    expect(report.jsonValid).toBe(true);
    expect(report.validationStatus).toBe("passed");
    expect(report.reviewStatus).toBe("ai_generated");
    expect(report.validationFailed).toBe(false);
    expect([...report.blockTypes].sort()).toEqual(["cast_intro", "editorial_intro"]);
    expect(report.warnings).toEqual([]);
    expect(report.modelProvider).toBe("fake");
    expect(typeof report.inputHash).toBe("string");
    expect(typeof report.outputHash).toBe("string");
  });

  it("o resumo NUNCA contem a chave da API", async () => {
    process.env.SMOKE_TEST_FAKE_KEY = "SECRET-KEY-DO-NOT-LEAK";
    const report = await runSmokeGemini(
      { payloadSource: recordingPayloadSource().port, gemini: new FakeGeminiPort({ mode: "success" }), selectPrompt },
      OK_OPTIONS,
    );
    delete process.env.SMOKE_TEST_FAKE_KEY;
    expect(JSON.stringify(report)).not.toContain("SECRET-KEY-DO-NOT-LEAK");
  });

  it("JSON invalido do modelo => falha controlada (jsonValid=false, sem blocos)", async () => {
    const report = await runSmokeGemini(
      { payloadSource: recordingPayloadSource().port, gemini: new FakeGeminiPort({ mode: "invalid-json" }), selectPrompt },
      OK_OPTIONS,
    );

    expect(report.jsonValid).toBe(false);
    expect(report.validationFailed).toBe(true);
    expect(report.reviewStatus).toBe("blocked");
    expect(report.blockTypes).toEqual([]);
  });

  it("saida com warnings => needs_review, JSON valido", async () => {
    const report = await runSmokeGemini(
      { payloadSource: recordingPayloadSource().port, gemini: new FakeGeminiPort({ mode: "warnings" }), selectPrompt },
      OK_OPTIONS,
    );

    expect(report.jsonValid).toBe(true);
    expect(report.reviewStatus).toBe("needs_review");
    expect(report.validationStatus).toBe("warnings");
    expect(report.warnings.length).toBeGreaterThan(0);
  });
});

describe("formatSmokeError (seguranca)", () => {
  it("GeminiHttpError NAO vaza o corpo (que poderia conter dado do provedor)", () => {
    const line = formatSmokeError(new GeminiHttpError(403, '{"error":"chave SECRET-XYZ recusada"}', true));
    expect(line).toContain("403");
    expect(line).not.toContain("SECRET-XYZ");
  });

  it("GeminiConfigError e claro (mensagem de config, sem valor de chave)", () => {
    const line = formatSmokeError(new GeminiConfigError("GEMINI_API_KEY ausente: defina em env var."));
    expect(line).toContain("configuracao");
    expect(line).toContain("GEMINI_API_KEY ausente");
  });

  it("erro generico (payload) e resumido com clareza", () => {
    const line = formatSmokeError(new Error("movie id=42 nao encontrado."));
    expect(line).toContain("nao encontrado");
  });

  it("valor nao-Error nao quebra o formatador", () => {
    expect(formatSmokeError("boom")).toContain("desconhecido");
  });
});
