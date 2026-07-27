/**
 * Testes da validacao de upload (C8).
 *
 * O ponto central: arquivos COMPACTADOS sao recusados. Nao ler ZIP elimina
 * zip-bomb, path traversal e aninhamento de uma vez — estes testes provam que a
 * recusa realmente acontece, para que a mitigacao nao seja so uma afirmacao do
 * comentario.
 */

import { describe, expect, it } from "vitest";
import {
  IMPORT_MAX_FILE_BYTES,
  sanitizeFileName,
  validateAndDecodeUpload,
} from "../upload.js";

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("validateAndDecodeUpload", () => {
  it("(1) aceita CSV UTF-8 e devolve o texto", () => {
    const r = validateAndDecodeUpload(utf8("title\nAlien"));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("title\nAlien");
  });

  it("(2) preserva acentuacao e caracteres internacionais", () => {
    const r = validateAndDecodeUpload(utf8("title\nAmélie,千と千尋"));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toContain("Amélie");
  });

  it("(3) RECUSA ZIP (assinatura PK), com mensagem acionavel", () => {
    // Este e o caso real: o export do Letterboxd vem em .zip.
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00]);
    const r = validateAndDecodeUpload(zip);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain("CSV");
    expect(r.error.details?.join(" ")).toContain("ZIP");
  });

  it("(4) RECUSA gzip, rar, 7z e pdf", () => {
    const casos: readonly [string, readonly number[]][] = [
      ["gzip", [0x1f, 0x8b, 0x08]],
      ["rar", [0x52, 0x61, 0x72, 0x21]],
      ["7z", [0x37, 0x7a, 0xbc, 0xaf]],
      ["pdf", [0x25, 0x50, 0x44, 0x46]],
    ];
    for (const [nome, bytes] of casos) {
      const r = validateAndDecodeUpload(new Uint8Array([...bytes, 0x00, 0x01]));
      expect(r.ok, nome).toBe(false);
    }
  });

  it("(5) RECUSA arquivo vazio e arquivo acima do teto", () => {
    expect(validateAndDecodeUpload(new Uint8Array(0)).ok).toBe(false);
    const grande = new Uint8Array(IMPORT_MAX_FILE_BYTES + 1).fill(0x41);
    expect(validateAndDecodeUpload(grande).ok).toBe(false);
  });

  it("(6) RECUSA bytes que nao sao UTF-8 valido (ex.: Latin-1)", () => {
    // 0xE9 solto e "é" em Latin-1 e sequencia invalida em UTF-8. Recusar e
    // melhor do que importar titulos corrompidos em silencio.
    const latin1 = new Uint8Array([0x74, 0x69, 0x74, 0x6c, 0x65, 0x0a, 0x41, 0xe9]);
    const r = validateAndDecodeUpload(latin1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("UTF-8");
  });

  it("(7) RECUSA conteudo com byte NUL", () => {
    const comNul = new Uint8Array([0x74, 0x00, 0x69]);
    expect(validateAndDecodeUpload(comNul).ok).toBe(false);
  });
});

describe("sanitizeFileName", () => {
  it("(1) reduz ao basename (path traversal nao sobrevive)", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("C:\\Users\\x\\watched.csv")).toBe("watched.csv");
    expect(sanitizeFileName("/tmp/a/b/diary.csv")).toBe("diary.csv");
  });

  it("(2) colapsa sequencias de ponto e remove caracteres perigosos", () => {
    expect(sanitizeFileName("..watched..csv")).toBe(".watched.csv");
    expect(sanitizeFileName('we"ird<>|name.csv')).toBe("weirdname.csv");
  });

  it("(3) nome vazio ou so-separadores vira null", () => {
    expect(sanitizeFileName("")).toBeNull();
    expect(sanitizeFileName("///")).toBeNull();
    expect(sanitizeFileName(null)).toBeNull();
  });
});
