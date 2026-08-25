/**
 * alert.mjs — construção e ENVIO de alertas operacionais (backup, migration,
 * sync, fila, 5xx, disco, indisponibilidade).
 *
 * As funções `build*`/`format*`/`redact*` são PURAS (sem rede/IO). As duas
 * funções com IO são `dispatchAlert` e `tryDispatchAlert`.
 *
 * ============ POR QUE `dispatchAlert` LANÇA (mudança de contrato) ============
 * Até 2026-08 esta função tinha um `catch {}` que devolvia `false` para QUALQUER
 * falha e nunca lançava. O efeito medido: quando o canal de notificação caía, a
 * falha do alerta era indistinguível de "não havia canal configurado", e os DOIS
 * chamadores do repositório (`scripts/backup/backup-with-alert.sh` e
 * `scripts/catalog/catalog-cycle-with-alert.sh`) simplesmente descartavam o
 * boolean. Resultado: o backup falhava, o webhook estava fora do ar, e o operador
 * continuava acreditando que estava coberto. Alerta que falha em silêncio não é
 * alerta.
 *
 * O contrato passou a separar os dois estados que o boolean confundia:
 *
 *   - `true`   -> entregue (webhook respondeu 2xx);
 *   - `false`  -> NÃO havia canal configurado. Nada foi prometido; o log local é
 *                 o canal. Não é falha, então não lança;
 *   - LANÇA `AlertDispatchError` -> havia canal configurado e a entrega FALHOU
 *                 (não-2xx, timeout, rede caída, uso inválido). Este é o estado
 *                 que precisa ser impossível de ignorar por descuido.
 *
 * POR QUE LANÇAR em vez de devolver um objeto de resultado: um objeto é SEMPRE
 * truthy, então `if (await dispatchAlert(...))` passaria a ser sempre verdadeiro
 * — trocaríamos um silêncio por outro, mais sutil. Lançar é a única forma de o
 * chamador distraído ser interrompido.
 *
 * POR QUE ISSO NÃO MASCARA O JOB: quem chama é um envelope de shell que já
 * preserva o exit code do trabalho explicitamente (`exit "$code"`), e a chamada
 * ao Node acontece num SUBPROCESSO isolado. O alerta explodir derruba o
 * subprocesso do alerta, nunca o resultado do backup/ciclo — que continua sendo
 * a fonte de verdade.
 *
 * PARA QUEM NÃO PODE LANÇAR: `tryDispatchAlert` devolve um resultado
 * ESTRUTURADO (`{ delivered, outcome, detail }`) e nunca lança. O nome declara,
 * no ponto da chamada, que o autor escolheu inspecionar o desfecho — ao
 * contrário de um boolean anônimo, que se descarta sem deixar rastro na leitura.
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
 * Desfechos possíveis de uma tentativa de envio.
 * `not-configured` é o único desfecho não-entregue que NÃO é falha.
 */
export const ALERT_DISPATCH_OUTCOMES = Object.freeze([
  "delivered",
  "not-configured",
  "http-error",
  "timeout",
  "network-error",
  "invalid-usage",
]);

/**
 * Erro de ENTREGA do alerta: havia canal configurado e a mensagem não chegou.
 * Carrega o desfecho classificado para o chamador poder diagnosticar sem
 * reparsear string de erro.
 */
export class AlertDispatchError extends Error {
  /**
   * @param {string} outcome  um de ALERT_DISPATCH_OUTCOMES (nunca "delivered")
   * @param {string} detail   diagnóstico curto, já redigido
   */
  constructor(outcome, detail) {
    super(`alerta nao entregue (${outcome}): ${detail}`);
    this.name = "AlertDispatchError";
    this.outcome = outcome;
    this.detail = detail;
  }
}

/** Marca interna do timeout, para distingui-lo de uma falha de rede. */
const TIMEOUT_MARKER = "alert-timeout";

