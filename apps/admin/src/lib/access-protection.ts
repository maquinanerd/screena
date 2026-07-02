/**
 * access-protection.ts — Camada MINIMA de protecao de ACESSO ao admin interno
 * (@screena/admin). Basic Auth por variavel de ambiente, SEM estado.
 *
 * ESCOPO (Fase 6B/6C). Esta camada NAO e autenticacao completa. De proposito,
 * ela NAO cria usuario, NAO cria sessao, NAO cria cookie, NAO cria login, NAO
 * cria JWT, NAO cria OAuth e NAO cria permissoes. Tambem NAO escreve no banco e
 * NAO chama nenhuma API externa. E apenas um portao operacional: exige um par
 * usuario/senha (HTTP Basic Auth) configurado por ENV antes de servir qualquer
 * tela do admin.
 *
 * FASE 6C — production-readiness (fail closed por ambiente). Alem do liga/desliga
 * explicito por `ADMIN_PROTECTION_ENABLED`, a protecao passa a ser EXIGIDA
 * automaticamente em ambiente production-like (producao/preview), mesmo que a
 * flag esteja ausente OU definida como `"false"`. Objetivo: o admin nunca sobe
 * ABERTO em producao por esquecimento de env. Em production-like sem credenciais,
 * a decisao e negar (401), nunca liberar.
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
 * cliente). Nenhuma funcao aqui loga credencial; nem a decisao de acesso
 * (`AdminAccessDecision`), nem o status de configuracao (`AdminAccessConfig`),
 * nem a projecao de exibicao (`redactAdminAccessConfigForDisplay`) carregam
 * usuario ou senha — so booleans/rotulos derivados, seguros para logar/exibir.
 */

/** Realm anunciado no desafio HTTP Basic Auth. */
export const ADMIN_BASIC_AUTH_REALM = "Screen Admin";

/** Valor do header `WWW-Authenticate` emitido junto de uma resposta 401. */
export const WWW_AUTHENTICATE_VALUE = `Basic realm="${ADMIN_BASIC_AUTH_REALM}"`;

/**
 * Chaves de ambiente lidas por esta camada. Sao SO nomes — nao valores. A pagina
 * interna de seguranca usa esta lista para exibir o checklist de env vars
 * necessarias SEM mostrar nenhum valor.
 *
 * - `ADMIN_PROTECTION_ENABLED` / `ADMIN_BASIC_AUTH_USER` / `ADMIN_BASIC_AUTH_PASSWORD`
 *   controlam a protecao Basic Auth.
 * - `NODE_ENV` / `VERCEL_ENV` detectam ambiente production-like (ver abaixo).
 */
export const ADMIN_ACCESS_ENV_KEYS = [
  "ADMIN_PROTECTION_ENABLED",
  "ADMIN_BASIC_AUTH_USER",
  "ADMIN_BASIC_AUTH_PASSWORD",
  "NODE_ENV",
  "VERCEL_ENV",
] as const;

/** Uma das chaves de env conhecidas por esta camada. */
export type AdminAccessEnvKey = (typeof ADMIN_ACCESS_ENV_KEYS)[number];

/**
 * Subconjunto tipado das variaveis de ambiente lidas por esta camada.
 * Estruturalmente compativel com `process.env` (chaves `string | undefined`).
 *
 * - `ADMIN_PROTECTION_ENABLED` — liga a protecao explicitamente SOMENTE quando
 *   for exatamente a string `"true"`. Qualquer outro valor (ausente, `"false"`,
 *   `"1"`, vazio) NAO liga a protecao explicita. Em production-like isso NAO
 *   abre o admin: la a protecao ja e exigida pelo ambiente (fail closed).
 * - `ADMIN_BASIC_AUTH_USER` / `ADMIN_BASIC_AUTH_PASSWORD` — o par de credenciais.
 * - `NODE_ENV` / `VERCEL_ENV` — sinais de ambiente (production-like detection).
 */
export interface AdminAccessEnv {
  readonly ADMIN_PROTECTION_ENABLED?: string;
  readonly ADMIN_BASIC_AUTH_USER?: string;
  readonly ADMIN_BASIC_AUTH_PASSWORD?: string;
  readonly NODE_ENV?: string;
  readonly VERCEL_ENV?: string;
}

