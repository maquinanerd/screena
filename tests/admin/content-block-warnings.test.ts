/**
 * Avisos de geracao do content_block (`warnings_json`) no admin editorial.
 *
 * O DEFEITO QUE ESTE ARQUIVO EXISTE PARA IMPEDIR DE VOLTAR: o Entity Writer manda
 * para `needs_review` todo bloco com aviso (`decideStatus`) e grava os avisos em
 * `content_blocks.warnings_json` — mas o admin nao lia a coluna. A fila mostrava
 * "needs_review" sem dizer POR QUE, e o revisor humano tinha de adivinhar qual nome
 * o modelo citou fora do payload.
 *
 * Prova quatro coisas:
 *   1. LEITURA DEFENSIVA — `parseContentBlockWarnings` nunca lanca; forma
 *      inesperada vira lista vazia, item a item.
 *   2. RECORTE DA FILA   — `previewWarnings` limita itens e caracteres e conta o
 *      que ficou de fora.
 *   3. CONTRATO          — o que o escritor REAL grava (decideStatus +
 *      validateAgainstPayload, ida e volta por JSON) volta inteiro na leitura; e o
 *      adapter Prisma grava um ARRAY (se virasse `JSON.stringify`, o admin passaria
 *      a mostrar "nenhum aviso" calado).
 *   4. FIACAO            — as quatro consultas de content_block leem a coluna e as
 *      tres telas a exibem, sem virar superficie de escrita.
 */

import { describe, expect, it } from "vitest";

import {
  validateAgainstPayload,
  validateEntityWriterOutput,
  type EntityPayload,
  type EntityWriterOutput,
} from "@screena/schemas";

import {
  QUEUE_WARNINGS_SHOWN,
  QUEUE_WARNING_MAX_CHARS,
  parseContentBlockWarnings,
  previewWarnings,
  warningsCountLabel,
} from "../../apps/admin/src/lib/content-block-warnings";
import { decideStatus } from "../../services/entity-writer/src/pipeline/decide-status";
import { readSourceWithoutComments } from "../support/source-text";

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("parseContentBlockWarnings: leitura defensiva de warnings_json", () => {
  it("array de strings volta na ordem gravada", () => {
    expect(
      parseContentBlockWarnings(["fato fora do payload: Zendaya", "sem data de estreia no payload"]),
    ).toEqual(["fato fora do payload: Zendaya", "sem data de estreia no payload"]);
  });

  it("coluna nula, ausente ou array vazio -> nenhum aviso", () => {
    expect(parseContentBlockWarnings(null)).toEqual([]);
    expect(parseContentBlockWarnings(undefined)).toEqual([]);
    expect(parseContentBlockWarnings([])).toEqual([]);
  });

  it("forma que nao e array -> nenhum aviso, sem lancar", () => {
    const malformed: unknown[] = [
      "fato fora do payload: Zendaya",
      '["fato fora do payload: Zendaya"]',
      42,
      true,
      { warnings: ["fato fora do payload: Zendaya"] },
      { 0: "fato fora do payload: Zendaya", length: 1 },
    ];
    for (const raw of malformed) {
      expect(() => parseContentBlockWarnings(raw)).not.toThrow();
      expect(parseContentBlockWarnings(raw), JSON.stringify(raw)).toEqual([]);
    }
  });

  it("dentro do array, so string com texto sobrevive (item a item)", () => {
    expect(
      parseContentBlockWarnings([
        "fato fora do payload: Zendaya",
        null,
        7,
        { message: "objeto" },
        ["aninhado"],
        "",
        "   ",
        "  sem   data\n de estreia  ",
      ]),
    ).toEqual(["fato fora do payload: Zendaya", "sem data de estreia"]);
  });

  it("nao deduplica nem trunca: o detalhe mostra o que foi gravado", () => {
    const long = `aviso ${"x".repeat(1000)}`;
    expect(parseContentBlockWarnings(["a", "a", long])).toEqual(["a", "a", long]);
  });

  it("nao altera a entrada", () => {
    const raw = Object.freeze(["  a  ", 1, "b"]);
    parseContentBlockWarnings(raw);
    expect(raw).toEqual(["  a  ", 1, "b"]);
  });
});

