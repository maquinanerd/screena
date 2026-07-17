/**
 * plan.ts — Planejamento PURO do registro de autorização.
 *
 * Recebe a autorização declarada (`authorization-spec.ts`) + uma PROJEÇÃO do
 * estado atual do banco (licenças e decisões vigentes) e decide, sem tocar em
 * nada, o que criar / supersedir / manter. O bin (`bin/legal.ts`) consulta o
 * banco, projeta o estado, chama isto e — só sob `--confirm` — aplica.
 *
 * Idempotência é a propriedade central: rodar duas vezes o MESMO spec sobre o
 * MESMO estado não deve produzir escrita na segunda vez. Por isso cada alvo é
 * comparado campo a campo com o vigente: igual => `keep`, diferente => nova
 * versão com `supersedes_id` (histórico preservado, nunca UPDATE destrutivo).
 */

import type { AuthorizationEntry, DecisionTarget, LicenseTarget, SourceRole } from "./authorization-spec.js";

/** Projeção da licença VIGENTE (só o necessário para comparar/agrupar). */
export interface CurrentLicense {
  readonly id: string;
  readonly sourceKey: string;
  readonly contentType: string;
  readonly ratingSourceKey: string | null;
  readonly providerKey: string | null;
  readonly territory: string | null;
  readonly licenseStatus: string;
  readonly displayAllowed: boolean;
  readonly logoAllowed: boolean;
  readonly scoreAllowed: boolean;
  readonly reviewQuoteAllowed: boolean;
  readonly requiresAttribution: boolean;
  readonly requiresLinkback: boolean;
  readonly attributionText: string | null;
  readonly policyVersion: string | null;
}

/** Projeção da decisão VIGENTE. */
export interface CurrentDecision {
  readonly id: string;
  readonly sourceLicenseId: string;
  readonly useCase: string;
  readonly territory: string | null;
  readonly stage: string;
  readonly displayAllowed: boolean;
  readonly storageAllowed: boolean;
  readonly derivativeAllowed: boolean;
  readonly attributionRequired: boolean;
  readonly linkbackRequired: boolean;
  readonly policyVersion: string | null;
}

export type ActionKind = "create" | "supersede" | "keep";

/** Ação planejada para uma decisão. */
export interface DecisionPlan {
  readonly action: ActionKind;
  /** Id da decisão vigente quando `supersede`/`keep`. */
  readonly currentId: string | null;
  readonly target: DecisionTarget;
}

/** Ação planejada para uma entrada (licença + suas decisões). */
export interface EntryPlan {
  readonly label: string;
  readonly role: SourceRole;
  readonly license: {
    readonly action: ActionKind;
    readonly currentId: string | null;
    readonly target: LicenseTarget;
  };
  readonly decisions: readonly DecisionPlan[];
  /** Decisões da licença antiga a desativar (só quando a licença é superseded). */
  readonly deactivateDecisionIds: readonly string[];
}

/** Resultado completo do planejamento. */
export interface AuthorizationPlan {
  readonly entries: readonly EntryPlan[];
  readonly summary: {
    readonly licensesCreate: number;
    readonly licensesSupersede: number;
    readonly licensesKeep: number;
    readonly decisionsCreate: number;
    readonly decisionsSupersede: number;
    readonly decisionsKeep: number;
  };
}

/** Chave natural de agrupamento (espelha os índices únicos parciais do banco). */
function licenseGroupKey(l: {
  sourceKey: string;
  contentType: string;
  providerKey: string | null;
  territory: string | null;
}): string {
  return [l.sourceKey, l.contentType, l.providerKey ?? "", l.territory ?? ""].join("");
}

function decisionGroupKey(sourceLicenseId: string, useCase: string, territory: string | null): string {
  return [sourceLicenseId, useCase, territory ?? ""].join("");
}

function licenseMatches(current: CurrentLicense, target: LicenseTarget): boolean {
  return (
    current.licenseStatus === target.licenseStatus &&
    current.displayAllowed === target.displayAllowed &&
    current.logoAllowed === target.logoAllowed &&
    current.scoreAllowed === target.scoreAllowed &&
    current.reviewQuoteAllowed === target.reviewQuoteAllowed &&
    current.requiresAttribution === target.requiresAttribution &&
    current.requiresLinkback === target.requiresLinkback &&
    (current.ratingSourceKey ?? null) === target.ratingSourceKey &&
    (current.attributionText ?? "") === target.attributionText &&
    (current.policyVersion ?? "") === target.policyVersion
  );
}

function decisionMatches(current: CurrentDecision, target: DecisionTarget): boolean {
  return (
    current.useCase === target.useCase &&
    (current.territory ?? null) === target.territory &&
    current.stage === target.stage &&
    current.displayAllowed === target.displayAllowed &&
    current.storageAllowed === target.storageAllowed &&
    current.derivativeAllowed === target.derivativeAllowed &&
    current.attributionRequired === target.attributionRequired &&
    current.linkbackRequired === target.linkbackRequired &&
    (current.policyVersion ?? "") === target.policyVersion
  );
}

