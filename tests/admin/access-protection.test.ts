/**
 * Testes da camada de protecao de ACESSO do admin interno (@screena/admin).
 *
 * Cobrem o helper puro `apps/admin/src/lib/access-protection` (Basic Auth por
 * ENV, sem estado) e uma guarda TEXTUAL do middleware que o consome. O
 * middleware em si e um adaptador fino do runtime do Next; testar seu runtime
 * Edge diretamente seria fragil (e o `next` pode nem estar instalado offline),
 * entao a decisao de acesso e exercitada no helper — que e exatamente o que o
 * middleware chama — e a fiacao do middleware e verificada por leitura do fonte.
 *
 * ESCOPO: esta fase NAO cria login/sessao/cookie/JWT/OAuth/usuario. So valida o
 * portao Basic Auth minimo.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ADMIN_BASIC_AUTH_REALM,
  WWW_AUTHENTICATE_VALUE,
  buildUnauthorizedHeaders,
  evaluateAdminAccess,
  hasAdminCredentials,
  isAdminProtectionEnabled,
  isValidBasicAuth,
  parseBasicAuthHeader,
  type AdminAuthEnv,
} from "../../apps/admin/src/lib/access-protection";

/** Monta um header `Authorization: Basic <base64(user:pass)>` (UTF-8). */
function basicHeader(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`, "utf-8").toString("base64")}`;
}

const USER = "editor-op";
const PASS = "s3nha-Op#2026:xyz"; // contem ':' de proposito (split so no primeiro)

const ENABLED_ENV: AdminAuthEnv = {
  ADMIN_PROTECTION_ENABLED: "true",
  ADMIN_BASIC_AUTH_USER: USER,
  ADMIN_BASIC_AUTH_PASSWORD: PASS,
};

describe("isAdminProtectionEnabled — protecao so liga com a string exata 'true'", () => {
  it("desativada quando ADMIN_PROTECTION_ENABLED nao e 'true'", () => {
    expect(isAdminProtectionEnabled({})).toBe(false);
    expect(isAdminProtectionEnabled({ ADMIN_PROTECTION_ENABLED: "false" })).toBe(false);
    expect(isAdminProtectionEnabled({ ADMIN_PROTECTION_ENABLED: "1" })).toBe(false);
    expect(isAdminProtectionEnabled({ ADMIN_PROTECTION_ENABLED: "TRUE" })).toBe(false);
    expect(isAdminProtectionEnabled({ ADMIN_PROTECTION_ENABLED: "" })).toBe(false);
  });

  it("ativa quando ADMIN_PROTECTION_ENABLED === 'true'", () => {
    expect(isAdminProtectionEnabled({ ADMIN_PROTECTION_ENABLED: "true" })).toBe(true);
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
    expect(
      hasAdminCredentials({ ADMIN_BASIC_AUTH_USER: USER, ADMIN_BASIC_AUTH_PASSWORD: "" }),
    ).toBe(false);
  });

  it("true quando ambos estao configurados", () => {
    expect(
      hasAdminCredentials({ ADMIN_BASIC_AUTH_USER: USER, ADMIN_BASIC_AUTH_PASSWORD: PASS }),
    ).toBe(true);
  });
});

describe("parseBasicAuthHeader — rejeita header malformado", () => {
  it("header ausente/nao-string -> null", () => {
    expect(parseBasicAuthHeader(undefined)).toBeNull();
    expect(parseBasicAuthHeader(null)).toBeNull();
    expect(parseBasicAuthHeader("")).toBeNull();
  });

  it("sem esquema Basic -> null", () => {
    expect(parseBasicAuthHeader("Bearer abc123")).toBeNull();
    expect(parseBasicAuthHeader(`Digest ${Buffer.from("a:b").toString("base64")}`)).toBeNull();
  });

  it("base64 invalido -> null", () => {
    expect(parseBasicAuthHeader("Basic @@@nao-base64@@@")).toBeNull();
    expect(parseBasicAuthHeader("Basic %%%%")).toBeNull();
  });

  it("credencial sem ':' -> null", () => {
    const noColon = Buffer.from("apenasusuario", "utf-8").toString("base64");
    expect(parseBasicAuthHeader(`Basic ${noColon}`)).toBeNull();
  });

  it("credencial valida -> { user, pass }, com split so no primeiro ':'", () => {
    expect(parseBasicAuthHeader(basicHeader("u", "p"))).toEqual({ user: "u", pass: "p" });
    // Senha com ':' preservada inteira.
    expect(parseBasicAuthHeader(basicHeader(USER, PASS))).toEqual({ user: USER, pass: PASS });
    // Aceita o esquema case-insensitive (RFC 7617).
    expect(parseBasicAuthHeader(basicHeader("u", "p").replace("Basic", "basic"))).toEqual({
      user: "u",
      pass: "p",
    });
  });
});

