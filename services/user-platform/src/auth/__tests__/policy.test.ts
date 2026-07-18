/**
 * Testes de governanca — politica pura de autenticacao (auth/policy.ts).
 *
 * Cobrem: normalizacao/formato de email, handle, politica de senha
 * (comprimento e o que importa), TTLs, brute force com janela deslizante,
 * lockout apos 5 falhas, reset da janela e lockout progressivo que dobra.
 */

import { describe, expect, it } from "vitest";
import {
  EMAIL_VERIFICATION_TTL_HOURS,
  evaluateThrottle,
  lockoutDurationMinutes,
  normalizeEmail,
  PASSWORD_POLICY,
  PASSWORD_RESET_TTL_HOURS,
  registerFailure,
  registerSuccess,
  SESSION_TTL_HOURS,
  THROTTLE_POLICY,
  type ThrottleState,
  validateEmailFormat,
  validateHandle,
  validatePasswordCandidate,
} from "../policy.js";

const NOW = new Date("2026-07-17T12:00:00.000Z");

function minutesAfter(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60_000);
}

function baseState(overrides: Partial<ThrottleState> = {}): ThrottleState {
  return {
    failureCount: 1,
    windowStartedAt: NOW,
    lockedUntil: null,
    previousLockouts: 0,
    ...overrides,
  };
}

describe("normalizeEmail", () => {
  it("(1) aplica trim e lowercase", () => {
    expect(normalizeEmail("  Pablo@Example.COM  ")).toBe("pablo@example.com");
  });

  it("(2) e idempotente sobre email ja normalizado", () => {
    expect(normalizeEmail("pablo@example.com")).toBe("pablo@example.com");
  });
});

describe("validateEmailFormat", () => {
  it("(1) aceita email valido mesmo com espacos e maiusculas na entrada", () => {
    const result = validateEmailFormat(" User.Name+tag@Example.com ");
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("(2) rejeita email vazio", () => {
    const result = validateEmailFormat("   ");
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("vazio"))).toBe(true);
  });

  it("(3) rejeita email sem arroba e sem dominio com ponto", () => {
    expect(validateEmailFormat("pablo.example.com").ok).toBe(false);
    expect(validateEmailFormat("pablo@localhost").ok).toBe(false);
    expect(validateEmailFormat("pa blo@example.com").ok).toBe(false);
  });

  it("(4) rejeita email acima de 254 caracteres", () => {
    const longEmail = `${"a".repeat(250)}@ex.com`;
    const result = validateEmailFormat(longEmail);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("254"))).toBe(true);
  });
});

describe("validateHandle", () => {
  it("(1) aceita handles validos do padrao", () => {
    expect(validateHandle("pablo_eduardo1").ok).toBe(true);
    expect(validateHandle("a").ok).toBe(true);
    expect(validateHandle("abc").ok).toBe(true);
    expect(validateHandle(`a${"b".repeat(28)}c`).ok).toBe(true); // 30 chars
  });

  it("(2) rejeita underscore nas pontas, maiusculas e tamanho invalido", () => {
    expect(validateHandle("_abc").ok).toBe(false);
    expect(validateHandle("abc_").ok).toBe(false);
    expect(validateHandle("Pablo").ok).toBe(false);
    expect(validateHandle("ab").ok).toBe(false); // regex nao admite tamanho 2
    expect(validateHandle(`a${"b".repeat(29)}c`).ok).toBe(false); // 31 chars
    expect(validateHandle("").ok).toBe(false);
  });
});

describe("validatePasswordCandidate", () => {
  it("(1) aceita senha longa sem exigir composicao (comprimento e o que importa)", () => {
    const result = validatePasswordCandidate("aaaaaaaaaa", "pablo@example.com");
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("(2) rejeita senha abaixo de 10 caracteres", () => {
    const result = validatePasswordCandidate("curta1234", "pablo@example.com");
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes(String(PASSWORD_POLICY.minLength)))).toBe(true);
  });

  it("(3) rejeita senha acima de 200 caracteres", () => {
    const result = validatePasswordCandidate("x".repeat(201), "pablo@example.com");
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes(String(PASSWORD_POLICY.maxLength)))).toBe(true);
  });

  it("(4) rejeita senha igual ao email (case-insensitive)", () => {
    const result = validatePasswordCandidate("Pablo@Example.com", "pablo@example.com");
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("igual ao email"))).toBe(true);
  });

  it("(5) rejeita senha igual a parte local do email", () => {
    const result = validatePasswordCandidate("pablo.eduardo", "pablo.eduardo@example.com");
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("parte local"))).toBe(true);
  });
});

describe("TTLs de autenticacao", () => {
  it("(1) sessao dura 720h (30 dias); verificacao 24h; reset 2h", () => {
    expect(SESSION_TTL_HOURS).toBe(720);
    expect(SESSION_TTL_HOURS / 24).toBe(30);
    expect(EMAIL_VERIFICATION_TTL_HOURS).toBe(24);
    expect(PASSWORD_RESET_TTL_HOURS).toBe(2);
  });
});

