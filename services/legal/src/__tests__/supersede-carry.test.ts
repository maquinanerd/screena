/**
 * supersede-carry.test.ts — O SUPERSEDE TEM DE LEVAR AS LINHAS JUNTO.
 *
 * O QUE ESTE ARQUIVO EXISTE PARA IMPEDIR. Em 2026-08-20 um
 * `legal sources apply --confirm` com `supersede=72` apagou a coluna direita do
 * site: 453 notas e 874 ofertas sumiram da tela com `display_allowed` INTACTO
 * no banco. A causa nao era a coluna — era o PONTEIRO. `external_ratings` e
 * `watch_availability` guardam o id de uma LINHA de `data_usage_decisions`; o
 * supersede desativa essa linha e cria outra, com id novo, e ninguem repontuava
 * o dado. Todo gate de leitura exige `is_current` na decisao E na licenca-mae.
 *
 * Por isso ha DOIS niveis de teste aqui:
 *   1. o PLANO decide certo quem assume as linhas (puro);
 *   2. o LACO DE ESCRITA realmente emite o UPDATE (executor SQL dublado).
 *
 * O laco de escrita (`applyAuthorizationWithin`) nao tinha NENHUM teste ate
 * aqui — so validadores de PostgreSQL real, e o de supersede promovia as notas
 * DEPOIS da leva nova, ou seja, num estado onde a orfandade nao pode acontecer.
 * Era exatamente esse o ponto cego.
 */

import { describe, expect, it } from "vitest";

import {
  applyAuthorizationWithin,
  type SqlExecutor,
} from "../apply.js";
import type { AuthorizationEntry, DecisionTarget, LicenseTarget } from "../authorization-spec.js";
import { planAuthorizationImpact, type DecisionBinding } from "../impact.js";
import { planAuthorization, type CurrentDecision, type CurrentLicense } from "../plan.js";

const POLICY = "cinerie-source-auth/2026-08-v2";

function licenseTarget(over: Partial<LicenseTarget> = {}): LicenseTarget {
  return {
    sourceKey: "imdb",
    contentType: "rating",
    ratingSourceKey: "imdb",
    providerKey: null,
    territory: null,
    licenseStatus: "third_party",
    displayAllowed: true,
    logoAllowed: false,
    logoBasis: null,
    logoRationale: "fixture de teste",
    logoAsset: null,
    scoreAllowed: true,
    reviewQuoteAllowed: false,
    requiresAttribution: true,
    requiresLinkback: true,
    attributionText: "Nota fornecida por IMDb",
    policyVersion: POLICY,
    notes: null,
    ...over,
  } as LicenseTarget;
}

function decisionTarget(over: Partial<DecisionTarget> = {}): DecisionTarget {
  return {
    useCase: "rating_display",
    territory: "BR",
    stage: "approved_for_display",
    displayAllowed: true,
    storageAllowed: true,
    derivativeAllowed: false,
    derivativeBasis: null,
    attributionRequired: true,
    linkbackRequired: true,
    policyVersion: POLICY,
    ...over,
  } as DecisionTarget;
}

function entry(over: { license?: Partial<LicenseTarget>; decisions?: readonly DecisionTarget[] } = {}): AuthorizationEntry {
  return {
    label: "IMDb — notas",
    role: "editorial-rating-source",
    license: licenseTarget(over.license),
    decisions: over.decisions ?? [decisionTarget()],
  };
}

/** O estado VIGENTE: uma licenca de rating com uma decisao de exibicao pendurada. */
function currentState(licenseOver: Partial<CurrentLicense> = {}): {
  licenses: CurrentLicense[];
  decisions: CurrentDecision[];
} {
  const licenses: CurrentLicense[] = [
    {
      id: "8",
      sourceKey: "imdb",
      contentType: "rating",
      ratingSourceKey: "imdb",
      providerKey: null,
      territory: null,
      licenseStatus: "third_party",
      displayAllowed: true,
      logoAllowed: false,
      scoreAllowed: true,
      reviewQuoteAllowed: false,
      requiresAttribution: true,
      // Divergente do alvo => forca SUPERSEDE da licenca (foi a mudanca real de
      // 2026-08-12: a dispensa de linkback da OMDb).
      requiresLinkback: false,
      attributionText: "Nota fornecida por IMDb",
      policyVersion: "cinerie-source-auth/2026-07-v0",
      ...licenseOver,
    },
  ];
  const decisions: CurrentDecision[] = [
    {
      id: "31",
      sourceLicenseId: "8",
      useCase: "rating_display",
      territory: "BR",
      stage: "approved_for_display",
      displayAllowed: true,
      storageAllowed: true,
      derivativeAllowed: false,
      attributionRequired: true,
      linkbackRequired: false,
      policyVersion: "cinerie-source-auth/2026-07-v0",
    },
  ];
  return { licenses, decisions };
}

