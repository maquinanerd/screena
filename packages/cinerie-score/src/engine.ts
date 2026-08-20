/**
 * engine.ts — Orquestracao PURA do calculo do Cinerie Score.
 *
 * O engine nao sabe calcular nada: ele sabe (a) canonicalizar e hashear a
 * entrada, (b) verificar se ha decisao humana autorizando derivar, e (c)
 * delegar para a formula que ESSA decisao aprovou. Se qualquer elo falta, o
 * resultado e `blocked_by_decision`.
 *
 * O registro de producao (`PRODUCTION_FORMULA_REGISTRY`) esta VAZIO. Isso nao e
 * um TODO: e o estado correto enquanto docs/product/cinerie-score-decision.md
 * nao for aprovado. Testes registram formula fake para exercitar o caminho
 * feliz — e a fake NUNCA sai do teste.
 *
 * Offline-only: roda em worker/job, jamais no caminho de render (invariantes 3 e
 * 4). Usa `node:crypto` por isso.
 */

import { createHash } from "node:crypto";

import { CINERIE_SCORE_BLOCKED_VERSION } from "@screena/config";

import { cinerieScoreFormulaV1 } from "./formula-2026-08-v1.js";
import type {
  CinerieScoreBlocked,
  CinerieScoreBlockedReason,
  CinerieScoreDecisionInput,
  CinerieScoreFormula,
  CinerieScoreInput,
  CinerieScoreOutcome,
} from "./types.js";

/** Caso de uso exigido pela decisao que autoriza o Cinerie Score. */
export const CINERIE_SCORE_USE_CASE = "cinerie_score_display";

/** Registro versionado de formulas (imutavel apos criado). */
export interface CinerieScoreFormulaRegistry {
  get(version: string): CinerieScoreFormula | null;
  readonly versions: readonly string[];
}

/** Cria um registro a partir de uma lista de formulas. Versao duplicada e erro. */
export function createFormulaRegistry(
  formulas: readonly CinerieScoreFormula[],
): CinerieScoreFormulaRegistry {
  const byVersion = new Map<string, CinerieScoreFormula>();
  for (const formula of formulas) {
    if (byVersion.has(formula.version)) {
      throw new Error(`cinerie-score: formula duplicada para a versao "${formula.version}"`);
    }
    byVersion.set(formula.version, formula);
  }
  return {
    get: (version) => byVersion.get(version) ?? null,
    versions: [...byVersion.keys()],
  };
}

/**
 * Registro de PRODUCAO — uma formula, desde 20/08/2026.
 *
 * Este registro esteve VAZIO ate aqui, e o comentario anterior avisava: "se
 * alguem for tentado a so colocar uma media simples aqui, essa media seria uma
 * afirmacao editorial que nenhum humano aprovou". O aviso continua valendo em
 * cheio — e por isso `cinerie-score/2026-08-v1` NAO e uma media simples: e a
 * formula que o proprietario fechou, com pesos, grupos e piso de exibicao
 * explicitos, cada um com o criterio escrito em `formula-2026-08-v1.ts`.
 *
 * REGISTRAR NAO E LIGAR. Uma formula neste registro so e usada se a
 * `DataUsageDecision` vigente de `cinerie_score_display` a aprovar NOMINALMENTE
 * (`approvedFormulaVersion`). Sem essa decisao — o estado de hoje, porque
 * `derivative_allowed` e false em toda licenca de nota — o engine continua
 * devolvendo `blocked_by_decision`. Sao dois passos, e este e o primeiro.
 */
export const PRODUCTION_FORMULA_REGISTRY: CinerieScoreFormulaRegistry = createFormulaRegistry([
  cinerieScoreFormulaV1,
]);

/**
 * Canonicaliza a entrada antes de hashear.
 *
 * As notas sao ordenadas por (source, type): a ordem em que o banco devolveu as
 * linhas nao e informacao. Sem isso, o mesmo conjunto de notas em outra ordem
 * geraria outro `inputsHash`, e o unique (entity, version, inputs_hash)
 * deixaria o mesmo calculo entrar no historico varias vezes.
 *
 * `licenseDecisionId` ENTRA no hash: recalcular sob outra decisao de uso e
 * outro calculo, mesmo que os numeros sejam iguais.
 */
