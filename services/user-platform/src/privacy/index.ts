/**
 * Barrel do dominio de privacidade / LGPD (Backend C, unidade C3).
 *
 * Tudo aqui e PURO e deterministico: sem rede, sem DB, sem crypto, sem relogio
 * global. O dominio NUNCA manipula segredo bruto (token/senha) — apenas
 * CLASSIFICA dados e produz decisoes/planos; por isso o barrel pode reexportar
 * tudo com seguranca (nenhum valor sensivel transita por aqui).
 *
 * DTOs publicos locais sao PROVISORIOS (types.ts) — pendencia C3B: mover para
 * `contracts/` quando a unidade de contratos de privacidade existir.
 */

export * from "./types.js";
export * from "./policy.js";
export * from "./preferences.js";
export * from "./consent.js";
export * from "./retention.js";
export * from "./export.js";
export * from "./deletion.js";
