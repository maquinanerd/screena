/**
 * Barrel do dominio de AVALIACAO DE USUARIO (Backend C, unidade C5A).
 *
 * Tudo aqui e PURO e determinístico: sem rede, sem DB, sem relogio global. O
 * dominio produz VALIDACAO / PLANOS / PROJECOES; a persistencia transacional
 * fica na fronteira (fase futura). Nota de usuario e universo proprio: nunca
 * importa ratings externos, nunca calcula/alimenta o Cinerie Score e nunca
 * mistura conteudo de review.
 */

export * from "./types.js";
export * from "./policy.js";
export * from "./mutation.js";
export * from "./projections.js";
