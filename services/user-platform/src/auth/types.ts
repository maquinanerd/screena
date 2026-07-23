/**
 * Tipos locais e PORTAS do dominio de autenticacao (Backend C).
 *
 * PURO: sem rede, sem DB, sem crypto direto. As PORTAS abaixo sao a unica
 * forma do dominio tocar material sensivel — sao injetadas pela composicao
 * (que as liga a core/crypto.ts), mantendo as regras deterministicas e
 * testaveis com fakes. O dominio NUNCA importa node:crypto, NUNCA gera
 * segredo por conta propria e NUNCA le relogio global.
 *
 * Separacao motivo-interno x resposta-publica: `AuthDecision` carrega uma
 * resposta publica SEGURA (indistinguivel entre causas, anti-enumeracao) e um
 * `internalReason` categorico para audit/observabilidade — que NUNCA contem
 * senha, token, hash ou email.
 */

import type { DomainResult } from "../core/result.js";
import type { AuthTokenPurpose, UserStatus } from "../core/types.js";

// ---------------------------------------------------------------------------
// Portas injetadas (indispensaveis; ligadas a core/crypto.ts na composicao)
// ---------------------------------------------------------------------------

/** Hasheia senha -> string PHC-like versionada (ex.: core/crypto.hashPassword). */
export type PasswordHasherPort = (password: string) => string;

/** Verifica senha contra hash persistido em tempo constante (core/crypto.verifyPassword). */
export type PasswordVerifierPort = (password: string, storedHash: string) => boolean;

/** Gera segredo opaco de 256 bits (core/crypto.generateOpaqueToken). */
export type SecretGeneratorPort = () => string;

/** Hasheia um segredo opaco -> forma persistivel sha256 hex (core/crypto.sha256Hex). */
export type SecretHasherPort = (secret: string) => string;

// ---------------------------------------------------------------------------
// Mensagens publicas genericas (nunca vazam causa nem existencia de conta)
// ---------------------------------------------------------------------------

/** Mensagem UNICA para qualquer falha de credencial (anti-enumeracao). */
export const GENERIC_LOGIN_FAILURE_MESSAGE = "credenciais invalidas.";

/** Mensagem de lockout: nao confirma que a conta existe. */
export const LOCKED_OUT_MESSAGE =
  "muitas tentativas de acesso. Aguarde alguns minutos e tente novamente.";

/** Mensagem UNICA para token inexistente/expirado/ja consumido (replay-safe). */
export const GENERIC_TOKEN_FAILURE_MESSAGE = "token invalido ou expirado. Solicite um novo.";

/** Mensagem UNICA para sessao inexistente/expirada/revogada/conta inelegivel. */
export const GENERIC_SESSION_FAILURE_MESSAGE = "sessao invalida ou expirada.";

/** Resposta publica indistinguivel do pedido de recuperacao (exista ou nao a conta). */
export const GENERIC_RECOVERY_MESSAGE =
  "se houver uma conta com este email, enviaremos instrucoes de recuperacao.";

/** Resposta publica indistinguivel do reenvio de verificacao. */
export const GENERIC_VERIFICATION_MESSAGE =
  "se este email precisar de verificacao, enviaremos um novo link.";

// ---------------------------------------------------------------------------
// Elegibilidade de conta para sessao (fonte unica; fail-closed)
// ---------------------------------------------------------------------------

/**
 * Somente contas `active` podem criar ou manter sessao. Qualquer outro estado
 * (disabled, pending_deletion, deleted) e inelegivel. Default fechado: status
 * ausente/desconhecido tambem e inelegivel.
 */
export const SESSION_ELIGIBLE_STATUSES: readonly UserStatus[] = ["active"];

export function accountCanHoldSession(status: UserStatus | null | undefined): boolean {
  return status != null && SESSION_ELIGIBLE_STATUSES.includes(status);
}

// ---------------------------------------------------------------------------
// AuthDecision — resposta publica segura + motivo interno para audit
// ---------------------------------------------------------------------------

export interface AuthDecision<T> {
  /** Resultado publico SEGURO (mensagem generica; anti-enumeracao). */
  readonly publicResult: DomainResult<T>;
  /**
   * Categoria interna para audit/observabilidade. NUNCA contem senha, token,
   * hash nem email — apenas um rotulo estavel de causa.
   */
  readonly internalReason: string;
}

export function authDecision<T>(
  publicResult: DomainResult<T>,
  internalReason: string,
): AuthDecision<T> {
  return { publicResult, internalReason };
}

// ---------------------------------------------------------------------------
// Registros persistiveis (o ADAPTER grava; aqui apenas a FORMA pura)
// ---------------------------------------------------------------------------

/** Credencial pronta para persistir. NUNCA carrega a senha em claro. */
export interface CredentialRecord {
  readonly userId: bigint;
  readonly passwordHash: string;
  readonly algorithm: string;
}

/**
 * Sessao pronta para persistir. So HASHES (token/csrf); NUNCA o token cru nem
 * IP cru. Metadata minimizada (ip so em hash; user-agent truncado).
 */
export interface SessionRecord {
  readonly userId: bigint;
  readonly tokenHash: string;
  readonly csrfTokenHash: string;
  readonly expiresAt: Date;
  readonly rotatedFromSessionId: bigint | null;
  readonly ipHash: string | null;
  readonly userAgent: string | null;
}

/** Token de uso unico pronto para persistir. So o HASH; nunca o token cru. */
export interface VerificationTokenRecord {
  readonly userId: bigint;
  readonly purpose: AuthTokenPurpose;
  readonly tokenHash: string;
  readonly expiresAt: Date;
}
