/**
 * CONFIGURACAO server-only do runtime de autenticacao por e-mail (C7C).
 *
 * Este e o UNICO modulo que descreve as variaveis de ambiente do fluxo. Ele NAO
 * le `process.env`: recebe o mapa por parametro e devolve um objeto validado ou
 * uma lista de erros. Quem toca o ambiente de verdade e so o composition root
 * (`composition.ts`) — espalhar `process.env` por varios arquivos faria cada um
 * inventar seu proprio default.
 *
 * FALHA CEDO E FECHADO: producao com configuracao incompleta nao sobe o runtime.
 * NAO existe default inseguro para `BREVO_API_KEY` — uma chave vazia "que so
 * falha no envio" transformaria erro de deploy em e-mail que nunca chega.
 *
 * NENHUMA mensagem de erro daqui carrega VALOR de variavel: so o NOME dela. Um
 * "chave invalida: xkeysib-..." acabaria num log de boot, e a partir dai a chave
 * estaria vazada em todo lugar que agrega log.
 */

import { type DomainResult, err, ok } from "../core/result.js";
import { validateEmailFormat } from "../auth/identity.js";

/** Nomes canonicos. Nenhum comeca com `NEXT_PUBLIC_`: nada disso vai ao browser. */
export const AUTH_EMAIL_ENV_KEYS = {
  brevoApiKey: "BREVO_API_KEY",
  senderName: "BREVO_SENDER_NAME",
  senderEmail: "BREVO_SENDER_EMAIL",
  replyToEmail: "BREVO_REPLY_TO_EMAIL",
  publicAppUrl: "PUBLIC_APP_URL",
  passwordResetExpirationMinutes: "PASSWORD_RESET_EXPIRATION_MINUTES",
  emailVerificationExpirationMinutes: "EMAIL_VERIFICATION_EXPIRATION_MINUTES",
  ipHashSalt: "CINERIE_IP_HASH_SALT",
  // C7D. Todas OPCIONAIS, com default seguro: adicionar a camada de sessao nao
  // pode passar a exigir novas variaveis num deploy que ja funcionava.
  termsPolicyVersion: "CINERIE_TERMS_POLICY_VERSION",
  privacyPolicyVersion: "CINERIE_PRIVACY_POLICY_VERSION",
  sessionTtlHours: "SESSION_TTL_HOURS",
  deletionGraceDays: "ACCOUNT_DELETION_GRACE_DAYS",
} as const;

/**
 * Defaults dos parametros C7D. Sao SEGUROS, nao arbitrarios:
 *  - versoes `2026-08`: a versao vigente dos documentos legais (texto final do
 *    controlador, vigente desde 4 de agosto de 2026); o deploy sobrescreve
 *    quando os textos mudarem, e trocar a versao forca novo aceite (a tela
 *    marca `needsRenewal`). Este valor tem de acompanhar
 *    `LEGAL_POLICY_VERSION` em `apps/web/app/_components/legal-doc.tsx`: e a
 *    versao EXIBIDA que precisa bater com a versao CARIMBADA na prova de
 *    consentimento, senao o registro aponta para um texto diferente do que a
 *    pessoa leu;
 *  - TTL de 720 h (30 dias): espelha `SESSION_TTL_HOURS` do dominio (policy.ts);
 *  - carencia de 30 dias: janela de arrependimento antes da anonimizacao.
 */
export const C7D_DEFAULTS = {
  termsPolicyVersion: "2026-08",
  // `2026-08.2`: revisao do §6 (Cookies) declarando o player de video do
  // YouTube. Os Termos NAO mudaram e continuam em `2026-08` — subir os dois
  // juntos pediria a toda a base um novo aceite de um documento intacto.
  privacyPolicyVersion: "2026-08.2",
  sessionTtlHours: 720,
  deletionGraceDays: 30,
} as const;

/**
 * Teto de sanidade dos prazos: 30 dias em minutos. Nao e politica de seguranca,
 * e detector de erro de digitacao — `1440000` no lugar de `1440` criaria um link
 * de recuperacao valido por quase tres anos, e nada mais no sistema reclamaria.
 */
export const MAX_EXPIRATION_MINUTES = 43_200;

/**
 * Tamanho minimo do sal de hash de IP, herdado de `core/crypto.hashIpAddress`
 * (que lanca abaixo disso). Validar aqui transforma um erro de runtime no meio
 * de uma requisicao em uma recusa de boot.
 */
export const MIN_IP_HASH_SALT_LENGTH = 16;

