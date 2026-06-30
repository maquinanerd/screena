/**
 * run-offline-cli.test.ts — Testes do parse/resolucao PURA do CLI do ciclo offline.
 *
 * Sem efeito colateral: nenhuma chamada a banco, Gemini ou process.exit. Cobre as
 * regras de flags (--missing/--limit/--entity-type/--language) e a escolha segura
 * de Gemini (fake por padrao; real so com --confirm-live e nunca em dry-run/--fake).
 */

import { describe, expect, it } from "vitest";
import {
  parseRunOfflineArgs,
  resolveRunOfflineCommand,
  shouldUseRealGemini,
} from "../runner/run-offline-cli.js";

describe("parseRunOfflineArgs", () => {
  it("default: idioma pt-BR, sem flags", () => {
    const args = parseRunOfflineArgs(["--entity-type", "movie", "--missing", "--limit", "10"]);
    expect(args).toEqual({
      entityType: "movie",
      language: "pt-BR",
      missing: true,
      limit: 10,
      dryRun: false,
      fake: false,
      confirmLive: false,
    });
  });

  it("captura --fake e --dry-run", () => {
    const args = parseRunOfflineArgs(["--entity-type", "movie", "--missing", "--limit", "10", "--fake", "--dry-run"]);
    expect(args.fake).toBe(true);
    expect(args.dryRun).toBe(true);
  });
});

describe("resolveRunOfflineCommand", () => {
  const base = { entityType: "movie", language: "pt-BR", missing: true, limit: 10, dryRun: false, fake: false, confirmLive: false };

  it("happy path resolve ok (fake por padrao)", () => {
    const cmd = resolveRunOfflineCommand(base);
    expect(cmd).toEqual({
      kind: "ok",
      options: { entityType: "movie", languageCode: "pt-BR", limit: 10, dryRun: false },
      useRealGemini: false,
    });
  });

  it("--missing obrigatorio", () => {
    const cmd = resolveRunOfflineCommand({ ...base, missing: false });
    expect(cmd.kind).toBe("error");
    if (cmd.kind === "error") expect(cmd.message).toContain("--missing");
  });

  it("--limit obrigatorio (ausente)", () => {
    const cmd = resolveRunOfflineCommand({ ...base, limit: undefined });
    expect(cmd.kind).toBe("error");
    if (cmd.kind === "error") expect(cmd.message).toContain("--limit");
  });

  it("--limit <= 0 e rejeitado", () => {
    expect(resolveRunOfflineCommand({ ...base, limit: 0 }).kind).toBe("error");
    expect(resolveRunOfflineCommand({ ...base, limit: -3 }).kind).toBe("error");
  });

  it("--entity-type so movie|tv", () => {
    expect(resolveRunOfflineCommand({ ...base, entityType: "tv" }).kind).toBe("ok");
    expect(resolveRunOfflineCommand({ ...base, entityType: "person" }).kind).toBe("error");
    expect(resolveRunOfflineCommand({ ...base, entityType: undefined }).kind).toBe("error");
  });

  it("--language so pt-BR", () => {
    expect(resolveRunOfflineCommand({ ...base, language: "en" }).kind).toBe("error");
  });
});

describe("shouldUseRealGemini (fake por padrao; real so com --confirm-live)", () => {
  const base = { entityType: "movie", language: "pt-BR", missing: true, limit: 10, dryRun: false, fake: false, confirmLive: false };

  it("sem --confirm-live => fake", () => {
    expect(shouldUseRealGemini(base)).toBe(false);
  });

  it("--confirm-live (sem dry-run/fake) => real", () => {
    expect(shouldUseRealGemini({ ...base, confirmLive: true })).toBe(true);
  });

  it("--confirm-live + --dry-run => fake (dry-run nunca chama real)", () => {
    expect(shouldUseRealGemini({ ...base, confirmLive: true, dryRun: true })).toBe(false);
  });

  it("--confirm-live + --fake => fake (override explicito)", () => {
    expect(shouldUseRealGemini({ ...base, confirmLive: true, fake: true })).toBe(false);
  });

  it("resolve propaga useRealGemini=true com --confirm-live", () => {
    const cmd = resolveRunOfflineCommand({ ...base, confirmLive: true });
    expect(cmd.kind).toBe("ok");
    if (cmd.kind === "ok") expect(cmd.useRealGemini).toBe(true);
  });
});
