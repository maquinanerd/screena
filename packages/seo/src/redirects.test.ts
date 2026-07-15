/**
 * redirects.test.ts — Classificacao e resolucao de cadeia de redirects
 * (Prompt 3 §6): 301/308 permanente, 302/307 temporario, alias e framework
 * distintos; deteccao de loop e cadeia longa; colapso A -> destino final.
 */

import { describe, expect, it } from "vitest";

import {
  classifyRedirect,
  resolveRedirectChain,
  type ClassifiedRedirect,
} from "./redirects.js";

function indexFrom(records: ClassifiedRedirect[]): Map<string, ClassifiedRedirect> {
  return new Map(records.map((r) => [r.fromPath, r]));
}

describe("classifyRedirect", () => {
  it("301 -> permanent", () => {
    expect(classifyRedirect({ fromPath: "/a", toPath: "/b", statusCode: 301 }).kind).toBe(
      "permanent",
    );
  });

  it("308 -> permanent (contrato persistido, nao framework)", () => {
    expect(classifyRedirect({ fromPath: "/a", toPath: "/b", statusCode: 308 }).kind).toBe(
      "permanent",
    );
  });

  it("302/303/307 -> temporary", () => {
    for (const code of [302, 303, 307]) {
      expect(
        classifyRedirect({ fromPath: "/a", toPath: "/b", statusCode: code }).kind,
      ).toBe("temporary");
    }
  });

  it("reason 'alias' -> alias, mesmo com 301", () => {
    expect(
      classifyRedirect({ fromPath: "/a", toPath: "/b", statusCode: 301, reason: "compat alias" })
        .kind,
    ).toBe("alias");
  });

  it("reason 'framework'/'trailing' -> framework (nao confundir com 301 persistido)", () => {
    expect(
      classifyRedirect({ fromPath: "/a", toPath: "/a/", statusCode: 308, reason: "trailing slash" })
        .kind,
    ).toBe("framework");
  });
});

describe("resolveRedirectChain", () => {
  it("sem redirect -> none", () => {
    const r = resolveRedirectChain(indexFrom([]), "/x");
    expect(r.status).toBe("none");
    expect(r.finalPath).toBeNull();
  });

  it("um salto -> resolved, 308 permanente", () => {
    const idx = indexFrom([
      classifyRedirect({ fromPath: "/a", toPath: "/b", statusCode: 301 }),
    ]);
    const r = resolveRedirectChain(idx, "/a");
    expect(r.status).toBe("resolved");
    expect(r.finalPath).toBe("/b");
    expect(r.statusCode).toBe(308);
    expect(r.temporary).toBe(false);
  });

  it("colapsa cadeia A->B->C num unico destino final", () => {
    const idx = indexFrom([
      classifyRedirect({ fromPath: "/a", toPath: "/b", statusCode: 301 }),
      classifyRedirect({ fromPath: "/b", toPath: "/c", statusCode: 301 }),
    ]);
    const r = resolveRedirectChain(idx, "/a");
    expect(r.status).toBe("resolved");
    expect(r.finalPath).toBe("/c");
    expect(r.hops).toEqual(["/a", "/b", "/c"]);
  });

  it("qualquer salto temporario colapsa para 307", () => {
    const idx = indexFrom([
      classifyRedirect({ fromPath: "/a", toPath: "/b", statusCode: 301 }),
      classifyRedirect({ fromPath: "/b", toPath: "/c", statusCode: 307 }),
    ]);
    const r = resolveRedirectChain(idx, "/a");
    expect(r.status).toBe("resolved");
    expect(r.statusCode).toBe(307);
    expect(r.temporary).toBe(true);
  });

  it("detecta loop A->B->A", () => {
    const idx = indexFrom([
      classifyRedirect({ fromPath: "/a", toPath: "/b", statusCode: 301 }),
      classifyRedirect({ fromPath: "/b", toPath: "/a", statusCode: 301 }),
    ]);
    const r = resolveRedirectChain(idx, "/a");
    expect(r.status).toBe("loop");
    expect(r.finalPath).toBeNull();
  });

  it("detecta loop imediato A->A", () => {
    const idx = indexFrom([
      classifyRedirect({ fromPath: "/a", toPath: "/a", statusCode: 301 }),
    ]);
    const r = resolveRedirectChain(idx, "/a");
    expect(r.status).toBe("loop");
  });

  it("cadeia acima do teto -> too-long", () => {
    const records: ClassifiedRedirect[] = [];
    for (let i = 0; i < 8; i += 1) {
      records.push(
        classifyRedirect({ fromPath: `/n${i}`, toPath: `/n${i + 1}`, statusCode: 301 }),
      );
    }
    const r = resolveRedirectChain(indexFrom(records), "/n0", 5);
    expect(r.status).toBe("too-long");
    expect(r.finalPath).toBeNull();
  });
});
