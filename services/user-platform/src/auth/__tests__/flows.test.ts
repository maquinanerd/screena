/**
 * Testes dos decisores de fluxo (auth/flows.ts): signup com resposta publica
 * indistinguivel (conta nova vs. ja existente), e login anti-enumeracao — a
 * resposta publica e IDENTICA entre usuario inexistente, senha errada e conta
 * bloqueada; o lockout tem precedencia e nao confirma existencia da conta.
 * Motivo interno separa as causas (audit).
 */

import { describe, expect, it } from "vitest";
import { validationOk } from "../../core/result.js";
import { decideLogin, decideSignup, GENERIC_LOGIN_FAILURE_MESSAGE } from "../flows.js";
import type { UserStatus } from "../../core/types.js";

describe("decideSignup", () => {
  it("(1) email novo -> create_user", () => {
    const r = decideSignup({
      emailNormalized: "novo@example.com",
      emailAlreadyRegistered: false,
      passwordValidation: validationOk(),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.action).toBe("create_user");
  });

  it("(2) email ja registrado -> notice_existing_email (nao e erro para fora)", () => {
    const r = decideSignup({
      emailNormalized: "existe@example.com",
      emailAlreadyRegistered: true,
      passwordValidation: validationOk(),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.action).toBe("notice_existing_email");
  });

  it("(3) exige email ja normalizado (contrato do decisor)", () => {
    const r = decideSignup({
      emailNormalized: "  MAIUSCULO@Example.com ",
      emailAlreadyRegistered: false,
      passwordValidation: validationOk(),
    });
    expect(r.ok).toBe(false);
  });

  it("(4) propaga erros da validacao de senha", () => {
    const r = decideSignup({
      emailNormalized: "novo@example.com",
      emailAlreadyRegistered: false,
      passwordValidation: { ok: false, errors: ["senha muito curta"] },
    });
    expect(r.ok).toBe(false);
  });
});

describe("decideLogin (anti-enumeracao)", () => {
  const OK = {
    throttleLocked: false,
    userExists: true,
    userStatus: "active" as UserStatus | null,
    passwordMatches: true,
  };

  it("(1) credenciais validas + conta active -> establish_session", () => {
    const d = decideLogin(OK);
    expect(d.publicResult.ok).toBe(true);
    expect(d.internalReason).toBe("ok");
  });

  it("(2) lockout tem precedencia e responde locked_out sem confirmar a conta", () => {
    const d = decideLogin({ ...OK, throttleLocked: true, userExists: false });
    expect(d.publicResult.ok).toBe(false);
    if (!d.publicResult.ok) expect(d.publicResult.error.code).toBe("locked_out");
    expect(d.internalReason).toBe("throttled");
  });

  it("(3) usuario inexistente, senha errada e conta bloqueada tem RESPOSTA PUBLICA IDENTICA", () => {
    const notFound = decideLogin({ ...OK, userExists: false });
    const wrongPw = decideLogin({ ...OK, passwordMatches: false });
    const blocked = decideLogin({ ...OK, userStatus: "disabled" });

    for (const d of [notFound, wrongPw, blocked]) {
      expect(d.publicResult.ok).toBe(false);
      if (!d.publicResult.ok) {
        expect(d.publicResult.error.code).toBe("unauthorized");
        expect(d.publicResult.error.message).toBe(GENERIC_LOGIN_FAILURE_MESSAGE);
      }
    }
    // ...mas o motivo interno diferencia (audit)
    expect(notFound.internalReason).toBe("user_not_found");
    expect(wrongPw.internalReason).toBe("wrong_password");
    expect(blocked.internalReason).toBe("account_ineligible");
  });

  it("(4) nenhuma conta nao-active estabelece sessao (fail-closed)", () => {
    for (const status of ["disabled", "pending_deletion", "deleted", null] as const) {
      const d = decideLogin({ ...OK, userStatus: status });
      expect(d.publicResult.ok, String(status)).toBe(false);
    }
  });

  it("(5) o motivo interno e um rotulo categorico estavel, nunca a mensagem publica nem um segredo", () => {
    // decideLogin recebe passwordMatches:boolean, nunca a senha crua — o motivo
    // interno e estruturalmente incapaz de conter o segredo. Aqui garantimos
    // que e um dos rotulos conhecidos e que NAO e a mensagem publica.
    const known = new Set(["ok", "throttled", "user_not_found", "account_ineligible", "wrong_password"]);
    for (const d of [
      decideLogin(OK),
      decideLogin({ ...OK, passwordMatches: false }),
      decideLogin({ ...OK, userExists: false }),
      decideLogin({ ...OK, userStatus: "disabled" }),
      decideLogin({ ...OK, throttleLocked: true }),
    ]) {
      expect(known.has(d.internalReason)).toBe(true);
      expect(d.internalReason).not.toBe(GENERIC_LOGIN_FAILURE_MESSAGE);
    }
  });
});
