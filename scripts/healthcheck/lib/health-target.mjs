/**
 * health-target.mjs — PARA ONDE o HEALTHCHECK da imagem do `Dockerfile` pergunta.
 *
 * ============================================================================
 * O DEFEITO QUE ESTE MODULO CONSERTA
 * ============================================================================
 * A imagem do `Dockerfile` da raiz roda DOIS servicos no EasyPanel:
 *
 *   - `screen-app`  — o CMD da imagem: `migrate deploy` + `next start`, que serve
 *                     `/api/health/` na porta 3000;
 *   - `screen-cron` — a MESMA imagem com o comando trocado pelo do agendador
 *                     (`corepack pnpm --filter @screena/sync scheduler:start`),
 *                     que serve `/healthz` na porta `CINERIE_SCHEDULER_HEALTH_PORT`
 *                     (default 3005) e NADA na 3000.
 *
 * O HEALTHCHECK era um `fetch` fixo em `127.0.0.1:3000/api/health/`. No
 * `screen-cron` ninguem escuta a 3000 (medido de dentro do container:
 * `ECONNREFUSED` na 3000, `HTTP 200` no `/healthz` da 3005): o container nunca
 * ficava saudavel e o orquestrador seguia subindo substitutos. Medido em
 * producao em 16 e 17/09/2026: 129 a 150 containers do agendador por hora, ~2 min
 * de sinal de vida cada, 6 a 7 vivos ao mesmo tempo para UMA replica — e as filas
 * longas (ratings_omdb, watch_offers, airing_series, awards, title_media) sem
 * nenhuma execucao registrada desde as 16h17, porque o processo morria no meio
 * de todo lote.
 *
 * ============================================================================
 * O SERVICO SE RECONHECE PELO COMANDO DO CONTAINER, NAO POR VARIAVEL
 * ============================================================================
 * Imagem + comando = servico. O que separa os dois e o COMANDO, e o PID 1 do
 * container E esse comando: `/proc/1/cmdline` o entrega sem configuracao nenhuma
 * no painel.
 *
 * Por que nao uma variavel "que so o agendador tem" (ex.: CINERIE_SCHEDULER_APPLY):
 * variavel de ambiente se COPIA entre servicos. No dia em que o ambiente do
 * `screen-cron` fosse colado no `screen-app`, o SITE passaria a ser sondado na
 * 3005, onde nada escuta — nunca saudavel, substituido em loop, fora do ar por
 * causa de uma variavel que ele nem le. O comando do `screen-app` e o CMD da
 * imagem, e ele nunca cita o agendador.
 *
 * Por que SO o PID 1, e nao "algum processo do agendador no container": um
 * `docker exec` que rodasse o agendador DENTRO do `screen-app` nao pode tornar o
 * site saudavel com o Next fora do ar. Processo de `exec` nunca e o PID 1.
 *
 * ============================================================================
 * FAIL-SAFE PARA O LADO CERTO
 * ============================================================================
 * `/proc` ilegivel ou comando sem marcador => alvo do SITE, que e exatamente o
 * comportamento anterior. Nada aqui faz o `screen-app` responder saudavel sem o
 * Next: o alvo dele continua sendo o `/api/health/`, que so da 200 com o
 * PostgreSQL respondendo.
 *
 * `CINERIE_HEALTHCHECK_URL` e a saida EXPLICITA para um papel novo desta imagem:
 * presente, vence a deteccao. So `http`, so loopback, sem credencial na URL — o
 * healthcheck nunca pergunta a OUTRO host se ESTE container esta vivo, e a URL
 * vai para o log de saude do Docker (`docker inspect`).
 *
 * Tudo aqui e PURO, exceto `runHealthcheck`, que recebe o IO por injecao.
 */

/** O site publico: o CMD da imagem. */
export const APP_SERVICE = 'screen-app'
export const APP_HEALTH_PORT = 3000
/** URL CANONICA com barra final: `trailingSlash: true` faria `/api/health` responder 308. */
export const APP_HEALTH_PATH = '/api/health/'

