/**
 * Testes da camada de protecao de ACESSO do admin interno (@screena/admin).
 *
 * Cobrem o helper puro `apps/admin/src/lib/access-protection` (Basic Auth por
 * ENV, sem estado, com fail-closed por ambiente da Fase 6C) e uma guarda TEXTUAL
 * do middleware que o consome. O middleware em si e um adaptador fino do runtime
 * do Next; testar seu runtime Edge diretamente seria fragil (e o `next` pode nem
 * estar instalado offline), entao a decisao de acesso e exercitada no helper — que
 * e exatamente o que o middleware chama — e a fiacao do middleware e verificada
 * por leitura do fonte.
 *
 * ESCOPO: esta fase NAO cria login/sessao/cookie/JWT/OAuth/usuario. So valida o
 * portao Basic Auth minimo e a regra de que production-like exige protecao mesmo
 * sem `ADMIN_PROTECTION_ENABLED` (nunca sobe aberto por esquecimento de env).
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ADMIN_ACCESS_ENV_KEYS,
  ADMIN_BASIC_AUTH_REALM,
  WWW_AUTHENTICATE_VALUE,
  buildUnauthorizedHeaders,
  classifyBasicAuthHeader,
  evaluateAdminAccess,
  getAdminAccessConfig,
  getAdminRuntimeKind,
  hasAdminCredentials,
  isAdminProtectionRequired,
  isExplicitAdminProtectionEnabled,
  isProductionLikeAdminEnvironment,
  isValidBasicAuth,
  parseBasicAuthHeader,
  redactAdminAccessConfigForDisplay,
  type AdminAccessEnv,
} from "../../apps/admin/src/lib/access-protection";

/** Monta um header `Authorization: Basic <base64(user:pass)>` (UTF-8). */
function basicHeader(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`, "utf-8").toString("base64")}`;
}

const USER = "editor-op";
const PASS = "s3nha-Op#2026:xyz"; // contem ':' de proposito (split so no primeiro)

/** Credenciais de ENV (sem sinal de ambiente/flag). */
const CREDS: AdminAccessEnv = {
  ADMIN_BASIC_AUTH_USER: USER,
  ADMIN_BASIC_AUTH_PASSWORD: PASS,
};

/** Protecao ligada por flag explicita + credenciais (dev). */
const ENABLED_ENV: AdminAccessEnv = { ADMIN_PROTECTION_ENABLED: "true", ...CREDS };

/* ------------------------------------------------------------------ */
/* Deteccao de ambiente                                               */
/* ------------------------------------------------------------------ */

describe("getAdminRuntimeKind — classifica o runtime com fail-closed", () => {
  it("sinais production-like dominam sinais de desenvolvimento", () => {
    expect(getAdminRuntimeKind({ VERCEL_ENV: "preview", NODE_ENV: "development" })).toBe("preview");
    expect(getAdminRuntimeKind({ VERCEL_ENV: "production", NODE_ENV: "development" })).toBe(
      "production",
    );
    expect(getAdminRuntimeKind({ VERCEL_ENV: "development", NODE_ENV: "production" })).toBe(
      "production",
    );
  });

  it("cai para NODE_ENV quando VERCEL_ENV ausente; test conta como development", () => {
    expect(getAdminRuntimeKind({ NODE_ENV: "production" })).toBe("production");
    expect(getAdminRuntimeKind({ NODE_ENV: "development" })).toBe("development");
    expect(getAdminRuntimeKind({ NODE_ENV: "test" })).toBe("development");
    expect(getAdminRuntimeKind({})).toBe("unknown");
  });

  it("VERCEL_ENV=development so e development sem sinal de producao", () => {
    expect(getAdminRuntimeKind({ VERCEL_ENV: "development" })).toBe("development");
    expect(getAdminRuntimeKind({ VERCEL_ENV: "development", NODE_ENV: "test" })).toBe(
      "development",
    );
  });

  it("tolera espacos e caixa (fail toward producao)", () => {
    expect(getAdminRuntimeKind({ NODE_ENV: " Production " })).toBe("production");
    expect(getAdminRuntimeKind({ VERCEL_ENV: "PREVIEW" })).toBe("preview");
  });
});