function canonicalize(input: CinerieScoreInput): string {
  const ratings = [...input.ratings]
    .sort((a, b) => (a.source === b.source ? a.type.localeCompare(b.type) : a.source.localeCompare(b.source)))
    .map((r) => [r.source, r.type, r.value, r.best, r.count, r.licenseDecisionId]);
  return JSON.stringify({ entityId: input.entityId, ratings });
}

/** Hash estavel das entradas (SHA-256 do JSON canonico). */
export function computeInputsHash(input: CinerieScoreInput): string {
  return createHash("sha256").update(canonicalize(input), "utf8").digest("hex");
}

const BLOCKED_MESSAGES: Record<CinerieScoreBlockedReason, string> = {
  "no-decision":
    "nao ha DataUsageDecision para cinerie_score_display (ver docs/product/cinerie-score-decision.md)",
  "decision-not-current": "a DataUsageDecision encontrada nao e a vigente",
  "decision-stage-not-approved": "a DataUsageDecision nao esta em approved_for_display",
  "decision-derivative-not-allowed":
    "a DataUsageDecision nao autoriza obra derivada (derivative_allowed=false); o Cinerie Score e derivado",
  "decision-out-of-validity": "a DataUsageDecision esta fora da vigencia",
  "formula-not-registered":
    "a versao de formula aprovada pela decisao nao esta registrada neste build",
  "rating-without-license-decision":
    "ha nota de entrada sem DataUsageDecision — derivar dela seria usar dado que ninguem autorizou derivar",
};

function blocked(
  reason: CinerieScoreBlockedReason,
  inputsHash: string,
  now: Date,
  version: string = CINERIE_SCORE_BLOCKED_VERSION,
): CinerieScoreBlocked {
  return {
    status: "blocked_by_decision",
    reason,
    blockedReason: BLOCKED_MESSAGES[reason],
    version,
    inputsHash,
    calculatedAt: now.toISOString(),
  };
}

/** Dependencias do calculo. `now` e injetado: o engine nao tem relogio proprio. */
export interface CinerieScoreDeps {
  readonly registry: CinerieScoreFormulaRegistry;
  /** Decisao vigente para `cinerie_score_display`, ou `null` quando nao ha. */
  readonly decision: CinerieScoreDecisionInput | null;
  readonly now: Date;
}

/**
 * Calcula o Cinerie Score — ou explica por que nao pode.
 *
 * Nunca lanca por falta de decisao/formula: devolve `blocked_by_decision`, que
 * e persistivel em `cinerie_score_calculations` e diagnosticavel. O caminho
 * bloqueado e o caminho ESPERADO hoje.
 */
export function computeCinerieScore(
  input: CinerieScoreInput,
  deps: CinerieScoreDeps,
): CinerieScoreOutcome {
  const inputsHash = computeInputsHash(input);

  // Nenhuma nota pode entrar sem decisao de uso propria. Checado ANTES da
  // decisao global: mesmo com o Cinerie Score aprovado, derivar de uma nota
  // nao-autorizada continua proibido.
  for (const rating of input.ratings) {
    if (rating.licenseDecisionId.trim() === "") {
      return blocked("rating-without-license-decision", inputsHash, deps.now);
    }
  }

  const decision = deps.decision;
  if (decision === null || decision.useCase !== CINERIE_SCORE_USE_CASE) {
    return blocked("no-decision", inputsHash, deps.now);
  }
  if (!decision.isCurrent) {
    return blocked("decision-not-current", inputsHash, deps.now);
  }
  if (decision.stage !== "approved_for_display" || !decision.displayAllowed) {
    return blocked("decision-stage-not-approved", inputsHash, deps.now);
  }
  if (!decision.derivativeAllowed) {
    return blocked("decision-derivative-not-allowed", inputsHash, deps.now);
  }
  const nowMs = deps.now.getTime();
  if (
    decision.validFrom.getTime() > nowMs ||
    (decision.validUntil !== null && decision.validUntil.getTime() <= nowMs)
  ) {
    return blocked("decision-out-of-validity", inputsHash, deps.now);
  }

  // O elo de versionamento: so calcula com a formula que ESTA decisao aprovou.
  // `approvedFormulaVersion`, nunca `policyVersion` (metadado juridico) — ver o
  // comentario do campo em types.ts (achado A7 da revisao adversarial).
  const formula = deps.registry.get(decision.approvedFormulaVersion);
  if (formula === null) {
    return blocked("formula-not-registered", inputsHash, deps.now, decision.approvedFormulaVersion);
  }

  return { status: "calculated", result: formula.compute(input, { inputsHash, now: deps.now }) };
}
