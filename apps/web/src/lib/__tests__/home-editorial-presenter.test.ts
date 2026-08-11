import { describe, expect, it } from "vitest";

import {
  buildHomeEditorialHighlights,
  classifyEditorialVerticals,
  excludeEditorialHighlights,
  hasEditorialHighlights,
  HOME_EDITORIAL_LOADER_LIMIT,
  type HomeEditorialArticleInput,
} from "../home-editorial-presenter";

/**
 * "Destaques de hoje" é EDITORIAL. Estes testes provam as três coisas que o
 * defeito anterior violava: a seção consome MATÉRIAS (não catálogo), o gate de
 * publicabilidade é o real (embargo/rascunho/retratada/licença não vazam) e a
 * classificação Filmes/Séries vem de sinal PERSISTIDO, nunca de palavra-chave.
 */

const NOW = "2026-07-28T12:00:00.000Z";

function article(
  overrides: Partial<HomeEditorialArticleInput> = {},
): HomeEditorialArticleInput {
  return {
    articleId: "1",
    slug: "materia-de-qa",
    title: "Matéria de QA",
    deck: "Linha de apoio da matéria.",
    reviewStatus: "published",
    translationPublishedAtIso: "2026-07-20T09:00:00.000Z",
    articlePublishedAtIso: null,
    category: "Bastidores",
    heroImagePath: "/media/qa-hero.jpg",
    licenseStatus: "official",
    displayAllowed: true,
    requiresAttribution: false,
    requiresLinkback: false,
    sourceName: null,
    sourceUrl: null,
    linkedEntityTypes: ["movie"],
    ...overrides,
  };
}

describe("home editorial — classificação por sinal persistido", () => {
  it("classifica pelos TIPOS das entidades vinculadas, não pelo texto", () => {
    expect(classifyEditorialVerticals(["movie"])).toEqual(["movies"]);
    expect(classifyEditorialVerticals(["tv"])).toEqual(["series"]);
    expect(classifyEditorialVerticals(["movie", "tv"])).toEqual(["movies", "series"]);
  });

  it("sem vínculo classificável (só pessoa, ou nenhum) a matéria NÃO entra", () => {
    expect(classifyEditorialVerticals(["person"])).toEqual([]);
    expect(classifyEditorialVerticals([])).toEqual([]);

    const out = buildHomeEditorialHighlights(
      [
        article({ articleId: "10", slug: "so-pessoa", linkedEntityTypes: ["person"] }),
        article({ articleId: "11", slug: "sem-vinculo", linkedEntityTypes: [] }),
      ],
      NOW,
    );
    expect(out.movies).toHaveLength(0);
    expect(out.series).toHaveLength(0);
    expect(hasEditorialHighlights(out)).toBe(false);
  });

  it("CONTROLE NEGATIVO: título cheio de palavra-chave não classifica sozinho", () => {
    // Se a classificação usasse keyword, esta matéria cairia em Séries. Ela só
    // tem vínculo `movie` persistido — logo é Filmes, e só Filmes.
    const out = buildHomeEditorialHighlights(
      [
        article({
          articleId: "12",
          slug: "serie-temporada-episodio",
          title: "Série, temporada e episódio: o guia da nova temporada",
          category: "Séries",
          linkedEntityTypes: ["movie"],
        }),
      ],
      NOW,
    );
    expect(out.movies.map((c) => c.slug)).toEqual(["serie-temporada-episodio"]);
    expect(out.series).toHaveLength(0);
  });

  it("matéria híbrida aparece nos DOIS filtros, com o vertical de cada lista", () => {
    const out = buildHomeEditorialHighlights(
      [article({ articleId: "20", slug: "hibrida", linkedEntityTypes: ["movie", "tv"] })],
      NOW,
    );
    expect(out.movies[0]?.vertical).toBe("movies");
    expect(out.series[0]?.vertical).toBe("series");
    expect(out.movies[0]?.articleId).toBe(out.series[0]?.articleId);
  });
});

