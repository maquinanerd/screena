/**
 * Servicos de aplicacao: anti-enumeracao, ordem banco/fornecedor, uso unico e
 * aborto deliberado.
 *
 * Provedor de e-mail FALSO e stores em memoria com as mesmas pre-condicoes dos
 * adapters Prisma. Nenhuma chamada real a Brevo, nenhum banco.
 */

import { describe, expect, it } from "vitest";

import { TransactionalEmailError } from "../../email/types.js";
import { GENERIC_TOKEN_FAILURE_MESSAGE } from "../../auth/types.js";
import { sha256Hex } from "../../core/crypto.js";
import {
  confirmEmailVerification,
  requestEmailVerification,
} from "../email-verification.js";
import { confirmPasswordRecovery, requestPasswordRecovery } from "../password-recovery.js";
import {
  createFakeEmailProvider,
  createTestRuntime,
  seedUser,
  tokenFromSentEmail,
  type TestRuntime,
} from "./fakes.js";

const CONTEXTO = { correlationId: "corr-0000-1111", clientIpHash: "f".repeat(64) } as const;
const SEM_ORIGEM = { correlationId: "corr-2222-3333", clientIpHash: null } as const;

const EMAIL = "pessoa@example.test";

/** Resposta publica canonica dos dois PEDIDOS (sempre a mesma). */
const ACEITE_GENERICO = {
  ok: true,
  status: "accepted",
  message:
    "se aplicavel, enviaremos as instrucoes por email. Verifique sua caixa de entrada.",
};

// ===========================================================================
// PEDIDO de recuperacao de senha
// ===========================================================================

