/**
 * Verificacao de email — regras puras (Backend C).
 *
 * PURO: sem rede, sem DB, sem envio de email. `now` por parametro; o segredo
 * e gerado/hasheado por PORTAS injetadas. O token CRU so e devolvido no
 * MOMENTO DA EMISSAO (para a borda entregar por email) e NUNCA e persistido:
 * o registro guarda apenas `tokenHash`.
 *
 * Politica (docs/product/user-product-decisions.md): verificar email NAO e
 * pre-requisito de login — gate de verificacao vale para acoes privilegiadas
 * (ex.: publicar lista publica). Aqui apenas emitimos, consumimos e aplicamos
 * a verificacao; o gate de acao fica nos dominios que o exigem.
 *
 * Reenvio e anti-enumeracao: a resposta publica e indistinguivel entre conta
 * inexistente, ja verificada ou elegivel; o motivo real fica so no interno.
 */

import { ok } from "../core/result.js";
import { EMAIL_VERIFICATION_TTL_HOURS } from "./policy.js";
import {
  type AuthDecision,
  authDecision,
  type SecretGeneratorPort,
  type SecretHasherPort,
  type VerificationTokenRecord,
} from "./types.js";

const HOUR_MS = 3_600_000;

export interface VerificationTokenIssue {
  /** Registro persistivel (SO o hash). */
  readonly record: VerificationTokenRecord;
  /**
   * Token CRU para entrega imediata por email. NUNCA persistir; NUNCA logar;
   * some da memoria apos o envio. So existe aqui, no momento da emissao.
   */
  readonly rawToken: string;
}

/**
 * Emite um token de verificacao de email: gera segredo opaco (porta), persiste
 * so o hash, expira em EMAIL_VERIFICATION_TTL_HOURS a partir de `now`.
 */
export function buildEmailVerificationIssue(input: {
  readonly userId: bigint;
  readonly now: Date;
  readonly generateSecret: SecretGeneratorPort;
  readonly hashSecret: SecretHasherPort;
}): VerificationTokenIssue {
  const rawToken = input.generateSecret();
  return {
    record: {
      userId: input.userId,
      purpose: "email_verification",
      tokenHash: input.hashSecret(rawToken),
      expiresAt: new Date(input.now.getTime() + EMAIL_VERIFICATION_TTL_HOURS * HOUR_MS),
    },
    rawToken,
  };
}

/** Motivo interno do reenvio de verificacao (audit); nunca vira texto publico. */
export type VerificationResendReason =
  | "issue_token"
  | "already_verified"
  | "user_not_found";

/**
 * Decide o REENVIO de verificacao. Resposta publica SEMPRE identica e
 * generica (anti-enumeracao). Internamente:
 *  - conta inexistente -> nao emite (user_not_found);
 *  - ja verificada -> nao emite, idempotente (already_verified);
 *  - elegivel -> emite (issue_token).
 * O `publicResult` e sempre ok — a borda mostra a mesma mensagem em todos os
 * casos; so age (emitir/enviar) quando o interno for `issue_token`.
 */
export function evaluateVerificationResend(input: {
  readonly userExists: boolean;
  readonly alreadyVerified: boolean;
}): AuthDecision<{ notice: "sent_if_applicable" }> {
  let reason: VerificationResendReason;
  if (!input.userExists) {
    reason = "user_not_found";
  } else if (input.alreadyVerified) {
    reason = "already_verified";
  } else {
    reason = "issue_token";
  }
  return authDecision(ok({ notice: "sent_if_applicable" }), reason);
}

export interface EmailVerificationApplication {
  readonly emailVerifiedAt: Date;
  /** false quando ja estava verificada (idempotente; carimbo preservado). */
  readonly changed: boolean;
}

/**
 * Aplica a verificacao ao estado da identidade apos consumo do token
 * (tokens.evaluateTokenConsumption com expectedPurpose = "email_verification").
 * Idempotente: se ja estava verificada, PRESERVA o carimbo original e sinaliza
 * `changed=false`; senao marca `emailVerifiedAt = now`.
 */
export function applyEmailVerification(input: {
  readonly now: Date;
  readonly currentEmailVerifiedAt: Date | null;
}): EmailVerificationApplication {
  if (input.currentEmailVerifiedAt !== null) {
    return { emailVerifiedAt: input.currentEmailVerifiedAt, changed: false };
  }
  return { emailVerifiedAt: input.now, changed: true };
}
