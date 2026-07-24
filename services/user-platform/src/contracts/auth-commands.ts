/**
 * COMANDOS VALIDADOS de autenticacao (camada B) + parsers (A -> B).
 *
 * PURO: sem rede, sem DB, sem crypto, sem relogio. O parser recebe `unknown`
 * (camada A) e produz um comando normalizado seguro para o dominio (camada B),
 * SEMPRE por allow-list estrita — nunca por spread/Object.assign.
 *
 * Reuso de politica: a validacao de identidade/senha delega para `auth/`
 * (fonte unica: identity.ts / policy.ts) — nada de regex/limite duplicado e
 * divergente aqui.
 *
 * Comandos podem carregar senha/token em claro (sao internos, entregues ao
 * dominio) — NUNCA sao serializados como resposta publica.
 */

import { type DomainResult, err, ok } from "../core/result.js";
import {
  EMAIL_MAX_LENGTH,
  normalizeEmail,
  validateEmailFormat,
  validatePasswordCandidate,
} from "../auth/index.js";
import {
  asRecord,
  expectEmptyBody,
  optionalString,
  rejectUnknownKeys,
  requireString,
} from "./parse.js";

/** Limites de tamanho da fronteira (guardas de DoS antes da politica central). */
export const DISPLAY_NAME_MAX_LENGTH = 100;
export const RAW_PASSWORD_READ_MAX = 1024; // teto bruto; a politica refina 10..200
export const TOKEN_MIN_LENGTH = 16;
export const TOKEN_MAX_LENGTH = 512;

// ---------------------------------------------------------------------------
// Tipos de comando (camada B) — normalizados, prontos para o dominio
// ---------------------------------------------------------------------------

export interface SignupCommand {
  readonly email: string;
  readonly emailNormalized: string;
  readonly password: string;
  readonly displayName: string | null;
  /**
   * Aceite EXPLICITO dos termos e da politica de privacidade. Booleano, nao
   * versao: a VERSAO vigente e do servidor (`auth-runtime/config.ts`) — aceitar
   * uma versao informada pelo cliente deixaria qualquer pessoa registrar prova
   * de aceite de um texto que nunca leu.
   *
   * Sem default: o parser exige a chave presente e `true`. Um default `false`
   * viraria "nao aceitou" silencioso, e um default `true` seria exatamente o
   * checkbox pre-marcado que a LGPD proibe.
   */
  readonly acceptedTerms: true;
  /** Finalidades OPCIONAIS. Ausentes => `false` (nunca pre-marcadas). */
  readonly acceptedMarketingEmail: boolean;
  readonly acceptedAnalytics: boolean;
}

export interface LoginCommand {
  readonly emailNormalized: string;
  readonly password: string;
}

export interface RequestPasswordRecoveryCommand {
  readonly emailNormalized: string;
}

export interface ConsumePasswordRecoveryCommand {
  readonly token: string;
  readonly newPassword: string;
}

export interface RequestEmailVerificationCommand {
  readonly emailNormalized: string;
}

export interface ConsumeEmailVerificationCommand {
  readonly token: string;
}

export interface ChangePasswordCommand {
  readonly currentPassword: string;
  readonly newPassword: string;
}

/** Operacoes cuja identidade/sessao vem do contexto autenticado (corpo vazio). */
export type LogoutCommand = Record<string, never>;
export type LogoutAllCommand = Record<string, never>;
export type ReadCurrentSessionCommand = Record<string, never>;
export type RotateSessionCommand = Record<string, never>;

// ---------------------------------------------------------------------------
// Parsers (unknown -> comando), sempre em modo estrito
// ---------------------------------------------------------------------------

/** Le e valida um token de uso unico (formato opaco; limites de tamanho). */
function requireToken(obj: Record<string, unknown>, key: string): DomainResult<string> {
  return requireString(obj, key, { trim: true, min: TOKEN_MIN_LENGTH, max: TOKEN_MAX_LENGTH });
}

