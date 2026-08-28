/**
 * score-explanation.ts — Leitura PURA do `explanation` persistido de um calculo
 * do Cinerie Score.
 *
 * ============================================================================
 * POR QUE ESTE PARSER E COMPARTILHADO
 * ============================================================================
 * `cinerie_score_calculations.explanation` e JSONB: o que sai do banco e
 * `unknown`, e `rebuildCountedSources` exige entradas com forma. Havia UMA copia
 * deste parser em `server/entity-hero.ts` (a ficha), e a listagem precisava da
 * mesma leitura. Duas copias do mesmo parser divergem no primeiro campo novo — e
 * a divergencia apareceria como a mesma nota contando fontes diferentes em duas
 * telas.
 *
 * FAIL-CLOSED por entrada: item malformado e DESCARTADO, nunca "quase valido".
 * Uma entrada sem `weight` nao pode compor um numero cuja linha de composicao
 * afirma quantas fontes entraram.
 */

/** Uma linha da explicacao persistida do calculo (`explanation` JSONB). */
export interface ScoreExplanationEntry {
  readonly source: string;
  readonly normalized: number;
  readonly weight: number;
}

/** Le o JSONB cru. Entrada malformada e descartada; nunca lanca. */
export function parseScoreExplanation(raw: unknown): ScoreExplanationEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ScoreExplanationEntry[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const source = (item as Record<string, unknown>).source;
    const normalized = (item as Record<string, unknown>).normalized;
    const weight = (item as Record<string, unknown>).weight;
    if (typeof source !== "string") continue;
    if (typeof normalized !== "number" || !Number.isFinite(normalized)) continue;
    if (typeof weight !== "number" || !Number.isFinite(weight)) continue;
    out.push({ source, normalized, weight });
  }
  return out;
}
