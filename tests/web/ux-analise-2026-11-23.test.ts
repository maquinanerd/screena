/**
 * ux-analise-2026-11-23.test.ts — as funcoes puras que a analise de UX de
 * 23/11/2026 criou. Cada caso nasce de um defeito MEDIDO em producao:
 *
 *  - "Conhecido por" com o mesmo poster duas vezes (ator + produtor do mesmo
 *    filme) e a filmografia com duas linhas iguais        -> mergeCreditsByTitle
 *  - "Self" em ingles na filmografia                        -> castCharacterLabel
 *  - busca dizendo "Filme · 2026 · 2026"                     -> formatSearchResultMeta
 *  - "Popular essa semana" abrindo na aba vazia             -> initialRankingSlug
 *  - "Onde assistir" fora da primeira dobra da ficha        -> watchShortcutLabel
 *  - categoria "news" em ingles e minuscula                 -> newsCategoryLabel
 */

import { describe, expect, it } from "vitest";

import { newsCategoryLabel } from "../../apps/web/src/lib/news-presenter";
import {
  castCharacterLabel,
  mergeCreditsByTitle,
  type PersonCredit,
} from "../../apps/web/src/lib/person-presenter";
import { initialRankingSlug } from "../../apps/web/src/lib/popular-rankings";
import { formatSearchResultMeta } from "../../apps/web/src/lib/search-presenter";
import { watchShortcutLabel, type WatchBrandRowItem } from "../../apps/web/src/lib/watch-brands-row";

function credit(overrides: Partial<PersonCredit> = {}): PersonCredit {
  return {
    entityType: "movie",
    title: "Dinheiro Suspeito",
    href: "/pt/filmes/dinheiro-suspeito/",
    year: 2026,
    roleLabel: "Lieutenant Dane Dumars",
    posterUrl: "https://image.tmdb.org/t/p/w300/a.jpg",
    ...overrides,
  };
}

describe("mergeCreditsByTitle — um titulo, uma linha", () => {
  it("junta os papeis do mesmo titulo na posicao da primeira ocorrencia", () => {
    const merged = mergeCreditsByTitle([
      credit({ href: "/pt/filmes/a-odisseia/", title: "A Odisseia", roleLabel: "Odysseus" }),
      credit(),
      credit({ roleLabel: "Produção" }),
      credit({ href: "/pt/filmes/sobrevivencia/", title: "Sobrevivência", roleLabel: "Produção" }),
    ]);
    expect(merged.map((c) => c.title)).toEqual(["A Odisseia", "Dinheiro Suspeito", "Sobrevivência"]);
    expect(merged[1]?.roleLabel).toBe("Lieutenant Dane Dumars · Produção");
  });

  it("nao repete papel igual e nao inventa papel quando nenhum veio", () => {
    expect(mergeCreditsByTitle([credit({ roleLabel: "Produção" }), credit({ roleLabel: "Produção" })])[0]?.roleLabel).toBe(
      "Produção",
    );
    expect(mergeCreditsByTitle([credit({ roleLabel: null }), credit({ roleLabel: null })])[0]?.roleLabel).toBeNull();
  });

  it("aproveita poster e ano da segunda ocorrencia quando a primeira nao tinha", () => {
    const [only] = mergeCreditsByTitle([
      credit({ posterUrl: null, year: null }),
      credit({ roleLabel: "Produção", year: 2025 }),
    ]);
    expect(only?.posterUrl).not.toBeNull();
    expect(only?.year).toBe(2025);
  });

  it("filme e serie com o mesmo titulo NAO se juntam (href diferente)", () => {
    const merged = mergeCreditsByTitle([
      credit({ href: "/pt/filmes/x/", entityType: "movie" }),
      credit({ href: "/pt/series/x/", entityType: "tv" }),
    ]);
    expect(merged).toHaveLength(2);
  });

  it("nao altera a lista de entrada (countHiddenCredits subtrai o tamanho dela)", () => {
    const input = [credit(), credit({ roleLabel: "Produção" })];
    mergeCreditsByTitle(input);
    expect(input).toHaveLength(2);
    expect(input[0]?.roleLabel).toBe("Lieutenant Dane Dumars");
  });
});

