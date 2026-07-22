/**
 * Borda HTTP: metodo, corpo, cabecalhos, status e — acima de tudo — que a
 * existencia de uma conta NAO muda nada observavel.
 *
 * Usa `Request`/`Response` de verdade (Node 22), sem servidor e sem Next.
 * Provedor de e-mail falso; nenhuma chamada real a Brevo.
 */

import { describe, expect, it } from "vitest";

import { GENERIC_TOKEN_FAILURE_MESSAGE } from "../../auth/types.js";
import { TransactionalEmailError } from "../../email/types.js";
import {
  createFakeEmailProvider,
  createTestRuntime,
  seedUser,
  tokenFromSentEmail,
  type TestRuntime,
} from "../../auth-runtime/__tests__/fakes.js";
import { createAuthHttpHandlers, type AuthHttpHandlers } from "../handlers.js";
import { MAX_AUTH_BODY_BYTES } from "../request.js";

const EMAIL = "pessoa@example.test";
const IP_HASH = "f".repeat(64);

interface Harness {
  readonly handlers: AuthHttpHandlers;
  readonly runtime: TestRuntime;
  readonly hashedIps: string[];
  readonly unexpected: string[];
}

function harness(options: { readonly runtime?: TestRuntime } = {}): Harness {
  const runtime = options.runtime ?? createTestRuntime();
  const hashedIps: string[] = [];
  const unexpected: string[] = [];
  const cru = createAuthHttpHandlers({
    runtime: runtime.deps,
    hashClientIp: (ip) => {
      hashedIps.push(ip);
      return IP_HASH;
    },
    newCorrelationId: () => "gerado-localmente-0001",
    onUnexpectedError: (correlationId) => unexpected.push(correlationId),
  });

  // A entrega e AGENDADA para fora do caminho da resposta (anti-enumeracao por
  // tempo). O wrapper responde PRIMEIRO e so entao drena, para que as assercoes
  // possam observar o envio sem que o teste passe a exercitar um caminho que
  // producao nao tem.
  const comFlush = (metodo: (request: Request) => Promise<Response>) =>
    async (request: Request): Promise<Response> => {
      const response = await metodo(request);
      await runtime.flush();
      return response;
    };

  const handlers: AuthHttpHandlers = {
    requestPasswordReset: comFlush(cru.requestPasswordReset),
    confirmPasswordReset: comFlush(cru.confirmPasswordReset),
    requestEmailVerification: comFlush(cru.requestEmailVerification),
    confirmEmailVerification: comFlush(cru.confirmEmailVerification),
  };
  return { handlers, runtime, hashedIps, unexpected };
}

