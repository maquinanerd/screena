/**
 * @screena/cinerie-score — Engine PURO do Cinerie Score.
 *
 * NAO CONTEM FORMULA. Escala, fontes, pesos, votos minimos, tratamento de
 * ausencia e arredondamento sao decisao de produto HUMANA, pendente em
 * docs/product/cinerie-score-decision.md. Enquanto ela nao existir,
 * `computeCinerieScore` devolve `blocked_by_decision` — o estado correto, nao
 * um TODO.
 *
 * Offline-only (worker/job). Nunca importe deste pacote no caminho de render
 * (invariantes 3 e 4).
 */

export * from "./types.js";
export * from "./engine.js";
