/**
 * alert.mjs — construção e ENVIO de alertas operacionais (backup, migration,
 * sync, fila, 5xx, disco, indisponibilidade).
 *
 * As funções `build*`/`format*`/`redact*` são PURAS (sem rede/IO). A única
 * função com IO é `dispatchAlert`, e ela NUNCA lança — uma falha de alerta jamais
 * pode mascarar/propagar sobre o resultado do job que a chamou (o backup já
 * falhou por conta própria; o exit code dele é a fonte de verdade).
 *
 * PROVIDER EXPLÍCITO (nunca inferido): `BACKUP_ALERT_PROVIDER=slack|generic`.
 *   - generic  -> POST do payload estruturado completo;
 *   - slack    -> POST de `{ text: "..." }` (Slack Incoming Webhook);
 *   - ausente / sem webhook -> apenas log local e retorno seguro (false).
 *
 * REGRA DE SEGURANÇA (não registrar segredos): `redactSecrets` remove connection
 * strings e chaves antes de qualquer alerta sair do processo.
 */

/** @typedef {"critical"|"warning"|"info"} AlertSeverity */

/** Fontes de alerta reconhecidas (catálogo). Ver docs/runbooks/OBSERVABILITY.md. */
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

/** Providers de webhook suportados (explícitos). */
export const ALERT_PROVIDERS = Object.freeze(["generic", "slack"]);

/** Timeout default de envio do alerta (ms). */
export const DEFAULT_ALERT_TIMEOUT_MS = 5000;

/**
 * Remove segredos de um texto livre antes de ele entrar num alerta/log.
 * @param {string} input
 * @returns {string}
 */
export function redactSecrets(input) {
  if (typeof input !== "string" || input.length === 0) return "";
  return input
    .replace(/(postgres(?:ql)?:\/\/)[^:/@\s]+:[^@\s]+@/gi, "$1***:***@")
    .replace(/\b(password|pwd)=([^\s&;"']+)/gi, "$1=***")
    .replace(/\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD))=([^\s&;"']+)/g, "$1=***");
}

/**
 * Constrói o payload canônico de um alerta a partir do resultado de um job.
 * PURO e determinístico: o timestamp é injetado (nunca lê o relógio aqui).
 * @param {object} outcome
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
  const severity =
    status === "success"
      ? "info"
      : source === "backup" || source === "migration" || source === "availability"
        ? "critical"
        : "warning";
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
 * Texto humano de uma linha (já redigido, pois parte de um alerta construído).
 * @param {ReturnType<typeof buildAlert>} alert
 * @returns {string}
 */
export function formatAlertText(alert) {
  const tag = alert.status === "success" ? "OK" : "ALERTA";
  return `[${tag}][${alert.severity}] ${alert.source} exit=${alert.exitCode} ${alert.timestamp} ${alert.message}`.trim();
}

/**
 * Payload genérico: o alerta estruturado inteiro.
 * @param {ReturnType<typeof buildAlert>} alert
 */
export function formatGenericPayload(alert) {
  return { ...alert };
}

/**
 * Payload Slack Incoming Webhook: `{ text }` (compatível com o formato mais
 * simples e universal do Slack). O texto já vem redigido.
 * @param {ReturnType<typeof buildAlert>} alert
 */
export function formatSlackPayload(alert) {
  return { text: formatAlertText(alert) };
}

/** Seleciona o payload conforme o provider explícito. */
function payloadFor(provider, alert) {
  return provider === "slack" ? formatSlackPayload(alert) : formatGenericPayload(alert);
}

/**
 * Envia o alerta a um webhook. NUNCA lança e SEMPRE resolve boolean.
 *
 * @param {ReturnType<typeof buildAlert>} alert
 * @param {object} [options]
 * @param {string} [options.webhookUrl]   destino (env BACKUP_ALERT_WEBHOOK_URL)
 * @param {string} [options.provider]     "generic" | "slack" (env BACKUP_ALERT_PROVIDER)
 * @param {number} [options.timeoutMs]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {(msg:string)=>void} [options.log]
 * @returns {Promise<boolean>} true só quando o webhook respondeu 2xx.
 */
export async function dispatchAlert(alert, options = {}) {
  const {
    webhookUrl,
    provider,
    timeoutMs = DEFAULT_ALERT_TIMEOUT_MS,
    fetchImpl = fetch,
    log = (msg) => console.error(msg),
  } = options;

  // Sem webhook configurado: log local e retorno seguro (nunca lança).
  if (!webhookUrl || typeof webhookUrl !== "string") {
    log(formatAlertText(alert));
    return false;
  }

  const chosen = provider === "slack" ? "slack" : "generic";
  const body = JSON.stringify(payloadFor(chosen, alert));

  let timer;
  try {
    // Promise.race garante resolucao mesmo se o webhook pendurar: no timeout a
    // funcao resolve `false` (o fetch pode continuar em background num processo
    // efemero de alerta — aceitavel). Sem AbortController para nao depender de
    // global fora do ambiente do lint deste .mjs.
    const res = await Promise.race([
      fetchImpl(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("alert-timeout")), timeoutMs);
      }),
    ]);
    return Boolean(res && res.ok);
  } catch {
    // Timeout, rede caída ou resposta inválida: alerta falhou, mas o job não.
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