describe("plano — quem assume as linhas quando a licenca e supersedida", () => {
  it("licenca nova concede o mesmo uso: as linhas sao CARREGADAS", () => {
    const { licenses, decisions } = currentState();
    const plan = planAuthorization([entry()], licenses, decisions);

    expect(plan.summary.licensesSupersede).toBe(1);
    const carries = plan.entries[0]!.carries;
    expect(carries).toHaveLength(1);
    expect(carries[0]!.fromDecisionId).toBe("31");
    expect(carries[0]!.verdict).toBe("carry");
    // Aponta para a decisao NOVA por indice — o id ainda nao existe no plano.
    expect(carries[0]!.toDecisionIndex).toBe(0);
  });

  it("licenca nova mais restritiva (display_allowed=false): RETEM, com motivo", () => {
    const { licenses, decisions } = currentState();
    const plan = planAuthorization(
      [entry({ license: { displayAllowed: false }, decisions: [decisionTarget({ displayAllowed: false, stage: "approved_for_internal_use" })] })],
      licenses,
      decisions,
    );

    const carry = plan.entries[0]!.carries[0]!;
    expect(carry.verdict).toBe("withhold");
    expect(carry.toDecisionIndex).toBeNull();
    expect(carry.reason).toContain("display_allowed=false");
  });

  it("licenca nova sem score_allowed: RETEM (exibir a nota e exibir o numero)", () => {
    const { licenses, decisions } = currentState();
    const plan = planAuthorization([entry({ license: { scoreAllowed: false } })], licenses, decisions);
    const carry = plan.entries[0]!.carries[0]!;
    expect(carry.verdict).toBe("withhold");
    expect(carry.reason).toContain("score_allowed=false");
  });

  it("leva nova sem decisao para o territorio de exibicao: RETEM", () => {
    const { licenses, decisions } = currentState();
    const plan = planAuthorization(
      [entry({ decisions: [decisionTarget({ territory: "US" })] })],
      licenses,
      decisions,
    );
    const carry = plan.entries[0]!.carries[0]!;
    expect(carry.verdict).toBe("withhold");
    expect(carry.reason).toContain("BR");
  });

  it("decisao territorial vence a global quando as duas existem", () => {
    const { licenses, decisions } = currentState();
    const plan = planAuthorization(
      [entry({ decisions: [decisionTarget({ territory: null }), decisionTarget({ territory: "BR" })] })],
      licenses,
      decisions,
    );
    expect(plan.entries[0]!.carries[0]!.toDecisionIndex).toBe(1);
  });

  it("licenca MANTIDA com decisao supersedida tambem carrega (o id da decisao muda)", () => {
    const { licenses, decisions } = currentState({ requiresLinkback: true, policyVersion: POLICY });
    // Licenca identica ao alvo => keep. Decisao diverge => supersede da decisao.
    const plan = planAuthorization([entry()], licenses, decisions);
    expect(plan.summary.licensesKeep).toBe(1);
    expect(plan.summary.decisionsSupersede).toBe(1);
    const carry = plan.entries[0]!.carries[0]!;
    expect(carry.verdict).toBe("carry");
    expect(carry.fromDecisionId).toBe("31");
  });

  it("licenca mantida e decisao mantida: nao ha nada a carregar", () => {
    const { licenses, decisions } = currentState({ requiresLinkback: true, policyVersion: POLICY });
    const kept = decisions.map((d) => ({ ...d, linkbackRequired: true, policyVersion: POLICY }));
    const plan = planAuthorization([entry()], licenses, kept);
    expect(plan.entries[0]!.carries).toHaveLength(0);
  });
});

describe("impacto — o review tem de dizer quantas linhas vai ocultar", () => {
  const bindings = new Map<string, DecisionBinding>([["31", { ratings: 453, offers: 874 }]]);

  it("carregadas nao entram na contagem de ocultadas", () => {
    const { licenses, decisions } = currentState();
    const impact = planAuthorizationImpact(planAuthorization([entry()], licenses, decisions), bindings);
    expect(impact.summary.carriedRatings).toBe(453);
    expect(impact.summary.carriedOffers).toBe(874);
    expect(impact.summary.hiddenRatings).toBe(0);
    expect(impact.summary.hiddenOffers).toBe(0);
    expect(impact.hidden).toHaveLength(0);
  });

  it("licenca mais restritiva: a contagem do que SOME aparece, com motivo", () => {
    const { licenses, decisions } = currentState();
    const plan = planAuthorization([entry({ license: { displayAllowed: false }, decisions: [decisionTarget({ displayAllowed: false })] })], licenses, decisions);
    const impact = planAuthorizationImpact(plan, bindings);
    expect(impact.summary.hiddenRatings).toBe(453);
    expect(impact.summary.hiddenOffers).toBe(874);
    expect(impact.hidden[0]!.reason).not.toBe("");
    expect(impact.hidden[0]!.label).toBe("IMDb — notas");
  });

  it("decisao sem nenhuma linha pendurada nao polui o relatorio", () => {
    const { licenses, decisions } = currentState();
    const impact = planAuthorizationImpact(planAuthorization([entry()], licenses, decisions), new Map());
    expect(impact.carried).toHaveLength(0);
    expect(impact.hidden).toHaveLength(0);
  });
});

