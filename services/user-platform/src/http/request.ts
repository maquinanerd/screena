/**
 * Leitura FAIL-CLOSED da requisicao HTTP (Backend C, C7C).
 *
 * Tudo que entra e hostil ate prova em contrario: metodo, content-type, tamanho
 * e sintaxe sao checados ANTES de qualquer parse de dominio, e cada checagem tem
 * uma razao concreta.
 *
 * O ENDERECO DE ORIGEM nunca sai daqui em texto claro: e lido do cabecalho de
 * proxy, hasheado com sal de servidor e so entao repassado. Nenhuma camada
 * abaixo desta recebe IP cru, entao nenhuma delas pode persisti-lo ou loga-lo
 * nem por engano.
 */

import { normalizeRequestId } from "../core/request-guards.js";

/**
 * Teto do corpo aceito. Os quatro comandos desta borda tem no maximo um e-mail,
 * um token opaco e uma senha — nada disso passa de alguns KB. Um teto baixo e a
 * defesa mais barata contra um corpo gigante que consumiria memoria antes de
 * qualquer validacao.
 */
export const MAX_AUTH_BODY_BYTES = 4096;

/** Comprimento maximo plausivel de um endereco IP textual (IPv6 + zona). */
const MAX_IP_LENGTH = 45;

/** Forma minima de um IP (v4 ou v6). Nao valida semantica — so barra lixo. */
const IP_SHAPE = /^[0-9a-fA-F.:]+$/;

export type BodyReadResult =
  | { readonly kind: "ok"; readonly value: unknown }
  | { readonly kind: "method_not_allowed" }
  | { readonly kind: "malformed" };

function isJsonContentType(header: string | null): boolean {
  if (header === null) {
    return false;
  }
  // `application/json` com parametros opcionais (`; charset=utf-8`). Exigir o
  // content-type correto barra o envio por formulario HTML entre origens, que e
  // o vetor classico de CSRF em endpoint que aceita qualquer corpo.
  const mediaType = header.split(";")[0]?.trim().toLowerCase() ?? "";
  return mediaType === "application/json";
}

/**
 * Le e parseia o corpo JSON de uma mutacao.
 *
 * Ordem: metodo -> content-type -> tamanho declarado -> tamanho real -> sintaxe.
 * O tamanho e conferido DUAS vezes porque `Content-Length` e informado pelo
 * cliente e pode mentir (ou faltar, em `Transfer-Encoding: chunked`).
 */
export async function readJsonBody(request: Request): Promise<BodyReadResult> {
  if (request.method.toUpperCase() !== "POST") {
    return { kind: "method_not_allowed" };
  }
  if (!isJsonContentType(request.headers.get("content-type"))) {
    return { kind: "malformed" };
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const declared = Number(declaredLength);
    if (!Number.isFinite(declared) || declared > MAX_AUTH_BODY_BYTES) {
      return { kind: "malformed" };
    }
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { kind: "malformed" };
  }

  // Bytes, nao caracteres: um corpo de acentuacao/emoji ocupa mais bytes do que
  // `length` sugere, e o teto existe para limitar memoria, nao code points.
  if (Buffer.byteLength(raw, "utf8") > MAX_AUTH_BODY_BYTES) {
    return { kind: "malformed" };
  }

  // Corpo vazio nao e `{}`: os quatro comandos exigem campos, e deixar o vazio
  // virar objeto vazio so adiaria a recusa para o parser.
  if (raw.trim().length === 0) {
    return { kind: "malformed" };
  }

  try {
    return { kind: "ok", value: JSON.parse(raw) };
  } catch {
    // A mensagem do `JSON.parse` cita um trecho do corpo — que pode conter a
    // senha. Ela morre aqui e nunca vira resposta nem log.
    return { kind: "malformed" };
  }
}

/**
 * Extrai o endereco de origem dos cabecalhos de proxy.
 *
 * O primeiro valor de `X-Forwarded-For` e o cliente original quando ha um proxy
 * confiavel na frente (Traefik, no EasyPanel). Sem proxy confiavel o cabecalho e
 * forjavel — e por isso ele so alimenta o throttle POR ORIGEM, que e uma camada
 * a mais, nunca a unica: o orcamento por e-mail continua valendo sozinho.
 */
export function readClientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip");
  if (forwarded === null) {
    return null;
  }
  const candidate = (forwarded.split(",")[0] ?? "").trim();
  if (candidate.length === 0 || candidate.length > MAX_IP_LENGTH || !IP_SHAPE.test(candidate)) {
    return null;
  }
  return candidate;
}

/**
 * Identificador de correlacao da requisicao.
 *
 * Reusa `normalizeRequestId` (core/request-guards): um `X-Request-Id` de fora so
 * e aceito se casar o formato opaco; qualquer outra coisa cai no valor gerado
 * localmente. Sem isso, um cliente poderia injetar texto arbitrario — inclusive
 * o proprio e-mail — dentro dos nossos logs.
 */
export function resolveCorrelationId(request: Request, fallback: string): string {
  return normalizeRequestId(request.headers.get("x-request-id") ?? undefined, fallback);
}

/**
 * Comprimento maximo de user-agent aceito na BORDA.
 *
 * `minimizeUserAgent` (auth/sessions.ts) ja corta em 256 antes de persistir; o
 * corte aqui e anterior e existe para que uma string de megabytes nunca chegue a
 * atravessar as camadas — o mesmo motivo do teto de corpo.
 */
const MAX_USER_AGENT_LENGTH = 256;

/**
 * User-agent, truncado e sem espacos nas pontas. Ausente ou vazio => `null`.
 *
 * Nunca recusa a requisicao: um cliente sem user-agent e normal (curl, health
 * check, leitor de tela em modo estrito), e barrar por causa disso quebraria
 * acesso legitimo sem ganho de seguranca nenhum.
 */
export function readUserAgent(request: Request): string | null {
  const raw = request.headers.get("user-agent");
  if (raw === null) {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, MAX_USER_AGENT_LENGTH);
}
