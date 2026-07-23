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

import { err, ok, type DomainResult } from "../core/result.js";
import { EMAIL_VERIFICATION_TTL_HOURS } from "./policy.js";
import {
  accountCanHoldSession,
  type AuthDecision,
  authDecision,
  GENERIC_TOKEN_FAILURE_MESSAGE,
  type SecretGeneratorPort,
  type SecretHasherPort,
  type VerificationTokenRecord,
} from "./types.js";
import type { UserStatus } from "../core/types.js";
import { resolveTtlMinutes } from "./ttl.js";

const MINUTE_MS = 60_000;

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
 * so o hash, expira em `ttlMinutes` a partir de `now`.
 *
 * `ttlMinutes` e OPCIONAL e o default e EMAIL_VERIFICATION_TTL_HOURS. Ele existe
 * porque o runtime (C7C) recebe o prazo por configuracao de ambiente
 * (`EMAIL_VERIFICATION_EXPIRATION_MINUTES`) e a alternativa seria o runtime
 * calcular `expiresAt` por conta propria — uma SEGUNDA definicao de validade,
 * livre para divergir desta. Valor invalido cai no default (fail-safe, nunca
 * lanca): quem valida a configuracao e `auth-runtime/config.ts`.
 */
export function buildEmailVerificationIssue(input: {
  readonly userId: bigint;
  readonly now: Date;
  readonly generateSecret: SecretGeneratorPort;
  readonly hashSecret: SecretHasherPort;
  readonly ttlMinutes?: number;
}): VerificationTokenIssue {
  const rawToken = input.generateSecret();
  const ttlMinutes = resolveTtlMinutes(input.ttlMinutes, EMAIL_VERIFICATION_TTL_HOURS);
  return {
    record: {
      userId: input.userId,
      purpose: "email_verification",
      tokenHash: input.hashSecret(rawToken),
      expiresAt: new Date(input.now.getTime() + ttlMinutes * MINUTE_MS),
    },
    rawToken,
  };
}

/** Motivo interno do reenvio de verificacao (audit); nunca vira texto publico. */
export type VerificationResendReason =
  | "issue_token"
  | "already_verified"
  | "account_ineligible"
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
  readonly userStatus: UserStatus | null;
  readonly alreadyVerified: boolean;
}): AuthDecision<{ notice: "sent_if_applicable" }> {
  let reason: VerificationResendReason;
  if (!input.userExists) {
    reason = "user_not_found";
  } else if (!accountCanHoldSession(input.userStatus)) {
    // ANTES de `already_verified`: uma conta anonimizada pode ter carimbo antigo,
    // e o motivo que importa registrar e a inelegibilidade, nao o carimbo.
    reason = "account_ineligible";
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

/** Motivo interno da confirmacao (audit); nunca vira texto publico. */
export type EmailVerificationApplicationReason =
  | "verified"
  | "already_verified"
  | "account_ineligible";

/**
 * Aplica a verificacao ao estado da identidade apos consumo do token
 * (tokens.evaluateTokenConsumption com expectedPurpose = "email_verification").
 *
 * GATE DE STATUS (decisao de produto): so conta ELEGIVEL conclui verificacao.
 * `disabled` e `deleted`/anonimizada sao recusadas mesmo com token valido em
 * maos — marcar o e-mail delas recriaria atividade numa identidade que ja nao
 * pode autenticar. O predicado e o MESMO do reset (`accountCanHoldSession`),
 * para nao existir uma segunda matriz de status divergente.
 *
 * A recusa usa `GENERIC_TOKEN_FAILURE_MESSAGE` — a MESMA mensagem de
 * `evaluateTokenConsumption`. Uma mensagem propria para "conta inelegivel"
 * transformaria a confirmacao num oraculo: quem tivesse um token qualquer
 * saberia distinguir "token ruim" de "conta existe mas esta desativada".
 *
 * Idempotente para conta elegivel: ja verificada PRESERVA o carimbo original e
 * sinaliza `changed=false`; senao marca `emailVerifiedAt = now`.
 */
export function applyEmailVerification(input: {
  readonly now: Date;
  readonly userStatus: UserStatus | null;
  readonly currentEmailVerifiedAt: Date | null;
}): AuthDecision<EmailVerificationApplication> {
  if (!accountCanHoldSession(input.userStatus)) {
    return authDecision(
      err("unauthorized", GENERIC_TOKEN_FAILURE_MESSAGE) as DomainResult<EmailVerificationApplication>,
      "account_ineligible",
    );
  }
  if (input.currentEmailVerifiedAt !== null) {
    return authDecision(
      ok({ emailVerifiedAt: input.currentEmailVerifiedAt, changed: false }),
      "already_verified",
    );
  }
  return authDecision(ok({ emailVerifiedAt: input.now, changed: true }), "verified");
}
