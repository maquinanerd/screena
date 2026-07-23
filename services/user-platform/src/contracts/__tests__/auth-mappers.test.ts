/**
 * Testes dos mappers publicos (contracts/auth-mappers.ts): whitelist explicita
 * (campo interno novo NUNCA vaza), imutabilidade da entrada, objeto novo,
 * ausencia de segredo/internalReason no DTO, e igualdade anti-enumeracao das
 * falhas de login.
 */

import { describe, expect, it } from "vitest";
import type { DomainError } from "../../core/result.js";
import type { AuthenticatedUserInternal } from "../auth-internal.js";
import {
  toCurrentUserDto,
  toGenericAcceptedDto,
  toPublicAuthFailureDto,
  toPublicLoginSuccessDto,
  toPublicLogoutDto,
  toPublicSessionDto,
} from "../auth-mappers.js";

function internalUser(overrides: Partial<AuthenticatedUserInternal> = {}): AuthenticatedUserInternal {
  return {
    id: 42n,
    handle: "pablo",
    displayName: "Pablo",
    email: "pablo@example.com",
    emailNormalized: "pablo@example.com",
    emailVerifiedAt: new Date("2026-07-17T12:00:00.000Z"),
    role: "user",
    status: "active",
    locale: "pt-BR",
    profileVisibility: "private",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

/** Serializa DTO (com bigint->string) para varrer por termos proibidos. */
function serialize(value: unknown): string {
  return JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));
}

describe("toCurrentUserDto (whitelist)", () => {
  it("(1) expoe apenas o subconjunto publico; nunca id/email/status/carimbos", () => {
    const dto = toCurrentUserDto(internalUser());
    expect(Object.keys(dto).sort()).toEqual(
      ["displayName", "emailVerified", "handle", "locale", "profileVisibility", "role"].sort(),
    );
    expect(dto.emailVerified).toBe(true);
    const text = serialize(dto);
    expect(text).not.toContain("pablo@example.com"); // email nunca vaza
    expect(text).not.toContain("42"); // PK interna nunca vaza
    expect(text).not.toContain("active"); // status interno nunca vaza
  });

  it("(2) emailVerified deriva do timestamp -> boolean (nunca o carimbo)", () => {
    expect(toCurrentUserDto(internalUser({ emailVerifiedAt: null })).emailVerified).toBe(false);
    const dto = toCurrentUserDto(internalUser());
    // nenhum valor Date sobra no DTO
    expect(Object.values(dto).some((v) => v instanceof Date)).toBe(false);
  });

  it("(3) um campo interno NOVO nao vaza automaticamente (sem spread)", () => {
    const withExtra = { ...internalUser(), passwordHash: "scrypt$secret", ipHash: "abc" } as AuthenticatedUserInternal;
    const dto = toCurrentUserDto(withExtra);
    const text = serialize(dto);
    expect(text).not.toContain("scrypt$secret");
    expect(text).not.toContain("passwordHash");
    expect(text).not.toContain("ipHash");
  });

  it("(4) nao modifica a entrada e retorna objeto NOVO", () => {
    const input = internalUser();
    const snapshot = serialize(input);
    const dto = toCurrentUserDto(input);
    expect(serialize(input)).toBe(snapshot); // entrada intacta
    expect(Object.is(dto as unknown, input as unknown)).toBe(false);
  });
});

describe("toPublicLoginSuccessDto / toPublicSessionDto", () => {
  it("(1) sucesso de login NAO contem token/csrf/hash no body", () => {
    const dto = toPublicLoginSuccessDto(internalUser());
    expect(dto.ok).toBe(true);
    const text = serialize(dto).toLowerCase();
    for (const term of ["token", "csrf", "hash", "password", "secret", "ip"]) {
      expect(text.includes(term), term).toBe(false);
    }
  });

  it("(2) leitura de sessao nao-autenticada => user null, sem detalhe", () => {
    expect(toPublicSessionDto(null)).toEqual({ authenticated: false, user: null });
  });
});

describe("toPublicAuthFailureDto (anti-enumeracao + vocabulario controlado)", () => {
  const asError = (code: DomainError["code"], message: string): DomainError => ({ code, message });

  it("(1) falha nunca contem internalReason nem details", () => {
    const dto = toPublicAuthFailureDto(asError("unauthorized", "qualquer coisa interna"));
    expect(Object.keys(dto).sort()).toEqual(["code", "message", "ok"]);
    expect(serialize(dto)).not.toContain("internalReason");
  });

  it("(2) mensagem publica vem da tabela controlada, NAO do erro do dominio", () => {
    const dto = toPublicAuthFailureDto(asError("unauthorized", "usuario 42 nao existe (vazamento)"));
    expect(dto.message).not.toContain("42");
    expect(dto.message).toBe("credenciais invalidas.");
  });

  it("(3) inexistente, senha-errada, bloqueada e credencial-ausente => DTO IDENTICO", () => {
    // o dominio (decideLogin) colapsa todas em code 'unauthorized'; o mapper as
    // torna byte-identicas independentemente da mensagem interna.
    const notFound = toPublicAuthFailureDto(asError("unauthorized", "user_not_found"));
    const wrongPw = toPublicAuthFailureDto(asError("unauthorized", "wrong_password"));
    const blocked = toPublicAuthFailureDto(asError("unauthorized", "account_ineligible"));
    const noCred = toPublicAuthFailureDto(asError("unauthorized", "credential_missing"));
    expect(serialize(wrongPw)).toBe(serialize(notFound));
    expect(serialize(blocked)).toBe(serialize(notFound));
    expect(serialize(noCred)).toBe(serialize(notFound));
  });

  it("(4) codigo desconhecido cai no fallback generico (fail-closed)", () => {
    const dto = toPublicAuthFailureDto(asError("precondition_failed", "x"));
    expect(dto.code).toBe("error");
  });
});

describe("toGenericAcceptedDto / toPublicLogoutDto (indistinguiveis e estaveis)", () => {
  it("(1) aceite generico e sempre identico (recuperacao/reenvio)", () => {
    expect(serialize(toGenericAcceptedDto())).toBe(serialize(toGenericAcceptedDto()));
    expect(toGenericAcceptedDto()).toEqual({
      ok: true,
      status: "accepted",
      message: expect.any(String),
    });
  });

  it("(2) logout confirma de forma generica", () => {
    expect(toPublicLogoutDto()).toEqual({ ok: true, status: "signed_out" });
  });
});