export function parseSignupCommand(input: unknown): DomainResult<SignupCommand> {
  const record = asRecord(input);
  if (!record.ok) return record;
  const strict = rejectUnknownKeys(record.value, [
    "email",
    "password",
    "displayName",
    "acceptedTerms",
    "acceptedMarketingEmail",
    "acceptedAnalytics",
  ]);
  if (!strict.ok) return strict;

  const emailRaw = requireString(record.value, "email", { trim: true, max: EMAIL_MAX_LENGTH });
  if (!emailRaw.ok) return emailRaw;
  const emailFormat = validateEmailFormat(emailRaw.value);
  if (!emailFormat.ok) {
    return err("validation_failed", "dados invalidos.", emailFormat.errors);
  }
  const emailNormalized = normalizeEmail(emailRaw.value);

  const password = requireString(record.value, "password", { max: RAW_PASSWORD_READ_MAX });
  if (!password.ok) return password;
  const pwPolicy = validatePasswordCandidate(password.value, emailNormalized);
  if (!pwPolicy.ok) {
    return err("validation_failed", "dados invalidos.", pwPolicy.errors);
  }

  const displayName = optionalString(record.value, "displayName", {
    trim: true,
    max: DISPLAY_NAME_MAX_LENGTH,
  });
  if (!displayName.ok) return displayName;

  // ACEITE OBRIGATORIO. Exige o literal `true`: chave ausente, `false`,
  // `"true"`, `1` ou qualquer outro valor "verdadeiro-ish" e recusa. Aceitar
  // um truthy frouxo transformaria um campo esquecido pelo cliente em prova
  // de consentimento — exatamente o que a prova precisa nao ser.
  if (record.value["acceptedTerms"] !== true) {
    return err("validation_failed", "dados invalidos.", [
      "e obrigatorio aceitar os termos de uso e a politica de privacidade.",
    ]);
  }

  // Finalidades OPCIONAIS: so o literal `true` concede. Ausente => false.
  // Nao ha checkbox pre-marcado, e nenhum valor ambiguo vira "sim".
  const marketing = optionalStrictBoolean(record.value, "acceptedMarketingEmail");
  if (!marketing.ok) return marketing;
  const analytics = optionalStrictBoolean(record.value, "acceptedAnalytics");
  if (!analytics.ok) return analytics;

  return ok({
    email: emailRaw.value,
    emailNormalized,
    password: password.value,
    displayName: displayName.value ?? null,
    acceptedTerms: true as const,
    acceptedMarketingEmail: marketing.value,
    acceptedAnalytics: analytics.value,
  });
}

/**
 * Booleano OPCIONAL estrito: ausente/`undefined`/`null` => `false`; `true` =>
 * `true`; QUALQUER outra coisa recusa. Deliberadamente sem coercao — `"false"`
 * e uma string verdadeira em JavaScript, e um consentimento que virasse `true`
 * por coercao seria indistinguivel de um aceite real na tabela de prova.
 */
function optionalStrictBoolean(
  obj: Record<string, unknown>,
  key: string,
): DomainResult<boolean> {
  const value = obj[key];
  if (value === undefined || value === null || value === false) {
    return ok(false);
  }
  if (value === true) {
    return ok(true);
  }
  return err("validation_failed", "dados invalidos.", [`${key} deve ser booleano.`]);
}

export function parseLoginCommand(input: unknown): DomainResult<LoginCommand> {
  const record = asRecord(input);
  if (!record.ok) return record;
  // Estrito: rejeita userId, sessionId, status etc. enviados pelo cliente.
  const strict = rejectUnknownKeys(record.value, ["email", "password"]);
  if (!strict.ok) return strict;

  // Login NAO valida formato de email (anti-enumeracao: nao distingue formato
  // ruim de credencial invalida) — apenas normaliza.
  const emailRaw = requireString(record.value, "email", { trim: true, max: EMAIL_MAX_LENGTH });
  if (!emailRaw.ok) return emailRaw;
  const password = requireString(record.value, "password", { max: RAW_PASSWORD_READ_MAX });
  if (!password.ok) return password;

  return ok({ emailNormalized: normalizeEmail(emailRaw.value), password: password.value });
}

export function parseRequestPasswordRecoveryCommand(
  input: unknown,
): DomainResult<RequestPasswordRecoveryCommand> {
  const record = asRecord(input);
  if (!record.ok) return record;
  const strict = rejectUnknownKeys(record.value, ["email"]);
  if (!strict.ok) return strict;
  const emailRaw = requireString(record.value, "email", { trim: true, max: EMAIL_MAX_LENGTH });
  if (!emailRaw.ok) return emailRaw;
  return ok({ emailNormalized: normalizeEmail(emailRaw.value) });
}

