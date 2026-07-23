/**
 * Testes de consumo de token de uso unico (auth/tokens.ts): token valido
 * consome; expirado, ja consumido e de proposito errado sao rejeitados com a
 * MESMA resposta publica (replay-safe, anti-enumeracao); motivo interno separa
 * as causas. `now >= expiresAt` ja e expirado.
 */

import { describe, expect, it } from "vitest";
import { evaluateTokenConsumption, type StoredTokenRecord } from "../tokens.js";

const NOW = new Date("2026-07-17T12:00:00.000Z");
const HOUR = 3_600_000;

function record(overrides: Partial<StoredTokenRecord> = {}): StoredTokenRecord {
  return {
    purpose: "email_verification",
    expiresAt: new Date(NOW.getTime() + HOUR),
    consumedAt: null,
    ...overrides,
  };
}

describe("evaluateTokenConsumption", () => {
  it("(1) token valido do proposito esperado pode ser consumido", () => {
    const d = evaluateTokenConsumption({
      now: NOW,
      expectedPurpose: "email_verification",
      tokenRecord: record(),
    });
    expect(d.publicResult.ok).toBe(true);
    expect(d.internalReason).toBe("ok");
  });

  it("(2) token inexistente e rejeitado", () => {
    const d = evaluateTokenConsumption({
      now: NOW,
      expectedPurpose: "email_verification",
      tokenRecord: null,
    });
    expect(d.publicResult.ok).toBe(false);
    expect(d.internalReason).toBe("not_found");
  });

  it("(3) token expirado e rejeitado (now >= expiresAt)", () => {
    const d = evaluateTokenConsumption({
      now: NOW,
      expectedPurpose: "email_verification",
      tokenRecord: record({ expiresAt: NOW }),
    });
    expect(d.publicResult.ok).toBe(false);
    expect(d.internalReason).toBe("expired");
  });

  it("(4) token ja consumido e rejeitado (replay-safe)", () => {
    const d = evaluateTokenConsumption({
      now: NOW,
      expectedPurpose: "email_verification",
      tokenRecord: record({ consumedAt: new Date(NOW.getTime() - HOUR) }),
    });
    expect(d.publicResult.ok).toBe(false);
    expect(d.internalReason).toBe("already_consumed");
  });

  it("(5) token de PROPOSITO errado nao serve (reset != verificacao)", () => {
    const d = evaluateTokenConsumption({
      now: NOW,
      expectedPurpose: "email_verification",
      tokenRecord: record({ purpose: "password_reset" }),
    });
    expect(d.publicResult.ok).toBe(false);
    expect(d.internalReason).toBe("wrong_purpose");
  });

  it("(6) mensagem publica IDENTICA entre todas as causas de falha", () => {
    const causes = [
      evaluateTokenConsumption({ now: NOW, expectedPurpose: "email_verification", tokenRecord: null }),
      evaluateTokenConsumption({
        now: NOW,
        expectedPurpose: "email_verification",
        tokenRecord: record({ expiresAt: NOW }),
      }),
      evaluateTokenConsumption({
        now: NOW,
        expectedPurpose: "email_verification",
        tokenRecord: record({ consumedAt: NOW }),
      }),
    ];
    const msgs = causes.map((d) => (d.publicResult.ok ? "OK" : d.publicResult.error.message));
    expect(new Set(msgs).size).toBe(1);
  });
});
