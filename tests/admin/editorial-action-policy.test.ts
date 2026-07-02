/**
 * Testes PUROS da politica de acoes editoriais (Fase 7A).
 *
 * Cobrem: flag de acoes (desligada/ligada), validacao de id, allowlist de campo,
 * allowlist de valor (enums reais de ReviewStatus/IndexDecision), parse completo
 * de acao (artigo + content_block), rejeicao de payload malformado / dado
 * arbitrario, e garantia de que o resultado de acao (e sua query de feedback)
 * NUNCA carregam valor cru/segredo.
 */

import { describe, expect, it } from "vitest";

import {
  ARTICLE_ACTION_FIELDS,
  CONTENT_BLOCK_ACTION_FIELDS,
  EDITORIAL_ACTIONS_ENV_KEY,
  INDEX_DECISIONS,
  REVIEW_STATUSES,
  actionResultToQuery,
  buildActionResult,
  canRunEditorialAction,
  isAllowedArticleReviewStatus,
  isAllowedContentBlockReviewStatus,
  isAllowedIndexStatus,
  isEditorialActionsEnabled,
  isValidRecordId,
  parseArticleActionInput,
  parseContentBlockActionInput,
  parseRecordId,
  readActionFeedback,
} from "../../apps/admin/src/lib/editorial-action-policy";

/* Enums reais espelhados do schema (packages/db/prisma/schema.prisma). */
const REAL_REVIEW_STATUSES = [
  "draft",
  "ai_generated",
  "needs_review",
  "human_reviewed",
  "published",
  "needs_update",
  "blocked",
  "archived",
];
const REAL_INDEX_DECISIONS = ["index", "noindex", "draft", "stale", "blocked"];

describe("enums e allowlists espelham o schema real", () => {
  it("REVIEW_STATUSES = enum ReviewStatus completo", () => {
    expect([...REVIEW_STATUSES]).toEqual(REAL_REVIEW_STATUSES);
  });

  it("INDEX_DECISIONS = enum IndexDecision completo", () => {
    expect([...INDEX_DECISIONS]).toEqual(REAL_INDEX_DECISIONS);
  });

  it("campos editaveis: artigo = {reviewStatus, indexStatus}; block = {reviewStatus}", () => {
    expect([...ARTICLE_ACTION_FIELDS]).toEqual(["reviewStatus", "indexStatus"]);
    expect([...CONTENT_BLOCK_ACTION_FIELDS]).toEqual(["reviewStatus"]);
  });

  it("displayAllowed NAO e um campo editavel nesta fase", () => {
    expect((ARTICLE_ACTION_FIELDS as readonly string[]).includes("displayAllowed")).toBe(false);
    expect((CONTENT_BLOCK_ACTION_FIELDS as readonly string[]).includes("displayAllowed")).toBe(
      false,
    );
  });

  it("o nome da env e ADMIN_EDITORIAL_ACTIONS_ENABLED", () => {
    expect(EDITORIAL_ACTIONS_ENV_KEY).toBe("ADMIN_EDITORIAL_ACTIONS_ENABLED");
  });
});

describe("feature flag (isEditorialActionsEnabled / canRunEditorialAction)", () => {
  it('so habilita com a string exata "true"', () => {
    expect(isEditorialActionsEnabled({ ADMIN_EDITORIAL_ACTIONS_ENABLED: "true" })).toBe(true);
    expect(canRunEditorialAction({ ADMIN_EDITORIAL_ACTIONS_ENABLED: "true" })).toBe(true);
  });

  it("qualquer outro valor NAO habilita (ausente/false/1/vazio/TRUE)", () => {
    for (const value of [undefined, "false", "1", "", " true", "TRUE", "yes"]) {
      expect(isEditorialActionsEnabled({ ADMIN_EDITORIAL_ACTIONS_ENABLED: value })).toBe(false);
      expect(canRunEditorialAction({ ADMIN_EDITORIAL_ACTIONS_ENABLED: value })).toBe(false);
    }
  });
});

