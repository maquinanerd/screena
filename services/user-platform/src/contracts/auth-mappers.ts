/**
 * MAPPERS publicos de autenticacao — internos -> DTO publico por WHITELIST.
 *
 * Regras (todas travadas por teste):
 *  - recebem tipos internos ESPECIFICOS (nunca `unknown` sem parse anterior);
 *  - selecionam campos EXPLICITAMENTE (campo a campo) — NUNCA spread/
 *    Object.assign/serializacao automatica;
 *  - produzem SEMPRE um objeto NOVO; nunca retornam referencia da entrada;
 *  - nunca deixam passar internalReason, hash, token, ip, PK interna, email
 *    ou carimbos internos;
 *  - sao deterministicos e o vocabulario publico de erro e CONTROLADO aqui
 *    (nao ecoa a mensagem interna do dominio).
 *
 * PURO: sem rede, sem DB, sem crypto, sem relogio.
 */

import type { DomainError } from "../core/result.js";
import type { AuthenticatedUserInternal } from "./auth-internal.js";
import type {
  CurrentUserDto,
  GenericAcceptedDto,
  PublicAuthFailureDto,
  PublicFailureCode,
  PublicLoginSuccessDto,
  PublicLogoutDto,
  PublicSessionDto,
  PublicValidationFailureDto,
} from "./auth-dto.js";

/** Mensagem generica de aceite (recuperacao/reenvio de verificacao). */
const GENERIC_ACCEPTED_MESSAGE =
  "se aplicavel, enviaremos as instrucoes por email. Verifique sua caixa de entrada.";

/**
 * Traducao CONTROLADA de codigo de dominio -> (codigo publico, mensagem fixa).
 * A mensagem publica e definida AQUI (nao copiada do dominio), garantindo um
 * vocabulario estavel e sem vazamento. Codigo desconhecido cai no fallback
 * generico (fail-closed).
 */
const PUBLIC_FAILURE: Readonly<
  Record<string, { readonly code: PublicFailureCode; readonly message: string }>
> = {
  unauthorized: { code: "unauthorized", message: "credenciais invalidas." },
  locked_out: {
    code: "locked_out",
    message: "muitas tentativas. Aguarde alguns minutos e tente novamente.",
  },
  forbidden: { code: "forbidden", message: "acao nao permitida." },
  csrf_mismatch: { code: "forbidden", message: "acao nao permitida." },
  validation_failed: { code: "invalid_request", message: "dados invalidos." },
};

const FALLBACK_FAILURE: { readonly code: PublicFailureCode; readonly message: string } = {
  code: "error",
  message: "nao foi possivel completar a operacao.",
};

/**
 * Falha publica generica a partir de um DomainError. So o `code` e consultado;
 * a mensagem publica vem da tabela controlada — nunca de `error.message` (que
 * poderia, em teoria, carregar detalhe). `details`/`internalReason` sao
 * descartados por construcao.
 */
export function toPublicAuthFailureDto(error: DomainError): PublicAuthFailureDto {
  const mapped = PUBLIC_FAILURE[error.code] ?? FALLBACK_FAILURE;
  return { ok: false, code: mapped.code, message: mapped.message };
}

/**
 * Falha de VALIDACAO de entrada com mensagens de campo seguras (formato do
 * corpo). As mensagens vem da politica central / parser — descrevem o formato,
 * nunca o valor. Copia cada string explicitamente (novo array).
 */
export function toPublicValidationFailureDto(
  fieldErrors: readonly string[],
): PublicValidationFailureDto {
  return {
    ok: false,
    code: "invalid_request",
    message: "dados invalidos.",
    fields: fieldErrors.map((e) => String(e)),
  };
}

/**
 * Usuario autenticado -> DTO publico por whitelist EXPLICITA. Campos internos
 * (id, email, emailNormalized, status, emailVerifiedAt timestamp, createdAt,
 * deletedAt) NAO sao copiados. `emailVerified` deriva do timestamp -> boolean.
 */
export function toCurrentUserDto(internal: AuthenticatedUserInternal): CurrentUserDto {
  return {
    handle: internal.handle,
    displayName: internal.displayName,
    emailVerified: internal.emailVerifiedAt !== null,
    role: internal.role,
    locale: internal.locale,
    profileVisibility: internal.profileVisibility,
  };
}

/** Sucesso de login (sem token no body). */
export function toPublicLoginSuccessDto(
  internal: AuthenticatedUserInternal,
): PublicLoginSuccessDto {
  return { ok: true, user: toCurrentUserDto(internal) };
}

/** Leitura da sessao atual: usuario autenticado ou `authenticated=false`. */
export function toPublicSessionDto(
  internal: AuthenticatedUserInternal | null,
): PublicSessionDto {
  if (internal === null) {
    return { authenticated: false, user: null };
  }
  return { authenticated: true, user: toCurrentUserDto(internal) };
}

/** Aceite generico (recuperacao/reenvio) — sempre identico (anti-enumeracao). */
export function toGenericAcceptedDto(): GenericAcceptedDto {
  return { ok: true, status: "accepted", message: GENERIC_ACCEPTED_MESSAGE };
}

/** Confirmacao generica de logout. */
export function toPublicLogoutDto(): PublicLogoutDto {
  return { ok: true, status: "signed_out" };
}
