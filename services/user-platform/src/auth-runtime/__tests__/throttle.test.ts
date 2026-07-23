/**
 * Throttle duravel: orcamento por e-mail e por origem, janela deslizante,
 * namespace por finalidade e comportamento sob concorrencia.
 */

import { describe, expect, it } from "vitest";

import { THROTTLE_POLICY } from "../../auth/policy.js";
import type { TransactionScope } from "../../persistence/types.js";
import { requestPasswordRecovery } from "../password-recovery.js";
import { requestEmailVerification } from "../email-verification.js";
import {
  AUTH_THROTTLE_KEY_SEPARATOR,
  buildAuthThrottleKey,
  consumeAuthRequestBudget,
  consumeAuthThrottleBudget,
} from "../throttle.js";
import {
  createFakeDb,
  createFakeStores,
  createTestRuntime,
  seedUser,
  type FakeDb,
} from "./fakes.js";

const SCOPE: TransactionScope = { transactional: true };
const EMAIL = "pessoa@example.test";
const IP_HASH = "f".repeat(64);
const CONTEXTO = { correlationId: "corr-throttle-01", clientIpHash: IP_HASH } as const;

describe("chave de orcamento", () => {
  it("(1) e namespaced por FINALIDADE, com separador ASCII visivel", () => {
    expect(buildAuthThrottleKey("password_reset", EMAIL)).toBe(`password_reset:${EMAIL}`);
    expect(buildAuthThrottleKey("email_verification", EMAIL)).toBe(
      `email_verification:${EMAIL}`,
    );
    expect(AUTH_THROTTLE_KEY_SEPARATOR).toBe(":");
  });

  it("(2) o separador NAO e byte de controle (armadilha conhecida do repo)", () => {
    const chave = buildAuthThrottleKey("password_reset", EMAIL);
    for (const ch of chave) {
      const code = ch.charCodeAt(0);
      expect(code >= 0x20 && code !== 0x7f, `byte 0x${code.toString(16)}`).toBe(true);
    }
  });

  it("(3) finalidades diferentes NAO compartilham orcamento", () => {
    // `user_auth_throttles` nao tem coluna de finalidade; sem o prefixo, um
    // bloqueio de reset derrubaria tambem o reenvio de verificacao.
    expect(buildAuthThrottleKey("password_reset", EMAIL)).not.toBe(
      buildAuthThrottleKey("email_verification", EMAIL),
    );
  });
});

describe("consumo de uma chave", () => {
  async function consumir(db: FakeDb, now: Date) {
    return consumeAuthThrottleBudget({
      throttles: createFakeStores(db).throttles,
      scope: SCOPE,
      throttleScope: "email",
      key: buildAuthThrottleKey("password_reset", EMAIL),
      now,
    });
  }

  it("(4) conta CADA pedido, nao so falhas, e trava no teto da politica", async () => {
    const db = createFakeDb();
    const now = new Date("2026-07-22T12:00:00.000Z");
    const max = THROTTLE_POLICY.email.maxFailures;

    for (let i = 0; i < max - 1; i += 1) {
      expect((await consumir(db, now)).locked, `pedido ${i + 1}`).toBe(false);
    }
    // O pedido que ATINGE o teto ainda passa; o seguinte ja encontra lockout.
    expect((await consumir(db, now)).locked).toBe(false);
    expect((await consumir(db, now)).locked).toBe(true);
  });

  it("(5) durante o lockout a contagem NAO avanca (nao vira bloqueio perpetuo)", async () => {
    const db = createFakeDb();
    const now = new Date("2026-07-22T12:00:00.000Z");
    for (let i = 0; i < THROTTLE_POLICY.email.maxFailures; i += 1) {
      await consumir(db, now);
    }
    const travado = [...db.throttles.values()][0]!;
    for (let i = 0; i < 5; i += 1) {
      expect((await consumir(db, now)).locked).toBe(true);
    }
    const depois = [...db.throttles.values()][0]!;
    expect(depois.failureCount).toBe(travado.failureCount);
    expect(depois.lockedUntil?.getTime()).toBe(travado.lockedUntil?.getTime());
  });

  it("(6) a janela deslizante libera depois do lockout", async () => {
    const db = createFakeDb();
    const inicio = new Date("2026-07-22T12:00:00.000Z");
    for (let i = 0; i < THROTTLE_POLICY.email.maxFailures; i += 1) {
      await consumir(db, inicio);
    }
    expect((await consumir(db, inicio)).locked).toBe(true);
    // Lockout base e 15 minutos; 16 minutos depois deve liberar.
    const depois = new Date(inicio.getTime() + 16 * 60_000);
    expect((await consumir(db, depois)).locked).toBe(false);
  });

  it("(7) o estado e PERSISTIDO (sobrevive a troca de store)", async () => {
    const db = createFakeDb();
    const now = new Date("2026-07-22T12:00:00.000Z");
    await consumir(db, now);
    // Um store novo, ligado ao MESMO banco, enxerga a contagem: e o que
    // distingue throttle duravel de um Map em memoria do processo.
    const outro = createFakeStores(db).throttles;
    const lido = await outro.read(SCOPE, {
      scope: "email",
      key: buildAuthThrottleKey("password_reset", EMAIL),
    });
    expect(lido.kind).toBe("found");
    expect(lido.kind === "found" && lido.state.failureCount).toBe(1);
  });
});

