/**
 * enqueue-cli.test.ts — Testes do parse/resolucao PURA do CLI de enqueue.
 *
 * Sem efeito colateral: nenhuma chamada a banco, Gemini ou process.exit. Cobre os
 * dois modos (single por id e missing em lote) e as regras de validacao de flags.
 */

import { describe, expect, it } from "vitest";
import { parseEnqueueArgs, resolveEnqueueCommand } from "../runner/enqueue-cli.js";

describe("parseEnqueueArgs", () => {
  it("default: pt-BR, sem missing, sem force/dry-run", () => {
    const args = parseEnqueueArgs(["--entity-type", "movie", "--entity-id", "42"]);
    expect(args).toEqual({
      entityType: "movie",
      entityId: "42",
      language: "pt-BR",
      force: false,
      dryRun: false,
      missing: false,
      limit: undefined,
    });
  });

  it("parseia --missing --limit N", () => {
    const args = parseEnqueueArgs(["--entity-type", "movie", "--missing", "--limit", "50", "--dry-run"]);
    expect(args.missing).toBe(true);
    expect(args.limit).toBe(50);
    expect(args.dryRun).toBe(true);
  });
});

describe("resolveEnqueueCommand (single)", () => {
  it("modo single por --entity-id continua funcionando", () => {
    const cmd = resolveEnqueueCommand(parseEnqueueArgs(["--entity-type", "movie", "--entity-id", "42"]));
    expect(cmd).toEqual({
      kind: "single",
      entityType: "movie",
      entityId: "42",
      languageCode: "pt-BR",
      force: false,
      dryRun: false,
    });
  });

  it("single sem --entity-id => erro", () => {
    const cmd = resolveEnqueueCommand(parseEnqueueArgs(["--entity-type", "movie"]));
    expect(cmd.kind).toBe("error");
  });

  it("single aceita person (pulado depois pelo planner, nao no CLI)", () => {
    const cmd = resolveEnqueueCommand(parseEnqueueArgs(["--entity-type", "person", "--entity-id", "5"]));
    expect(cmd.kind).toBe("single");
  });
});

describe("resolveEnqueueCommand (missing)", () => {
  it("--missing exige --limit", () => {
    const cmd = resolveEnqueueCommand(parseEnqueueArgs(["--entity-type", "movie", "--missing"]));
    expect(cmd.kind).toBe("error");
    if (cmd.kind === "error") expect(cmd.message).toContain("--limit");
  });

  it("--missing sem --entity-id funciona", () => {
    const cmd = resolveEnqueueCommand(parseEnqueueArgs(["--entity-type", "movie", "--missing", "--limit", "50"]));
    expect(cmd).toEqual({
      kind: "missing",
      entityType: "movie",
      languageCode: "pt-BR",
      limit: 50,
      dryRun: false,
    });
  });

  it("--missing com tv e dry-run", () => {
    const cmd = resolveEnqueueCommand(
      parseEnqueueArgs(["--entity-type", "tv", "--missing", "--limit", "25", "--dry-run"]),
    );
    expect(cmd).toEqual({ kind: "missing", entityType: "tv", languageCode: "pt-BR", limit: 25, dryRun: true });
  });

  it("--missing NAO aceita person nesta fase", () => {
    const cmd = resolveEnqueueCommand(parseEnqueueArgs(["--entity-type", "person", "--missing", "--limit", "10"]));
    expect(cmd.kind).toBe("error");
    if (cmd.kind === "error") expect(cmd.message).toContain("movie|tv");
  });

  it("--missing rejeita --limit <= 0", () => {
    const cmd = resolveEnqueueCommand(parseEnqueueArgs(["--entity-type", "movie", "--missing", "--limit", "0"]));
    expect(cmd.kind).toBe("error");
  });
});
