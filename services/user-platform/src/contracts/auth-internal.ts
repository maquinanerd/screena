/**
 * Contratos INTERNOS e SENSIVEIS de autenticacao (camadas C e E).
 *
 * ESTE ARQUIVO NUNCA e reexportado pelo barrel PUBLICO (public.ts). Ele guarda:
 *  - ENTREGA SENSIVEL (camada E): objetos que carregam segredo bruto (token de
 *    sessao/CSRF/verificacao/recuperacao) para a FUTURA borda de transporte
 *    (cookies/email). Nomes explicitos — nunca `data`/`result`/`metadata`;
 *  - RESULTADO INTERNO (camada C): orquestracao que separa o DTO publico da
 *    entrega sensivel e do motivo interno de observabilidade.
 *
 * Nada aqui pode ser serializado como body publico. Os mappers publicos
 * (auth-mappers.ts) NUNCA recebem estes objetos como entrada generica.
 *
 * PURO: sem rede, sem DB, sem crypto, sem relogio.
 */

import type { AuthTokenPurpose, ProfileVisibility, UserRole, UserStatus } from "../core/types.js";
import type { PublicAuthFailureDto, PublicLoginSuccessDto } from "./auth-dto.js";

// ---------------------------------------------------------------------------
// Camada E — ENTREGA SENSIVEL (segredo bruto; jamais publico)
// ---------------------------------------------------------------------------

/**
 * Segredos de sessao para a borda de transporte (cookies). NUNCA vai para o
 * body publico. O token de sessao e o CSRF sao os valores CRUS — o banco so
 * guarda o hash (dominio auth/sessions.ts).
 */
export interface SensitiveSessionDelivery {
  readonly rawSessionToken: string;
  readonly rawCsrfToken: string;
  readonly expiresAt: Date;
}

/**
 * Segredo de token de uso unico (verificacao de email / reset de senha) para
 * entrega por email. NUNCA vai para o body publico. O banco so guarda o hash.
 */
export interface SensitiveOneTimeTokenDelivery {
  readonly rawToken: string;
  readonly purpose: AuthTokenPurpose;
  readonly expiresAt: Date;
}

/** Agrupador nomeado de segredos de transporte (documenta intencao). */
export interface AuthTransportSecrets {
  readonly session?: SensitiveSessionDelivery;
  readonly oneTimeToken?: SensitiveOneTimeTokenDelivery;
}

// ---------------------------------------------------------------------------
// Fonte interna do usuario autenticado (o mapper faz o whitelist -> DTO)
// ---------------------------------------------------------------------------

/**
 * Visao INTERNA completa do usuario autenticado (como a persistencia entrega).
 * Carrega campos sensiveis/internos (id, email, status, carimbos) que NUNCA
 * podem vazar: `toCurrentUserDto` seleciona explicitamente o subconjunto
 * publico. Adicionar um campo aqui NAO o expoe automaticamente (whitelist).
 */
export interface AuthenticatedUserInternal {
  readonly id: bigint;
  readonly handle: string | null;
  readonly displayName: string | null;
  readonly email: string;
  readonly emailNormalized: string;
  readonly emailVerifiedAt: Date | null;
  readonly role: UserRole;
  readonly status: UserStatus;
  readonly locale: string;
  readonly profileVisibility: ProfileVisibility;
  readonly createdAt: Date;
  readonly deletedAt: Date | null;
}

// ---------------------------------------------------------------------------
// Camada C — RESULTADO INTERNO de orquestracao (nunca e a resposta publica)
// ---------------------------------------------------------------------------

/**
 * Resultado interno de um login. Separa explicitamente:
 *  - `publicDto`: o unico objeto que a borda serializa no body;
 *  - `sessionDelivery`: segredo de sessao (cookie), presente so em sucesso;
 *  - `internalReason`: rotulo categorico para audit (nunca vai ao body).
 * A borda envia `publicDto`, seta cookie a partir de `sessionDelivery` e loga
 * `internalReason` — tres canais distintos.
 */
export interface LoginInternalResult {
  readonly publicDto: PublicLoginSuccessDto | PublicAuthFailureDto;
  readonly sessionDelivery: SensitiveSessionDelivery | null;
  readonly internalReason: string;
}

/**
 * Resultado interno de um pedido que emite token por email (verificacao ou
 * recuperacao). A resposta publica e SEMPRE generica/aceita (anti-enumeracao);
 * a entrega sensivel so existe internamente quando ha token a enviar.
 */
export interface OneTimeTokenRequestInternalResult {
  readonly delivery: SensitiveOneTimeTokenDelivery | null;
  readonly internalReason: string;
}
