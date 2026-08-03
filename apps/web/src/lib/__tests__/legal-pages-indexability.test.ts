import { describe, expect, it } from "vitest";

import { PRIVACY_PATH, TERMS_PATH } from "../routes";
import { canonicalPublicUrl, publicRobots } from "../site";

/**
 * As paginas legais (/pt/termos, /pt/privacidade) sao publicas e indexaveis por
 * natureza — mas so quando o GATE GLOBAL permitir. Este teste prova as duas
 * pontas: que elas nao forcam indexacao por fora do gate (o incidente de
 * 2026-07-16) e que passam a indexar sozinhas quando o operador liga a flag na
 * origem oficial, sem precisar editar as paginas.
 */

const PRODUCAO_OFICIAL = {
  CINERIE_PUBLIC_INDEXING_ENABLED: "true",
  CINERIE_PUBLIC_SITE_URL: "https://cinerie.com",
  NODE_ENV: "production",
} as const;

describe("indexabilidade das paginas legais", () => {
  it("indexa quando a flag global esta ligada na origem oficial", () => {
    expect(publicRobots(true, PRODUCAO_OFICIAL)).toEqual({ index: true, follow: true });
  });

  it("NAO indexa com a flag desligada (estado atual de producao)", () => {
    expect(
      publicRobots(true, { ...PRODUCAO_OFICIAL, CINERIE_PUBLIC_INDEXING_ENABLED: "false" }),
    ).toEqual({ index: false, follow: false });
  });

  it("NAO indexa fora da origem oficial, mesmo com a flag ligada", () => {
    expect(
      publicRobots(true, { ...PRODUCAO_OFICIAL, CINERIE_PUBLIC_SITE_URL: "https://staging.exemplo.com" }),
    ).toEqual({ index: false, follow: false });
  });

  it("emite canonical absoluto e autorreferente para as duas rotas", () => {
    expect(canonicalPublicUrl(TERMS_PATH, "https://cinerie.com")).toBe(
      "https://cinerie.com/pt/termos/",
    );
    expect(canonicalPublicUrl(PRIVACY_PATH, "https://cinerie.com")).toBe(
      "https://cinerie.com/pt/privacidade/",
    );
  });
});
