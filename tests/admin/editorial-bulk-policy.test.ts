/**
 * Testes PUROS da politica de acoes editoriais EM LOTE (Fase 7C).
 *
 * Cobrem: limite 1..20, ids invalidos/duplicados, campo/valor permitido vs
 * proibido, parse de artigo (reviewStatus/indexStatus) e content_block, resultado
 * sem segredo e feedback sem payload.
 */

import { describe, expect, it } from "vitest";

import {
  BULK_LIMIT,
  BULK_SCOPES,
  buildBulkActionResult,
  bulkResultToQuery,
  bulkScopeFor,
  dedupeBulkIds,
  enforceBulkLimit,
  getBulkLimit,
  isAllowedBulkArticleField,
  isAllowedBulkArticleValue,
  isAllowedBulkContentBlockField,
  isAllowedBulkContentBlockValue,
  parseBulkArticleActionInput,
  parseBulkContentBlockActionInput,
  readBulkFeedback,
  validateBulkIds,
} from "../../apps/admin/src/lib/editorial-bulk-policy";

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => String(i + 1));

describe("limites de lote", () => {
  it("getBulkLimit() === 20", () => {
    expect(getBulkLimit()).toBe(20);
    expect(BULK_LIMIT).toBe(20);
  });

  it("enforceBulkLimit respeita [1, 20]", () => {
    expect(enforceBulkLimit([])).toBe(false);
    expect(enforceBulkLimit(ids(1))).toBe(true);
    expect(enforceBulkLimit(ids(20))).toBe(true);
    expect(enforceBulkLimit(ids(21))).toBe(false);
  });
});

describe("ids", () => {
  it("dedupeBulkIds remove duplicados preservando ordem", () => {
    expect(dedupeBulkIds(["3", "1", "3", "2", "1"])).toEqual(["3", "1", "2"]);
  });

  it("validateBulkIds: array valido 1..20", () => {
    expect(validateBulkIds(["1", "2", "2", "3"])).toEqual({ ok: true, ids: ["1", "2", "3"] });
    expect(validateBulkIds(ids(20)).ok).toBe(true);
  });

  it("validateBulkIds rejeita sem ids / acima de 20 / invalidos / nao-array", () => {
    expect(validateBulkIds([])).toEqual({ ok: false, reason: "no_ids" });
    expect(validateBulkIds(ids(21))).toEqual({ ok: false, reason: "too_many_ids" });
    expect(validateBulkIds(["1", "0"])).toEqual({ ok: false, reason: "invalid_ids" });
    expect(validateBulkIds(["1", "abc"])).toEqual({ ok: false, reason: "invalid_ids" });
    expect(validateBulkIds(["1", 2])).toEqual({ ok: false, reason: "invalid_ids" });
    expect(validateBulkIds("nope")).toEqual({ ok: false, reason: "malformed" });
    expect(validateBulkIds(undefined)).toEqual({ ok: false, reason: "malformed" });
  });

  it("validateBulkIds barra payload gigante cedo (teto duro)", () => {
    expect(validateBulkIds(ids(500))).toEqual({ ok: false, reason: "too_many_ids" });
  });
});

describe("campos e valores permitidos", () => {
  it("campos de artigo: reviewStatus/indexStatus; content_block: so reviewStatus", () => {
    expect(isAllowedBulkArticleField("reviewStatus")).toBe(true);
    expect(isAllowedBulkArticleField("indexStatus")).toBe(true);
    expect(isAllowedBulkArticleField("title")).toBe(false);
    expect(isAllowedBulkArticleField("displayAllowed")).toBe(false);
    expect(isAllowedBulkContentBlockField("reviewStatus")).toBe(true);
    expect(isAllowedBulkContentBlockField("indexStatus")).toBe(false);
  });

  it("valores validos por campo (enum real)", () => {
    expect(isAllowedBulkArticleValue("reviewStatus", "human_reviewed")).toBe(true);
    expect(isAllowedBulkArticleValue("reviewStatus", "stale")).toBe(false); // stale e index
    expect(isAllowedBulkArticleValue("indexStatus", "index")).toBe(true);
    expect(isAllowedBulkArticleValue("indexStatus", "published")).toBe(false); // published e review
    expect(isAllowedBulkArticleValue("title", "x")).toBe(false);
    expect(isAllowedBulkContentBlockValue("reviewStatus", "blocked")).toBe(true);
    expect(isAllowedBulkContentBlockValue("indexStatus", "index")).toBe(false);
  });
});

