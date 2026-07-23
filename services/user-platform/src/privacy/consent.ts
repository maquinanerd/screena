/**
 * Consentimento versionado — regras puras (Backend C, unidade C3).
 *
 * PURO: sem rede, sem DB, sem relogio (`now` por parametro). Consentimento e
 * append-only (schema `user_consent_records`): cada mudanca e uma NOVA linha
 * {kind, granted, policyVersion, occurredAt}. O consentimento VIGENTE de uma
 * finalidade e o registro mais recente daquela finalidade.
 *
 * Invariantes LGPD:
 *  - ausencia de registro NUNCA equivale a granted;
 *  - nao ha checkbox pre-marcado (granted e sempre explicito na entrada);
 *  - revogado (ultimo granted=false) nao e ativo;
 *  - uma finalidade nao libera outra;
 *  - versao de politica diferente da exigida NAO autoriza (mesmo se granted);
 *  - base legal != consentimento (contract/legal_obligation) NAO e revogavel e
 *    nao pode ser representada como consentimento revogavel.
 */

import { type DomainResult, err, ok } from "../core/result.js";
import type { ConsentKind } from "../core/types.js";
import { CONSENT_LEGAL_BASIS, isRevocableConsent } from "./policy.js";
import type { LegalBasis } from "./types.js";

/** Registro de consentimento ja gravado (entrada de leitura). */
export interface StoredConsentRecord {
  readonly kind: ConsentKind;
  readonly granted: boolean;
  readonly policyVersion: string;
  readonly occurredAt: Date;
}

/** Plano de novo registro de consentimento (o adapter grava; append-only). */
export interface ConsentRecordPlan {
  readonly userId: bigint;
  readonly kind: ConsentKind;
  readonly granted: boolean;
  readonly policyVersion: string;
  readonly occurredAt: Date;
}

/** Descricao da base legal de uma finalidade (para nao representar falsamente). */
export interface ConsentBasisDescription {
  readonly kind: ConsentKind;
  readonly legalBasis: LegalBasis;
  readonly revocable: boolean;
}

export function describeConsentBasis(kind: ConsentKind): ConsentBasisDescription {
  const legalBasis: LegalBasis = CONSENT_LEGAL_BASIS[kind] ?? "legal_obligation";
  return { kind, legalBasis, revocable: legalBasis === "consent" };
}

/**
 * Encontra o registro VIGENTE de uma finalidade: o mais recente por
 * `occurredAt`. Determinismo em empate: vence o de MAIOR indice no array
 * (ultima ocorrencia informada). Retorna null quando nao ha registro.
 */
export function currentConsent(
  records: readonly StoredConsentRecord[],
  kind: ConsentKind,
): StoredConsentRecord | null {
  let current: StoredConsentRecord | null = null;
  for (const record of records) {
    if (record.kind !== kind) continue;
    if (
      current === null ||
      record.occurredAt.getTime() >= current.occurredAt.getTime() // >= : ultima ocorrencia vence o empate
    ) {
      current = record;
    }
  }
  return current;
}

/**
 * true SOMENTE quando a finalidade tem consentimento vigente concedido NA
 * VERSAO exigida. Ausencia, revogacao ou versao divergente => false
 * (fail-closed; nunca infere autorizacao).
 */
export function isConsentActive(input: {
  readonly records: readonly StoredConsentRecord[];
  readonly kind: ConsentKind;
  readonly requiredPolicyVersion: string;
}): boolean {
  const current = currentConsent(input.records, input.kind);
  if (current === null) return false;
  return current.granted === true && current.policyVersion === input.requiredPolicyVersion;
}

/**
 * Planeja registrar uma decisao de consentimento/aceite. `granted` e SEMPRE
 * explicito (sem default). `policyVersion` obrigatoria e nao vazia. Serve
 * tanto para consentimento (marketing/analytics) quanto para aceite de base
 * legal (ToS/privacy) — a diferenca de revogabilidade fica em `revokeConsent`.
 */
export function recordConsent(input: {
  readonly userId: bigint;
  readonly kind: ConsentKind;
  readonly granted: boolean;
  readonly policyVersion: string;
  readonly now: Date;
}): DomainResult<ConsentRecordPlan> {
  if (input.policyVersion.trim().length === 0) {
    return err("validation_failed", "versao de politica e obrigatoria.");
  }
  return ok({
    userId: input.userId,
    kind: input.kind,
    granted: input.granted,
    policyVersion: input.policyVersion,
    occurredAt: input.now,
  });
}

/**
 * Planeja REVOGAR um consentimento. So finalidades de base legal `consent` sao
 * revogaveis; ToS/privacy (contract/legal_obligation) NAO podem ser revogados
 * aqui (revogar = encerrar a conta) — fail-closed com err("forbidden").
 * Produz um novo registro append-only com granted=false.
 */
export function revokeConsent(input: {
  readonly userId: bigint;
  readonly kind: ConsentKind;
  readonly policyVersion: string;
  readonly now: Date;
}): DomainResult<ConsentRecordPlan> {
  if (!isRevocableConsent(input.kind)) {
    return err(
      "forbidden",
      "esta finalidade nao e revogavel; sua base legal nao e consentimento.",
    );
  }
  if (input.policyVersion.trim().length === 0) {
    return err("validation_failed", "versao de politica e obrigatoria.");
  }
  return ok({
    userId: input.userId,
    kind: input.kind,
    granted: false,
    policyVersion: input.policyVersion,
    occurredAt: input.now,
  });
}