/**
 * Envia o alerta a um webhook e devolve um resultado ESTRUTURADO. NUNCA lança.
 *
 * Use esta variante quando o caminho de chamada realmente não pode ser
 * interrompido; o nome deixa explícito, na leitura, que o autor assumiu a
 * obrigação de inspecionar `result.delivered`/`result.outcome`.
 *
 * @param {ReturnType<typeof buildAlert>} alert
 * @param {object} [options]
 * @param {string} [options.webhookUrl]   destino (env BACKUP_ALERT_WEBHOOK_URL)
 * @param {string} [options.provider]     "generic" | "slack" (env BACKUP_ALERT_PROVIDER)
 * @param {number} [options.timeoutMs]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {(msg:string)=>void} [options.log]
 * @returns {Promise<{delivered:boolean, outcome:string, detail:string}>}
 */
export async function tryDispatchAlert(alert, options = {}) {
  const {
    webhookUrl,
    provider,
    timeoutMs = DEFAULT_ALERT_TIMEOUT_MS,
    fetchImpl = fetch,
    log = (msg) => console.error(msg),
  } = options;

  // Sem webhook configurado: o log local É o canal. Nada foi prometido, então
  // isto não é falha — e por isso `dispatchAlert` não lança neste caso.
  if (!webhookUrl || typeof webhookUrl !== "string") {
    log(formatAlertText(alert));
    return { delivered: false, outcome: "not-configured", detail: "nenhum webhook configurado" };
  }

  if (typeof fetchImpl !== "function") {
    // Erro de programação, não queda de canal: classificado à parte para o
    // operador não caçar rede quando o defeito é de chamada.
    return { delivered: false, outcome: "invalid-usage", detail: "fetchImpl nao e funcao" };
  }

  const chosen = provider === "slack" ? "slack" : "generic";
  const body = JSON.stringify(payloadFor(chosen, alert));

  let timer;
  try {
    // Promise.race garante resolucao mesmo se o webhook pendurar (o fetch pode
    // continuar em background num processo efemero de alerta — aceitavel). Sem
    // AbortController para nao depender de global fora do ambiente do lint
    // deste .mjs.
    const res = await Promise.race([
      fetchImpl(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(TIMEOUT_MARKER)), timeoutMs);
      }),
    ]);
    if (res && res.ok) {
      return { delivered: true, outcome: "delivered", detail: "webhook respondeu 2xx" };
    }
    const status = res && res.status !== undefined ? String(res.status) : "resposta invalida";
    return { delivered: false, outcome: "http-error", detail: `webhook respondeu ${status}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === TIMEOUT_MARKER) {
      return { delivered: false, outcome: "timeout", detail: `sem resposta em ${timeoutMs}ms` };
    }
    // `redactSecrets`: a mensagem de erro da camada de rede pode carregar a URL
    // do webhook (que é ela mesma um segredo) ou credencial embutida.
    return { delivered: false, outcome: "network-error", detail: redactSecrets(message) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Envia o alerta a um webhook.
 *
 * - resolve `true`  -> entregue (2xx);
 * - resolve `false` -> NÃO havia canal configurado (log local; não é falha);
 * - LANÇA `AlertDispatchError` -> havia canal e a entrega falhou.
 *
 * O `throw` é deliberado: ver o cabeçalho do arquivo. Um alerta que falha em
 * silêncio dá ao operador uma cobertura que ele não tem. Quem não pode ser
 * interrompido usa `tryDispatchAlert`.
 *
 * @param {ReturnType<typeof buildAlert>} alert
 * @param {Parameters<typeof tryDispatchAlert>[1]} [options]
 * @returns {Promise<boolean>} true = entregue; false = sem canal configurado.
 * @throws {AlertDispatchError} quando havia canal configurado e não entregou.
 */
export async function dispatchAlert(alert, options = {}) {
  const result = await tryDispatchAlert(alert, options);
  if (result.delivered) return true;
  if (result.outcome === "not-configured") return false;
  throw new AlertDispatchError(result.outcome, result.detail);
}