/** O agendador: a mesma imagem com outro comando. */
export const SCHEDULER_SERVICE = 'screen-cron'
export const SCHEDULER_HEALTH_PORT_ENV = 'CINERIE_SCHEDULER_HEALTH_PORT'
/** Tem de ser o default de `resolveSchedulerConfig` — travado por teste. */
export const SCHEDULER_DEFAULT_HEALTH_PORT = 3005
/** LIVENESS: nao toca banco. Queda do PostgreSQL nao pode virar reinicio em loop. */
export const SCHEDULER_HEALTH_PATH = '/healthz'

/**
 * O que, no comando do PID 1, identifica o agendador: o script do pacote
 * (`scheduler:start`) ou o binario que ele executa (`bin/cinerie-scheduler.ts`).
 * Cobre o comando documentado e quem chama o binario direto.
 */
export const SCHEDULER_COMMAND_MARKERS = Object.freeze(['scheduler:start', 'cinerie-scheduler'])

/** A saida explicita. Presente, vence a deteccao. */
export const HEALTHCHECK_URL_ENV = 'CINERIE_HEALTHCHECK_URL'

/** Menor que o `--timeout=5s` do HEALTHCHECK: quem responde e o script, nao o Docker matando. */
export const PROBE_TIMEOUT_MS = 4_000

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

/**
 * `/proc/<pid>/cmdline` -> argumentos. Os argumentos vem separados por NUL; o
 * vazio no fim (e o preenchimento de quem reescreve o titulo do processo) sai.
 * `null` quando nao ha o que ler — e quem chama decide o fallback.
 *
 * @param {string | Uint8Array | null | undefined} raw
 * @returns {string[] | null}
 */
export function parseProcCmdline(raw) {
  if (raw === null || raw === undefined) return null
  const text = typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8')
  const args = text.split('\0').filter((part) => part.length > 0)
  return args.length > 0 ? args : null
}

/**
 * O PID 1 roda o agendador? Casa por TRECHO porque o painel pode entregar o
 * comando inteiro como UM argumento de `sh -c`.
 *
 * @param {readonly string[] | null} args
 */
export function isSchedulerCommand(args) {
  if (args === null) return false
  const joined = args.join(' ')
  return SCHEDULER_COMMAND_MARKERS.some((marker) => joined.includes(marker))
}

/**
 * A porta do agendador, com a MESMA regra de `resolveSchedulerConfig`: ausente ou
 * vazia = default; presente e invalida = erro (o agendador tambem recusa subir).
 *
 * @param {string | undefined} raw
 * @returns {{ ok: true, port: number } | { ok: false, error: string }}
 */
function readSchedulerPort(raw) {
  if (raw === undefined || raw.trim() === '')
    return { ok: true, port: SCHEDULER_DEFAULT_HEALTH_PORT }
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    return { ok: false, error: `${SCHEDULER_HEALTH_PORT_ENV} invalida (inteiro entre 1 e 65535)` }
  }
  return { ok: true, port: parsed }
}

/**
 * Valida a URL explicita. A mensagem nunca repete o valor recebido.
 *
 * @param {string} raw
 * @returns {{ ok: true, url: URL } | { ok: false, error: string }}
 */
function readOverrideUrl(raw) {
  let url
  try {
    url = new URL(raw.trim())
  } catch {
    return { ok: false, error: `${HEALTHCHECK_URL_ENV} nao e uma URL` }
  }
  if (url.protocol !== 'http:') {
    return { ok: false, error: `${HEALTHCHECK_URL_ENV} aceita so http` }
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    return {
      ok: false,
      error: `${HEALTHCHECK_URL_ENV} aceita so loopback (127.0.0.1, localhost, [::1])`,
    }
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, error: `${HEALTHCHECK_URL_ENV} nao pode levar credencial` }
  }
  return { ok: true, url }
}

/**
 * @typedef {'override' | 'pid1' | 'padrao' | 'pid1-ilegivel'} TargetVia
 * @typedef {{ ok: true, service: string, via: TargetVia, url: string, display: string }} HealthTarget
 * @typedef {{ ok: false, service: string, via: TargetVia, error: string }} HealthTargetError
 */

/**
 * PARA ONDE perguntar. PURA.
 *
 * Ordem: URL explicita > comando do PID 1 > o site.
 *
 * @param {{ pid1Args: readonly string[] | null, env: Readonly<Record<string, string | undefined>> }} input
 * @returns {HealthTarget | HealthTargetError}
 */