describe("parseBulkArticleActionInput", () => {
  it("aprova reviewStatus em lote", () => {
    expect(
      parseBulkArticleActionInput({ field: "reviewStatus", value: "human_reviewed", ids: ["1", "2"] }),
    ).toEqual({ ok: true, field: "reviewStatus", value: "human_reviewed", ids: ["1", "2"] });
  });

  it("aprova indexStatus em lote", () => {
    expect(
      parseBulkArticleActionInput({ field: "indexStatus", value: "index", ids: ["5", "5", "6"] }),
    ).toEqual({ ok: true, field: "indexStatus", value: "index", ids: ["5", "6"] });
  });

  it("rejeita campo proibido, valor fora do enum, cross-field", () => {
    expect(parseBulkArticleActionInput({ field: "title", value: "x", ids: ["1"] })).toEqual({
      ok: false,
      reason: "invalid_field",
    });
    expect(
      parseBulkArticleActionInput({ field: "reviewStatus", value: "approved", ids: ["1"] }),
    ).toEqual({ ok: false, reason: "invalid_value" });
    // "stale" e IndexDecision, nunca ReviewStatus.
    expect(
      parseBulkArticleActionInput({ field: "reviewStatus", value: "stale", ids: ["1"] }),
    ).toEqual({ ok: false, reason: "invalid_value" });
  });

  it("rejeita ids ausentes/invalidos/demais e payload malformado", () => {
    expect(parseBulkArticleActionInput({ field: "reviewStatus", value: "draft", ids: [] }).ok).toBe(
      false,
    );
    expect(
      parseBulkArticleActionInput({ field: "reviewStatus", value: "draft", ids: ids(21) }),
    ).toEqual({ ok: false, reason: "too_many_ids" });
    expect(
      parseBulkArticleActionInput({ field: "reviewStatus", value: "draft", ids: ["0"] }),
    ).toEqual({ ok: false, reason: "invalid_ids" });
    expect(parseBulkArticleActionInput("nope").ok).toBe(false);
    expect(parseBulkArticleActionInput(null).ok).toBe(false);
  });

  it("ignora chaves arbitrarias extras", () => {
    const r = parseBulkArticleActionInput({
      field: "reviewStatus",
      value: "published",
      ids: ["9"],
      evil: "DROP TABLE",
      data: { title: "x" },
    } as unknown);
    expect(r).toEqual({ ok: true, field: "reviewStatus", value: "published", ids: ["9"] });
  });
});

describe("parseBulkContentBlockActionInput", () => {
  it("aprova reviewStatus em lote", () => {
    expect(
      parseBulkContentBlockActionInput({ field: "reviewStatus", value: "blocked", ids: ["7"] }),
    ).toEqual({ ok: true, field: "reviewStatus", value: "blocked", ids: ["7"] });
  });

  it("rejeita campo != reviewStatus", () => {
    expect(
      parseBulkContentBlockActionInput({ field: "indexStatus", value: "index", ids: ["7"] }),
    ).toEqual({ ok: false, reason: "invalid_field" });
  });
});

describe("resultado e query de lote (sem segredo)", () => {
  it("bulkScopeFor mapeia (modelo, campo) -> escopo do allowlist", () => {
    expect(bulkScopeFor("article", "reviewStatus")).toBe("article_reviewStatus");
    expect(bulkScopeFor("article", "indexStatus")).toBe("article_indexStatus");
    expect(bulkScopeFor("contentBlock", "reviewStatus")).toBe("contentBlock_reviewStatus");
    expect(BULK_SCOPES).toContain("article_reviewStatus");
  });

  it("buildBulkActionResult so carrega outcome/escopo/contagens inteiras", () => {
    const r = buildBulkActionResult("bulk_updated", "article_reviewStatus", {
      updated: 3,
      failed: 1,
      rejected: 2,
      total: 6,
    });
    expect(r).toEqual({
      ok: true,
      outcome: "bulk_updated",
      scope: "article_reviewStatus",
      updated: 3,
      failed: 1,
      rejected: 2,
      total: 6,
    });
    const keys = Object.keys(r).sort();
    for (const forbidden of ["value", "payload", "ids", "id", "message", "stack", "password"]) {
      expect(keys).not.toContain(forbidden);
    }
    expect(buildBulkActionResult("bulk_actions_disabled")).toEqual({
      ok: false,
      outcome: "bulk_actions_disabled",
    });
  });

  it("bulkResultToQuery emite so tokens + contagens", () => {
    expect(
      bulkResultToQuery(
        buildBulkActionResult("bulk_updated", "article_indexStatus", {
          updated: 2,
          failed: 0,
          rejected: 0,
          total: 2,
        }),
      ),
    ).toBe("bulk_updated=article_indexStatus&ok=2&fail=0&skip=0");
    expect(bulkResultToQuery(buildBulkActionResult("bulk_actions_disabled"))).toBe(
      "error=bulk_actions_disabled",
    );
    expect(bulkResultToQuery(buildBulkActionResult("bulk_invalid_input"))).toBe(
      "error=bulk_invalid_input",
    );
    expect(bulkResultToQuery(buildBulkActionResult("bulk_update_failed"))).toBe(
      "error=bulk_update_failed",
    );
  });
});

describe("readBulkFeedback (mensagem fixa, sem payload)", () => {
  it("mapeia sucesso com contagens seguras", () => {
    const fb = readBulkFeedback({ bulk_updated: "article_reviewStatus", ok: "5", fail: "1" });
    expect(fb?.tone).toBe("success");
    expect(fb?.message).toContain("5");
    expect(fb?.message).toContain("review_status");
  });

  it("contagens nao-numericas viram 0 (sem injecao)", () => {
    const fb = readBulkFeedback({ bulk_updated: "article_indexStatus", ok: "<script>", fail: "x" });
    expect(fb?.message).toContain("0");
    expect(fb?.message).not.toContain("<script>");
  });

  it("mapeia erros e ignora token desconhecido", () => {
    expect(readBulkFeedback({ error: "bulk_actions_disabled" })?.tone).toBe("error");
    expect(readBulkFeedback({ error: "bulk_invalid_input" })?.tone).toBe("error");
    expect(readBulkFeedback({ error: "bulk_update_failed" })?.tone).toBe("error");
    expect(readBulkFeedback({})).toBeNull();
    expect(readBulkFeedback({ bulk_updated: "evil_scope" })).toBeNull();
  });
});
