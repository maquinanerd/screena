/**
 * Testes puros de `buildExternalLinks`: os links externos visiveis nas paginas
 * de detalhe sao exatamente o grafo `sameAs` do JSON-LD (mesma fonte,
 * `buildSameAs`), rotulados por fonte canonica. Fonte invalida/desconhecida e
 * omitida; sem IDs validos -> `[]` (o chamador omite a secao).
 */

import { describe, expect, it } from "vitest";

import { buildExternalLinks } from "../../apps/web/src/lib/external-links";

describe("buildExternalLinks", () => {
  it("rotula IMDb / TMDb / Wikidata na ordem estavel do sameAs", () => {
    const links = buildExternalLinks(
      [
        { source: "tmdb", externalId: "550" },
        { source: "imdb", externalId: "tt0137523" },
        { source: "wikidata", externalId: "Q190050" },
      ],
      "movie",
    );
    expect(links).toEqual([
      { label: "IMDb", href: "https://www.imdb.com/title/tt0137523/" },
      { label: "TMDb", href: "https://www.themoviedb.org/movie/550" },
      { label: "Wikidata", href: "https://www.wikidata.org/wiki/Q190050" },
    ]);
  });

  it("usa o caminho de pessoa para IMDb (nm#) e TMDb", () => {
    const links = buildExternalLinks(
      [
        { source: "imdb", externalId: "nm0000138" },
        { source: "tmdb", externalId: "287" },
      ],
      "person",
    );
    expect(links).toEqual([
      { label: "IMDb", href: "https://www.imdb.com/name/nm0000138/" },
      { label: "TMDb", href: "https://www.themoviedb.org/person/287" },
    ]);
  });

  it("ignora IDs malformados e fontes desconhecidas; sem validos -> []", () => {
    expect(
      buildExternalLinks(
        [
          { source: "imdb", externalId: "550" }, // formato de titulo invalido
          { source: "rapidapi", externalId: "x" }, // fonte nao canonica
        ],
        "movie",
      ),
    ).toEqual([]);
    expect(buildExternalLinks([], "tv")).toEqual([]);
  });
});
