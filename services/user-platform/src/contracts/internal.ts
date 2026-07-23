/**
 * Barrel INTERNO-SENSIVEL de contratos (Backend C).
 *
 * Reexporta a ENTREGA SENSIVEL de segredos (token de sessao/CSRF/uso unico) e
 * os resultados internos de orquestracao. Estes tipos NUNCA podem ser
 * serializados no body publico nem reexportados por `public.ts`/`index.ts`.
 *
 * Importe daqui APENAS na futura camada de transporte/composicao que precisa
 * entregar segredos (cookies/email) — nunca no caminho que monta a resposta
 * publica.
 */

export type {
  AuthenticatedUserInternal,
  AuthTransportSecrets,
  LoginInternalResult,
  OneTimeTokenRequestInternalResult,
  SensitiveOneTimeTokenDelivery,
  SensitiveSessionDelivery,
} from "./auth-internal.js";
