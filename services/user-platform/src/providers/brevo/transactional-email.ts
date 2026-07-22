/**
 * ADAPTER Brevo do port `TransactionalEmailProvider` (Backend C, C7C).
 *
 * UNICO arquivo do repositorio que conhece a Brevo. Fala com a API REST oficial
 * pelo `fetch` nativo do Node 22 — sem SDK.
 *
 *   POST https://api.brevo.com/v3/smtp/email
 *   accept: application/json
 *   content-type: application/json
 *   api-key: <BREVO_API_KEY>
 *
 * Por que REST direto e nao SDK: a integracao tem UM endpoint; um SDK
 * acrescentaria superficie de dependencia, esconderia o controle de timeout e
 * mudaria o lockfile sem necessidade.
 *
 * ESTE E O ENDPOINT TRANSACIONAL, NAO O DE CAMPANHA. `/v3/emailCampaigns` cria
 * newsletter de marketing: exige contato cadastrado em lista, e agendado e nao
 * serve para entregar um link de recuperacao de senha a alguem que pode nem ser
 * contato. Cadastrar o usuario numa lista de marketing so para conseguir enviar
 * um e-mail de seguranca seria uso indevido de dado pessoal.
 *
 * SEM RETRY AUTOMATICO, de proposito. Uma falha de rede depois do envio da
 * requisicao e INDISTINGUIVEL de uma falha antes: a mensagem pode ja ter sido
 * aceita. Sem idempotencia do lado do fornecedor, repetir e apostar em mandar
 * dois e-mails. Quem quiser outra tentativa pede de novo — e o fluxo publico
 * permite exatamente isso.
 *
 * O QUE NUNCA SAI DAQUI: a chave, o destinatario, o corpo HTML, o token, a URL
 * de acao, os headers e o corpo de resposta do fornecedor. Nada e logado (nao ha
 * `console` neste arquivo) e o erro devolvido carrega SO uma categoria fechada.
 */

import {
  TransactionalEmailError,
  type TransactionalEmailDelivery,
  type TransactionalEmailDispatch,
  type TransactionalEmailFailureCategory,
  type TransactionalEmailProvider,
} from "../../email/types.js";
import {
  renderEmailVerificationEmail,
  renderPasswordResetEmail,
  type RenderedTransactionalEmail,
} from "../../email/templates.js";

/** Endpoint TRANSACIONAL oficial. Nunca `/v3/emailCampaigns`. */
export const BREVO_TRANSACTIONAL_EMAIL_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

/**
 * Teto de tempo de UMA requisicao. Curto de proposito: o pedido publico ja
 * respondeu de forma generica, e prender o processo esperando um fornecedor
 * lento so consome recurso — o usuario pode pedir de novo.
 */
export const BREVO_DEFAULT_TIMEOUT_MS = 8000;

/** Assinatura minima do `fetch` usada aqui (injetavel nos testes). */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface BrevoTransactionalEmailProviderConfig {
  /** BREVO_API_KEY. Nunca logada, nunca no corpo, nunca em mensagem de erro. */
  readonly apiKey: string;
  readonly senderName: string;
  readonly senderEmail: string;
  /** `replyTo` so e enviado quando configurado. */
  readonly replyToEmail: string | null;
  /** Teto de tempo por requisicao. Injetavel para o teste nao dormir 8s. */
  readonly timeoutMs?: number;
  /** `fetch` alternativo (testes). Em producao fica indefinido e usa o global. */
  readonly fetchImpl?: FetchLike;
}

/**
 * Traducao STATUS -> categoria. Explicita e exaustiva por faixa, para que um
 * status novo caia numa categoria pensada e nao num ramo generico:
 *
 *  - 401/403 -> `configuration_error`: a credencial e que esta errada. A chave
 *    NAO entra na categoria nem na mensagem.
 *  - 429     -> `rate_limited`: cota do fornecedor.
 *  - >= 500  -> `provider_unavailable`: problema do lado deles.
 *  - demais 4xx -> `provider_rejected`: entenderam e recusaram (payload, credito,
 *    remetente nao validado).
 *  - 2xx que nao seja 201 -> `malformed_provider_response`: o contrato de
 *    sucesso da API e 201 com `messageId`; qualquer outro 2xx nao prova envio.
 */
export function categorizeBrevoStatus(status: number): TransactionalEmailFailureCategory {
  if (status === 401 || status === 403) {
    return "configuration_error";
  }
  if (status === 429) {
    return "rate_limited";
  }
  if (status >= 500) {
    return "provider_unavailable";
  }
  if (status >= 200 && status < 300) {
    return "malformed_provider_response";
  }
  return "provider_rejected";
}

/**
 * Le `messageId` VALIDANDO em runtime, sem cast cego. Um `as { messageId: string }`
 * faria `undefined` atravessar como se fosse string e o recibo viraria "undefined"
 * no log de observabilidade — um sucesso falso.
 */
export function readBrevoMessageId(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }
  const value = (payload as Record<string, unknown>)["messageId"];
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  return value;
}