describe("home editorial — gate de publicabilidade (o real, não um simplificado)", () => {
  it("matéria AGENDADA (published_at no futuro) nunca aparece", () => {
    const out = buildHomeEditorialHighlights(
      [
        article({
          articleId: "30",
          slug: "agendada",
          translationPublishedAtIso: "2026-08-30T09:00:00.000Z",
        }),
      ],
      NOW,
    );
    expect(out.movies).toHaveLength(0);
  });

  it("rascunho, revisão pendente, retratada e arquivada nunca aparecem", () => {
    for (const reviewStatus of [
      "draft",
      "ai_generated",
      "needs_review",
      "needs_update",
      "blocked",
      "archived",
    ]) {
      const out = buildHomeEditorialHighlights(
        [article({ articleId: "40", slug: `estado-${reviewStatus}`, reviewStatus })],
        NOW,
      );
      expect(out.movies, `vazou com review_status=${reviewStatus}`).toHaveLength(0);
    }
  });

  it("licença bloqueada/desconhecida ou display negado nunca aparece", () => {
    for (const licenseStatus of ["unknown", "blocked"]) {
      const out = buildHomeEditorialHighlights(
        [article({ articleId: "50", slug: `licenca-${licenseStatus}`, licenseStatus })],
        NOW,
      );
      expect(out.movies, `vazou com license_status=${licenseStatus}`).toHaveLength(0);
    }
    const denied = buildHomeEditorialHighlights(
      [article({ articleId: "51", slug: "display-negado", displayAllowed: false })],
      NOW,
    );
    expect(denied.movies).toHaveLength(0);
  });

  it("crédito/linkback exigidos e ausentes bloqueiam a matéria (fail-closed)", () => {
    const semCredito = buildHomeEditorialHighlights(
      [
        article({
          articleId: "60",
          slug: "sem-credito",
          requiresAttribution: true,
          sourceName: null,
        }),
      ],
      NOW,
    );
    expect(semCredito.movies).toHaveLength(0);

    const semLinkback = buildHomeEditorialHighlights(
      [
        article({
          articleId: "61",
          slug: "sem-linkback",
          requiresLinkback: true,
          sourceUrl: null,
        }),
      ],
      NOW,
    );
    expect(semLinkback.movies).toHaveLength(0);

    // CONTROLE POSITIVO: com o crédito presente, a mesma matéria passa.
    const comCredito = buildHomeEditorialHighlights(
      [
        article({
          articleId: "62",
          slug: "com-credito",
          requiresAttribution: true,
          requiresLinkback: true,
          sourceName: "Collider",
          sourceUrl: "https://collider.com/",
        }),
      ],
      NOW,
    );
    expect(comCredito.movies.map((c) => c.slug)).toEqual(["com-credito"]);
  });

  it("matéria sem slug ou sem título nunca vira card", () => {
    const semSlug = buildHomeEditorialHighlights(
      [article({ articleId: "70", slug: "   " })],
      NOW,
    );
    expect(semSlug.movies).toHaveLength(0);
    const semTitulo = buildHomeEditorialHighlights(
      [article({ articleId: "71", title: "" })],
      NOW,
    );
    expect(semTitulo.movies).toHaveLength(0);
  });
});

