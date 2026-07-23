/**
 * Barrel do dominio de tracking (Backend C, unidade C4).
 *
 * Tudo aqui e PURO e determinístico: sem rede, sem DB, sem crypto, sem relogio
 * global. O dominio produz DECISOES/PLANOS/PROJECOES; a persistencia
 * append-only e a garantia transacional ficam na fronteira (fase futura C7).
 * Tracking e privado por padrao e nunca importa ratings/reviews/persistence.
 */

export * from "./types.js";
export * from "./policy.js";
export * from "./watch-state.js";
export * from "./episode-progress.js";
export * from "./viewing-events.js";
export * from "./diary.js";
export * from "./projections.js";
