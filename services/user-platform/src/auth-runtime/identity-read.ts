/**
 * Leitura do usuario autenticado (Backend C, C7D).
 *
 * UMA funcao, e ela existe por uma razao de fronteira: `persistence/` NAO
 * importa `contracts/`, entao o registro que a persistencia devolve
 * (`AuthenticatedUserRecord`) e o contrato interno que os mappers publicos
 * consomem (`AuthenticatedUserInternal`) sao tipos SEPARADOS, ainda que de
 * forma identica hoje.
 *
 * A conversao e CAMPO A CAMPO de proposito. Um `...spread` faria uma coluna
 * nova acrescentada a projecao de persistencia atravessar sozinha ate a beira
 * do DTO publico; aqui, acrescentar um campo do lado de la nao muda nada do
 * lado de ca ate alguem escrever a linha.
 */

import type { AuthenticatedUserInternal } from "../contracts/auth-internal.js";
import type { TransactionScope } from "../persistence/types.js";
import type { AuthStores } from "./deps.js";

export async function loadAuthenticatedUser(
  stores: AuthStores,
  scope: TransactionScope,
  userId: bigint,
): Promise<AuthenticatedUserInternal | null> {
  const lookup = await stores.profiles.findAuthenticatedUser(scope, userId);
  if (lookup.kind !== "found") {
    return null;
  }
  const user = lookup.user;
  return {
    id: user.id,
    handle: user.handle,
    displayName: user.displayName,
    email: user.email,
    emailNormalized: user.emailNormalized,
    emailVerifiedAt: user.emailVerifiedAt,
    role: user.role,
    status: user.status,
    locale: user.locale,
    profileVisibility: user.profileVisibility,
    createdAt: user.createdAt,
    deletedAt: user.deletedAt,
  };
}