/**
 * Tipo de runtime detectado a partir de `VERCEL_ENV`/`NODE_ENV`.
 *
 * - `production` — deploy de producao (VPS/CloudPanel com `NODE_ENV=production`,
 *   ou `VERCEL_ENV=production`).
 * - `preview` — deploy de preview/staging do Vercel (`VERCEL_ENV=preview`).
 * - `development` — desenvolvimento local (`NODE_ENV=development`/`test`, ou
 *   `VERCEL_ENV=development`).
 * - `unknown` — sem sinal reconhecivel (tratado como local/nao-producao).
 */
export type AdminRuntimeKind = "production" | "preview" | "development" | "unknown";

/**
 * Motivo estavel e SEGURO (sem valor sensivel) de uma decisao de acesso. Serve
 * para log/telemetria e para o desafio 401. Nunca contem usuario/senha.
 *
 * - `protection_disabled_dev` — protecao nao exigida (dev/local): libera.
 * - `missing_credentials` — protecao exigida, mas ENV sem usuario/senha: nega.
 * - `missing_authorization` — cliente nao enviou header `Authorization`: nega.
 * - `invalid_scheme` — header presente, mas nao e `Basic`: nega.
 * - `invalid_credentials` — Basic malformado ou usuario/senha errados: nega.
 * - `authorized` — Basic Auth valido: libera.
 */
export type AdminAccessReason =
  | "protection_disabled_dev"
  | "missing_credentials"
  | "missing_authorization"
  | "invalid_scheme"
  | "invalid_credentials"
  | "authorized";

/**
 * Postura de seguranca resultante (para diagnostico/exibicao, sem segredo):
 * - `protected` — protecao exigida e credenciais configuradas.
 * - `open` — protecao nao exigida (dev/local, acesso aberto e explicito).
 * - `blocked-missing-credentials` — protecao exigida mas credenciais ausentes
 *   (fail closed: o admin responde 401 ate as credenciais serem configuradas).
 */
export type AdminSecurityPosture = "protected" | "open" | "blocked-missing-credentials";

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
 * motivo (enum estavel), seguros para logar.
 */
export type AdminAccessDecision =
  | { readonly outcome: "allow"; readonly reason: "protection_disabled_dev" | "authorized" }
  | {
      readonly outcome: "deny";
      readonly reason:
        | "missing_credentials"
        | "missing_authorization"
        | "invalid_scheme"
        | "invalid_credentials";
    };

/* ------------------------------------------------------------------ */
/* Deteccao de ambiente (production-like)                              */
/* ------------------------------------------------------------------ */

