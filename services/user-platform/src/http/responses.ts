/**
 * Respostas HTTP da borda de autenticacao (Backend C, C7C).
 *
 * TRANSPORT-AGNOSTIC: usa `Request`/`Response` da plataforma (Node 22), nao
 * Next.js. E isso que permite testar cada endpoint com uma `Request` de verdade,
 * sem subir servidor e sem framework.
 *
 * Toda resposta sai com os MESMOS cabecalhos de seguranca:
 *
 *  - `Cache-Control: no-store` — nenhuma resposta de autenticacao pode ficar em
 *    cache de proxy, CDN ou navegador;
 *  - `Referrer-Policy: no-referrer` — a pagina que consome estes endpoints
 *    carrega o token na URL; sem isto, o `Referer` o entregaria a terceiros;
 *  - `X-Content-Type-Options: nosniff`;
 *  - `Content-Type: application/json; charset=utf-8`.
 *
 * NENHUM corpo daqui carrega stack trace, mensagem de excecao, nome de tabela,
 * token, hash, e-mail, `userId` ou motivo interno.
 */

import { GENERIC_TOKEN_FAILURE_MESSAGE } from "../auth/types.js";
import {
  toPublicConfirmationDto,
  toPublicValidationFailureDto,
} from "../contracts/auth-mappers.js";
import type { GenericAcceptedDto, PublicAuthFailureDto } from "../contracts/auth-dto.js";

/** Cabecalhos aplicados a TODA resposta desta borda. */
export const AUTH_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...AUTH_SECURITY_HEADERS },
  });
}

/**
 * ACEITE GENERICO (202) dos pedidos que disparam e-mail.
 *
 * O status e o corpo sao IDENTICOS para conta existente, inexistente,
 * desativada, ja verificada, pedido barrado por throttle e fornecedor fora do
 * ar. Qualquer variacao — inclusive de status HTTP — seria um oraculo de
 * existencia de conta.
 */
export function acceptedResponse(dto: GenericAcceptedDto): Response {
  return jsonResponse(202, dto);
}

/** Confirmacao (200) de um token consumido com sucesso. */
export function confirmedResponse(): Response {
  return jsonResponse(200, toPublicConfirmationDto());
}

/**
 * Recusa de token (401): inexistente, expirado, ja usado, de proposito errado ou
 * de conta inelegivel — todos com a MESMA mensagem. A mensagem vem da constante
 * do dominio, que ja foi desenhada para ser publica e nao distinguir causas.
 */
export function tokenRejectedResponse(): Response {
  const dto: PublicAuthFailureDto = {
    ok: false,
    code: "unauthorized",
    message: GENERIC_TOKEN_FAILURE_MESSAGE,
  };
  return jsonResponse(401, dto);
}

/**
 * Corpo invalido (400) com mensagens de CAMPO seguras: elas descrevem o formato
 * esperado, nunca o valor recebido (os parsers de `contracts/` garantem isso).
 */
export function validationFailedResponse(fieldErrors: readonly string[]): Response {
  return jsonResponse(400, toPublicValidationFailureDto(fieldErrors));
}

/**
 * Corpo ilegivel (400) SEM detalhe: content-type errado, corpo grande demais ou
 * JSON malformado. Nao ha o que descrever com seguranca sobre uma entrada que
 * sequer foi parseada.
 */
export function malformedRequestResponse(): Response {
  const dto: PublicAuthFailureDto = {
    ok: false,
    code: "invalid_request",
    message: "requisicao invalida.",
  };
  return jsonResponse(400, dto);
}

/** Metodo nao permitido (405). Mutacao NUNCA aceita GET. */
export function methodNotAllowedResponse(): Response {
  const dto: PublicAuthFailureDto = {
    ok: false,
    code: "invalid_request",
    message: "metodo nao permitido.",
  };
  return new Response(JSON.stringify(dto), {
    status: 405,
    headers: { ...AUTH_SECURITY_HEADERS, allow: "POST" },
  });
}

/**
 * Falha inesperada (500) com corpo FIXO.
 *
 * Nem a mensagem da excecao, nem o `name`, nem a stack entram na resposta. Uma
 * excecao de driver pode citar parametros de query — e um deles pode ser o hash
 * de um token. Por isso o objeto de erro nem sequer e repassado ao coletor: so o
 * identificador de correlacao atravessa.
 */
export function unexpectedFailureResponse(): Response {
  const dto: PublicAuthFailureDto = {
    ok: false,
    code: "error",
    message: "nao foi possivel completar a operacao.",
  };
  return jsonResponse(500, dto);
}