export interface AuthEmailConfig {
  readonly brevoApiKey: string;
  readonly senderName: string;
  readonly senderEmail: string;
  readonly replyToEmail: string | null;
  /** Origem publica do app. Validada sem caminho, query, fragmento nem credencial. */
  readonly publicAppUrl: URL;
  readonly passwordResetExpirationMinutes: number;
  readonly emailVerificationExpirationMinutes: number;
  /**
   * Sal do hash de IP do throttle. OPCIONAL: quando ausente, a composicao gera
   * um sal efemero por processo — o IP continua nunca sendo persistido em texto
   * claro, mas a contagem por IP deixa de ser correlacionavel entre reinicios e
   * entre replicas. Consequencias em docs/product/user-product-auth-runtime.md.
   */
  readonly ipHashSalt: string | null;

  // C7D — sempre presentes (default aplicado quando a env falta).
  readonly termsPolicyVersion: string;
  readonly privacyPolicyVersion: string;
  readonly sessionTtlHours: number;
  readonly deletionGraceDays: number;
}

/** Mapa de ambiente. `Readonly` de proposito: a config nunca escreve no ambiente. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

function readTrimmed(env: EnvSource, key: string): string | null {
  const raw = env[key];
  if (typeof raw !== "string") {
    return null;
  }
  const value = raw.trim();
  return value.length === 0 ? null : value;
}

/**
 * Le um inteiro positivo. Rejeita vazio, nao numerico, fracionario, zero,
 * negativo e absurdo. A mensagem cita o NOME da variavel e a REGRA, nunca o
 * valor recebido.
 */
function readPositiveInteger(env: EnvSource, key: string, errors: string[]): number | null {
  const raw = readTrimmed(env, key);
  if (raw === null) {
    errors.push(`${key} ausente`);
    return null;
  }
  if (!/^[0-9]+$/.test(raw)) {
    errors.push(`${key} deve ser um inteiro positivo em minutos`);
    return null;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    errors.push(`${key} deve ser um inteiro positivo em minutos`);
    return null;
  }
  if (value > MAX_EXPIRATION_MINUTES) {
    errors.push(`${key} excede o teto de ${MAX_EXPIRATION_MINUTES} minutos`);
    return null;
  }
  return value;
}

/** Hosts que nunca podem ser a origem publica de producao. */
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"]);

/**
 * Valida `PUBLIC_APP_URL`.
 *
 * As regras nao sao decorativas — cada uma corresponde a uma forma concreta de o
 * link de e-mail sair errado:
 *
 *  - protocolo: so http/https (um `javascript:` ou `data:` viraria link de
 *    ataque dentro de um e-mail que o usuario confia);
 *  - HTTPS obrigatorio em producao: o token viaja na query, e em texto claro ele
 *    seria lido por qualquer intermediario;
 *  - sem usuario/senha embutidos: credencial em URL acabaria dentro do corpo do
 *    e-mail e no historico do navegador;
 *  - sem fragmento e sem query: seriam descartados ao montar o link e criariam a
 *    ilusao de configuracao que nao tem efeito;
 *  - caminho exatamente "/": os links usam caminho ABSOLUTO ("/pt/..."), entao
 *    um prefixo de caminho na base seria silenciosamente ignorado e todo e-mail
 *    apontaria para o lugar errado;
 *  - host nao-local em producao: um link para `localhost` num e-mail real nao
 *    abre para ninguem.
 */
function readPublicAppUrl(env: EnvSource, production: boolean, errors: string[]): URL | null {
  const key = AUTH_EMAIL_ENV_KEYS.publicAppUrl;
  const raw = readTrimmed(env, key);
  if (raw === null) {
    errors.push(`${key} ausente`);
    return null;
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    errors.push(`${key} nao e uma URL absoluta valida`);
    return null;
  }

  let valid = true;
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    errors.push(`${key} deve usar http ou https`);
    valid = false;
  }
  if (production && url.protocol !== "https:") {
    errors.push(`${key} deve usar https em producao`);
    valid = false;
  }
  if (url.username.length > 0 || url.password.length > 0) {
    errors.push(`${key} nao pode conter credenciais`);
    valid = false;
  }
  if (url.hash.length > 0) {
    errors.push(`${key} nao pode conter fragmento`);
    valid = false;
  }
  if (url.search.length > 0) {
    errors.push(`${key} nao pode conter query string`);
    valid = false;
  }
  if (url.pathname !== "/") {
    errors.push(`${key} deve apontar para a raiz do site (sem prefixo de caminho)`);
    valid = false;
  }
  if (production && LOCAL_HOSTNAMES.has(url.hostname.toLowerCase())) {
    errors.push(`${key} nao pode ser um host local em producao`);
    valid = false;
  }

  return valid ? url : null;
}

/**
 * Monta a configuracao a partir de um mapa de ambiente.
 *
 * Acumula TODOS os erros antes de recusar: quem esta configurando o servico
 * merece a lista inteira de uma vez, nao um erro por deploy.
 */
