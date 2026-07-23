/**
 * Testes do planner de mutacoes do AUTOR: create / edit / spoiler / visibility /
 * withdraw / restore. Planos explicitos, gate de conta (forbidden), validacao
 * (validation_failed), idempotencia (noop) e SEPARACAO (nenhum plano carrega
 * nota numerica, fonte externa ou Cinerie Score).
 */

import { describe, expect, it } from "vitest";
import type { UserStatus } from "../../core/types.js";
import {
  planCreateReview,
  planEditReview,
  planRestoreReview,
  planSetSpoiler,
  planSetVisibility,
  planWithdrawReview,
} from "../mutation.js";
import type { ReviewSnapshot } from "../types.js";

const NOW = new Date("2026-07-20T12:00:00.000Z");

function snapshot(overrides: Partial<ReviewSnapshot> = {}): ReviewSnapshot {
  return {
    entityType: "movie",
    entityId: 10n,
    title: "Titulo",
    body: "Corpo original da review.",
    containsSpoiler: false,
    status: "approved",
    visibility: "public",
    deletedAt: null,
    ...overrides,
  };
}

function createInput(overrides: Partial<Parameters<typeof planCreateReview>[0]> = {}) {
  return {
    accountStatus: "active" as UserStatus,
    entityType: "movie",
    entityId: 10n,
    title: "Titulo",
    body: "Uma review honesta e sem spoiler.",
    containsSpoiler: false,
    now: NOW,
    ...overrides,
  };
}

const stable = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

