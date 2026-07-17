/**
 * Governanca: nenhuma pagina publica pode montar `index: true` na mao.
 *
 * INCIDENTE DE PRODUCAO (2026-07-16): cada pagina montava o proprio
 * `robots: shouldIndex ? { index: true, follow: true } : ...` a partir SO da
 * decisao da entidade. A flag global `CINERIE_PUBLIC_INDEXING_ENABLED` era lida
 * apenas por `app/robots.ts`, entao desliga-la nao tinha efeito nenhum sobre o
 * `<meta robots>`: 12 pontos de emissao e nenhum deles olhava a env.
 *
 * O fix concentrou a decisao em `publicRobots`/`gatePublicRobots`
 * (apps/web/src/lib/site.ts). Este teste impede que o buraco volte: uma pagina
 * nova que monte `{ index: true }` na mao passa a burlar o kill switch em
 * silencio — e o CI nao teria como perceber, ja que o valor "certo" e o mesmo em
 * dev. Por isso a trava e sintatica, no arquivo.
 *
 * `{ index: false, follow: false }` literal e PERMITIDO: e fail-closed (404,
 * pagina de busca, preview de dev) e nao pode indexar nada por acidente.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const appDir = path.join(repoRoot, "apps", "web", "app");
const siteLib = path.join(repoRoot, "apps", "web", "src", "lib", "site.ts");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
      continue;
    }
    if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Remove comentarios de bloco e de linha para nao acusar prosa/exemplo. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const pageFiles = walk(appDir);

describe("governanca: o kill switch de indexacao nao pode ser burlado por pagina", () => {
  it("ha paginas para auditar (o walk nao ficou vazio por engano)", () => {
    expect(pageFiles.length).toBeGreaterThan(10);
  });

  it("nenhum arquivo de apps/web/app monta `index: true` na mao", () => {
    const offenders: string[] = [];
    for (const file of pageFiles) {
      const code = stripComments(readFileSync(file, "utf-8"));
      if (/index\s*:\s*true/.test(code)) offenders.push(path.relative(repoRoot, file));
    }
    expect(
      offenders,
      `estes arquivos emitem index:true sem passar por publicRobots/gatePublicRobots, ` +
        `burlando CINERIE_PUBLIC_INDEXING_ENABLED: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("toda pagina que define `robots:` de forma nao-literal usa o helper do site", () => {
    const offenders: string[] = [];
    for (const file of pageFiles) {
      const code = stripComments(readFileSync(file, "utf-8"));
      const assignments = [...code.matchAll(/robots:\s*([^,\n]+)/g)].map((m) => (m[1] ?? "").trim());
      for (const value of assignments) {
        // Permitido: noindex literal (fail-closed) e os dois helpers.
        if (value.startsWith("{ index: false")) continue;
        if (value.startsWith("publicRobots(") || value.startsWith("gatePublicRobots(")) continue;
        offenders.push(`${path.relative(repoRoot, file)} -> robots: ${value}`);
      }
    }
    expect(
      offenders,
      `robots: precisa ser noindex literal ou vir de publicRobots/gatePublicRobots: ${offenders.join(" | ")}`,
    ).toEqual([]);
  });

  it("o unico lugar que decide index:true e o helper em src/lib/site.ts", () => {
    const site = stripComments(readFileSync(siteLib, "utf-8"));
    expect(site).toContain("export function publicRobots");
    expect(site).toContain("export function gatePublicRobots");
    // Ambos passam pelo mesmo gate de ambiente — e o que mantem robots.txt,
    // <meta robots> e sitemap coerentes por construcao.
    const publicRobotsBody = site.slice(site.indexOf("export function publicRobots"));
    expect(publicRobotsBody).toContain("isOfficialIndexableEnvironment");
  });

  it("robots.txt e dinamico: a flag vale em runtime, sem exigir rebuild", () => {
    // Era rota Static: o valor da flag ficava assado em .next no `next build`.
    const robotsRoute = readFileSync(path.join(appDir, "robots.ts"), "utf-8");
    expect(robotsRoute).toMatch(/export const dynamic\s*=\s*["']force-dynamic["']/);
  });
});
