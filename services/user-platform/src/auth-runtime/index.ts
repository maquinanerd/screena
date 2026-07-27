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
  createFullAuthRuntime,
  isAuthRuntimeConfigurationError,
  type AuthRuntimeHandlers,
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
  AuthenticatedContext,
  AuthRequestContext,
  AuthRuntimeDeps,
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
export {
  createAuthenticatedHttpHandlers,
  type AuthenticatedHttpDeps,
  type AuthenticatedHttpHandlers,
} from "../http/authenticated-handlers.js";
export {
  changePassword,
  login,
  logout,
  logoutAll,
  readCurrentSession,
  resolveAuthenticatedContext,
  signup,
} from "./account.js";
export {
  anonymizeAccount,
  cancelAccountClosure,
  hasActiveConsent,
  readPrivacyState,
  readProfile,
  requestAccountClosure,
  requestDataExport,
  setConsent,
  updateProfile,
} from "./privacy-services.js";
export { dispatchAuthEmail, logAuthEmailEvent, type AuthEmailDelivery } from "./dispatch.js";

// C8 — biblioteca pessoal: borda HTTP, servicos e dominio de importacao.
export {
  createLibraryHttpHandlers,
  type LibraryHttpDeps,
  type LibraryHttpHandlers,
} from "../http/library-handlers.js";
export {
  addListItem,
  clearRating,
  clearWatchState,
  createList,
  deleteList,
  ensureSystemLists,
  listUserLists,
  listWatchStates,
  readHistory,
  readList,
  readWatchState,
  removeListItem,
  reorderList,
  setRating,
  setWatchState,
  undoWatchState,
  LIBRARY_PAGE_MAX,
} from "./library-services.js";
export {
  markSeriesEpisodes,
  readSeriesProgress,
  setEpisodeWatched,
  DEFAULT_INCLUDE_SPECIALS,
  SERIES_BULK_MAX_EPISODES,
  SERIES_PAGE_SIZE,
  type BulkMarkResult,
  type SeriesProgress,
} from "./tracker-services.js";
export {
  applyImport,
  cancelImport,
  createImportPreview,
  listImports,
  readImport,
  IMPORT_APPLY_BATCH,
  type ApplyImportResult,
  type ImportPreviewResult,
} from "./import-services.js";
export type { LibraryStores, LibraryTransactionRunner } from "./deps.js";
