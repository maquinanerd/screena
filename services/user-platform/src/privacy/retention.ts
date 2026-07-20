/**
 * Plano de retencao / minimizacao — regras puras (Backend C, unidade C3).
 *
 * PURO: sem rede, sem DB, sem relogio. Constroi decisoes de retencao por
 * categoria a partir da classificacao canonica (policy.ts), com ordem
 * DETERMINISTICA (DATA_CATEGORIES) e razao SEMPRE controlada (nunca texto
 * livre). Categoria desconhecida e retencao sem razao valida falham fechadas.
 */

import { type DomainResult, err, ok } from "../core/result.js";
import { classifyCategory } from "./policy.js";
import {
  DATA_CATEGORIES,
  type DataCategory,
  RETENTION_ACTIONS,
  type RetentionAction,
  RETENTION_REASONS,
  type RetentionDecision,
  type RetentionReason,
} from "./types.js";

const RETENTION_REASON_SET: ReadonlySet<string> = new Set(RETENTION_REASONS);
const RETENTION_ACTION_SET: ReadonlySet<string> = new Set(RETENTION_ACTIONS);

/** Razoes que justificam retencao INDEFINIDA (nunca por conveniencia comercial). */
const INDEFINITE_JUSTIFIED_REASONS: ReadonlySet<RetentionReason> = new Set([
  "legal_obligation",
  "security_obligation",
  "aggregate_anonymous",
  "referential_integrity",
]);

/** Categorias NUNCA exportaveis (segredo/credencial/hash/terceiro). */
export const NEVER_EXPORTABLE_CATEGORIES: ReadonlySet<DataCategory> = new Set<DataCategory>([
  "account_credentials",
  "security_sessions",
  "security_tokens",
  "security_ip",
  "security_audit",
  "third_party_catalog",
]);

export function isNeverExportable(category: DataCategory): boolean {
  return NEVER_EXPORTABLE_CATEGORIES.has(category);
}

/** Forma validada de uma retencao (sem categoria; usada por buildRetentionForCategory). */
export interface ValidatedRetention {
  readonly action: RetentionAction;
  readonly reason: RetentionReason;
  readonly retainForDays: number | null;
}

/**
 * Valida uma decisao de retencao arbitraria: razao deve ser CONTROLADA (nunca
 * vazia/livre); `retain_until` exige prazo positivo; `retain_indefinitely` so
 * com razao justificada. Fail-closed em acao/razao desconhecida.
 */
export function validateRetentionDecision(input: {
  readonly action: string;
  readonly reason: string;
  readonly retainForDays: number | null;
}): DomainResult<ValidatedRetention> {
  if (!RETENTION_ACTION_SET.has(input.action)) {
    return err("validation_failed", "acao de retencao invalida.");
  }
  if (!RETENTION_REASON_SET.has(input.reason)) {
    return err("validation_failed", "razao de retencao invalida (deve ser um codigo controlado).");
  }
  const action = input.action as RetentionAction;
  const reason = input.reason as RetentionReason;

  if (action === "retain_until") {
    if (
      input.retainForDays === null ||
      !Number.isInteger(input.retainForDays) ||
      input.retainForDays <= 0
    ) {
      return err("validation_failed", "retain_until exige prazo positivo em dias.");
    }
  }
  if (action === "retain_indefinitely" && !INDEFINITE_JUSTIFIED_REASONS.has(reason)) {
    return err(
      "validation_failed",
      "retencao indefinida so com razao justificada (nunca por conveniencia).",
    );
  }
  return ok({ action, reason, retainForDays: action === "retain_until" ? input.retainForDays : null });
}

/**
 * Decisao de retencao de UMA categoria, derivada da classificacao canonica.
 * Fail-closed: categoria desconhecida => err.
 */
export function buildRetentionForCategory(category: DataCategory): DomainResult<RetentionDecision> {
  const c = classifyCategory(category);
  if (c === null) {
    return err("validation_failed", "categoria de dado desconhecida.");
  }
  const validated = validateRetentionDecision({
    action: c.retentionAction,
    reason: c.retentionReason,
    retainForDays: c.retainForDays,
  });
  if (!validated.ok) return validated;
  return ok({
    category,
    action: validated.value.action,
    reason: validated.value.reason,
    retainForDays: validated.value.retainForDays,
  });
}

/**
 * Plano de retencao COMPLETO, em ORDEM CANONICA (DATA_CATEGORIES). Deterministico.
 */
export function buildFullRetentionPlan(): RetentionDecision[] {
  const plan: RetentionDecision[] = [];
  for (const category of DATA_CATEGORIES) {
    const decision = buildRetentionForCategory(category);
    // Todas as categorias canonicas classificam; se alguma falhasse seria bug.
    if (decision.ok) plan.push(decision.value);
  }
  return plan;
}
