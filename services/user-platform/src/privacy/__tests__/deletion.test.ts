/**
 * Testes de exclusao de conta: pedido -> pending_deletion; sem duplicidade;
 * bloqueio de sessao/mutacao durante pending_deletion; carencia/cancelamento;
 * plano delete/anonymize/retain; revogacao de sessoes/tokens; consentimentos
 * revogaveis marcados; sem reativacao ao cancelar; sem segredo no plano.
 */

import { describe, expect, it } from "vitest";
import {
  assertCanCreateSession,
  assertCanMutate,
  buildDeletionPlan,
  computeEffectiveDeletionAt,
  decideDeletionCancel,
  decideDeletionRequest,
  isWithinGraceWindow,
} from "../deletion.js";
import { PRIVACY_DURATIONS } from "../policy.js";

const REQUESTED = new Date("2026-07-17T12:00:00.000Z");
const DAY = 86_400_000;

describe("decideDeletionRequest", () => {
  it("(1) conta active pede exclusao -> pending_deletion", () => {
    const r = decideDeletionRequest({ currentStatus: "active", hasActiveDeletionRequest: false });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.nextStatus).toBe("pending_deletion");
  });

  it("(2) ja pending_deletion/deleted nao cria nova (conflito)", () => {
    expect(
      decideDeletionRequest({ currentStatus: "pending_deletion", hasActiveDeletionRequest: false }).ok,
    ).toBe(false);
    expect(decideDeletionRequest({ currentStatus: "deleted", hasActiveDeletionRequest: false }).ok).toBe(
      false,
    );
  });

  it("(3) pedido de exclusao ATIVO existente bloqueia duplicidade", () => {
    expect(
      decideDeletionRequest({ currentStatus: "active", hasActiveDeletionRequest: true }).ok,
    ).toBe(false);
  });
});

describe("bloqueio durante pending_deletion", () => {
  it("(1) conta nao-active nao cria sessao (A11: nao autentica)", () => {
    expect(assertCanCreateSession("active").ok).toBe(true);
    for (const s of ["pending_deletion", "deleted", "disabled"] as const) {
      expect(assertCanCreateSession(s).ok, s).toBe(false);
    }
  });

  it("(2) mutacoes bloqueadas fora de active", () => {
    expect(assertCanMutate("active").ok).toBe(true);
    expect(assertCanMutate("pending_deletion").ok).toBe(false);
  });
});

describe("carencia e cancelamento", () => {
  it("(1) data efetiva = requestedAt + carencia de politica", () => {
    const eff = computeEffectiveDeletionAt({ requestedAt: REQUESTED });
    expect(eff.getTime()).toBe(REQUESTED.getTime() + PRIVACY_DURATIONS.deletionGraceDays * DAY);
  });

  it("(2) cancelar DENTRO da carencia funciona e NAO reativa consentimentos", () => {
    const now = new Date(REQUESTED.getTime() + 3 * DAY);
    const r = decideDeletionCancel({ currentStatus: "pending_deletion", requestedAt: REQUESTED, now });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.nextStatus).toBe("active");
      expect(r.value.reactivateConsents).toBe(false);
    }
  });

  it("(3) cancelar FORA da carencia falha", () => {
    const now = new Date(REQUESTED.getTime() + (PRIVACY_DURATIONS.deletionGraceDays + 1) * DAY);
    expect(isWithinGraceWindow({ requestedAt: REQUESTED, now })).toBe(false);
    expect(
      decideDeletionCancel({ currentStatus: "pending_deletion", requestedAt: REQUESTED, now }).ok,
    ).toBe(false);
  });

  it("(4) exclusao ja efetivada (deleted) NAO pode ser cancelada", () => {
    const now = new Date(REQUESTED.getTime() + DAY);
    expect(decideDeletionCancel({ currentStatus: "deleted", requestedAt: REQUESTED, now }).ok).toBe(
      false,
    );
  });
});

describe("buildDeletionPlan", () => {
  const plan = buildDeletionPlan({
    userId: 77n,
    activeConsentKinds: ["marketing_email", "analytics", "terms_of_service", "privacy_policy"],
    effectiveAt: new Date(REQUESTED.getTime() + PRIVACY_DURATIONS.deletionGraceDays * DAY),
  });

  it("(1) anonimiza a identidade (email placeholder, handle/displayName null, deleted)", () => {
    expect(plan.accountAnonymization).toEqual({
      email: "deleted-77@anonymized.invalid",
      emailNormalized: "deleted-77@anonymized.invalid",
      handle: null,
      displayName: null,
      status: "deleted",
    });
  });

  it("(2) marca sessoes e tokens para revogacao", () => {
    expect(plan.revokeAllSessions).toBe(true);
    expect(plan.revokeAllTokens).toBe(true);
  });

  it("(3) so os consentimentos REVOGAVEIS sao revogados (ToS/privacy retidos)", () => {
    expect(plan.revokeConsentKinds).toEqual(["marketing_email", "analytics"]);
  });

  it("(4) plano separa delete/anonymize/retain por categoria (ordem canonica)", () => {
    const actions = new Set(plan.retention.map((r) => r.action));
    expect(actions.has("delete")).toBe(true);
    expect(actions.has("anonymize")).toBe(true);
    expect(actions.has("retain_indefinitely") || actions.has("retain_until")).toBe(true);
    // categoria de credencial: delete; audit: retain_until; consentimentos: retain
    const byCat = Object.fromEntries(plan.retention.map((r) => [r.category, r.action]));
    expect(byCat.account_credentials).toBe("delete");
    expect(byCat.security_audit).toBe("retain_until");
    expect(byCat.governance_consents).toBe("retain_indefinitely");
  });

  it("(5) nenhum segredo/senha/token aparece no plano", () => {
    const text = JSON.stringify(plan, (_, v) => (typeof v === "bigint" ? v.toString() : v)).toLowerCase();
    for (const t of ["password", "rawtoken", "secret", "tokenhash", "passwordhash"]) {
      expect(text.includes(t), t).toBe(false);
    }
  });
});
