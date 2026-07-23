/**
 * Politica pura de autenticacao da user platform (Backend C).
 *
 * PURO: sem rede, sem DB, sem fs, sem Date.now() — todo tempo entra por
 * parametro (`now: Date`). Este modulo define a politica de SENHA, os TTLs e
 * o brute force com janela deslizante; quem executa IO e a camada de
 * persistencia/borda, nunca este arquivo.
 *
 * As regras de IDENTIDADE (email/handle) vivem em `identity.ts`; sao
 * re-exportadas abaixo por conveniencia e compatibilidade dos consumidores.
 *
 * Anti-enumeracao: nenhuma mensagem daqui confirma existencia de conta.
 */

import { collect, type ValidationResult } from "../core/result.js";
import { THROTTLE_SCOPES, type ThrottleScope } from "../core/types.js";
import { normalizeEmail, validateEmailFormat, validateHandle } from "./identity.js";

// Re-export das regras de identidade (fonte real: ./identity.ts).
export { normalizeEmail, validateEmailFormat, validateHandle };

// ---------------------------------------------------------------------------
// Senha
// ---------------------------------------------------------------------------

/**
 * Politica de senha: COMPRIMENTO e o que importa (NIST 800-63B). Sem
 * exigencia de composicao (maiuscula/numero/simbolo) — regra deliberada.
 */
export const PASSWORD_POLICY = {
  minLength: 10,
  maxLength: 200,
} as const;

/**
 * Valida uma senha candidata contra a politica. Rejeita tambem senha igual
 * ao proprio email (ou a parte local dele), comparando de forma
 * case-insensitive — o email e conhecimento publico do atacante.
 */
export function validatePasswordCandidate(password: string, email: string): ValidationResult {
  const errors: string[] = [];

  if (password.length < PASSWORD_POLICY.minLength) {
    errors.push(`senha muito curta: minimo de ${PASSWORD_POLICY.minLength} caracteres.`);
  }
  if (password.length > PASSWORD_POLICY.maxLength) {
    errors.push(`senha muito longa: maximo de ${PASSWORD_POLICY.maxLength} caracteres.`);
  }

  const emailNormalized = normalizeEmail(email);
  const passwordLower = password.toLowerCase();
  if (emailNormalized.length > 0) {
    const localPart = emailNormalized.split("@")[0] ?? "";
    if (passwordLower === emailNormalized) {
      errors.push("senha nao pode ser igual ao email.");
    } else if (localPart.length > 0 && passwordLower === localPart) {
      errors.push("senha nao pode ser igual a parte local do email.");
    }
  }

  return collect(errors);
}

// ---------------------------------------------------------------------------
// TTLs
// ---------------------------------------------------------------------------

/** Sessao: 30 dias. */
export const SESSION_TTL_HOURS = 720;

/** Token de verificacao de email: 24 horas. */
export const EMAIL_VERIFICATION_TTL_HOURS = 24;

/** Token de reset de senha: 2 horas (janela curta deliberada). */
export const PASSWORD_RESET_TTL_HOURS = 2;

// ---------------------------------------------------------------------------
// Brute force — janela deslizante + lockout progressivo
// ---------------------------------------------------------------------------

export interface ThrottleScopePolicy {
  readonly windowMinutes: number;
  readonly maxFailures: number;
}

/**
 * Politica por escopo: o escopo `email` e mais restrito (protege UMA conta);
 * o escopo `ip` e mais largo (protege contra spray sem punir NAT/coworking).
 */
export const THROTTLE_POLICY: Readonly<Record<ThrottleScope, ThrottleScopePolicy>> = {
  email: { windowMinutes: 15, maxFailures: 5 },
  ip: { windowMinutes: 15, maxFailures: 20 },
};

/** Teto do lockout progressivo: 24 horas. */
export const LOCKOUT_MAX_MINUTES = 24 * 60;

/** Duracao base do primeiro lockout. */
export const LOCKOUT_BASE_MINUTES = 15;