describe("os dois escopos", () => {
  it("(8) e-mail e origem sao contados SEMPRE, mesmo quando um ja travou", async () => {
    const db = createFakeDb();
    const now = new Date("2026-07-22T12:00:00.000Z");
    const throttles = createFakeStores(db).throttles;

    // Estoura o orcamento do e-mail.
    for (let i = 0; i <= THROTTLE_POLICY.email.maxFailures; i += 1) {
      await consumeAuthRequestBudget({
        throttles,
        scope: SCOPE,
        purpose: "password_reset",
        emailNormalized: EMAIL,
        clientIpHash: IP_HASH,
        now,
      });
    }
    // A origem tambem avancou: senao, estourado um e-mail, o atacante atacaria
    // outros e-mails de graca a partir do mesmo IP.
    const origem = await throttles.read(SCOPE, {
      scope: "ip",
      key: buildAuthThrottleKey("password_reset", IP_HASH),
    });
    expect(origem.kind).toBe("found");
    expect(origem.kind === "found" && origem.state.failureCount).toBeGreaterThan(1);
  });

  it("(9) origem desconhecida nao impede o pedido (proxy sem cabecalho)", async () => {
    const db = createFakeDb();
    const decision = await consumeAuthRequestBudget({
      throttles: createFakeStores(db).throttles,
      scope: SCOPE,
      purpose: "password_reset",
      emailNormalized: EMAIL,
      clientIpHash: null,
      now: new Date("2026-07-22T12:00:00.000Z"),
    });
    expect(decision.locked).toBe(false);
    // Apenas o escopo de e-mail foi gravado.
    expect(db.throttles.size).toBe(1);
    expect([...db.throttles.keys()][0]).toContain("email|");
  });

  it("(10) o IP e gravado SO como hash — nunca em texto claro", async () => {
    const db = createFakeDb();
    await consumeAuthRequestBudget({
      throttles: createFakeStores(db).throttles,
      scope: SCOPE,
      purpose: "password_reset",
      emailNormalized: EMAIL,
      clientIpHash: IP_HASH,
      now: new Date("2026-07-22T12:00:00.000Z"),
    });
    const chaves = [...db.throttles.keys()].join(" ");
    expect(chaves).toContain(IP_HASH);
    expect(chaves).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);
  });
});

