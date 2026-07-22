/**
 * Barrel da borda HTTP de autenticacao (Backend C, C7C).
 *
 * Nada aqui conhece Next.js, Prisma ou Brevo: os handlers recebem `Request` e
 * devolvem `Response`, e todas as dependencias chegam injetadas pela composicao.
 */

export {
  createAuthHttpHandlers,
  type AuthHttpDeps,
  type AuthHttpHandlers,
} from "./handlers.js";
export {
  MAX_AUTH_BODY_BYTES,
  readClientIp,
  readJsonBody,
  resolveCorrelationId,
  type BodyReadResult,
} from "./request.js";
export { AUTH_SECURITY_HEADERS } from "./responses.js";
