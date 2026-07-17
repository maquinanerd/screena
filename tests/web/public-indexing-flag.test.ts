/**
 * Flag global de indexacao — parser, precedencia e kill switch.
 *
 * INCIDENTE DE PRODUCAO (2026-07-16): `CINERIE_PUBLIC_INDEXING_ENABLED=false` e o
 * HTML publico seguia emitindo `<meta name="robots" content="index, follow">`.
 *
 * Duas causas independentes, ambas cobertas aqui:
 *  1. NENHUMA pagina consultava a flag — `isOfficialIndexableEnvironment()` so
 *     era usada por `app/robots.ts`. O `<meta robots>` saia direto da decisao da
 *     entidade, que nao conhece env. Cobertura: os testes de `publicRobots`/
 *     `gatePublicRobots` + `tests/governance/no-raw-robots-metadata.test.ts`.
 *  2. O parser era `flag !== "1"`, entao `=true` era lido como DESLIGADO.
 *     Cobertura: a tabela de `parseBooleanEnvFlag`.
 *
 * Fail-closed e a regra: na duvida, nao indexa.
 */

import { describe, expect, it } from "vitest";

import { buildRobots } from "../../apps/web/app/robots";
import {
  gatePublicRobots,
  isOfficialIndexableEnvironment,
  isPublicIndexingEnabled,
  parseBooleanEnvFlag,
  publicRobots,
  type SiteUrlEnv,
} from "../../apps/web/src/lib/site";

const OFFICIAL: SiteUrlEnv = {
  CINERIE_PUBLIC_SITE_URL: "https://cinerie.com",
  NODE_ENV: "production",
};

/** Ambiente oficial + flag no valor dado. */
function withFlag(value: string | undefined): SiteUrlEnv {
  return value === undefined
    ? OFFICIAL
    : { ...OFFICIAL, CINERIE_PUBLIC_INDEXING_ENABLED: value };
}

describe("parseBooleanEnvFlag — parser booleano explicito", () => {
  it("aceita apenas 'true' e '1' como verdadeiro", () => {
    expect(parseBooleanEnvFlag("true")).toBe(true);
    expect(parseBooleanEnvFlag("1")).toBe(true);
  });

  it("trata 'false' e '0' como falso", () => {
    expect(parseBooleanEnvFlag("false")).toBe(false);
    expect(parseBooleanEnvFlag("0")).toBe(false);
  });

  it("trata vazio e ausente como falso (default obrigatorio)", () => {
    expect(parseBooleanEnvFlag("")).toBe(false);
    expect(parseBooleanEnvFlag("   ")).toBe(false);
    expect(parseBooleanEnvFlag(undefined)).toBe(false);
  });

  it("trata QUALQUER valor invalido como falso (fail-closed)", () => {
    for (const invalid of ["yes", "on", "sim", "TRUE!", "2", "-1", "null", "undefined", "enabled"]) {
      expect(parseBooleanEnvFlag(invalid), `"${invalid}" nao pode ligar indexacao`).toBe(false);
    }
  });

  it("normaliza caixa e espaco em volta", () => {
    for (const truthy of ["TRUE", "True", " true ", " 1 "]) {
      expect(parseBooleanEnvFlag(truthy), `"${truthy}" deveria ligar`).toBe(true);
    }
    expect(parseBooleanEnvFlag(" FALSE ")).toBe(false);
  });

  it("REGRESSAO: 'true' ligava? antes o codigo exigia === '1' e lia 'true' como desligado", () => {
    expect(parseBooleanEnvFlag("true")).toBe(true);
  });
});

describe("isPublicIndexingEnabled — precedencia CINERIE > legado > false", () => {
  it("1. CINERIE definida decide sozinha, mesmo com o legado ligado", () => {
    expect(
      isPublicIndexingEnabled({
        CINERIE_PUBLIC_INDEXING_ENABLED: "false",
        THE_SCREEN_PUBLIC_INDEXING_ENABLED: "1",
      }),
    ).toBe(false);
    expect(
      isPublicIndexingEnabled({
        CINERIE_PUBLIC_INDEXING_ENABLED: "true",
        THE_SCREEN_PUBLIC_INDEXING_ENABLED: "0",
      }),
    ).toBe(true);
  });

  it("1b. CINERIE definida-porem-VAZIA resolve false e NAO cai no legado", () => {
    // O Dockerfile assa THE_SCREEN_PUBLIC_INDEXING_ENABLED=1 na imagem. Cair no
    // legado aqui ligaria a indexacao contra quem setou explicitamente o nome novo.
    expect(
      isPublicIndexingEnabled({
        CINERIE_PUBLIC_INDEXING_ENABLED: "",
        THE_SCREEN_PUBLIC_INDEXING_ENABLED: "1",
      }),
    ).toBe(false);
  });

  it("2. sem CINERIE, o legado vale (fallback temporario)", () => {
    expect(isPublicIndexingEnabled({ THE_SCREEN_PUBLIC_INDEXING_ENABLED: "1" })).toBe(true);
    expect(isPublicIndexingEnabled({ THE_SCREEN_PUBLIC_INDEXING_ENABLED: "false" })).toBe(false);
  });

  it("3. sem nenhuma das duas, o default e false", () => {
    expect(isPublicIndexingEnabled({})).toBe(false);
  });
});

