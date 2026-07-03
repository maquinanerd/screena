#!/usr/bin/env node
/**
 * generate-demo-media.mjs — Gera os POSTERS/BACKDROPS/RETRATOS de DEMO do slice
 * publico (Fase 9A), como PNGs de gradiente sob `apps/web/public/media/demo/`.
 *
 * FERRAMENTA DE DESENVOLVIMENTO, descartavel: nao roda no render nem entra no
 * bundle do Next. Nao chama rede, nao usa TMDB, nao baixa nada — os arquivos sao
 * gerados 100% localmente (gradientes proprios; zero direito de terceiros).
 *
 * Por que gradientes proprios: o render publico so aceita imagem LOCAL segura em
 * `/media/`, `/uploads/`, `/brand/` com extensao raster (avif/jpg/jpeg/png/webp).
 * Estes PNGs dao "poster grande / backdrop com gradiente funcional" ao demo sem
 * hotlink de CDN externa nem poster protegido por direito autoral.
 *
 * Encoder PNG minimo (truecolor RGB, 8-bit, filtro 0) com CRC32 proprio e
 * auto-verificacao (inflate de volta confere o tamanho) para nunca gravar um
 * arquivo invalido (que apareceria como imagem quebrada no navegador).
 *
 * Uso (a partir da raiz do monorepo):
 *   node apps/web/scripts/generate-demo-media.mjs
 *   # ou: pnpm --filter @screena/web gen:demo-media
 */

import { deflateSync, inflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* ---- Encoder PNG minimo ---- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** Monta as scanlines cruas (filtro 0 por linha) chamando `colorAt(x,y)`. */
function rawScanlines(width, height, colorAt) {
  const rowLength = 1 + width * 3;
  const raw = Buffer.alloc(rowLength * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * rowLength;
    raw[rowOffset] = 0; // filtro: none
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = colorAt(x, y);
      const p = rowOffset + 1 + x * 3;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
    }
  }
  return raw;
}

function encodePng(width, height, colorAt) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const raw = rawScanlines(width, height, colorAt);
  const idat = deflateSync(raw, { level: 9 });

  // Auto-verificacao: reinfla e confere o tamanho; nunca grava PNG invalido.
  const roundTrip = inflateSync(idat);
  if (roundTrip.length !== raw.length) {
    throw new Error("PNG self-check falhou: inflate(idat) diverge das scanlines.");
  }

  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---- Gradientes ---- */

function hexToRgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

/** Gradiente diagonal (leve no eixo x, forte no eixo y): visual cinematografico. */
function diagonalGradient(topHex, bottomHex, width, height) {
  const top = hexToRgb(topHex);
  const bottom = hexToRgb(bottomHex);
  const wDen = Math.max(1, width - 1);
  const hDen = Math.max(1, height - 1);
  return (x, y) => {
    const t = Math.min(1, Math.max(0, (x / wDen) * 0.32 + (y / hDen) * 0.68));
    return [
      lerp(top[0], bottom[0], t),
      lerp(top[1], bottom[1], t),
      lerp(top[2], bottom[2], t),
    ];
  };
}

/* ---- Manifesto (deve casar com public-demo-seed-plan.ts) ---- */

const POSTER = { width: 240, height: 360 };
const BACKDROP = { width: 480, height: 270 };
const PROFILE = { width: 240, height: 360 };

/** Cada asset: arquivo + dimensao + par de cores do gradiente. */
const ASSETS = [
  // Filmes (acento cinematografico quente/frio distinto por titulo).
  { file: "movie-farol-poster.png", ...POSTER, from: "#3a2a5a", to: "#0b0713" },
  { file: "movie-farol-backdrop.png", ...BACKDROP, from: "#2c2140", to: "#080610" },
  { file: "movie-cidade-vidro-poster.png", ...POSTER, from: "#123a44", to: "#05100f" },
  { file: "movie-cidade-vidro-backdrop.png", ...BACKDROP, from: "#0e2e37", to: "#04100e" },
  { file: "movie-fronteira-poster.png", ...POSTER, from: "#5a2a1e", to: "#140806" },
  { file: "movie-fronteira-backdrop.png", ...BACKDROP, from: "#41221a", to: "#0f0705" },
  // Series (tonalidades proprias, ainda cinematograficas).
  { file: "tv-correntes-poster.png", ...POSTER, from: "#123a2e", to: "#05110c" },
  { file: "tv-correntes-backdrop.png", ...BACKDROP, from: "#0f2f26", to: "#04100b" },
  { file: "tv-herdeiros-poster.png", ...POSTER, from: "#2a2140", to: "#0a0712" },
  { file: "tv-herdeiros-backdrop.png", ...BACKDROP, from: "#221a33", to: "#08060e" },
  { file: "tv-estacao-poster.png", ...POSTER, from: "#3a3320", to: "#100e07" },
  { file: "tv-estacao-backdrop.png", ...BACKDROP, from: "#2f2a1a", to: "#0d0b06" },
  // Retratos de pessoas (neutro quente).
  { file: "person-helena-profile.png", ...PROFILE, from: "#4a423a", to: "#161310" },
  { file: "person-rui-profile.png", ...PROFILE, from: "#3d423f", to: "#111413" },
  { file: "person-marina-profile.png", ...PROFILE, from: "#463a3a", to: "#151010" },
];

function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url)); // apps/web/scripts
  const outDir = path.resolve(scriptDir, "..", "public", "media", "demo");
  mkdirSync(outDir, { recursive: true });

  for (const asset of ASSETS) {
    const png = encodePng(
      asset.width,
      asset.height,
      diagonalGradient(asset.from, asset.to, asset.width, asset.height),
    );
    const outPath = path.join(outDir, asset.file);
    writeFileSync(outPath, png);
    console.log(`  ${asset.file}  (${asset.width}x${asset.height}, ${png.length} bytes)`);
  }

  console.log(`\nGerados ${ASSETS.length} assets de demo em public/media/demo/.`);
}

main();