/** Le uma env como string trimada (ou vazia se ausente/nao-string). */
function readTrimmed(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Considera configurado apenas string nao vazia apos trim. */
function isConfigured(value: string | undefined): value is string {
  return readTrimmed(value).length > 0;
}

/**
 * Classifica o runtime a partir das envs de ambiente. Sinais production-like
 * sempre dominam sinais de desenvolvimento: `NODE_ENV=production` exige
 * protecao mesmo se uma env secundaria estiver mal configurada como
 * `VERCEL_ENV=development`. A comparacao e case-insensitive e tolerante a
 * espacos para nao deixar `"Production"`/` production ` escaparem da deteccao.
 * `NODE_ENV=test` (Vitest) e tratado como `development` — nunca production-like.
 */
export function getAdminRuntimeKind(env: AdminAccessEnv): AdminRuntimeKind {
  const vercel = readTrimmed(env.VERCEL_ENV).toLowerCase();
  if (vercel === "production") return "production";
  if (vercel === "preview") return "preview";

  const node = readTrimmed(env.NODE_ENV).toLowerCase();
  if (node === "production") return "production";
  if (vercel === "development") return "development";
  if (node === "development" || node === "test") return "development";

  return "unknown";
}

/**
 * `true` em ambiente production-like: producao (`NODE_ENV=production` ou
 * `VERCEL_ENV=production`) ou preview/staging do Vercel (`VERCEL_ENV=preview`).
 * Nestes ambientes a protecao e SEMPRE exigida, mesmo sem `ADMIN_PROTECTION_ENABLED`.
 *
 * Nota de projeto: o deploy canonico do Screen e VPS + CloudPanel, onde o sinal
 * real e `NODE_ENV=production` (ver `docs/CLOUDPANEL_DEPLOY.md`). `VERCEL_ENV` e
 * incluido para compatibilidade com deploy Vercel; nao ha outra env de staging
 * no projeto hoje, entao nenhuma outra e considerada production-like.
 */
export function isProductionLikeAdminEnvironment(env: AdminAccessEnv): boolean {
  const kind = getAdminRuntimeKind(env);
  return kind === "production" || kind === "preview";
}

/** `true` se, e somente se, a protecao estiver EXPLICITAMENTE ligada por flag. */
export function isExplicitAdminProtectionEnabled(env: AdminAccessEnv): boolean {
  return env.ADMIN_PROTECTION_ENABLED === "true";
}

/**
 * `true` se a protecao Basic Auth deve ser exigida:
 *   - em ambiente production-like (SEMPRE, mesmo sem flag / com flag `"false"`); OU
 *   - quando a flag `ADMIN_PROTECTION_ENABLED` esta explicitamente `"true"`.
 *
 * Consequencia central da Fase 6C: `ADMIN_PROTECTION_ENABLED=false` NAO abre o
 * admin em producao — o ambiente ja obriga a protecao (fail closed).
 */
export function isAdminProtectionRequired(env: AdminAccessEnv): boolean {
  return isProductionLikeAdminEnvironment(env) || isExplicitAdminProtectionEnabled(env);
}

/**
 * `true` se as duas credenciais (usuario e senha) estao configuradas e nao sao
 * vazias/somente-espaco. Aqui so decidimos se ha configuracao suficiente para
 * exigir Basic Auth; a comparacao de acesso usa o valor cru de cada credencial.
 */
export function hasAdminCredentials(env: AdminAccessEnv): boolean {
  return isConfigured(env.ADMIN_BASIC_AUTH_USER) && isConfigured(env.ADMIN_BASIC_AUTH_PASSWORD);
}

/* ------------------------------------------------------------------ */
/* Parse do header Basic                                              */
/* ------------------------------------------------------------------ */

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
 * Classificacao granular de um header `Authorization` para produzir motivos
 * precisos de negacao:
 *   - `missing`        — ausente/vazio (cliente nao enviou credencial);
 *   - `invalid-scheme` — presente, mas nao e o esquema `Basic`;
 *   - `malformed`      — Basic, mas base64 invalido ou sem separador `:`;
 *   - `parsed`         — Basic valido, com `{ user, pass }`.
 *
 * A senha pode conter `:`; por isso o split ocorre so no PRIMEIRO `:`.
 */
export type BasicAuthHeaderClass =
  | { readonly status: "missing" }
  | { readonly status: "invalid-scheme" }
  | { readonly status: "malformed" }
  | { readonly status: "parsed"; readonly credentials: BasicCredentials };

export function classifyBasicAuthHeader(header: string | null | undefined): BasicAuthHeaderClass {
  if (typeof header !== "string" || header.trim() === "") {
    return { status: "missing" };
  }

  const match = /^\s*Basic\s+(\S+)\s*$/i.exec(header);
  if (match === null) {
    return { status: "invalid-scheme" };
  }

  const encoded = match[1];
  if (encoded === undefined) {
    return { status: "malformed" };
  }

  const decoded = decodeBase64Utf8(encoded);
  if (decoded === null) {
    return { status: "malformed" };
  }

  const separator = decoded.indexOf(":");
  if (separator === -1) {
    return { status: "malformed" };
  }

  return {
    status: "parsed",
    credentials: { user: decoded.slice(0, separator), pass: decoded.slice(separator + 1) },
  };
}

/**
 * Faz o parse de um header `Authorization: Basic <base64(user:pass)>`.
 * Retorna as credenciais ou `null` quando ausente/invalido. Wrapper fino sobre
 * `classifyBasicAuthHeader` (mantido para compatibilidade e uso direto).
 */
export function parseBasicAuthHeader(header: string | null | undefined): BasicCredentials | null {
  const classified = classifyBasicAuthHeader(header);
  return classified.status === "parsed" ? classified.credentials : null;
}

/* ------------------------------------------------------------------ */
/* Comparacao constant-time                                           */
/* ------------------------------------------------------------------ */

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
 * `true` se as credenciais batem com as configuradas em ENV. Calcula a
 * coincidencia de usuario E senha ANTES de combina-las (sem curto-circuito),
 * para nao vazar, pelo tempo, qual dos dois falhou. Sem credenciais
 * configuradas, retorna sempre `false` (fail closed).
 */
function credentialsMatchEnv(credentials: BasicCredentials, env: AdminAccessEnv): boolean {
  const expectedUser = env.ADMIN_BASIC_AUTH_USER;
  const expectedPass = env.ADMIN_BASIC_AUTH_PASSWORD;
  if (!isConfigured(expectedUser) || !isConfigured(expectedPass)) return false;

  const userMatches = constantTimeEquals(credentials.user, expectedUser);
  const passMatches = constantTimeEquals(credentials.pass, expectedPass);
  return userMatches && passMatches;
}

/**
 * `true` se o header Basic bate com as credenciais configuradas em ENV. Sem
 * credenciais configuradas, retorna sempre `false` (fail closed).
 */
export function isValidBasicAuth(header: string | null | undefined, env: AdminAccessEnv): boolean {
  const classified = classifyBasicAuthHeader(header);
  if (classified.status !== "parsed") return false;
  return credentialsMatchEnv(classified.credentials, env);
}

/* ------------------------------------------------------------------ */
/* Decisao de acesso                                                  */
/* ------------------------------------------------------------------ */

/**
 * Decide o acesso ao admin a partir do header `Authorization` e das ENV.
 *
 * Ordem (fail closed):
 *   1. Protecao NAO exigida (dev/local, sem flag)  -> allow (protection_disabled_dev).
 *   2. Protecao exigida, ENV sem credenciais        -> deny  (missing_credentials).
 *   3. Sem header Authorization                      -> deny  (missing_authorization).
 *   4. Header presente, esquema != Basic             -> deny  (invalid_scheme).
 *   5. Basic malformado / usuario ou senha errados   -> deny  (invalid_credentials).
 *   6. Basic Auth valido                             -> allow (authorized).
 *
 * Em production-like a protecao ja e exigida pelo passo 1, independente da flag —
 * portanto o admin nunca sobe aberto em producao. O retorno e o objeto publico
 * consumido pelo middleware — sem senha.
 */
export function evaluateAdminAccess(
  header: string | null | undefined,
  env: AdminAccessEnv,
): AdminAccessDecision {
  if (!isAdminProtectionRequired(env)) {
    return { outcome: "allow", reason: "protection_disabled_dev" };
  }
  if (!hasAdminCredentials(env)) {
    return { outcome: "deny", reason: "missing_credentials" };
  }

  const classified = classifyBasicAuthHeader(header);
  if (classified.status === "missing") {
    return { outcome: "deny", reason: "missing_authorization" };
  }
  if (classified.status === "invalid-scheme") {
    return { outcome: "deny", reason: "invalid_scheme" };
  }
  if (classified.status === "malformed") {
    return { outcome: "deny", reason: "invalid_credentials" };
  }
  if (credentialsMatchEnv(classified.credentials, env)) {
    return { outcome: "allow", reason: "authorized" };
  }
  return { outcome: "deny", reason: "invalid_credentials" };
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

/* ------------------------------------------------------------------ */
/* Diagnostico de configuracao (sem segredo)                          */
/* ------------------------------------------------------------------ */

/** Presenca (nunca valor) de cada env conhecida. So booleans. */
export type AdminEnvPresence = Readonly<Record<AdminAccessEnvKey, boolean>>;

/**
 * Status derivado da configuracao de acesso — SEM segredo. So booleans, o tipo
 * de runtime e a postura. NUNCA carrega usuario/senha; e seguro para logar e
 * para alimentar a pagina interna de seguranca.
 */
export interface AdminAccessConfig {
  readonly runtimeKind: AdminRuntimeKind;
  readonly productionLike: boolean;
  readonly protectionExplicitlyEnabled: boolean;
  readonly protectionRequired: boolean;
  readonly hasUser: boolean;
  readonly hasPassword: boolean;
  readonly hasCredentials: boolean;
  readonly posture: AdminSecurityPosture;
  readonly envPresence: AdminEnvPresence;
}

function computePosture(required: boolean, hasCredentials: boolean): AdminSecurityPosture {
  if (!required) return "open";
  return hasCredentials ? "protected" : "blocked-missing-credentials";
}

/** Presenca de UMA env: `true` se definida e nao vazia apos trim (nunca o valor). */
function presenceOf(env: AdminAccessEnv, key: AdminAccessEnvKey): boolean {
  return isConfigured(env[key]);
}

/**
 * Deriva o status de configuracao de acesso a partir das ENV. Nao le rede/DB,
 * nao lanca e NUNCA retorna usuario/senha — apenas o estado agregado, seguro
 * para diagnostico.
 */
export function getAdminAccessConfig(env: AdminAccessEnv): AdminAccessConfig {
  const protectionRequired = isAdminProtectionRequired(env);
  const hasUser = isConfigured(env.ADMIN_BASIC_AUTH_USER);
  const hasPassword = isConfigured(env.ADMIN_BASIC_AUTH_PASSWORD);
  const hasCredentials = hasUser && hasPassword;

  const envPresence = {
    ADMIN_PROTECTION_ENABLED: presenceOf(env, "ADMIN_PROTECTION_ENABLED"),
    ADMIN_BASIC_AUTH_USER: presenceOf(env, "ADMIN_BASIC_AUTH_USER"),
    ADMIN_BASIC_AUTH_PASSWORD: presenceOf(env, "ADMIN_BASIC_AUTH_PASSWORD"),
    NODE_ENV: presenceOf(env, "NODE_ENV"),
    VERCEL_ENV: presenceOf(env, "VERCEL_ENV"),
  } satisfies AdminEnvPresence;

  return {
    runtimeKind: getAdminRuntimeKind(env),
    productionLike: isProductionLikeAdminEnvironment(env),
    protectionExplicitlyEnabled: isExplicitAdminProtectionEnabled(env),
    protectionRequired,
    hasUser,
    hasPassword,
    hasCredentials,
    posture: computePosture(protectionRequired, hasCredentials),
    envPresence,
  };
}

/* ------------------------------------------------------------------ */
/* Projecao de exibicao (redigida, pt-BR)                             */
/* ------------------------------------------------------------------ */

/** Rotulo de ambiente para exibicao (o `unknown` vira "local/unknown"). */
const RUNTIME_KIND_LABELS: Record<AdminRuntimeKind, string> = {
  production: "production",
  preview: "preview",
  development: "development",
  unknown: "local/unknown",
};

/** Rotulo pt-BR da postura de seguranca. */
const POSTURE_LABELS: Record<AdminSecurityPosture, string> = {
  protected: "Protegido",
  open: "Aberto em dev/local",
  "blocked-missing-credentials": "Bloqueado por credenciais ausentes",
};

/** Item do checklist de env vars: nome + presenca (nunca o valor) + se e sensivel. */
export interface AdminEnvChecklistItem {
  readonly key: AdminAccessEnvKey;
  readonly present: boolean;
  readonly sensitive: boolean;
}

/**
 * Projecao de exibicao, redigida (redacted). E o que a pagina interna de
 * seguranca renderiza. Construida SO a partir de campos seguros do
 * `AdminAccessConfig` — por construcao NAO ha como um segredo (usuario/senha)
 * atravessar para esta estrutura.
 */
export interface RedactedAdminAccessConfig {
  readonly runtimeKind: AdminRuntimeKind;
  readonly environmentLabel: string;
  readonly productionLike: boolean;
  readonly protectionRequired: boolean;
  readonly protectionExplicitlyEnabled: boolean;
  readonly credentialsConfigured: boolean;
  readonly userConfigured: boolean;
  readonly passwordConfigured: boolean;
  readonly posture: AdminSecurityPosture;
  readonly postureLabel: string;
  readonly envChecklist: readonly AdminEnvChecklistItem[];
}

/** Env sensiveis: sua presenca pode ser exibida, mas nunca o valor. */
const SENSITIVE_ENV_KEYS: ReadonlySet<AdminAccessEnvKey> = new Set([
  "ADMIN_BASIC_AUTH_USER",
  "ADMIN_BASIC_AUTH_PASSWORD",
]);

/**
 * Reduz o `AdminAccessConfig` a uma projecao de exibicao segura. So le campos
 * derivados/booleans e nomes de env — nunca valores de env — garantindo que a
 * saida jamais contenha usuario ou senha. Retorna rotulos ja em pt-BR para a
 * pagina interna.
 */
export function redactAdminAccessConfigForDisplay(
  config: AdminAccessConfig,
): RedactedAdminAccessConfig {
  const envChecklist: AdminEnvChecklistItem[] = ADMIN_ACCESS_ENV_KEYS.map((key) => ({
    key,
    present: config.envPresence[key],
    sensitive: SENSITIVE_ENV_KEYS.has(key),
  }));

  return {
    runtimeKind: config.runtimeKind,
    environmentLabel: RUNTIME_KIND_LABELS[config.runtimeKind],
    productionLike: config.productionLike,
    protectionRequired: config.protectionRequired,
    protectionExplicitlyEnabled: config.protectionExplicitlyEnabled,
    credentialsConfigured: config.hasCredentials,
    userConfigured: config.hasUser,
    passwordConfigured: config.hasPassword,
    posture: config.posture,
    postureLabel: POSTURE_LABELS[config.posture],
    envChecklist,
  };
}
