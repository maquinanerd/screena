/**
 * Adapter Brevo — o contrato de fio, verificado contra um SERVIDOR HTTP LOCAL.
 *
 * O servidor de verdade (node:http) prova o que um mock de `fetch` nao prova:
 * que o metodo, o caminho, os cabecalhos e o corpo chegam do outro lado como
 * escritos. Os casos de erro usam `fetch` controlado, porque forjar um 429 ou um
 * JSON invalido pelo servidor real so acrescentaria cerimonia.
 *
 * NENHUM teste aqui fala com a Brevo de verdade: o endpoint e reescrito para o
 * servidor local. A suite roda offline.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { isTransactionalEmailError, TransactionalEmailError } from "../../../email/types.js";
import {
  BREVO_TRANSACTIONAL_EMAIL_ENDPOINT,
  categorizeBrevoStatus,
  createBrevoTransactionalEmailProvider,
  readBrevoMessageId,
  type FetchLike,
} from "../transactional-email.js";

const CONFIG = {
  apiKey: "xkeysib-CHAVE-FICTICIA-DE-TESTE",
  senderName: "Cinerie",
  senderEmail: "conta@cinerie.com",
  replyToEmail: null,
} as const;

const DISPATCH = {
  to: "pessoa@example.test",
  actionUrl: "https://cinerie.com/pt/redefinir-senha/?token=" + "a".repeat(64),
  expiresInMinutes: 30,
} as const;

const MESSAGE_ID = "<201798300811.5787683@relay.domain.com>";

// ---------------------------------------------------------------------------
// 1. Contrato de fio contra servidor HTTP local
// ---------------------------------------------------------------------------

interface CapturedRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

describe("contrato de fio (servidor HTTP local)", () => {
  let server: Server;
  let origin: string;
  const captured: CapturedRequest[] = [];

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        captured.push({
          method: req.method ?? "",
          url: req.url ?? "",
          headers: req.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ messageId: MESSAGE_ID }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    origin = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** Reescreve so o ORIGEM: o caminho continua o do adapter, e e o que provamos. */
  function localFetch(): FetchLike {
    return (url, init) => {
      const rewritten = new URL(url);
      return fetch(`${origin}${rewritten.pathname}`, init);
    };
  }

  it("(1) usa POST em /v3/smtp/email com accept, content-type e api-key", async () => {
    captured.length = 0;
    const provider = createBrevoTransactionalEmailProvider({
      ...CONFIG,
      fetchImpl: localFetch(),
    });
    const receipt = await provider.sendPasswordReset(DISPATCH);

    expect(receipt.providerMessageId).toBe(MESSAGE_ID);
    expect(captured).toHaveLength(1);
    const req = captured[0]!;
    expect(req.method).toBe("POST");
    expect(req.url).toBe("/v3/smtp/email");
    expect(req.headers["api-key"]).toBe(CONFIG.apiKey);
    expect(req.headers["content-type"]).toBe("application/json");
    expect(req.headers["accept"]).toBe("application/json");
  });

  it("(2) o corpo tem remetente, destinatario, assunto, HTML e texto", async () => {
    captured.length = 0;
    const provider = createBrevoTransactionalEmailProvider({
      ...CONFIG,
      fetchImpl: localFetch(),
    });
    await provider.sendPasswordReset(DISPATCH);

    const payload = JSON.parse(captured[0]!.body) as Record<string, unknown>;
    expect(payload["sender"]).toEqual({ name: "Cinerie", email: "conta@cinerie.com" });
    expect(payload["to"]).toEqual([{ email: DISPATCH.to }]);
    expect(payload["subject"]).toBe("Redefina sua senha da Cinerie");
    expect(String(payload["htmlContent"])).toContain(DISPATCH.actionUrl);
    expect(String(payload["textContent"])).toContain(DISPATCH.actionUrl);
  });

  it("(3) a verificacao usa o assunto e o template de verificacao", async () => {
    captured.length = 0;
    const provider = createBrevoTransactionalEmailProvider({
      ...CONFIG,
      fetchImpl: localFetch(),
    });
    await provider.sendEmailVerification({ ...DISPATCH, expiresInMinutes: 1440 });

    const payload = JSON.parse(captured[0]!.body) as Record<string, unknown>;
    expect(payload["subject"]).toBe("Confirme seu e-mail na Cinerie");
    expect(String(payload["htmlContent"])).toContain("Confirmar meu e-mail");
    expect(String(payload["htmlContent"])).toContain("24 horas");
  });

  it("(4) replyTo so aparece quando configurado", async () => {
    captured.length = 0;
    const semReply = createBrevoTransactionalEmailProvider({
      ...CONFIG,
      fetchImpl: localFetch(),
    });
    await semReply.sendPasswordReset(DISPATCH);
    expect(JSON.parse(captured[0]!.body)).not.toHaveProperty("replyTo");

    captured.length = 0;
    const comReply = createBrevoTransactionalEmailProvider({
      ...CONFIG,
      replyToEmail: "suporte@cinerie.com",
      fetchImpl: localFetch(),
    });
    await comReply.sendPasswordReset(DISPATCH);
    expect(JSON.parse(captured[0]!.body)).toHaveProperty("replyTo", {
      email: "suporte@cinerie.com",
    });
  });

  it("(5) a chave NUNCA entra no corpo (so no cabecalho)", async () => {
    captured.length = 0;
    const provider = createBrevoTransactionalEmailProvider({
      ...CONFIG,
      fetchImpl: localFetch(),
    });
    await provider.sendPasswordReset(DISPATCH);
    expect(captured[0]!.body).not.toContain(CONFIG.apiKey);
    expect(captured[0]!.body).not.toContain("api-key");
    expect(captured[0]!.body).not.toContain("apiKey");
  });

  it("(6) NAO ha campo de campanha no corpo (controle negativo)", async () => {
    captured.length = 0;
    const provider = createBrevoTransactionalEmailProvider({
      ...CONFIG,
      fetchImpl: localFetch(),
    });
    await provider.sendPasswordReset(DISPATCH);
    const payload = JSON.parse(captured[0]!.body) as Record<string, unknown>;
    for (const proibido of ["listIds", "recipients", "scheduledAt", "type", "templateId", "tags"]) {
      expect(payload).not.toHaveProperty(proibido);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Classificacao de falha (fetch controlado)
// ---------------------------------------------------------------------------

function fetchRespondendo(status: number, body: string, contentType = "application/json"): FetchLike {
  return async () =>
    new Response(body, { status, headers: { "content-type": contentType } });
}

async function categoriaDe(fetchImpl: FetchLike, timeoutMs = 50): Promise<string> {
  const provider = createBrevoTransactionalEmailProvider({ ...CONFIG, fetchImpl, timeoutMs });
  try {
    await provider.sendPasswordReset(DISPATCH);
  } catch (error) {
    expect(isTransactionalEmailError(error)).toBe(true);
    return (error as TransactionalEmailError).category;
  }
  throw new Error("o envio deveria ter falhado");
}

describe("classificacao de falha do fornecedor", () => {
  it("(7) 400 e recusa do fornecedor", async () => {
    expect(await categoriaDe(fetchRespondendo(400, '{"code":"invalid_parameter"}'))).toBe(
      "provider_rejected",
    );
  });

  it("(8) 401 e 403 sao erro de configuracao, sem vazar a chave", async () => {
    for (const status of [401, 403]) {
      const provider = createBrevoTransactionalEmailProvider({
        ...CONFIG,
        fetchImpl: fetchRespondendo(status, '{"message":"Key not found"}'),
      });
      await expect(provider.sendPasswordReset(DISPATCH)).rejects.toMatchObject({
        category: "configuration_error",
      });
      // A mensagem do erro nao carrega a chave nem o corpo do fornecedor.
      await provider.sendPasswordReset(DISPATCH).catch((error: unknown) => {
        const message = (error as Error).message;
        expect(message).not.toContain(CONFIG.apiKey);
        expect(message).not.toContain("Key not found");
        expect(message).not.toContain(DISPATCH.to);
        expect(message).not.toContain(DISPATCH.actionUrl);
      });
    }
  });

  it("(9) 429 e limite de cota", async () => {
    expect(await categoriaDe(fetchRespondendo(429, '{"code":"too_many_requests"}'))).toBe(
      "rate_limited",
    );
  });

  it("(10) 500 e 503 sao indisponibilidade", async () => {
    expect(await categoriaDe(fetchRespondendo(500, "erro", "text/plain"))).toBe(
      "provider_unavailable",
    );
    expect(await categoriaDe(fetchRespondendo(503, "erro", "text/plain"))).toBe(
      "provider_unavailable",
    );
  });

  it("(11) JSON invalido num 201 e resposta malformada", async () => {
    expect(await categoriaDe(fetchRespondendo(201, "isto nao e json"))).toBe(
      "malformed_provider_response",
    );
  });

  it("(12) 201 SEM messageId valido e resposta malformada", async () => {
    for (const body of ['{"messageId":""}', '{"messageId":null}', '{"messageId":123}', "{}", "[]"]) {
      expect(await categoriaDe(fetchRespondendo(201, body)), body).toBe(
        "malformed_provider_response",
      );
    }
  });

  it("(13) 200 (em vez de 201) NAO conta como envio", async () => {
    // O contrato de sucesso e 201. Aceitar qualquer 2xx registraria como enviada
    // uma resposta que nao prova envio nenhum.
    expect(await categoriaDe(fetchRespondendo(200, `{"messageId":"${MESSAGE_ID}"}`))).toBe(
      "malformed_provider_response",
    );
  });

  it("(14) falha de rede e indisponibilidade", async () => {
    const fetchQueFalha: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await categoriaDe(fetchQueFalha)).toBe("provider_unavailable");
  });

  it("(15) estouro de tempo e classificado como timeout e ABORTA a requisicao", async () => {
    let abortado = false;
    const fetchLento: FetchLike = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          abortado = true;
          reject(new Error("aborted"));
        });
      });
    expect(await categoriaDe(fetchLento, 20)).toBe("timeout");
    expect(abortado).toBe(true);
  });

  it("(15b) o teto de tempo cobre tambem a leitura do CORPO", async () => {
    // Limpar o timer assim que os cabecalhos chegam deixaria o corpo sem sinal
    // armado: um `201` seguido de corpo travado prenderia a requisicao para
    // sempre. Aqui os cabecalhos chegam na hora e o corpo so termina se o
    // `abort` o interromper.
    const corpoTravado: FetchLike = async (_url, init) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          init.signal?.addEventListener("abort", () => {
            controller.error(new Error("aborted"));
          });
          // Nunca fecha sozinho: sem abort, `json()` jamais resolve.
        },
      });
      return new Response(stream, {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    };
    expect(await categoriaDe(corpoTravado, 20)).toBe("timeout");
  });

  it("(16) a tabela de status e exaustiva por faixa", () => {
    expect(categorizeBrevoStatus(401)).toBe("configuration_error");
    expect(categorizeBrevoStatus(403)).toBe("configuration_error");
    expect(categorizeBrevoStatus(429)).toBe("rate_limited");
    expect(categorizeBrevoStatus(500)).toBe("provider_unavailable");
    expect(categorizeBrevoStatus(503)).toBe("provider_unavailable");
    expect(categorizeBrevoStatus(200)).toBe("malformed_provider_response");
    expect(categorizeBrevoStatus(204)).toBe("malformed_provider_response");
    expect(categorizeBrevoStatus(400)).toBe("provider_rejected");
    expect(categorizeBrevoStatus(402)).toBe("provider_rejected");
    expect(categorizeBrevoStatus(404)).toBe("provider_rejected");
    expect(categorizeBrevoStatus(422)).toBe("provider_rejected");
  });

  it("(17) readBrevoMessageId valida em runtime (sem cast cego)", () => {
    expect(readBrevoMessageId({ messageId: MESSAGE_ID })).toBe(MESSAGE_ID);
    expect(readBrevoMessageId({ messageId: "   " })).toBeNull();
    expect(readBrevoMessageId({ messageId: 1 })).toBeNull();
    expect(readBrevoMessageId(null)).toBeNull();
    expect(readBrevoMessageId([{ messageId: MESSAGE_ID }])).toBeNull();
    expect(readBrevoMessageId("texto")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Regras estruturais
// ---------------------------------------------------------------------------

describe("regras estruturais do adapter", () => {
  it("(18) NENHUM retry automatico: uma falha => exatamente UMA requisicao", async () => {
    // Repetir sem idempotencia do fornecedor pode enviar dois e-mails: a
    // requisicao pode ter sido aceita antes da falha de rede.
    let chamadas = 0;
    const fetchImpl: FetchLike = async () => {
      chamadas += 1;
      return new Response('{"code":"boom"}', { status: 500 });
    };
    const provider = createBrevoTransactionalEmailProvider({ ...CONFIG, fetchImpl });
    await expect(provider.sendPasswordReset(DISPATCH)).rejects.toBeInstanceOf(
      TransactionalEmailError,
    );
    expect(chamadas).toBe(1);
  });

  it("(19) sucesso tambem faz exatamente UMA requisicao", async () => {
    let chamadas = 0;
    const fetchImpl: FetchLike = async () => {
      chamadas += 1;
      return new Response(`{"messageId":"${MESSAGE_ID}"}`, { status: 201 });
    };
    const provider = createBrevoTransactionalEmailProvider({ ...CONFIG, fetchImpl });
    await provider.sendEmailVerification(DISPATCH);
    expect(chamadas).toBe(1);
  });

  it("(20) o adapter NAO escreve em nenhum canal de log", async () => {
    const espioes = (["log", "info", "warn", "error", "debug"] as const).map((nivel) =>
      vi.spyOn(console, nivel).mockImplementation(() => undefined),
    );
    try {
      const ok = createBrevoTransactionalEmailProvider({
        ...CONFIG,
        fetchImpl: fetchRespondendo(201, `{"messageId":"${MESSAGE_ID}"}`),
      });
      await ok.sendPasswordReset(DISPATCH);

      const falha = createBrevoTransactionalEmailProvider({
        ...CONFIG,
        fetchImpl: fetchRespondendo(401, '{"message":"Key not found"}'),
      });
      await falha.sendPasswordReset(DISPATCH).catch(() => undefined);

      for (const espiao of espioes) {
        expect(espiao).not.toHaveBeenCalled();
      }
    } finally {
      for (const espiao of espioes) espiao.mockRestore();
    }
  });

  it("(21) o endpoint e o TRANSACIONAL — nunca o de campanha", () => {
    expect(BREVO_TRANSACTIONAL_EMAIL_ENDPOINT).toBe("https://api.brevo.com/v3/smtp/email");
    expect(BREVO_TRANSACTIONAL_EMAIL_ENDPOINT).not.toContain("emailCampaigns");
    expect(new URL(BREVO_TRANSACTIONAL_EMAIL_ENDPOINT).protocol).toBe("https:");
  });

  it("(22) o resultado carrega SO o recibo — nada da resposta do fornecedor", async () => {
    const provider = createBrevoTransactionalEmailProvider({
      ...CONFIG,
      fetchImpl: fetchRespondendo(
        201,
        JSON.stringify({ messageId: MESSAGE_ID, recipient: DISPATCH.to, credits: 42 }),
      ),
    });
    const receipt = await provider.sendPasswordReset(DISPATCH);
    expect(Object.keys(receipt)).toEqual(["providerMessageId"]);
    expect(JSON.stringify(receipt)).not.toContain(DISPATCH.to);
    expect(JSON.stringify(receipt)).not.toContain("credits");
  });
});
