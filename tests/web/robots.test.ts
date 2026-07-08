/**
 * Testes do robots.txt publico (apps/web/app/robots.ts - funcao PURA).
 *
 * Garantem: producao oficial libera crawl e sitemap canonico; preview/dev/staging
 * bloqueiam tudo e nunca anunciam sitemap de localhost, preview ou dominio legado.
 */

import { describe, expect, it } from "vitest";

import { buildRobots } from "../../apps/web/app/robots";
import { OFFICIAL_SITE_URL, type SiteUrlEnv } from "../../apps/web/src/lib/site";

function rulesFor(result: ReturnType<typeof buildRobots>) {
  return Array.isArray(result.rules) ? result.rules : [result.rules];
}

function generalRule(result: ReturnType<typeof buildRobots>) {
  return rulesFor(result).find((rule) => rule?.userAgent === "*");
}

const OFFICIAL_PRODUCTION_ENV: SiteUrlEnv = {
  THE_SCREEN_PUBLIC_SITE_URL: OFFICIAL_SITE_URL,
  THE_SCREEN_PUBLIC_INDEXING_ENABLED: "1",
  NODE_ENV: "production",
};

describe("robots.ts - producao oficial", () => {
  const result = buildRobots(OFFICIAL_PRODUCTION_ENV);

  it("aponta o sitemap para a origem oficial canônica", () => {
    expect(result.sitemap).toBe(`${OFFICIAL_SITE_URL}/sitemap.xml`);
    const sitemap = new URL(String(result.sitemap));
    expect(sitemap.origin).toBe(OFFICIAL_SITE_URL);
    expect(sitemap.pathname).toBe("/sitemap.xml");
  });

  it("nao usa o dominio legado screena.media nem a marca 'The Screen'", () => {
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/screena\.media/i);
    expect(serialized).not.toContain("The Screen");
  });

  it("permite crawl publico geral (allow /) para todos os user-agents", () => {
    const general = generalRule(result);
    expect(general).toBeDefined();
    expect(general?.allow).toBe("/");
  });

  it("bloqueia apenas rotas tecnicas: /api/, /dev/ e /admin/", () => {
    expect(generalRule(result)?.disallow).toEqual(["/api/", "/dev/", "/admin/"]);
  });

  it("nao bloqueia assets do Next (/_next/)", () => {
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("/_next");
  });
});

describe("robots.ts - ambientes nao oficiais", () => {
  const blockedCases: Array<[string, SiteUrlEnv]> = [
    [
      "localhost",
      {
        THE_SCREEN_PUBLIC_SITE_URL: "http://localhost:3000",
        THE_SCREEN_PUBLIC_INDEXING_ENABLED: "1",
        NODE_ENV: "development",
      },
    ],
    [
      "staging",
      {
        THE_SCREEN_PUBLIC_SITE_URL: "https://screen-staging.example.com",
        THE_SCREEN_PUBLIC_INDEXING_ENABLED: "1",
        NODE_ENV: "production",
      },
    ],
    [
      "host oficial sem opt-in de indexacao",
      {
        THE_SCREEN_PUBLIC_SITE_URL: OFFICIAL_SITE_URL,
        NODE_ENV: "production",
      },
    ],
    [
      "host oficial com opt-in desligado",
      {
        THE_SCREEN_PUBLIC_SITE_URL: OFFICIAL_SITE_URL,
        THE_SCREEN_PUBLIC_INDEXING_ENABLED: "0",
        NODE_ENV: "production",
      },
    ],
    [
      "preview Vercel mesmo com origem oficial por engano",
      {
        THE_SCREEN_PUBLIC_SITE_URL: OFFICIAL_SITE_URL,
        THE_SCREEN_PUBLIC_INDEXING_ENABLED: "1",
        NODE_ENV: "production",
        VERCEL_ENV: "preview",
      },
    ],
    [
      "sem env explicita",
      {
        NODE_ENV: "production",
      },
    ],
  ];

  for (const [label, env] of blockedCases) {
    it(`bloqueia indexacao em ${label}`, () => {
      const result = buildRobots(env);
      expect(generalRule(result)?.disallow).toBe("/");
      expect(result.sitemap).toBeUndefined();

      const serialized = JSON.stringify(result);
      expect(serialized).not.toMatch(/localhost|screen-staging|screena\.media/i);
      expect(serialized).not.toContain("/sitemap.xml");
    });
  }
});
