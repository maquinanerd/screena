/**
 * Campos de schema.org a partir do que a pagina mostra.
 *
 * O que se trava: nada e completado — entrada vazia vira campo ausente; pessoa
 * sem pagina nao ganha link; e a duracao sai no formato ISO 8601.
 */

import { describe, expect, it } from "vitest";

import { schemaImageUrls, schemaPeople, toIsoDuration } from "./schema-fields.js";

const SITE = "https://cinerie.com";

describe("imagens", () => {
  it("(1) absolutas, na ordem recebida, sem repeticao e sem vazio", () => {
    expect(
      schemaImageUrls(
        [
          "https://image.tmdb.org/t/p/w500/p.jpg",
          null,
          undefined,
          "  ",
          "/media/tmdb/b.jpg",
          "https://image.tmdb.org/t/p/w500/p.jpg",
        ],
        SITE,
      ),
    ).toEqual(["https://image.tmdb.org/t/p/w500/p.jpg", "https://cinerie.com/media/tmdb/b.jpg"]);
  });

  it("(2) caminho relativo ou protocolo-relativo nao e adivinhado", () => {
    expect(schemaImageUrls(["media/x.jpg", "//cdn.exemplo/x.jpg"], SITE)).toEqual([]);
  });
});

describe("pessoas", () => {
  it("(3) com pagina ganha url absoluta; sem pagina, so o nome", () => {
    expect(
      schemaPeople(
        [
          { name: "Christopher Nolan", href: "/pt/pessoas/christopher-nolan/" },
          { name: "Emma Thomas", href: null },
        ],
        SITE,
      ),
    ).toEqual([
      { "@type": "Person", name: "Christopher Nolan", url: "https://cinerie.com/pt/pessoas/christopher-nolan/" },
      { "@type": "Person", name: "Emma Thomas" },
    ]);
  });

  it("(4) a mesma pagina entra uma vez; homonimos sem pagina nao se fundem; nome vazio sai", () => {
    expect(
      schemaPeople(
        [
          { name: "Ana", href: "/pt/pessoas/ana/" },
          { name: "Ana", href: "/pt/pessoas/ana/" },
          { name: "João Silva", href: null },
          { name: "João Silva", href: null },
          { name: "  ", href: null },
        ],
        SITE,
      ),
    ).toHaveLength(3);
  });

  it("(5) sem pessoa nenhuma, lista vazia — o chamador omite o campo", () => {
    expect(schemaPeople([], SITE)).toEqual([]);
  });
});

describe("duracao ISO 8601", () => {
  it.each([
    [148, "PT2H28M"],
    [120, "PT2H"],
    [45, "PT45M"],
    [61, "PT1H1M"],
  ] as const)("(6) %i minutos -> %s", (minutes, iso) => {
    expect(toIsoDuration(minutes)).toBe(iso);
  });

  it("(7) zero, negativo, fracao ou ausencia nao sao duracao", () => {
    for (const invalido of [0, -5, 90.5, Number.NaN, null, undefined]) {
      expect(toIsoDuration(invalido)).toBeNull();
    }
  });
});
