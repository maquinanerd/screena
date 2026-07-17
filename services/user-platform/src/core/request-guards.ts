/**
 * Guardas de borda transport-agnostic (missao §13): RBAC, CSRF (double
 * submit), Idempotency-Key, Expected-Version (optimistic locking) e
 * Request-ID — como FUNCOES PURAS que a futura borda HTTP (route handlers)
 * ira compor. Nenhuma dependencia de Next/fetch/rede aqui.
 *
 * PURO com excecao de csrfMatches, que delega comparacao constante ao
 * modulo de crypto (node:crypto, server-only).
 */

import { constantTimeEqualsHex, sha256Hex } from "./crypto.js";
import { type DomainResult, err, ok } from "./result.js";

// ---------------------------------------------------------------------------
// RBAC
// ---------------------------------------------------------------------------

export type Role = "user" | "moderator" | "admin";

/** Acoes de dominio sujeitas a RBAC no v1. */
export type RbacAction =
  | "manage_own_data" // tracking, listas, ratings, reviews, perfil proprios
  | "moderate_reviews" // fila de moderacao, resolver denuncias
  | "process_data_requests" // export/exclusao LGPD
  | "administer_users"; // disable/reactivate contas

const ROLE_GRANTS: Readonly<Record<Role, ReadonlySet<RbacAction>>> = {
  user: new Set<RbacAction>(["manage_own_data"]),
  moderator: new Set<RbacAction>(["manage_own_data", "moderate_reviews"]),
  admin: new Set<RbacAction>([
    "manage_own_data",
    "moderate_reviews",
    "process_data_requests",
    "administer_users",
  ]),
};

export function roleAllows(role: Role, action: RbacAction): boolean {
  return ROLE_GRANTS[role].has(action);
}

/**
 * Autorizacao padrao: dono opera o proprio dado; papel elevado opera alem.
 * Fail-closed: qualquer combinacao desconhecida nega.
 */
export function authorize(input: {
  readonly role: Role;
  readonly action: RbacAction;
  readonly actorUserId: bigint;
  readonly resourceOwnerId?: bigint;
}): DomainResult<true> {
  if (!roleAllows(input.role, input.action)) {
    return err("forbidden", "acao nao permitida para este papel.");
  }
  if (
    input.action === "manage_own_data" &&
    input.resourceOwnerId !== undefined &&
    input.resourceOwnerId !== input.actorUserId
  ) {
    return err("forbidden", "apenas o dono pode operar este recurso.");
  }
  return ok(true);
}

// ---------------------------------------------------------------------------
// CSRF — double submit vinculado a sessao
// ---------------------------------------------------------------------------

/**
 * O cliente reapresenta o token CSRF (entregue no login) em header; o banco
 * guarda so o hash na sessao. Compara sha256(token) com o hash persistido em
 * tempo constante. Toda MUTACAO exige este check na borda.
 */
export function csrfMatches(presentedToken: string, storedCsrfTokenHash: string): boolean {
  if (presentedToken.length === 0 || storedCsrfTokenHash.length === 0) {
    return false;
  }
  return constantTimeEqualsHex(sha256Hex(presentedToken), storedCsrfTokenHash);
}

export function requireCsrf(
  presentedToken: string | undefined,
  storedCsrfTokenHash: string,
): DomainResult<true> {
  if (!presentedToken || !csrfMatches(presentedToken, storedCsrfTokenHash)) {
    return err("csrf_mismatch", "token CSRF ausente ou invalido.");
  }
  return ok(true);
}

// ---------------------------------------------------------------------------
// Idempotency-Key
// ---------------------------------------------------------------------------

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

/** Chave idempotente valida: 8..128 chars, alfabeto seguro. */
export function validateIdempotencyKey(key: string): DomainResult<string> {
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    return err(
      "validation_failed",
      "Idempotency-Key invalida.",
      ["idempotency key deve ter 8..128 chars em [A-Za-z0-9._:-]"],
    );
  }
  return ok(key);
}

// ---------------------------------------------------------------------------
// Expected-Version (optimistic locking)
// ---------------------------------------------------------------------------

/**
 * Compara a versao esperada pelo cliente com a versao atual persistida.
 * Divergencia = conflito explicito (nunca sobrescrever silenciosamente).
 */
export function checkExpectedVersion(
  expectedVersion: number,
  currentVersion: number,
): DomainResult<number> {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return err("validation_failed", "Expected-Version invalida.", [
      "expected version deve ser inteiro >= 1",
    ]);
  }
  if (expectedVersion !== currentVersion) {
    return err(
      "version_conflict",
      `versao defasada: esperado ${expectedVersion}, atual ${currentVersion}. Recarregue e tente de novo.`,
    );
  }
  return ok(currentVersion + 1);
}

// ---------------------------------------------------------------------------
// Request-ID
// ---------------------------------------------------------------------------

const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

/** Normaliza/valida request id para correlacao de logs (nunca conteudo sensivel). */
export function normalizeRequestId(candidate: string | undefined, fallback: string): string {
  if (candidate && REQUEST_ID_PATTERN.test(candidate)) {
    return candidate;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Cookies seguros (atributos como funcao pura; a borda HTTP so serializa)
// ---------------------------------------------------------------------------

export interface SessionCookieSpec {
  readonly name: string;
  readonly value: string;
  readonly attributes: readonly string[];
}

/**
 * Especificacao do cookie de sessao (decisoes secao 8): HttpOnly, Secure,
 * SameSite=Lax, Path=/; prefixo __Host- em producao (exige Secure + Path=/
 * + sem Domain — o proprio navegador fiscaliza).
 */
export function buildSessionCookieSpec(input: {
  readonly token: string;
  readonly maxAgeSeconds: number;
  readonly production: boolean;
}): SessionCookieSpec {
  const name = input.production ? "__Host-cinerie_session" : "cinerie_session";
  return {
    name,
    value: input.token,
    attributes: [
      "HttpOnly",
      "Secure",
      "SameSite=Lax",
      "Path=/",
      `Max-Age=${Math.max(0, Math.floor(input.maxAgeSeconds))}`,
    ],
  };
}
