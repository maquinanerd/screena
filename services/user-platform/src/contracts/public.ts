/**
 * Barrel PUBLICO-SEGURO de contratos (Backend C).
 *
 * Reexporta APENAS o que pode transitar pela superficie publica: payloads de
 * produto (read-DTOs), payloads de entrada, comandos validados, DTOs publicos
 * e mappers por whitelist.
 *
 * NUNCA reexporta a entrega sensivel de segredos (auth-internal.ts) — quem
 * precisar de SensitiveSessionDelivery/SensitiveOneTimeTokenDelivery importa
 * explicitamente de `contracts/internal.js`. Um consumidor deste barrel nao
 * recebe nenhum tipo sensivel (travado por contract-boundary.test.ts).
 */

// Contratos de produto (read-DTOs; §12) — ja existentes, publicos por natureza.
export * from "./payloads.js";

// Autenticacao — camada A (payloads de entrada) e B (comandos + parsers).
export * from "./auth-payloads.js";
export * from "./auth-commands.js";

// Autenticacao — camada D (DTOs publicos) e mappers por whitelist.
export * from "./auth-dto.js";
export * from "./auth-mappers.js";

// Helpers de parsing estrito (uteis a borda; nao carregam segredo).
export { asRecord, expectEmptyBody } from "./parse.js";
