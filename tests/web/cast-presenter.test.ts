/**
 * Testes puros do presenter de ELENCO das paginas de detalhe (filme/serie).
 *
 * Garantem: nunca inventa elenco (sem nome valido -> fora); ordenacao por
 * billing_order (sem ordem vai ao fim); teto de exibicao; link so com slug
 * canonico valido; imagem so de path local seguro.
 */

import { describe, expect, it } from "vitest";

import {
  buildCastMemberView,
  buildCastStrip,
  DEFAULT_CAST_LIMIT,
  normalizeCastLocalImagePath,
  type CastMemberInput,
} from "../../apps/web/src/lib/cast-presenter";

function member(overrides: Partial<CastMemberInput> = {}): CastMemberInput {
  return {
    name: "Fulano",
    character: null,
    billingOrder: null,
    profilePath: null,
    slug: null,
    ...overrides,
  };
}

describe("normalizeCastLocalImagePath", () => {
  it("aceita so paths locais seguros (prefixo + extensao raster)", () => {
    expect(normalizeCastLocalImagePath("/media/demo/person-x-profile.png")).toBe(
      "/media/demo/person-x-profile.png",
    );
    expect(normalizeCastLocalImagePath(" /uploads/p.webp ")).toBe("/uploads/p.webp");
  });

  it("recusa externo, TMDB cru, query, traversal e extensao vazia", () => {
    expect(normalizeCastLocalImagePath(null)).toBeNull();
    expect(normalizeCastLocalImagePath("https://image.tmdb.org/t/p/w200/a.jpg")).toBeNull();
    expect(normalizeCastLocalImagePath("//x.com/p.jpg")).toBeNull();
    expect(normalizeCastLocalImagePath("/abc.jpg")).toBeNull();
    expect(normalizeCastLocalImagePath("/media/p.jpg?x=1")).toBeNull();
    expect(normalizeCastLocalImagePath("/media/../p.jpg")).toBeNull();
    expect(normalizeCastLocalImagePath("/media/p.svg")).toBeNull();
  });
});

describe("buildCastMemberView", () => {
  it("descarta entrada sem nome valido", () => {
    expect(buildCastMemberView(member({ name: "   " }))).toBeNull();
  });

  it("monta link so com slug canonico valido", () => {
    expect(buildCastMemberView(member({ slug: "helena-vasconcelos" }))?.href).toBe(
      "/pt/pessoas/helena-vasconcelos/",
    );
    expect(buildCastMemberView(member({ slug: "a/b" }))?.href).toBeNull();
    expect(buildCastMemberView(member({ slug: null }))?.href).toBeNull();
  });

  it("normaliza personagem vazio para null e resolve retrato local", () => {
    const view = buildCastMemberView(
      member({ character: "   ", profilePath: "/media/demo/x.png" }),
    );
    expect(view?.character).toBeNull();
    expect(view?.profile?.src).toBe("/media/demo/x.png");
  });
});

describe("buildCastStrip", () => {
  it("ordena por billing_order (nulos ao fim) e aplica o teto", () => {
    const cast = buildCastStrip(
      [
        member({ name: "C", billingOrder: null }),
        member({ name: "A", billingOrder: 2 }),
        member({ name: "B", billingOrder: 0 }),
        member({ name: "  ", billingOrder: 1 }), // sem nome -> fora
      ],
      2,
    );
    expect(cast.map((c) => c.name)).toEqual(["B", "A"]);
  });

  it("desempata billing igual por nome (estavel)", () => {
    const cast = buildCastStrip([
      member({ name: "Zeca", billingOrder: 0 }),
      member({ name: "Ana", billingOrder: 0 }),
    ]);
    expect(cast.map((c) => c.name)).toEqual(["Ana", "Zeca"]);
  });

  it("teto padrao quando o limite e invalido", () => {
    const many = Array.from({ length: DEFAULT_CAST_LIMIT + 5 }, (_, i) =>
      member({ name: `P${i}`, billingOrder: i }),
    );
    expect(buildCastStrip(many, 0)).toHaveLength(DEFAULT_CAST_LIMIT);
    expect(buildCastStrip([], 10)).toEqual([]);
  });
});
