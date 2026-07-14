import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Governanca SEO entity-first (PROMPT 2): trava por varredura de fonte que
 *  - a home tem exatamente um H1 institucional estável; o título visual do
 *    carousel não muda a entidade principal durante o autoplay;
 *  - a home emite Organization + WebSite, sem SearchAction (nao ha busca real)
 *    nem AggregateRating;
 *  - as fichas (filme/serie/pessoa) emitem @id + mainEntityOfPage + sameAs REAL
 *    e nunca AggregateRating.
 */

const ROOT = process.cwd();
const HOME_REL = "apps/web/app/pt/page.tsx";
const HERO_REL = "apps/web/app/_components/hero-carousel.tsx";
const ENTITY_PAGES: ReadonlyArray<[string, string]> = [
  ["movie", "apps/web/app/pt/filmes/[slug]/page.tsx"],
  ["tv", "apps/web/app/pt/series/[slug]/page.tsx"],
  ["person", "apps/web/app/pt/pessoas/[slug]/page.tsx"],
];

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

/** Remove comentarios de bloco/linha (preserva URLs com "://"). */
function withoutComments(source: string): string {
  const noBlocks = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return noBlocks
    .split(/\r?\n/)
    .map((line) => {
      for (let i = 0; i < line.length - 1; i += 1) {
        if (line[i] === "/" && line[i + 1] === "/") {
          if (i > 0 && line[i - 1] === ":") continue;
          return line.slice(0, i);
        }
      }
      return line;
    })
    .join("\n");
}

function countMatches(source: string, re: RegExp): number {
  const matches = source.match(re);
  return matches === null ? 0 : matches.length;
}

describe("governanca SEO: home entity-first + grafo de identidade", () => {
  it("home mantém um único H1 institucional estável com ou sem hero", () => {
    const code = withoutComments(read(HOME_REL));
    expect(countMatches(code, /<h1[\s>]/g)).toBe(1);
    expect(read(HOME_REL)).toContain("Screen — filmes, séries e pessoas");
    expect(code).toMatch(/<h1[\s\S]*?HOME_H1[\s\S]*?heroSlides\.length > 0/);
  });

  it("hero usa H2 no título visual ativo e parágrafo nos inativos", () => {
    const code = withoutComments(read(HERO_REL));
    expect(countMatches(code, /<h1[\s>]/g)).toBe(0);
    expect(code).toMatch(/<h2 className=\{titleClassName\}>/);
    expect(code).toMatch(/<p className=\{titleClassName\}>/);
  });

  it("home emite Organization + WebSite, sem SearchAction nem AggregateRating", () => {
    const raw = read(HOME_REL);
    expect(raw).toContain('"@type": "Organization"');
    expect(raw).toContain('"@type": "WebSite"');

    const code = withoutComments(raw);
    // Sem rota de busca por query real -> nunca prometer SearchAction.
    expect(code).not.toMatch(/SearchAction/);
    // Screen nao publica nota propria agregada.
    expect(code).not.toMatch(/AggregateRating/);
  });

  it("fichas emitem @id + mainEntityOfPage + sameAs real, e nunca AggregateRating", () => {
    for (const [kind, rel] of ENTITY_PAGES) {
      const code = withoutComments(read(rel));
      expect(code, `${kind}: @id autorreferente`).toContain('"@id": canonicalUrl');
      expect(code, `${kind}: mainEntityOfPage`).toContain(
        "mainEntityOfPage: canonicalUrl",
      );
      // sameAs vem de IDs externos REAIS (buildSameAs), com guarda de tamanho:
      // sem ID nenhum, o campo e omitido do JSON-LD.
      expect(code, `${kind}: buildSameAs`).toMatch(/buildSameAs\(externalIds,/);
      expect(code, `${kind}: guarda sameAs`).toMatch(/if \(sameAs\.length > 0\)/);
      // Ratings externos nao estao licenciados/ativos -> nunca AggregateRating.
      expect(code, `${kind}: sem AggregateRating`).not.toMatch(/AggregateRating/);
    }
  });
});