describe("planCreateReview", () => {
  it("(1) cria pending + private por default, deletedAt null", () => {
    const result = planCreateReview(createInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("create");
      expect(result.value.changes.status).toBe("pending");
      expect(result.value.changes.visibility).toBe("private");
      expect(result.value.changes.publishedAt).toBeNull();
      expect(result.value.changes.deletedAt).toBeNull();
      expect(result.value.changes.body).toContain("review honesta");
    }
  });

  it("(2) conta bloqueada nao cria (forbidden)", () => {
    for (const status of ["disabled", "pending_deletion", "deleted"] as const) {
      const result = planCreateReview(createInput({ accountStatus: status }));
      expect(result.ok, status).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("forbidden");
    }
  });

  it("(3) estado de conta desconhecido falha fechado (forbidden)", () => {
    const result = planCreateReview(createInput({ accountStatus: "frozen" as UserStatus }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("forbidden");
  });

  it("(4) tipo nao revisavel (person) falha (validation_failed)", () => {
    const result = planCreateReview(createInput({ entityType: "person" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation_failed");
      expect(result.error.details?.some((d) => d.includes("entityType"))).toBe(true);
    }
  });

  it("(5) corpo vazio apos sanitizacao falha", () => {
    const result = planCreateReview(createInput({ body: "    \n\n   " }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation_failed");
  });

  it("(6) o plano NAO contem nota numerica, fonte externa nem Cinerie Score", () => {
    const result = planCreateReview(createInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      const s = stable(result.value);
      for (const forbidden of [
        "ratingValue",
        "ratingScale",
        "ratingSource",
        "providerApi",
        "sourceLicenseId",
        "attributionText",
        "cinerieScore",
      ]) {
        expect(s.includes(forbidden), `plano nao pode conter ${forbidden}`).toBe(false);
      }
    }
  });
});

describe("planEditReview", () => {
  it("(7) edicao com alteracao real produz update", () => {
    const result = planEditReview({
      accountStatus: "active",
      current: snapshot({ status: "pending" }),
      body: "Corpo novo e diferente.",
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("update");
      expect(result.value.changes.body).toBe("Corpo novo e diferente.");
    }
  });

  it("(8) editar review approved a devolve para pending (re-moderacao)", () => {
    const result = planEditReview({
      accountStatus: "active",
      current: snapshot({ status: "approved" }),
      body: "Conteudo alterado apos aprovacao.",
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.changes.status).toBe("pending");
      expect(result.value.changes.publishedAt).toBeNull();
    }
  });

  it("(9) edicao identica (mesmo titulo/corpo) produz noop", () => {
    const current = snapshot({ title: "Titulo", body: "Corpo original da review." });
    const result = planEditReview({
      accountStatus: "active",
      current,
      title: "Titulo",
      body: "Corpo original da review.",
      now: NOW,
    });
    expect(result.ok && result.value.kind).toBe("noop");
    expect(result.ok && result.value.changes).toEqual({});
  });

  it("(10) editar review removida por moderacao e forbidden", () => {
    const result = planEditReview({
      accountStatus: "active",
      current: snapshot({ status: "removed", deletedAt: NOW }),
      body: "Tentando editar removida.",
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("forbidden");
  });
});

describe("planSetSpoiler", () => {
  it("(11) marcar spoiler (false -> true) produz update", () => {
    const result = planSetSpoiler({
      accountStatus: "active",
      current: snapshot({ containsSpoiler: false }),
      containsSpoiler: true,
      now: NOW,
    });
    expect(result.ok && result.value.kind).toBe("update");
    expect(result.ok && result.value.changes.containsSpoiler).toBe(true);
  });

  it("(12) desmarcar spoiler (true -> false) produz update", () => {
    const result = planSetSpoiler({
      accountStatus: "active",
      current: snapshot({ containsSpoiler: true }),
      containsSpoiler: false,
      now: NOW,
    });
    expect(result.ok && result.value.kind).toBe("update");
    expect(result.ok && result.value.changes.containsSpoiler).toBe(false);
  });

  it("(13) marcacao identica produz noop", () => {
    const result = planSetSpoiler({
      accountStatus: "active",
      current: snapshot({ containsSpoiler: true }),
      containsSpoiler: true,
      now: NOW,
    });
    expect(result.ok && result.value.kind).toBe("noop");
  });

  it("(14) conta bloqueada nao altera spoiler (forbidden)", () => {
    const result = planSetSpoiler({
      accountStatus: "deleted",
      current: snapshot(),
      containsSpoiler: true,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("forbidden");
  });
});

describe("planSetVisibility", () => {
  it("(15) mudar visibilidade produz update", () => {
    const result = planSetVisibility({
      accountStatus: "active",
      current: snapshot({ visibility: "private" }),
      visibility: "public",
      now: NOW,
    });
    expect(result.ok && result.value.kind).toBe("update");
    expect(result.ok && result.value.changes.visibility).toBe("public");
  });

  it("(16) visibilidade igual produz noop", () => {
    const result = planSetVisibility({
      accountStatus: "active",
      current: snapshot({ visibility: "public" }),
      visibility: "public",
      now: NOW,
    });
    expect(result.ok && result.value.kind).toBe("noop");
  });

  it("(17) visibilidade invalida falha (validation_failed)", () => {
    const result = planSetVisibility({
      accountStatus: "active",
      current: snapshot(),
      visibility: "hidden" as never,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation_failed");
  });
});

describe("planWithdrawReview / planRestoreReview", () => {
  it("(18) retirar review ativa produz withdraw (deletedAt = now)", () => {
    const result = planWithdrawReview({
      accountStatus: "active",
      current: snapshot({ deletedAt: null }),
      now: NOW,
    });
    expect(result.ok && result.value.kind).toBe("withdraw");
    expect(result.ok && result.value.changes.deletedAt).toBe(NOW);
  });

  it("(19) retirar review ja retirada produz noop", () => {
    const result = planWithdrawReview({
      accountStatus: "active",
      current: snapshot({ deletedAt: NOW }),
      now: NOW,
    });
    expect(result.ok && result.value.kind).toBe("noop");
  });

  it("(20) restaurar review retirada pelo autor produz restore (deletedAt = null)", () => {
    const result = planRestoreReview({
      accountStatus: "active",
      current: snapshot({ status: "approved", deletedAt: NOW }),
      now: NOW,
    });
    expect(result.ok && result.value.kind).toBe("restore");
    expect(result.ok && result.value.changes.deletedAt).toBeNull();
  });

  it("(21) restaurar review ja ativa produz noop", () => {
    const result = planRestoreReview({
      accountStatus: "active",
      current: snapshot({ deletedAt: null }),
      now: NOW,
    });
    expect(result.ok && result.value.kind).toBe("noop");
  });

  it("(22) autor NAO restaura review removida por moderacao (forbidden)", () => {
    const result = planRestoreReview({
      accountStatus: "active",
      current: snapshot({ status: "removed", deletedAt: NOW }),
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("forbidden");
  });

  it("(23) conta bloqueada nao retira nem restaura (forbidden)", () => {
    const w = planWithdrawReview({ accountStatus: "disabled", current: snapshot(), now: NOW });
    const r = planRestoreReview({
      accountStatus: "disabled",
      current: snapshot({ deletedAt: NOW }),
      now: NOW,
    });
    expect(w.ok).toBe(false);
    expect(r.ok).toBe(false);
  });
});

describe("determinismo", () => {
  it("(24) mesma entrada produz sempre a mesma saida", () => {
    const input = {
      accountStatus: "active" as UserStatus,
      current: snapshot({ status: "pending" }),
      body: "Novo corpo determinista.",
      now: NOW,
    };
    expect(stable(planEditReview(input))).toEqual(stable(planEditReview(input)));
  });
});
