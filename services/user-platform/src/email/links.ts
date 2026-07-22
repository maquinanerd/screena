/**
 * Montagem dos LINKS de acao enviados por e-mail (Backend C, C7C).
 *
 * PURO: sem rede, sem DB, sem relogio, sem `process.env`.
 *
 * Regras que este modulo existe para tornar estruturais:
 *
 *  1. A URL e montada com `new URL` + `URLSearchParams`, NUNCA por concatenacao.
 *     Concatenar deixaria o token sem escape na query e permitiria que um valor
 *     inesperado alterasse a estrutura da URL.
 *  2. O UNICO parametro e o token. E-mail, `userId`, status, `purpose` interno,
 *     hash e senha jamais entram na URL: a barra de enderecos e copiada, fica no
 *     historico do navegador e vaza por `Referer` — e nada disso e reversivel.
 *  3. As rotas terminam em BARRA. O app publico roda com `trailingSlash: true`;
 *     emitir a forma sem barra faria o Next responder 308 para a forma canonica,
 *     e o token passaria por um `Location` a mais sem necessidade nenhuma.
 */

/** Pagina que recebe o token de verificacao de e-mail (pt-BR). */
export const EMAIL_VERIFICATION_PATH = "/pt/verificar-email/";

/** Pagina que recebe o token de recuperacao de senha (pt-BR). */
export const PASSWORD_RESET_PATH = "/pt/redefinir-senha/";

/** Nome do UNICO parametro de query aceito nas duas paginas. */
export const TOKEN_QUERY_PARAM = "token";

/**
 * Monta a URL absoluta de acao.
 *
 * `publicAppUrl` e a ORIGEM da aplicacao — validada em
 * `auth-runtime/config.ts` para nao ter caminho, query, fragmento nem
 * credenciais. Como o caminho aqui e ABSOLUTO ("/pt/..."), qualquer prefixo de
 * caminho na base seria descartado em silencio; a validacao da config e o que
 * impede esse desencontro, e nao um comentario.
 */
function buildActionUrl(publicAppUrl: URL, pathname: string, rawToken: string): string {
  const url = new URL(pathname, publicAppUrl);
  url.searchParams.set(TOKEN_QUERY_PARAM, rawToken);
  return url.toString();
}

/** Link do e-mail de verificacao. Carrega o token CRU — nunca logar. */
export function buildEmailVerificationUrl(input: {
  readonly publicAppUrl: URL;
  readonly rawToken: string;
}): string {
  return buildActionUrl(input.publicAppUrl, EMAIL_VERIFICATION_PATH, input.rawToken);
}

/** Link do e-mail de recuperacao. Carrega o token CRU — nunca logar. */
export function buildPasswordResetUrl(input: {
  readonly publicAppUrl: URL;
  readonly rawToken: string;
}): string {
  return buildActionUrl(input.publicAppUrl, PASSWORD_RESET_PATH, input.rawToken);
}
