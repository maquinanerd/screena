/**
 * Barrel do dominio de REVIEWS de usuario (Backend C, unidade C5B).
 *
 * Tudo aqui e PURO e determinístico: sem rede, sem DB, sem relogio global. O
 * dominio produz VALIDACAO / PLANOS / PROJECOES; a persistencia transacional
 * fica na fronteira (fase futura). Review textual e universo proprio: nunca
 * importa ratings/ para calcular/validar nota, nunca calcula/alimenta o Cinerie
 * Score e nunca trata rating externo.
 */

export * from "./types.js";
export * from "./policy.js";
export * from "./review.js";
export * from "./mutation.js";
export * from "./moderation.js";
export * from "./reports.js";
export * from "./projection.js";
