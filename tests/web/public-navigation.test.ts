/**
 * Testes de navegacao publica (Fase 5D): header sem link morto, logo local
 * com alt="Screen", e home/explorar/sitemap/robots presentes e seguros.
 *
 * Estilo hibrido (como tests/governance): importa os dados puros exportados
 * (NAV_ITEMS/HOME_HREF) e verifica no filesystem que cada rota do header tem
 * page.tsx real — o header NUNCA aponta para rota inexistente. Checagens de
 * fonte garantem: paginas dinamicas (build sem banco), canonical presente e
 * ausencia de busca/ratings/streaming fake nos portais.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { HOME_HREF, NAV_ITEMS } from "../../apps/web/src/lib/navigation";

const WEB_APP_DIR = path.join(process.cwd(), "apps", "web", "app");

/** /pt/filmes/ -> apps/web/app/pt/filmes/page.tsx (todas as rotas publicas). */
function pageFileForPublicPath(publicPath: string): string {
  const segments = publicPath.split("/").filter((part) => part !== "");
  return path.join(WEB_APP_DIR, ...segments, "page.tsx");
}

function readSource(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

/**
 * Remove comentarios de bloco/linha (docblocks, comentarios JSX e notas inline) para as checagens
 * de conteudo: os comentarios de governanca CITAM os termos proibidos ("sem
 * busca", "sem ratings") de proposito — o que interessa e o codigo/markup.
 */
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

describe("header — navegacao global", () => {
  it("contem links para home, filmes, series, pessoas, noticias e explorar", () => {
    const hrefs = NAV_ITEMS.map((item) => item.href);
    expect(HOME_HREF).toBe("/pt/");
    expect(hrefs).toContain("/pt/filmes/");
    expect(hrefs).toContain("/pt/series/");
    expect(hrefs).toContain("/pt/pessoas/");
    expect(hrefs).toContain("/pt/noticias/");
    expect(hrefs).toContain("/pt/explorar/");
  });

  it("nenhum link morto: toda rota do header tem page.tsx real", () => {
    for (const href of [HOME_HREF, ...NAV_ITEMS.map((item) => item.href)]) {
      const pageFile = pageFileForPublicPath(href);
      expect(existsSync(pageFile), `rota ${href} sem ${pageFile}`).toBe(true);
    }
  });

  it("todo link e interno pt-BR com barra final", () => {
    for (const href of [HOME_HREF, ...NAV_ITEMS.map((item) => item.href)]) {
      expect(href).toMatch(/^\/pt\/(?:[a-z-]+\/)?$/);
    }
  });

  it("logo local com alt='Screen' e sem asset remoto", () => {
    const source = readSource("apps/web/app/_components/site-header.tsx");
    expect(source).toContain('alt="Screen"');
    expect(source).toContain("/brand/screen-logo-black.svg");
    expect(source).toContain("/brand/screen-logo-white.svg");
    expect(source).not.toMatch(/src="https?:\/\//);
  });
});

describe("home /pt/ — pagina real e segura", () => {
  const source = readSource("apps/web/app/pt/page.tsx");

  it("existe e e dinamica (build roda sem banco)", () => {
    expect(source).toContain('dynamic = "force-dynamic"');
  });

  it("tem metadata com canonical e decisao de robots", () => {
    expect(source).toContain("alternates: { canonical:");
    expect(source).toContain('indexability.decision === "index"');
  });

  it("nao tem busca fake nem features inexistentes", () => {
    const code = withoutComments(source);
    expect(code).not.toContain("<input");
    expect(code).not.toContain("<form");
    expect(code).not.toMatch(/onde assistir/i);
    expect(code).not.toMatch(/tomatometer|imdb|popcorn/i);
    expect(code).not.toMatch(/mais populares|top rated|ranking/i);
  });

  it("linka apenas rotas publicas existentes", () => {
    const hrefMatches = source.match(/href=\{([A-Z_]+)\}/g) ?? [];
    expect(hrefMatches.length).toBeGreaterThan(0);
    // Todos os hrefs vem de constantes de rota do site.ts (nunca string solta
    // para rota inexistente).
    for (const match of hrefMatches) {
      expect(match).toMatch(
        /href=\{(MOVIES_INDEX_PATH|SERIES_INDEX_PATH|PEOPLE_INDEX_PATH|NEWS_INDEX_PATH|EXPLORE_PATH|HOME_PATH)\}/,
      );
    }
  });
});

describe("explorar /pt/explorar/ — hub sem busca fake", () => {
  const source = readSource("apps/web/app/pt/explorar/page.tsx");

  it("existe e e dinamica (build roda sem banco)", () => {
    expect(source).toContain('dynamic = "force-dynamic"');
  });

  it("tem metadata com canonical e decisao de robots", () => {
    expect(source).toContain("alternates: { canonical:");
    expect(source).toContain('indexability.decision === "index"');
  });

  it("nao ha busca fake, filtros fake, ranking ou populares", () => {
    const code = withoutComments(source);
    expect(code).not.toContain("<input");
    expect(code).not.toContain("<form");
    expect(code).not.toContain("autosuggest");
    expect(code).not.toMatch(/mais populares|top rated|ranking|trending/i);
    expect(code).not.toMatch(/tomatometer|imdb|popcorn/i);
    expect(code).not.toMatch(/onde assistir/i);
  });

  it("schema seguro: CollectionPage + BreadcrumbList (padrao existente)", () => {
    expect(source).toContain('"@type": "CollectionPage"');
    expect(source).toContain('"@type": "BreadcrumbList"');
    expect(source).not.toContain("AggregateRating");
  });
});

describe("sitemap e robots — arquivos do app", () => {
  it("app/sitemap.ts existe, e dinamico e usa a camada server-only", () => {
    const source = readSource("apps/web/app/sitemap.ts");
    expect(source).toContain('dynamic = "force-dynamic"');
    expect(source).toContain("src/server/seo/sitemap-entries");
    // O arquivo de rota NUNCA importa o banco diretamente.
    expect(source).not.toContain("@screena/db");
  });

  it("app/robots.ts existe e e puro (sem banco, sem rede)", () => {
    const source = readSource("apps/web/app/robots.ts");
    expect(source).not.toContain("@screena/db");
    expect(source).not.toContain("fetch(");
  });
});