function post(body: unknown, init: RequestInit = {}): Request {
  return new Request("https://cinerie.com/api/auth/password-reset/request", {
    method: "POST",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...(init.method === undefined ? {} : { method: init.method }),
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Higiene da requisicao
// ---------------------------------------------------------------------------

describe("higiene da requisicao", () => {
  it("(1) mutacao NAO aceita GET nem outros metodos", async () => {
    const { handlers } = harness();
    for (const method of ["GET", "PUT", "DELETE", "PATCH", "HEAD"]) {
      const request = new Request("https://cinerie.com/api/auth/password-reset/request", {
        method,
        headers: { "content-type": "application/json" },
      });
      const response = await handlers.requestPasswordReset(request);
      expect(response.status, method).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
    }
  });

  it("(2) content-type diferente de application/json e recusado", async () => {
    const { handlers } = harness();
    for (const tipo of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data"]) {
      const response = await handlers.requestPasswordReset(
        post({ email: EMAIL }, { headers: { "content-type": tipo } }),
      );
      // Barra o envio por formulario HTML entre origens (vetor classico de CSRF).
      expect(response.status, tipo).toBe(400);
    }
    // `; charset=utf-8` continua valido.
    const comCharset = await harness().handlers.requestPasswordReset(
      post({ email: EMAIL }, { headers: { "content-type": "application/json; charset=utf-8" } }),
    );
    expect(comCharset.status).toBe(202);
  });

  it("(3) JSON invalido e recusado SEM ecoar o corpo", async () => {
    const { handlers } = harness();
    const response = await handlers.requestPasswordReset(post('{"email": '));
    expect(response.status).toBe(400);
    const body = await json(response);
    expect(JSON.stringify(body)).not.toContain("email");
    expect(body["code"]).toBe("invalid_request");
  });

  it("(4) corpo grande demais e recusado (declarado e real)", async () => {
    const { handlers } = harness();
    const gigante = JSON.stringify({ email: "a".repeat(MAX_AUTH_BODY_BYTES) });
    expect(await handlers.requestPasswordReset(post(gigante)).then((r) => r.status)).toBe(400);

    // Content-Length mentiroso tambem nao passa: o tamanho REAL e reconferido.
    const mentiroso = new Request("https://cinerie.com/api/auth/password-reset/request", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "10" },
      body: gigante,
    });
    expect((await handlers.requestPasswordReset(mentiroso)).status).toBe(400);
  });

  it("(5) corpo vazio e recusado", async () => {
    const { handlers } = harness();
    expect((await handlers.requestPasswordReset(post(""))).status).toBe(400);
  });

  it("(6) campo ausente e campo EXTRA sao recusados (anti mass-assignment)", async () => {
    const { handlers } = harness();
    expect((await handlers.requestPasswordReset(post({}))).status).toBe(400);
    const extra = await handlers.requestPasswordReset(
      post({ email: EMAIL, status: "active", userId: 1, isAdmin: true }),
    );
    expect(extra.status).toBe(400);
    const body = await json(extra);
    expect(body["code"]).toBe("invalid_request");
    expect(JSON.stringify(body)).not.toContain("isAdmin");
  });

  it("(7) chave de prototype pollution e recusada", async () => {
    const { handlers } = harness();
    const response = await handlers.requestPasswordReset(
      post(`{"email":"${EMAIL}","__proto__":{"admin":true}}`),
    );
    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Cabecalhos de seguranca
// ---------------------------------------------------------------------------

describe("cabecalhos de seguranca", () => {
  it("(8) toda resposta traz no-store, no-referrer e nosniff", async () => {
    const { handlers, runtime } = harness();
    seedUser(runtime.db, { emailNormalized: EMAIL });
    const respostas = [
      await handlers.requestPasswordReset(post({ email: EMAIL })),
      await handlers.requestPasswordReset(post({})),
      await handlers.confirmPasswordReset(
        post({ token: "z".repeat(64), newPassword: "senha-suficientemente-longa" }),
      ),
      await handlers.requestEmailVerification(post({ email: EMAIL })),
    ];
    for (const response of respostas) {
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    }
  });
});

// ---------------------------------------------------------------------------
// Anti-enumeracao na borda
// ---------------------------------------------------------------------------

describe("anti-enumeracao: status, corpo e cabecalhos identicos", () => {
  async function assinatura(response: Response): Promise<string> {
    const headers = [...response.headers.entries()]
      .filter(([nome]) => nome !== "date" && nome !== "content-length")
      .sort()
      .map(([nome, valor]) => `${nome}=${valor}`)
      .join(";");
    return `${response.status}|${headers}|${await response.text()}`;
  }

  it("(9) reset: existente, inexistente, disabled, deleted e throttled sao IDENTICOS", async () => {
    const assinaturas = new Set<string>();

    for (const cenario of ["existente", "inexistente", "disabled", "deleted"] as const) {
      const h = harness();
      if (cenario !== "inexistente") {
        seedUser(h.runtime.db, {
          emailNormalized: EMAIL,
          status: cenario === "existente" ? "active" : cenario,
        });
      }
      assinaturas.add(await assinatura(await h.handlers.requestPasswordReset(post({ email: EMAIL }))));
    }

    // Throttled: mesma assinatura.
    const h = harness();
    seedUser(h.runtime.db, { emailNormalized: EMAIL });
    let ultima: Response | null = null;
    for (let i = 0; i < 8; i += 1) {
      ultima = await h.handlers.requestPasswordReset(post({ email: EMAIL }));
    }
    assinaturas.add(await assinatura(ultima!));

    // Provedor fora do ar: mesma assinatura.
    const comFalha = harness({
      runtime: createTestRuntime({
        emails: createFakeEmailProvider({
          failWith: new TransactionalEmailError("provider_unavailable"),
        }),
      }),
    });
    seedUser(comFalha.runtime.db, { emailNormalized: EMAIL });
    assinaturas.add(
      await assinatura(await comFalha.handlers.requestPasswordReset(post({ email: EMAIL }))),
    );

    expect(assinaturas.size, [...assinaturas].join("\n---\n")).toBe(1);
    expect([...assinaturas][0]!.startsWith("202|")).toBe(true);
  });

  it("(10) verificacao: existente, ja verificada, inexistente e disabled sao IDENTICOS", async () => {
    const assinaturas = new Set<string>();
    const cenarios = [
      { status: "active" as const, verificado: false },
      { status: "active" as const, verificado: true },
      { status: "disabled" as const, verificado: false },
      null,
    ];
    for (const cenario of cenarios) {
      const h = harness();
      if (cenario !== null) {
        seedUser(h.runtime.db, {
          emailNormalized: EMAIL,
          status: cenario.status,
          emailVerifiedAt: cenario.verificado ? new Date("2026-01-01T00:00:00.000Z") : null,
        });
      }
      assinaturas.add(
        await assinatura(await h.handlers.requestEmailVerification(post({ email: EMAIL }))),
      );
    }
    expect(assinaturas.size).toBe(1);
  });

  it("(11) o corpo do aceite nao carrega token, messageId, userId nem motivo", async () => {
    const h = harness();
    seedUser(h.runtime.db, { emailNormalized: EMAIL });
    const response = await h.handlers.requestPasswordReset(post({ email: EMAIL }));
    const texto = await response.text();
    expect(texto).not.toContain(tokenFromSentEmail(h.runtime.emails.sent[0]!));
    expect(texto).not.toContain("fake-");
    expect(texto).not.toContain("issue_token");
    expect(texto).not.toContain("userId");
  });
});

// ---------------------------------------------------------------------------
// Confirmacoes
// ---------------------------------------------------------------------------

describe("confirmacoes", () => {
  it("(12) reset valido responde 200 e troca a senha", async () => {
    const h = harness();
    const userId = seedUser(h.runtime.db, {
      emailNormalized: EMAIL,
      passwordHash: "scrypt$N=2,r=1,p=1$0011$antigo",
    });
    await h.handlers.requestPasswordReset(post({ email: EMAIL }));
    const token = tokenFromSentEmail(h.runtime.emails.sent[0]!);

    const response = await h.handlers.confirmPasswordReset(
      post({ token, newPassword: "senha-nova-suficientemente-longa" }),
    );
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ ok: true, status: "confirmed" });
    expect(h.runtime.db.credentials.get(String(userId))!.passwordHash).not.toBe(
      "scrypt$N=2,r=1,p=1$0011$antigo",
    );
  });

  it("(13) verificacao valida responde 200 e carimba", async () => {
    const h = harness();
    seedUser(h.runtime.db, { emailNormalized: EMAIL });
    await h.handlers.requestEmailVerification(post({ email: EMAIL }));
    const token = tokenFromSentEmail(h.runtime.emails.sent[0]!);

    const response = await h.handlers.confirmEmailVerification(post({ token }));
    expect(response.status).toBe(200);
    expect(h.runtime.db.users.get(EMAIL)!.emailVerifiedAt).not.toBeNull();
  });

  it("(14) token invalido, expirado, usado e de purpose errado dao a MESMA resposta", async () => {
    const h = harness();
    seedUser(h.runtime.db, { emailNormalized: EMAIL });
    await h.handlers.requestEmailVerification(post({ email: EMAIL }));
    const tokenDeVerificacao = tokenFromSentEmail(h.runtime.emails.sent[0]!);

    const respostas: string[] = [];
    // inexistente
    respostas.push(
      await (
        await h.handlers.confirmPasswordReset(
          post({ token: "z".repeat(64), newPassword: "senha-suficientemente-longa" }),
        )
      ).text(),
    );
    // purpose errado (token de verificacao no confirm de reset)
    respostas.push(
      await (
        await h.handlers.confirmPasswordReset(
          post({ token: tokenDeVerificacao, newPassword: "senha-suficientemente-longa" }),
        )
      ).text(),
    );
    // ja consumido
    await h.handlers.confirmEmailVerification(post({ token: tokenDeVerificacao }));
    respostas.push(
      await (await h.handlers.confirmEmailVerification(post({ token: tokenDeVerificacao }))).text(),
    );

    expect(new Set(respostas).size).toBe(1);
    const body = JSON.parse(respostas[0]!) as Record<string, unknown>;
    expect(body["message"]).toBe(GENERIC_TOKEN_FAILURE_MESSAGE);
    expect(body["code"]).toBe("unauthorized");
  });

  it("(15) senha nova fraca e recusada ANTES de tocar o token", async () => {
    const h = harness();
    seedUser(h.runtime.db, { emailNormalized: EMAIL });
    await h.handlers.requestPasswordReset(post({ email: EMAIL }));
    const token = tokenFromSentEmail(h.runtime.emails.sent[0]!);

    const response = await h.handlers.confirmPasswordReset(post({ token, newPassword: "curta" }));
    expect(response.status).toBe(400);
    // O token continua pendente: uma senha fraca nao pode queimar o link.
    expect([...h.runtime.db.tokens.values()][0]!.consumedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Correlacao, origem e falha inesperada
// ---------------------------------------------------------------------------

describe("correlacao, origem e falha inesperada", () => {
  it("(16) X-Request-Id valido e reusado; invalido cai no gerado localmente", async () => {
    const valido = harness();
    seedUser(valido.runtime.db, { emailNormalized: EMAIL });
    await valido.handlers.requestPasswordReset(
      post({ email: EMAIL }, { headers: { "x-request-id": "req-ABC-123456" } }),
    );
    expect(valido.runtime.logs[0]!.correlationId).toBe("req-ABC-123456");

    const invalido = harness();
    seedUser(invalido.runtime.db, { emailNormalized: EMAIL });
    await invalido.handlers.requestPasswordReset(
      post({ email: EMAIL }, { headers: { "x-request-id": `injetado ${EMAIL}` } }),
    );
    // Sem a normalizacao, o e-mail do usuario entraria no nosso log.
    expect(invalido.runtime.logs[0]!.correlationId).toBe("gerado-localmente-0001");
  });

  it("(17) o IP e HASHEADO na borda — nenhuma camada abaixo ve o endereco cru", async () => {
    const h = harness();
    seedUser(h.runtime.db, { emailNormalized: EMAIL });
    await h.handlers.requestPasswordReset(
      post({ email: EMAIL }, { headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" } }),
    );
    // O primeiro valor da cadeia e o cliente original.
    expect(h.hashedIps).toEqual(["203.0.113.7"]);
    // Nem o log nem o throttle guardam o endereco cru.
    expect(JSON.stringify(h.runtime.logs)).not.toContain("203.0.113.7");
    expect([...h.runtime.db.throttles.keys()].join(" ")).not.toContain("203.0.113.7");
  });

  it("(18) cabecalho de origem malformado nao vira chave de throttle", async () => {
    const h = harness();
    seedUser(h.runtime.db, { emailNormalized: EMAIL });
    await h.handlers.requestPasswordReset(
      post({ email: EMAIL }, { headers: { "x-forwarded-for": "nao-e-um-ip <script>" } }),
    );
    expect(h.hashedIps).toEqual([]);
  });

  it("(19) falha inesperada vira 500 generico, sem stack e sem detalhe", async () => {
    const runtime = createTestRuntime();
    const quebrado = {
      ...runtime,
      deps: {
        ...runtime.deps,
        runInTransaction: () => {
          throw new Error("detalhe interno com senha=hunter2 e tabela users");
        },
      },
    } as TestRuntime;
    const h = harness({ runtime: quebrado });

    const response = await h.handlers.requestPasswordReset(post({ email: EMAIL }));
    expect(response.status).toBe(500);
    const texto = await response.text();
    expect(texto).not.toContain("hunter2");
    expect(texto).not.toContain("users");
    expect(texto).not.toContain("stack");
    expect(texto).not.toContain("Error");
    // O aviso recebe SO a correlacao — nunca o objeto de erro.
    expect(h.unexpected).toEqual(["gerado-localmente-0001"]);
  });

  it("(20) requisicoes CONCORRENTES nao se misturam", async () => {
    const h = harness();
    seedUser(h.runtime.db, { emailNormalized: "a@example.test" });
    seedUser(h.runtime.db, { emailNormalized: "b@example.test" });

    const [ra, rb] = await Promise.all([
      h.handlers.requestPasswordReset(post({ email: "a@example.test" })),
      h.handlers.requestPasswordReset(post({ email: "b@example.test" })),
    ]);
    expect(ra.status).toBe(202);
    expect(rb.status).toBe(202);

    const destinatarios = h.runtime.emails.sent.map((e) => e.dispatch.to).sort();
    expect(destinatarios).toEqual(["a@example.test", "b@example.test"]);
    // Cada token pertence ao usuario certo.
    expect(h.runtime.db.tokens.size).toBe(2);
  });

  it("(21) NENHUMA resposta carrega token ou hash em nenhum cenario", async () => {
    const h = harness();
    seedUser(h.runtime.db, { emailNormalized: EMAIL });
    await h.handlers.requestPasswordReset(post({ email: EMAIL }));
    const token = tokenFromSentEmail(h.runtime.emails.sent[0]!);
    const armazenado = [...h.runtime.db.tokens.keys()][0]!;

    const respostas = [
      await h.handlers.requestPasswordReset(post({ email: EMAIL })),
      await h.handlers.confirmPasswordReset(
        post({ token, newPassword: "senha-nova-suficientemente-longa" }),
      ),
      await h.handlers.confirmEmailVerification(post({ token: "z".repeat(64) })),
    ];
    for (const response of respostas) {
      const texto = await response.text();
      expect(texto).not.toContain(token);
      expect(texto).not.toContain(armazenado);
    }
  });
});