describe("pedido de recuperacao: anti-enumeracao", () => {
  async function pedir(runtime: TestRuntime) {
    const dto = await requestPasswordRecovery(runtime.deps, { emailNormalized: EMAIL }, CONTEXTO);
    // A entrega e AGENDADA, nao aguardada pelo servico (anti-enumeracao por
    // tempo). O teste drena explicitamente para poder observar o envio.
    await runtime.flush();
    return dto;
  }

  it("(1) conta ATIVA recebe o e-mail", async () => {
    const runtime = createTestRuntime();
    seedUser(runtime.db, { emailNormalized: EMAIL });

    expect(await pedir(runtime)).toEqual(ACEITE_GENERICO);
    expect(runtime.emails.sent).toHaveLength(1);
    expect(runtime.emails.sent[0]!.kind).toBe("password_reset");
    expect(runtime.emails.sent[0]!.dispatch.to).toBe(EMAIL);
    expect(runtime.emails.sent[0]!.dispatch.expiresInMinutes).toBe(30);
  });

  it("(2) conta INEXISTENTE nao envia, mas responde IGUAL", async () => {
    const runtime = createTestRuntime();
    expect(await pedir(runtime)).toEqual(ACEITE_GENERICO);
    expect(runtime.emails.sent).toHaveLength(0);
    expect(runtime.logs[0]!.internalReason).toBe("user_not_found");
    expect(runtime.logs[0]!.outcome).toBe("not_applicable");
  });

  it("(3) conta DISABLED nao envia, mas responde IGUAL", async () => {
    const runtime = createTestRuntime();
    seedUser(runtime.db, { emailNormalized: EMAIL, status: "disabled" });
    expect(await pedir(runtime)).toEqual(ACEITE_GENERICO);
    expect(runtime.emails.sent).toHaveLength(0);
    expect(runtime.logs[0]!.internalReason).toBe("account_ineligible");
  });

  it("(4) conta DELETED e PENDING_DELETION nao enviam, mas respondem IGUAL", async () => {
    for (const status of ["deleted", "pending_deletion"] as const) {
      const runtime = createTestRuntime();
      seedUser(runtime.db, { emailNormalized: EMAIL, status });
      expect(await pedir(runtime), status).toEqual(ACEITE_GENERICO);
      expect(runtime.emails.sent, status).toHaveLength(0);
    }
  });

  it("(5) FALHA DO FORNECEDOR nao muda a resposta publica", async () => {
    const runtime = createTestRuntime({
      emails: createFakeEmailProvider({
        failWith: new TransactionalEmailError("provider_unavailable"),
      }),
    });
    seedUser(runtime.db, { emailNormalized: EMAIL });

    expect(await pedir(runtime)).toEqual(ACEITE_GENERICO);
    expect(runtime.logs[0]!.outcome).toBe("provider_failed");
    expect(runtime.logs[0]!.failureCategory).toBe("provider_unavailable");
    // O token FOI persistido e continua valido: nao ha compensacao automatica.
    expect(runtime.db.tokens.size).toBe(1);
    expect([...runtime.db.tokens.values()][0]!.consumedAt).toBeNull();
  });

  it("(6) o token e persistido SO como hash — o valor cru nunca esta no banco", async () => {
    const runtime = createTestRuntime();
    seedUser(runtime.db, { emailNormalized: EMAIL });
    await pedir(runtime);

    const cru = tokenFromSentEmail(runtime.emails.sent[0]!);
    const armazenado = [...runtime.db.tokens.keys()];
    expect(armazenado).toHaveLength(1);
    expect(armazenado[0]).not.toBe(cru);
    expect(armazenado[0]).toBe(sha256Hex(cru));
    expect(armazenado[0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("(7) o PEDIDO nao invalida tokens pendentes anteriores", async () => {
    // Queimar os anteriores a cada pedido daria a qualquer um que saiba o e-mail
    // o poder de invalidar o link legitimo que o dono acabou de receber.
    const runtime = createTestRuntime();
    seedUser(runtime.db, { emailNormalized: EMAIL });
    await pedir(runtime);
    await pedir(runtime);
    expect(runtime.db.tokens.size).toBe(2);
    for (const token of runtime.db.tokens.values()) {
      expect(token.consumedAt).toBeNull();
    }
  });

  it("(8) o corpo publico nao carrega token, messageId, userId nem motivo", async () => {
    const runtime = createTestRuntime();
    seedUser(runtime.db, { emailNormalized: EMAIL });
    const dto = await pedir(runtime);
    const serializado = JSON.stringify(dto);
    expect(serializado).not.toContain(tokenFromSentEmail(runtime.emails.sent[0]!));
    expect(serializado).not.toContain("fake-");
    expect(serializado).not.toContain("issue_token");
    expect(Object.keys(dto).sort()).toEqual(["message", "ok", "status"]);
  });

  it("(9) o TTL do link vem da configuracao, nao do default do dominio", async () => {
    // Default do dominio para reset e 2h; a configuracao pede 30min.
    const runtime = createTestRuntime({ passwordResetExpirationMinutes: 30 });
    seedUser(runtime.db, { emailNormalized: EMAIL });
    await pedir(runtime);
    const token = [...runtime.db.tokens.values()][0]!;
    const minutos = (token.expiresAt.getTime() - runtime.clock.now.getTime()) / 60_000;
    expect(minutos).toBe(30);
  });
});

// ===========================================================================
// PEDIDO de verificacao de e-mail
// ===========================================================================

describe("pedido de verificacao: anti-enumeracao", () => {
  async function pedir(runtime: TestRuntime) {
    const dto = await requestEmailVerification(runtime.deps, { emailNormalized: EMAIL }, CONTEXTO);
    await runtime.flush();
    return dto;
  }

  it("(10) conta ativa NAO verificada recebe o e-mail", async () => {
    const runtime = createTestRuntime();
    seedUser(runtime.db, { emailNormalized: EMAIL });
    expect(await pedir(runtime)).toEqual(ACEITE_GENERICO);
    expect(runtime.emails.sent).toHaveLength(1);
    expect(runtime.emails.sent[0]!.kind).toBe("email_verification");
    expect(runtime.emails.sent[0]!.dispatch.expiresInMinutes).toBe(1440);
  });

  it("(11) conta JA VERIFICADA nao recebe, mas responde IGUAL", async () => {
    const runtime = createTestRuntime();
    seedUser(runtime.db, {
      emailNormalized: EMAIL,
      emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(await pedir(runtime)).toEqual(ACEITE_GENERICO);
    expect(runtime.emails.sent).toHaveLength(0);
    expect(runtime.logs[0]!.internalReason).toBe("already_verified");
  });

  it("(12) inexistente, disabled e deleted nao recebem, e respondem IGUAL", async () => {
    for (const cenario of ["inexistente", "disabled", "deleted"] as const) {
      const runtime = createTestRuntime();
      if (cenario !== "inexistente") {
        seedUser(runtime.db, { emailNormalized: EMAIL, status: cenario });
      }
      expect(await pedir(runtime), cenario).toEqual(ACEITE_GENERICO);
      expect(runtime.emails.sent, cenario).toHaveLength(0);
    }
  });

  it("(13) conta ANONIMIZADA com carimbo antigo e recusada por INELEGIBILIDADE", async () => {
    // A ordem importa: `account_ineligible` vem antes de `already_verified`.
    const runtime = createTestRuntime();
    seedUser(runtime.db, {
      emailNormalized: EMAIL,
      status: "deleted",
      emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    await pedir(runtime);
    expect(runtime.logs[0]!.internalReason).toBe("account_ineligible");
  });

  it("(14) o link enviado aponta para a pagina de verificacao", async () => {
    const runtime = createTestRuntime();
    seedUser(runtime.db, { emailNormalized: EMAIL });
    await pedir(runtime);
    const url = new URL(runtime.emails.sent[0]!.dispatch.actionUrl);
    expect(url.pathname).toBe("/pt/verificar-email/");
    expect(url.origin).toBe("https://cinerie.com");
  });
});

// ===========================================================================
// CONFIRMACAO de verificacao
// ===========================================================================

describe("confirmacao de verificacao de e-mail", () => {
  async function emitir(runtime: TestRuntime): Promise<string> {
    await requestEmailVerification(runtime.deps, { emailNormalized: EMAIL }, CONTEXTO);
    await runtime.flush();
    return tokenFromSentEmail(runtime.emails.sent[0]!);
  }

  it("(15) token valido conclui e carimba a identidade", async () => {
    const runtime = createTestRuntime();
    seedUser(runtime.db, { emailNormalized: EMAIL });
    const token = await emitir(runtime);

    const result = await confirmEmailVerification(runtime.deps, { token }, CONTEXTO);
    expect(result.ok).toBe(true);
    expect(runtime.db.users.get(EMAIL)!.emailVerifiedAt).not.toBeNull();
  });

  it("(16) USO UNICO: a segunda tentativa com o mesmo token e recusada", async () => {
    const runtime = createTestRuntime();
    seedUser(runtime.db, { emailNormalized: EMAIL });
    const token = await emitir(runtime);

    expect((await confirmEmailVerification(runtime.deps, { token }, CONTEXTO)).ok).toBe(true);
    const segunda = await confirmEmailVerification(runtime.deps, { token }, CONTEXTO);
    expect(segunda.ok).toBe(false);
    if (!segunda.ok) {
      expect(segunda.error.message).toBe(GENERIC_TOKEN_FAILURE_MESSAGE);
    }
  });

  it("(17) token EXPIRADO e recusado", async () => {
    const runtime = createTestRuntime({ emailVerificationExpirationMinutes: 60 });
    seedUser(runtime.db, { emailNormalized: EMAIL });
    const token = await emitir(runtime);
    runtime.clock.advanceMinutes(60);

    const result = await confirmEmailVerification(runtime.deps, { token }, CONTEXTO);
    expect(result.ok).toBe(false);
    expect(runtime.logs.at(-1)!.internalReason).toBe("expired");
  });

  it("(18) token INEXISTENTE e recusado com a MESMA mensagem", async () => {
    const runtime = createTestRuntime();
    const result = await confirmEmailVerification(
      runtime.deps,
      { token: "z".repeat(64) },
      CONTEXTO,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe(GENERIC_TOKEN_FAILURE_MESSAGE);
  });

  it("(19) token de RESET nao serve para verificar (purpose e pre-condicao)", async () => {
    const runtime = createTestRuntime();
    seedUser(runtime.db, { emailNormalized: EMAIL });
    await requestPasswordRecovery(runtime.deps, { emailNormalized: EMAIL }, CONTEXTO);
    await runtime.flush();
    const tokenDeReset = tokenFromSentEmail(runtime.emails.sent[0]!);

    const result = await confirmEmailVerification(runtime.deps, { token: tokenDeReset }, CONTEXTO);
    expect(result.ok).toBe(false);
    expect(runtime.logs.at(-1)!.internalReason).toBe("wrong_purpose");
    // E o token de reset continua PENDENTE: a tentativa errada nao o queimou.
    expect([...runtime.db.tokens.values()][0]!.consumedAt).toBeNull();
  });

  it("(20) conta desativada DEPOIS da emissao: recusa, e o token e PRESERVADO", async () => {
    const runtime = createTestRuntime();
    seedUser(runtime.db, { emailNormalized: EMAIL });
    const token = await emitir(runtime);

    runtime.db.users.get(EMAIL)!.status = "disabled";
    const recusada = await confirmEmailVerification(runtime.deps, { token }, CONTEXTO);
    expect(recusada.ok).toBe(false);
    expect(runtime.logs.at(-1)!.internalReason).toBe("account_ineligible");

    // ROLLBACK: o consumo foi desfeito e o carimbo nao foi gravado.
    expect([...runtime.db.tokens.values()][0]!.consumedAt).toBeNull();
    expect(runtime.db.users.get(EMAIL)!.emailVerifiedAt).toBeNull();

    // Reabilitada, o MESMO link conclui — prova de que o rollback preservou o
    // token de verdade, e nao apenas de que nada aconteceu.
    runtime.db.users.get(EMAIL)!.status = "active";
    expect((await confirmEmailVerification(runtime.deps, { token }, CONTEXTO)).ok).toBe(true);
    expect(runtime.db.users.get(EMAIL)!.emailVerifiedAt).not.toBeNull();
  });

  it("(21) o carimbo ORIGINAL e preservado quando ja havia verificacao", async () => {
    const runtime = createTestRuntime();
    const original = new Date("2026-01-01T00:00:00.000Z");
    seedUser(runtime.db, { emailNormalized: EMAIL });
    const token = await emitir(runtime);
    runtime.db.users.get(EMAIL)!.emailVerifiedAt = original;

    const result = await confirmEmailVerification(runtime.deps, { token }, CONTEXTO);
    expect(result.ok).toBe(true);
    expect(runtime.logs.at(-1)!.internalReason).toBe("already_verified");
    expect(runtime.db.users.get(EMAIL)!.emailVerifiedAt).toEqual(original);
  });
});

// ===========================================================================
// CONFIRMACAO de recuperacao
// ===========================================================================

describe("confirmacao de recuperacao de senha", () => {
  const NOVA_SENHA = "senha-nova-suficientemente-longa";

  async function emitirReset(runtime: TestRuntime): Promise<string> {
    await requestPasswordRecovery(runtime.deps, { emailNormalized: EMAIL }, CONTEXTO);
    await runtime.flush();
    return tokenFromSentEmail(runtime.emails.sent[0]!);
  }

  it("(22) troca a senha, revoga TODAS as sessoes e queima os resets pendentes", async () => {
    const runtime = createTestRuntime();
    const userId = seedUser(runtime.db, {
      emailNormalized: EMAIL,
      passwordHash: "scrypt$N=2,r=1,p=1$0011$antigo",
    });
    // Duas sessoes vivas e um segundo link de reset pendente.
    runtime.db.sessions.set("s1", {
      id: 900n,
      userId,
      expiresAt: new Date(runtime.clock.now.getTime() + 3_600_000),
      revokedAt: null,
    });
    runtime.db.sessions.set("s2", {
      id: 901n,
      userId,
      expiresAt: new Date(runtime.clock.now.getTime() + 3_600_000),
      revokedAt: null,
    });
    const token = await emitirReset(runtime);
    await requestPasswordRecovery(runtime.deps, { emailNormalized: EMAIL }, CONTEXTO);
    await runtime.flush();
    expect(runtime.db.tokens.size).toBe(2);

    const result = await confirmPasswordRecovery(
      runtime.deps,
      { token, newPassword: NOVA_SENHA },
      CONTEXTO,
    );
    expect(result.ok).toBe(true);

    // Senha trocada (hash novo, derivado da nova senha).
    const credencial = runtime.db.credentials.get(String(userId))!;
    expect(credencial.passwordHash).toContain(
      Buffer.from(NOVA_SENHA, "utf8").toString("hex"),
    );
    expect(credencial.algorithm).toBe("scrypt");
    // Todas as sessoes revogadas.
    for (const sessao of runtime.db.sessions.values()) {
      expect(sessao.revokedAt).not.toBeNull();
    }
    // Nenhum token de reset pendente sobrou.
    for (const t of runtime.db.tokens.values()) {
      expect(t.consumedAt).not.toBeNull();
    }
  });

  it("(23) USO UNICO: o mesmo token nao troca a senha duas vezes", async () => {
    const runtime = createTestRuntime();
    seedUser(runtime.db, { emailNormalized: EMAIL });
    const token = await emitirReset(runtime);

    expect(
      (await confirmPasswordRecovery(runtime.deps, { token, newPassword: NOVA_SENHA }, CONTEXTO)).ok,
    ).toBe(true);
    const segunda = await confirmPasswordRecovery(
      runtime.deps,
      { token, newPassword: "outra-senha-bem-longa-aqui" },
      CONTEXTO,
    );
    expect(segunda.ok).toBe(false);
    if (!segunda.ok) expect(segunda.error.message).toBe(GENERIC_TOKEN_FAILURE_MESSAGE);
  });

  it("(24) token de VERIFICACAO nao redefine senha", async () => {
    const runtime = createTestRuntime();
    const userId = seedUser(runtime.db, {
      emailNormalized: EMAIL,
      passwordHash: "scrypt$N=2,r=1,p=1$0011$antigo",
    });
    await requestEmailVerification(runtime.deps, { emailNormalized: EMAIL }, CONTEXTO);
    await runtime.flush();
    const tokenDeVerificacao = tokenFromSentEmail(runtime.emails.sent[0]!);

    const result = await confirmPasswordRecovery(
      runtime.deps,
      { token: tokenDeVerificacao, newPassword: NOVA_SENHA },
      CONTEXTO,
    );
    expect(result.ok).toBe(false);
    expect(runtime.logs.at(-1)!.internalReason).toBe("wrong_purpose");
    // Senha intacta e token de verificacao ainda pendente.
    expect(runtime.db.credentials.get(String(userId))!.passwordHash).toBe(
      "scrypt$N=2,r=1,p=1$0011$antigo",
    );
    expect([...runtime.db.tokens.values()][0]!.consumedAt).toBeNull();
  });

  it("(25) token EXPIRADO nao troca a senha", async () => {
    const runtime = createTestRuntime({ passwordResetExpirationMinutes: 30 });
    const userId = seedUser(runtime.db, {
      emailNormalized: EMAIL,
      passwordHash: "scrypt$N=2,r=1,p=1$0011$antigo",
    });
    const token = await emitirReset(runtime);
    runtime.clock.advanceMinutes(30);

    const result = await confirmPasswordRecovery(
      runtime.deps,
      { token, newPassword: NOVA_SENHA },
      CONTEXTO,
    );
    expect(result.ok).toBe(false);
    expect(runtime.db.credentials.get(String(userId))!.passwordHash).toBe(
      "scrypt$N=2,r=1,p=1$0011$antigo",
    );
  });

  it("(26) conta desativada DEPOIS da emissao: ROLLBACK completo", async () => {
    const runtime = createTestRuntime();
    const userId = seedUser(runtime.db, {
      emailNormalized: EMAIL,
      passwordHash: "scrypt$N=2,r=1,p=1$0011$antigo",
    });
    const token = await emitirReset(runtime);
    runtime.db.users.get(EMAIL)!.status = "disabled";

    const result = await confirmPasswordRecovery(
      runtime.deps,
      { token, newPassword: NOVA_SENHA },
      CONTEXTO,
    );
    expect(result.ok).toBe(false);
    expect(runtime.logs.at(-1)!.internalReason).toBe("account_ineligible");
    // Nada aplicado: senha intacta e token ainda pendente.
    expect(runtime.db.credentials.get(String(userId))!.passwordHash).toBe(
      "scrypt$N=2,r=1,p=1$0011$antigo",
    );
    expect([...runtime.db.tokens.values()][0]!.consumedAt).toBeNull();
  });

  it("(27) conta SEM credencial de senha: recusa e preserva o token", async () => {
    const runtime = createTestRuntime();
    seedUser(runtime.db, { emailNormalized: EMAIL, passwordHash: null });
    const token = await emitirReset(runtime);

    const result = await confirmPasswordRecovery(
      runtime.deps,
      { token, newPassword: NOVA_SENHA },
      CONTEXTO,
    );
    expect(result.ok).toBe(false);
    expect(runtime.logs.at(-1)!.internalReason).toBe("credential_not_found");
    expect([...runtime.db.tokens.values()][0]!.consumedAt).toBeNull();
  });

  it("(28) nenhuma recusa devolve mensagem distinguivel", async () => {
    const runtime = createTestRuntime();
    seedUser(runtime.db, { emailNormalized: EMAIL });
    const mensagens = new Set<string>();
    for (const token of ["z".repeat(64), "y".repeat(64)]) {
      const r = await confirmPasswordRecovery(runtime.deps, { token, newPassword: NOVA_SENHA }, SEM_ORIGEM);
      if (!r.ok) mensagens.add(`${r.error.code}|${r.error.message}`);
    }
    expect(mensagens.size).toBe(1);
    expect([...mensagens][0]).toBe(`unauthorized|${GENERIC_TOKEN_FAILURE_MESSAGE}`);
  });
});

// ===========================================================================
// Observabilidade
// ===========================================================================

describe("observabilidade redigida", () => {
  it("(29) nenhum evento carrega e-mail, token, hash, senha, URL ou IP", async () => {
    const runtime = createTestRuntime();
    seedUser(runtime.db, { emailNormalized: EMAIL, passwordHash: "scrypt$N=2,r=1,p=1$0011$x" });
    await requestPasswordRecovery(runtime.deps, { emailNormalized: EMAIL }, CONTEXTO);
    await runtime.flush();
    const token = tokenFromSentEmail(runtime.emails.sent[0]!);
    await confirmPasswordRecovery(
      runtime.deps,
      { token, newPassword: "senha-nova-suficientemente-longa" },
      CONTEXTO,
    );

    expect(runtime.logs.length).toBeGreaterThan(1);
    const serializado = JSON.stringify(runtime.logs);
    expect(serializado).not.toContain(EMAIL);
    expect(serializado).not.toContain(token);
    expect(serializado).not.toContain(sha256Hex(token));
    expect(serializado).not.toContain("senha-nova");
    expect(serializado).not.toContain("cinerie.com/pt/");
    expect(serializado).not.toContain(CONTEXTO.clientIpHash);

    // E o que DEVE estar la, esta.
    for (const evento of runtime.logs) {
      expect(evento.correlationId).toBe(CONTEXTO.correlationId);
      expect(Object.keys(evento).sort()).toEqual([
        "correlationId",
        "durationMs",
        "failureCategory",
        "internalReason",
        "outcome",
        "providerMessageId",
        "provider",
        "purpose",
      ].sort());
    }
  });

  it("(30) um coletor que LANCA nao derruba o fluxo (nem vira sinal observavel)", async () => {
    const runtime = createTestRuntime();
    seedUser(runtime.db, { emailNormalized: EMAIL });
    const deps = {
      ...runtime.deps,
      logger: () => {
        throw new Error("coletor quebrado");
      },
    };
    expect(
      await requestPasswordRecovery(deps, { emailNormalized: EMAIL }, CONTEXTO),
    ).toEqual(ACEITE_GENERICO);
    await runtime.flush();
  });
});

// ===========================================================================
// A resposta NAO espera o fornecedor (anti-enumeracao por TEMPO)
// ===========================================================================

/**
 * Provedor que so conclui quando o teste mandar.
 *
 * E a unica forma honesta de provar a propriedade: um provedor que resolve na
 * hora nao distingue "a resposta esperou o envio" de "a resposta nao esperou".
 * Com o envio TRAVADO, um servico que aguardasse a entrega nunca resolveria.
 */
function provedorTravado(): {
  readonly emails: ReturnType<typeof createFakeEmailProvider>;
  liberar(): void;
} {
  const real = createFakeEmailProvider();
  let destravar: () => void = () => undefined;
  const portao = new Promise<void>((resolve) => {
    destravar = resolve;
  });
  const emails = {
    get sent() {
      return real.sent;
    },
    sendEmailVerification: async (dispatch: Parameters<typeof real.sendEmailVerification>[0]) => {
      await portao;
      return real.sendEmailVerification(dispatch);
    },
    sendPasswordReset: async (dispatch: Parameters<typeof real.sendPasswordReset>[0]) => {
      await portao;
      return real.sendPasswordReset(dispatch);
    },
  } as ReturnType<typeof createFakeEmailProvider>;
  return { emails, liberar: () => destravar() };
}

describe("o tempo de resposta nao denuncia a existencia da conta", () => {
  it("(31) a recuperacao responde com o envio ainda EM CURSO", async () => {
    // Se a resposta esperasse o envio, uma conta real responderia depois de uma
    // ida e volta ao fornecedor (ate 8 s quando ele esta degradado) e uma conta
    // inexistente responderia em milissegundos — um oraculo muito mais nitido do
    // que qualquer diferenca de status, corpo ou cabecalho.
    const { emails, liberar } = provedorTravado();
    const runtime = createTestRuntime({ emails });
    seedUser(runtime.db, { emailNormalized: EMAIL });

    // Sem `liberar()`, um servico que aguardasse a entrega NUNCA resolveria.
    const dto = await requestPasswordRecovery(
      runtime.deps,
      { emailNormalized: EMAIL },
      CONTEXTO,
    );
    expect(dto).toEqual(ACEITE_GENERICO);
    // O envio ainda nao concluiu: nada foi registrado.
    expect(runtime.emails.sent).toHaveLength(0);
    expect(runtime.logs).toHaveLength(0);

    liberar();
    await runtime.flush();
    expect(runtime.emails.sent).toHaveLength(1);
    expect(runtime.logs).toHaveLength(1);
    expect(runtime.logs[0]!.outcome).toBe("sent");
  });

  it("(32) a verificacao tambem responde com o envio EM CURSO", async () => {
    const { emails, liberar } = provedorTravado();
    const runtime = createTestRuntime({ emails });
    seedUser(runtime.db, { emailNormalized: EMAIL });

    const dto = await requestEmailVerification(
      runtime.deps,
      { emailNormalized: EMAIL },
      CONTEXTO,
    );
    expect(dto).toEqual(ACEITE_GENERICO);
    expect(runtime.emails.sent).toHaveLength(0);

    liberar();
    await runtime.flush();
    expect(runtime.emails.sent).toHaveLength(1);
  });

  it("(33) conta INEXISTENTE percorre o mesmo caminho de agendamento", async () => {
    // O ramo sem entrega tambem passa por `scheduleDelivery` (para registrar o
    // motivo interno). Se ele respondesse por um caminho mais curto, a diferenca
    // de trabalho voltaria a ser observavel.
    const runtime = createTestRuntime();
    const dto = await requestPasswordRecovery(
      runtime.deps,
      { emailNormalized: "ninguem@example.test" },
      CONTEXTO,
    );
    expect(dto).toEqual(ACEITE_GENERICO);
    await runtime.flush();
    expect(runtime.emails.sent).toHaveLength(0);
    expect(runtime.logs[0]!.outcome).toBe("not_applicable");
  });
});