describe("validacao de id de registro", () => {
  it("aceita string de digitos positiva (sem zero a esquerda)", () => {
    for (const id of ["1", "42", "9007199254740993", "123456789012345678"]) {
      expect(isValidRecordId(id)).toBe(true);
      expect(parseRecordId(id)).toBe(id);
    }
  });

  it("rejeita vazio, zero, negativo, decimal, nao-string e com letra", () => {
    for (const id of ["", "0", "01", "-1", "1.5", "1e3", "abc", "12a", " 1", "1 ", null, 1, {}]) {
      expect(isValidRecordId(id as unknown)).toBe(false);
      expect(parseRecordId(id as unknown)).toBeNull();
    }
  });
});

describe("allowlist de valores por enum", () => {
  it("isAllowedArticleReviewStatus aceita so ReviewStatus reais", () => {
    for (const value of REAL_REVIEW_STATUSES) {
      expect(isAllowedArticleReviewStatus(value)).toBe(true);
      expect(isAllowedContentBlockReviewStatus(value)).toBe(true);
    }
    for (const value of ["pending", "approved", "rejected", "", "PUBLISHED", 1, null]) {
      expect(isAllowedArticleReviewStatus(value as unknown)).toBe(false);
      expect(isAllowedContentBlockReviewStatus(value as unknown)).toBe(false);
    }
  });

  it("isAllowedIndexStatus aceita so IndexDecision reais", () => {
    for (const value of REAL_INDEX_DECISIONS) expect(isAllowedIndexStatus(value)).toBe(true);
    for (const value of ["indexed", "no-index", "", "INDEX", 1, null]) {
      expect(isAllowedIndexStatus(value as unknown)).toBe(false);
    }
  });

  it("um allowlist reduzido restringe ainda mais (parametro allowed)", () => {
    expect(isAllowedArticleReviewStatus("published", ["human_reviewed"])).toBe(false);
    expect(isAllowedArticleReviewStatus("human_reviewed", ["human_reviewed"])).toBe(true);
  });
});

describe("parseArticleActionInput", () => {
  it("aprova reviewStatus valido", () => {
    const r = parseArticleActionInput({ id: "7", field: "reviewStatus", value: "human_reviewed" });
    expect(r).toEqual({ ok: true, id: "7", field: "reviewStatus", value: "human_reviewed" });
  });

  it("aprova indexStatus valido", () => {
    const r = parseArticleActionInput({ id: "9", field: "indexStatus", value: "noindex" });
    expect(r).toEqual({ ok: true, id: "9", field: "indexStatus", value: "noindex" });
  });

  it("rejeita id invalido", () => {
    expect(parseArticleActionInput({ id: "0", field: "reviewStatus", value: "draft" })).toEqual({
      ok: false,
      reason: "invalid_id",
    });
  });

  it("rejeita campo nao permitido (ex.: title/slug/body/displayAllowed)", () => {
    for (const field of ["title", "slug", "body", "content", "displayAllowed", "publishedAt"]) {
      expect(parseArticleActionInput({ id: "1", field, value: "x" })).toEqual({
        ok: false,
        reason: "invalid_field",
      });
    }
  });

  it("rejeita valor fora do enum (reviewStatus e indexStatus)", () => {
    expect(parseArticleActionInput({ id: "1", field: "reviewStatus", value: "approved" })).toEqual({
      ok: false,
      reason: "invalid_value",
    });
    expect(parseArticleActionInput({ id: "1", field: "indexStatus", value: "indexed" })).toEqual({
      ok: false,
      reason: "invalid_value",
    });
  });

  it("cruza campo/valor: reviewStatus NAO aceita valor de IndexDecision", () => {
    // "stale" e IndexDecision, nunca ReviewStatus.
    expect(parseArticleActionInput({ id: "1", field: "reviewStatus", value: "stale" })).toEqual({
      ok: false,
      reason: "invalid_value",
    });
  });

  it("rejeita payload malformado (nao-objeto / null / array)", () => {
    for (const bad of [null, undefined, "str", 42, []]) {
      expect(parseArticleActionInput(bad as unknown).ok).toBe(false);
    }
    expect(parseArticleActionInput(null).ok).toBe(false);
  });

  it("ignora chaves arbitrarias extras (nao vira dado arbitrario)", () => {
    const r = parseArticleActionInput({
      id: "3",
      field: "reviewStatus",
      value: "published",
      extra: "DROP TABLE",
      displayAllowed: true,
    } as unknown);
    expect(r).toEqual({ ok: true, id: "3", field: "reviewStatus", value: "published" });
  });
});

