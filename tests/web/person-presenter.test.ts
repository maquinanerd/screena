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
  countHiddenCredits,
  countLinkableCreditRows,
  evaluatePersonIndexability,
  formatHiddenCreditsNotice,
  formatLifeLabel,
  isPersonCreditEntityType,
  mapKnownForDepartment,
  normalizePersonLocalImagePath,
  selectPersonName,
  selectPersonOriginalName,
  selectRenderablePersonBlocks,
  selectSourceBiography,
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
    biography: null,
    biographySourceStatus: null,
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
    // ACENTUADO: estes valores vao para a TELA (kicker "Pessoa · Atuação" e
    // `jobTitle` do JSON-LD), nao sao identificador tecnico. Sem acento, o
    // leitor via "Atuacao" ao lado de rotulos acentuados na mesma pagina.
    expect(mapKnownForDepartment("Acting")).toBe("Atuação");
    expect(mapKnownForDepartment("Directing")).toBe("Direção");
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
      posterUrl: null,
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
      rawCreditCount: 0,
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
      rawCreditCount: 1,
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
    // Recusar o credito nao e o mesmo que nao ter credito: partiu de 1.
    expect(view.hiddenCreditCount).toBe(1);
  });

  it("monta perfil REMOTO do TMDB a partir do file_path cru (original)", () => {
    const view = buildPersonPageView({
      record: record({ name: "Pessoa TMDB", profilePath: "/abc.jpg" }),
      translation: null,
      blocks: [],
      credits: [],
      rawCreditCount: 0,
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
      rawCreditCount: 2,
    });

    expect(view.name).toBe("Pessoa PT");
    expect(view.originalName).toBe("Original Person");
    expect(view.roleLabel).toBe("Atuação");
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
    // CONTROLE NEGATIVO: partiu de 2, listou 2 — nada escondido.
    expect(view.hiddenCreditCount).toBe(0);
  });
});

/**
 * A FILMOGRAFIA PARCIAL QUE SE APRESENTAVA COMO COMPLETA.
 *
 * Entre a linha de `cast_members`/`crew_members` e a tela ha DOIS pontos de
 * descarte, em modulos diferentes:
 *
 *  1. no server (`person-page.ts`): o alvo do credito nao esta na tabela base
 *     (`movies`/`tv_shows`). O credito nem chega ao presenter. Hoje o banco
 *     impede esse estado (FK para `entities`), mas o ramo existe e, se um dia
 *     disparar, precisa aparecer na conta — daqui o presenter so ve o efeito:
 *     `rawCreditCount` maior que a lista que recebeu.
 *  2. aqui (`buildPersonCredits`): o alvo ESTA no catalogo, mas sem slug
 *     canonico pt-BR — sem link, sem linha. Este e o que trunca de verdade
 *     hoje, e e temporario: morre quando o slug for gerado.
 *
 * Nenhum dos dois contava, e a secao FILMOGRAFIA nao dizia nada: a lista saia
 * truncada com a mesma cara de uma lista inteira. Os testes abaixo cobrem os
 * dois SEPARADAMENTE, mais o controle negativo (completa -> nenhuma linha).
 */