/**
 * Lockout progressivo: 15 * 2^previousLockouts minutos, com teto de 24h.
 * Entrada negativa/fracionaria e tratada como 0 (fail-safe, nunca lanca).
 */
export function lockoutDurationMinutes(previousLockouts: number): number {
  const n = Number.isFinite(previousLockouts) ? Math.max(0, Math.floor(previousLockouts)) : 0;
  return Math.min(LOCKOUT_BASE_MINUTES * 2 ** n, LOCKOUT_MAX_MINUTES);
}

/**
 * Estado de throttle de um escopo (email ou ip). `previousLockouts` e
 * opcional (default 0) e alimenta o lockout progressivo entre janelas.
 */
export interface ThrottleState {
  readonly failureCount: number;
  readonly windowStartedAt: Date;
  readonly lockedUntil: Date | null;
  readonly previousLockouts?: number;
}

export interface ThrottleEvaluation {
  readonly locked: boolean;
  readonly remainingFailures: number;
}

const MINUTE_MS = 60_000;

/** true quando a janela deslizante do estado ja expirou em `now`. */
function windowExpired(state: ThrottleState, policy: ThrottleScopePolicy, now: Date): boolean {
  return now.getTime() >= state.windowStartedAt.getTime() + policy.windowMinutes * MINUTE_MS;
}

/** true quando ha lockout ATIVO em `now`. */
function lockActive(state: ThrottleState, now: Date): boolean {
  return state.lockedUntil !== null && now.getTime() < state.lockedUntil.getTime();
}

/**
 * Avalia o estado de throttle SEM muta-lo. Janela expirada conta como
 * resetada (estado limpo). Lockout vencido deixa de travar.
 */
export function evaluateThrottle(
  state: ThrottleState | null,
  scope: ThrottleScope,
  now: Date,
): ThrottleEvaluation {
  const policy = THROTTLE_POLICY[scope];

  if (state === null) {
    return { locked: false, remainingFailures: policy.maxFailures };
  }
  if (lockActive(state, now)) {
    return { locked: true, remainingFailures: 0 };
  }
  if (windowExpired(state, policy, now)) {
    return { locked: false, remainingFailures: policy.maxFailures };
  }
  return {
    locked: false,
    remainingFailures: Math.max(0, policy.maxFailures - state.failureCount),
  };
}

/**
 * Registra UMA falha e devolve o novo estado (imutavel). Janela expirada ou
 * lockout vencido abrem janela nova (contagem volta a 1), preservando
 * `previousLockouts` para o lockout progressivo. Ao atingir `maxFailures`
 * dentro da janela, seta `lockedUntil = now + lockoutDurationMinutes(n)`.
 */
export function registerFailure(
  state: ThrottleState | null,
  scope: ThrottleScope,
  now: Date,
): ThrottleState {
  const policy = THROTTLE_POLICY[scope];
  const previousLockouts = state?.previousLockouts ?? 0;

  const startsFreshWindow =
    state === null ||
    windowExpired(state, policy, now) ||
    (state.lockedUntil !== null && !lockActive(state, now));

  if (startsFreshWindow) {
    return {
      failureCount: 1,
      windowStartedAt: now,
      lockedUntil: null,
      previousLockouts,
    };
  }

  const failureCount = state.failureCount + 1;
  if (failureCount >= policy.maxFailures) {
    const durationMinutes = lockoutDurationMinutes(previousLockouts);
    return {
      failureCount,
      windowStartedAt: state.windowStartedAt,
      lockedUntil: new Date(now.getTime() + durationMinutes * MINUTE_MS),
      previousLockouts: previousLockouts + 1,
    };
  }

  return {
    failureCount,
    windowStartedAt: state.windowStartedAt,
    lockedUntil: null,
    previousLockouts,
  };
}

/** Sucesso de autenticacao limpa o estado de throttle do escopo. */
export function registerSuccess(): null {
  return null;
}

/** Reexporta os escopos canonicos para conveniencia dos consumidores. */
export { THROTTLE_SCOPES, type ThrottleScope };
