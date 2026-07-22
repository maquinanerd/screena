/**
 * Teste de governanca — higiene de bytes em TODO o codigo do repositorio.
 *
 * Nenhum arquivo de texto sob `services/`, `packages/` ou `api-clients/` pode
 * conter bytes de controle CRUS (C0 fora de tab/LF/CR, e DEL).
 *
 * Motivo pratico: um unico NUL (0x00) faz o Git classificar o arquivo como
 * binario, e o diff vira "Binary files differ" — o arquivo deixa de ser
 * revisavel em PR. Bytes menos agressivos (0x01, 0x1F) NAO disparam a heuristica
 * do Git e sobrevivem commitados indefinidamente: invisiveis no editor E no
 * diff. O caso silencioso e o pior.
 *
 * Ja aconteceu TRES vezes neste repositorio, sempre no mesmo padrao: uma chave
 * composta em memoria montada com um byte de controle como separador —
 * `refKey` (recommendations/ranking.ts, 0x01), `dedupKey` (tracking/diary.ts,
 * NUL) e `licenseGroupKey`/`decisionGroupKey` (legal/plan.ts, 0x1F).
 *
 * ESCOPO: a versao anterior desta guarda varria apenas
 * `services/user-platform/src`, e foi exatamente por isso que a ocorrencia em
 * `services/legal` sobreviveu — guarda de escopo estreito fecha uma pasta, nao a
 * classe de defeito. Agora varre as tres raizes de codigo.
 *
 * O proprio arquivo nao usa escapes de controle nem caracteres literais de
 * controle: os bytes proibidos sao construidos com `String.fromCharCode`, para
 * que o teste jamais carregue aquilo que ele proibe.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SELF = fileURLToPath(import.meta.url);

/** Raizes de codigo varridas. */
const SCAN_ROOTS = ["services", "packages", "api-clients"];

/** Extensoes de TEXTO relevantes. Binario nunca entra, por extensao. */
const TEXT_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".prisma",
  ".sql",
];

/**
 * Diretorios ignorados: apenas artefatos GERADOS ou dependencias externas.
 * Nenhuma pasta de codigo-fonte e excluida — excluir uma pasta inteira porque
 * ela contem um arquivo problematico transformaria a guarda em teatro.
 */
const IGNORED_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".next", ".turbo"]);

const TAB = 0x09;
const LF = 0x0a;
const CR = 0x0d;
const DEL = 0x7f;

/** Verdadeiro para C0 crus proibidos (tab/LF/CR liberados) e DEL. */
function isForbiddenByte(byte: number): boolean {
  if (byte === TAB || byte === LF || byte === CR) {
    return false;
  }
  return byte < 0x20 || byte === DEL;
}

function collectTextFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (IGNORED_DIRS.has(entry)) continue;
      out.push(...collectTextFiles(full));
      continue;
    }
    if (TEXT_EXTENSIONS.some((ext) => full.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Varre BYTES, nao code points decodificados: ler como utf8 trocaria sequencia
 * invalida por U+FFFD e poderia mascarar o byte cru. Tambem nao usa busca que
 * desista do arquivo ao encontrar NUL — o modo binario do `grep` faz isso e da
 * falso negativo justamente no caso mais grave.
 */
function findControlBytes(buffer: Buffer): string[] {
  const hits: string[] = [];
  let line = 1;
  for (let offset = 0; offset < buffer.length; offset += 1) {
    const byte = buffer[offset] ?? 0;
    if (byte === LF) {
      line += 1;
      continue;
    }
    if (isForbiddenByte(byte)) {
      hits.push(
        `linha ${line} (offset ${offset}): 0x${byte.toString(16).toUpperCase().padStart(2, "0")}`,
      );
    }
  }
  return hits;
}

/** Aceita string nos controles do teste, sem exigir Buffer do chamador. */
function findControlBytesInText(source: string): string[] {
  return findControlBytes(Buffer.from(source, "utf8"));
}

describe("governanca: nenhum byte de controle cru no codigo", () => {
  const filesByRoot = new Map<string, string[]>(
    SCAN_ROOTS.map((root) => [root, collectTextFiles(path.join(ROOT, root))]),
  );
  const allFiles = [...filesByRoot.values()].flat();

  it("cada raiz esperada tem arquivos analisados (anti-vacuidade)", () => {
    for (const root of SCAN_ROOTS) {
      expect(filesByRoot.get(root)?.length ?? 0, `raiz sem arquivos: ${root}`).toBeGreaterThan(10);
    }
    // A guarda anterior cobria uma pasta; a global passa de 600 arquivos.
    expect(allFiles.length).toBeGreaterThan(400);
  });

  it("o detector realmente detecta (controle negativo)", () => {
    for (const code of [0x00, 0x01, 0x1f, DEL]) {
      const envenenado = `a${String.fromCharCode(code)}b`;
      expect(findControlBytesInText(envenenado), `byte 0x${code.toString(16)}`).toHaveLength(1);
    }
    // E aponta linha e byte, nao apenas "achei algo".
    const naSegundaLinha = `ok\nx${String.fromCharCode(0x1f)}y`;
    expect(findControlBytesInText(naSegundaLinha)[0]).toMatch(/linha 2 .*0x1F/);
  });

  it("nao gera falso positivo em texto legitimo (controles positivos)", () => {
    const legitimo = [
      `tab:${String.fromCharCode(TAB)}fim`,
      `cr:${String.fromCharCode(CR)}${String.fromCharCode(LF)}fim`,
      "acentuacao: coracao, aviao, tres",
      "em dash: a — b",
      "emoji: \u{1F600}",
      "unicode: ção 中文",
    ].join("\n");
    expect(findControlBytesInText(legitimo)).toEqual([]);
  });

  it("nenhum arquivo de texto das tres raizes contem byte de controle cru", () => {
    const offenders: string[] = [];
    for (const file of allFiles) {
      const hits = findControlBytes(readFileSync(file));
      if (hits.length > 0) {
        offenders.push(
          `${path.relative(ROOT, file).split(path.sep).join("/")} -> ${hits.join(", ")}`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });

  it("o proprio arquivo de teste esta limpo (a guarda se aplica a si mesma)", () => {
    expect(findControlBytes(readFileSync(SELF))).toEqual([]);
  });
});
