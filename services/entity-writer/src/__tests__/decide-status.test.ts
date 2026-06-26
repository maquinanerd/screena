/**
 * Testes da decisao pura de status (review_status/validation_status).
 *
 * Garante a invariante 12 no nivel da decisao: a Fase 3A NUNCA produz
 * `published` nem `human_reviewed`.
 */

import { describe, expect, it } from "vitest";
import {
  validateAgainstPayload,
  validateEntityWriterOutput,
  type EntityPayload,
  type EntityWriterOutput,
} from "@screena/schemas";
import { decideStatus, EMPTY_OUTPUT_WARNING } from "../pipeline/decide-status.js";

const payload: EntityPayload = {
  director: "Denis Villeneuve",
  cast: ["Timothee Chalamet", "Rebecca Ferguson"],
};

describe("decideStatus", () => {
  it("sem warnings e com bloco util -> ai_generated + passed", () => {
    const output: EntityWriterOutput = {
      editorial_intro: "Dirigido por Denis Villeneuve, o filme acompanha a jornada.",
      cast_intro: "No elenco, Timothee Chalamet contracena com Rebecca Ferguson.",
      warnings: [],
    };
    const form = validateEntityWriterOutput(output);
    const { warnings } = validateAgainstPayload(payload, output);
    const decision = decideStatus({ form, output, payloadWarnings: warnings });
    expect(decision.reviewStatus).toBe("ai_generated");
    expect(decision.validationStatus).toBe("passed");
    expect(decision.warnings).toEqual([]);
  });

  it("warning anti-alucinacao -> needs_review + warnings", () => {
    const output: EntityWriterOutput = {
      cast_intro: "No elenco, Timothee Chalamet, Rebecca Ferguson e Zendaya aparecem.",
      warnings: [],
    };
    const form = validateEntityWriterOutput(output);
    const { warnings } = validateAgainstPayload(payload, output);
    const decision = decideStatus({ form, output, payloadWarnings: warnings });
    expect(decision.reviewStatus).toBe("needs_review");
    expect(decision.validationStatus).toBe("warnings");
    expect(decision.warnings).toContain("fato fora do payload: Zendaya");
  });

  it("saida vazia (forma valida, sem bloco) -> blocked + failed", () => {
    const output: EntityWriterOutput = { warnings: [] };
    const form = validateEntityWriterOutput(output);
    const { warnings } = validateAgainstPayload(payload, output);
    const decision = decideStatus({ form, output, payloadWarnings: warnings });
    expect(decision.reviewStatus).toBe("blocked");
    expect(decision.validationStatus).toBe("failed");
    expect(decision.warnings).toContain(EMPTY_OUTPUT_WARNING);
  });

  it("forma invalida (sem warnings array) -> blocked + failed", () => {
    const form = validateEntityWriterOutput({ editorial_intro: "x" });
    const decision = decideStatus({ form, payloadWarnings: [] });
    expect(decision.reviewStatus).toBe("blocked");
    expect(decision.validationStatus).toBe("failed");
    expect(decision.warnings.length).toBeGreaterThan(0);
  });

  it("nunca retorna published nem human_reviewed", () => {
    const scenarios: StatusLike[] = [
      decideStatus({
        form: validateEntityWriterOutput({ warnings: [] }),
        output: { warnings: [] },
        payloadWarnings: [],
      }),
      decideStatus({
        form: validateEntityWriterOutput({ editorial_intro: "ok", warnings: [] }),
        output: { editorial_intro: "ok", warnings: [] },
        payloadWarnings: [],
      }),
      decideStatus({
        form: validateEntityWriterOutput({ cast_intro: "ok", warnings: [] }),
        output: { cast_intro: "ok", warnings: [] },
        payloadWarnings: ["fato fora do payload: X"],
      }),
      decideStatus({ form: validateEntityWriterOutput({ warnings: "nope" }), payloadWarnings: [] }),
    ];
    for (const decision of scenarios) {
      expect(decision.reviewStatus).not.toBe("published");
      expect(decision.reviewStatus).not.toBe("human_reviewed");
      expect(["ai_generated", "needs_review", "blocked"]).toContain(decision.reviewStatus);
    }
  });
});

type StatusLike = ReturnType<typeof decideStatus>;
