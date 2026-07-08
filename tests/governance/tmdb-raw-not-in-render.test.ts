/**
 * Teste de governanca (P0-00a) — o payload BRUTO do TMDB nunca acopla ao render.
 *
 * As tabelas do raw sync (`tmdb_raw`, `tmdb_image_config` / modelos `TmdbRaw`,
 * `TmdbImageConfig`) sao WORKER-ONLY, como `api_cache`: existem para a ingestao
 * offline, e o render publico NAO as le. A pagina publica sempre serve modelos
 * NORMALIZADOS/LOCALIZADOS (movies/tv_shows/people + entity_translations +
 * content_blocks), nunca o JSON cru do provider.
 *
 * Esta guarda varre a arvore REAL de apps/web (o app publico) e falha se
 * qualquer arquivo referenciar os identificadores do raw sync — inclusive os
 * acessores do Prisma Client (`prisma.tmdbRaw`, `prisma.tmdbImageConfig`).
 * Complementa `no-render-external-api` e `web-render-layering` (invariantes 3/4).
 */

import { readdirSync, readFileSync, type Dirent } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const WEB_DIR = path.join(ROOT, "apps", "web");
const CODE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const IGNORED_DIRS = new Set(["node_modules", ".next", "dist", "build", "coverage"]);

/** Identificadores das tabelas/modelos de raw sync que NAO podem aparecer no render. */
const RAW_TMDB_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/\bTmdbRaw\b/, "TmdbRaw (modelo)"],
  [/\btmdb_raw\b/, "tmdb_raw (tabela)"],
  [/\btmdbRaw\b/, "prisma.tmdbRaw (acessor)"],
  [/\bTmdbImageConfig\b/, "TmdbImageConfig (modelo)"],
  [/\btmdb_image_config\b/, "tmdb_image_config (tabela)"],
  [/\btmdbImageConfig\b/, "prisma.tmdbImageConfig (acessor)"],
];

/** Remove comentarios (bloco + linha, exceto `://`) para nao dar falso-positivo. */
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

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // apps/web ausente (Fase 0) → varredura vazia, teste passa.
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      out.push(...collectFiles(full));
    } else if (CODE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

function findRawViolations(source: string): string[] {
  const code = withoutComments(source);
  return RAW_TMDB_PATTERNS.filter(([pattern]) => pattern.test(code)).map(([, label]) => label);
}

describe("governanca: raw TMDB nunca acopla ao render (P0-00a)", () => {
  it("detecta um acesso ao raw no render (fixture positiva)", () => {
    const code = `const rows = await prisma.tmdbRaw.findMany({ where: { entityType: "movie" } });`;
    expect(findRawViolations(code)).toContain("prisma.tmdbRaw (acessor)");
  });

  it("permite leitura de modelo normalizado (fixture negativa)", () => {
    const code = `const movie = await prisma.movie.findUnique({ where: { id } });`;
    expect(findRawViolations(code)).toEqual([]);
  });

  it("nao confunde buildTmdbImageUrl com a tabela tmdb_image_config", () => {
    const code = `import { buildTmdbImageUrl } from "../lib/tmdb-image-url";`;
    expect(findRawViolations(code)).toEqual([]);
  });

  it("nenhum arquivo de apps/web referencia tmdb_raw / tmdb_image_config", () => {
    const offenders: string[] = [];
    for (const file of collectFiles(WEB_DIR)) {
      const violations = findRawViolations(readFileSync(file, "utf8"));
      if (violations.length > 0) {
        offenders.push(`${path.relative(ROOT, file).split(path.sep).join("/")}: ${violations.join(", ")}`);
      }
    }
    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
  });
});
