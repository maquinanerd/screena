/**
 * backup-alert.test.ts — trava do alerta operacional (Prompt 02).
 *
 * Cobre "falha de backup gera alerta testado", os adapters de webhook
 * (generic/slack/none), a regra de nunca registrar segredos, respostas HTTP
 * não-2xx, timeout e falha de rede.
 *
 * MUDANÇA DE CONTRATO (2026-08): `dispatchAlert` deixou de engolir a falha de
 * entrega. Antes, um `catch {}` devolvia `false` para tudo, então "o canal caiu"
 * era indistinguível de "não havia canal" — e os dois envelopes de shell
 * descartavam o boolean. Agora: `true` = entregue, `false` = SEM canal
 * configurado, e LANÇA `AlertDispatchError` quando havia canal e a entrega
 * falhou. Quem não pode ser interrompido usa `tryDispatchAlert`, que devolve
 * `{ delivered, outcome, detail }`.
 *
 * O módulo vive em scripts/backup/lib (tooling); o teste mora em tests/
 * (coletado pelo vitest).
 */
import { describe, expect, it, vi } from "vitest";

import {
  ALERT_DISPATCH_OUTCOMES,
  ALERT_PROVIDERS,
  ALERT_SOURCES,
  AlertDispatchError,
  buildAlert,
  dispatchAlert,
  formatAlertText,
  formatGenericPayload,
  formatSlackPayload,
  redactSecrets,
  tryDispatchAlert,
  // @ts-expect-error — módulo .mjs de tooling operacional, sem tipos gerados.
} from "../../scripts/backup/lib/alert.mjs";

const TS = "2026-07-23T12:00:00.000Z";
const alertFor = (over: Record<string, unknown> = {}) =>
  buildAlert({ source: "backup", status: "failure", exitCode: 1, message: "x", timestamp: TS, ...over });

describe("redactSecrets", () => {
  it("mascara credencial de connection string postgres", () => {
    const out = redactSecrets("falhou em postgresql://screen:s3cr3t@db:5432/screen");
    expect(out).toContain("postgresql://***:***@db:5432/screen");
    expect(out).not.toContain("s3cr3t");
  });

  it("mascara password=... e *_KEY=...", () => {
    expect(redactSecrets("pwd password=hunter2 fim")).toContain("password=***");
    expect(redactSecrets("BREVO_API_KEY=abc123 fim")).toContain("BREVO_API_KEY=***");
    expect(redactSecrets("RAPIDAPI_FILM_SHOW_RATINGS_KEY=xyz")).not.toContain("xyz");
  });
});

describe("buildAlert", () => {
  it("falha de backup e alerta CRITICAL e nunca vaza a connection string", () => {
    const alert = buildAlert({
      source: "backup",
      status: "failure",
      exitCode: 1,
      message: "pg_dump falhou usando postgresql://screen:s3cr3t@db/screen",
      timestamp: TS,
    });
    expect(alert.severity).toBe("critical");
    const serialized = JSON.stringify(alert);
    expect(serialized).not.toContain("s3cr3t");
    expect(serialized).toContain("***:***@");
  });

  it("severidades por fonte", () => {
    expect(buildAlert({ source: "backup", status: "success", timestamp: TS }).severity).toBe("info");
    expect(buildAlert({ source: "sync", status: "failure", timestamp: TS }).severity).toBe("warning");
    expect(buildAlert({ source: "queue", status: "failure", timestamp: TS }).severity).toBe("warning");
    expect(buildAlert({ source: "disk", status: "failure", timestamp: TS }).severity).toBe("warning");
    expect(buildAlert({ source: "migration", status: "failure", timestamp: TS }).severity).toBe("critical");
    expect(buildAlert({ source: "availability", status: "failure", timestamp: TS }).severity).toBe("critical");
  });

  it("rejeita source fora do catálogo; catálogo cobre o exigido pelo Prompt 02", () => {
    expect(() => buildAlert({ source: "inexistente", status: "failure", timestamp: TS })).toThrow();
    for (const s of ["backup", "migration", "sync", "queue", "http-5xx", "disk", "availability"]) {
      expect(ALERT_SOURCES).toContain(s);
    }
  });
});