/**
 * Consome e DESCARTA o corpo de uma resposta de erro.
 *
 * Nao consumir prende a conexao no pool do `undici`. O conteudo nunca e lido
 * para nada: nao vai a log, nao vai ao erro, nao vai ao chamador — a Brevo pode
 * ecoar o destinatario na mensagem de erro, e essa e a razao de ele morrer aqui.
 */
async function discardBody(response: Response): Promise<void> {
  try {
    await response.text();
  } catch {
    // Corpo ilegivel: nada a fazer e, principalmente, nada a registrar.
  }
}

interface BrevoRecipient {
  readonly email: string;
}

interface BrevoTransactionalPayload {
  readonly sender: { readonly name: string; readonly email: string };
  readonly to: readonly BrevoRecipient[];
  readonly subject: string;
  readonly htmlContent: string;
  readonly textContent: string;
  readonly replyTo?: { readonly email: string };
}

export function createBrevoTransactionalEmailProvider(
  config: BrevoTransactionalEmailProviderConfig,
): TransactionalEmailProvider {
  const timeoutMs = config.timeoutMs ?? BREVO_DEFAULT_TIMEOUT_MS;
  const doFetch: FetchLike = config.fetchImpl ?? ((url, init) => fetch(url, init));

  function buildPayload(
    to: string,
    email: RenderedTransactionalEmail,
  ): BrevoTransactionalPayload {
    const base: BrevoTransactionalPayload = {
      sender: { name: config.senderName, email: config.senderEmail },
      to: [{ email: to }],
      subject: email.subject,
      htmlContent: email.htmlContent,
      textContent: email.textContent,
    };
    // `replyTo` SO quando configurado: mandar o campo vazio faria a Brevo
    // recusar o payload, e mandar o remetente como reply-to seria inventar
    // configuracao que o operador nao pediu.
    if (config.replyToEmail === null) {
      return base;
    }
    return { ...base, replyTo: { email: config.replyToEmail } };
  }

  async function send(
    to: string,
    email: RenderedTransactionalEmail,
  ): Promise<TransactionalEmailDelivery> {
    // A chave NAO entra no corpo — so no header. Um corpo com credencial
    // acabaria em qualquer proxy/log de requisicao que registre payload.
    const body = JSON.stringify(buildPayload(to, email));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    // O TETO DE TEMPO COBRE A RESPOSTA INTEIRA, corpo incluso.
    //
    // Limpar o timer assim que os cabecalhos chegam deixaria a leitura do corpo
    // SEM sinal armado: um fornecedor (ou um intermediario) que devolvesse `201`
    // e depois travasse o corpo prenderia a requisicao indefinidamente. O
    // `clearTimeout` fica no `finally` EXTERNO, depois de o corpo ter sido
    // consumido.
    try {
      let response: Response;
      try {
        response = await doFetch(BREVO_TRANSACTIONAL_EMAIL_ENDPOINT, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "api-key": config.apiKey,
          },
          body,
          signal: controller.signal,
        });
      } catch {
        // O erro original NAO e reanexado: `fetch` pode carregar a URL e, em
        // alguns runtimes, ate cabecalhos na causa. Distinguimos so as duas
        // categorias que mudam a leitura operacional — estouro de tempo x
        // rede/fornecedor fora.
        throw new TransactionalEmailError(
          controller.signal.aborted ? "timeout" : "provider_unavailable",
        );
      }

      // SUCESSO E EXATAMENTE 201. A API transacional responde 201 com
      // `messageId`; aceitar "qualquer 2xx" registraria como enviado uma
      // resposta que nao prova envio nenhum.
      if (response.status !== 201) {
        await discardBody(response);
        throw new TransactionalEmailError(categorizeBrevoStatus(response.status));
      }

      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        // Corpo travado ate o teto de tempo aborta a leitura: e timeout, nao
        // resposta malformada. Confundir os dois esconderia um fornecedor lento
        // atras de um diagnostico de payload.
        throw new TransactionalEmailError(
          controller.signal.aborted ? "timeout" : "malformed_provider_response",
        );
      }

      const providerMessageId = readBrevoMessageId(parsed);
      if (providerMessageId === null) {
        throw new TransactionalEmailError("malformed_provider_response");
      }

      // SO o recibo tecnico atravessa. O restante da resposta morre aqui.
      return { providerMessageId };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async sendEmailVerification(
      input: TransactionalEmailDispatch,
    ): Promise<TransactionalEmailDelivery> {
      return send(
        input.to,
        renderEmailVerificationEmail({
          actionUrl: input.actionUrl,
          expiresInMinutes: input.expiresInMinutes,
        }),
      );
    },

    async sendPasswordReset(
      input: TransactionalEmailDispatch,
    ): Promise<TransactionalEmailDelivery> {
      return send(
        input.to,
        renderPasswordResetEmail({
          actionUrl: input.actionUrl,
          expiresInMinutes: input.expiresInMinutes,
        }),
      );
    },
  };
}
