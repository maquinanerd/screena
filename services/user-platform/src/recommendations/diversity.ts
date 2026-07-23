/**
 * diversity.ts — Diversidade sobre o ranking ja produzido (Backend C, C6B).
 *
 * PURO e DETERMINISTICO: sem rede, sem DB, sem relogio, sem Math.random, sem
 * jitter, sem shuffle. Aplica CAPS (genero primario, franquia, tipo) sobre o
 * ranking de C6A, DEPOIS da pontuacao e ANTES do limite persistido. NAO recalcula
 * score, confianca nem razoes; NAO reintroduz candidato que o ranking ja
 * excluiu (opera so sobre o conjunto recebido); NAO modifica a entrada.
 *
 * Independencia de ordem de entrada: reestabelece uma ORDEM TOTAL determinista
 * (score desc -> confianca desc -> entityId asc -> entityType asc) antes de
 * aplicar caps. Assim o resultado independe da ordem do array de entrada — so a
 * posicao SEMANTICA (score/confianca) importa. (Nota: RankedRecommendation nao
 * expoe `popularity`, entao o desempate por popularidade de C6A nao e replicavel
 * aqui; ties de score E confianca desempatam por ref — consequencia documentada
 * do shape minimizado, nao um defeito.)
 *
 * Genero primario: `genres[0]` (primeiro genero da lista JA canonica do
 * candidato). Nao reinterpreta nem reordena os generos; nao os modifica.
 * Franquia: so agrupa quando ha `franchiseKey` confiavel; ausencia = franquia
 * DESCONHECIDA (tratada individualmente, jamais agrupando candidatos).
 *
 * Chave de atributo: o mapa `attributesByRefKey` DEVE ser indexado por
 * `diversityRefKey(ref)` (exportado) — a mesma funcao que o dominio usa por
 * dentro. Isso elimina qualquer divergencia de convencao de chave.
 */

import { type DomainResult, err, ok } from "../core/result.js";
import type {
  DiversityPolicy,
  RankedRecommendation,
  RecommendationEntityRef,
} from "./types.js";

/**
 * Atributos de diversidade de UMA entidade (mapeados por `diversityRefKey`). NAO
 * fazem parte de RankedRecommendation (shape minimizado); a camada que monta o
 * snapshot os fornece a partir do catalogo. Ausencia total => item tratado como
 * genero/franquia desconhecidos (nunca capado por essas dimensoes).
 */
export interface DiversityAttributes {
  /** Generos em ordem canonica (NAO modificados). Primario = `genres[0]`. */
  readonly genres: readonly string[];
  /** Chave estavel de franquia/colecao; `null` = desconhecida (individual). */
  readonly franchiseKey: string | null;
}

/** Auditoria da diversidade (metadata interna do snapshot; nunca texto de UI). */
export interface DiversityAudit {
  readonly policyVersion: string;
  readonly appliedCaps: {
    readonly maxPerPrimaryGenre: number;
    readonly maxPerFranchise: number;
    readonly maxPerEntityType: number;
    readonly outputLimit: number;
    readonly effectiveLimit: number;
  };
  readonly inputCount: number;
  readonly outputCount: number;
  /** Itens excluidos POR CAP e NAO repostos por fallback (diversidade real). */
  readonly skippedByCap: number;
}

/** Ranking diversificado (itens reposicionados 0..n-1) + auditoria. */
export interface DiversifiedRanking {
  readonly items: readonly RankedRecommendation[];
  readonly audit: DiversityAudit;
}

/**
 * Chave canonica e ESTAVEL de uma entidade para indexar `attributesByRefKey`.
 * Separador explicito (`:`) — o dominio e o chamador usam ESTA funcao, nunca
 * concatenacao ad hoc.
 */
export function diversityRefKey(ref: RecommendationEntityRef): string {
  return `${ref.entityType}:${ref.entityId.toString()}`;
}

function isPositiveIntCap(value: number): boolean {
  return Number.isInteger(value) && value >= 1;
}

/** Ordem total determinista, independente da ordem do array de entrada. */
function compareForDiversity(a: RankedRecommendation, b: RankedRecommendation): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.confidence !== b.confidence) return b.confidence - a.confidence;
  if (a.ref.entityId !== b.ref.entityId) return a.ref.entityId < b.ref.entityId ? -1 : 1;
  return a.ref.entityType < b.ref.entityType ? -1 : a.ref.entityType > b.ref.entityType ? 1 : 0;
}

export interface ApplyDiversityInput {
  readonly items: readonly RankedRecommendation[];
  readonly attributesByRefKey: ReadonlyMap<string, DiversityAttributes>;
  readonly policy: DiversityPolicy;
  /** Tamanho desejado do output (>= 0 inteiro). Efetivo = min(limit, outputLimit). */
  readonly limit: number;
}