describe("parseContentBlockActionInput", () => {
  it("aprova reviewStatus valido", () => {
    const r = parseContentBlockActionInput({ id: "5", field: "reviewStatus", value: "blocked" });
    expect(r).toEqual({ ok: true, id: "5", field: "reviewStatus", value: "blocked" });
  });

  it("rejeita campo != reviewStatus (indexStatus nao existe em ContentBlock)", () => {
    expect(
      parseContentBlockActionInput({ id: "5", field: "indexStatus", value: "index" }),
    ).toEqual({ ok: false, reason: "invalid_field" });
    expect(parseContentBlockActionInput({ id: "5", field: "content", value: "x" })).toEqual({
      ok: false,
      reason: "invalid_field",
    });
  });

  it("rejeita id/valor invalido e payload malformado", () => {
    expect(parseContentBlockActionInput({ id: "x", field: "reviewStatus", value: "draft" }).ok).toBe(
      false,
    );
    expect(
      parseContentBlockActionInput({ id: "5", field: "reviewStatus", value: "nope" }).ok,
    ).toBe(false);
    expect(parseContentBlockActionInput("nope" as unknown).ok).toBe(false);
  });
});

describe("resultado de acao e query de feedback (sem segredo)", () => {
  it("buildActionResult so carrega outcome + campo do allowlist", () => {
    expect(buildActionResult("updated", "reviewStatus")).toEqual({
      ok: true,
      outcome: "updated",
      field: "reviewStatus",
    });
    expect(buildActionResult("actions_disabled")).toEqual({
      ok: false,
      outcome: "actions_disabled",
    });
    // Sem field quando nao e sucesso, mesmo se um campo for passado.
    expect(buildActionResult("invalid_input")).toEqual({ ok: false, outcome: "invalid_input" });
  });

  it("o objeto de resultado nunca contem chaves de valor/payload/segredo", () => {
    const keys = Object.keys(buildActionResult("updated", "indexStatus"));
    expect(keys.sort()).toEqual(["field", "ok", "outcome"]);
    for (const forbidden of ["value", "payload", "id", "message", "stack", "password", "senha"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("actionResultToQuery emite so tokens seguros", () => {
    expect(actionResultToQuery(buildActionResult("updated", "reviewStatus"))).toBe(
      "updated=reviewStatus",
    );
    expect(actionResultToQuery(buildActionResult("updated", "indexStatus"))).toBe(
      "updated=indexStatus",
    );
    expect(actionResultToQuery(buildActionResult("actions_disabled"))).toBe(
      "error=actions_disabled",
    );
    expect(actionResultToQuery(buildActionResult("invalid_input"))).toBe("error=invalid_input");
    expect(actionResultToQuery(buildActionResult("update_failed"))).toBe("error=update_failed");
  });
});

describe("readActionFeedback (mensagens fixas pt-BR, sem payload)", () => {
  it("mapeia tokens de sucesso e erro", () => {
    expect(readActionFeedback({ updated: "reviewStatus" })?.tone).toBe("success");
    expect(readActionFeedback({ updated: "indexStatus" })?.tone).toBe("success");
    expect(readActionFeedback({ error: "actions_disabled" })?.tone).toBe("error");
    expect(readActionFeedback({ error: "invalid_input" })?.tone).toBe("error");
    expect(readActionFeedback({ error: "update_failed" })?.tone).toBe("error");
  });

  it("retorna null para token desconhecido/ausente", () => {
    expect(readActionFeedback({})).toBeNull();
    expect(readActionFeedback({ updated: "title" })).toBeNull();
    expect(readActionFeedback({ error: "boom" })).toBeNull();
  });

  it("a mensagem e fixa e nao ecoa nenhum valor recebido", () => {
    const msg = readActionFeedback({ updated: "reviewStatus" })?.message ?? "";
    expect(msg).not.toContain("reviewStatus");
    expect(msg.length).toBeGreaterThan(0);
  });
});