describe("hiddenCreditCount — a filmografia diz quanto descartou", () => {
  it("descarte 1 (alvo fora do catalogo): o credito nem chega ao presenter e ainda assim e contado", () => {
    // O server resolveu 3 linhas cruas e so 2 viraram `PersonCreditInput`: a
    // terceira apontava para um titulo que nao existe em `movies`/`tv_shows`.
    const view = buildPersonPageView({
      record: record({ name: "Pessoa Prolifica" }),
      translation: null,
      blocks: [],
      credits: [
        { entityType: "movie", title: "Filme A", slug: "filme-a", year: 2020, roleLabel: null },
        { entityType: "tv", title: "Serie B", slug: "serie-b", year: 2021, roleLabel: null },
      ],
      rawCreditCount: 3,
    });

    expect(view.credits).toHaveLength(2);
    expect(view.hiddenCreditCount).toBe(1);
  });

  it("descarte 2 (alvo no catalogo, sem slug pt-BR): chega ao presenter e morre aqui", () => {
    const view = buildPersonPageView({
      record: record({ name: "Pessoa Prolifica" }),
      translation: null,
      blocks: [],
      credits: [
        { entityType: "movie", title: "Filme A", slug: "filme-a", year: 2020, roleLabel: null },
        // Existe em `movies` (tem titulo), mas nao tem slug canonico pt-BR.
        { entityType: "movie", title: "Filme Sem Slug", slug: null, year: 2019, roleLabel: null },
      ],
      rawCreditCount: 2,
    });

    expect(view.credits).toHaveLength(1);
    expect(view.hiddenCreditCount).toBe(1);
  });

  it("os dois descartes somam num numero so", () => {
    const view = buildPersonPageView({
      record: record({ name: "Pessoa Prolifica" }),
      translation: null,
      blocks: [],
      credits: [
        { entityType: "movie", title: "Filme A", slug: "filme-a", year: 2020, roleLabel: null },
        { entityType: "movie", title: "Filme Sem Slug", slug: null, year: 2019, roleLabel: null },
      ],
      // 5 linhas cruas: 3 sumiram no server, 1 aqui, 1 sobreviveu.
      rawCreditCount: 5,
    });

    expect(view.credits).toHaveLength(1);
    expect(view.hiddenCreditCount).toBe(4);
  });

  it("CONTROLE NEGATIVO: filmografia completa nao produz linha nenhuma", () => {
    const view = buildPersonPageView({
      record: record({ name: "Pessoa Completa" }),
      translation: null,
      blocks: [],
      credits: [
        { entityType: "movie", title: "Filme A", slug: "filme-a", year: 2020, roleLabel: null },
        { entityType: "tv", title: "Serie B", slug: "serie-b", year: 2021, roleLabel: null },
      ],
      rawCreditCount: 2,
    });

    expect(view.hiddenCreditCount).toBe(0);
    expect(formatHiddenCreditsNotice(view.hiddenCreditCount)).toBeNull();
  });

  it("CONTROLE NEGATIVO: pessoa sem credito nenhum tambem nao produz linha", () => {
    const view = buildPersonPageView({
      record: record({ name: "Pessoa Sem Credito" }),
      translation: null,
      blocks: [],
      credits: [],
      rawCreditCount: 0,
    });

    expect(view.hiddenCreditCount).toBe(0);
    expect(formatHiddenCreditsNotice(view.hiddenCreditCount)).toBeNull();
  });
});

describe("countLinkableCreditRows — o denominador sai da linha crua", () => {
  it("conta so alvo movie|tv; episodio/temporada/pessoa ficam de fora", () => {
    // `cast_members` e polimorfico sobre o enum inteiro e a ingestao de episodio
    // grava guest star com entity_type='episode'. Contar episodio aqui faria a
    // linha dizer "N titulos sem pagina" para creditos que nunca foram titulo.
    const rows = [
      { entityType: "movie" },
      { entityType: "tv" },
      { entityType: "episode" },
      { entityType: "season" },
      { entityType: "person" },
    ];
    expect(countLinkableCreditRows(rows)).toBe(2);
  });

  it("usa a MESMA porta que o resolvedor de creditos", () => {
    // Se o predicado e o contador divergirem, o numero mente: sobra no
    // denominador o que a lista nunca teve chance de exibir (ou vice-versa).
    for (const entityType of ["movie", "tv", "season", "episode", "person", "franchise"]) {
      expect(countLinkableCreditRows([{ entityType }])).toBe(
        isPersonCreditEntityType(entityType) ? 1 : 0,
      );
    }
  });

  it("lista vazia conta zero", () => {
    expect(countLinkableCreditRows([])).toBe(0);
  });
});

