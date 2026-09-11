/**
 * brand-logos.test.ts — A marca da Cinerie POR ÁREA, conferida contra os BYTES.
 *
 * O registro (`brand-logos.ts`) afirma três coisas que o navegador usa sem
 * conferir: o caminho do arquivo, as dimensões (viram `width`/`height` do
 * `<img>` e evitam salto de layout) e a altura da PALAVRA "cinérie" (a base da
 * escala entre áreas). Um registro que mente renderiza igual — o defeito é
 * silencioso. Aqui alguém confere, lendo o cabeçalho dos arquivos.
 */

import { closeSync, existsSync, openSync, readSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  brandAreaOf,
  brandLogoScale,
  CINERIE_AREA_LOGOS,
  CINERIE_ORGANIZATION_LOGO,
  CINERIE_SCORE_LOGO,
  CINERIE_WORD_HEIGHT,
  type BrandLogoFile,
} from "../brand-logos";

const PUBLIC_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "public",
);

function fileOf(file: BrandLogoFile): string {
  return path.join(PUBLIC_DIR, file.src.replace(/^\//, ""));
}

/** Formato e dimensões REAIS, do cabeçalho (PNG IHDR; WEBP VP8L/VP8X). */
function header(file: string): { format: "png" | "webp" | null; width: number; height: number } {
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(64);
    readSync(fd, buf, 0, 64, 0);
    if (buf[0] === 0x89 && buf.subarray(1, 4).toString("latin1") === "PNG") {
      return { format: "png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (
      buf.subarray(0, 4).toString("latin1") === "RIFF" &&
      buf.subarray(8, 12).toString("latin1") === "WEBP"
    ) {
      const chunk = buf.subarray(12, 16).toString("latin1");
      if (chunk === "VP8L") {
        const bits = buf.readUInt32LE(21);
        return { format: "webp", width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
      }
      if (chunk === "VP8X") {
        return {
          format: "webp",
          width: buf.readUIntLE(24, 3) + 1,
          height: buf.readUIntLE(27, 3) + 1,
        };
      }
    }
    return { format: null, width: 0, height: 0 };
  } finally {
    closeSync(fd);
  }
}

const TODOS: readonly [string, BrandLogoFile][] = [
  ...Object.values(CINERIE_AREA_LOGOS).flatMap(
    (logo): [string, BrandLogoFile][] => [
      [`${logo.area}/solid`, logo.solid],
      [`${logo.area}/inverse`, logo.inverse],
    ],
  ),
  ["score", CINERIE_SCORE_LOGO],
  ["organization", CINERIE_ORGANIZATION_LOGO],
];

describe("a área de cada rota", () => {
  it.each([
    ["/pt/", "neutral"],
    ["/pt", "neutral"],
    ["/pt/filmes/", "movie"],
    ["/pt/filmes/duna-parte-dois/", "movie"],
    ["/pt/series/", "series"],
    ["/pt/series/silo/temporadas/1/", "series"],
    ["/pt/noticias/", "news"],
    ["/pt/noticias/estreia-da-temporada/", "news"],
    ["/pt/pessoas/zendaya/", "neutral"],
    ["/pt/onde-assistir/", "neutral"],
    // Prefixo de SEGMENTO, nunca de string solta.
    ["/pt/filmesx/", "neutral"],
  ] as const)("%s -> %s", (pathname, area) => {
    expect(brandAreaOf(pathname)).toBe(area);
  });

  it("sem pathname cai na marca-mãe", () => {
    expect(brandAreaOf(null)).toBe("neutral");
  });
});

describe("os arquivos são o que o registro afirma", () => {
  it.each(TODOS)("%s: existe, e formato e dimensões batem com os bytes", (_nome, file) => {
    const arquivo = fileOf(file);
    expect(existsSync(arquivo), arquivo).toBe(true);
    const real = header(arquivo);
    expect(real.format).toBe(path.extname(file.src).slice(1));
    expect({ width: real.width, height: real.height }).toEqual({
      width: file.width,
      height: file.height,
    });
  });
});

describe("a palavra 'cinérie' tem o mesmo tamanho em toda área", () => {
  it("marca-mãe = altura da palavra; marcas de área = palavra + a barra", () => {
    expect(CINERIE_AREA_LOGOS.neutral.solid.height).toBe(CINERIE_WORD_HEIGHT);
    expect(brandLogoScale(CINERIE_AREA_LOGOS.neutral.solid)).toBe(1);
    for (const area of ["movie", "series", "news"] as const) {
      // 181 = 163 da palavra + 2 px da barra acima + 16 abaixo (medido nos arquivos).
      expect(CINERIE_AREA_LOGOS[area].solid.height).toBe(181);
      expect(brandLogoScale(CINERIE_AREA_LOGOS[area].solid)).toBeCloseTo(181 / 163, 3);
    }
  });

  it("as duas cores de uma área têm as mesmas dimensões (trocar não mexe no layout)", () => {
    for (const logo of Object.values(CINERIE_AREA_LOGOS)) {
      expect(logo.inverse.width).toBe(logo.solid.width);
      expect(logo.inverse.height).toBe(logo.solid.height);
    }
  });
});

describe("a marca da Organization (JSON-LD) serve ao buscador", () => {
  it("é PNG (raster) com pelo menos 112 px de altura — o mínimo do Google", () => {
    // O mesmo caminho que `packages/seo` usa no `publisher` das matérias —
    // `tests/seo/article-jsonld-attribution.test.ts` amarra o outro lado.
    expect(CINERIE_ORGANIZATION_LOGO.src).toBe("/brand/cinerie-logo.png");
    const real = header(fileOf(CINERIE_ORGANIZATION_LOGO));
    expect(real.format).toBe("png");
    expect(real.height).toBeGreaterThanOrEqual(112);
  });
});