export function parseConsumePasswordRecoveryCommand(
  input: unknown,
): DomainResult<ConsumePasswordRecoveryCommand> {
  const record = asRecord(input);
  if (!record.ok) return record;
  // Estrito: rejeita tokenHash, userId etc. enviados pelo cliente.
  const strict = rejectUnknownKeys(record.value, ["token", "newPassword"]);
  if (!strict.ok) return strict;

  const token = requireToken(record.value, "token");
  if (!token.ok) return token;
  const newPassword = requireString(record.value, "newPassword", { max: RAW_PASSWORD_READ_MAX });
  if (!newPassword.ok) return newPassword;
  // Politica de senha (comprimento) sem email — reusa a fonte central.
  const pwPolicy = validatePasswordCandidate(newPassword.value, "");
  if (!pwPolicy.ok) {
    return err("validation_failed", "dados invalidos.", pwPolicy.errors);
  }
  return ok({ token: token.value, newPassword: newPassword.value });
}

export function parseRequestEmailVerificationCommand(
  input: unknown,
): DomainResult<RequestEmailVerificationCommand> {
  const record = asRecord(input);
  if (!record.ok) return record;
  const strict = rejectUnknownKeys(record.value, ["email"]);
  if (!strict.ok) return strict;
  const emailRaw = requireString(record.value, "email", { trim: true, max: EMAIL_MAX_LENGTH });
  if (!emailRaw.ok) return emailRaw;
  return ok({ emailNormalized: normalizeEmail(emailRaw.value) });
}

export function parseConsumeEmailVerificationCommand(
  input: unknown,
): DomainResult<ConsumeEmailVerificationCommand> {
  const record = asRecord(input);
  if (!record.ok) return record;
  // Estrito: rejeita tokenHash enviado pelo cliente.
  const strict = rejectUnknownKeys(record.value, ["token"]);
  if (!strict.ok) return strict;
  const token = requireToken(record.value, "token");
  if (!token.ok) return token;
  return ok({ token: token.value });
}

export function parseChangePasswordCommand(input: unknown): DomainResult<ChangePasswordCommand> {
  const record = asRecord(input);
  if (!record.ok) return record;
  // Estrito: rejeita passwordHash, userId, credentialId enviados pelo cliente.
  const strict = rejectUnknownKeys(record.value, ["currentPassword", "newPassword"]);
  if (!strict.ok) return strict;

  const currentPassword = requireString(record.value, "currentPassword", {
    max: RAW_PASSWORD_READ_MAX,
  });
  if (!currentPassword.ok) return currentPassword;
  const newPassword = requireString(record.value, "newPassword", { max: RAW_PASSWORD_READ_MAX });
  if (!newPassword.ok) return newPassword;
  const pwPolicy = validatePasswordCandidate(newPassword.value, "");
  if (!pwPolicy.ok) {
    return err("validation_failed", "dados invalidos.", pwPolicy.errors);
  }
  return ok({ currentPassword: currentPassword.value, newPassword: newPassword.value });
}

/**
 * Parsers de operacoes com corpo vazio: logout, logout-all, leitura de sessao
 * e rotacao. A identidade/sessao vem do CONTEXTO autenticado (futuro), nunca
 * do corpo — por isso rejeitam qualquer chave (sessionId, userId, tokenHash,
 * rotatedFromId).
 */
export function parseLogoutCommand(input: unknown): DomainResult<LogoutCommand> {
  const empty = expectEmptyBody(input);
  return empty.ok ? ok({}) : empty;
}

export function parseLogoutAllCommand(input: unknown): DomainResult<LogoutAllCommand> {
  const empty = expectEmptyBody(input);
  return empty.ok ? ok({}) : empty;
}

export function parseReadCurrentSessionCommand(
  input: unknown,
): DomainResult<ReadCurrentSessionCommand> {
  const empty = expectEmptyBody(input);
  return empty.ok ? ok({}) : empty;
}

export function parseRotateSessionCommand(input: unknown): DomainResult<RotateSessionCommand> {
  const empty = expectEmptyBody(input);
  return empty.ok ? ok({}) : empty;
}
