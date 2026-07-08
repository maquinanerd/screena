/**
 * Testes puros do presenter da pagina publica de pessoa.
 *
 * Garantem que a view nao inventa dados (bio, funcao, datas, filmografia),
 * aplica o gate anti-thin, so aceita imagens locais seguras e resolve creditos
 * apenas quando ha titulo + slug reais.
 */

import { describe, expect, it } from "vitest";

import {
  buildPersonCredits,
  buildPersonPageView,
  evaluatePersonIndexability,
  formatLifeLabel,
  mapKnownForDepartment,
  normalizePersonLocalImagePath,
  selectPersonName,
  selectPersonOriginalName,
  selectRenderablePersonBlocks,
  type PersonContentBlockInput,
  type PersonCreditInput,
  type PersonRecordInput,
  type PersonTranslationInput,
} from "../../apps/web/src/lib/person-presenter";

function record(overrides: Partial<PersonRecordInput> = {}): PersonRecordInput {
  return {
    name: "Original Person",
    knownForDepartment: null,
    birthDateIso: null,
    deathDateIso: null,
    placeOfBirth: null,
    profilePath: null,
    ...overrides,
  };
}

function translation(
  overrides: Partial<PersonTranslationInput> = {},
): PersonTranslationInput {
  return { title: null, metaTitle: null, metaDescription: null, ...overrides };
}

describe("normalizePersonLocalImagePath", () => {
  it("aceita apenas paths locais seguros", () => {
    expect(normalizePersonLocalImagePath(" /media/people/x.webp ")).toBe(
      "/media/people/x.webp",
    );
    expect(normalizePersonLocalImagePath("/uploads/people/y.jpg")).toBe(
      "/uploads/people/y.jpg",
    );
    expect(normalizePersonLocalImagePath("/brand/z.png")).toBe("/brand/z.png");
  });

  it("recusa nulo, vazio, URL externa, image.tmdb.org, path cru e traversal", () => {
    expect(normalizePersonLocalImagePath(null)).toBeNull();
    expect(normalizePersonLocalImagePath("")).toBeNull();
    expect(
      normalizePersonLocalImagePath("https://image.tmdb.org/t/p/w300/a.jpg"),
    ).toBeNull();
    expect(normalizePersonLocalImagePath("https://example.com/p.jpg")).toBeNull();
    expect(normalizePersonLocalImagePath("//example.com/p.jpg")).toBeNull();
    expect(normalizePersonLocalImagePath("/abc.jpg")).toBeNull();
    expect(normalizePersonLocalImagePath("/media/p.jpg?x=1")).toBeNull();
    expect(normalizePersonLocalImagePath("/media/../secret.jpg")).toBeNull();
  });
});

describe("nome exibido e original", () => {
  it("usa traducao pt-BR e expoe o original quando difere", () => {
    const rec = record();
    const tr = translation({ title: "Pessoa PT" });
    expect(selectPersonName(rec, tr)).toBe("Pessoa PT");
    expect(selectPersonOriginalName(rec, tr)).toBe("Original Person");
  });

  it("cai para o nome canonico e nao repete original quando igual", () => {
    expect(selectPersonName(record(), null)).toBe("Original Person");
    expect(selectPersonOriginalName(record(), null)).toBeNull();
    expect(
      selectPersonOriginalName(record({ name: "Igual" }), translation({ title: " Igual " })),
    ).toBeNull();
  });
});

describe("mapKnownForDepartment", () => {
  it("traduz departamentos conhecidos e ignora desconhecidos/ausentes", () => {
    expect(mapKnownForDepartment("Acting")).toBe("Atuacao");
    expect(mapKnownForDepartment("Directing")).toBe("Direcao");
    expect(mapKnownForDepartment("Departamento Inexistente")).toBeNull();
    expect(mapKnownForDepartment(null)).toBeNull();
    expect(mapKnownForDepartment("  ")).toBeNull();
  });
});