export function resolveHealthTarget({ pid1Args, env }) {
  const override = env[HEALTHCHECK_URL_ENV]
  if (override !== undefined && override.trim() !== '') {
    const checked = readOverrideUrl(override)
    if (!checked.ok)
      return { ok: false, service: HEALTHCHECK_URL_ENV, via: 'override', error: checked.error }
    return {
      ok: true,
      service: HEALTHCHECK_URL_ENV,
      via: 'override',
      url: checked.url.href,
      // A query nunca vai para o log de saude.
      display: `${checked.url.origin}${checked.url.pathname}`,
    }
  }

  if (isSchedulerCommand(pid1Args)) {
    const port = readSchedulerPort(env[SCHEDULER_HEALTH_PORT_ENV])
    if (!port.ok) return { ok: false, service: SCHEDULER_SERVICE, via: 'pid1', error: port.error }
    const url = `http://127.0.0.1:${String(port.port)}${SCHEDULER_HEALTH_PATH}`
    return { ok: true, service: SCHEDULER_SERVICE, via: 'pid1', url, display: url }
  }

  const url = `http://127.0.0.1:${String(APP_HEALTH_PORT)}${APP_HEALTH_PATH}`
  return {
    ok: true,
    service: APP_SERVICE,
    via: pid1Args === null ? 'pid1-ilegivel' : 'padrao',
    url,
    display: url,
  }
}

/**
 * O motivo de uma sondagem que nao chegou a resposta, sem repetir mensagem crua.
 *
 * @param {unknown} error
 * @param {number} timeoutMs
 */
function describeProbeError(error, timeoutMs) {
  if (typeof error === 'object' && error !== null) {
    const record = /** @type {{ name?: unknown, code?: unknown, cause?: unknown }} */ (error)
    if (record.name === 'TimeoutError' || record.name === 'AbortError') {
      return `sem resposta em ${String(timeoutMs)} ms`
    }
    const cause = /** @type {{ code?: unknown } | null | undefined} */ (record.cause)
    if (typeof cause === 'object' && cause !== null && typeof cause.code === 'string')
      return cause.code
    if (typeof record.code === 'string') return record.code
    if (typeof record.name === 'string') return record.name
  }
  return 'falha desconhecida'
}

/**
 * UMA sondagem. Devolve o codigo de saida do HEALTHCHECK (0 saudavel, 1 nao) e a
 * linha que o Docker guarda em `.State.Health.Log` — a unica pista que o
 * operador tem do MOTIVO sem abrir o container.
 *
 * So 200 e saudavel. Redirect NAO e seguido: um 3xx nao prova que ESTE processo
 * esta vivo, e seguir poderia levar a sondagem para longe do loopback.
 *
 * @param {{
 *   readPid1Cmdline: () => string | Uint8Array | null,
 *   env: Readonly<Record<string, string | undefined>>,
 *   fetch: (url: string, init: Record<string, unknown>) => Promise<{ status: number, body?: { cancel(): Promise<void> } | null }>,
 *   timeoutMs?: number,
 * }} deps
 * @returns {Promise<{ code: 0 | 1, line: string }>}
 */
export async function runHealthcheck({
  readPid1Cmdline,
  env,
  fetch: fetchImpl,
  timeoutMs = PROBE_TIMEOUT_MS,
}) {
  let raw = null
  try {
    raw = readPid1Cmdline()
  } catch {
    raw = null
  }

  const target = resolveHealthTarget({ pid1Args: parseProcCmdline(raw), env })
  if (!target.ok) {
    return { code: 1, line: `unhealthy ${target.service} (${target.via}): ${target.error}` }
  }

  const prefix = `${target.service} (${target.via}) ${target.display}`
  try {
    const response = await fetchImpl(target.url, {
      redirect: 'manual',
      signal: globalThis.AbortSignal.timeout(timeoutMs),
    })
    // O corpo nao interessa; soltar a conexao evita segurar o processo.
    response.body?.cancel().catch(() => undefined)
    const healthy = response.status === 200
    return {
      code: healthy ? 0 : 1,
      line: `${healthy ? 'healthy' : 'unhealthy'} ${prefix} -> HTTP ${String(response.status)}`,
    }
  } catch (error) {
    return { code: 1, line: `unhealthy ${prefix} -> ${describeProbeError(error, timeoutMs)}` }
  }
}
