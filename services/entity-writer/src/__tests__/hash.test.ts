/**
 * Testes do hash determinístico (input/output) do Entity Writer.
 */

import { describe, expect, it } from "vitest";
import type { EntityPayload, EntityWriterOutput } from "@screena/schemas";
import { hashOutput, hashPayload, sha256Hex, stableStringify } from "../utils/hash.js";

const payload: EntityPayload = {
  director: "Denis Villeneuve",
  cast: ["Timothee Chalamet", "Rebecca Ferguson"],
};

describe("hash", () => {
  it("hashPayload e estavel para o mesmo input (64 hex)", () => {
    expect(hashPayload(payload)).toBe(hashPayload(payload));
    expect(hashPayload(payload)).toHaveLength(64);
  });

  it("hashPayload independe da ordem das chaves do objeto", () => {
    const reordered: EntityPayload = { cast: [...payload.cast], director: payload.director };
    expect(hashPayload(payload)).toBe(hashPayload(reordered));
  });

  it("hashPayload muda quando o input muda", () => {
    const other: EntityPayload = { ...payload, director: "Outro Diretor" };
    expect(hashPayload(payload)).not.toBe(hashPayload(other));
  });

  it("hashOutput e estavel e muda com o conteudo", () => {
    const a: EntityWriterOutput = { editorial_intro: "texto a", warnings: [] };
    const b: EntityWriterOutput = { editorial_intro: "texto b", warnings: [] };
    expect(hashOutput(a)).toBe(hashOutput(a));
    expect(hashOutput(a)).not.toBe(hashOutput(b));
  });

  it("sha256Hex e stableStringify sao determinísticos", () => {
    expect(sha256Hex("abc")).toBe(sha256Hex("abc"));
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});
