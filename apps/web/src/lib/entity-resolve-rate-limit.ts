/**
 * entity-resolve-rate-limit.ts — Teto de chamadas da rota interna de resolucao.
 * PURO: o relogio e injetado, o estado e explicito.
 *
 * JANELA FIXA, E NAO DESLIZANTE. Uma janela deslizante precisa guardar o
 * carimbo de cada chamada; a fixa guarda um contador e um instante. Para um
 * consumidor unico e conhecido (o MNScr), a diferenca pratica e permitir uma
 * rajada do dobro do teto na virada da janela — e o que este teto protege nao e
 * um SLA, e sim o banco contra um laco descontrolado. O custo de errar para o
 * lado simples e uma rajada; o de errar para o lado complexo e memoria por
 * requisicao.
 *
 * O ESTADO E POR PROCESSO, e isso e uma limitacao REAL, nao um detalhe. Com N
 * instancias do `screen-app` atras de um balanceador, o teto efetivo e N vezes o
 * configurado. Um teto compartilhado exigiria Redis ou uma tabela — infra nova
 * para uma rota que so um cliente conhecido chama. Fica registrado aqui e na
 * documentacao de operacao para ninguem descobrir isso por acidente.
 *
 * O balde e por CREDENCIAL, nao por IP. A rota e interna: o IP que chega e o do
 * proxy, e um teto por IP de proxy seria um teto global disfarcado.
 */

export interface RateLimitState {
  /** Inicio da janela corrente, em ms epoch. */
  windowStartMs: number;
  count: number;
}

export interface RateLimitVerdict {
  readonly allowed: boolean;
  /** Quantas chamadas ainda cabem nesta janela. */
  readonly remaining: number;
  /** Segundos ate a janela virar. Vai no `Retry-After` quando recusa. */
  readonly retryAfterSeconds: number;
}

export const RATE_LIMIT_WINDOW_MS = 60_000;

/** Teto default por minuto, por credencial. */
export const DEFAULT_RATE_LIMIT_PER_MINUTE = 60;

/**
 * Le o teto do ambiente.
 *
 * Valor invalido cai no default em vez de derrubar a rota: um teto errado num
 * `.env` nao pode ser o motivo de o tradutor inteiro parar de responder. Zero e
 * negativo tambem caem no default — "0 por minuto" seria uma rota ligada que
 * recusa tudo, que e pior do que uma rota desligada.
 */
export function readRateLimitPerMinute(env: Record<string, string | undefined>): number {
  const raw = (env.CINERIE_CATALOG_RESOLVE_RATE_LIMIT_PER_MINUTE ?? "").trim();
  if (raw === "") return DEFAULT_RATE_LIMIT_PER_MINUTE;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_RATE_LIMIT_PER_MINUTE;
  return parsed;
}

/**
 * Consome uma chamada do balde daquela credencial.
 *
 * A CHAMADA RECUSADA NAO INCREMENTA. Incrementar manteria a janela cheia
 * enquanto o cliente insistisse, e um cliente que insiste e o caso normal de
 * retry — o teto viraria um bloqueio que se auto-renova.
 */
export function consumeRateLimit(
  buckets: Map<string, RateLimitState>,
  credentialId: string,
  limitPerMinute: number,
  nowMs: number,
): RateLimitVerdict {
  const current = buckets.get(credentialId);

  if (current === undefined || nowMs - current.windowStartMs >= RATE_LIMIT_WINDOW_MS) {
    buckets.set(credentialId, { windowStartMs: nowMs, count: 1 });
    return {
      allowed: true,
      remaining: limitPerMinute - 1,
      retryAfterSeconds: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000),
    };
  }

  const elapsed = nowMs - current.windowStartMs;
  const retryAfterSeconds = Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - elapsed) / 1000));

  if (current.count >= limitPerMinute) {
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  current.count += 1;
  return { allowed: true, remaining: limitPerMinute - current.count, retryAfterSeconds };
}

/**
 * Descarta baldes de janelas ja vencidas.
 *
 * Sem isto o `Map` cresce com o numero de credenciais ja vistas. Sao poucas hoje
 * — mas "poucas hoje" e como vazamento de memoria costuma comecar. Chamado na
 * propria requisicao, que e barato e dispensa temporizador.
 */
export function pruneRateLimitBuckets(buckets: Map<string, RateLimitState>, nowMs: number): void {
  for (const [key, state] of buckets) {
    if (nowMs - state.windowStartMs >= RATE_LIMIT_WINDOW_MS) buckets.delete(key);
  }
}
