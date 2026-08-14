/**
 * popular-rankings.test.ts — As abas de "Popular essa semana".
 *
 * O que este arquivo trava: o CONJUNTO de abas por vertical (a página de uma
 * vertical nunca oferece a aba da outra), a ausência definitiva de "Bilheteria"
 * e "Clássicas", a resolução do `?ranking=` (inclusive param forjado) e a
 * numeração 1..N por aba.
 */

import { describe, expect, it } from "vitest";

import {
  POPULAR_RANKING_LIMIT,
  RANKING_TABS,
  rankTitles,
  rankedTitleAccessibleName,
  resolveActiveRankingSlug,
  type RankedTitleInput,
} from "../popular-rankings";

const labelsOf = (vertical: "home" | "movies" | "series"): string[] =>
  RANKING_TABS[vertical].map((tab) => tab.label);

describe("conjuntos de abas por vertical", () => {
  it("(1) /pt/filmes tem EXATAMENTE Em cartaz · Streaming · Clássicos", () => {
    expect(labelsOf("movies")).toEqual(["Em cartaz", "Streaming", "Clássicos"]);
  });

  it("(2) /pt/series tem EXATAMENTE No ar · Streaming · Novas temporadas", () => {
    expect(labelsOf("series")).toEqual(["No ar", "Streaming", "Novas temporadas"]);
  });

  it("(3) a home é a UNIÃO: Filmes · Séries · Streaming · Cinema", () => {
    expect(labelsOf("home")).toEqual(["Filmes", "Séries", "Streaming", "Cinema"]);
  });

  /**
   * O defeito que a seção tinha: `/pt/filmes` oferecia a aba "Séries". A regra
   * é sobre o CONJUNTO, não sobre um rótulo — por isso a asserção é de
   * ausência total da outra vertical, não de um label específico.
   */
  it("(4) NEGATIVO: página de vertical nunca oferece a aba da outra", () => {
    expect(labelsOf("movies")).not.toContain("Séries");
    expect(labelsOf("movies")).not.toContain("Novas temporadas");
    expect(labelsOf("movies")).not.toContain("No ar");
    expect(labelsOf("series")).not.toContain("Filmes");
    expect(labelsOf("series")).not.toContain("Em cartaz");
    expect(labelsOf("series")).not.toContain("Clássicos");
  });

  it('(5) NEGATIVO: "Bilheteria" e "Clássicas" não existem em vertical nenhuma', () => {
    const everything = JSON.stringify(RANKING_TABS);
    expect(everything).not.toContain("Bilheteria");
    expect(everything).not.toContain("Clássicas");
    expect(everything).not.toContain("bilheteria");
    expect(everything).not.toContain("classicas");
  });

  it("(6) cada aba tem destino próprio de 'Ver tudo' (o botão segue o recorte)", () => {
    for (const vertical of ["home", "movies", "series"] as const) {
      for (const tab of RANKING_TABS[vertical]) {
        expect(tab.seeAllHref, `${vertical}/${tab.slug} sem destino`).toMatch(/^\/pt\/.+\/$/);
      }
      // Numa vertical, o "Ver tudo" não pode ser o MESMO link em todas as abas —
      // isso seria o link fixo que a seção tinha antes.
      const destinations = new Set(RANKING_TABS[vertical].map((tab) => tab.seeAllHref));
      expect(destinations.size).toBeGreaterThan(1);
    }
  });
});

describe("aba ativa a partir do ?ranking=", () => {
  it("(7) sem param, cai na primeira aba da vertical", () => {
    expect(resolveActiveRankingSlug("movies", undefined)).toBe("em-cartaz");
    expect(resolveActiveRankingSlug("series", undefined)).toBe("no-ar");
    expect(resolveActiveRankingSlug("home", null)).toBe("filmes");
  });

  it("(8) param válido da vertical é respeitado (link compartilhável)", () => {
    expect(resolveActiveRankingSlug("movies", "classicos")).toBe("classicos");
    expect(resolveActiveRankingSlug("series", "novas-temporadas")).toBe("novas-temporadas");
    expect(resolveActiveRankingSlug("home", "cinema")).toBe("cinema");
  });

  /**
   * NEGATIVO: um param de OUTRA vertical não pode abrir aquele recorte aqui —
   * `/pt/filmes?ranking=novas-temporadas` não é uma página de séries disfarçada.
   */
  it("(9) NEGATIVO: param de outra vertical (ou forjado) cai no default", () => {
    expect(resolveActiveRankingSlug("movies", "novas-temporadas")).toBe("em-cartaz");
    expect(resolveActiveRankingSlug("series", "classicos")).toBe("no-ar");
    expect(resolveActiveRankingSlug("movies", "../../etc/passwd")).toBe("em-cartaz");
    expect(resolveActiveRankingSlug("series", ["em-cartaz", "no-ar"])).toBe("no-ar");
  });
});

describe("numeração do ranking", () => {
  const input = (id: string, title: string | null, href: string | null): RankedTitleInput => ({
    id,
    title,
    href,
    posterUrl: null,
  });

  it("(10) numera 1..N DENTRO da aba, sem buraco quando um candidato é descartado", () => {
    const ranked = rankTitles([
      input("movie:1", "Primeiro", "/pt/filmes/primeiro/"),
      // Sem href: entraria como link quebrado. Descartado — e sem deixar buraco.
      input("movie:2", "Sem rota", null),
      input("movie:3", "Segundo", "/pt/filmes/segundo/"),
      input("movie:4", null, "/pt/filmes/sem-titulo/"),
      input("movie:5", "Terceiro", "/pt/filmes/terceiro/"),
    ]);

    expect(ranked.map((item) => item.rank)).toEqual([1, 2, 3]);
    expect(ranked.map((item) => item.title)).toEqual(["Primeiro", "Segundo", "Terceiro"]);
  });

  it("(11) a mesma entidade nunca ocupa duas posições da mesma aba", () => {
    const ranked = rankTitles([
      input("tv:7", "Série", "/pt/series/serie/"),
      input("tv:7", "Série", "/pt/series/serie/"),
    ]);
    expect(ranked).toHaveLength(1);
  });

  it("(12) o teto é o da aba, e o rank nunca passa dele", () => {
    const many = Array.from({ length: POPULAR_RANKING_LIMIT + 5 }, (_unused, index) =>
      input(`movie:${index}`, `Título ${index}`, `/pt/filmes/t-${index}/`),
    );
    const ranked = rankTitles(many);
    expect(ranked).toHaveLength(POPULAR_RANKING_LIMIT);
    expect(ranked[ranked.length - 1]?.rank).toBe(POPULAR_RANKING_LIMIT);
  });

  /**
   * O card é pôster + número, sem texto visível: a posição é INFORMAÇÃO e tem
   * de estar no nome acessível, ou o leitor de tela ouve só o título solto.
   */
  it("(13) o nome acessível carrega a posição", () => {
    const [first] = rankTitles([input("movie:1", "Duna: Parte Dois", "/pt/filmes/duna-2/")]);
    expect(first).toBeDefined();
    expect(rankedTitleAccessibleName(first as NonNullable<typeof first>)).toBe(
      "1. Duna: Parte Dois",
    );
  });
});
