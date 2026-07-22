/**
 * ENTREGA do e-mail e registro do desfecho (Backend C, C7C).
 *
 * Duas regras moram aqui, e as duas sao de seguranca:
 *
 *  1. O ENVIO ACONTECE FORA DE QUALQUER TRANSACAO. Quem chama ja comitou o token
 *     antes de pedir a entrega. Manter uma conexao de banco aberta durante uma
 *     chamada HTTP a terceiro prenderia a conexao pelo tempo do fornecedor e
 *     arriscaria estourar o timeout da transacao do Prisma.
 *
 *  2. FALHA DE ENVIO NAO MUDA A RESPOSTA PUBLICA. Nenhum erro escapa daqui —
 *     nem `TransactionalEmailError`, nem excecao inesperada. Se uma falha de
 *     fornecedor virasse 500 enquanto o caso "conta nao existe" continua 202, a
 *     diferenca de status responderia com precisao a unica pergunta que a
 *     anti-enumeracao existe para nao responder: essa conta existe?
 *
 * O TOKEN JA FOI PERSISTIDO quando chegamos aqui, e o banco e o fornecedor NAO
 * participam da mesma transacao. Se o envio falhar, o token permanece valido
 * porem nao entregue: NAO ha compensacao automatica. Queimar tokens pendentes
 * aqui invalidaria tambem links legitimos anteriores, e o port nao oferece
 * invalidacao dirigida a UM token. O usuario simplesmente pede de novo — e o
 * fluxo publico permite. Limite registrado em
 * docs/product/user-product-auth-runtime.md.
 */

import { isTransactionalEmailError, type TransactionalEmailProvider } from "../email/types.js";
import type { AuthEmailLogEvent, AuthEmailLogger, AuthEmailPurpose } from "./observability.js";

/**
 * Registro tolerante a falha do coletor. O coletor e codigo de fora: se ele
 * lancar, a falha nao pode contaminar a resposta publica nem, principalmente,
 * revelar que houve envio (uma excecao so nos casos com envio seria um oraculo
 * de existencia de conta).
 */
export function logAuthEmailEvent(logger: AuthEmailLogger, event: AuthEmailLogEvent): void {
  try {
    logger(event);
  } catch {
    // Observabilidade quebrada nao pode derrubar autenticacao.
  }
}

/** O que enviar, quando ha algo a enviar. */
export interface AuthEmailDelivery {
  readonly to: string;
  readonly actionUrl: string;
  readonly expiresInMinutes: number;
}

/**
 * Envia (quando aplicavel) e registra o desfecho. NUNCA lanca.
 *
 * `delivery = null` significa "nao havia o que enviar" — conta inexistente,
 * inelegivel, ja verificada ou pedido barrado por throttle. Do lado de fora esse
 * caso e indistinguivel de um envio bem-sucedido; a distincao so existe no log.
 */
export async function dispatchAuthEmail(input: {
  readonly provider: TransactionalEmailProvider;
  readonly logger: AuthEmailLogger;
  readonly purpose: AuthEmailPurpose;
  readonly correlationId: string;
  readonly internalReason: string;
  readonly delivery: AuthEmailDelivery | null;
  readonly durationMs: number;
}): Promise<void> {
  const base = {
    correlationId: input.correlationId,
    purpose: input.purpose,
    provider: "brevo",
    internalReason: input.internalReason,
    durationMs: input.durationMs,
  } as const;

  if (input.delivery === null) {
    logAuthEmailEvent(input.logger, {
      ...base,
      outcome: "not_applicable",
      failureCategory: null,
      providerMessageId: null,
    });
    return;
  }

  try {
    const receipt =
      input.purpose === "email_verification"
        ? await input.provider.sendEmailVerification(input.delivery)
        : await input.provider.sendPasswordReset(input.delivery);
    logAuthEmailEvent(input.logger, {
      ...base,
      outcome: "sent",
      failureCategory: null,
      providerMessageId: receipt.providerMessageId,
    });
  } catch (error) {
    // Excecao INESPERADA tambem morre aqui, categorizada como indisponibilidade.
    // Deixa-la subir faria a borda responder 500 so nos casos em que houve
    // tentativa de envio — ou seja, so quando a conta existe.
    logAuthEmailEvent(input.logger, {
      ...base,
      outcome: "provider_failed",
      failureCategory: isTransactionalEmailError(error) ? error.category : "provider_unavailable",
      providerMessageId: null,
    });
  }
}
