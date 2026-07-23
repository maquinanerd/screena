/**
 * Credenciais de senha — operacoes puras (Backend C).
 *
 * PURO: sem rede, sem DB, sem crypto direto. Toda operacao com material
 * sensivel passa por PORTA injetada (PasswordHasherPort/PasswordVerifierPort),
 * ligada a core/crypto.ts na composicao. O dominio NUNCA ve a senha em claro
 * apos hasheada e NUNCA devolve senha/hash em objeto publico de resposta.
 *
 * A validacao de POLITICA da senha (comprimento, nao-igual-ao-email) e feita
 * antes, em policy.ts; aqui assumimos uma senha ja aprovada e cuidamos do
 * registro, autenticacao e troca.
 */

import { type DomainResult, err, ok } from "../core/result.js";
import type { CredentialRecord, PasswordHasherPort, PasswordVerifierPort } from "./types.js";

/** Deduplica ids preservando a ordem de primeira ocorrencia. */
function dedupeBigints(ids: readonly bigint[]): bigint[] {
  const seen = new Set<bigint>();
  const out: bigint[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Prepara o registro de credencial a partir de uma senha JA validada pela
 * politica. Usa a porta de hash; deriva o rotulo `algorithm` do proprio hash
 * PHC (prefixo antes do primeiro '$'). Senha vazia aqui e invariante violada
 * (a politica deveria ter barrado) — fail-closed sem lancar.
 */
export function buildCredentialRegistration(input: {
  readonly userId: bigint;
  readonly password: string;
  readonly hashPassword: PasswordHasherPort;
}): DomainResult<CredentialRecord> {
  if (input.password.length === 0) {
    return err("validation_failed", "senha ausente para registro de credencial.");
  }
  const passwordHash = input.hashPassword(input.password);
  if (typeof passwordHash !== "string" || passwordHash.length === 0) {
    return err("validation_failed", "hash de senha invalido.");
  }
  const algorithm = passwordHash.split("$")[0] ?? "unknown";
  return ok({ userId: input.userId, passwordHash, algorithm });
}

/**
 * Autentica uma senha contra o hash persistido usando a porta de verificacao
 * (comparacao em tempo constante dentro da porta). Credencial ausente => false
 * (sem distincao publica entre "conta sem senha" e "senha errada"). NAO
 * retorna hash nem senha — apenas o booleano.
 */
export function authenticatePassword(input: {
  readonly password: string;
  readonly storedHash: string | null;
  readonly verify: PasswordVerifierPort;
}): boolean {
  if (input.storedHash === null || input.storedHash.length === 0) {
    return false;
  }
  return input.verify(input.password, input.storedHash);
}

export interface PasswordChangePlan {
  readonly credential: CredentialRecord;
  /** Troca de senha SEMPRE revoga as sessoes existentes (evento sensivel). */
  readonly revokeSessionIds: readonly bigint[];
}

/**
 * Plano de troca de senha: novo hash de credencial + revogacao OBRIGATORIA de
 * TODAS as sessoes ativas (evento sensivel). Sem excecao de sessao corrente —
 * trocar a senha derruba tudo; o cliente reautentica.
 */
export function buildPasswordChange(input: {
  readonly userId: bigint;
  readonly newPassword: string;
  readonly hashPassword: PasswordHasherPort;
  readonly activeSessionIds: readonly bigint[];
}): DomainResult<PasswordChangePlan> {
  const credential = buildCredentialRegistration({
    userId: input.userId,
    password: input.newPassword,
    hashPassword: input.hashPassword,
  });
  if (!credential.ok) {
    return credential;
  }
  return ok({
    credential: credential.value,
    revokeSessionIds: dedupeBigints(input.activeSessionIds),
  });
}