/**
 * Planeja o registro. `entries` já inclui as estáticas + as de provedores reais
 * (o bin monta a lista antes de chamar).
 */
export function planAuthorization(
  entries: readonly AuthorizationEntry[],
  currentLicenses: readonly CurrentLicense[],
  currentDecisions: readonly CurrentDecision[],
): AuthorizationPlan {
  const licenseByGroup = new Map<string, CurrentLicense>();
  for (const l of currentLicenses) licenseByGroup.set(licenseGroupKey(l), l);

  const decisionByGroup = new Map<string, CurrentDecision>();
  const decisionsByLicense = new Map<string, CurrentDecision[]>();
  for (const d of currentDecisions) {
    decisionByGroup.set(decisionGroupKey(d.sourceLicenseId, d.useCase, d.territory), d);
    const arr = decisionsByLicense.get(d.sourceLicenseId) ?? [];
    arr.push(d);
    decisionsByLicense.set(d.sourceLicenseId, arr);
  }

  const summary = {
    licensesCreate: 0,
    licensesSupersede: 0,
    licensesKeep: 0,
    decisionsCreate: 0,
    decisionsSupersede: 0,
    decisionsKeep: 0,
  };

  const planned: EntryPlan[] = entries.map((entry) => {
    const current = licenseByGroup.get(licenseGroupKey(entry.license));
    let licenseAction: ActionKind;
    let currentId: string | null;
    let deactivate: string[] = [];

    if (current === undefined) {
      licenseAction = "create";
      currentId = null;
      summary.licensesCreate += 1;
    } else if (licenseMatches(current, entry.license)) {
      licenseAction = "keep";
      currentId = current.id;
      summary.licensesKeep += 1;
    } else {
      licenseAction = "supersede";
      currentId = current.id;
      summary.licensesSupersede += 1;
      // A licença antiga sai de cena: suas decisões referenciam uma licença que
      // deixará de ser vigente, então são desativadas (o read path já ignora
      // decisão cuja licença não é is_current — isto só limpa o estado).
      deactivate = (decisionsByLicense.get(current.id) ?? []).map((d) => d.id);
    }

    const licenseKept = licenseAction === "keep";
    const decisions: DecisionPlan[] = entry.decisions.map((target) => {
      // Decisão só pode ser "mantida"/"supersedida" quando a licença é a MESMA
      // (mesmo id). Licença nova => toda decisão é criada do zero.
      if (!licenseKept || currentId === null) {
        summary.decisionsCreate += 1;
        return { action: "create", currentId: null, target };
      }
      const currentDecision = decisionByGroup.get(decisionGroupKey(currentId, target.useCase, target.territory));
      if (currentDecision === undefined) {
        summary.decisionsCreate += 1;
        return { action: "create", currentId: null, target };
      }
      if (decisionMatches(currentDecision, target)) {
        summary.decisionsKeep += 1;
        return { action: "keep", currentId: currentDecision.id, target };
      }
      summary.decisionsSupersede += 1;
      return { action: "supersede", currentId: currentDecision.id, target };
    });

    return {
      label: entry.label,
      role: entry.role,
      license: { action: licenseAction, currentId, target: entry.license },
      decisions,
      deactivateDecisionIds: deactivate,
    };
  });

  return { entries: planned, summary };
}

/** `true` quando não há nada a escrever (idempotência atingida). */
export function isPlanClean(plan: AuthorizationPlan): boolean {
  const s = plan.summary;
  return (
    s.licensesCreate === 0 &&
    s.licensesSupersede === 0 &&
    s.decisionsCreate === 0 &&
    s.decisionsSupersede === 0
  );
}

/**
 * Guarda de segurança PURA: o plano NUNCA pode conter uma decisão que autorize
 * o Cinerie Score ou uma obra derivada. Chamada antes de qualquer apply — se
 * disparar, é bug no spec, não estado a corrigir.
 */
export function assertNoBlockedGrants(plan: AuthorizationPlan): void {
  for (const entry of plan.entries) {
    for (const d of entry.decisions) {
      if ((d.target.useCase as string) === "cinerie_score_display") {
        throw new Error(`plano invalido: decisao cinerie_score_display em "${entry.label}" (o score e bloqueado)`);
      }
      if (d.target.derivativeAllowed) {
        throw new Error(`plano invalido: derivative_allowed em "${entry.label}" (obra derivada nao autorizada)`);
      }
    }
    if (entry.license.target.logoAllowed || entry.license.target.reviewQuoteAllowed) {
      throw new Error(`plano invalido: logo/review_quote em "${entry.label}" (nao autorizados)`);
    }
  }
}
