/**
 * Testes do robots.txt publico (apps/web/app/robots.ts — funcao PURA).
 *
 * Garantem: sitemap no dominio canonico; crawl publico liberado; bloqueio
 * apenas de rotas tecnicas (/api/, /dev/, /admin/); nada de /_next/ bloqueado
 * (assets necessarios ao render/indexacao); zero mencao ao dominio legado
 * screena.media e zero "The Screen" como marca.
 */

import { describe, expect, it } from "vitest";

import robots from "../../apps/web/app/robots";

describe("robots.ts", () => {
  const result = robots();

  it("aponta o sitemap para https://thescreen.media/sitemap.xml", () => {
    expect(result.sitemap).toBe("https://thescreen.media/sitemap.xml");
  });

  it("nao usa o dominio legado screena.media nem a marca 'The Screen'", () => {
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/screena\.media/i);
    expect(serialized).not.toContain("The Screen");
  });

  it("permite crawl publico geral (allow /) para todos os user-agents", () => {
    const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
    expect(rules.length).toBeGreaterThan(0);
    const general = rules.find((rule) => rule?.userAgent === "*");
    expect(general).toBeDefined();
    expect(general?.allow).toBe("/");
  });

  it("bloqueia apenas rotas tecnicas: /api/, /dev/ e /admin/", () => {
    const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
    const general = rules.find((rule) => rule?.userAgent === "*");
    expect(general?.disallow).toEqual(["/api/", "/dev/", "/admin/"]);
  });

  it("nao bloqueia assets do Next (/_next/)", () => {
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("/_next");
  });
});
