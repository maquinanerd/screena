/**
 * backup-alert.test.ts — trava do alerta operacional (Prompt 02).
 *
 * Cobre "falha de backup gera alerta testado", os adapters de webhook
 * (generic/slack/none), a regra de nunca registrar segredos, respostas HTTP
 * não-2xx, timeout, falha de rede e que o dispatch NUNCA propaga erro (o exit
 * code do backup é preservado pelo envelope). O módulo vive em
 * scripts/backup/lib (tooling); o teste mora em tests/ (coletado pelo vitest).
 */
import { describe, expect, it, vi } from "vitest";

import {
  ALERT_PROVIDERS,
  ALERT_SOURCES,
  buildAlert,
  dispatchAlert,
  formatAlertText,
  formatGenericPayload,
  formatSlackPayload,
  redactSecrets,
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

  it("resposta HTTP não-2xx retorna false", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    await expect(
      dispatchAlert(alertFor(), { webhookUrl: "https://hook/x", provider: "generic", fetchImpl }),
    ).resolves.toBe(false);
  });

  it("timeout retorna false sem pendurar", async () => {
    const fetchImpl = vi.fn().mockImplementation(() => new Promise(() => {})); // nunca resolve
    await expect(
      dispatchAlert(alertFor(), { webhookUrl: "https://hook/x", provider: "generic", fetchImpl, timeoutMs: 30 }),
    ).resolves.toBe(false);
  });

  it("falha de rede retorna false (nunca propaga)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(
      dispatchAlert(alertFor(), { webhookUrl: "https://hook/x", provider: "generic", fetchImpl }),
    ).resolves.toBe(false);
  });
});
