/**
 * access-protection.ts — Camada MINIMA de protecao de ACESSO ao admin interno
 * (@screena/admin). Basic Auth por variavel de ambiente, SEM estado.
 *
 * ESCOPO (Fase 6B). Esta camada NAO e autenticacao completa. De proposito, ela
 * NAO cria usuario, NAO cria sessao, NAO cria cookie, NAO cria login, NAO cria
 * JWT, NAO cria OAuth e NAO cria permissoes. Tambem NAO escreve no banco e NAO
 * chama nenhuma API externa. E apenas um portao operacional: exige um par
 * usuario/senha (HTTP Basic Auth) configurado por ENV antes de servir qualquer
 * tela do admin.
 *
 * PUREZA. Este modulo NAO importa `next/*`: depende so de globais Web padrao
 * (`atob`, `TextEncoder`, `TextDecoder`), disponiveis tanto no Edge runtime do
 * middleware quanto no Node do Vitest. Assim ele e testavel isoladamente e
 * reutilizavel pelo middleware sem acoplar o runtime.
 *
 * COMPARACAO EM TEMPO CONSTANTE. O middleware do Next roda em Edge runtime, onde
 * `crypto.timingSafeEqual` (API do Node) nao e garantido. Por isso a comparacao
 * de credenciais usa `constantTimeEquals`, uma comparacao constant-time propria
 * sobre bytes UTF-8, que so depende de globais Web e nao vaza, pelo tempo, o
 * tamanho do prefixo coincidente nem qual campo (usuario/senha) falhou.
 *
 * SEGREDOS. Usuario e senha vem SO de ENV (nunca hardcode, nunca no bundle do
 * cliente). Nenhuma funcao aqui loga credencial, e a decisao de acesso exposta
 * (`AdminAccessDecision`) NUNCA carrega a senha.
 */

/** Realm anunciado no desafio HTTP Basic Auth. */
export const ADMIN_BASIC_AUTH_REALM = "Screen Admin";

/** Valor do header `WWW-Authenticate` emitido junto de uma resposta 401. */
export const WWW_AUTHENTICATE_VALUE = `Basic realm="${ADMIN_BASIC_AUTH_REALM}"`;

/**
 * Subconjunto tipado das variaveis de ambiente lidas por esta camada.
 * Estruturalmente compativel com `process.env` (chaves `string | undefined`).
 *
 * - `ADMIN_PROTECTION_ENABLED` — liga a protecao SOMENTE quando for exatamente
 *   a string `"true"`. Qualquer outro valor (ausente, `"false"`, `"1"`, vazio)
 *   mantem o admin acessivel (uso local/dev — comportamento explicito).
 * - `ADMIN_BASIC_AUTH_USER` / `ADMIN_BASIC_AUTH_PASSWORD` — o par de credenciais.
 */
export interface AdminAuthEnv {
  readonly ADMIN_PROTECTION_ENABLED?: string;
  readonly ADMIN_BASIC_AUTH_USER?: string;
  readonly ADMIN_BASIC_AUTH_PASSWORD?: string;
}

/**
 * Credenciais decodificadas de um header Basic. Estrutura de uso INTERNO da
 * validacao (comparadas imediatamente e descartadas); nao e o objeto de decisao
 * exposto ao middleware.
 */
export interface BasicCredentials {
  readonly user: string;
  readonly pass: string;
}

/**
 * Decisao de acesso ao admin. E o objeto PUBLICO que o middleware consome — por
 * isso NUNCA inclui a senha nem qualquer credencial: carrega so o veredito e o
 * motivo, seguros para logar.
 */
export type AdminAccessDecision =
  | { readonly outcome: "allow"; readonly reason: "protection-disabled" | "authenticated" }
  | {
      readonly outcome: "deny";
      readonly reason: "missing-credentials-config" | "invalid-or-absent-auth";
    };

/** `true` se, e somente se, a protecao estiver EXPLICITAMENTE ligada. */
export function isAdminProtectionEnabled(env: AdminAuthEnv): boolean {
  return env.ADMIN_PROTECTION_ENABLED === "true";
}

/**
 * `true` se as duas credenciais (usuario e senha) estao configuradas e nao sao
 * vazias/somente-espaco. Aqui so decidimos se ha configuracao suficiente para
 * exigir Basic Auth; a comparacao de acesso usa o valor cru de cada credencial.
 */