describe("integracao com os pedidos publicos", () => {
  it("(11) pedido barrado responde IGUAL e NAO envia e-mail", async () => {
    const runtime = createTestRuntime();
    seedUser(runtime.db, { emailNormalized: EMAIL });

    const respostas = new Set<string>();
    for (let i = 0; i < THROTTLE_POLICY.email.maxFailures + 3; i += 1) {
      const dto = await requestPasswordRecovery(
        runtime.deps,
        { emailNormalized: EMAIL },
        CONTEXTO,
      );
      respostas.add(JSON.stringify(dto));
      await runtime.flush();
    }
    // Uma unica forma de resposta em TODAS as tentativas.
    expect(respostas.size).toBe(1);
    // Enviou ate o teto e parou.
    expect(runtime.emails.sent.length).toBe(THROTTLE_POLICY.email.maxFailures);
    expect(runtime.logs.at(-1)!.internalReason).toBe("throttled");
    expect(runtime.logs.at(-1)!.outcome).toBe("not_applicable");
  });

  it("(12) bloquear o reset NAO bloqueia o reenvio de verificacao", async () => {
    const runtime = createTestRuntime();
    seedUser(runtime.db, { emailNormalized: EMAIL });
    for (let i = 0; i < THROTTLE_POLICY.email.maxFailures + 2; i += 1) {
      await requestPasswordRecovery(runtime.deps, { emailNormalized: EMAIL }, CONTEXTO);
    }
    await runtime.flush();
    runtime.emails.sent.length = 0;

    await requestEmailVerification(runtime.deps, { emailNormalized: EMAIL }, CONTEXTO);
    await runtime.flush();
    expect(runtime.emails.sent).toHaveLength(1);
    expect(runtime.emails.sent[0]!.kind).toBe("email_verification");
  });

  it("(13) o throttle vale para conta INEXISTENTE tambem (anti-enumeracao)", async () => {
    // Se so contas reais gastassem orcamento, o tempo ate o bloqueio viraria um
    // oraculo de existencia.
    const runtime = createTestRuntime();
    for (let i = 0; i < THROTTLE_POLICY.email.maxFailures + 2; i += 1) {
      await requestPasswordRecovery(
        runtime.deps,
        { emailNormalized: "ninguem@example.test" },
        CONTEXTO,
      );
    }
    await runtime.flush();
    expect(runtime.logs.at(-1)!.internalReason).toBe("throttled");
  });
});

// ===========================================================================
// Concorrencia: o CAS nao pode PERDER contagem
// ===========================================================================

describe("compare-and-swap sob contencao", () => {
  /**
   * Store que devolve `conflict` nas `n` primeiras escritas e depois delega ao
   * store real. Simula o perdedor de uma corrida: sem retentativa, a contagem
   * dele seria simplesmente descartada.
   */
  function comConflitosIniciais(db: FakeDb, n: number) {
    const real = createFakeStores(db).throttles;
    let restantes = n;
    return {
      read: real.read.bind(real),
      save: async (
        scope: Parameters<typeof real.save>[0],
        input: Parameters<typeof real.save>[1],
      ) => {
        if (restantes > 0) {
          restantes -= 1;
          return {
            kind: "conflict" as const,
            conflict: { reason: "stale_preimage" as const, target: "authThrottle.window" as const },
          };
        }
        return real.save(scope, input);
      },
    };
  }

  it("(14) conflito e RETENTADO: a contagem nao se perde", async () => {
    const db = createFakeDb();
    const now = new Date("2026-07-22T12:00:00.000Z");
    const decision = await consumeAuthThrottleBudget({
      throttles: comConflitosIniciais(db, 2),
      scope: SCOPE,
      throttleScope: "email",
      key: buildAuthThrottleKey("password_reset", EMAIL),
      now,
    });
    expect(decision.locked).toBe(false);
    // A contagem chegou ao banco apesar dos dois conflitos.
    expect(db.throttles.size).toBe(1);
    expect([...db.throttles.values()][0]!.failureCount).toBe(1);
  });

  it("(15) contencao SUSTENTADA falha FECHADO (locked), nunca aberto", async () => {
    // Devolver `locked: false` ao desistir transformaria a corrida numa forma de
    // burlar o limite: bastaria manter a linha em disputa.
    const db = createFakeDb();
    const decision = await consumeAuthThrottleBudget({
      throttles: comConflitosIniciais(db, 999),
      scope: SCOPE,
      throttleScope: "email",
      key: buildAuthThrottleKey("password_reset", EMAIL),
      now: new Date("2026-07-22T12:00:00.000Z"),
    });
    expect(decision.locked).toBe(true);
    expect(db.throttles.size).toBe(0);
  });

  it("(16) N pedidos SEQUENCIAIS contam N vezes (controle positivo)", async () => {
    const db = createFakeDb();
    const now = new Date("2026-07-22T12:00:00.000Z");
    const throttles = createFakeStores(db).throttles;
    for (let i = 0; i < 3; i += 1) {
      await consumeAuthThrottleBudget({
        throttles,
        scope: SCOPE,
        throttleScope: "email",
        key: buildAuthThrottleKey("password_reset", EMAIL),
        now,
      });
    }
    expect([...db.throttles.values()][0]!.failureCount).toBe(3);
  });
});