describe("lockoutDurationMinutes", () => {
  it("(1) lockout progressivo dobra: 15, 30, 60, 120 minutos", () => {
    expect(lockoutDurationMinutes(0)).toBe(15);
    expect(lockoutDurationMinutes(1)).toBe(30);
    expect(lockoutDurationMinutes(2)).toBe(60);
    expect(lockoutDurationMinutes(3)).toBe(120);
  });

  it("(2) respeita o teto de 24 horas", () => {
    expect(lockoutDurationMinutes(7)).toBe(1440); // 15 * 2^7 = 1920 > 1440
    expect(lockoutDurationMinutes(100)).toBe(1440);
  });

  it("(3) entrada invalida cai no caso base (nunca lanca)", () => {
    expect(lockoutDurationMinutes(-3)).toBe(15);
    expect(lockoutDurationMinutes(Number.NaN)).toBe(15);
  });
});

describe("evaluateThrottle", () => {
  it("(1) estado nulo: destravado com orcamento cheio por escopo", () => {
    expect(evaluateThrottle(null, "email", NOW)).toEqual({
      locked: false,
      remainingFailures: THROTTLE_POLICY.email.maxFailures,
    });
    expect(evaluateThrottle(null, "ip", NOW)).toEqual({
      locked: false,
      remainingFailures: THROTTLE_POLICY.ip.maxFailures,
    });
  });

  it("(2) lockedUntil no futuro trava com zero restantes", () => {
    const state = baseState({ failureCount: 5, lockedUntil: minutesAfter(NOW, 10) });
    expect(evaluateThrottle(state, "email", NOW)).toEqual({ locked: true, remainingFailures: 0 });
  });

  it("(3) lockout vencido deixa de travar", () => {
    const state = baseState({ failureCount: 5, lockedUntil: minutesAfter(NOW, -1) });
    const result = evaluateThrottle(state, "email", NOW);
    expect(result.locked).toBe(false);
  });

  it("(4) janela expirada reseta o orcamento", () => {
    const state = baseState({
      failureCount: 4,
      windowStartedAt: minutesAfter(NOW, -THROTTLE_POLICY.email.windowMinutes),
    });
    expect(evaluateThrottle(state, "email", NOW)).toEqual({
      locked: false,
      remainingFailures: THROTTLE_POLICY.email.maxFailures,
    });
  });

  it("(5) dentro da janela desconta as falhas ja registradas", () => {
    const state = baseState({ failureCount: 3, windowStartedAt: minutesAfter(NOW, -5) });
    expect(evaluateThrottle(state, "email", NOW)).toEqual({
      locked: false,
      remainingFailures: 2,
    });
  });
});

describe("registerFailure / registerSuccess", () => {
  it("(1) primeira falha abre janela nova com contagem 1", () => {
    const state = registerFailure(null, "email", NOW);
    expect(state.failureCount).toBe(1);
    expect(state.windowStartedAt).toEqual(NOW);
    expect(state.lockedUntil).toBeNull();
  });

  it("(2) lockout apos 5 falhas no escopo email dentro da janela", () => {
    let state: ThrottleState | null = null;
    for (let i = 0; i < 5; i += 1) {
      state = registerFailure(state, "email", minutesAfter(NOW, i));
    }
    expect(state?.failureCount).toBe(5);
    expect(state?.lockedUntil).toEqual(minutesAfter(minutesAfter(NOW, 4), 15));
    expect(evaluateThrottle(state, "email", minutesAfter(NOW, 5)).locked).toBe(true);
  });

  it("(3) 4 falhas NAO travam o escopo email", () => {
    let state: ThrottleState | null = null;
    for (let i = 0; i < 4; i += 1) {
      state = registerFailure(state, "email", minutesAfter(NOW, i));
    }
    expect(state?.lockedUntil).toBeNull();
    expect(evaluateThrottle(state, "email", minutesAfter(NOW, 4)).locked).toBe(false);
  });

  it("(4) janela expirada reseta a contagem para 1", () => {
    const old = baseState({ failureCount: 4, windowStartedAt: minutesAfter(NOW, -20) });
    const state = registerFailure(old, "email", NOW);
    expect(state.failureCount).toBe(1);
    expect(state.windowStartedAt).toEqual(NOW);
    expect(state.lockedUntil).toBeNull();
  });

  it("(5) lockout progressivo dobra no segundo lockout (15 -> 30 min)", () => {
    // primeiro lockout
    let state: ThrottleState | null = null;
    for (let i = 0; i < 5; i += 1) {
      state = registerFailure(state, "email", NOW);
    }
    expect(state?.lockedUntil).toEqual(minutesAfter(NOW, 15));
    expect(state?.previousLockouts).toBe(1);

    // apos o primeiro lockout vencer, nova sequencia de 5 falhas
    const afterFirstLock = minutesAfter(NOW, 16);
    for (let i = 0; i < 5; i += 1) {
      state = registerFailure(state, "email", afterFirstLock);
    }
    expect(state?.previousLockouts).toBe(2);
    expect(state?.lockedUntil).toEqual(minutesAfter(afterFirstLock, 30));
  });

  it("(6) escopo ip so trava na 20a falha", () => {
    let state: ThrottleState | null = null;
    for (let i = 0; i < 19; i += 1) {
      state = registerFailure(state, "ip", NOW);
    }
    expect(state?.lockedUntil).toBeNull();
    state = registerFailure(state, "ip", NOW);
    expect(state.lockedUntil).toEqual(minutesAfter(NOW, 15));
  });

  it("(7) registerSuccess limpa o estado", () => {
    expect(registerSuccess()).toBeNull();
  });
});