describe("isProductionLikeAdminEnvironment — producao/preview sao production-like", () => {
  it("production-like: NODE_ENV=production, VERCEL_ENV=production, VERCEL_ENV=preview", () => {
    expect(isProductionLikeAdminEnvironment({ NODE_ENV: "production" })).toBe(true);
    expect(isProductionLikeAdminEnvironment({ VERCEL_ENV: "production" })).toBe(true);
    expect(isProductionLikeAdminEnvironment({ VERCEL_ENV: "preview" })).toBe(true);
  });

  it("NAO production-like: dev/test/vercel-development/vazio", () => {
    expect(isProductionLikeAdminEnvironment({ NODE_ENV: "development" })).toBe(false);
    expect(isProductionLikeAdminEnvironment({ NODE_ENV: "test" })).toBe(false);
    expect(isProductionLikeAdminEnvironment({ VERCEL_ENV: "development" })).toBe(false);
    expect(isProductionLikeAdminEnvironment({})).toBe(false);
  });

  it("NODE_ENV=production continua production-like mesmo com VERCEL_ENV=development", () => {
    expect(
      isProductionLikeAdminEnvironment({
        NODE_ENV: "production",
        VERCEL_ENV: "development",
      }),
    ).toBe(true);
  });
});

describe("isExplicitAdminProtectionEnabled — so a string exata 'true'", () => {
  it("desativada quando ADMIN_PROTECTION_ENABLED nao e 'true'", () => {
    expect(isExplicitAdminProtectionEnabled({})).toBe(false);
    expect(isExplicitAdminProtectionEnabled({ ADMIN_PROTECTION_ENABLED: "false" })).toBe(false);
    expect(isExplicitAdminProtectionEnabled({ ADMIN_PROTECTION_ENABLED: "1" })).toBe(false);
    expect(isExplicitAdminProtectionEnabled({ ADMIN_PROTECTION_ENABLED: "TRUE" })).toBe(false);
    expect(isExplicitAdminProtectionEnabled({ ADMIN_PROTECTION_ENABLED: "" })).toBe(false);
  });

  it("ativa quando === 'true'", () => {
    expect(isExplicitAdminProtectionEnabled({ ADMIN_PROTECTION_ENABLED: "true" })).toBe(true);
  });
});

describe("isAdminProtectionRequired — production-like OU flag explicita", () => {
  it("dev/local sem flag -> nao exige", () => {
    expect(isAdminProtectionRequired({})).toBe(false);
    expect(isAdminProtectionRequired({ NODE_ENV: "development" })).toBe(false);
  });

  it("flag 'true' exige mesmo em dev", () => {
    expect(isAdminProtectionRequired({ ADMIN_PROTECTION_ENABLED: "true" })).toBe(true);
  });

  it("production-like exige mesmo sem flag", () => {
    expect(isAdminProtectionRequired({ NODE_ENV: "production" })).toBe(true);
    expect(isAdminProtectionRequired({ VERCEL_ENV: "preview" })).toBe(true);
    expect(isAdminProtectionRequired({ VERCEL_ENV: "production" })).toBe(true);
  });

  it("ADMIN_PROTECTION_ENABLED=false NAO desabilita em production-like", () => {
    expect(
      isAdminProtectionRequired({ NODE_ENV: "production", ADMIN_PROTECTION_ENABLED: "false" }),
    ).toBe(true);
    expect(
      isAdminProtectionRequired({
        NODE_ENV: "production",
        VERCEL_ENV: "development",
        ADMIN_PROTECTION_ENABLED: "false",
      }),
    ).toBe(true);
    expect(
      isAdminProtectionRequired({ VERCEL_ENV: "preview", ADMIN_PROTECTION_ENABLED: "false" }),
    ).toBe(true);
  });
});