describe("payloads por provider", () => {
  it("generic serializa o alerta estruturado completo", () => {
    const p = formatGenericPayload(alertFor());
    expect(p).toMatchObject({ source: "backup", status: "failure", severity: "critical", exitCode: 1 });
  });

  it("slack usa { text } com a linha humana", () => {
    const p = formatSlackPayload(alertFor());
    expect(Object.keys(p)).toEqual(["text"]);
    expect(p.text).toBe(`[ALERTA][critical] backup exit=1 ${TS} x`);
  });

  it("ALERT_PROVIDERS lista slack e generic", () => {
    expect([...ALERT_PROVIDERS].sort()).toEqual(["generic", "slack"]);
  });
});

describe("formatAlertText", () => {
  it("gera linha única já redigida", () => {
    expect(formatAlertText(alertFor({ exitCode: 2 }))).toBe(`[ALERTA][critical] backup exit=2 ${TS} x`);
  });
});

describe("dispatchAlert", () => {
  it("sem webhook: apenas loga local e retorna false (nunca lança)", async () => {
    const log = vi.fn();
    await expect(dispatchAlert(alertFor(), { log })).resolves.toBe(false);
    expect(log).toHaveBeenCalledOnce();
  });

  it("provider generic posta o payload estruturado", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    await expect(
      dispatchAlert(alertFor(), { webhookUrl: "https://hook/x", provider: "generic", fetchImpl }),
    ).resolves.toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hook/x");
    expect(init.method).toBe("POST");
    const sent = JSON.parse(init.body as string);
    expect(sent).toMatchObject({ source: "backup", severity: "critical" });
    expect(sent.text).toBeUndefined();
  });

  it("provider slack posta { text }", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    await dispatchAlert(alertFor(), { webhookUrl: "https://hooks.slack.com/x", provider: "slack", fetchImpl });
    const sent = JSON.parse((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(Object.keys(sent)).toEqual(["text"]);
    expect(sent.text).toContain("[ALERTA][critical] backup");
  });

  it("nunca envia o segredo, mesmo via slack", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const a = buildAlert({ source: "backup", status: "failure", message: "postgresql://u:s3cr3t@h/db", timestamp: TS });
    await dispatchAlert(a, { webhookUrl: "https://hooks.slack.com/x", provider: "slack", fetchImpl });
    const body = (fetchImpl.mock.calls[0] as [string, RequestInit])[1].body as string;
    expect(body).not.toContain("s3cr3t");
  });

  it("resposta HTTP não-2xx LANÇA — canal caído não pode virar silêncio", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    await expect(
      dispatchAlert(alertFor(), { webhookUrl: "https://hook/x", provider: "generic", fetchImpl }),
    ).rejects.toThrow(AlertDispatchError);
  });

  it("timeout LANÇA sem pendurar", async () => {
    const fetchImpl = vi.fn().mockImplementation(() => new Promise(() => {})); // nunca resolve
    await expect(
      dispatchAlert(alertFor(), { webhookUrl: "https://hook/x", provider: "generic", fetchImpl, timeoutMs: 30 }),
    ).rejects.toThrow(AlertDispatchError);
  });

  it("falha de rede LANÇA", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(
      dispatchAlert(alertFor(), { webhookUrl: "https://hook/x", provider: "generic", fetchImpl }),
    ).rejects.toThrow(AlertDispatchError);
  });

  it("o erro carrega `outcome` classificado — os envelopes de shell leem esse campo", async () => {
    // Os dois `*-with-alert.sh` imprimem `err.outcome` no diagnóstico. Se o
    // campo sumir, a linha do journal degrada para "erro" genérico.
    const cases: Array<[string, Record<string, unknown>]> = [
      ["http-error", { fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 503 }) }],
      ["network-error", { fetchImpl: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) }],
      ["timeout", { fetchImpl: vi.fn().mockImplementation(() => new Promise(() => {})), timeoutMs: 20 }],
      ["invalid-usage", { fetchImpl: "nao sou funcao" }],
    ];
    for (const [expected, extra] of cases) {
      const err = await dispatchAlert(alertFor(), { webhookUrl: "https://hook/x", ...extra }).then(
        () => null,
        (e: unknown) => e as { outcome?: string; detail?: string },
      );
      expect(err, `esperava throw no caso ${expected}`).not.toBeNull();
      expect(err?.outcome).toBe(expected);
      expect(typeof err?.detail).toBe("string");
      expect(ALERT_DISPATCH_OUTCOMES).toContain(err?.outcome);
    }
  });

  it("queda de canal é DISTINGUÍVEL de ausência de canal", async () => {
    // Esta é a distinção que o `catch {}` antigo destruía: os dois viravam
    // `false`. Sem canal configurado nada foi prometido (não é falha); com
    // canal configurado e entrega falha, alguém precisa saber.
    await expect(dispatchAlert(alertFor(), { log: vi.fn() })).resolves.toBe(false);
    await expect(
      dispatchAlert(alertFor(), {
        webhookUrl: "https://hook/x",
        fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 500 }),
      }),
    ).rejects.toThrow(/nao entregue/i);
  });

  it("nenhum desfecho de falha resolve silenciosamente", async () => {
    // Trava anti-regressão do defeito exato: se alguém reintroduzir o
    // `catch { return false }`, TODOS estes voltam a resolver e o teste cai.
    const falhas = [
      { fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 500 }) },
      { fetchImpl: vi.fn().mockResolvedValue(undefined) },
      { fetchImpl: vi.fn().mockRejectedValue(new Error("network down")) },
      { fetchImpl: vi.fn().mockImplementation(() => new Promise(() => {})), timeoutMs: 20 },
    ];
    for (const extra of falhas) {
      const resolveu = await dispatchAlert(alertFor(), { webhookUrl: "https://hook/x", ...extra }).then(
        () => true,
        () => false,
      );
      expect(resolveu, "falha de entrega resolveu em vez de lançar").toBe(false);
    }
  });

  it("o detalhe do erro nunca vaza segredo vindo da camada de rede", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("falha em postgresql://u:s3cr3t@h/db"));
    const err = await dispatchAlert(alertFor(), { webhookUrl: "https://hook/x", fetchImpl }).then(
      () => null,
      (e: unknown) => e as Error & { detail?: string },
    );
    expect(err?.detail).not.toContain("s3cr3t");
    expect(err?.message).not.toContain("s3cr3t");
  });
});

