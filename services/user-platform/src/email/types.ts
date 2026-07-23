/**
 * PORT de e-mail transacional (Backend C, C7C).
 *
 * Contrato de APLICACAO: descreve o que a autenticacao precisa enviar, nao como
 * um fornecedor envia. Este modulo NAO conhece Brevo, NAO conhece o endpoint,
 * NAO conhece o header `api-key` e NAO conhece o formato de resposta de
 * ninguem — trocar de fornecedor nao deve tocar uma linha aqui.
 *
 * PURO: sem rede, sem DB, sem relogio, sem `process.env`.
 *
 * O resultado devolvido e DELIBERADAMENTE minimo. A resposta completa do
 * fornecedor, os headers, o corpo HTML, o destinatario, o token e a URL secreta
 * NAO atravessam esta fronteira: o unico dado util para observabilidade e o
 * identificador tecnico da mensagem, e ele nunca chega ao usuario final.
 */

/**
 * Recibo tecnico de UMA mensagem aceita pelo fornecedor.
 *
 * `providerMessageId` serve so a observabilidade interna redigida (correlacionar
 * um envio com o painel do fornecedor). NUNCA vai para o corpo de uma resposta
 * publica: numa superficie anti-enumeracao, a simples PRESENCA de um id revelaria
 * que houve envio — logo, que a conta existe.
 */
export interface TransactionalEmailDelivery {
  readonly providerMessageId: string;
}

/**
 * Categorias de falha de envio. Deliberadamente FECHADAS e sem texto livre: um
 * campo de mensagem livre seria o canal por onde o corpo de erro do fornecedor
 * (que pode citar o destinatario) vazaria para um log.
 *
 * - `configuration_error`  — credencial recusada/insuficiente (401/403). A chave
 *   NUNCA aparece; so a categoria.
 * - `timeout`              — o teto de tempo estourou antes da resposta.
 * - `rate_limited`         — o fornecedor recusou por cota (429).
 * - `provider_rejected`    — o fornecedor entendeu e recusou (4xx de conteudo).
 * - `provider_unavailable` — rede indisponivel ou 5xx.
 * - `malformed_provider_response` — aceitou, mas a resposta nao prova o envio
 *   (status inesperado, JSON invalido ou `messageId` ausente/vazio).
 */
export const TRANSACTIONAL_EMAIL_FAILURE_CATEGORIES = [
  "configuration_error",
  "timeout",
  "rate_limited",
  "provider_rejected",
  "provider_unavailable",
  "malformed_provider_response",
] as const;

export type TransactionalEmailFailureCategory =
  (typeof TRANSACTIONAL_EMAIL_FAILURE_CATEGORIES)[number];

/**
 * Falha de envio transacional.
 *
 * A mensagem e derivada SO da categoria — nunca do corpo do fornecedor, nunca do
 * destinatario, nunca da URL. Um `Error` cuja `message` carregasse o payload de
 * erro do provedor acabaria num log de excecao nao tratada, e ai o vazamento
 * seria invisivel para qualquer varredura de fonte.
 */
export class TransactionalEmailError extends Error {
  readonly category: TransactionalEmailFailureCategory;

  constructor(category: TransactionalEmailFailureCategory) {
    super(`envio transacional nao concluido: ${category}`);
    this.name = "TransactionalEmailError";
    this.category = category;
  }
}

/** true quando o erro veio deste port (e portanto ja esta redigido). */
export function isTransactionalEmailError(error: unknown): error is TransactionalEmailError {
  return error instanceof TransactionalEmailError;
}

/**
 * Dados de UM envio. O servico de aplicacao ja resolveu tudo: o destinatario, a
 * URL de acao (com o token cru) e o prazo em minutos.
 *
 * NAO carrega `userId`, `status`, `purpose` interno nem qualquer fato sobre a
 * conta: o template nao pode revelar estado de conta, e o fornecedor nao precisa
 * saber nada alem do que vai no envelope.
 */
export interface TransactionalEmailDispatch {
  /** Destinatario. E o unico PII que atravessa este port, e por necessidade. */
  readonly to: string;
  /** URL absoluta de acao, ja montada (carrega o token CRU). Nunca logar. */
  readonly actionUrl: string;
  /** Validade do link, em minutos, para o texto do e-mail. */
  readonly expiresInMinutes: number;
}

/**
 * Fornecedor de e-mail transacional.
 *
 * DOIS metodos, nao um `send(template, vars)` generico: o assunto e o corpo de
 * cada fluxo sao decisao editorial versionada em `templates.ts`, e um metodo
 * generico permitiria a borda escolher o template — reabrindo a porta para
 * mandar um e-mail de reset com o texto de verificacao.
 */
export interface TransactionalEmailProvider {
  sendEmailVerification(input: TransactionalEmailDispatch): Promise<TransactionalEmailDelivery>;
  sendPasswordReset(input: TransactionalEmailDispatch): Promise<TransactionalEmailDelivery>;
}
