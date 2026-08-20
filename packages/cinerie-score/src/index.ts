/**
 * @screena/cinerie-score — Engine PURO do Cinerie Score.
 *
 * A formula vigente e `cinerie-score/2026-08-v1` (decisao do proprietario,
 * 20/08/2026 — criterios no cabecalho de formula-2026-08-v1.ts). REGISTRAR NAO
 * E LIGAR: sem a DataUsageDecision vigente de `cinerie_score_display` aprovando
 * a formula nominalmente, `computeCinerieScore` devolve `blocked_by_decision`.
 *
 * Offline-only (worker/job). Nunca importe deste pacote no caminho de render
 * (invariantes 3 e 4).
 */

export * from "./types.js";
export * from "./engine.js";
export * from "./formula-2026-08-v1.js";