/**
 * Aplica diversidade e retorna o ranking diversificado. Greedy que preserva os
 * itens de maior posicao quando o cap permite, marca como "skipped" os que
 * estouram um cap e, se sobrarem vagas, REPOE com os proximos elegiveis (fallback
 * relaxando caps) para nunca devolver menos do que caberia. Fail-closed para
 * limite negativo/nao-inteiro ou politica invalida.
 */
export function applyDiversity(input: ApplyDiversityInput): DomainResult<DiversifiedRanking> {
  const { items, attributesByRefKey, policy } = input;

  if (typeof policy.version !== "string" || policy.version.length === 0) {
    return err("validation_failed", "politica de diversidade invalida.", ["version vazia"]);
  }
  if (
    !isPositiveIntCap(policy.maxPerPrimaryGenre) ||
    !isPositiveIntCap(policy.maxPerFranchise) ||
    !isPositiveIntCap(policy.maxPerEntityType)
  ) {
    return err("validation_failed", "politica de diversidade invalida.", [
      "caps devem ser inteiros >= 1",
    ]);
  }
  if (!Number.isInteger(policy.outputLimit) || policy.outputLimit < 0) {
    return err("validation_failed", "politica de diversidade invalida.", [
      "outputLimit deve ser inteiro >= 0",
    ]);
  }
  if (!Number.isInteger(input.limit) || input.limit < 0) {
    return err("validation_failed", "limite de diversidade invalido.", ["limit deve ser inteiro >= 0"]);
  }

  const effectiveLimit = Math.min(input.limit, policy.outputLimit);
  const audit = (outputCount: number, skippedByCap: number): DiversityAudit => ({
    policyVersion: policy.version,
    appliedCaps: {
      maxPerPrimaryGenre: policy.maxPerPrimaryGenre,
      maxPerFranchise: policy.maxPerFranchise,
      maxPerEntityType: policy.maxPerEntityType,
      outputLimit: policy.outputLimit,
      effectiveLimit,
    },
    inputCount: items.length,
    outputCount,
    skippedByCap,
  });

  if (effectiveLimit === 0 || items.length === 0) {
    return ok({ items: [], audit: audit(0, 0) });
  }

  const ordered = [...items].sort(compareForDiversity);

  const selected = new Set<string>();
  const genreCount = new Map<string, number>();
  const franchiseCount = new Map<string, number>();
  const typeCount = new Map<string, number>();
  const capSkipped: RankedRecommendation[] = [];

  for (const it of ordered) {
    if (selected.size >= effectiveLimit) break;
    const key = diversityRefKey(it.ref);
    if (selected.has(key)) continue; // dedup defensivo (refs ja unicas apos C6A)

    const attrs = attributesByRefKey.get(key);
    const primaryGenre = attrs && attrs.genres.length > 0 ? attrs.genres[0]! : null;
    const franchiseKey = attrs ? attrs.franchiseKey : null;
    const entityType = it.ref.entityType;

    const genreOk =
      primaryGenre === null || (genreCount.get(primaryGenre) ?? 0) < policy.maxPerPrimaryGenre;
    const franchiseOk =
      franchiseKey === null || (franchiseCount.get(franchiseKey) ?? 0) < policy.maxPerFranchise;
    const typeOk = (typeCount.get(entityType) ?? 0) < policy.maxPerEntityType;

    if (genreOk && franchiseOk && typeOk) {
      selected.add(key);
      if (primaryGenre !== null) genreCount.set(primaryGenre, (genreCount.get(primaryGenre) ?? 0) + 1);
      if (franchiseKey !== null)
        franchiseCount.set(franchiseKey, (franchiseCount.get(franchiseKey) ?? 0) + 1);
      typeCount.set(entityType, (typeCount.get(entityType) ?? 0) + 1);
    } else {
      capSkipped.push(it);
    }
  }

  // Fallback: repoe vagas com os proximos elegiveis (maior rank primeiro),
  // relaxando os caps — melhor preencher a vaga do que devolver menos.
  if (selected.size < effectiveLimit) {
    for (const it of capSkipped) {
      if (selected.size >= effectiveLimit) break;
      selected.add(diversityRefKey(it.ref));
    }
  }

  let skippedByCap = 0;
  for (const it of capSkipped) {
    if (!selected.has(diversityRefKey(it.ref))) skippedByCap += 1;
  }

  const out: RankedRecommendation[] = [];
  const emitted = new Set<string>();
  for (const it of ordered) {
    const key = diversityRefKey(it.ref);
    if (!selected.has(key) || emitted.has(key)) continue;
    emitted.add(key);
    out.push({
      ref: { entityType: it.ref.entityType, entityId: it.ref.entityId },
      score: it.score,
      confidence: it.confidence,
      position: out.length,
      reasons: it.reasons,
    });
  }

  return ok({ items: out, audit: audit(out.length, skippedByCap) });
}
