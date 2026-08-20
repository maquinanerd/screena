/**
 * compute-run.ts — Núcleo PURO do worker de cálculo do Cinerie Score.
 *
 * O worker (bin/compute-cinerie-score.ts) projeta linhas do banco para cá; este
 * módulo decide o que calcular e devolve o que persistir. Sem rede, sem banco,
 * sem relógio próprio.
 *
 * ============================================================================
 * DE ONDE VEM CADA ELO
 * ============================================================================
 *  - A DECISÃO: a linha vigente de `data_usage_decisions` com
 *    `use_case = 'cinerie_score_display'` (emitida pelo registro legal por
 *    decisão do proprietário, 2026-08-20 — docs/legal/owner-authorization-2026-08-20.md).
 *    DUAS linhas vigentes são defeito de registro, não empate a resolver:
 *    `projectScoreDecision` lança.
 *  - A FÓRMULA: `approvedFormulaVersion` deriva do `policy_version` DA DECISÃO
 *    via o mapa fechado `CINERIE_SCORE_APPROVED_FORMULA_BY_DECISION_POLICY`
 *    (@screena/config). Decisão com policy fora do mapa produz
 *    `formula-not-registered` no engine — nunca um default de código (achado
 *    A7: o id jurídico não seleciona algoritmo; o mapa revisado seleciona).
 *  - AS NOTAS: só `external_ratings` com `display_allowed = true` e
 *    `data_usage_decision_id` preenchido. Derivar de nota não exibível seria
 *    lavá-la para a tela por outra porta.
 *  - O TMDB: `vote_average_tmdb`/`vote_count_tmdb` da própria linha do título,
 *    sob a decisão `internal_analytics` do TMDB (o id chega projetado). O piso
 *    de 50 votos é da fórmula, não daqui.
 */

import {
  CINERIE_SCORE_APPROVED_FORMULA_BY_DECISION_POLICY,
} from "@screena/config";
import type { CinerieScoreDecisionInput, CinerieScoreRatingInput } from "@screena/cinerie-score";

/** Projeção da linha vigente de decisão do score (o bin faz o SELECT). */
export interface ScoreDecisionRow {
  readonly id: string;
  readonly useCase: string;
  readonly stage: string;
  readonly displayAllowed: boolean;
  readonly derivativeAllowed: boolean;
  readonly isCurrent: boolean;
  readonly validFrom: Date;
  readonly validUntil: Date | null;
  readonly policyVersion: string | null;
}

/**
 * A decisão para o engine, ou `null` quando não há nenhuma vigente.
 *
 * Zero linhas => `null` (o bin explica e não escreve nada). Mais de uma linha
 * VIGENTE do mesmo use_case => defeito de registro: calcular sob "uma delas"
 * esconderia a ambiguidade — lança.
 */
export function projectScoreDecision(
  rows: readonly ScoreDecisionRow[],
): CinerieScoreDecisionInput | null {
  if (rows.length === 0) return null;
  if (rows.length > 1) {
    throw new Error(
      `cinerie-score: ${rows.length} decisoes VIGENTES de cinerie_score_display — ` +
        "ambiguidade de registro; corrija o banco antes de calcular " +
        `(ids: ${rows.map((r) => r.id).join(", ")})`,
    );
  }
  const row = rows[0]!;
  const policyVersion = row.policyVersion ?? "";
  return {
    useCase: row.useCase,
    stage: row.stage,
    displayAllowed: row.displayAllowed,
    derivativeAllowed: row.derivativeAllowed,
    isCurrent: row.isCurrent,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    policyVersion,
    // Mapa FECHADO: policy desconhecida vira string vazia, que o registro de
    // formulas nao tem — o engine devolve `formula-not-registered` e a execucao
    // RELATA em vez de chutar.
    approvedFormulaVersion:
      CINERIE_SCORE_APPROVED_FORMULA_BY_DECISION_POLICY[policyVersion] ?? "",
  };
}

/** Uma nota exibível projetada de `external_ratings`. */
export interface DisplayableRatingRow {
  readonly entityId: string;
  readonly ratingSource: string;
  readonly ratingValue: number;
  readonly ratingScale: number;
  readonly ratingCount: number | null;
  /** `critics` | `audience` | `editorial` | null (não classificado). */
  readonly scoreType: string | null;
  readonly dataUsageDecisionId: string | null;
}

/** A linha do título com o sinal do TMDB. */
export interface EntityTmdbRow {
  readonly entityId: string;
  readonly voteAverageTmdb: number | null;
  readonly voteCountTmdb: number | null;
}

/** Entrada montada por entidade, pronta para o engine. */
export interface EntityScoreInput {
  readonly entityId: string;
  readonly ratings: readonly CinerieScoreRatingInput[];
}

/**
 * Monta, por entidade, as notas que PODEM entrar no cálculo.
 *
 * Recusas silenciosas não existem: nota exibível sem `data_usage_decision_id`
 * é anomalia (o gate de exibição exige decisão) e entra em `skipped`, com
 * motivo, para o relato do bin. `scoreType` null idem — o engine/fórmula
 * precisa saber se é crítica ou audiência.
 */
export function buildEntityInputs(
  ratings: readonly DisplayableRatingRow[],
  tmdbRows: readonly EntityTmdbRow[],
  tmdbDecisionId: string | null,
): {
  readonly inputs: readonly EntityScoreInput[];
  readonly skipped: readonly { readonly entityId: string; readonly reason: string }[];
} {
  const byEntity = new Map<string, CinerieScoreRatingInput[]>();
  const skipped: { entityId: string; reason: string }[] = [];

  const push = (entityId: string, rating: CinerieScoreRatingInput): void => {
    const list = byEntity.get(entityId) ?? [];
    list.push(rating);
    byEntity.set(entityId, list);
  };

  for (const row of ratings) {
    if (row.dataUsageDecisionId === null) {
      skipped.push({
        entityId: row.entityId,
        reason: `nota ${row.ratingSource} exibivel sem data_usage_decision_id (anomalia de gate)`,
      });
      continue;
    }
    if (row.scoreType === null) {
      skipped.push({
        entityId: row.entityId,
        reason: `nota ${row.ratingSource} sem score_type (nao classificada)`,
      });
      continue;
    }
    push(row.entityId, {
      source: row.ratingSource,
      type: row.scoreType,
      value: row.ratingValue,
      best: row.ratingScale,
      count: row.ratingCount,
      licenseDecisionId: row.dataUsageDecisionId,
    });
  }

  for (const row of tmdbRows) {
    if (row.voteAverageTmdb === null) continue;
    if (tmdbDecisionId === null) {
      skipped.push({
        entityId: row.entityId,
        reason: "vote_average_tmdb presente mas sem decisao internal_analytics vigente do TMDB",
      });
      continue;
    }
    push(row.entityId, {
      source: "tmdb",
      type: "audience",
      value: row.voteAverageTmdb,
      best: 10,
      count: row.voteCountTmdb,
      licenseDecisionId: tmdbDecisionId,
    });
  }

  const inputs = [...byEntity.entries()].map(([entityId, list]) => ({
    entityId,
    ratings: list,
  }));
  return { inputs, skipped };
}
