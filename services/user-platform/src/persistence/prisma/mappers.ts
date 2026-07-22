/**
 * mappers.ts — conversao LINHA DO BANCO -> DTO de dominio (Backend C, C7B1).
 *
 * Regra unica deste modulo: nada sai daqui que o contrato nao tenha declarado.
 * Nenhum model do Prisma atravessa a fronteira e nenhum spread constroi DTO — os
 * campos sao escritos UM A UM, para que acrescentar uma coluna no schema jamais
 * vaze automaticamente para o dominio (e para a resposta HTTP, um dia).
 *
 * Ha exatamente UM cast no arquivo (`toUserStatus`), e ele nao converte model em
 * DTO: alarga o tipo do lookup para admitir `undefined` e permitir a checagem
 * fail-closed contra um banco a frente do client gerado. Registrado aqui porque
 * "nenhum cast" seria uma afirmacao falsa.
 */

import type { $Enums } from "@prisma/client";
import {
  AUTH_TOKEN_PURPOSES,
  USER_STATUSES,
  type AuthTokenPurpose,
  type UserStatus,
} from "../../core/types.js";
import type {
  CredentialVerificationMaterial,
  EmailVerificationState,
  IdentityRecord,
  SessionAccessRecord,
} from "../types.js";

/**
 * Traducao EXPLICITA do enum do banco para o enum do dominio.
 *
 * O `Record<$Enums.UserStatus, UserStatus>` e a trava: acrescentar um valor ao
 * enum `UserStatus` do Prisma passa a QUEBRAR O TYPECHECK aqui, em vez de cair
 * num `default` silencioso que mapearia um estado desconhecido para algo
 * plausivel. Os dois conjuntos sao hoje identicos (`active`, `disabled`,
 * `pending_deletion`, `deleted`), mas identidade acidental nao e contrato: sem
 * este mapa, um `as UserStatus` esconderia a divergencia no dia em que ela
 * aparecesse.
 */
const USER_STATUS_BY_DB: Record<$Enums.UserStatus, UserStatus> = {
  active: "active",
  disabled: "disabled",
  pending_deletion: "pending_deletion",
  deleted: "deleted",
};

/**
 * Erro de mapeamento. Carrega SO o nome do campo — nunca o valor, nunca a linha,
 * nunca o e-mail, nunca o hash. Um estado desconhecido normalmente chega junto
 * de uma linha inteira nas maos do chamador; deixar o valor entrar na mensagem
 * transformaria o log de erro num canal de vazamento.
 */
export class UnmappableRowError extends Error {
  constructor(field: string) {
    super(`valor fora do dominio na coluna ${field}`);
    this.name = "UnmappableRowError";
  }
}

/**
 * Converte o status vindo do banco. Fail-closed: valor fora do dominio LANCA em
 * vez de virar `active` por conveniencia — um status desconhecido tratado como
 * ativo daria sessao a uma conta que o produto talvez tenha desativado
 * (`accountCanHoldSession` so aceita `active`).
 *
 * O `Record` acima ja cobre o enum GERADO; esta checagem cobre o caso em que o
 * banco devolve algo que o client gerado nao conhece (schema a frente do
 * client), que o typecheck nao consegue ver.
 */
function toUserStatus(dbStatus: $Enums.UserStatus): UserStatus {
  const mapped = USER_STATUS_BY_DB[dbStatus] as UserStatus | undefined;
  if (mapped === undefined || !USER_STATUSES.includes(mapped)) {
    throw new UnmappableRowError("status");
  }
  return mapped;
}

/**
 * Linha MINIMA de identidade que o adapter le. Declarada aqui (e nao inferida do
 * Prisma) para que o `select` do adapter tenha um alvo fixo: se alguem ampliar o
 * select, o excedente nao tem para onde ir.
 */
export interface IdentityRow {
  readonly id: bigint;
  readonly status: $Enums.UserStatus;
}

