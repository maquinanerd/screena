/**
 * DTOs PUBLICOS de autenticacao (camada D) — os UNICOS objetos que a futura
 * borda pode serializar no body publico.
 *
 * Regras absolutas (nenhum DTO aqui pode conter):
 *  - senha, passwordHash, token, rawToken, tokenHash, csrfToken/csrfTokenHash;
 *  - ip/ipHash; sessionToken; internalReason; ids internos (BigInt);
 *  - credentialId/verificationTokenId/recoveryTokenId; algoritmo/parametros de
 *    hash; informacao de lockout que revele existencia de conta.
 *
 * O identificador publico e o `handle` (opaco, modelado pelo produto), nunca a
 * PK interna. Datas expostas (quando necessarias) sao string ISO 8601 UTC.
 *
 * PURO: sem rede, sem DB, sem IO.
 */

import type { ProfileVisibility, UserRole } from "../core/types.js";

/** Vocabulario PUBLICO de falha (controlado; nao ecoa codigo interno cru). */
export type PublicFailureCode =
  | "unauthorized" // credencial invalida (login) — generico, anti-enumeracao
  | "locked_out" // rate limit (nao confirma existencia de conta)
  | "invalid_request" // corpo/campos invalidos
  | "forbidden" // acao nao permitida (ex.: CSRF)
  | "error"; // fallback fail-closed para codigo desconhecido

/**
 * Falha publica generica e ESTAVEL. Sem `details`/`fields`/`internalReason` —
 * usada em login e demais falhas de auth para nao vazar causa nem existencia.
 */
export interface PublicAuthFailureDto {
  readonly ok: false;
  readonly code: PublicFailureCode;
  readonly message: string;
}

/**
 * Falha de VALIDACAO de entrada (formato do corpo/campos). Carrega mensagens
 * de campo SEGURAS (vindas da politica central; descrevem o formato, nunca o
 * valor). Nao e usada em login (para nao distinguir causas).
 */
export interface PublicValidationFailureDto {
  readonly ok: false;
  readonly code: "invalid_request";
  readonly message: string;
  readonly fields: readonly string[];
}

/**
 * Usuario autenticado (visao publica MINIMA do proprio dono). Sem email, sem
 * PK interna, sem status/carimbos internos (deletedAt/emailVerifiedAt timestamp).
 * `emailVerified` e boolean derivado; nunca o timestamp.
 */
export interface CurrentUserDto {
  /** Identificador publico opaco (handle); null quando o usuario nao definiu. */
  readonly handle: string | null;
  readonly displayName: string | null;
  readonly emailVerified: boolean;
  readonly role: UserRole;
  readonly locale: string;
  readonly profileVisibility: ProfileVisibility;
}

/** Sucesso de login SEM token no body (o token vai por canal sensivel/cookie). */
export interface PublicLoginSuccessDto {
  readonly ok: true;
  readonly user: CurrentUserDto;
}

/**
 * Aceite generico para pedidos de recuperacao de senha e reenvio de
 * verificacao — resposta INDISTINGUIVEL exista ou nao a conta (anti-enumeracao).
 */
export interface GenericAcceptedDto {
  readonly ok: true;
  readonly status: "accepted";
  readonly message: string;
}

/**
 * Confirmacao de um token de uso unico consumido com sucesso (verificacao de
 * e-mail ou recuperacao de senha).
 *
 * Deliberadamente SEM detalhe: nao diz qual conta, nao diz se o e-mail ja estava
 * verificado, nao devolve `userId`, sessao nem token. Quem chegou ate aqui tinha
 * um link valido — o corpo nao precisa (nem pode) confirmar mais nada.
 */
export interface PublicConfirmationDto {
  readonly ok: true;
  readonly status: "confirmed";
}

/** Confirmacao generica de logout (uma sessao ou todas). */
export interface PublicLogoutDto {
  readonly ok: true;
  readonly status: "signed_out";
}

/**
 * Leitura da sessao atual. `authenticated=false` => `user=null` (sem detalhe).
 */
export interface PublicSessionDto {
  readonly authenticated: boolean;
  readonly user: CurrentUserDto | null;
}
