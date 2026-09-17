/**
 * app-icons.test.ts — o favicon e os icones do app existem e sao o que dizem ser.
 *
 * O DEFEITO (auditoria de SEO, 11/09/2026): `/favicon.ico` respondia 404 com 23 KB
 * de HTML em toda visita, e nao havia `<link rel="icon">`.
 *
 * Os tres arquivos vivem em `apps/web/app/`, onde o Next os serve e declara no
 * `<head>` sozinho: `favicon.ico` em `/favicon.ico`, `icon.png` como
 * `<link rel="icon">` e `apple-icon.png` como `apple-touch-icon`.
 *
 * A ARTE e o "c" da marca-mae (`cinerie-logo.png`), recortado sem redesenho e
 * centralizado sobre o fundo do site (decisao do dono D6: reaproveitar, ou
 * derivar da marca). O teste confere os bytes do CABECALHO — formato e dimensoes
 * —, do mesmo jeito que `brand-logos.test.ts` confere as marcas.
 */

import { closeSync, openSync, readSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "app");

/** Os primeiros `size` bytes do arquivo — so o cabecalho, nunca o conteudo inteiro. */
function headerBytes(file: string, size: number): Buffer {
  const fd = openSync(path.join(APP_DIR, file), "r");
  try {
    const buf = Buffer.alloc(size);
    readSync(fd, buf, 0, size, 0);
    return buf;
  } finally {
    closeSync(fd);
  }
}

function pngSize(file: string): { width: number; height: number } {
  const buf = headerBytes(file, 32);
  expect(buf.subarray(1, 4).toString("latin1"), `${file} e PNG`).toBe("PNG");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("icones do app", () => {
  it("(1) icon.png e um PNG quadrado de 512 px", () => {
    expect(pngSize("icon.png")).toEqual({ width: 512, height: 512 });
  });

  it("(2) apple-icon.png e um PNG de 180 px, o tamanho do apple-touch-icon", () => {
    expect(pngSize("apple-icon.png")).toEqual({ width: 180, height: 180 });
  });

  it("(3) favicon.ico e um ICO de verdade com 16, 32 e 48 px", () => {
    const buf = headerBytes("favicon.ico", 6 + 16 * 8);
    // ICONDIR: reservado 0, tipo 1 (icone), quantidade de imagens.
    expect(buf.readUInt16LE(0)).toBe(0);
    expect(buf.readUInt16LE(2)).toBe(1);
    const count = buf.readUInt16LE(4);
    expect(count).toBeGreaterThanOrEqual(3);
    expect(count).toBeLessThanOrEqual(8);
    // Cada ICONDIRENTRY tem 16 bytes; o primeiro byte e a largura (0 = 256).
    const widths = Array.from({ length: count }, (_unused, i) => buf.readUInt8(6 + 16 * i) || 256);
    expect(widths).toEqual(expect.arrayContaining([16, 32, 48]));
  });
});
