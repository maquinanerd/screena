/**
 * Testes do FakeGeminiPort (determinístico, offline) e da composicao
 * fake -> validacao -> decisao de status.
 */

import { describe, expect, it } from "vitest";
import {
  validateAgainstPayload,
  validateEntityWriterOutput,
  type EntityPayload,
  type EntityWriterOutput,
} from "@screena/schemas";
import { FakeGeminiPort } from "../gemini/fake.js";
import { decideStatus } from "../pipeline/decide-status.js";
import type { GeminiGenerateInput } from "../ports.js";

const payload: EntityPayload = {
  director: "Denis Villeneuve",
  cast: ["Timothee Chalamet", "Rebecca Ferguson"],
};
const input: GeminiGenerateInput = { prompt: "PROMPT VERSIONADO", payload };

describe("FakeGeminiPort", () => {
  it("e deterministico: mesma entrada -> mesmo raw e mesma identidade", async () => {
    const port = new FakeGeminiPort();
    const a = await port.generate(input);
    const b = await port.generate(input);
    expect(a.raw).toBe(b.raw);
    expect(a.modelProvider).toBe(b.modelProvider);
    expect(a.modelName).toBe(b.modelName);
  });

  it("modo success retorna EntityWriterOutput flat com blocos e warnings []", async () => {
    const port = new FakeGeminiPort({ mode: "success" });
    const { raw } = await port.generate(input);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(typeof parsed.editorial_intro).toBe("string");
    expect(typeof parsed.cast_intro).toBe("string");
    expect(parsed.warnings).toEqual([]);
    // contrato flat: nada de envelope aninhado nem campos de persistencia.
    expect(parsed.blocks).toBeUndefined();
    expect(parsed.block_type).toBeUndefined();
  });

  it("modo empty retorna apenas warnings (sem blocos textuais)", async () => {
    const port = new FakeGeminiPort({ mode: "empty" });
    const { raw } = await port.generate(input);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed.editorial_intro).toBeUndefined();
    expect(parsed.cast_intro).toBeUndefined();
    expect(Array.isArray(parsed.warnings)).toBe(true);
  });

  it("modo invalid-json retorna texto nao parseavel", async () => {
    const port = new FakeGeminiPort({ mode: "invalid-json" });
    const { raw } = await port.generate(input);
    expect(() => JSON.parse(raw)).toThrow();
  });

  it("composicao: fake success -> validacao -> decisao = ai_generated/passed", async () => {
    const port = new FakeGeminiPort({ mode: "success" });
    const { raw } = await port.generate(input);
    const parsed = JSON.parse(raw) as EntityWriterOutput;
    const form = validateEntityWriterOutput(parsed);
    const { warnings } = validateAgainstPayload(payload, parsed);
    const decision = decideStatus({ form, output: parsed, payloadWarnings: warnings });
    expect(decision.reviewStatus).toBe("ai_generated");
    expect(decision.validationStatus).toBe("passed");
  });
});
