/**
 * Testes puros dos mapeadores de campos factuais de catalogo (situacao de
 * producao e idioma original) da ficha tecnica das paginas de detalhe.
 *
 * Garantem que: (1) so rotulamos valores de enumeracao conhecidos do TMDB; (2)
 * o genero gramatical segue a vertical (filme m / serie f); (3) valor ausente
 * ou desconhecido vira `null` (a ficha omite a linha, nunca vaza o cru).
 */

import { describe, expect, it } from "vitest";

import {
  mapEntityStatus,
  mapOriginalLanguage,
} from "../../apps/web/src/lib/entity-status";

describe("mapEntityStatus", () => {
  it("rotula situacoes de FILME em pt-BR (masculino)", () => {
    expect(mapEntityStatus("Released", "movie")).toBe("Lançado");
    expect(mapEntityStatus("Post Production", "movie")).toBe("Pós-produção");
    expect(mapEntityStatus("In Production", "movie")).toBe("Em produção");
    expect(mapEntityStatus("Planned", "movie")).toBe("Anunciado");
    expect(mapEntityStatus("Canceled", "movie")).toBe("Cancelado");
  });

  it("rotula situacoes de SERIE em pt-BR (feminino)", () => {
    expect(mapEntityStatus("Returning Series", "tv")).toBe("Em exibição");
    expect(mapEntityStatus("Ended", "tv")).toBe("Finalizada");
    expect(mapEntityStatus("Canceled", "tv")).toBe("Cancelada");
    expect(mapEntityStatus("Planned", "tv")).toBe("Anunciada");
    expect(mapEntityStatus("Pilot", "tv")).toBe("Piloto");
  });

  it("nao vaza situacao de uma vertical na outra", () => {
    // "Ended"/"Returning Series" so existem em serie; "Released" so em filme.
    expect(mapEntityStatus("Ended", "movie")).toBeNull();
    expect(mapEntityStatus("Returning Series", "movie")).toBeNull();
    expect(mapEntityStatus("Released", "tv")).toBeNull();
  });

  it("ausente/desconhecido/vazio -> null (nunca cru em ingles)", () => {
    expect(mapEntityStatus(null, "movie")).toBeNull();
    expect(mapEntityStatus(undefined, "tv")).toBeNull();
    expect(mapEntityStatus("   ", "movie")).toBeNull();
    expect(mapEntityStatus("Rumored", "movie")).toBeNull(); // especulativo: omitido
    expect(mapEntityStatus("Whatever", "tv")).toBeNull();
  });
});

describe("mapOriginalLanguage", () => {
  it("rotula os idiomas comuns de catalogo em pt-BR", () => {
    expect(mapOriginalLanguage("en")).toBe("Inglês");
    expect(mapOriginalLanguage("pt")).toBe("Português");
    expect(mapOriginalLanguage("ja")).toBe("Japonês");
    expect(mapOriginalLanguage("ko")).toBe("Coreano");
  });

  it("normaliza caixa e espacos do codigo", () => {
    expect(mapOriginalLanguage("EN")).toBe("Inglês");
    expect(mapOriginalLanguage("  fr ")).toBe("Francês");
  });

  it("ausente/desconhecido -> null (nunca mostra o codigo cru)", () => {
    expect(mapOriginalLanguage(null)).toBeNull();
    expect(mapOriginalLanguage(undefined)).toBeNull();
    expect(mapOriginalLanguage("")).toBeNull();
    expect(mapOriginalLanguage("xx")).toBeNull();
  });
});
