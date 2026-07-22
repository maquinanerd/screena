/**
 * Teste de governanca — Backend C (user product platform), higiene de bytes.
 *
 * Nenhum arquivo `.ts` de `services/user-platform/src` pode conter bytes de
 * controle CRUS (C0 fora de tab/LF/CR, e DEL). Motivo pratico: um unico NUL
 * (0x00) faz o Git classificar o arquivo como binario, e o diff vira
 * "Binary files differ" — o arquivo deixa de ser revisavel em PR. Bytes de
 * controle menos agressivos (ex.: 0x01) NAO disparam a heuristica do Git e
 * passam despercebidos indefinidamente.
 *
 * Isso ja aconteceu duas vezes neste repositorio, no mesmo padrao: uma chave
 * composta em memoria (`refKey` em `recommendations/ranking.ts`, `dedupKey` em
 * `tracking/diary.ts`) montada com um byte de controle como separador. A
 * correcao canonica e um separador IMPRIMIVEL ("|"), escolhido de modo que a
 * chave continue injetiva.
 *
 * Este arquivo nao usa escapes unicode nem caracteres literais de controle: os
 * bytes proibidos sao construidos com `String.fromCharCode`, para que o proprio
 * teste jamais carregue aquilo que ele proibe.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCAN_ROOT = path.join(ROOT, "services", "user-platform", "src");

const TAB = 0x09;
const LF = 0x0a;
const CR = 0x0d;
const DEL = 0x7f;

/** Verdadeiro para C0 crus proibidos (tab/LF/CR liberados) e DEL. */
function isForbiddenCode(code: number): boolean {
  if (code === TAB || code === LF || code === CR) {
    return false;
  }
  return code < 0x20 || code === DEL;
}

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectTsFiles(full));
      continue;
    }
    if (full.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Retorna `linha N: U+XXXX` para cada byte de controle cru encontrado. */
function findControlBytes(source: string): string[] {
  const hits: string[] = [];
  const lines = source.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    for (const char of line) {
      const code = char.codePointAt(0) ?? 0;
      if (isForbiddenCode(code)) {
        hits.push(`linha ${index + 1}: U+${code.toString(16).toUpperCase().padStart(4, "0")}`);
      }
    }
  }
  return hits;
}

describe("governanca: user-platform sem bytes de controle crus", () => {
  const files = collectTsFiles(SCAN_ROOT);

  it("encontra arquivos para varrer (sanidade do walker)", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("o detector realmente detecta (controle negativo)", () => {
    for (const code of [0x00, 0x01, 0x1f, DEL]) {
      const poisoned = `a${String.fromCharCode(code)}b`;
      expect(findControlBytes(poisoned)).toHaveLength(1);
    }
    // Whitespace legitimo nunca pode virar falso positivo.
    expect(findControlBytes(`a${String.fromCharCode(TAB)}b${String.fromCharCode(CR)}\nc`)).toEqual(
      [],
    );
    // Acentuacao e demais nao-ASCII imprimiveis tambem nao.
    expect(findControlBytes("projecao determinista — ok")).toEqual([]);
  });

  it("nenhum .ts de services/user-platform/src contem byte de controle cru", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const hits = findControlBytes(readFileSync(file, "utf8"));
      if (hits.length > 0) {
        offenders.push(`${path.relative(ROOT, file)} -> ${hits.join(", ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
