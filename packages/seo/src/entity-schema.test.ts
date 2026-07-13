import { describe, expect, it } from "vitest";

import { buildSameAs } from "./entity-schema.js";

describe("buildSameAs", () => {
  it("monta URLs canonicas de filme a partir de IMDb e TMDB reais", () => {
    const out = buildSameAs(
      [
        { source: "tmdb", externalId: "550" },
        { source: "imdb", externalId: "tt0137523" },
      ],
      "movie",
    );
    // Ordem estavel (IMDb antes de TMDB), independente da ordem de entrada.
    expect(out).toEqual([
      "https://www.imdb.com/title/tt0137523/",
      "https://www.themoviedb.org/movie/550",
    ]);
  });

  it("usa o caminho /tv para series", () => {
    const out = buildSameAs([{ source: "tmdb", externalId: "1396" }], "tv");
    expect(out).toEqual(["https://www.themoviedb.org/tv/1396"]);
  });

  it("usa /name (IMDb) e /person (TMDB) para pessoas", () => {
    const out = buildSameAs(
      [
        { source: "imdb", externalId: "nm0000151" },
        { source: "tmdb", externalId: "287" },
      ],
      "person",
    );
    expect(out).toEqual([
      "https://www.imdb.com/name/nm0000151/",
      "https://www.themoviedb.org/person/287",
    ]);
  });

  it("inclui Wikidata SOMENTE quando o ID existe e tem forma Q#", () => {
    expect(buildSameAs([{ source: "wikidata", externalId: "Q42" }], "movie")).toEqual([
      "https://www.wikidata.org/wiki/Q42",
    ]);
    // Nunca inventa Wikidata: ID malformado e descartado.
    expect(buildSameAs([{ source: "wikidata", externalId: "42" }], "movie")).toEqual([]);
  });

  it("descarta IDs com formato invalido para a fonte", () => {
    // IMDb de titulo (`tt#`) nao vale como pessoa (que exige `nm#`), e vice-versa.
    expect(buildSameAs([{ source: "imdb", externalId: "tt0137523" }], "person")).toEqual(
      [],
    );
    expect(buildSameAs([{ source: "imdb", externalId: "nm0000151" }], "movie")).toEqual(
      [],
    );
    // TMDB nao-numerico e descartado.
    expect(buildSameAs([{ source: "tmdb", externalId: "abc" }], "movie")).toEqual([]);
  });

  it("ignora fontes desconhecidas (nunca emite URL arbitraria em sameAs)", () => {
    expect(
      buildSameAs(
        [
          { source: "letterboxd", externalId: "fight-club" },
          { source: "facebook", externalId: "something" },
        ],
        "movie",
      ),
    ).toEqual([]);
  });

  it("retorna [] quando nao ha nenhum ID externo (sameAs e entao omitido)", () => {
    expect(buildSameAs([], "movie")).toEqual([]);
  });

  it("normaliza fonte (case/space) e deduplica por fonte", () => {
    const out = buildSameAs(
      [
        { source: " IMDb ", externalId: "tt0137523" },
        { source: "imdb", externalId: "tt9999999" },
      ],
      "movie",
    );
    // Primeira ocorrencia valida de cada fonte vence; sem duplicar.
    expect(out).toEqual(["https://www.imdb.com/title/tt0137523/"]);
  });
});