describe("formatLifeLabel", () => {
  it("monta o rotulo apenas com os anos existentes, sem calcular idade", () => {
    expect(formatLifeLabel("1970-05-25", "2020-01-02")).toBe("1970–2020");
    expect(formatLifeLabel("1970-05-25", null)).toBe("Nascimento: 1970");
    expect(formatLifeLabel(null, "2020-01-02")).toBe("Falecimento: 2020");
    expect(formatLifeLabel(null, null)).toBeNull();
    expect(formatLifeLabel("nao-e-data", null)).toBeNull();
  });
});

describe("selectRenderablePersonBlocks", () => {
  it("mantem so blocos publicaveis, nao vazios, em ordem canonica", () => {
    const blocks: PersonContentBlockInput[] = [
      { blockType: "faq", content: "f", reviewStatus: "published" },
      { blockType: "editorial_intro", content: "e", reviewStatus: "human_reviewed" },
      { blockType: "news_context", content: "n", reviewStatus: "ai_generated" },
      { blockType: "review_summary", content: "   ", reviewStatus: "published" },
    ];
    expect(selectRenderablePersonBlocks(blocks).map((b) => b.blockType)).toEqual([
      "editorial_intro",
      "faq",
    ]);
  });

  it("ignora duplicatas do mesmo block_type", () => {
    const blocks: PersonContentBlockInput[] = [
      { blockType: "editorial_intro", content: "a", reviewStatus: "published" },
      { blockType: "editorial_intro", content: "b", reviewStatus: "published" },
    ];
    expect(selectRenderablePersonBlocks(blocks)).toHaveLength(1);
  });
});

describe("evaluatePersonIndexability (indexacao total)", () => {
  it("indexa mesmo com menos de dois blocos (a ficha da pessoa basta)", () => {
    expect(evaluatePersonIndexability({ renderableBlockCount: 0 }).decision).toBe(
      "index",
    );
    expect(evaluatePersonIndexability({ renderableBlockCount: 1 }).decision).toBe(
      "index",
    );
  });

  it("indexa com dois ou mais blocos (pagina rica)", () => {
    const rich = evaluatePersonIndexability({ renderableBlockCount: 2 });
    expect(rich.decision).toBe("index");
    expect(rich.hasUniqueValue).toBe(true);
  });
});

describe("buildPersonCredits", () => {
  it("descarta creditos sem titulo ou sem slug e ordena por ano decrescente", () => {
    const inputs: PersonCreditInput[] = [
      { entityType: "movie", title: "Filme A", slug: "filme-a", year: 2020, roleLabel: "Protagonista" },
      { entityType: "tv", title: "Serie B", slug: "serie-b", year: 2022, roleLabel: "Direcao" },
      { entityType: "movie", title: "Sem Slug", slug: null, year: 2019, roleLabel: null },
      { entityType: "movie", title: null, slug: "sem-titulo", year: 2018, roleLabel: null },
    ];
    const credits = buildPersonCredits(inputs);
    expect(credits).toHaveLength(2);
    expect(credits[0]).toEqual({
      entityType: "tv",
      title: "Serie B",
      href: "/pt/series/serie-b/",
      year: 2022,
      roleLabel: "Direcao",
    });
    expect(credits[1]?.href).toBe("/pt/filmes/filme-a/");
  });

  it("nao inventa creditos: entrada vazia gera lista vazia", () => {
    expect(buildPersonCredits([])).toEqual([]);
  });
});

