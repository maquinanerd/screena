/**
 * args.test.ts — Parser da CLI `pnpm legal`.
 */

import { describe, expect, it } from "vitest";

import { AUTHORIZATION_BATCH } from "../authorization-spec.js";
import { parseLegalArgs } from "../cli/args.js";

function parse(line: string) {
  return parseLegalArgs(line.split(" ").filter((t) => t !== ""));
}

describe("legal args", () => {
  it("sem args → help", () => {
    expect(parse("")).toEqual({ ok: true, args: { command: "help" } });
  });

  it("sources review é read-only", () => {
    const r = parse("sources review");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.args).toMatchObject({ command: "sources", sub: "review" });
  });

  it("sources apply SEM --confirm é dry-run (não exige reviewer)", () => {
    const r = parse("sources apply");
    expect(r.ok).toBe(true);
    if (r.ok && r.args.command === "sources" && r.args.sub === "apply") {
      expect(r.args.confirm).toBe(false);
    }
  });

  it("--confirm SEM --reviewer falha", () => {
    const r = parse(`sources apply --confirm --policy-version=${AUTHORIZATION_BATCH}`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/reviewer/);
  });

  it("--confirm SEM --policy-version falha", () => {
    const r = parse("sources apply --confirm --reviewer=Pablo");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/policy-version/);
  });

  it("--policy-version com valor errado falha (evita aplicar leva errada)", () => {
    const r = parse("sources apply --confirm --reviewer=Pablo --policy-version=errado/v9");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/esperado/);
  });

  it("apply completo e válido é aceito", () => {
    const r = parse(`sources apply --confirm --reviewer=Pablo --policy-version=${AUTHORIZATION_BATCH}`);
    expect(r.ok).toBe(true);
    if (r.ok && r.args.command === "sources" && r.args.sub === "apply") {
      expect(r.args.confirm).toBe(true);
      expect(r.args.reviewer).toBe("Pablo");
    }
  });

  it("subcomando inválido falha", () => {
    expect(parse("sources destroy").ok).toBe(false);
  });

  // ============ remediate: REPARO DE DADO, não uma leva ============

  it("remediate sem --confirm é dry-run e não exige reviewer", () => {
    const r = parse("sources remediate");
    expect(r.ok).toBe(true);
    if (r.ok && r.args.command === "sources" && r.args.sub === "remediate") {
      expect(r.args.confirm).toBe(false);
      expect(r.args.reviewer).toBeNull();
    }
  });

  it("remediate --confirm exige --reviewer (mutação de registro legal tem dono)", () => {
    const r = parse("sources remediate --confirm");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/reviewer/);
  });

  it("remediate RECUSA --policy-version: não é leva de autorização", () => {
    const r = parse(`sources remediate --confirm --reviewer=Pablo --policy-version=${AUTHORIZATION_BATCH}`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/nao aceita --policy-version/);
  });

  it("remediate completo é aceito", () => {
    const r = parse("sources remediate --confirm --reviewer=Pablo");
    expect(r.ok).toBe(true);
    if (r.ok && r.args.command === "sources" && r.args.sub === "remediate") {
      expect(r.args.confirm).toBe(true);
      expect(r.args.reviewer).toBe("Pablo");
    }
  });
});