describe("tryDispatchAlert (variante que não interrompe)", () => {
  it("devolve resultado estruturado em vez de lançar", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const result = await tryDispatchAlert(alertFor(), { webhookUrl: "https://hook/x", fetchImpl });
    expect(result).toMatchObject({ delivered: false, outcome: "http-error" });
    expect(result.detail).toContain("500");
  });

  it("entrega bem-sucedida marca delivered", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const result = await tryDispatchAlert(alertFor(), { webhookUrl: "https://hook/x", fetchImpl });
    expect(result).toMatchObject({ delivered: true, outcome: "delivered" });
  });

  it("sem canal configurado: `not-configured`, e o log local vira o canal", async () => {
    const log = vi.fn();
    const result = await tryDispatchAlert(alertFor(), { log });
    expect(result).toMatchObject({ delivered: false, outcome: "not-configured" });
    expect(log).toHaveBeenCalledOnce();
  });

  it("nunca lança, para qualquer modo de falha", async () => {
    const falhas = [
      { fetchImpl: vi.fn().mockRejectedValue(new Error("boom")) },
      { fetchImpl: "nao sou funcao" },
      { fetchImpl: vi.fn().mockImplementation(() => new Promise(() => {})), timeoutMs: 20 },
    ];
    for (const extra of falhas) {
      const result = await tryDispatchAlert(alertFor(), { webhookUrl: "https://hook/x", ...extra });
      expect(result.delivered).toBe(false);
      expect(ALERT_DISPATCH_OUTCOMES).toContain(result.outcome);
    }
  });
});