describe("buildPersonPageView", () => {
  it("usa dados minimos sem inventar bio, funcao, datas ou filmografia", () => {
    const view = buildPersonPageView({
      record: record({ name: "Jane Doe" }),
      translation: null,
      blocks: [],
      credits: [],
    });

    expect(view.name).toBe("Jane Doe");
    expect(view.originalName).toBeNull();
    expect(view.roleLabel).toBeNull();
    expect(view.birthDateIso).toBeNull();
    expect(view.deathDateIso).toBeNull();
    expect(view.lifeLabel).toBeNull();
    expect(view.placeOfBirth).toBeNull();
    expect(view.metaDescription).toBeNull();
    expect(view.profile).toBeNull();
    expect(view.hasRealImage).toBe(false);
    expect(view.blocks).toEqual([]);
    expect(view.renderableBlockCount).toBe(0);
    expect(view.credits).toEqual([]);
  });

  it("trata campos vazios como ausentes e recusa imagem/credito nao resolviveis", () => {
    const view = buildPersonPageView({
      record: record({
        name: "Original Person",
        knownForDepartment: "  ",
        placeOfBirth: "   ",
        profilePath: "https://ext.com/p.jpg",
        birthDateIso: "  ",
      }),
      translation: translation({ title: " ", metaTitle: "", metaDescription: " " }),
      blocks: [{ blockType: "faq", content: "  ", reviewStatus: "published" }],
      credits: [
        { entityType: "movie", title: "Sem Slug", slug: "  ", year: 2019, roleLabel: null },
      ],
    });

    expect(view.name).toBe("Original Person");
    expect(view.roleLabel).toBeNull();
    expect(view.placeOfBirth).toBeNull();
    expect(view.metaTitle).toBeNull();
    expect(view.metaDescription).toBeNull();
    expect(view.profile).toBeNull();
    expect(view.hasRealImage).toBe(false);
    expect(view.blocks).toEqual([]);
    expect(view.credits).toEqual([]);
  });

  it("monta perfil REMOTO do TMDB a partir do file_path cru (original)", () => {
    const view = buildPersonPageView({
      record: record({ name: "Pessoa TMDB", profilePath: "/abc.jpg" }),
      translation: null,
      blocks: [],
      credits: [],
    });
    expect(view.profile?.src).toBe("https://image.tmdb.org/t/p/original/abc.jpg");
    expect(view.hasRealImage).toBe(true);
  });

  it("monta view com campos reais, blocos publicos, imagem local e filmografia", () => {
    const view = buildPersonPageView({
      record: record({
        name: "Original Person",
        knownForDepartment: "Acting",
        birthDateIso: "1970-05-25",
        deathDateIso: null,
        placeOfBirth: "Sao Paulo, Brasil",
        profilePath: "/media/people/person.webp",
      }),
      translation: translation({
        title: "Pessoa PT",
        metaTitle: "Pessoa PT - Pessoa",
        metaDescription: "Descricao editorial pt-BR existente.",
      }),
      blocks: [
        { blockType: "editorial_intro", content: "Intro editorial.", reviewStatus: "published" },
        { blockType: "faq", content: "Perguntas revisadas.", reviewStatus: "human_reviewed" },
        { blockType: "news_context", content: "rascunho", reviewStatus: "needs_review" },
      ],
      credits: [
        { entityType: "movie", title: "Filme Antigo", slug: "filme-antigo", year: 2005, roleLabel: "Protagonista" },
        { entityType: "tv", title: "Serie Nova", slug: "serie-nova", year: 2021, roleLabel: "Direcao" },
      ],
    });

    expect(view.name).toBe("Pessoa PT");
    expect(view.originalName).toBe("Original Person");
    expect(view.roleLabel).toBe("Atuacao");
    expect(view.lifeLabel).toBe("Nascimento: 1970");
    expect(view.birthDateIso).toBe("1970-05-25");
    expect(view.placeOfBirth).toBe("Sao Paulo, Brasil");
    expect(view.metaDescription).toBe("Descricao editorial pt-BR existente.");
    expect(view.profile?.src).toBe("/media/people/person.webp");
    expect(view.hasRealImage).toBe(true);
    expect(view.blocks.map((b) => b.blockType)).toEqual(["editorial_intro", "faq"]);
    expect(view.renderableBlockCount).toBe(2);
    expect(view.credits.map((c) => c.href)).toEqual([
      "/pt/series/serie-nova/",
      "/pt/filmes/filme-antigo/",
    ]);
  });
});