export function hasAdminCredentials(env: AdminAuthEnv): boolean {
  return isConfigured(env.ADMIN_BASIC_AUTH_USER) && isConfigured(env.ADMIN_BASIC_AUTH_PASSWORD);
}

/** Considera configurado apenas string nao vazia apos trim. */
function isConfigured(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Decodifica base64 -> string UTF-8 usando so globais Web. Retorna `null` (em
 * vez de lancar) quando o base64 e invalido, para o chamador tratar como header
 * malformado.
 */
function decodeBase64Utf8(base64: string): string | null {
  try {
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Faz o parse de um header `Authorization: Basic <base64(user:pass)>`.
 *
 * Retorna `null` (invalido) quando o header:
 *   - esta ausente / nao e string;
 *   - nao comeca com o esquema `Basic` (case-insensitive);
 *   - tem base64 invalido;
 *   - decodifica para uma credencial sem separador `:`.
 *
 * A senha pode conter `:`; por isso o split ocorre so no PRIMEIRO `:`.
 */
export function parseBasicAuthHeader(header: string | null | undefined): BasicCredentials | null {
  if (typeof header !== "string") return null;

  const match = /^\s*Basic\s+(\S+)\s*$/i.exec(header);
  if (match === null) return null;

  const encoded = match[1];
  if (encoded === undefined) return null;

  const decoded = decodeBase64Utf8(encoded);
  if (decoded === null) return null;

  const separator = decoded.indexOf(":");
  if (separator === -1) return null;

  return { user: decoded.slice(0, separator), pass: decoded.slice(separator + 1) };
}

/**
 * Comparacao de strings em tempo (aproximadamente) constante, sobre bytes UTF-8.
 * Evita o curto-circuito de `===`, que vazaria — pelo tempo — o tamanho do
 * prefixo coincidente. Sempre percorre o maior comprimento e acumula as
 * diferencas bit a bit.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  const length = Math.max(aBytes.length, bBytes.length);

  // A diferenca de tamanho ja marca desigualdade, mas seguimos percorrendo tudo.
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < length; i += 1) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

/**
 * `true` se o header Basic bate com as credenciais configuradas em ENV. Calcula
 * a coincidencia de usuario E senha ANTES de combina-las (sem curto-circuito),
 * para nao vazar, pelo tempo, qual dos dois falhou. Sem credenciais
 * configuradas, retorna sempre `false` (fail closed).
 */
export function isValidBasicAuth(header: string | null | undefined, env: AdminAuthEnv): boolean {
  const expectedUser = env.ADMIN_BASIC_AUTH_USER;
  const expectedPass = env.ADMIN_BASIC_AUTH_PASSWORD;
  if (!isConfigured(expectedUser) || !isConfigured(expectedPass)) return false;

  const credentials = parseBasicAuthHeader(header);
  if (credentials === null) return false;

  const userMatches = constantTimeEquals(credentials.user, expectedUser);
  const passMatches = constantTimeEquals(credentials.pass, expectedPass);
  return userMatches && passMatches;
}

/**
 * Headers de uma resposta 401 do admin. Inclui o desafio Basic e impede que o
 * 401 seja cacheado por qualquer intermediario. NUNCA inclui credencial.
 */
export function buildUnauthorizedHeaders(): Record<string, string> {
  return {
    "WWW-Authenticate": WWW_AUTHENTICATE_VALUE,
    "Cache-Control": "no-store",
  };
}

/**
 * Decide o acesso ao admin a partir do header `Authorization` e das ENV.
 *
 * Ordem (fail closed):
 *   1. Protecao desligada         -> allow (dev/local; comportamento explicito).
 *   2. Protecao ligada, sem creds  -> deny  (mal configurado: nega por seguranca).
 *   3. Basic Auth valido           -> allow.
 *   4. Caso contrario              -> deny  (ausente/invalido -> desafio 401).
 *
 * O retorno e o objeto publico consumido pelo middleware — sem senha.
 */
export function evaluateAdminAccess(
  header: string | null | undefined,
  env: AdminAuthEnv,
): AdminAccessDecision {
  if (!isAdminProtectionEnabled(env)) {
    return { outcome: "allow", reason: "protection-disabled" };
  }
  if (!hasAdminCredentials(env)) {
    return { outcome: "deny", reason: "missing-credentials-config" };
  }
  if (isValidBasicAuth(header, env)) {
    return { outcome: "allow", reason: "authenticated" };
  }
  return { outcome: "deny", reason: "invalid-or-absent-auth" };
}
