/**
 * worker-loop-health.ts — Saude do LOOP de projecao. PURO.
 *
 * O PROBLEMA QUE ESTE MODULO EXISTE PARA RESOLVER.
 *
 * O worker tinha DOIS estados de saude colapsados em um so: "o processo esta de
 * pe". O `claim` ficava fora de qualquer `try`, entao qualquer falha da chamada
 * (5xx do CMS, ECONNREFUSED durante o deploy, ECONNRESET, timeout) escapava do
 * `while`, chegava ao `main().catch` e matava o processo com exit 1. O
 * orquestrador reiniciava, o `/healthz` respondia 200 de novo nos primeiros
 * segundos de cada encarnacao, e o painel ficava verde sobre um crash-loop.
 *
 * A correcao tem duas metades e ESTA e a segunda. A primeira (nao morrer) e
 * inutil sozinha: um worker que nunca morre e que falha em todo ciclo e pior que
 * um que morre, porque some do radar. Por isso o loop passa a carregar estado
 * proprio de saude, e esse estado alimenta o `/readyz`.
 *
 * A DISTINCAO QUE GOVERNA TUDO AQUI:
 *
 *  - **falhando** (o ciclo executa e da erro) -> NAO e caso de reiniciar.
 *    Reiniciar nao levanta o CMS nem conserta uma credencial errada. Isso e
 *    READINESS: `/readyz` 503, o operador olha.
 *  - **travado** (o ciclo parou de bater, sem erro e sem sucesso) -> e caso de
 *    reiniciar, porque um processo preso so sai com reinicio. Isso e LIVENESS.
 *
 * Confundir os dois foi o que produziu o sintoma original. Um `/healthz` que
 * caisse por falha de CMS transformaria uma queda do CMS num crash-loop do
 * worker — exatamente o que o comentario do `worker-health-server.ts` ja
 * alertava sobre o banco.
 *
 * TEMPO E INJETADO. Nada aqui le o relogio: quem chama passa `nowIso`. E isso
 * que permite testar "travado ha 4 minutos" sem esperar 4 minutos.
 */

/* ------------------------------------------------------------------ */
/* Estado                                                              */
/* ------------------------------------------------------------------ */

export interface LoopHealthState {
  readonly startedAtIso: string
  /**
   * Ultimo sinal de vida de QUALQUER natureza (batida de ciclo, evento
   * processado, falha registrada). E o que distingue "travado" de "falhando":
   * um ciclo que falha continua batendo.
   */
  readonly lastProgressAtIso: string
  /** Ultimo ciclo que terminou sem excecao. `null` ate o primeiro. */
  readonly lastSuccessAtIso: string | null
  readonly consecutiveFailures: number
  readonly cyclesCompleted: number
  /** Codigo do ultimo erro classificado. Nunca mensagem crua de excecao. */
  readonly lastErrorCode: string | null
}

export function initialLoopHealth(nowIso: string): LoopHealthState {
  return {
    startedAtIso: nowIso,
    lastProgressAtIso: nowIso,
    lastSuccessAtIso: null,
    consecutiveFailures: 0,
    cyclesCompleted: 0,
    lastErrorCode: null,
  }
}

/**
 * Batida de vida SEM desfecho: o ciclo comecou, ou mais um evento do lote
 * terminou.
 *
 * Existe por causa do lote longo. Um lote de 25 eventos com download de midia
 * pode passar de qualquer janela razoavel de stall; sem batida por evento, o
 * watchdog de liveness derrubaria um worker que esta justamente trabalhando.
 */
export function recordLoopProgress(state: LoopHealthState, nowIso: string): LoopHealthState {
  return { ...state, lastProgressAtIso: nowIso }
}

/** Ciclo terminou sem excecao — inclusive o ciclo de fila vazia. */
export function recordCycleSuccess(state: LoopHealthState, nowIso: string): LoopHealthState {
  return {
    ...state,
    lastProgressAtIso: nowIso,
    lastSuccessAtIso: nowIso,
    consecutiveFailures: 0,
    cyclesCompleted: state.cyclesCompleted + 1,
    lastErrorCode: null,
  }
}