export function loadAuthEmailConfig(input: {
  readonly env: EnvSource;
  readonly production: boolean;
}): DomainResult<AuthEmailConfig> {
  const { env, production } = input;
  const errors: string[] = [];

  const brevoApiKey = readTrimmed(env, AUTH_EMAIL_ENV_KEYS.brevoApiKey);
  if (brevoApiKey === null) {
    errors.push(`${AUTH_EMAIL_ENV_KEYS.brevoApiKey} ausente`);
  }

  const senderName = readTrimmed(env, AUTH_EMAIL_ENV_KEYS.senderName);
  if (senderName === null) {
    errors.push(`${AUTH_EMAIL_ENV_KEYS.senderName} ausente`);
  }

  const senderEmail = readTrimmed(env, AUTH_EMAIL_ENV_KEYS.senderEmail);
  if (senderEmail === null) {
    errors.push(`${AUTH_EMAIL_ENV_KEYS.senderEmail} ausente`);
  } else if (!validateEmailFormat(senderEmail).ok) {
    // Reusa a MESMA validacao de formato do dominio de identidade. Uma segunda
    // regex aqui poderia aceitar um remetente que o resto do sistema recusa.
    errors.push(`${AUTH_EMAIL_ENV_KEYS.senderEmail} nao e um e-mail valido`);
  }

  // OPCIONAL: ausente e configuracao valida. Presente porem invalido e erro —
  // aceitar em silencio faria a Brevo recusar todo envio, em runtime.
  const replyToEmail = readTrimmed(env, AUTH_EMAIL_ENV_KEYS.replyToEmail);
  if (replyToEmail !== null && !validateEmailFormat(replyToEmail).ok) {
    errors.push(`${AUTH_EMAIL_ENV_KEYS.replyToEmail} nao e um e-mail valido`);
  }

  const publicAppUrl = readPublicAppUrl(env, production, errors);

  const passwordResetExpirationMinutes = readPositiveInteger(
    env,
    AUTH_EMAIL_ENV_KEYS.passwordResetExpirationMinutes,
    errors,
  );
  const emailVerificationExpirationMinutes = readPositiveInteger(
    env,
    AUTH_EMAIL_ENV_KEYS.emailVerificationExpirationMinutes,
    errors,
  );

  const ipHashSalt = readTrimmed(env, AUTH_EMAIL_ENV_KEYS.ipHashSalt);
  if (ipHashSalt !== null && ipHashSalt.length < MIN_IP_HASH_SALT_LENGTH) {
    errors.push(
      `${AUTH_EMAIL_ENV_KEYS.ipHashSalt} deve ter no minimo ${MIN_IP_HASH_SALT_LENGTH} caracteres`,
    );
  }

  // C7D — todos com DEFAULT. Ausente nao e erro; presente porem invalido e.
  const termsPolicyVersion =
    readTrimmed(env, AUTH_EMAIL_ENV_KEYS.termsPolicyVersion) ?? C7D_DEFAULTS.termsPolicyVersion;
  const privacyPolicyVersion =
    readTrimmed(env, AUTH_EMAIL_ENV_KEYS.privacyPolicyVersion) ??
    C7D_DEFAULTS.privacyPolicyVersion;
  const sessionTtlHours = readOptionalPositiveInteger(
    env,
    AUTH_EMAIL_ENV_KEYS.sessionTtlHours,
    C7D_DEFAULTS.sessionTtlHours,
    errors,
  );
  const deletionGraceDays = readOptionalPositiveInteger(
    env,
    AUTH_EMAIL_ENV_KEYS.deletionGraceDays,
    C7D_DEFAULTS.deletionGraceDays,
    errors,
  );

  if (
    errors.length > 0 ||
    brevoApiKey === null ||
    senderName === null ||
    senderEmail === null ||
    publicAppUrl === null ||
    passwordResetExpirationMinutes === null ||
    emailVerificationExpirationMinutes === null
  ) {
    return err("validation_failed", "configuracao de e-mail transacional invalida.", errors);
  }

  return ok({
    brevoApiKey,
    senderName,
    senderEmail,
    replyToEmail,
    publicAppUrl,
    passwordResetExpirationMinutes,
    emailVerificationExpirationMinutes,
    ipHashSalt,
    termsPolicyVersion,
    privacyPolicyVersion,
    sessionTtlHours,
    deletionGraceDays,
  });
}

/**
 * Inteiro positivo OPCIONAL com default (C7D). Ausente devolve o default;
 * presente segue as MESMAS regras de `readPositiveInteger` (sem teto de 30
 * dias, que e especifico de prazos de e-mail). Presente-porem-invalido acumula
 * erro, para nao virar um valor absurdo silencioso.
 */
function readOptionalPositiveInteger(
  env: EnvSource,
  key: string,
  fallback: number,
  errors: string[],
): number {
  const raw = readTrimmed(env, key);
  if (raw === null) {
    return fallback;
  }
  if (!/^[0-9]+$/.test(raw)) {
    errors.push(`${key} deve ser um inteiro positivo`);
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    errors.push(`${key} deve ser um inteiro positivo`);
    return fallback;
  }
  return value;
}
