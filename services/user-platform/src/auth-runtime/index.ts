/**
 * Barrel do RUNTIME de autenticacao por e-mail (Backend C, C7C).
 *
 * SERVER-ONLY. `createAuthRuntime` alcanca o Prisma Client e a chave da Brevo —
 * nada deste caminho pode ser importado por componente de cliente.
 *
 * A superficie e deliberadamente pequena: quem consome (a rota do app publico)
 * so precisa de `createAuthRuntime`. Os servicos e os tipos ficam exportados
 * para os testes e para uma futura composicao alternativa, nunca para a UI.
 */

export {
  AuthRuntimeConfigurationError,
  createAuthRuntime,
  isAuthRuntimeConfigurationError,
  type AuthRuntimeOptions,
} from "./composition.js";
export {
  AUTH_EMAIL_ENV_KEYS,
  loadAuthEmailConfig,
  MAX_EXPIRATION_MINUTES,
  MIN_IP_HASH_SALT_LENGTH,
  type AuthEmailConfig,
  type EnvSource,
} from "./config.js";
export type {
  AuthEmailRuntimeDeps,
  AuthRequestContext,
  AuthStores,
  AuthTransactionRunner,
} from "./deps.js";
export {
  noopAuthEmailLogger,
  type AuthEmailLogEvent,
  type AuthEmailLogger,
  type AuthEmailOutcome,
  type AuthEmailPurpose,
} from "./observability.js";
export {
  confirmEmailVerification,
  requestEmailVerification,
} from "./email-verification.js";
export {
  confirmPasswordRecovery,
  requestPasswordRecovery,
} from "./password-recovery.js";
export {
  AUTH_THROTTLE_KEY_SEPARATOR,
  buildAuthThrottleKey,
  consumeAuthRequestBudget,
  consumeAuthThrottleBudget,
} from "./throttle.js";
export { AuthTransactionAbort, isAuthTransactionAbort } from "./transaction.js";
export { AUTH_SECURITY_HEADERS } from "../http/responses.js";
export type { AuthHttpHandlers } from "../http/handlers.js";
export { dispatchAuthEmail, logAuthEmailEvent, type AuthEmailDelivery } from "./dispatch.js";
