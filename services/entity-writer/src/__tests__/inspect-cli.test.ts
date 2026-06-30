/**
 * inspect-cli.test.ts — Testes do parse/resolucao PURA do CLI de inspecao.
 *
 * Sem efeito colateral: nenhuma chamada a banco, Gemini ou process.exit. Cobre
 * defaults, validacao de flags, clamp de limit e a checagem de DATABASE_URL.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_LANGUAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  parseInspectArgs,
  requireDatabaseUrl,
  resolveInspectCommand,
} from "../inspect/inspect-cli.js";

describe("parseInspectArgs", () => {
  it("defaults: pt-BR, limit 20, sem json, sem entityType", () => {
    expect(parseInspectArgs([])).toEqual({
      entityType: undefined,
      language: DEFAULT_LANGUAGE,
      limit: DEFAULT_LIMIT,
      json: false,
    });
  });

  it("parseia --limit, --entity-type, --language e --json", () => {
    const args = parseInspectArgs([
      "--limit",
      "50",
      "--entity-type",
      "tv",
      "--language",
      "en",
      "--json",
    ]);
    expect(args).toEqual({ entityType: "tv", language: "en", limit: 50, json: true });
  });

  it("--limit invalido cai no default (validado depois)", () => {
    expect(parseInspectArgs(["--limit", "abc"]).limit).toBe(DEFAULT_LIMIT);
  });
});

describe("resolveInspectCommand", () => {
  it("ok com defaults (sem filtro de entityType)", () => {
    const cmd = resolveInspectCommand(parseInspectArgs([]));
    expect(cmd).toEqual({
      kind: "ok",
      entityType: undefined,
      languageCode: "pt-BR",
      limit: 20,
      json: false,
    });
  });

  it("respeita filtro por entityType e language", () => {
    const cmd = resolveInspectCommand(
      parseInspectArgs(["--entity-type", "movie", "--language", "es", "--limit", "5"]),
    );
    expect(cmd).toEqual({
      kind: "ok",
      entityType: "movie",
      languageCode: "es",
      limit: 5,
      json: false,
    });
  });

  it("--entity-type invalido => erro", () => {
    const cmd = resolveInspectCommand(parseInspectArgs(["--entity-type", "banana"]));
    expect(cmd.kind).toBe("error");
    if (cmd.kind === "error") expect(cmd.message).toContain("--entity-type");
  });

  it("aceita os 5 tipos (movie|tv|season|episode|person)", () => {
    for (const entityType of ["movie", "tv", "season", "episode", "person"]) {
      const cmd = resolveInspectCommand(parseInspectArgs(["--entity-type", entityType]));
      expect(cmd.kind).toBe("ok");
    }
  });

  it("--limit <= 0 => erro", () => {
    const cmd = resolveInspectCommand(parseInspectArgs(["--limit", "0"]));
    expect(cmd.kind).toBe("error");
  });

  it("--limit acima do teto e limitado a MAX_LIMIT", () => {
    const cmd = resolveInspectCommand(parseInspectArgs(["--limit", "9999"]));
    expect(cmd.kind).toBe("ok");
    if (cmd.kind === "ok") expect(cmd.limit).toBe(MAX_LIMIT);
  });

  it("--limit fracionario e truncado (floor)", () => {
    const cmd = resolveInspectCommand(parseInspectArgs(["--limit", "7.9"]));
    expect(cmd.kind).toBe("ok");
    if (cmd.kind === "ok") expect(cmd.limit).toBe(7);
  });

  it("--language vazio => erro", () => {
    const cmd = resolveInspectCommand(parseInspectArgs(["--language", "   "]));
    expect(cmd.kind).toBe("error");
  });
});

describe("requireDatabaseUrl", () => {
  it("aborta quando DATABASE_URL ausente", () => {
    const check = requireDatabaseUrl({});
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.message).toContain("DATABASE_URL");
  });

  it("aborta quando DATABASE_URL e vazio/espacos", () => {
    expect(requireDatabaseUrl({ DATABASE_URL: "   " }).ok).toBe(false);
  });

  it("passa quando DATABASE_URL esta definido", () => {
    expect(requireDatabaseUrl({ DATABASE_URL: "postgresql://x" }).ok).toBe(true);
  });
});
