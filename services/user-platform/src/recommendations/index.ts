/**
 * Barrel do dominio de RECOMENDACOES pessoais (Backend C, unidade C6A).
 *
 * Tudo aqui e PURO e determinístico: sem rede, sem DB, sem relogio, sem IA/ML,
 * sem aleatoriedade. O dominio produz um RANKING explicavel a partir de
 * entradas ja minimizadas; a persistencia de snapshot, diversidade, renovacao e
 * feedback sao a unidade C6B. Nunca calcula/usa o Cinerie Score, nunca decide
 * licenca, nunca importa ratings externos nem toca outros dominios.
 */

export * from "./types.js";
export * from "./policy.js";
export * from "./eligibility.js";
export * from "./signals.js";
export * from "./scoring.js";
export * from "./reasons.js";
export * from "./ranking.js";