describe("isValidBasicAuth — compara com as credenciais de ENV", () => {
  it("sem credenciais configuradas -> sempre false (fail closed)", () => {
    expect(isValidBasicAuth(basicHeader(USER, PASS), { ADMIN_PROTECTION_ENABLED: "true" })).toBe(
      false,
    );
  });

  it("header ausente -> false", () => {
    expect(isValidBasicAuth(undefined, ENABLED_ENV)).toBe(false);
    expect(isValidBasicAuth(null, ENABLED_ENV)).toBe(false);
  });

  it("usuario errado -> false", () => {
    expect(isValidBasicAuth(basicHeader("intruso", PASS), ENABLED_ENV)).toBe(false);
  });

  it("senha errada -> false", () => {
    expect(isValidBasicAuth(basicHeader(USER, "senha-errada"), ENABLED_ENV)).toBe(false);
  });

  it("usuario e senha corretos -> true", () => {
    expect(isValidBasicAuth(basicHeader(USER, PASS), ENABLED_ENV)).toBe(true);
  });
});

describe("evaluateAdminAccess — decisao consumida pelo middleware", () => {
  it("protecao desativada -> allow, mesmo sem header", () => {
    expect(evaluateAdminAccess(undefined, {})).toEqual({
      outcome: "allow",
      reason: "protection-disabled",
    });
    expect(evaluateAdminAccess(undefined, { ADMIN_PROTECTION_ENABLED: "false" })).toEqual({
      outcome: "allow",
      reason: "protection-disabled",
    });
  });

  it("protecao ativa sem usuario/senha -> deny (nega por seguranca)", () => {
    expect(evaluateAdminAccess(basicHeader(USER, PASS), { ADMIN_PROTECTION_ENABLED: "true" })).toEqual(
      { outcome: "deny", reason: "missing-credentials-config" },
    );
  });

  it("protecao ativa, Basic Auth ausente -> deny", () => {
    expect(evaluateAdminAccess(undefined, ENABLED_ENV)).toEqual({
      outcome: "deny",
      reason: "invalid-or-absent-auth",
    });
  });

  it("protecao ativa, Basic Auth invalido -> deny", () => {
    expect(evaluateAdminAccess(basicHeader(USER, "errada"), ENABLED_ENV)).toEqual({
      outcome: "deny",
      reason: "invalid-or-absent-auth",
    });
  });

  it("protecao ativa, Basic Auth valido -> allow", () => {
    expect(evaluateAdminAccess(basicHeader(USER, PASS), ENABLED_ENV)).toEqual({
      outcome: "allow",
      reason: "authenticated",
    });
  });
});

describe("segredos: a senha nunca vaza em estruturas publicas", () => {
  it("a decisao de acesso (allow/deny) nunca inclui a senha", () => {
    const allow = JSON.stringify(evaluateAdminAccess(basicHeader(USER, PASS), ENABLED_ENV));
    const denyBad = JSON.stringify(evaluateAdminAccess(basicHeader(USER, "x"), ENABLED_ENV));
    expect(allow).not.toContain(PASS);
    expect(denyBad).not.toContain(PASS);
    expect(allow).not.toContain(USER);
  });

  it("os headers de 401 nao contem credencial", () => {
    const headers = JSON.stringify(buildUnauthorizedHeaders());
    expect(headers).not.toContain(PASS);
    expect(headers).not.toContain(USER);
  });
});

describe("desafio 401: WWW-Authenticate anuncia o realm do admin", () => {
  it('WWW_AUTHENTICATE_VALUE e Basic realm="Screen Admin"', () => {
    expect(ADMIN_BASIC_AUTH_REALM).toBe("Screen Admin");
    expect(WWW_AUTHENTICATE_VALUE).toBe('Basic realm="Screen Admin"');
  });

  it("buildUnauthorizedHeaders emite o desafio Basic e no-store", () => {
    const headers = buildUnauthorizedHeaders();
    expect(headers["WWW-Authenticate"]).toBe('Basic realm="Screen Admin"');
    expect(headers["WWW-Authenticate"]).toContain('Basic realm="Screen Admin"');
    expect(headers["Cache-Control"]).toBe("no-store");
  });
});

describe("guarda textual: o middleware do admin usa o helper testado", () => {
  const MIDDLEWARE_PATH = resolve(process.cwd(), "apps", "admin", "middleware.ts");

  it("existe e importa a decisao/headers do helper puro", async () => {
    const src = await readFile(MIDDLEWARE_PATH, "utf-8");
    expect(src).toContain("./src/lib/access-protection");
    expect(src).toContain("evaluateAdminAccess");
    expect(src).toContain("buildUnauthorizedHeaders");
  });

  it("le o header authorization e as tres ENV de protecao", async () => {
    const src = await readFile(MIDDLEWARE_PATH, "utf-8");
    expect(src).toContain('request.headers.get("authorization")');
    expect(src).toContain("process.env.ADMIN_PROTECTION_ENABLED");
    expect(src).toContain("process.env.ADMIN_BASIC_AUTH_USER");
    expect(src).toContain("process.env.ADMIN_BASIC_AUTH_PASSWORD");
  });

  it("responde 401 via NextResponse e exporta um matcher", async () => {
    const src = await readFile(MIDDLEWARE_PATH, "utf-8");
    expect(src).toContain("NextResponse");
    expect(src).toContain("status: 401");
    expect(src).toContain("matcher");
  });
});
