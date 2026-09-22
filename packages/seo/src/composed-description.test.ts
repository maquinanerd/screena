/**
 * composed-description.test.ts — a descrição COMPOSTA da ficha de filme e série.
 *
 * O defeito (medido em produção, 22/09/2026): com sinopse, a descrição da ficha
 * era a sinopse do TMDB cortada em 160 caracteres — o mesmo snippet de todo
 * site que reusa o TMDB. O que se trava aqui: abertura factual curta, sinopse
 * depois, editorial vencendo sempre, e a descrição final nunca mais igual à
 * sinopse cortada.
 */

import { describe, expect, it } from "vitest";

import {
  DESCRIPTION_LEAD_MAX,
  composeCatalogDescriptionSource,
  movieDescriptionLead,
  seriesDescriptionLead,
} from "./factual-description.js";
import { META_DESCRIPTION_MAX, buildMetaDescription } from "./meta-description.js";

const SINOPSE_ORIGEM =
  "Dom Cobb é um ladrão com a rara habilidade de roubar segredos do inconsciente, obtidos durante o estado de sono. Impedido de retornar para sua família, ele recebe a oportunidade de se redimir.";

const ORIGEM = {
  year: 2010,
  genres: ["Ficção científica", "Ação"],
  directors: ["Christopher Nolan"],
  cast: ["Leonardo DiCaprio", "Joseph Gordon-Levitt", "Elliot Page"],
};

describe("abertura factual", () => {
  it("(1) filme: gênero, ano, direção e o elenco que couber no teto — sem o título", () => {
    const lead = movieDescriptionLead(ORIGEM);
    expect(lead).toBe(
      "Filme de ficção científica (2010), dirigido por Christopher Nolan, com Leonardo DiCaprio.",
    );
    expect((lead ?? "").length).toBeLessThanOrEqual(DESCRIPTION_LEAD_MAX);
  });

  it("(2) com espaço, entram os DOIS primeiros do elenco", () => {
    expect(movieDescriptionLead({ year: 1999, genres: ["Drama"], directors: [], cast: ["Ana", "Bia", "Caio"] })).toBe(
      "Filme de drama (1999), com Ana e Bia.",
    );
  });

  it("(3) série: gênero, período, temporadas e elenco", () => {
    expect(
      seriesDescriptionLead({
        periodLabel: "2008–2013",
        genres: ["Drama", "Crime"],
        seasonsCount: 5,
        cast: ["Bryan Cranston", "Aaron Paul"],
      }),
    ).toBe("Série de drama (2008–2013) em 5 temporadas, com Bryan Cranston e Aaron Paul.");
    expect(seriesDescriptionLead({ periodLabel: null, genres: [], seasonsCount: 1, cast: [] })).toBe(
      "Série em 1 temporada.",
    );
  });

  it("(4) sem nenhum fato não há abertura", () => {
    expect(movieDescriptionLead({ year: null, genres: [], directors: [], cast: [] })).toBeNull();
    expect(seriesDescriptionLead({ periodLabel: null, genres: [], seasonsCount: null, cast: [] })).toBeNull();
  });

  it("(5) a abertura NUNCA passa do teto, nem com nomes longos", () => {
    const longo = "Maximiliano Bartolomeu de Albuquerque Cavalcanti";
    const lead = movieDescriptionLead({ year: 2001, genres: ["Documentário"], directors: [longo], cast: [longo, longo] });
    expect((lead ?? "").length).toBeLessThanOrEqual(DESCRIPTION_LEAD_MAX);
  });
});

describe("composição", () => {
  it("(6) editorial própria vence, como está", () => {
    expect(
      composeCatalogDescriptionSource({ editorial: " Texto da redação. ", lead: "Filme (2010).", synopsis: SINOPSE_ORIGEM }),
    ).toBe("Texto da redação.");
  });

  it("(7) sem editorial: abertura + sinopse", () => {
    expect(composeCatalogDescriptionSource({ editorial: null, lead: "Filme (2010).", synopsis: "Uma sinopse." })).toBe(
      "Filme (2010). Uma sinopse.",
    );
  });

  it("(8) sem fato para a abertura: só a sinopse", () => {
    expect(composeCatalogDescriptionSource({ editorial: "  ", lead: null, synopsis: "Uma sinopse." })).toBe("Uma sinopse.");
  });

  it("(9) sem editorial e sem sinopse: null — a página cai na descrição factual completa", () => {
    expect(composeCatalogDescriptionSource({ editorial: null, lead: "Filme (2010).", synopsis: "   " })).toBeNull();
  });

  it("(10) REGRESSÃO: o snippet deixa de ser a sinopse do TMDB cortada", () => {
    const antes = buildMetaDescription(SINOPSE_ORIGEM);
    const depois = buildMetaDescription(
      composeCatalogDescriptionSource({ editorial: null, lead: movieDescriptionLead(ORIGEM), synopsis: SINOPSE_ORIGEM }),
    );
    expect(depois).not.toBe(antes);
    expect(depois?.startsWith("Filme de ficção científica (2010), dirigido por Christopher Nolan")).toBe(true);
    // E continua dentro do teto do buscador, com o começo da sinopse depois dos fatos.
    expect((depois ?? "").length).toBeLessThanOrEqual(META_DESCRIPTION_MAX);
    expect(depois).toContain("Dom Cobb é um ladrão");
  });
});
