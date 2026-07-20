/**
 * Testes do toolkit de parsing estrito (contracts/parse.ts): so aceita objeto
 * simples, rejeita chaves perigosas (__proto__/constructor/prototype), aplica
 * allow-list (mass-assignment barrado) e corpo-vazio para operacoes autenticadas.
 */

import { describe, expect, it } from "vitest";
import {
  asRecord,
  expectEmptyBody,
  optionalString,
  rejectUnknownKeys,
  requireString,
} from "../parse.js";

describe("asRecord", () => {
  it("(1) aceita objeto simples", () => {
    const r = asRecord({ a: 1 });
    expect(r.ok).toBe(true);
  });

  it("(2) rejeita primitivo, null e array", () => {
    expect(asRecord("x").ok).toBe(false);
    expect(asRecord(null).ok).toBe(false);
    expect(asRecord(123).ok).toBe(false);
    expect(asRecord([1, 2]).ok).toBe(false);
  });

  it("(3) rejeita objeto com chave propria __proto__ (JSON.parse pollution attempt)", () => {
    const malicious = JSON.parse('{"__proto__": {"isAdmin": true}, "email": "a@b.co"}');
    const r = asRecord(malicious);
    expect(r.ok).toBe(false);
    // e a prototype global nao foi poluida
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
  });

  it("(4) rejeita chaves proprias constructor/prototype", () => {
    expect(asRecord(JSON.parse('{"constructor": 1}')).ok).toBe(false);
    expect(asRecord(JSON.parse('{"prototype": 1}')).ok).toBe(false);
  });
});

describe("rejectUnknownKeys", () => {
  it("(1) aceita quando so ha chaves permitidas", () => {
    expect(rejectUnknownKeys({ email: "a", password: "b" }, ["email", "password"]).ok).toBe(true);
  });

  it("(2) rejeita qualquer chave extra (mass-assignment)", () => {
    const r = rejectUnknownKeys({ email: "a", role: "admin" }, ["email"]);
    expect(r.ok).toBe(false);
  });
});

describe("requireString / optionalString", () => {
  it("(1) requireString rejeita ausente, nao-string, vazio e excesso", () => {
    expect(requireString({}, "x", { max: 10 }).ok).toBe(false);
    expect(requireString({ x: 5 }, "x", { max: 10 }).ok).toBe(false);
    expect(requireString({ x: "  " }, "x", { trim: true, max: 10 }).ok).toBe(false);
    expect(requireString({ x: "a".repeat(11) }, "x", { max: 10 }).ok).toBe(false);
    expect(requireString({ x: "ok" }, "x", { max: 10 }).ok).toBe(true);
  });

  it("(2) optionalString: ausente/null => undefined; presente valida", () => {
    expect(optionalString({}, "x", { max: 10 })).toEqual({ ok: true, value: undefined });
    expect(optionalString({ x: null }, "x", { max: 10 })).toEqual({ ok: true, value: undefined });
    const present = optionalString({ x: " nome " }, "x", { trim: true, max: 10 });
    expect(present).toEqual({ ok: true, value: "nome" });
  });
});

describe("expectEmptyBody", () => {
  it("(1) aceita null, undefined e {}", () => {
    expect(expectEmptyBody(null).ok).toBe(true);
    expect(expectEmptyBody(undefined).ok).toBe(true);
    expect(expectEmptyBody({}).ok).toBe(true);
  });

  it("(2) rejeita qualquer chave (ex.: sessionId, userId enviados pelo cliente)", () => {
    expect(expectEmptyBody({ sessionId: "5" }).ok).toBe(false);
    expect(expectEmptyBody({ userId: "1" }).ok).toBe(false);
  });
});