describe("castCharacterLabel — o papel de elenco para exibicao", () => {
  it("Self/Himself/Herself viram texto pt-BR neutro", () => {
    for (const raw of ["Self", "self", "Himself", "Herself", " Self "]) {
      expect(castCharacterLabel(raw)).toBe("Participação como si");
    }
  });
  it("nome de personagem passa intacto, inclusive 'Self - \"Odysseus\"'", () => {
    expect(castCharacterLabel("Odysseus")).toBe("Odysseus");
    expect(castCharacterLabel('Self - "Odysseus"')).toBe('Self - "Odysseus"');
    expect(castCharacterLabel("  ")).toBeNull();
    expect(castCharacterLabel(null)).toBeNull();
  });
});

describe("formatSearchResultMeta — a linha de meta do resultado, sem repeticao", () => {
  it("'Filme · 2026' + ano 2026 vira so '2026' (o tipo ja esta no badge)", () => {
    expect(formatSearchResultMeta({ kind: "movie", subtitle: "Filme · 2026", year: 2026 })).toBe("2026");
    expect(formatSearchResultMeta({ kind: "tv", subtitle: "Serie · 1997", year: 1997 })).toBe("1997");
    expect(formatSearchResultMeta({ kind: "tv", subtitle: "Série · 1997", year: 1997 })).toBe("1997");
  });
  it("preserva o que o cartao nao mostra e poe o ano uma vez so, no fim", () => {
    expect(formatSearchResultMeta({ kind: "person", subtitle: "Atuação", year: null })).toBe("Atuação");
    expect(formatSearchResultMeta({ kind: "movie", subtitle: "2026 · Drama", year: 2026 })).toBe("Drama · 2026");
    expect(formatSearchResultMeta({ kind: "movie", subtitle: null, year: 2001 })).toBe("2001");
    expect(formatSearchResultMeta({ kind: "movie", subtitle: null, year: null })).toBe("");
  });
});

describe("initialRankingSlug — a aba da primeira pintura", () => {
  const panel = (slug: string, n: number) => ({ tab: { slug }, items: Array.from({ length: n }) });

  it("aba default vazia cede para a primeira aba CHEIA", () => {
    expect(
      initialRankingSlug("movies", [panel("em-cartaz", 0), panel("streaming", 10), panel("classicos", 10)] as never),
    ).toBe("streaming");
  });
  it("aba default cheia continua sendo a default", () => {
    expect(initialRankingSlug("movies", [panel("em-cartaz", 3), panel("streaming", 10)] as never)).toBe("em-cartaz");
  });
  it("tudo vazio: fica a default (a mensagem de vazio continua honesta)", () => {
    expect(initialRankingSlug("movies", [panel("em-cartaz", 0), panel("streaming", 0)] as never)).toBe("em-cartaz");
  });
});

describe("watchShortcutLabel — o atalho 'Onde assistir' do topo da ficha", () => {
  const brand = (name: string): WatchBrandRowItem =>
    ({ key: name, name, logo: null, modalities: ["Assinatura"], destinationUrl: "https://x", destinationKind: "provider" }) as never;

  it("nomeia ate duas marcas e conta o resto", () => {
    expect(watchShortcutLabel([brand("Claro tv+")])).toBe("Claro tv+");
    expect(watchShortcutLabel([brand("Claro tv+"), brand("Amazon Video")])).toBe("Claro tv+ e Amazon Video");
    expect(watchShortcutLabel([brand("Claro tv+"), brand("Amazon Video"), brand("Apple TV Store")])).toBe(
      "Claro tv+, Amazon Video e mais 1",
    );
  });
  it("sem marca, nada (a tira fala a ausencia com a propria voz)", () => {
    expect(watchShortcutLabel([])).toBeNull();
    expect(watchShortcutLabel([brand("  ")])).toBeNull();
  });
});

describe("newsCategoryLabel — categoria de noticia em pt-BR, so na exibicao", () => {
  it("tipos do CMS em ingles viram pt-BR; categoria editorial passa intacta", () => {
    expect(newsCategoryLabel("news")).toBe("Notícia");
    expect(newsCategoryLabel("News")).toBe("Notícia");
    expect(newsCategoryLabel("review")).toBe("Crítica");
    expect(newsCategoryLabel("Marvel")).toBe("Marvel");
    expect(newsCategoryLabel(null)).toBeNull();
    expect(newsCategoryLabel(" ")).toBeNull();
  });
});