describe("previewWarnings: recorte para a linha da fila", () => {
  const five = ["a1", "a2", "a3", "a4", "a5"];

  it("padrao: os primeiros QUEUE_WARNINGS_SHOWN e a contagem do resto", () => {
    expect(QUEUE_WARNINGS_SHOWN).toBe(3);
    expect(previewWarnings(five)).toEqual({ shown: ["a1", "a2", "a3"], hiddenCount: 2 });
  });

  it("lista menor que o limite: mostra tudo, nada oculto", () => {
    expect(previewWarnings(["a1"])).toEqual({ shown: ["a1"], hiddenCount: 0 });
    expect(previewWarnings([])).toEqual({ shown: [], hiddenCount: 0 });
  });

  it("corta cada aviso no teto de caracteres, com reticencias", () => {
    const long = "y".repeat(QUEUE_WARNING_MAX_CHARS + 50);
    const [shown] = previewWarnings([long]).shown;
    expect(shown).toBe(`${"y".repeat(QUEUE_WARNING_MAX_CHARS)}…`);
    expect(previewWarnings(["curto"], 3, 5).shown).toEqual(["curto"]);
  });

  it("nao parte emoji ao meio (conta ponto de codigo, nao unidade UTF-16)", () => {
    expect(previewWarnings(["🎬🎬🎬"], 1, 2).shown).toEqual(["🎬🎬…"]);
  });

  it("limite invalido conta como zero: nada mostrado, tudo contado", () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(previewWarnings(five, bad)).toEqual({ shown: [], hiddenCount: 5 });
      expect(previewWarnings(five, 3, bad)).toEqual({ shown: [], hiddenCount: 5 });
    }
  });

  it("rotulo de contagem em pt-BR", () => {
    expect(warningsCountLabel(1)).toBe("1 aviso");
    expect(warningsCountLabel(2)).toBe("2 avisos");
    expect(warningsCountLabel(0)).toBe("0 avisos");
  });
});

describe("contrato com o escritor: o que o Entity Writer grava, o admin le inteiro", () => {
  const payload: EntityPayload = {
    director: "Denis Villeneuve",
    cast: ["Timothee Chalamet", "Rebecca Ferguson"],
  };

  it("needs_review por anti-alucinacao + aviso do modelo -> mesmos avisos no admin", () => {
    const output: EntityWriterOutput = {
      cast_intro: "No elenco, Timothee Chalamet, Rebecca Ferguson e Zendaya aparecem.",
      warnings: ["payload sem data de estreia; omiti a data"],
    };
    const decision = decideStatus({
      form: validateEntityWriterOutput(output),
      output,
      payloadWarnings: validateAgainstPayload(payload, output).warnings,
    });
    expect(decision.reviewStatus).toBe("needs_review");
    expect(decision.warnings).toContain("fato fora do payload: Zendaya");

    // O adapter grava `warningsJson: [...plan.create.warnings]` numa coluna JSONB;
    // o Prisma devolve o JSON ja parseado. A ida e volta por JSON reproduz isso.
    const stored: unknown = JSON.parse(JSON.stringify([...decision.warnings]));
    expect(parseContentBlockWarnings(stored)).toEqual([...decision.warnings]);
  });

  it("o adapter Prisma grava warnings_json como ARRAY (nunca string serializada)", () => {
    const adapter = readSourceWithoutComments(
      "services/entity-writer/src/persistence/content-block-store.ts",
    );
    expect(
      adapter,
      "se o adapter mudar a forma gravada, parseContentBlockWarnings precisa mudar junto",
    ).toContain("warningsJson: [...plan.create.warnings]");
    expect(/warningsJson:\s*JSON\.stringify/.test(adapter)).toBe(false);
  });
});

describe("fiacao: consultas leem warnings_json e as telas exibem (so leitura)", () => {
  it("content-blocks.ts le a coluna na listagem e no detalhe e a interpreta defensivamente", () => {
    const code = readSourceWithoutComments("apps/admin/src/server/content-blocks.ts");
    expect(count(code, "warningsJson: true")).toBe(2);
    expect(count(code, "parseContentBlockWarnings(row.warningsJson)")).toBe(2);
  });

  it("review-queue.ts le a coluna nas duas consultas de content_block", () => {
    const code = readSourceWithoutComments("apps/admin/src/server/review-queue.ts");
    expect(count(code, "warningsJson: true")).toBe(2);
    expect(code).toContain("warnings: parseContentBlockWarnings(row.warningsJson)");
  });

  it("a fila exibe os avisos nas duas listas (lote e somente leitura)", () => {
    const page = readSourceWithoutComments("apps/admin/app/review-queue/page.tsx");
    const table = readSourceWithoutComments("apps/admin/src/components/bulk-select-table.tsx");
    expect(page).toContain("warnings: item.warnings");
    expect(page).toContain("<ContentBlockWarningsInline warnings={item.warnings} />");
    expect(table).toContain("<ContentBlockWarningsInline warnings={item.warnings} />");
  });

  it("o detalhe exibe a lista inteira e a listagem a contagem", () => {
    const detail = readSourceWithoutComments("apps/admin/app/content-blocks/[id]/page.tsx");
    const list = readSourceWithoutComments("apps/admin/app/content-blocks/page.tsx");
    expect(detail).toContain("detail.warnings.map(");
    expect(detail).toContain("Nenhum aviso registrado.");
    expect(list).toContain("row.warningCount");
  });

  it("o componente e o helper sao so apresentacao: sem form, input, server action ou IO", () => {
    const files = [
      readSourceWithoutComments("apps/admin/src/components/content-block-warnings.tsx"),
      readSourceWithoutComments("apps/admin/src/lib/content-block-warnings.ts"),
    ];
    for (const code of files) {
      expect(/<form\b|<input\b|<select\b|<button\b/i.test(code)).toBe(false);
      expect(/["']use server["']/.test(code)).toBe(false);
      expect(/\bfetch\s*\(|process\.env|getPrismaClient|@screena\/db/.test(code)).toBe(false);
    }
  });
});
