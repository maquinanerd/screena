/**
 * Barrel do dominio de autenticacao (Backend C) — identidade, credenciais,
 * sessoes, verificacao de email e recuperacao de senha.
 *
 * Tudo aqui e PURO e determinístico: sem rede, sem DB, sem crypto direto, sem
 * relogio global. Material sensivel entra por PORTAS injetadas (types.ts),
 * ligadas a core/crypto.ts apenas na composicao/adapter (fase futura).
 */

export * from "./identity.js";
export * from "./policy.js";
export * from "./ttl.js";
export * from "./types.js";
export * from "./tokens.js";
export * from "./credentials.js";
export * from "./sessions.js";
export * from "./flows.js";
export * from "./verification.js";
export * from "./recovery.js";
