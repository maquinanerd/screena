/**
 * A identidade unica da organizacao e do site.
 *
 * O que se trava: um `@id` estavel por no, independente de barra final na origem,
 * e a mesma URL publica (a home canonica) para quem a pedir.
 */

import { describe, expect, it } from "vitest";

import { organizationId, publicHomeUrl, PUBLIC_HOME_PATH, websiteId } from "./site-identity.js";

describe("identidade do site", () => {
  it("(1) um @id por no, com fragmento — identificador, nao endereco", () => {
    expect(organizationId("https://cinerie.com")).toBe("https://cinerie.com/#organization");
    expect(websiteId("https://cinerie.com")).toBe("https://cinerie.com/#website");
  });

  it("(2) barra final ou espaco na origem nao mudam a identidade", () => {
    expect(organizationId(" https://cinerie.com/ ")).toBe(organizationId("https://cinerie.com"));
    expect(websiteId("https://cinerie.com//")).toBe(websiteId("https://cinerie.com"));
  });

  it("(3) a URL publica e a home canonica, a mesma para Organization, WebSite e publisher", () => {
    expect(PUBLIC_HOME_PATH).toBe("/pt/");
    expect(publicHomeUrl("https://cinerie.com/")).toBe("https://cinerie.com/pt/");
  });
});