/** Ciclo terminou em excecao. O loop CONTINUA; quem reclama e o `/readyz`. */
export function recordCycleFailure(
  state: LoopHealthState,
  nowIso: string,
  code: string,
): LoopHealthState {
  return {
    ...state,
    lastProgressAtIso: nowIso,
    consecutiveFailures: state.consecutiveFailures + 1,
    lastErrorCode: code,
  }
}

/* ------------------------------------------------------------------ */
/* Limiares                                                            */
/* ------------------------------------------------------------------ */

export interface LoopHealthThresholds {
  /** A partir daqui o `/readyz` bloqueia. */
  readonly maxConsecutiveFailures: number
  /** Sem nenhuma batida por este tempo, o loop e considerado TRAVADO. */
  readonly stallAfterMs: number
}

/**
 * Limiares derivados da configuracao do worker.
 *
 * `stallAfterMs` e deliberadamente GENEROSO. Ele alimenta liveness, e liveness
 * apertada mata worker saudavel: o pior intervalo legitimo entre duas batidas e
 * uma espera de fila vazia somada a uma chamada que vai ate o timeout, ou um
 * evento que consome a lease inteira. Multiplicar por 3 o maior dos dois deixa
 * margem para rede lenta sem transformar lentidao em reinicio.
 */
export function resolveLoopHealthThresholds(input: {
  readonly pollIntervalMs: number
  readonly requestTimeoutMs: number
  readonly leaseMs: number
}): LoopHealthThresholds {
  const worstGapMs = Math.max(input.pollIntervalMs + input.requestTimeoutMs, input.leaseMs)
  return {
    // 3 ciclos seguidos falhando ja e sinal, e nao e ruido: uma falha isolada
    // (deploy do CMS, reinicio de pool) se resolve sozinha no ciclo seguinte.
    maxConsecutiveFailures: 3,
    stallAfterMs: Math.max(worstGapMs * 3, 120_000),
  }
}

/* ------------------------------------------------------------------ */
/* Avaliacao                                                           */
/* ------------------------------------------------------------------ */

function elapsedMs(fromIso: string, nowIso: string): number | null {
  const from = Date.parse(fromIso)
  const now = Date.parse(nowIso)
  if (!Number.isFinite(from) || !Number.isFinite(now)) return null
  return now - from
}

/**
 * O loop parou de bater?
 *
 * FAIL-OPEN de proposito, e so aqui: relogio ilegivel devolve `false` (nao
 * travado). Este predicado alimenta LIVENESS, e um `true` por engano reinicia o
 * processo. Nos pontos onde um engano causaria projecao dupla — o orcamento de
 * lease em `worker-lifecycle.ts` — a escolha e a oposta, fail-closed.
 */
export function isLoopStalled(
  state: LoopHealthState,
  nowIso: string,
  stallAfterMs: number,
): boolean {
  const idle = elapsedMs(state.lastProgressAtIso, nowIso)
  if (idle === null) return false
  return idle >= stallAfterMs
}

export interface LoopHealthVerdict {
  readonly status: 'ok' | 'warning' | 'blocked'
  /** Motivo curto e de politica. NUNCA valor, credencial ou URL. */
  readonly detail: string
}

/**
 * Veredito do loop para o `/readyz`.
 *
 * Ordem de precedencia: travado > falhando demais > falhando pouco > ok. Um
 * loop travado E com falhas acumuladas deve reportar o travamento, que e a
 * condicao mais grave e a unica que reinicio resolve.
 */
