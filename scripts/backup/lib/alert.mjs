/**
 * alert.mjs — construção PURA de alertas operacionais (backup, migration, sync,
 * fila, 5xx, disco, indisponibilidade). Sem rede/IO nas funções `build*`/`format*`
 * (a única função com IO é `dispatchAlert`, isolada no fim).
 *
 * REGRA DE SEGURANÇA (não registrar segredos): `redactSecrets` remove
 * connection strings e chaves antes de qualquer alerta sair do processo. Um
 * alerta de backup jamais pode vazar `DATABASE_URL`/senha para um webhook ou log.
 */

/** @typedef {"critical"|"warning"|"info"} AlertSeverity */

/**
 * Fontes de alerta reconhecidas (catálogo). Ver docs/runbooks/OBSERVABILITY.md.
 * @type {readonly string[]}
 */
export const ALERT_SOURCES = Object.freeze([
  "backup",
  "restore-test",
  "migration",
  "sync",
  "queue",
  "http-5xx",
  "disk",
  "availability",
]);

/**
 * Remove segredos de um texto livre antes de ele entrar num alerta/log.
 * Cobre: connection strings postgres(ql):// com credencial, e pares
 * `password=...` / `*_KEY=...` / `TOKEN=...`.
 * @param {string} input
 * @returns {string}
 */
export function redactSecrets(input) {
  if (typeof input !== "string" || input.length === 0) return "";
  return input
    // postgres://user:pass@host -> postgres://***:***@host
    .replace(/(postgres(?:ql)?:\/\/)[^:/@\s]+:[^@\s]+@/gi, "$1***:***@")
    // password=... / pwd=...
    .replace(/\b(password|pwd)=([^\s&;"']+)/gi, "$1=***")
    // FOO_KEY=... / FOO_TOKEN=... / FOO_SECRET=...
    .replace(/\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD))=([^\s&;"']+)/g, "$1=***");
}

/**
 * Constrói o payload canônico de um alerta a partir do resultado de um job.
 * PURO e determinístico: o timestamp é injetado (nunca lê o relógio aqui).
 *
 * @param {object} outcome
 * @param {string} outcome.source            uma das ALERT_SOURCES
 * @param {"success"|"failure"} outcome.status
 * @param {number} [outcome.exitCode]        código de saída do job
 * @param {string} [outcome.message]         detalhe livre (será redigido)
 * @param {string} outcome.timestamp         ISO string injetada
 * @param {string} [outcome.host]            host de origem (opcional)
 * @returns {{source:string,status:string,severity:AlertSeverity,exitCode:number,message:string,timestamp:string,host:string}}
 */
export function buildAlert(outcome) {
  if (!outcome || typeof outcome !== "object") {
    throw new TypeError("buildAlert: outcome obrigatório");
  }
  const source = String(outcome.source ?? "").trim();
  if (!ALERT_SOURCES.includes(source)) {
    throw new RangeError(`buildAlert: source desconhecida: ${source}`);
  }
  const status = outcome.status === "success" ? "success" : "failure";
  /** @type {AlertSeverity} */
  const severity = status === "success" ? "info" : source === "backup" || source === "migration" || source === "availability" ? "critical" : "warning";
  return {
    source,
    status,
    severity,
    exitCode: Number.isInteger(outcome.exitCode) ? outcome.exitCode : status === "success" ? 0 : 1,
    message: redactSecrets(String(outcome.message ?? "")),
    timestamp: String(outcome.timestamp ?? ""),
    host: redactSecrets(String(outcome.host ?? "")),
  };
}

/**
 * Texto humano de uma linha para log/Slack/e-mail. Já parte de um alerta
 * construído (portanto já redigido).
 * @param {ReturnType<typeof buildAlert>} alert
 * @returns {string}
 */
export function formatAlertText(alert) {
  const tag = alert.status === "success" ? "OK" : "ALERTA";
  return `[${tag}][${alert.severity}] ${alert.source} exit=${alert.exitCode} ${alert.timestamp} ${alert.message}`.trim();
}

/**
 * Envia o alerta a um webhook (IO — não usar em teste puro). Só dispara quando
 * `webhookUrl` está definido; caso contrário retorna `false` sem lançar, para o
 * job não quebrar por falta de configuração de alerta.
 * @param {ReturnType<typeof buildAlert>} alert
 * @param {string|undefined} webhookUrl
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<boolean>}
 */
export async function dispatchAlert(alert, webhookUrl, fetchImpl = fetch) {
  if (!webhookUrl || typeof webhookUrl !== "string") return false;
  try {
    const res = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(alert),
    });
    return Boolean(res && res.ok);
  } catch {
    // Falha ao alertar nunca deve mascarar o resultado do job (que já é != 0).
    return false;
  }
}