describe("home editorial — forma do card e ordenação", () => {
  it("todo card aponta para /pt/noticias/ — nunca para ficha de catálogo", () => {
    const out = buildHomeEditorialHighlights(
      [article({ articleId: "80", slug: "materia-a", linkedEntityTypes: ["movie", "tv"] })],
      NOW,
    );
    for (const card of [...out.movies, ...out.series]) {
      expect(card.href).toBe("/pt/noticias/materia-a/");
      expect(card.href).not.toMatch(/\/pt\/(?:filmes|series|pessoas)\//);
    }
  });

  it("eyebrow usa a categoria real; sem categoria, cai no rótulo da vertical", () => {
    const comCategoria = buildHomeEditorialHighlights(
      [article({ articleId: "90", category: "Estreias" })],
      NOW,
    );
    expect(comCategoria.movies[0]?.eyebrow).toBe("Estreias");

    const semCategoria = buildHomeEditorialHighlights(
      [
        article({ articleId: "91", category: null, linkedEntityTypes: ["movie"] }),
        article({ articleId: "92", category: "  ", linkedEntityTypes: ["tv"] }),
      ],
      NOW,
    );
    expect(semCategoria.movies[0]?.eyebrow).toBe("Filmes");
    expect(semCategoria.series[0]?.eyebrow).toBe("Séries");
  });

  it("token do contrato em `category` vira rótulo pt-BR — nunca vaza cru", () => {
    // A projeção do CMS grava o `contentType` do contrato editorial em
    // `articles.category`. O card exibe o rótulo mapeado, jamais "NEWS"/"LIST".
    const casos: ReadonlyArray<readonly [string, string]> = [
      ["news", "Notícia"],
      ["feature", "Especial"],
      ["review", "Crítica"],
      ["guide", "Guia"],
      ["list", "Explorar coleção"],
      ["interview", "Entrevista"],
      ["evergreen", "Atemporal"],
    ];
    for (const [token, label] of casos) {
      const out = buildHomeEditorialHighlights(
        [article({ articleId: "93", category: token })],
        NOW,
      );
      expect(out.movies[0]?.eyebrow, `token ${token}`).toBe(label);
    }
  });

  it("imagem só LOCAL válida; externa/tmdb/travessia viram placeholder (null)", () => {
    const ok = buildHomeEditorialHighlights(
      [article({ articleId: "100", heroImagePath: "/media/capa.jpg" })],
      NOW,
    );
    expect(ok.movies[0]?.imagePath).toBe("/media/capa.jpg");

    for (const bad of [
      "https://image.tmdb.org/t/p/w780/x.jpg",
      "//cdn.externo/x.jpg",
      "/media/../../etc/passwd.jpg",
      "/qualquer/lugar.jpg",
      null,
    ]) {
      const out = buildHomeEditorialHighlights(
        [article({ articleId: "101", heroImagePath: bad })],
        NOW,
      );
      expect(out.movies[0]?.imagePath, `aceitou imagem inválida: ${bad}`).toBeNull();
    }
  });

  it("alt sempre presente e igual ao título da matéria", () => {
    const out = buildHomeEditorialHighlights(
      [article({ articleId: "110", title: "Uma manchete real" })],
      NOW,
    );
    expect(out.movies[0]?.imageAlt).toBe("Uma manchete real");
  });

  it("ordena por data desc e desempata por id — DETERMINÍSTICO", () => {
    const inputs = [
      article({
        articleId: "3",
        slug: "antiga",
        translationPublishedAtIso: "2026-07-01T00:00:00.000Z",
      }),
      article({
        articleId: "1",
        slug: "empate-a",
        translationPublishedAtIso: "2026-07-20T00:00:00.000Z",
      }),
      article({
        articleId: "2",
        slug: "empate-b",
        translationPublishedAtIso: "2026-07-20T00:00:00.000Z",
      }),
    ];
    const first = buildHomeEditorialHighlights(inputs, NOW);
    const second = buildHomeEditorialHighlights([...inputs].reverse(), NOW);
    expect(first.movies.map((c) => c.slug)).toEqual(["empate-a", "empate-b", "antiga"]);
    // Mesma entrada em outra ordem produz a MESMA saída (sem aleatoriedade).
    expect(second.movies.map((c) => c.slug)).toEqual(first.movies.map((c) => c.slug));
  });

  it("usa a data do ARTIGO quando a tradução não tem a sua", () => {
    const out = buildHomeEditorialHighlights(
      [
        article({
          articleId: "120",
          translationPublishedAtIso: null,
          articlePublishedAtIso: "2026-07-10T00:00:00.000Z",
        }),
      ],
      NOW,
    );
    expect(out.movies[0]?.publishedAtIso).toBe("2026-07-10T00:00:00.000Z");
  });

  it("respeita o limite por vertical", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      article({
        articleId: String(200 + i),
        slug: `materia-${i}`,
        translationPublishedAtIso: `2026-07-${String(10 + i).padStart(2, "0")}T00:00:00.000Z`,
      }),
    );
    expect(buildHomeEditorialHighlights(many, NOW).movies).toHaveLength(
      HOME_EDITORIAL_LOADER_LIMIT,
    );
    expect(buildHomeEditorialHighlights(many, NOW, 3).movies).toHaveLength(3);
  });
});

describe("home editorial — deduplicação contra outra seção da página", () => {
  const base = buildHomeEditorialHighlights(
    [
      article({ articleId: "300", slug: "repetida", linkedEntityTypes: ["movie", "tv"] }),
      article({ articleId: "301", slug: "so-nos-destaques", linkedEntityTypes: ["movie"] }),
    ],
    NOW,
  );

  it("remove das DUAS verticais a matéria que já aparece na outra seção", () => {
    const out = excludeEditorialHighlights(
      base,
      new Set(["/pt/noticias/repetida/"]),
    );
    expect(out.movies.map((c) => c.slug)).toEqual(["so-nos-destaques"]);
    expect(out.series).toHaveLength(0);
  });

  it("sem interseção, nada muda (mesma referência, zero cópia)", () => {
    expect(excludeEditorialHighlights(base, new Set())).toBe(base);
    const semColisao = excludeEditorialHighlights(
      base,
      new Set(["/pt/noticias/outra-materia/"]),
    );
    expect(semColisao.movies).toHaveLength(2);
    expect(semColisao.series).toHaveLength(1);
  });

  it("esvaziar as duas verticais é resultado válido — a seção some, honesta", () => {
    const out = excludeEditorialHighlights(
      base,
      new Set(["/pt/noticias/repetida/", "/pt/noticias/so-nos-destaques/"]),
    );
    expect(hasEditorialHighlights(out)).toBe(false);
  });
});