export function evaluateLoopHealth(
  state: LoopHealthState,
  nowIso: string,
  thresholds: LoopHealthThresholds,
): LoopHealthVerdict {
  if (isLoopStalled(state, nowIso, thresholds.stallAfterMs)) {
    const idle = elapsedMs(state.lastProgressAtIso, nowIso) ?? 0
    return {
      status: 'blocked',
      detail: `loop travado ha ${String(Math.round(idle / 1000))}s sem batida`,
    }
  }

  if (state.consecutiveFailures >= thresholds.maxConsecutiveFailures) {
    return {
      status: 'blocked',
      detail: `${String(state.consecutiveFailures)} ciclos seguidos falharam (${state.lastErrorCode ?? 'sem codigo'})`,
    }
  }

  if (state.consecutiveFailures > 0) {
    // WARNING, nao blocked: uma falha isolada nao tira o worker do ar, mas
    // aparece no `/readyz` — e como o operador ve um CMS instavel antes de o
    // servico ser marcado como nao-pronto.
    return {
      status: 'warning',
      detail: `${String(state.consecutiveFailures)} ciclo(s) falhando (${state.lastErrorCode ?? 'sem codigo'})`,
    }
  }

  if (state.cyclesCompleted === 0) {
    // Ainda nao fechou o primeiro ciclo. Nao e falha; e "subindo".
    return { status: 'warning', detail: 'nenhum ciclo concluido ainda' }
  }

  return { status: 'ok', detail: `${String(state.cyclesCompleted)} ciclo(s) concluidos` }
}

/* ------------------------------------------------------------------ */
/* Classificacao de erro                                               */
/* ------------------------------------------------------------------ */

export interface ClassifiedCycleError {
  readonly code: string
  /** Seguro para log. Nunca a mensagem crua de um erro nao classificado. */
  readonly message: string
  readonly retryable: boolean
}

/** Erros de rede do Node/undici cujo `code` e seguro para log (sao errnos). */
const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
])

function causeCode(error: unknown, depth = 0): string | null {
  if (depth > 4 || error === null || typeof error !== 'object') return null
  const code = (error as { code?: unknown }).code
  if (typeof code === 'string' && NETWORK_ERROR_CODES.has(code)) return code
  return causeCode((error as { cause?: unknown }).cause, depth + 1)
}

/**
 * Traduz a excecao de um ciclo num codigo estavel e numa mensagem SEGURA.
 *
 * Por que nao logar o erro inteiro: a mensagem de um erro de banco carrega a
 * connection string e a de um erro de HTTP pode carregar o header de
 * autorizacao. O worker ja tinha essa disciplina — mas resolvia com
 * `error.name`, que produzia o log inutil `erro fatal: TypeError` para
 * ECONNREFUSED, ECONNRESET, DNS e corpo malformado, TODOS com o mesmo nome.
 *
 * O `code` do errno e seguro (`ECONNREFUSED` nao contem host nem credencial) e
 * e exatamente o que distingue "CMS caiu" de "DNS falhou".
 */
export function classifyCycleError(error: unknown): ClassifiedCycleError {
  // Erro ja classificado na origem (o `SafeError` do entrypoint): a mensagem
  // dele ja foi considerada segura por quem a construiu.
  if (
    error !== null &&
    typeof error === 'object' &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { retryable?: unknown }).retryable === 'boolean' &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    const safe = error as { code: string; message: string; retryable: boolean }
    return { code: safe.code, message: safe.message, retryable: safe.retryable }
  }

  // `AbortSignal.timeout()` rejeita com uma DOMException chamada
  // `TimeoutError`. Isto significa "o CMS nao respondeu a tempo" — NAO
  // significa fila vazia: fila vazia e um 200 com `events: []`, imediato.
  const name = error instanceof Error ? error.name : ''
  if (name === 'TimeoutError') {
    return {
      code: 'cms_timeout',
      message: 'CMS nao respondeu dentro de PROJECTION_REQUEST_TIMEOUT_MS',
      retryable: true,
    }
  }
  if (name === 'AbortError') {
    return { code: 'cms_aborted', message: 'chamada ao CMS abortada', retryable: true }
  }

  const network = causeCode(error)
  if (network !== null) {
    return {
      code: `cms_unreachable_${network.toLowerCase()}`,
      message: `CMS inalcancavel (${network})`,
      retryable: true,
    }
  }

  return {
    code: 'cycle_unclassified',
    message: `falha nao classificada (${name === '' ? 'desconhecida' : name})`,
    retryable: true,
  }
}
