/**
 * OBSERVABILIDADE redigida do runtime de autenticacao (Backend C, C7C).
 *
 * O evento de log e um TIPO FECHADO, e essa e a defesa principal: nao existe
 * campo livre por onde e-mail, token, hash, IP, URL ou corpo do fornecedor
 * possam entrar. Uma varredura de fonte nao alcanca valor de runtime — um
 * `detail: string` seria vazamento fora do alcance de qualquer guarda.
 *
 * PERMITIDO (e util) registrar: correlacao, finalidade, fornecedor, desfecho,
 * motivo interno categorico, duracao, categoria de falha e o recibo tecnico do
 * fornecedor.
 *
 * PROIBIDO por construcao (nao ha campo): e-mail completo, token cru, hash de
 * token, senha, hash de senha, URL de acao, IP em texto claro, chave de API,
 * headers e corpo de resposta do fornecedor.
 */

import type { TransactionalEmailFailureCategory } from "../email/types.js";

export type AuthEmailPurpose = "email_verification" | "password_reset";

/**
 * Desfecho de UMA operacao, do ponto de vista interno.
 *
 * Pedidos que disparam e-mail:
 *  - `sent`            — o fornecedor aceitou a mensagem;
 *  - `not_applicable`  — nao havia o que enviar (conta inexistente, inelegivel,
 *    ja verificada, ou pedido barrado por throttle);
 *  - `provider_failed` — havia o que enviar e o fornecedor nao aceitou.
 *
 * Do lado de fora os tres sao INDISTINGUIVEIS (mesmo status, mesmo corpo) — e e
 * exatamente por isso que a distincao so pode existir aqui.
 *
 * Confirmacoes (consumo de token) nao tocam fornecedor e usam `confirmed` /
 * `rejected`. Rotula-las como `sent`/`not_applicable` seria descrever no log um
 * envio que nunca houve.
 */
export type AuthEmailOutcome =
  | "sent"
  | "not_applicable"
  | "provider_failed"
  | "confirmed"
  | "rejected";

export interface AuthEmailLogEvent {
  /** Correlacao da requisicao. Opaco, sem PII (ver `normalizeRequestId`). */
  readonly correlationId: string;
  readonly purpose: AuthEmailPurpose;
  /** `null` nas operacoes que nao falam com fornecedor (confirmacoes). */
  readonly provider: "brevo" | null;
  readonly outcome: AuthEmailOutcome;
  /**
   * Rotulo categorico da decisao interna (ex.: `issue_token`, `user_not_found`,
   * `account_ineligible`, `already_verified`, `throttled`). Vem do proprio
   * dominio; nunca e texto construido a partir de dado do usuario.
   */
  readonly internalReason: string;
  readonly durationMs: number;
  readonly failureCategory: TransactionalEmailFailureCategory | null;
  /** Recibo do fornecedor. Util para suporte; nunca vai a resposta publica. */
  readonly providerMessageId: string | null;
}

/**
 * Coletor de eventos. E uma FUNCAO, nao um objeto com niveis: a borda decide
 * para onde vai (stdout estruturado, agregador, nada). O runtime nao importa
 * `console` — assim nenhum modulo desta camada pode logar por conta propria.
 */
export type AuthEmailLogger = (event: AuthEmailLogEvent) => void;

/** Coletor nulo (default seguro: nao registrar e melhor do que registrar errado). */
export const noopAuthEmailLogger: AuthEmailLogger = () => undefined;