/** Executor SQL dublado: registra o SQL emitido e devolve ids previsiveis. */
function recordingExecutor(state: { licenses: CurrentLicense[]; decisions: CurrentDecision[] }): {
  tx: SqlExecutor;
  statements: string[];
} {
  const statements: string[] = [];
  let nextId = 900;
  const flatten = (q: TemplateStringsArray, values: readonly unknown[]): string =>
    q.reduce((acc, part, i) => acc + part + (i < values.length ? String(values[i]) : ""), "");

  const tx: SqlExecutor = {
    async $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T> {
      statements.push(flatten(query, values).replace(/\s+/g, " ").trim());
      return [{ id: BigInt(nextId++) }] as unknown as T;
    },
    async $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number> {
      statements.push(flatten(query, values).replace(/\s+/g, " ").trim());
      return 1;
    },
    async $queryRawUnsafe<T>(query: string): Promise<T> {
      if (query.includes("FROM source_licenses")) {
        return state.licenses.map((l) => ({
          id: l.id,
          source_key: l.sourceKey,
          content_type: l.contentType,
          rating_source_key: l.ratingSourceKey,
          provider_key: l.providerKey,
          territory_code: l.territory,
          license_status: l.licenseStatus,
          display_allowed: l.displayAllowed,
          logo_allowed: l.logoAllowed,
          score_allowed: l.scoreAllowed,
          review_quote_allowed: l.reviewQuoteAllowed,
          requires_attribution: l.requiresAttribution,
          requires_linkback: l.requiresLinkback,
          attribution_text: l.attributionText,
          policy_version: l.policyVersion,
        })) as unknown as T;
      }
      if (query.includes("FROM data_usage_decisions")) {
        return state.decisions.map((d) => ({
          id: d.id,
          source_license_id: d.sourceLicenseId,
          use_case: d.useCase,
          territory: d.territory,
          stage: d.stage,
          display_allowed: d.displayAllowed,
          storage_allowed: d.storageAllowed,
          derivative_allowed: d.derivativeAllowed,
          attribution_required: d.attributionRequired,
          linkback_required: d.linkbackRequired,
          policy_version: d.policyVersion,
        })) as unknown as T;
      }
      return [] as unknown as T;
    },
    async $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number> {
      statements.push(`${query.replace(/\s+/g, " ").trim()} :: ${values.map(String).join(",")}`);
      return 1;
    },
  };
  return { tx, statements };
}

const IDENTITY = { reviewer: "Pablo Eduardo — proprietario da Cinerie", reason: "teste" };

describe("laco de escrita — o UPDATE que devolve o dado para a tela", () => {
  it("supersede emite o repontuamento das DUAS tabelas, para a decisao nova", async () => {
    const state = currentState();
    const { tx, statements } = recordingExecutor(state);
    await applyAuthorizationWithin(tx, [entry()], IDENTITY);

    const repointed = statements.filter((s) => s.includes("data_usage_decision_id"));
    expect(repointed).toHaveLength(2);
    expect(repointed.some((s) => s.includes('UPDATE "external_ratings"'))).toBe(true);
    expect(repointed.some((s) => s.includes('UPDATE "watch_availability"'))).toBe(true);
    // De 31 (a decisao que morreu) para 901 (a decisao inserida nesta transacao:
    // 900 e a licenca nova, 901 e a decisao nova).
    for (const s of repointed) expect(s.endsWith(":: 901,31")).toBe(true);
  });

  it("repontua DEPOIS de inserir a decisao nova (o destino tem de existir)", async () => {
    const state = currentState();
    const { tx, statements } = recordingExecutor(state);
    await applyAuthorizationWithin(tx, [entry()], IDENTITY);

    const insertIdx = statements.findIndex((s) => s.includes('INSERT INTO "data_usage_decisions"'));
    const repointIdx = statements.findIndex((s) => s.includes('UPDATE "external_ratings"'));
    expect(insertIdx).toBeGreaterThanOrEqual(0);
    expect(repointIdx).toBeGreaterThan(insertIdx);
  });

  it("licenca mais restritiva: NAO repontua nada (as linhas somem, como planejado)", async () => {
    const state = currentState();
    const { tx, statements } = recordingExecutor(state);
    await applyAuthorizationWithin(
      tx,
      [entry({ license: { displayAllowed: false }, decisions: [decisionTarget({ displayAllowed: false })] })],
      IDENTITY,
    );
    expect(statements.filter((s) => s.includes('UPDATE "external_ratings"'))).toHaveLength(0);
    expect(statements.filter((s) => s.includes('UPDATE "watch_availability"'))).toHaveLength(0);
  });

  it("plano limpo nao escreve nada (idempotencia preservada)", async () => {
    const { licenses, decisions } = currentState({ requiresLinkback: true, policyVersion: POLICY });
    const kept = decisions.map((d) => ({ ...d, linkbackRequired: true, policyVersion: POLICY }));
    const { tx, statements } = recordingExecutor({ licenses, decisions: kept });
    await applyAuthorizationWithin(tx, [entry()], IDENTITY);
    expect(statements.filter((s) => s.startsWith("UPDATE") || s.startsWith("INSERT"))).toHaveLength(0);
  });
});