describe("publicRobots — kill switch global sobre o <meta robots>", () => {
  it("PROVA DO INCIDENTE: com a flag em 'false', pagina indexavel emite noindex,nofollow", () => {
    const robots = publicRobots(true, withFlag("false"));
    expect(robots).toEqual({ index: false, follow: false });
  });

  it("com a flag em '0', pagina indexavel emite noindex,nofollow", () => {
    expect(publicRobots(true, withFlag("0"))).toEqual({ index: false, follow: false });
  });

  it("com a flag AUSENTE, pagina indexavel emite noindex,nofollow (default false)", () => {
    expect(publicRobots(true, withFlag(undefined))).toEqual({ index: false, follow: false });
  });

  it("com a flag INVALIDA, pagina indexavel emite noindex,nofollow", () => {
    expect(publicRobots(true, withFlag("yes"))).toEqual({ index: false, follow: false });
  });

  it("com a flag ligada ('true' e '1'), a decisao da entidade passa a valer", () => {
    for (const on of ["true", "1"]) {
      expect(publicRobots(true, withFlag(on)), `flag=${on}`).toEqual({ index: true, follow: true });
    }
  });

  it("a flag global NUNCA torna indexavel uma entidade que decidiu noindex", () => {
    expect(publicRobots(false, withFlag("true"))).toEqual({ index: false, follow: false });
    expect(publicRobots(false, withFlag("1"))).toEqual({ index: false, follow: false });
  });

  it("flag ligada mas origem NAO oficial => noindex (staging/preview nao indexa)", () => {
    expect(
      publicRobots(true, {
        CINERIE_PUBLIC_SITE_URL: "https://staging.cinerie.com",
        CINERIE_PUBLIC_INDEXING_ENABLED: "true",
        NODE_ENV: "production",
      }),
    ).toEqual({ index: false, follow: false });
  });

  it("flag ligada mas NODE_ENV nao-producao => noindex", () => {
    expect(
      publicRobots(true, { ...OFFICIAL, CINERIE_PUBLIC_INDEXING_ENABLED: "true", NODE_ENV: "development" }),
    ).toEqual({ index: false, follow: false });
  });

  it("legado assado na imagem NAO reabre a indexacao quando CINERIE desliga", () => {
    // Cenario EXATO de producao: Dockerfile assa THE_SCREEN_PUBLIC_INDEXING_ENABLED=1
    // na imagem e o operador seta CINERIE_PUBLIC_INDEXING_ENABLED=false.
    expect(
      publicRobots(true, {
        ...OFFICIAL,
        CINERIE_PUBLIC_INDEXING_ENABLED: "false",
        THE_SCREEN_PUBLIC_INDEXING_ENABLED: "1",
      }),
    ).toEqual({ index: false, follow: false });
  });
});

describe("gatePublicRobots — mesmo gate para paginas de detalhe (seo.robots)", () => {
  it("com a flag desligada, colapsa QUALQUER robots para noindex,nofollow", () => {
    for (const robots of [
      { index: true, follow: true },
      { index: false, follow: true },
      { index: false, follow: false },
    ]) {
      expect(gatePublicRobots(robots, withFlag("false"))).toEqual({ index: false, follow: false });
    }
  });

  it("com a flag ligada, preserva a decisao — inclusive noindex,follow", () => {
    expect(gatePublicRobots({ index: true, follow: true }, withFlag("1"))).toEqual({
      index: true,
      follow: true,
    });
    // `resolvePageSeo` emite noindex,follow para entidade sem decisao vigente:
    // a nuance nao pode ser perdida quando o ambiente pode indexar.
    expect(gatePublicRobots({ index: false, follow: true }, withFlag("1"))).toEqual({
      index: false,
      follow: true,
    });
  });
});

describe("robots.txt e <meta robots> nunca discordam (mesmo gate)", () => {
  it("flag desligada: robots.txt manda Disallow / e nao anuncia sitemap", () => {
    const robots = buildRobots(withFlag("false"));
    expect(robots.rules).toEqual([{ userAgent: "*", disallow: "/" }]);
    expect(robots.sitemap).toBeUndefined();
  });

  it("flag desligada: robots.txt bloqueia E o meta e noindex — coerentes", () => {
    const env = withFlag("false");
    const txt = buildRobots(env);
    const meta = publicRobots(true, env);
    expect(txt.rules).toEqual([{ userAgent: "*", disallow: "/" }]);
    expect(meta).toEqual({ index: false, follow: false });
  });

  it("flag ligada: robots.txt libera E o meta segue a entidade — coerentes", () => {
    const env = withFlag("true");
    const txt = buildRobots(env);
    expect(txt.sitemap).toBe("https://cinerie.com/sitemap.xml");
    expect(publicRobots(true, env)).toEqual({ index: true, follow: true });
    expect(publicRobots(false, env)).toEqual({ index: false, follow: false });
  });

  it("REGRESSAO: robots.txt aceita 'true', nao so '1'", () => {
    // Antes exigia === "1": um operador que escrevesse =true derrubava o crawl
    // inteiro sem entender o motivo.
    expect(buildRobots(withFlag("true")).sitemap).toBe("https://cinerie.com/sitemap.xml");
  });

  it("isOfficialIndexableEnvironment concorda com isPublicIndexingEnabled quando o resto e oficial", () => {
    expect(isOfficialIndexableEnvironment(withFlag("true"))).toBe(true);
    expect(isOfficialIndexableEnvironment(withFlag("false"))).toBe(false);
  });
});
