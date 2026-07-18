/**
 * Decisores puros dos fluxos de identidade/login (Backend C).
 *
 * Cada funcao recebe FATOS ja buscados pela camada de persistencia e devolve
 * um PLANO/decisao. NUNCA faz IO, nunca chama crypto, nunca le relogio.
 *
 * ANTI-ENUMERACAO (regra-mestra): a resposta observavel de fora e IDENTICA
 * exista ou nao a conta. Login usa sempre o MESMO codigo e a MESMA mensagem
 * generica, independente da causa (usuario inexistente, senha errada, conta
 * nao-ativa). A separacao entre motivo interno (audit) e resposta publica e
 * explicita via `AuthDecision`. A unica excecao publica e o lockout, que
 * responde `locked_out` SEM confirmar existencia da conta (o throttle trava a
 * chave apresentada, nao "a conta").
 *
 * Consumo de token de uso unico -> ./tokens.ts; regras de sessao -> ./sessions.ts.
 */

import { type DomainResult, err, ok, type ValidationResult } from "../core/result.js";
import type { UserStatus } from "../core/types.js";
import { normalizeEmail } from "./identity.js";
import {
  accountCanHoldSession,
  type AuthDecision,
  authDecision,
  GENERIC_LOGIN_FAILURE_MESSAGE,
  LOCKED_OUT_MESSAGE,
} from "./types.js";

// Re-export das mensagens genericas (fonte real: ./types.ts) por conveniencia.
export { GENERIC_LOGIN_FAILURE_MESSAGE, LOCKED_OUT_MESSAGE };

// ---------------------------------------------------------------------------
// Signup
// ---------------------------------------------------------------------------

export type SignupAction = "create_user" | "notice_existing_email";

/**
 * Decide o signup. Email ja registrado NAO e erro para fora: o plano interno
 * vira `notice_existing_email` (ex.: "voce ja tem conta" por email) e a
 * resposta publica da borda deve ser IDENTICA a do cadastro novo — quem chama
 * este decisor nunca pode diferenciar as duas respostas externas.
 *
 * A `action` retornada e um FATO INTERNO (o adapter age sobre ela), nao um
 * detalhe exposto ao cliente.
 */
export function decideSignup(input: {
  readonly emailNormalized: string;
  readonly emailAlreadyRegistered: boolean;
  readonly passwordValidation: ValidationResult;
}): DomainResult<{ action: SignupAction }> {
  const errors: string[] = [];

  if (
    input.emailNormalized.length === 0 ||
    input.emailNormalized !== normalizeEmail(input.emailNormalized)
  ) {
    errors.push("email deve chegar ao decisor ja normalizado (trim + lowercase).");
  }
  if (!input.passwordValidation.ok) {
    errors.push(...input.passwordValidation.errors);
  }
  if (errors.length > 0) {
    return err("validation_failed", "dados de cadastro invalidos.", errors);
  }

  if (input.emailAlreadyRegistered) {
    return ok({ action: "notice_existing_email" });
  }
  return ok({ action: "create_user" });
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

/** Motivo interno do login (audit); nunca vira texto publico. */
export type LoginInternalReason =
  | "ok"
  | "throttled"
  | "user_not_found"
  | "account_ineligible"
  | "wrong_password";

/**
 * Decide o login e devolve uma `AuthDecision`: resposta publica generica +
 * motivo interno para audit.
 *
 * Precedencia: lockout > (existencia | status | senha). QUALQUER falha de
 * credencial (usuario inexistente, conta nao-active, senha errada) produz o
 * MESMO `err("unauthorized", generico)` publico — indistinguiveis por fora.
 * Somente status `active` estabelece sessao (fail-closed). `passwordMatches`
 * ja vem calculado pela porta de verificacao (credentials.authenticatePassword).
 */
export function decideLogin(input: {
  readonly throttleLocked: boolean;
  readonly userExists: boolean;
  readonly userStatus: UserStatus | null;
  readonly passwordMatches: boolean;
}): AuthDecision<{ action: "establish_session" }> {
  if (input.throttleLocked) {
    return authDecision(err("locked_out", LOCKED_OUT_MESSAGE), "throttled");
  }

  let reason: LoginInternalReason;
  if (!input.userExists) {
    reason = "user_not_found";
  } else if (!accountCanHoldSession(input.userStatus)) {
    reason = "account_ineligible";
  } else if (!input.passwordMatches) {
    reason = "wrong_password";
  } else {
    return authDecision(ok({ action: "establish_session" }), "ok");
  }

  return authDecision(err("unauthorized", GENERIC_LOGIN_FAILURE_MESSAGE), reason);
}