/**
 * `IdentityRecord` = `{ id, status }` e MAIS NADA. Sem hash, sem algoritmo, sem
 * e-mail (nem o normalizado: quem consultou ja o tem — devolve-lo seria PII sem
 * leitor), sem `handle`, `role`, `displayName` nem timestamps.
 */
export function toIdentityRecord(row: IdentityRow): IdentityRecord {
  return {
    id: row.id,
    status: toUserStatus(row.status),
  };
}

/** Linha MINIMA de credencial: so o hash, e so para a verificacao. */
export interface CredentialRow {
  readonly passwordHash: string;
}

/**
 * UNICO mapper autorizado a carregar segredo. O valor sai opaco, exatamente como
 * entrou: este modulo nao interpreta PHC, nao extrai parametros de scrypt, nao
 * deriva `algorithm` e nao compara nada.
 *
 * `algorithm` NAO e transportado de proposito: `authenticatePassword` recebe so
 * `storedHash`, e ate um futuro rehash-on-login le os parametros de dentro do
 * proprio PHC. Levar o rotulo junto ampliaria a superficie do unico struct que
 * carrega segredo, sem nenhum leitor.
 */
export function toCredentialVerificationMaterial(
  row: CredentialRow,
): CredentialVerificationMaterial {
  return { passwordHash: row.passwordHash };
}

/**
 * Traducao EXPLICITA do enum de proposito. Mesmo motivo do mapa de status: um
 * valor novo no enum do Prisma passa a quebrar o typecheck aqui, em vez de
 * atravessar como se fosse conhecido. Um proposito mal traduzido deixaria um
 * token de verificacao redefinir senha.
 */
const AUTH_TOKEN_PURPOSE_BY_DB: Record<$Enums.AuthTokenPurpose, AuthTokenPurpose> = {
  email_verification: "email_verification",
  password_reset: "password_reset",
};

/** Fail-closed: proposito fora do dominio LANCA, nunca assume um valor plausivel. */
export function toAuthTokenPurpose(dbPurpose: $Enums.AuthTokenPurpose): AuthTokenPurpose {
  const mapped = AUTH_TOKEN_PURPOSE_BY_DB[dbPurpose] as AuthTokenPurpose | undefined;
  if (mapped === undefined || !AUTH_TOKEN_PURPOSES.includes(mapped)) {
    throw new UnmappableRowError("purpose");
  }
  return mapped;
}

/** Linha MINIMA de sessao que o adapter le. */
export interface SessionAccessRow {
  readonly id: bigint;
  readonly userId: bigint;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

/**
 * `SessionAccessRecord` = `{ id, userId, expiresAt, revokedAt }` e MAIS NADA.
 * Sem `tokenHash`, sem `csrfTokenHash`, sem `ipHash`, sem `userAgent`: campo a
 * campo, para que ampliar o select nunca vaze sozinho para o dominio.
 */
export function toSessionAccessRecord(row: SessionAccessRow): SessionAccessRecord {
  return {
    id: row.id,
    userId: row.userId,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
  };
}

/** Linha MINIMA do estado de verificacao (C7B2.2). */
export interface EmailVerificationStateRow {
  readonly id: bigint;
  readonly emailVerifiedAt: Date | null;
  readonly status: $Enums.UserStatus;
}

/**
 * Devolve o FATO (`emailVerifiedAt`), nunca a decisao. Converter para
 * `alreadyVerified: boolean` aqui faria o mapper decidir politica no lugar do
 * dominio e descartaria o QUANDO — que `markEmailVerified` preserva de
 * proposito. `null` permanece `null`, nunca vira string vazia nem `false`.
 */
export function toEmailVerificationState(row: EmailVerificationStateRow): EmailVerificationState {
  return {
    userId: row.id,
    emailVerifiedAt: row.emailVerifiedAt,
    // Fail-closed no mapa explicito: status desconhecido LANCA em vez de
    // atravessar como se fosse elegivel.
    status: toUserStatus(row.status),
  };
}