describe("countHiddenCredits / formatHiddenCreditsNotice", () => {
  it("clampa em zero: uma tela nunca anuncia credito negativo", () => {
    expect(countHiddenCredits(2, 5)).toBe(0);
    expect(countHiddenCredits(0, 0)).toBe(0);
    expect(countHiddenCredits(Number.NaN, 3)).toBe(0);
  });

  it("subtrai o que sobreviveu do que existia", () => {
    expect(countHiddenCredits(10, 4)).toBe(6);
    expect(countHiddenCredits(1, 0)).toBe(1);
  });

  it("concorda em numero e plural com o que a tela exibe", () => {
    expect(formatHiddenCreditsNotice(0)).toBeNull();
    expect(formatHiddenCreditsNotice(1)).toBe(
      "1 crédito não listado — ainda sem página no catálogo.",
    );
    expect(formatHiddenCreditsNotice(12)).toBe(
      "12 créditos não listados — ainda sem página no catálogo.",
    );
  });

  it("a linha nao afirma 'fora do catalogo': isso so vale para UMA das duas causas", () => {
    // Descarte 2 e um titulo que ESTA no catalogo e so nao tem slug pt-BR.
    // Um texto que dissesse "fora do catalogo" seria falso para ele.
    const notice = formatHiddenCreditsNotice(3);
    expect(notice).not.toBeNull();
    expect(notice?.toLowerCase()).not.toContain("fora do catálogo");
  });
});

/**
 * O GATE DA BIOGRAFIA — duas condicoes, e nenhuma basta sozinha.
 *
 * A coluna `people.biography` passou a existir em 20/08/2026 (antes o texto
 * chegava do TMDB e era descartado). Ter o texto NAO e ter permissao: quem
 * governa a tela e `biography_source_status`, que nasce `unknown`.
 */
describe("selectSourceBiography — texto de terceiro so com licenca", () => {
  const TEXTO = "Nasceu em Belo Horizonte e estreou no teatro aos dezoito anos.";

  it("NEGATIVO: texto presente com status `unknown` (o default) NAO exibe", () => {
    // Este e o estado de TODA pessoa hoje. A ingestao grava o texto e nao toca
    // no status; so decisao humana registrada o move.
    expect(
      selectSourceBiography(record({ biography: TEXTO, biographySourceStatus: "unknown" })),
    ).toBeNull();
  });

  it("NEGATIVO: `blocked` nao exibe, mesmo com texto", () => {
    expect(
      selectSourceBiography(record({ biography: TEXTO, biographySourceStatus: "blocked" })),
    ).toBeNull();
  });

  it("NEGATIVO: status ausente equivale a `unknown` (fail-closed)", () => {
    expect(
      selectSourceBiography(record({ biography: TEXTO, biographySourceStatus: null })),
    ).toBeNull();
  });

  it("NEGATIVO: licenca boa sem texto nao inventa paragrafo", () => {
    for (const vazio of [null, "", "   "]) {
      expect(
        selectSourceBiography(record({ biography: vazio, biographySourceStatus: "licensed" })),
        `texto: ${JSON.stringify(vazio)}`,
      ).toBeNull();
    }
  });

  it("POSITIVO: os TRES estados que autorizam exibem o texto", () => {
    // Sem este bloco, todas as assercoes acima passariam por vacuidade — um
    // `selectSourceBiography` que sempre devolvesse null seria "aprovado".
    for (const status of ["official", "licensed", "third_party"]) {
      expect(
        selectSourceBiography(record({ biography: TEXTO, biographySourceStatus: status })),
        `status: ${status}`,
      ).toBe(TEXTO);
    }
  });

  it("a lista de estados que autorizam e FECHADA: valor novo nao passa por omissao", () => {
    expect(
      selectSourceBiography(record({ biography: TEXTO, biographySourceStatus: "pending_review" })),
    ).toBeNull();
  });
});