describe("hasAdminCredentials — exige usuario E senha nao vazios", () => {
  it("false quando faltam ou sao vazios/espaco", () => {
    expect(hasAdminCredentials({})).toBe(false);
    expect(hasAdminCredentials({ ADMIN_BASIC_AUTH_USER: USER })).toBe(false);
    expect(hasAdminCredentials({ ADMIN_BASIC_AUTH_PASSWORD: PASS })).toBe(false);
    expect(
      hasAdminCredentials({ ADMIN_BASIC_AUTH_USER: "  ", ADMIN_BASIC_AUTH_PASSWORD: PASS }),
    ).toBe(false);
    expect(hasAdminCredentials({ ADMIN_BASIC_AUTH_USER: USER, ADMIN_BASIC_AUTH_PASSWORD: "" })).toBe(
      false,
    );
  });

  it("true quando ambos configurados", () => {
    expect(hasAdminCredentials(CREDS)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Parse do header                                                    */
/* ------------------------------------------------------------------ */

describe("classifyBasicAuthHeader / parseBasicAuthHeader", () => {
  it("ausente/vazio -> missing", () => {
    expect(classifyBasicAuthHeader(undefined).status).toBe("missing");
    expect(classifyBasicAuthHeader(null).status).toBe("missing");
    expect(classifyBasicAuthHeader("").status).toBe("missing");
    expect(classifyBasicAuthHeader("   ").status).toBe("missing");
  });

  it("esquema != Basic -> invalid-scheme", () => {
    expect(classifyBasicAuthHeader("Bearer abc123").status).toBe("invalid-scheme");
    expect(
      classifyBasicAuthHeader(`Digest ${Buffer.from("a:b").toString("base64")}`).status,
    ).toBe("invalid-scheme");
  });

  it("base64 invalido -> malformed", () => {
    expect(classifyBasicAuthHeader("Basic @@@nao-base64@@@").status).toBe("malformed");
    expect(classifyBasicAuthHeader("Basic %%%%").status).toBe("malformed");
  });

  it("sem ':' -> malformed", () => {
    const noColon = Buffer.from("apenasusuario", "utf-8").toString("base64");
    expect(classifyBasicAuthHeader(`Basic ${noColon}`).status).toBe("malformed");
  });

  it("valido -> parsed, com split so no primeiro ':' e case-insensitive", () => {
    expect(parseBasicAuthHeader(basicHeader("u", "p"))).toEqual({ user: "u", pass: "p" });
    // Senha com ':' preservada inteira.
    expect(parseBasicAuthHeader(basicHeader(USER, PASS))).toEqual({ user: USER, pass: PASS });
    // Aceita o esquema case-insensitive (RFC 7617).
    expect(parseBasicAuthHeader(basicHeader("u", "p").replace("Basic", "basic"))).toEqual({
      user: "u",
      pass: "p",
    });
  });

  it("parseBasicAuthHeader devolve null quando nao ha credencial", () => {
    expect(parseBasicAuthHeader(undefined)).toBeNull();
    expect(parseBasicAuthHeader("Bearer x")).toBeNull();
    expect(parseBasicAuthHeader("Basic %%%%")).toBeNull();
  });
});

describe("isValidBasicAuth — compara com as credenciais de ENV", () => {
  it("sem credenciais configuradas -> sempre false (fail closed)", () => {
    expect(isValidBasicAuth(basicHeader(USER, PASS), { ADMIN_PROTECTION_ENABLED: "true" })).toBe(
      false,
    );
  });

  it("header ausente/usuario/senha errados -> false", () => {
    expect(isValidBasicAuth(undefined, ENABLED_ENV)).toBe(false);
    expect(isValidBasicAuth(basicHeader("intruso", PASS), ENABLED_ENV)).toBe(false);
    expect(isValidBasicAuth(basicHeader(USER, "senha-errada"), ENABLED_ENV)).toBe(false);
  });

  it("usuario e senha corretos (senha com ':') -> true", () => {
    expect(isValidBasicAuth(basicHeader(USER, PASS), ENABLED_ENV)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Decisao de acesso (a regra central da Fase 6C)                      */
/* ------------------------------------------------------------------ */

describe("evaluateAdminAccess — dev/local", () => {
  it("sem flag -> allow (protection_disabled_dev), mesmo sem header", () => {
    expect(evaluateAdminAccess(undefined, {})).toEqual({
      outcome: "allow",
      reason: "protection_disabled_dev",
    });
    expect(evaluateAdminAccess(undefined, { NODE_ENV: "development" })).toEqual({
      outcome: "allow",
      reason: "protection_disabled_dev",
    });
    expect(evaluateAdminAccess(undefined, { ADMIN_PROTECTION_ENABLED: "false" })).toEqual({
      outcome: "allow",
      reason: "protection_disabled_dev",
    });
  });

  it("flag 'true' em dev -> exige auth (deny sem header)", () => {
    expect(evaluateAdminAccess(undefined, ENABLED_ENV)).toEqual({
      outcome: "deny",
      reason: "missing_authorization",
    });
  });

  it("flag 'true' sem credenciais -> missing_credentials", () => {
    expect(
      evaluateAdminAccess(basicHeader(USER, PASS), { ADMIN_PROTECTION_ENABLED: "true" }),
    ).toEqual({ outcome: "deny", reason: "missing_credentials" });
  });
});

describe("evaluateAdminAccess — production-like exige protecao mesmo sem flag", () => {
  it("NODE_ENV=production sem flag e sem header -> deny (missing_authorization)", () => {
    expect(evaluateAdminAccess(undefined, { NODE_ENV: "production", ...CREDS })).toEqual({
      outcome: "deny",
      reason: "missing_authorization",
    });
  });

  it("NODE_ENV=production com ADMIN_PROTECTION_ENABLED=false -> ainda exige (deny)", () => {
    expect(
      evaluateAdminAccess(undefined, {
        NODE_ENV: "production",
        ADMIN_PROTECTION_ENABLED: "false",
        ...CREDS,
      }),
    ).toEqual({ outcome: "deny", reason: "missing_authorization" });
  });

  it("NODE_ENV=production com VERCEL_ENV=development -> ainda exige auth", () => {
    expect(
      evaluateAdminAccess(undefined, {
        NODE_ENV: "production",
        VERCEL_ENV: "development",
        ...CREDS,
      }),
    ).toEqual({ outcome: "deny", reason: "missing_authorization" });
  });

  it("NODE_ENV=production sem credenciais -> missing_credentials (fail closed)", () => {
    expect(evaluateAdminAccess(basicHeader(USER, PASS), { NODE_ENV: "production" })).toEqual({
      outcome: "deny",
      reason: "missing_credentials",
    });
  });

  it("NODE_ENV=production com credenciais corretas -> authorized", () => {
    expect(
      evaluateAdminAccess(basicHeader(USER, PASS), { NODE_ENV: "production", ...CREDS }),
    ).toEqual({ outcome: "allow", reason: "authorized" });
  });

  it("NODE_ENV=production com credenciais erradas -> invalid_credentials", () => {
    expect(
      evaluateAdminAccess(basicHeader(USER, "errada"), { NODE_ENV: "production", ...CREDS }),
    ).toEqual({ outcome: "deny", reason: "invalid_credentials" });
  });

  it("VERCEL_ENV=preview sem flag -> exige auth", () => {
    expect(evaluateAdminAccess(undefined, { VERCEL_ENV: "preview", ...CREDS })).toEqual({
      outcome: "deny",
      reason: "missing_authorization",
    });
  });

  it("VERCEL_ENV=production sem flag -> exige auth", () => {
    expect(evaluateAdminAccess(undefined, { VERCEL_ENV: "production", ...CREDS })).toEqual({
      outcome: "deny",
      reason: "missing_authorization",
    });
  });

  it("VERCEL_ENV=development NAO e production-like -> allow sem flag", () => {
    expect(evaluateAdminAccess(undefined, { VERCEL_ENV: "development", ...CREDS })).toEqual({
      outcome: "allow",
      reason: "protection_disabled_dev",
    });
  });
});

describe("evaluateAdminAccess — motivos granulares do desafio", () => {
  it("header ausente -> missing_authorization", () => {
    expect(evaluateAdminAccess(undefined, ENABLED_ENV).reason).toBe("missing_authorization");
  });

  it("header sem Basic -> invalid_scheme", () => {
    expect(evaluateAdminAccess("Bearer token-xyz", ENABLED_ENV)).toEqual({
      outcome: "deny",
      reason: "invalid_scheme",
    });
  });

  it("base64 invalido -> invalid_credentials", () => {
    expect(evaluateAdminAccess("Basic @@@", ENABLED_ENV)).toEqual({
      outcome: "deny",
      reason: "invalid_credentials",
    });
  });

  it("credencial sem ':' -> invalid_credentials", () => {
    const noColon = `Basic ${Buffer.from("semdoispontos", "utf-8").toString("base64")}`;
    expect(evaluateAdminAccess(noColon, ENABLED_ENV).reason).toBe("invalid_credentials");
  });

  it("senha contendo ':' funciona -> authorized", () => {
    expect(evaluateAdminAccess(basicHeader(USER, PASS), ENABLED_ENV)).toEqual({
      outcome: "allow",
      reason: "authorized",
    });
  });
});

/* ------------------------------------------------------------------ */
/* Segredos: nada de senha/usuario em estruturas publicas              */
/* ------------------------------------------------------------------ */

describe("segredos: usuario/senha nunca vazam em estruturas publicas", () => {
  it("a decisao de acesso (allow/deny) nunca inclui usuario nem senha", () => {
    const allow = JSON.stringify(
      evaluateAdminAccess(basicHeader(USER, PASS), { NODE_ENV: "production", ...CREDS }),
    );
    const denyBad = JSON.stringify(
      evaluateAdminAccess(basicHeader(USER, "x"), { NODE_ENV: "production", ...CREDS }),
    );
    expect(allow).not.toContain(PASS);
    expect(allow).not.toContain(USER);
    expect(denyBad).not.toContain(PASS);
  });

  it("os motivos sao enum estavel, sem valor sensivel", () => {
    const reason = evaluateAdminAccess(basicHeader(USER, "x"), { NODE_ENV: "production", ...CREDS })
      .reason;
    expect(reason).toBe("invalid_credentials");
    expect(reason).not.toContain(PASS);
    expect(reason).not.toContain(USER);
  });

  it("getAdminAccessConfig / redigida nunca contem usuario nem senha", () => {
    const config = getAdminAccessConfig({ NODE_ENV: "production", ...CREDS });
    const redacted = redactAdminAccessConfigForDisplay(config);
    for (const json of [JSON.stringify(config), JSON.stringify(redacted)]) {
      expect(json).not.toContain(PASS);
      expect(json).not.toContain(USER);
    }
    // ...mas a presenca (booleans) e refletida corretamente.
    expect(config.hasCredentials).toBe(true);
    expect(redacted.credentialsConfigured).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* getAdminAccessConfig / redigida — semantica de status               */
/* ------------------------------------------------------------------ */

describe("getAdminAccessConfig — postura por ambiente", () => {
  it("dev/local sem flag -> open (aberto)", () => {
    const c = getAdminAccessConfig({ NODE_ENV: "development" });
    expect(c.protectionRequired).toBe(false);
    expect(c.posture).toBe("open");
  });

  it("production-like com credenciais -> protected", () => {
    const c = getAdminAccessConfig({ NODE_ENV: "production", ...CREDS });
    expect(c.protectionRequired).toBe(true);
    expect(c.posture).toBe("protected");
  });

  it("production-like sem credenciais -> blocked-missing-credentials", () => {
    const c = getAdminAccessConfig({ NODE_ENV: "production" });
    expect(c.protectionRequired).toBe(true);
    expect(c.posture).toBe("blocked-missing-credentials");
  });

  it("envPresence reflete presenca (nunca valor)", () => {
    const c = getAdminAccessConfig({ NODE_ENV: "production", ...CREDS });
    expect(c.envPresence.ADMIN_BASIC_AUTH_USER).toBe(true);
    expect(c.envPresence.ADMIN_BASIC_AUTH_PASSWORD).toBe(true);
    expect(c.envPresence.NODE_ENV).toBe(true);
    expect(c.envPresence.VERCEL_ENV).toBe(false);
  });
});

describe("redactAdminAccessConfigForDisplay — rotulos para a pagina", () => {
  it("mapeia ambiente e postura para rotulos legiveis", () => {
    const open = redactAdminAccessConfigForDisplay(getAdminAccessConfig({}));
    expect(open.environmentLabel).toBe("local/unknown");
    expect(open.postureLabel).toBe("Aberto em dev/local");

    const prod = redactAdminAccessConfigForDisplay(getAdminAccessConfig({ NODE_ENV: "production", ...CREDS }));
    expect(prod.environmentLabel).toBe("production");
    expect(prod.postureLabel).toBe("Protegido");

    const blocked = redactAdminAccessConfigForDisplay(getAdminAccessConfig({ NODE_ENV: "production" }));
    expect(blocked.postureLabel).toBe("Bloqueado por credenciais ausentes");
  });

  it("checklist lista as 5 env por nome, marcando sensiveis", () => {
    const redacted = redactAdminAccessConfigForDisplay(getAdminAccessConfig({ ...CREDS }));
    expect(redacted.envChecklist.map((i) => i.key)).toEqual([...ADMIN_ACCESS_ENV_KEYS]);
    const user = redacted.envChecklist.find((i) => i.key === "ADMIN_BASIC_AUTH_USER");
    const pass = redacted.envChecklist.find((i) => i.key === "ADMIN_BASIC_AUTH_PASSWORD");
    const node = redacted.envChecklist.find((i) => i.key === "NODE_ENV");
    expect(user).toMatchObject({ present: true, sensitive: true });
    expect(pass).toMatchObject({ present: true, sensitive: true });
    expect(node).toMatchObject({ sensitive: false });
  });
});

/* ------------------------------------------------------------------ */
/* Desafio 401                                                        */
/* ------------------------------------------------------------------ */

describe("desafio 401: WWW-Authenticate + no-store", () => {
  it('WWW_AUTHENTICATE_VALUE e Basic realm="Screen Admin"', () => {
    expect(ADMIN_BASIC_AUTH_REALM).toBe("Screen Admin");
    expect(WWW_AUTHENTICATE_VALUE).toBe('Basic realm="Screen Admin"');
  });

  it("buildUnauthorizedHeaders emite o desafio Basic e no-store, sem credencial", () => {
    const headers = buildUnauthorizedHeaders();
    expect(headers["WWW-Authenticate"]).toBe('Basic realm="Screen Admin"');
    expect(headers["Cache-Control"]).toBe("no-store");
    const json = JSON.stringify(headers);
    expect(json).not.toContain(PASS);
    expect(json).not.toContain(USER);
  });
});

/* ------------------------------------------------------------------ */
/* Guarda textual do middleware                                        */
/* ------------------------------------------------------------------ */

describe("guarda textual: o middleware do admin usa o helper testado", () => {
  const MIDDLEWARE_PATH = resolve(process.cwd(), "apps", "admin", "middleware.ts");

  it("importa a decisao/headers do helper puro", async () => {
    const src = await readFile(MIDDLEWARE_PATH, "utf-8");
    expect(src).toContain("./src/lib/access-protection");
    expect(src).toContain("evaluateAdminAccess");
    expect(src).toContain("buildUnauthorizedHeaders");
  });

  it("le o header authorization e as cinco ENV (auth + ambiente)", async () => {
    const src = await readFile(MIDDLEWARE_PATH, "utf-8");
    expect(src).toContain('request.headers.get("authorization")');
    expect(src).toContain("process.env.ADMIN_PROTECTION_ENABLED");
    expect(src).toContain("process.env.ADMIN_BASIC_AUTH_USER");
    expect(src).toContain("process.env.ADMIN_BASIC_AUTH_PASSWORD");
    expect(src).toContain("process.env.NODE_ENV");
    expect(src).toContain("process.env.VERCEL_ENV");
  });

  it("responde 401 via NextResponse e exporta um matcher", async () => {
    const src = await readFile(MIDDLEWARE_PATH, "utf-8");
    expect(src).toContain("NextResponse");
    expect(src).toContain("status: 401");
    expect(src).toContain("matcher");
  });
});
