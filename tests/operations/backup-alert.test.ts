/**
 * backup-alert.test.ts — trava do alerta operacional (Prompt 02).
 *
 * Cobre o requisito "falha de backup gera alerta testado" e a regra de nunca
 * registrar segredos: o payload do alerta não pode conter DATABASE_URL/senha.
 * O módulo sob teste vive em scripts/backup/lib (tooling operacional); o teste
 * mora em tests/ (coletado pelo vitest).
 */
import { describe, expect, it, vi } from "vitest";

import {
  ALERT_SOURCES,
  buildAlert,
  dispatchAlert,
  formatAlertText,
  redactSecrets,
  // @ts-expect-error — módulo .mjs de tooling operacional, sem tipos gerados.
} from "../../scripts/backup/lib/alert.mjs";

const TS = "2026-07-23T12:00:00.000Z";

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
    expect(alert.status).toBe("failure");
    const serialized = JSON.stringify(alert);
    expect(serialized).not.toContain("s3cr3t");
    expect(serialized).toContain("***:***@");
  });

  it("sucesso e info; sync/fila/disco falhando sao warning; backup/migration/availability sao critical", () => {
    expect(buildAlert({ source: "backup", status: "success", timestamp: TS }).severity).toBe("info");
    expect(buildAlert({ source: "sync", status: "failure", timestamp: TS }).severity).toBe("warning");
    expect(buildAlert({ source: "queue", status: "failure", timestamp: TS }).severity).toBe("warning");
    expect(buildAlert({ source: "disk", status: "failure", timestamp: TS }).severity).toBe("warning");
    expect(buildAlert({ source: "migration", status: "failure", timestamp: TS }).severity).toBe("critical");
    expect(buildAlert({ source: "availability", status: "failure", timestamp: TS }).severity).toBe("critical");
  });

  it("rejeita source fora do catálogo", () => {
    expect(() => buildAlert({ source: "inexistente", status: "failure", timestamp: TS })).toThrow();
    // o catálogo inclui as fontes exigidas pelo Prompt 02
    for (const s of ["backup", "migration", "sync", "queue", "http-5xx", "disk", "availability"]) {
      expect(ALERT_SOURCES).toContain(s);
    }
  });
});

describe("formatAlertText", () => {
  it("gera linha única já redigida", () => {
    const alert = buildAlert({ source: "backup", status: "failure", exitCode: 2, message: "x", timestamp: TS });
    expect(formatAlertText(alert)).toBe(`[ALERTA][critical] backup exit=2 ${TS} x`);
  });
});

describe("dispatchAlert", () => {
  it("nao dispara (nem lança) quando não há webhook configurado", async () => {
    const alert = buildAlert({ source: "backup", status: "failure", timestamp: TS });
    await expect(dispatchAlert(alert, undefined)).resolves.toBe(false);
  });

  it("posta JSON no webhook quando configurado", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const alert = buildAlert({ source: "backup", status: "failure", timestamp: TS });
    await expect(dispatchAlert(alert, "https://hook.example/x", fetchImpl as unknown as typeof fetch)).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hook.example/x");
    expect(init.method).toBe("POST");
  });

  it("uma falha de rede no webhook nunca propaga (o job já falhou por conta própria)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const alert = buildAlert({ source: "backup", status: "failure", timestamp: TS });
    await expect(dispatchAlert(alert, "https://hook.example/x", fetchImpl as unknown as typeof fetch)).resolves.toBe(false);
  });
});
